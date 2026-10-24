// A fake of the user pool of the humans, of the directory and of the API of a cell (no network):
// Cognito checks the SRP claim as Cognito does (the password never sent), asks the code of the
// authenticator app when the account has one, renews with the refresh token and revokes it; the
// API answers me, mySubscription, myPresences, myUsage and signOutEverywhere for a valid access token.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { claimSignature, g, k, modPow, N, padHex } from '../src/srp.js';

export const POOL = { userPoolId: 'eu-west-1_TESTpool1', clientId: 'testclient123', region: 'eu-west-1' };
const big = (hex: string) => BigInt(`0x${hex}`);
const hexHash = (hex: string) => createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
export const jwt = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export type PoolOptions = {
  now: () => number;
  email?: string; password?: string; totp?: string; confirmed?: boolean; challenge?: string;
  accountId?: string; handle?: string; cell?: string;
};

export function fakeCell(options: PoolOptions) {
  const email = options.email ?? 'carol@example.com';
  const password = options.password ?? 'correct horse battery staple';
  const userId = 'f1c2a3b4-0000-4000-8000-000000000001';
  const accountId = options.accountId ?? 'eu-0199aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee';
  const handle = options.handle ?? 'carol';
  const poolName = POOL.userPoolId.split('_')[1];
  const salt = randomBytes(16).toString('hex');
  const x = big(hexHash(padHex(big(salt)) + createHash('sha256').update(`${poolName}${userId}:${password}`).digest('hex')));
  const v = modPow(g, x, N);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the JSON bodies of the fake
  const calls: { action: string; body: Record<string, any> }[] = [];
  const graphql: { query: string; authorization: string }[] = [];
  const access = new Map<string, number>();
  const refresh = new Map<string, { revoked: boolean }>();
  const state = { refusedOnce: false, signedOutEverywhere: false, directory: [] as string[] };
  let pending: { A: bigint; b: bigint; B: bigint; secretBlock: string } | undefined;
  const origin = randomUUID();

  const issue = (withRefresh: boolean) => {
    const exp = Math.floor(options.now() / 1000) + 3600;
    const accessToken = jwt({ sub: userId, exp, origin_jti: origin, token_use: 'access', n: randomUUID() });
    access.set(accessToken, exp * 1000);
    const result: Record<string, unknown> = { AccessToken: accessToken, IdToken: jwt({ sub: userId, exp, token_use: 'id', email }), ExpiresIn: 3600, TokenType: 'Bearer' };
    if (withRefresh) { const r = `refresh-${randomUUID()}`; refresh.set(r, { revoked: false }); result.RefreshToken = r; }
    return { AuthenticationResult: result };
  };
  const refuse = (type: string, message: string) => json(400, { __type: type, message });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the JSON bodies of the fake
  const cognito: Record<string, (body: Record<string, any>) => Response> = {
    InitiateAuth: (body) => {
      expect(body.ClientId).toBe(POOL.clientId);
      if (body.AuthFlow === 'REFRESH_TOKEN_AUTH') {
        const r = refresh.get(body.AuthParameters.REFRESH_TOKEN);
        if (!r || r.revoked) return refuse('NotAuthorizedException', 'Refresh Token has been revoked');
        return json(200, issue(false));
      }
      expect(body.AuthFlow).toBe('USER_SRP_AUTH');
      if (String(body.AuthParameters.USERNAME).toLowerCase() !== email) return refuse('NotAuthorizedException', 'Incorrect username or password.');
      if (options.confirmed === false) return refuse('UserNotConfirmedException', 'User is not confirmed.');
      const A = big(body.AuthParameters.SRP_A);
      const b = big(randomBytes(32).toString('hex'));
      const B = (k * v + modPow(g, b, N)) % N;
      pending = { A, b, B, secretBlock: randomBytes(32).toString('base64') };
      return json(200, { ChallengeName: 'PASSWORD_VERIFIER', ChallengeParameters: { SALT: salt, SECRET_BLOCK: pending.secretBlock, SRP_B: B.toString(16), USERNAME: userId, USER_ID_FOR_SRP: userId } });
    },
    RespondToAuthChallenge: (body) => {
      if (body.ChallengeName === 'PASSWORD_VERIFIER') {
        const r = body.ChallengeResponses, p = pending!;
        const u = big(hexHash(padHex(p.A) + padHex(p.B)));
        const S = modPow(p.A * modPow(v, u, N), p.b, N);
        const prk = createHmac('sha256', Buffer.from(padHex(u), 'hex')).update(Buffer.from(padHex(S), 'hex')).digest();
        const key = createHmac('sha256', prk).update(Buffer.concat([Buffer.from('Caldera Derived Key'), Buffer.from([1])])).digest().subarray(0, 16);
        if (r.USERNAME !== userId || r.PASSWORD_CLAIM_SECRET_BLOCK !== p.secretBlock || r.PASSWORD_CLAIM_SIGNATURE !== claimSignature(key, poolName, userId, p.secretBlock, r.TIMESTAMP)) {
          return refuse('NotAuthorizedException', 'Incorrect username or password.');
        }
        if (options.challenge) return json(200, { ChallengeName: options.challenge, Session: 'next-session', ChallengeParameters: {} });
        if (options.totp) return json(200, { ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 'mfa-session', ChallengeParameters: {} });
        return json(200, issue(true));
      }
      expect(body).toMatchObject({ ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 'mfa-session', ChallengeResponses: { USERNAME: userId } });
      if (body.ChallengeResponses.SOFTWARE_TOKEN_MFA_CODE !== options.totp) return refuse('CodeMismatchException', 'Invalid code received for user');
      return json(200, issue(true));
    },
    RevokeToken: (body) => { const r = refresh.get(body.Token); if (r) r.revoked = true; return json(200, {}); },
  };

  function api(body: { query: string }, authorization: string): Response {
    graphql.push({ query: body.query, authorization });
    const exp = access.get(authorization);
    if (!exp || exp <= options.now() || state.signedOutEverywhere) return json(401, { errors: [{ errorType: 'UnauthorizedException', message: 'no' }] });
    if (state.refusedOnce) { state.refusedOnce = false; return json(401, { errors: [{ errorType: 'UnauthorizedException', message: 'no' }] }); }
    const q = body.query;
    const data: Record<string, unknown> = {};
    if (q.includes('signOutEverywhere')) {
      for (const r of refresh.values()) r.revoked = true;
      state.signedOutEverywhere = true;
      return json(200, { data: { signOutEverywhere: true } });
    }
    if (/\bme\b/.test(q)) data.me = { id: accountId, kind: 'human', handle, displayName: handle, organizationName: null, legalSpace: 'fra', minimumAgeCheckedAt: '2026-10-01', paidTier: null, paidUntil: null, fullAgeConfirmedAt: null };
    if (q.includes('mySubscription')) data.mySubscription = null;
    if (q.includes('myPresences')) data.myPresences = { items: [{ universe: '%paris', joinedAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z', canVote: true }], next: null };
    if (q.includes('myUsage')) {
      const w = (used: number, limit: number) => ({ used, limit, resetAt: new Date(options.now() + 60_000).toISOString() });
      data.myUsage = { minute: w(1, 60), hour: w(3, 600), quota: w(3, 2000), tier: 'FREE', byCategory: [] };
    }
    return json(200, { data });
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]));
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.host === 'apps.dev.break.rocks' && url.pathname === '/config/cells.json') {
      return json(200, { version: 1, default: 'eu', cells: { eu: { region: 'eu-west-1', api: 'https://api.test/graphql', agents: 'https://agents.test', media: 'https://media.test', realtime: 'wss://rt.test/event/realtime', events: 'https://ev.test/event', auth: POOL } }, byCountry: {} });
    }
    if (url.host === 'directory.dev.break.rocks' && url.pathname === '/v1/cell') { state.directory.push(body.email); return json(200, { cell: options.cell ?? 'eu' }); }
    if (url.host === 'cognito-idp.eu-west-1.amazonaws.com') {
      const action = String(headers['x-amz-target']).split('.')[1];
      calls.push({ action, body });
      return cognito[action](body);
    }
    if (url.host === 'api.test') return api(body, headers.authorization ?? '');
    throw new TypeError(`fetch failed: ${url.host}`);
  };
  return { fetch, calls, graphql, refresh, access, state, email, password, accountId, handle, userId };
}
