// The new backend (native-sulfur) behind the backend switch: the switch itself (option, variable, profile), the device
// code and e-mail code sign-ins against a fake cell, the tokens kept in the keychain or a 0600 file and never printed,
// the renewal single-flight (in the process and across processes), the commands served there, the others refused.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fakeKeychain, harness, last } from './helpers.js';
import { Context, NO_FLAGS } from '../src/context.js';
import { canOpenBrowser, loopbackServer } from '../src/sulfur/browser.js';
import { saveSulfurSession, sulfurApi, readSulfurSession } from '../src/sulfur/session.js';

const BASE = 'https://sulfur.test';
const AUTH_CODE = 'ac-1-0123456789abcdefghij';
const ACCOUNT = 'eu-0123456789abcdef';
const jwt = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"EdDSA"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

type Call = { path: string; body: Record<string, unknown>; headers: Record<string, string> };

function fakeCell(options: { pendingPolls?: number; slowDown?: boolean; denied?: boolean; refreshRefused?: boolean } = {}) {
  const calls: Call[] = [];
  let generation = 0;
  let pending = options.pendingPolls ?? 1;
  let refusedOnce = true;
  const card = { id: ACCOUNT, handle: 'ada', handleSince: '2026-11-01', name: 'Ada', bio: null as string | null, avatar: null, accountAt: '2026-11-01', agent: false, state: 'active' };
  const posts: Record<string, unknown>[] = [];
  const tokens = (kind: string, refresh = true) => {
    generation++;
    return { access_token: jwt({ sub: ACCOUNT, cel: 'eu', g: generation }), token_type: 'Bearer', expires_in: 900, scope: kind === 'device' ? 'content' : 'api', ...(refresh ? { refresh_token: `rt-${generation}-secret` } : {}), session_kind: kind };
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch: typeof globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const raw = String(init?.body ?? '');
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    // Origin access control: the payload hash of the exact bytes, or 403 as CloudFront answers.
    if (headers['x-amz-content-sha256'] !== createHash('sha256').update(raw).digest('hex')) return json(403, { message: 'The request signature we calculated does not match' });
    const body = headers['content-type']?.startsWith('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw || '{}');
    calls.push({ path: url.pathname, body, headers });
    switch (url.pathname) {
      case '/oauth/device_authorization':
        return json(200, { device_code: 'dc-secret', user_code: 'EU-BCDF-GHJK', verification_uri: 'https://dev.break.rocks/signin/device', expires_in: 600, interval: 5 });
      case '/oauth/token': {
        if (body.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
          if (options.denied) return json(400, { error: 'access_denied' });
          if (pending-- > 0) return json(400, { error: 'authorization_pending' });
          if (options.slowDown) { options.slowDown = false; return json(400, { error: 'slow_down' }); }
          return json(200, tokens('device'));
        }
        if (body.grant_type === 'authorization_code') return body.code === AUTH_CODE && (body.redirect_uri ?? '') === state.redirectUri && createHash('sha256').update(String(body.code_verifier)).digest('base64url') === state.codeChallenge ? json(200, tokens('untrusted')) : json(400, { error: 'invalid_grant' });
        if (body.grant_type === 'refresh_token') return options.refreshRefused || body.refresh_token !== `rt-${generation}-secret` ? json(400, { error: 'invalid_grant' }) : json(200, tokens('untrusted'));
        return json(400, { error: 'unsupported_grant_type' });
      }
      case '/oauth/revoke': return json(200, {});
      case '/auth/email/start': state.challenge = String(body.challenge); return json(200, { otpCell: 'eu', flowId: 'flow-1' });
      case '/auth/email/verify':
        return body.code === '12345678' && createHash('sha256').update(String(body.verifier)).digest('base64url') === state.challenge ? json(200, { ticket: 'pt-1', cell: 'eu' }) : json(400, { errors: [{ message: 'wrong code', extensions: { code: 'REFUSED', reason: 'CODE_INVALID' } }] });
      case '/auth/complete': state.codeChallenge = String(body.codeChallenge); return body.clientId === 'cli' ? json(200, { code: AUTH_CODE, created: false }) : json(400, {});
      case '/graphql': {
        const token = headers['x-authorization']?.replace(/^Bearer /, '') ?? '';
        const g = Number(JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString() || '{}').g);
        if (!refusedOnce || g !== generation) { refusedOnce = true; return json(401, { errors: [{ message: 'token refused', extensions: { code: 'UNAUTHENTICATED' } }] }); }
        const q = String(body.query);
        const v = (body.variables ?? {}) as Record<string, Record<string, string>>;
        if (q.includes('endAllSessions')) return json(200, { data: { endAllSessions: true } });
        if (/\{ me \{ id( tier)? card/.test(q)) return json(200, { data: { me: { id: ACCOUNT, tier: 'free', card } } });
        const talcAccount = () => ({ id: ACCOUNT, handle: card.handle, handleSince: card.handleSince, displayName: card.name ?? card.handle, bio: card.bio, kind: 'human', deleted: false, links: [], followerCount: 0, followingCount: 0, avatar: null });
        if (q.includes('updateProfile')) { Object.assign(card, v.input); return json(200, { data: { updateProfile: { id: ACCOUNT } } }); }
        if (q.includes('changeHandle')) { card.handle = String(v.h); return json(200, { data: { changeHandle: { handle: card.handle } } }); }
        if (q.includes('accounts(')) return json(200, { data: { accounts: [talcAccount()] } });
        if (q.includes('createPost')) { const post = { id: `eu_post${posts.length + 1}`, kind: 'post', author: { id: ACCOUNT, handle: card.handle, displayName: card.name }, text: v.text, universe: v.universe, address: v.universe, likeCount: 0, replyCount: 0, repostCount: 0, images: [] }; posts.unshift(post); return json(200, { data: { createPost: post } }); }
        if (q.includes('timeline(')) return json(200, { data: { timeline: { items: posts, next: null } } });
        return json(400, { errors: [{ message: 'unknown', extensions: { code: 'BAD_REQUEST' } }] });
      }
      default: return json(404, {});
    }
  }) as typeof globalThis.fetch;
  const state = { challenge: '', codeChallenge: '', redirectUri: '' };
  return { fetch, calls, card, state, paths: () => calls.map((c) => c.path), refuseNext: () => { refusedOnce = false; } };
}

function setup(options: Parameters<typeof fakeCell>[0] & { keychain?: boolean; interactive?: boolean; answers?: string[]; env?: Record<string, string> } = {}) {
  const cell = fakeCell(options);
  const keychain = fakeKeychain(!!options.keychain);
  const h = harness({ fetch: cell.fetch, env: { BREAKROCKS_SULFUR_URL: BASE, ...options.env }, keychain, interactive: options.interactive, answers: options.answers });
  const metaFile = join(h.dir, 'config', 'sessions', 'default.sulfur.json');
  return { h, cell, keychain, metaFile, sulfur: (...argv: string[]) => h.run('--backend', 'sulfur', ...argv) };
}

describe('the backend switch', () => {
  it('is the former backend by default; --backend, BREAKROCKS_BACKEND and the profile choose the new one', async () => {
    const { h, sulfur } = setup();
    expect(new Context(h.io, NO_FLAGS).backend()).toBe('legacy');
    expect(await h.run('config', 'set', 'backend', 'sulfur', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ backend: 'sulfur' });
    expect(new Context(h.io, NO_FLAGS).backend()).toBe('sulfur');
    expect(new Context({ ...h.io, env: { ...h.io.env, BREAKROCKS_BACKEND: 'legacy' } }, NO_FLAGS).backend()).toBe('legacy');
    expect(new Context(h.io, { ...NO_FLAGS, backend: 'legacy' }).backend()).toBe('legacy');
    expect(await h.run('config', 'unset', 'backend')).toBe(0);
    expect(new Context(h.io, NO_FLAGS).backend()).toBe('legacy');
    expect(await h.run('--backend', 'granite', 'whoami', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'BACKEND_INVALID' } });
    // A command of the former backend's own hosts says so; offline ones work as ever.
    expect(await sulfur('operator', 'login', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'NOT_ON_NEW_BACKEND', command: 'operator login' } });
    expect(await sulfur('version', '--json')).toBe(0);
    expect(await sulfur('whoami', '--json')).toBe(3);
    expect(last(h)).toMatchObject({ error: { code: 'SIGN_IN_REQUIRED' } });
  });
});

describe('sign-in on the new backend', () => {
  it('by a device code: the address and the code written, the poll slowed when told, the tokens in a 0600 file, never printed', async () => {
    const { h, cell, metaFile, sulfur } = setup({ pendingPolls: 2, slowDown: true });
    expect(await sulfur('--env', 'dev', 'login', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ backend: 'sulfur', env: 'dev', cell: 'eu', accountId: ACCOUNT, handle: 'ada', session: { kind: 'device', method: 'device', storage: 'file' } });
    expect(h.errors.join('\n')).toContain('https://dev.break.rocks/signin/device');
    expect(h.errors.join('\n')).toContain('EU-BCDF-GHJK');
    expect(cell.paths()).toEqual(['/oauth/device_authorization', '/oauth/token', '/oauth/token', '/oauth/token', '/oauth/token', '/graphql']);
    expect(cell.calls[0].body).toMatchObject({ client_id: 'cli' });
    expect(h.slept).toEqual([5000, 5000, 5000, 10000]);
    expect(h.all()).not.toMatch(/rt-\d|dc-secret|eyJ/);
    if (process.platform !== 'win32') expect(statSync(metaFile).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(metaFile, 'utf8'))).toMatchObject({ storage: 'file', secrets: { refresh: expect.stringMatching(/^rt-/) } });
    // The profile keeps its environment: the next commands need no --env.
    expect(await sulfur('whoami', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ backend: 'sulfur', env: 'dev', account: { id: ACCOUNT, handle: 'ada', tier: 'free' }, session: { kind: 'device' } });
  });

  it('by an e-mail code in two runs without a terminal, the tokens in the keychain', async () => {
    const { h, cell, keychain, metaFile, sulfur } = setup({ keychain: true });
    expect(await sulfur('--env', 'dev', 'login', '--email', 'ada@example.com', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ codeSent: true });
    expect(cell.calls[0].body).toMatchObject({ email: 'ada@example.com', intent: 'sign-in', challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(await sulfur('login', '--email', 'ada@example.com', '--code', '1234 5678', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ accountId: ACCOUNT, session: { kind: 'untrusted', method: 'email', storage: 'keychain' } });
    expect(cell.paths()).toEqual(['/auth/email/start', '/auth/email/verify', '/auth/complete', '/oauth/token', '/graphql']);
    expect(cell.calls[2].body).toMatchObject({ clientId: 'cli', ticket: 'pt-1' });
    expect(readFileSync(metaFile, 'utf8')).not.toMatch(/rt-|eyJ|secrets/);
    // The entry of this configuration folder (not the default one): personas in other folders never share it.
    const entry = [...keychain.entries.keys()].find((k) => k.startsWith('sulfur:default@'));
    expect(entry).toMatch(/^sulfur:default@[0-9a-f]{12}$/);
    expect(keychain.entries.get(entry!)).toMatch(/rt-1-secret/);
    expect(h.all()).not.toMatch(/rt-\d|eyJ/);
    // A code without a flow started: said.
    expect(await sulfur('login', '--email', 'bob@example.com', '--code', '12345678', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'NO_CODE_PENDING' } });
  });

  it('by an e-mail code asked in a terminal; a wrong code is the platform\'s refusal', async () => {
    const { h, sulfur } = setup({ interactive: true, answers: ['8765 4321'] });
    expect(await sulfur('--env', 'dev', 'login', '--email', 'ada@example.com', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'CODE_INVALID', source: 'platform' } });
    h.io.ask = async () => '12345678';
    expect(await sulfur('login', '--email', 'ada@example.com', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ handle: 'ada' });
  });

  it('refuses passwords there, and two modes at once', async () => {
    const { h, sulfur } = setup();
    expect(await sulfur('login', '--password-stdin', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'NO_PASSWORD' } });
    expect(await sulfur('login', '--browser', '--device', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'LOGIN_MODES_CONFLICT' } });
    expect(await sulfur('login', '--browser', '--email', 'a@example.com', '--json')).toBe(2);
  });

  it('a refusal on the other device ends the device poll: DEVICE_CODE_DENIED, exit 1, nothing saved', async () => {
    const { h, cell, metaFile, sulfur } = setup({ denied: true });
    expect(await sulfur('--env', 'dev', 'login', '--device', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'DEVICE_CODE_DENIED', source: 'platform' } });
    expect(cell.paths()).toEqual(['/oauth/device_authorization', '/oauth/token']);
    expect(existsSync(metaFile)).toBe(false);
  });
});

/** What the web page does: opens nothing, takes the address, then lets [visit] play the page's redirect to /cb. */
function browserSetup(options: Parameters<typeof setup>[0] = {}, visit: (page: URL, cell: ReturnType<typeof fakeCell>) => Promise<void>) {
  const s = setup(options);
  const pages: URL[] = [];
  s.h.io.openUrl = async (url) => {
    const page = new URL(url);
    pages.push(page);
    s.cell.state.codeChallenge = page.searchParams.get('challenge') ?? '';
    s.cell.state.redirectUri = `http://127.0.0.1:${page.searchParams.get('port')}/cb`;
    void visit(page, s.cell);
    return true;
  };
  return { ...s, pages };
}
const cb = (page: URL, query: Record<string, string>, path = '/cb') => fetch(`http://127.0.0.1:${page.searchParams.get('port')}${path}?${new URLSearchParams(query)}`);

describe('the browser sign-in on the new backend', () => {
  it('opens /cli/login with port, state and an S256 challenge, takes the code at /cb (state checked), exchanges it with the redirect URI', async () => {
    const answers: number[] = [];
    const { h, cell, pages, metaFile, sulfur } = browserSetup({ keychain: false }, async (page) => {
      const state = page.searchParams.get('state')!;
      answers.push((await cb(page, { code: AUTH_CODE, state: 'x'.repeat(43) })).status, (await cb(page, { code: AUTH_CODE, state }, '/callback')).status, (await cb(page, { code: 'short', state })).status);
      answers.push((await cb(page, { code: AUTH_CODE, state })).status);
    });
    expect(await sulfur('--env', 'dev', 'login', '--browser', '--json')).toBe(0);
    await vi.waitFor(() => expect(answers).toEqual([400, 404, 400, 200]));
    expect(pages).toHaveLength(1);
    expect(pages[0].origin + pages[0].pathname).toBe('https://dev.break.rocks/cli/login');
    const port = Number(pages[0].searchParams.get('port'));
    expect(port).toBeGreaterThan(1023);
    expect(pages[0].searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pages[0].searchParams.get('challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(last(h)).toMatchObject({ backend: 'sulfur', env: 'dev', accountId: ACCOUNT, handle: 'ada', session: { kind: 'untrusted', method: 'browser' } });
    expect(cell.paths()).toEqual(['/oauth/token', '/graphql']);
    expect(cell.calls[0].body).toMatchObject({ grant_type: 'authorization_code', client_id: 'cli', code: AUTH_CODE, redirect_uri: `http://127.0.0.1:${port}/cb` });
    expect(h.errors.join('\n')).toContain('https://dev.break.rocks/cli/login?port=');
    expect(h.all()).not.toMatch(/rt-\d|eyJ|ac-1/);
    expect(JSON.parse(readFileSync(metaFile, 'utf8'))).toMatchObject({ method: 'browser', storage: 'file' });
    // The loopback server is closed once the code is taken.
    await expect(fetch(`http://127.0.0.1:${port}/cb`)).rejects.toThrow();
    expect(await sulfur('whoami', '--json')).toBe(0);
  });

  it('a refusal in the browser (error=access_denied) is BROWSER_LOGIN_DENIED, exit 1, nothing exchanged', async () => {
    const { h, cell, sulfur } = browserSetup({}, async (page) => { await cb(page, { error: 'access_denied', state: page.searchParams.get('state')! }); });
    expect(await sulfur('--env', 'dev', 'login', '--browser', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'BROWSER_LOGIN_DENIED', source: 'platform' } });
    expect(cell.calls).toEqual([]);
  });

  it('a code the platform refuses is its refusal; --no-open writes the address only', async () => {
    const { h, cell, sulfur } = browserSetup({}, async () => undefined);
    h.io.openUrl = async () => { throw new Error('must not be opened'); };
    // No page ever calls /cb: play it here from the address written on stderr.
    const run = sulfur('--env', 'dev', 'login', '--browser', '--no-open', '--json');
    let url: URL | undefined;
    for (let n = 0; n < 200 && !url; n++) { await new Promise((r) => setTimeout(r, 10)); const m = /(https:\/\/dev\.break\.rocks\/cli\/login\?\S+)/.exec(h.errors.join('\n')); if (m) url = new URL(m[1]); }
    expect(url).toBeDefined();
    cell.state.codeChallenge = url!.searchParams.get('challenge')!;
    cell.state.redirectUri = `http://127.0.0.1:${url!.searchParams.get('port')}/cb`;
    await cb(url!, { code: 'ac-unknown-code-0000', state: url!.searchParams.get('state')! });
    expect(await run).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'invalid_grant', source: 'platform' } });
  });

  it('the default of login: the browser when one can be opened (BREAKROCKS_BROWSER), the device code otherwise, the choice forced by --device and BREAKROCKS_NO_BROWSER', async () => {
    const visit = async (page: URL) => { await cb(page, { code: AUTH_CODE, state: page.searchParams.get('state')! }); };
    const a = browserSetup({ env: { BREAKROCKS_BROWSER: '1' } }, visit);
    expect(await a.sulfur('--env', 'dev', 'login', '--json')).toBe(0);
    expect(last(a.h)).toMatchObject({ session: { method: 'browser' } });
    const b = browserSetup({ env: { BREAKROCKS_BROWSER: '1' } }, visit);
    expect(await b.sulfur('--env', 'dev', 'login', '--device', '--json')).toBe(0);
    expect(last(b.h)).toMatchObject({ session: { method: 'device' } });
    expect(b.pages).toHaveLength(0);
    const c = browserSetup({ env: { BREAKROCKS_NO_BROWSER: '1', BREAKROCKS_BROWSER: '1' }, interactive: true }, visit);
    expect(await c.sulfur('--env', 'dev', 'login', '--json')).toBe(0);
    expect(last(c.h)).toMatchObject({ session: { method: 'device' } });
    // No terminal and no variable: the device code (scripts, CI).
    const d = browserSetup({}, visit);
    expect(await d.sulfur('--env', 'dev', 'login', '--json')).toBe(0);
    expect(last(d.h)).toMatchObject({ session: { method: 'device' } });
  });

  it('canOpenBrowser: a terminal, no SSH, a display on Linux', () => {
    const ctx = (env: Record<string, string>, interactive = true) => new Context({ ...harness({ env, interactive }).io }, NO_FLAGS);
    expect(canOpenBrowser(ctx({}), 'darwin')).toBe(true);
    expect(canOpenBrowser(ctx({}), 'win32')).toBe(true);
    expect(canOpenBrowser(ctx({}, false), 'darwin')).toBe(false);
    expect(canOpenBrowser(ctx({ SSH_CONNECTION: '1.2.3.4 1 5.6.7.8 22' }), 'darwin')).toBe(false);
    expect(canOpenBrowser(ctx({ SSH_TTY: '/dev/pts/0' }), 'linux')).toBe(false);
    expect(canOpenBrowser(ctx({}), 'linux')).toBe(false);
    expect(canOpenBrowser(ctx({ DISPLAY: ':0' }), 'linux')).toBe(true);
    expect(canOpenBrowser(ctx({ WAYLAND_DISPLAY: 'wayland-0' }), 'linux')).toBe(true);
    expect(canOpenBrowser(ctx({ BREAKROCKS_NO_BROWSER: '1' }), 'darwin')).toBe(false);
    expect(canOpenBrowser(ctx({ BREAKROCKS_BROWSER: '1', SSH_TTY: 'x' }, false), 'linux')).toBe(true);
  });

  it('the wait is bounded: BROWSER_LOGIN_TIMEOUT (exit 3), and the port is released', async () => {
    const server = await loopbackServer({ state: 's'.repeat(43), timeoutMs: 40 });
    await expect(server.result).rejects.toMatchObject({ code: 'BROWSER_LOGIN_TIMEOUT', exit: 3 });
    await expect(fetch(`http://127.0.0.1:${server.port}/cb`)).rejects.toThrow();
  });
});

async function signedIn(options: Parameters<typeof setup>[0] = {}) {
  const s = setup({ interactive: true, answers: ['12345678'], ...options });
  expect(await s.sulfur('--env', 'dev', 'login', '--email', 'ada@example.com', '--json')).toBe(0);
  s.cell.calls.length = 0;
  return s;
}

describe('the commands on the new backend', () => {
  it('profile show and set, publish, the timeline (the talc operations through the seam), sign-out', async () => {
    const { h, cell, metaFile, sulfur } = await signedIn();
    expect(await sulfur('me', 'profile', 'show', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ id: ACCOUNT, handle: 'ada', displayName: 'Ada' });
    expect(cell.calls.at(-1)!.body).toMatchObject({ variables: { ids: [ACCOUNT] } });
    expect(await sulfur('me', 'profile', 'set', '--display-name', 'Ada L.', '--bio', 'Hi', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ displayName: 'Ada L.', bio: 'Hi' });
    expect(cell.calls.find((c) => String(c.body.query).includes('updateProfile'))!.body).toMatchObject({ variables: { input: { name: 'Ada L.', bio: 'Hi' } } });
    expect(await sulfur('me', 'profile', 'set', '--ai-description', 'x', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'NOT_ON_NEW_BACKEND' } });
    expect(await sulfur('posts', 'create', 'Hello sulfur', '--in', '%paris', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ id: 'eu_post1', universe: '%paris', text: 'Hello sulfur' });
    // createPost's talc arguments the server does not take, left empty: not sent.
    const sent = String(cell.calls.at(-1)!.body.query);
    expect(sent).toContain('createPost(');
    expect(sent).not.toMatch(/announcement|longVideo: \$longVideo, sources: \$sources\) \{.*\$announcement/);
    expect(await sulfur('posts', 'feed', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ items: [{ text: 'Hello sulfur', author: { handle: 'ada' } }], next: null });
    expect(cell.calls.every((c) => c.path !== '/graphql' || /^Bearer /.test(c.headers['x-authorization']))).toBe(true);
    expect(await sulfur('logout', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ signedOut: true, revoked: true });
    expect(cell.calls.at(-1)).toMatchObject({ path: '/oauth/revoke', body: { client_id: 'cli', token: expect.stringMatching(/^rt-/) } });
    expect(existsSync(metaFile)).toBe(false);
    expect(await sulfur('whoami', '--json')).toBe(3);
  });

  it('signs up headless: the code from the standard input or BREAKROCKS_EMAIL_CODE, the handle taken', async () => {
    const { h, cell, sulfur } = setup({ env: { BREAKROCKS_EMAIL_CODE: '1234 5678' } });
    expect(await sulfur('--env', 'dev', 'login', '--email', 'bot@example.com', '--sign-up', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ codeSent: true, email: 'bot@example.com' });
    expect(cell.calls[0].body).toMatchObject({ intent: 'sign-up' });
    expect(await sulfur('login', '--email', 'bot@example.com', '--handle', '@my_bot', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ accountId: ACCOUNT, handle: 'my_bot', session: { method: 'email' } });
    expect(cell.calls.some((c) => String(c.body.query).includes('changeHandle'))).toBe(true);
    const b = setup();
    b.h.io.readStdin = async () => '12345678\n';
    expect(await b.sulfur('--env', 'dev', 'login', '--email', 'bot@example.com', '--json')).toBe(0);
    expect(await b.sulfur('login', '--email', 'bot@example.com', '--code', '-', '--json')).toBe(0);
    expect(last(b.h)).toMatchObject({ accountId: ACCOUNT });
    expect(b.h.all()).not.toMatch(/rt-\d|eyJ/);
  });

  it('renews an access token that ends, once for concurrent callers', async () => {
    const { h, cell } = await signedIn();
    h.clock.now += 15 * 60_000;
    const ctx = new Context(h.io, { ...NO_FLAGS, backend: 'sulfur' });
    await Promise.all([sulfurApi(ctx, '{ me { id card { handle } } }'), sulfurApi(ctx, '{ me { id card { handle } } }'), sulfurApi(ctx, '{ me { id card { handle } } }')]);
    expect(cell.paths().filter((p) => p === '/oauth/token')).toHaveLength(1);
    expect(readSulfurSession(ctx)!.refresh).toBe('rt-2-secret');
  });

  it('waits for another process renewing, and takes its tokens', async () => {
    const { h, cell } = await signedIn();
    h.clock.now += 15 * 60_000;
    const ctx = new Context(h.io, { ...NO_FLAGS, backend: 'sulfur' });
    const lock = join(h.dir, 'config', 'sessions', 'default.sulfur.lock');
    mkdirSync(join(h.dir, 'config', 'sessions'), { recursive: true });
    writeFileSync(lock, '');
    const before = readSulfurSession(ctx)!;
    const sleep = h.io.sleep;
    h.io.sleep = async (ms) => {
      // The other process: its renewal saved, then its lock released.
      const renewed = { ...before, access: jwt({ sub: ACCOUNT, cel: 'eu', g: 99 }), accessExpiresAt: new Date(h.clock.now + 900_000).toISOString() };
      saveSulfurSession(ctx, renewed);
      const { rmSync } = await import('node:fs');
      rmSync(lock, { force: true });
      await sleep(ms);
    };
    const session = await (await import('../src/sulfur/session.js')).ensureSulfurSession(ctx);
    expect(session.access).not.toBe(before.access);
    expect(cell.paths()).not.toContain('/oauth/token');
  });

  it('renews once when the API refuses the token, and says to sign in again when the renewal is refused', async () => {
    const { h, cell, metaFile, sulfur } = await signedIn();
    cell.refuseNext();
    expect(await sulfur('whoami', '--json')).toBe(0);
    expect(cell.paths()).toEqual(['/graphql', '/oauth/token', '/graphql']);
    const again = await signedIn({ refreshRefused: true });
    again.h.clock.now += 15 * 60_000;
    expect(await again.sulfur('whoami', '--json')).toBe(3);
    expect(last(again.h)).toMatchObject({ error: { code: 'SESSION_EXPIRED' } });
    expect(existsSync(again.metaFile)).toBe(false);
    expect(metaFile).toBeTruthy();
    expect(h.all()).not.toMatch(/rt-\d/);
  });
});
