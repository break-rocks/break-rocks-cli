// login and logout: one login for the three accounts of a
// profile. A human signs in with its email address and its password (SRP: the password never
// leaves the device), and the code of its authenticator app when it has one, in the user pool of
// its cell (the directory gives the cell of the email, as the apps do); --browser lets the web app
// give the CLI a one-time code instead (src/browser-login.ts, the CUSTOM_AUTH flow). A profile that
// holds an agent operator or a delegated agent signs in with its key, as operator login and agent
// login do. logout closes the session of this device (the refresh token of a human revoked), or,
// --everywhere, every session of a human (signOutEverywhere).
import { PLATFORM_EXCHANGE, callbackServer, loginPageUrl, loginSecrets, openInBrowser, BROWSER_LOGIN_SECONDS, type BrowserCode } from '../browser-login.js';
import { checkEmail, revokeToken, signInWithPassword, type CodeKind, type CognitoTokens, type UserPool } from '../cognito.js';
import type { Profile } from '../config.js';
import type { Context } from '../context.js';
import { cellMap, cellOfEmail, endpoints, webOrigin, type CellMap } from '../endpoints.js';
import { CliError, cliRefusal, usageError } from '../errors.js';
import type { Command } from '../registry.js';
import { bool, int, object, openObject, str } from '../schema.js';
import { agentFromEnv, api, credentialsOf, forgetSession, humanSession, readSession, saveSession, signIn } from '../session.js';
import { graphql } from '../transport.js';

type LoginInput = { email?: string; passwordStdin?: boolean; code?: string; cell?: string; browser?: boolean; open?: boolean; port?: number; timeout?: number };
type LoginResult = {
  kind: 'human' | 'operator' | 'agent'; env: string; cell: string;
  accountId?: string; handle?: string; operatorId?: string; agentId?: string;
  session: { sessionId: string; expiresAt: string; signInAgainBy?: string };
};

const CODE_QUESTIONS: Record<CodeKind, string> = { totp: 'Code of the authenticator app: ', sms: 'Code received by text message: ', email: 'Code received by email: ' };

/** The password: the first line of the standard input (--password-stdin), else asked without echo in a terminal. */
async function readPassword(ctx: Context, fromStdin: boolean | undefined): Promise<string> {
  if (fromStdin) {
    if (!ctx.io.readStdin) throw usageError('PASSWORD_REQUIRED', '--password-stdin needs a standard input');
    const line = (await ctx.io.readStdin()).split(/\r?\n/)[0];
    if (!line) throw usageError('PASSWORD_REQUIRED', 'Nothing on the standard input: the password, then a new line');
    return line;
  }
  if (ctx.io.interactive && ctx.io.secret) return ctx.io.secret('Password: ');
  throw usageError('PASSWORD_REQUIRED', 'The password is missing: --password-stdin (the password on the standard input), or run in a terminal');
}

const poolOf = (map: CellMap, env: string, cell: string): UserPool => {
  const found = map.cells[cell];
  if (!found) throw cliRefusal('CELL_UNKNOWN', `The cell "${cell}" is not in the cell map of ${env}`, { cell });
  if (!found.auth) throw cliRefusal('USER_POOL_UNKNOWN', `The cell map of ${env} gives no user pool for the cell "${cell}"`, { cell });
  return found.auth;
};

/** The account behind the tokens (me), the profile and the session saved; the tokens revoked when the API refuses the account. */
async function finishHuman(ctx: Context, profile: Profile, cell: string, pool: UserPool, tokens: CognitoTokens): Promise<LoginResult> {
  const at = await endpoints(ctx, { env: profile.env, cell });
  let me: { id: string; kind: string; handle: string } | null;
  try {
    me = (await graphql<{ me: { id: string; kind: string; handle: string } | null }>(ctx, at.api, tokens.accessToken, '{ me { id kind handle } }')).me;
    if (!me) throw cliRefusal('ACCOUNT_NOT_FOUND', 'The user pool signed in an account the API does not know');
  } catch (error) {
    if (tokens.refreshToken) await revokeToken(ctx, pool, tokens.refreshToken).catch(() => undefined);
    throw error;
  }
  // A session of this profile signed in before (another account, or the same one): closed first.
  const before = readSession(ctx);
  if (before?.kind === 'human' && before.refreshToken && before.pool) await revokeToken(ctx, before.pool, before.refreshToken).catch(() => undefined);
  const session = humanSession(tokens, pool, me.id, ctx.now());
  ctx.saveProfile({ env: profile.env, cell, kind: 'human', accountId: me.id, handle: me.handle });
  saveSession(ctx, session);
  return { kind: 'human', env: profile.env, cell, accountId: me.id, handle: me.handle, session: { sessionId: session.sessionId, expiresAt: session.expiresAt, signInAgainBy: session.signInAgainBy } };
}

async function passwordLogin(ctx: Context, profile: Profile, i: LoginInput): Promise<LoginResult> {
  let given = i.email;
  if (given === undefined) {
    if (!ctx.io.interactive || i.passwordStdin) throw usageError('EMAIL_REQUIRED', 'The email address is missing: --email <address>');
    given = await ctx.io.ask('Email address: ');
  }
  const email = checkEmail(given);
  const password = await readPassword(ctx, i.passwordStdin);
  const map = await cellMap(ctx, profile.env);
  // The cell of the account, as the apps find it on a new device: the directory, by the email.
  const cell = i.cell ?? (await cellOfEmail(ctx, profile.env, email)) ?? (profile.kind === 'human' ? profile.cell : undefined) ?? map.default;
  const pool = poolOf(map, profile.env, cell);
  ctx.progress(`Signing in to ${profile.env}, cell ${cell}`);
  const tokens = await signInWithPassword(ctx, pool, email, password, async (kind) => {
    if (i.code) return i.code;
    if (ctx.io.interactive && !i.passwordStdin) return ctx.io.ask(CODE_QUESTIONS[kind]);
    throw usageError('MFA_CODE_REQUIRED', kind === 'totp' ? 'The account asks for the code of its authenticator app: --code <code>' : `The account asks for the code it was sent (${kind}): --code <code>`, { kind });
  });
  return finishHuman(ctx, profile, cell, pool, tokens);
}

async function browserLogin(ctx: Context, profile: Profile, i: LoginInput): Promise<LoginResult> {
  const exchange = ctx.io.codeExchange ?? PLATFORM_EXCHANGE;
  if (!exchange.available) throw cliRefusal('NOT_AVAILABLE_YET', `login --browser is not available yet: ${exchange.reason}`, { reason: exchange.reason });
  const map = await cellMap(ctx, profile.env);
  const { state, verifier, challenge } = loginSecrets();
  const origin = webOrigin(ctx, profile.env);
  const server = await callbackServer({ origin, state, port: i.port, timeoutMs: (i.timeout ?? BROWSER_LOGIN_SECONDS) * 1000 });
  let got: BrowserCode;
  try {
    const url = loginPageUrl(origin, server.port, state, challenge);
    ctx.notice(`To connect the command line, open in your browser: ${url}`);
    if (i.open !== false && !(await (ctx.io.openUrl ?? openInBrowser)(url))) ctx.notice('The browser could not be opened: open the address above.');
    ctx.progress('Waiting for the confirmation in the browser (Ctrl-C to cancel)');
    got = await server.result;
  } finally { server.close(); }
  const cell = got.cell ?? i.cell ?? (profile.kind === 'human' ? profile.cell : undefined) ?? map.default;
  const pool = poolOf(map, profile.env, cell);
  const tokens = await exchange.exchange(ctx, { pool, code: got.code, username: got.username, verifier });
  return finishHuman(ctx, profile, cell, pool, tokens);
}

export const login: Command<LoginInput, LoginResult> = {
  name: 'login', summary: 'Sign in: a human with its email address and password (or --browser); an operator or a delegated agent with its key',
  description: 'A human: the email address (--email, or asked), the password (asked without echo, or --password-stdin: its first line), the code of the authenticator app when the account has one (--code, or asked); the cell of the account from the directory, as the apps (--cell to choose). The session lasts 7 days from the sign-in, its tokens renewed on their own; all three kept in the configuration folder (0600), never printed. A first sign-in, the minimum age and the terms of use are done in the app. --browser: the web app (/cli/login) gives the CLI a one-time code of 5 minutes instead of the password, never a token; the session is the same. A profile of an agent operator or a delegated agent (or the variables BREAKROCKS_OPERATOR_ID, BREAKROCKS_AGENT_ID, BREAKROCKS_AGENT_KEY) signs in with its key, as operator login and agent login. Not an MCP tool.',
  examples: ['breakrocks --env dev login', 'printf "%s\\n" "$PASSWORD" | breakrocks --profile me-dev --env dev login --email me@example.com --password-stdin', 'breakrocks login --browser'],
  input: object({
    email: str('The email address of the human account'),
    passwordStdin: bool('Read the password from the first line of the standard input (scripts)'),
    code: str('The code of the authenticator app, when the account asks for one', { pattern: '^[0-9A-Za-z]{4,12}$' }),
    cell: str('The home cell of the account, when known (eu, us): else the directory tells it', { pattern: '^[a-z]{2}$' }),
    browser: bool('Sign in through the web app: it gives the CLI a code, no password in the terminal'),
    open: bool('With --browser: open the browser (--no-open: write the address only)', { default: true }),
    port: int('With --browser: the local port to listen on (default: a free one)', { minimum: 1024, maximum: 65535 }),
    timeout: int('With --browser: seconds to wait for the confirmation (default 300)', { minimum: 30, maximum: 900 }),
  }),
  output: openObject({
    kind: str('human, operator or agent', { enum: ['human', 'operator', 'agent'] }), env: str('Environment'), cell: str('Home cell'),
    accountId: str('The account id of the human'), handle: str('Its handle'), operatorId: str('The operator'), agentId: str('The delegated agent'),
    session: openObject({ sessionId: str('The session'), expiresAt: str('When its token ends (renewed on its own)'), signInAgainBy: str('A human: when the session ends, 7 days after the sign-in') }),
  }),
  mcp: false,
  run: async (ctx, i) => {
    const profile = ctx.profile();
    const asHuman = i.email !== undefined || !!i.passwordStdin || i.code !== undefined || !!i.browser;
    const fromEnv = agentFromEnv(ctx.env);
    if (fromEnv && profile.kind === 'human') throw usageError('PROFILE_HOLDS_HUMAN', `BREAKROCKS_OPERATOR_ID, BREAKROCKS_AGENT_ID and BREAKROCKS_AGENT_KEY are set, but the profile "${ctx.profileName}" holds a human account: use another profile (--profile <name>)`, { profile: ctx.profileName });
    if (!asHuman && (fromEnv || profile.kind === 'operator' || profile.kind === 'agent')) {
      // the profile's own account, with its key.
      const credentials = credentialsOf(ctx, profile);
      if (!credentials) throw usageError('SIGN_IN_REQUIRED', `The key of the profile "${ctx.profileName}" is not here`);
      const at = await endpoints(ctx, { ...profile, operatorId: profile.operatorId ?? credentials.operatorId });
      const session = await signIn(ctx, at, credentials);
      return { kind: credentials.kind, env: at.env, cell: at.cell, operatorId: credentials.operatorId, ...(credentials.kind === 'agent' ? { agentId: credentials.agentId } : {}), session: { sessionId: session.sessionId, expiresAt: session.expiresAt } };
    }
    if (profile.kind === 'operator' || profile.kind === 'agent') {
      throw usageError('PROFILE_HOLDS_AGENT_ACCOUNT', `The profile "${ctx.profileName}" holds ${profile.kind === 'operator' ? 'an agent operator' : 'a delegated agent'}: sign the human in another profile (--profile <name>)`, { profile: ctx.profileName });
    }
    return i.browser ? browserLogin(ctx, profile, i) : passwordLogin(ctx, profile, i);
  },
  text: (r) => `Signed in: ${r.kind === 'human' ? `@${r.handle} (${r.accountId})` : r.kind === 'agent' ? `delegated agent ${r.agentId} of ${r.operatorId}` : `agent operator ${r.operatorId}`}\n${r.env}, cell ${r.cell}\nsession until ${r.session.expiresAt}${r.session.signInAgainBy ? ` (renewed on its own), sign in again by ${r.session.signInAgainBy}` : ''}`,
  quiet: (r) => r.accountId ?? r.agentId ?? r.operatorId,
};

type LogoutResult = { profile: string; kind?: string; signedOut: boolean; everywhere: boolean; revoked: boolean; note?: string };

export const logout: Command<{ everywhere?: boolean }, LogoutResult> = {
  name: 'logout', summary: 'Sign out this device (a human\'s refresh token revoked), or every session of a human (--everywhere)',
  description: 'The session of the profile is forgotten on this device; the profile and its account stay (login again). A human: its refresh token is revoked, and the tokens it gave; --everywhere ends every session of the account on every device (signOutEverywhere: the apps are signed out too). An agent operator or a delegated agent: the agents host has no sign-out, its token ends within the hour. Not an MCP tool.',
  examples: ['breakrocks logout', 'breakrocks logout --everywhere'],
  input: object({ everywhere: bool('A human: end every session of the account, on every device (signOutEverywhere)') }),
  output: openObject({ profile: str('The profile'), kind: str('human, operator or agent'), signedOut: bool('A session was closed here'), everywhere: bool('Every session of the account ended'), revoked: bool('The platform revoked the session'), note: str('What to know') }),
  mcp: false,
  run: async (ctx, { everywhere = false }) => {
    const session = readSession(ctx);
    if (!session) return { profile: ctx.profileName, signedOut: false, everywhere: false, revoked: false, note: 'No session on this device' };
    if (session.kind === 'human') {
      if (everywhere) {
        await api(ctx, 'mutation { signOutEverywhere }');
        forgetSession(ctx);
        return { profile: ctx.profileName, kind: 'human', signedOut: true, everywhere: true, revoked: true };
      }
      let revoked = false, note: string | undefined;
      try { if (session.pool && session.refreshToken) { await revokeToken(ctx, session.pool, session.refreshToken); revoked = true; } } catch (error) {
        note = `The refresh token could not be revoked (${error instanceof CliError ? error.code : String(error)}): it ends by itself by ${session.signInAgainBy}`;
        ctx.notice(note);
      }
      forgetSession(ctx);
      return { profile: ctx.profileName, kind: 'human', signedOut: true, everywhere: false, revoked, ...(note ? { note } : {}) };
    }
    if (everywhere) throw cliRefusal('SIGN_OUT_EVERYWHERE_HUMANS_ONLY', 'Signing out everywhere is for a human account: the sessions of an agent operator or a delegated agent end within the hour (operator recover closes the other sessions of an operator; agents regenerate those of a delegated agent)');
    forgetSession(ctx);
    return { profile: ctx.profileName, kind: session.kind, signedOut: true, everywhere: false, revoked: false, note: `The agents host has no sign-out: the token stays valid until ${session.expiresAt}, and is no longer on this device` };
  },
  text: (r) => (r.signedOut ? `Signed out${r.everywhere ? ' everywhere' : ''} (profile ${r.profile})${r.note ? `\n${r.note}` : ''}` : `${r.note} (profile ${r.profile})`),
};
