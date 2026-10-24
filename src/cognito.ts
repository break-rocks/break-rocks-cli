// The user pool of the humans of a cell (`auth` of the cell map), through its
// public JSON API (no AWS credentials, no SDK): the sign-in with SRP (src/srp.ts) and, when the
// account has one, the code of its authenticator app; the refresh of the tokens; the revocation of
// the refresh token at sign-out. A refusal keeps the name of Cognito's exception as its code
// (NotAuthorizedException, UserNotConfirmedException, CodeMismatchException…), source "platform",
// with a message that says the reason the platform gives.
import type { Context } from './context.js';
import { CliError, EXIT, cliRefusal, networkError, platformRefusal, usageError } from './errors.js';
import { claimSignature, ephemeral, passwordAuthenticationKey, srpTimestamp } from './srp.js';

export type UserPool = { userPoolId: string; clientId: string; region: string };
export type CognitoTokens = { accessToken: string; idToken: string; refreshToken?: string; expiresIn: number };
/** The kind of code a step of the sign-in asks for: the authenticator app (TOTP), a text message, an email. */
export type CodeKind = 'totp' | 'sms' | 'email';

type AuthResult = { AccessToken: string; IdToken: string; RefreshToken?: string; ExpiresIn: number };
type Answer = { ChallengeName?: string; ChallengeParameters?: Record<string, string>; Session?: string; AuthenticationResult?: AuthResult };

const TIMEOUT_MS = 30_000;

/** What people read for the refusals of the sign-in (the code stays Cognito's). */
const REASONS: Record<string, string> = {
  NotAuthorizedException: 'The sign-in is refused: the email address or the password is wrong',
  UserNotConfirmedException: 'The sign-in is refused: the email address is not verified yet (the link of the email of the registration, in the app)',
  PasswordResetRequiredException: 'The password must be reset first: "Forgot password" in the app, then sign in here',
  CodeMismatchException: 'The code is wrong: the current code of the authenticator app',
  ExpiredCodeException: 'The code has expired: sign in again with the current code',
  TooManyRequestsException: 'Too many attempts: try again a few minutes later',
  LimitExceededException: 'Too many attempts: try again a few minutes later',
  UserNotFoundException: 'The sign-in is refused: the email address or the password is wrong',
};

/** One call of the API of [pool]; its refusal keeps the name of Cognito's exception as its code. */
async function call<T>(ctx: Context, pool: UserPool, action: string, body: Record<string, unknown>, reasons = REASONS): Promise<T> {
  let response: Response;
  try {
    response = await ctx.io.fetch(`https://cognito-idp.${pool.region}.amazonaws.com/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityProviderService.${action}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw networkError('NETWORK_ERROR', `No answer from the user pool (${(error as Error).message})`, { host: `cognito-idp.${pool.region}.amazonaws.com` });
  }
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* not JSON: the status says it */ }
  if (!response.ok) {
    if (response.status >= 500) throw networkError('SERVER_ERROR', `The user pool answered ${response.status}`, { status: response.status }, 'platform');
    const code = String(json.__type ?? `HTTP_${response.status}`).split('#').pop()!;
    const message = String(json.message ?? json.Message ?? '');
    // "Password attempts exceeded" is a NotAuthorizedException too: its own words then.
    const reason = code === 'NotAuthorizedException' && /attempts exceeded/i.test(message) ? REASONS.TooManyRequestsException : reasons[code];
    throw platformRefusal(code, reason ?? (message || `The user pool refused (${response.status})`));
  }
  return json as T;
}

const tokensOf = (r: AuthResult): CognitoTokens => ({ accessToken: r.AccessToken, idToken: r.IdToken, ...(r.RefreshToken ? { refreshToken: r.RefreshToken } : {}), expiresIn: r.ExpiresIn });

const CODE_CHALLENGES: Record<string, { kind: CodeKind; field: string }> = {
  SOFTWARE_TOKEN_MFA: { kind: 'totp', field: 'SOFTWARE_TOKEN_MFA_CODE' },
  SMS_MFA: { kind: 'sms', field: 'SMS_MFA_CODE' },
  EMAIL_OTP: { kind: 'email', field: 'EMAIL_OTP_CODE' },
};

/**
 * Signs in with [email] and [password] (SRP: the password never leaves the device), then the code
 * [code] gives when the account asks for one (its authenticator app). A first sign-in that must set
 * a password or an authenticator app is made in the app (FIRST_SIGN_IN_IN_APP).
 */
export async function signInWithPassword(ctx: Context, pool: UserPool, email: string, password: string, code: (kind: CodeKind) => Promise<string>): Promise<CognitoTokens> {
  const { a, A } = ephemeral();
  const ClientId = pool.clientId, poolName = pool.userPoolId.split('_')[1];
  let answer = await call<Answer>(ctx, pool, 'InitiateAuth', { AuthFlow: 'USER_SRP_AUTH', ClientId, AuthParameters: { USERNAME: email, SRP_A: A.toString(16) } });
  let username = email;
  for (let step = 0; step < 5 && !answer.AuthenticationResult; step++) {
    const challenge = answer.ChallengeName ?? '';
    const p = answer.ChallengeParameters ?? {};
    if (challenge === 'PASSWORD_VERIFIER') {
      username = p.USER_ID_FOR_SRP ?? username;
      const key = passwordAuthenticationKey({ poolName, userId: username, password, a, A, B: BigInt(`0x${p.SRP_B}`), salt: p.SALT });
      const timestamp = srpTimestamp(new Date(ctx.now()));
      answer = await call<Answer>(ctx, pool, 'RespondToAuthChallenge', {
        ChallengeName: 'PASSWORD_VERIFIER', ClientId, ...(answer.Session ? { Session: answer.Session } : {}),
        ChallengeResponses: { USERNAME: username, PASSWORD_CLAIM_SECRET_BLOCK: p.SECRET_BLOCK, TIMESTAMP: timestamp, PASSWORD_CLAIM_SIGNATURE: claimSignature(key, poolName, username, p.SECRET_BLOCK, timestamp) },
      });
    } else if (CODE_CHALLENGES[challenge]) {
      const { kind, field } = CODE_CHALLENGES[challenge];
      const value = (await code(kind)).trim();
      answer = await call<Answer>(ctx, pool, 'RespondToAuthChallenge', { ChallengeName: challenge, ClientId, Session: answer.Session, ChallengeResponses: { USERNAME: username, [field]: value } });
    } else if (challenge === 'SELECT_MFA_TYPE') {
      answer = await call<Answer>(ctx, pool, 'RespondToAuthChallenge', { ChallengeName: challenge, ClientId, Session: answer.Session, ChallengeResponses: { USERNAME: username, ANSWER: 'SOFTWARE_TOKEN_MFA' } });
    } else if (challenge === 'NEW_PASSWORD_REQUIRED' || challenge === 'MFA_SETUP') {
      throw cliRefusal('FIRST_SIGN_IN_IN_APP', 'This account must first set its password or its authenticator app in the app: sign in there once, then here');
    } else {
      throw cliRefusal('UNSUPPORTED_CHALLENGE', `The user pool asks for ${challenge || 'an unknown step'}, which the CLI does not do: sign in with the app`, { challenge });
    }
  }
  if (!answer.AuthenticationResult) throw cliRefusal('UNSUPPORTED_CHALLENGE', 'The user pool asked for too many steps', {});
  return tokensOf(answer.AuthenticationResult);
}

/** New access and id tokens from the refresh token; a refresh token expired or revoked ends the session (SESSION_EXPIRED, exit 3). */
export async function refreshTokens(ctx: Context, pool: UserPool, refreshToken: string): Promise<CognitoTokens> {
  try {
    const answer = await call<Answer>(ctx, pool, 'InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: pool.clientId, AuthParameters: { REFRESH_TOKEN: refreshToken } });
    if (!answer.AuthenticationResult) throw cliRefusal('UNSUPPORTED_CHALLENGE', 'The user pool asked for a step to renew the session');
    return tokensOf(answer.AuthenticationResult);
  } catch (error) {
    if (error instanceof CliError && (error.code === 'NotAuthorizedException' || error.code === 'UserNotFoundException')) {
      throw new CliError('SESSION_EXPIRED', 'The session has ended (7 days after the sign-in, signed out everywhere, or the password changed): sign in again (breakrocks login)', EXIT.NETWORK, {}, 'platform');
    }
    throw error;
  }
}

/** Revokes the refresh token, and the access and id tokens it gave (the sign-out of this device). */
export async function revokeToken(ctx: Context, pool: UserPool, refreshToken: string): Promise<void> {
  await call(ctx, pool, 'RevokeToken', { ClientId: pool.clientId, Token: refreshToken });
}

/** The claims of a JWT, not verified (the API verifies it; the CLI reads its subject, its session and its expiry). */
export function claimsOf(token: string): { sub?: string; exp?: number; iat?: number; origin_jti?: string; email?: string; [claim: string]: unknown } {
  try { return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')); } catch { return {}; }
}

/** An email address as the sign-in takes it (EMAIL_INVALID, exit 2, otherwise). */
export function checkEmail(value: string): string {
  const email = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw usageError('EMAIL_INVALID', `"${value}" is not an email address`);
  return email;
}
