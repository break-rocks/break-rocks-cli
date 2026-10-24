// The sign-in of a human: SRP and the code of the authenticator app
// against a fake user pool, the cell from the directory, the session in a private file and never
// printed, its renewal, a token refused, whoami, usage and capabilities of a human, logout and
// logout --everywhere; login on a profile of an agent account; login --browser not served yet.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CodeExchange } from '../src/browser-login.js';
import { fakeCell, jwt, POOL } from './fake-pool.js';
import { harness, last } from './helpers.js';

function signedOut(options: Parameters<typeof fakeCell>[0] extends infer O ? Partial<O> : never = {}, extra: { interactive?: boolean; answers?: string[] } = {}) {
  const h = harness({ ...extra });
  const cell = fakeCell({ now: () => h.clock.now, ...options });
  h.io.fetch = cell.fetch;
  h.io.readStdin = async () => `${cell.password}\n`;
  h.io.secret = async () => cell.password;
  return { h, cell };
}
const sessionFile = (h: ReturnType<typeof harness>, profile = 'default') => join(h.dir, 'config', 'sessions', `${profile}.json`);

describe('login of a human', () => {
  it('signs in with SRP, the cell of the directory, and keeps the session for the user alone, never printed', async () => {
    const { h, cell } = signedOut();
    expect(await h.run('--env', 'dev', 'login', '--email', 'Carol@Example.com', '--password-stdin', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ kind: 'human', env: 'dev', cell: 'eu', accountId: cell.accountId, handle: 'carol', session: { expiresAt: '2026-10-23T11:00:00.000Z', signInAgainBy: '2026-10-30T10:00:00.000Z' } });
    expect(cell.state.directory).toEqual(['Carol@Example.com']);
    expect(cell.calls.map((c) => c.action)).toEqual(['InitiateAuth', 'RespondToAuthChallenge']);
    // The password never leaves the device, no token is printed.
    expect(JSON.stringify(cell.calls)).not.toContain(cell.password);
    expect(h.all()).not.toMatch(/refresh-|e30\.|correct horse/);
    const saved = JSON.parse(readFileSync(sessionFile(h), 'utf8'));
    expect(saved).toMatchObject({ kind: 'human', accountId: cell.accountId, pool: POOL, refreshToken: expect.stringMatching(/^refresh-/), idToken: expect.any(String) });
    if (process.platform !== 'win32') expect(statSync(sessionFile(h)).mode & 0o777).toBe(0o600);
    expect(await h.run('profile', 'show', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ name: 'default', env: 'dev', kind: 'human', accountId: cell.accountId, cell: 'eu' });
    expect(JSON.stringify(last(h))).not.toContain('refresh-');
  });
  it('asks the email address, the password (without echo) and the code of the authenticator app in a terminal', async () => {
    const { h, cell } = signedOut({ totp: '123456' }, { interactive: true, answers: ['carol@example.com', '123456'] });
    expect(await h.run('--env', 'dev', 'login')).toBe(0);
    expect(h.lines.join('\n')).toContain('Signed in: @carol');
    expect(cell.calls.map((c) => c.action)).toEqual(['InitiateAuth', 'RespondToAuthChallenge', 'RespondToAuthChallenge']);
  });
  it('takes the code with --code, refuses a wrong one, and asks for it outside a terminal', async () => {
    const good = signedOut({ totp: '123456' });
    expect(await good.h.run('--env', 'dev', 'login', '--email', 'carol@example.com', '--password-stdin', '--code', '123456')).toBe(0);
    const wrong = signedOut({ totp: '123456' });
    expect(await wrong.h.run('--env', 'dev', 'login', '--email', 'carol@example.com', '--password-stdin', '--code', '654321', '--json')).toBe(1);
    expect(last(wrong.h)).toEqual({ error: { code: 'CodeMismatchException', message: 'The code is wrong: the current code of the authenticator app', source: 'platform' } });
    const missing = signedOut({ totp: '123456' });
    expect(await missing.h.run('--env', 'dev', 'login', '--email', 'carol@example.com', '--password-stdin', '--json')).toBe(2);
    expect(last(missing.h)).toMatchObject({ error: { code: 'MFA_CODE_REQUIRED', source: 'cli' } });
  });
  it('gives the same answer for a wrong password and an unknown email address, and keeps nothing', async () => {
    for (const [email, password] of [['carol@example.com', 'not the password'], ['carl@example.com', 'correct horse battery staple']]) {
      const { h } = signedOut();
      h.io.readStdin = async () => `${password}\n`;
      expect(await h.run('--env', 'dev', 'login', '--email', email, '--password-stdin', '--json')).toBe(1);
      expect(last(h)).toEqual({ error: { code: 'NotAuthorizedException', message: 'The sign-in is refused: the email address or the password is wrong', source: 'platform' } });
      expect(() => statSync(sessionFile(h))).toThrow();
    }
  });
  it('says an email address not verified yet, and a first sign-in that belongs to the app', async () => {
    const pending = signedOut({ confirmed: false });
    expect(await pending.h.run('--env', 'dev', 'login', '--email', 'carol@example.com', '--password-stdin', '--json')).toBe(1);
    expect(last(pending.h)).toMatchObject({ error: { code: 'UserNotConfirmedException', message: expect.stringContaining('not verified yet') } });
    const first = signedOut({ challenge: 'NEW_PASSWORD_REQUIRED' });
    expect(await first.h.run('--env', 'dev', 'login', '--email', 'carol@example.com', '--password-stdin', '--json')).toBe(1);
    expect(last(first.h)).toMatchObject({ error: { code: 'FIRST_SIGN_IN_IN_APP', source: 'cli' } });
  });
  it('refuses what is missing outside a terminal, and a profile that holds an agent account', async () => {
    const { h } = signedOut();
    h.io.readStdin = undefined;
    expect(await h.run('--env', 'dev', 'login', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'EMAIL_REQUIRED' } });
    expect(await h.run('--env', 'dev', 'login', '--email', 'carol@example.com', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'PASSWORD_REQUIRED' } });
    expect(await h.run('--env', 'dev', 'login', '--email', 'not-an-email', '--password-stdin', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'EMAIL_INVALID' } });
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(join(h.dir, 'config'), { recursive: true });
    writeFileSync(join(h.dir, 'config', 'config.json'), JSON.stringify({ version: 1, current: 'default', profiles: { default: { env: 'dev', kind: 'operator', operatorId: 'eu-op' } } }));
    expect(await h.run('login', '--email', 'carol@example.com', '--password-stdin', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'PROFILE_HOLDS_AGENT_ACCOUNT' } });
  });
});

describe('the session of a human', () => {
  async function signedIn() {
    const s = signedOut();
    expect(await s.h.run('--env', 'dev', 'login', '--email', 'carol@example.com', '--password-stdin')).toBe(0);
    return s;
  }
  it('reads whoami: the account, its subscription, its residences', async () => {
    const { h, cell } = await signedIn();
    expect(await h.run('whoami', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ actor: 'human', env: 'dev', cell: 'eu', account: { id: cell.accountId, kind: 'human', handle: 'carol', legalSpace: 'fra', minimumAgeCheckedAt: '2026-10-01' }, subscription: null, residences: [{ universe: '%paris' }], session: { signInAgainBy: '2026-10-30T10:00:00.000Z' } });
    expect(await h.run('whoami')).toBe(0);
    expect(h.lines.at(-1)).toContain('resident of %paris');
    expect(await h.run('usage', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ actor: 'human', tier: 'FREE', quota: { remaining: 1997 } });
    expect(await h.run('capabilities', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ actor: 'human', canManageAgents: false, account: { kind: 'human' } });
    expect(last(h)).not.toHaveProperty('operator');
    expect(await h.run('session', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ signedIn: true, kind: 'human', accountId: cell.accountId, canRenew: true, signInAgainBy: '2026-10-30T10:00:00.000Z' });
  });
  it('renews its tokens 5 minutes before they end, and again when the API refuses one', async () => {
    const { h, cell } = await signedIn();
    const first = JSON.parse(readFileSync(sessionFile(h), 'utf8'));
    h.clock.now += 56 * 60_000;
    expect(await h.run('whoami', '--json')).toBe(0);
    expect(cell.calls.filter((c) => c.body.AuthFlow === 'REFRESH_TOKEN_AUTH')).toHaveLength(1);
    const renewed = JSON.parse(readFileSync(sessionFile(h), 'utf8'));
    expect(renewed.token).not.toBe(first.token);
    expect(renewed).toMatchObject({ refreshToken: first.refreshToken, signedInAt: first.signedInAt, signInAgainBy: first.signInAgainBy });
    expect(cell.graphql.at(-1)!.authorization).toBe(renewed.token);
    cell.state.refusedOnce = true;
    expect(await h.run('whoami', '--json')).toBe(0);
    expect(cell.calls.filter((c) => c.body.AuthFlow === 'REFRESH_TOKEN_AUTH')).toHaveLength(2);
  });
  it('ends when its refresh token is refused: SESSION_EXPIRED (exit 3), the session forgotten', async () => {
    const { h, cell } = await signedIn();
    for (const r of cell.refresh.values()) r.revoked = true;
    h.clock.now += 3600_000;
    expect(await h.run('whoami', '--json')).toBe(3);
    expect(last(h)).toMatchObject({ error: { code: 'SESSION_EXPIRED', message: expect.stringContaining('breakrocks login') } });
    expect(() => statSync(sessionFile(h))).toThrow();
    expect(await h.run('whoami', '--json')).toBe(3);
    expect(last(h)).toMatchObject({ error: { code: 'SIGN_IN_REQUIRED', message: expect.stringContaining('breakrocks login') } });
  });
  it('signs out this device: the refresh token revoked, the session forgotten, the profile kept', async () => {
    const { h, cell } = await signedIn();
    const { refreshToken } = JSON.parse(readFileSync(sessionFile(h), 'utf8'));
    expect(await h.run('logout', '--json')).toBe(0);
    expect(last(h)).toEqual({ profile: 'default', kind: 'human', signedOut: true, everywhere: false, revoked: true });
    expect(cell.refresh.get(refreshToken)!.revoked).toBe(true);
    expect(() => statSync(sessionFile(h))).toThrow();
    expect(await h.run('profile', 'show', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ kind: 'human', accountId: cell.accountId });
    expect(await h.run('logout', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ signedOut: false, note: 'No session on this device' });
  });
  it('signs out everywhere with signOutEverywhere', async () => {
    const { h, cell } = await signedIn();
    expect(await h.run('logout', '--everywhere', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ signedOut: true, everywhere: true });
    expect(cell.graphql.at(-1)!.query).toContain('signOutEverywhere');
    expect([...cell.refresh.values()].every((r) => r.revoked)).toBe(true);
  });
  it('refuses the variables of a delegated agent on the profile of a human (its session kept)', async () => {
    const { h } = await signedIn();
    const { generateKeyPairSync } = await import('node:crypto');
    const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    Object.assign(h.io.env, { BREAKROCKS_OPERATOR_ID: 'eu-op', BREAKROCKS_AGENT_ID: 'ag', BREAKROCKS_AGENT_KEY: pem });
    expect(await h.run('whoami', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'PROFILE_HOLDS_HUMAN' } });
    expect(await h.run('login', '--json')).toBe(2);
    expect(JSON.parse(readFileSync(sessionFile(h), 'utf8'))).toMatchObject({ kind: 'human' });
  });
  it('signs in again on the same profile: the former session revoked', async () => {
    const { h, cell } = await signedIn();
    const { refreshToken } = JSON.parse(readFileSync(sessionFile(h), 'utf8'));
    expect(await h.run('login', '--email', 'carol@example.com', '--password-stdin')).toBe(0);
    expect(cell.refresh.get(refreshToken)!.revoked).toBe(true);
  });
});

describe('logout of an agent account', () => {
  it('forgets the session (the agents host has no sign-out) and refuses --everywhere', async () => {
    const h = harness();
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(h.dir, 'config', 'sessions'), { recursive: true });
    writeFileSync(join(h.dir, 'config', 'config.json'), JSON.stringify({ version: 1, current: 'default', profiles: { default: { env: 'dev', kind: 'agent', operatorId: 'eu-op', agentId: 'ag' } } }));
    writeFileSync(join(h.dir, 'config', 'sessions', 'default.json'), JSON.stringify({ kind: 'agent', token: 't', sessionId: 's', expiresAt: '2026-10-23T11:00:00.000Z', operatorId: 'eu-op', agentId: 'ag' }));
    expect(await h.run('logout', '--everywhere', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'SIGN_OUT_EVERYWHERE_HUMANS_ONLY', source: 'cli' } });
    expect(await h.run('logout', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ kind: 'agent', signedOut: true, revoked: false, note: expect.stringContaining('no sign-out') });
  });
});

describe('login --browser', () => {
  it('is not available yet: NOT_AVAILABLE_YET with the reason, nothing opened', async () => {
    const { h } = signedOut();
    let opened = 0;
    h.io.openUrl = async () => { opened++; return true; };
    expect(await h.run('--env', 'dev', 'login', '--browser', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'NOT_AVAILABLE_YET', source: 'cli', reason: expect.stringContaining('the API has no operation') } });
    expect(opened).toBe(0);
  });
  it('with an exchange: opens the page, receives the code from the web app, and signs in', async () => {
    const { h, cell } = signedOut();
    let seen: { code: string; username?: string; verifier: string } | undefined;
    const exchange: CodeExchange = {
      available: true,
      exchange: async (_ctx, input) => {
        seen = input;
        const exp = Math.floor(h.clock.now / 1000) + 3600;
        const accessToken = jwt({ sub: cell.userId, exp, origin_jti: 'browser' });
        cell.access.set(accessToken, exp * 1000);
        cell.refresh.set('refresh-browser', { revoked: false });
        return { accessToken, idToken: jwt({ sub: cell.userId, exp }), refreshToken: 'refresh-browser', expiresIn: 3600 };
      },
    };
    h.io.codeExchange = exchange;
    h.io.openUrl = async (address) => {
      const url = new URL(address);
      expect(url.origin).toBe('https://dev.break.rocks');
      expect(url.pathname).toBe('/cli/login');
      // What the page does once the person confirmed: the code to the CLI, by fetch, from its origin.
      const answer = await globalThis.fetch(`http://127.0.0.1:${url.searchParams.get('port')}/callback`, { method: 'POST', headers: { origin: 'https://dev.break.rocks', 'content-type': 'application/json' }, body: JSON.stringify({ state: url.searchParams.get('state'), code: 'code-of-the-web-app-0001', username: cell.userId, cell: 'eu' }) });
      expect(answer.status).toBe(204);
      return true;
    };
    expect(await h.run('--env', 'dev', 'login', '--browser', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ kind: 'human', accountId: cell.accountId, cell: 'eu' });
    expect(seen).toMatchObject({ code: 'code-of-the-web-app-0001', username: cell.userId, verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(h.errors.join('\n')).toContain('https://dev.break.rocks/cli/login?port=');
    expect(JSON.parse(readFileSync(sessionFile(h), 'utf8'))).toMatchObject({ refreshToken: 'refresh-browser' });
  });
});
