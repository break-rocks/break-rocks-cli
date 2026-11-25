// The new backend (native-sulfur) behind the backend switch: the switch itself (option, variable, profile), the device
// code and e-mail code sign-ins against a fake cell, the tokens kept in the keychain or a 0600 file and never printed,
// the renewal single-flight (in the process and across processes), the commands served there, the others refused.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeKeychain, harness, last } from './helpers.js';
import { Context, NO_FLAGS } from '../src/context.js';
import { saveSulfurSession, sulfurApi, readSulfurSession } from '../src/sulfur/session.js';

const BASE = 'https://sulfur.test';
const ACCOUNT = 'eu-0123456789abcdef';
const jwt = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"EdDSA"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

type Call = { path: string; body: Record<string, unknown>; headers: Record<string, string> };

function fakeCell(options: { pendingPolls?: number; slowDown?: boolean; refreshRefused?: boolean } = {}) {
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
          if (pending-- > 0) return json(400, { error: 'authorization_pending' });
          if (options.slowDown) { options.slowDown = false; return json(400, { error: 'slow_down' }); }
          return json(200, tokens('device'));
        }
        if (body.grant_type === 'authorization_code') return body.code === 'ac-1' && createHash('sha256').update(String(body.code_verifier)).digest('base64url') === state.codeChallenge ? json(200, tokens('untrusted')) : json(400, { error: 'invalid_grant' });
        if (body.grant_type === 'refresh_token') return options.refreshRefused || body.refresh_token !== `rt-${generation}-secret` ? json(400, { error: 'invalid_grant' }) : json(200, tokens('untrusted'));
        return json(400, { error: 'unsupported_grant_type' });
      }
      case '/oauth/revoke': return json(200, {});
      case '/auth/email/start': state.challenge = String(body.challenge); return json(200, { otpCell: 'eu', flowId: 'flow-1' });
      case '/auth/email/verify':
        return body.code === '12345678' && createHash('sha256').update(String(body.verifier)).digest('base64url') === state.challenge ? json(200, { ticket: 'pt-1', cell: 'eu' }) : json(400, { errors: [{ message: 'wrong code', extensions: { code: 'REFUSED', reason: 'CODE_INVALID' } }] });
      case '/auth/complete': state.codeChallenge = String(body.codeChallenge); return body.clientId === 'cli' ? json(200, { code: 'ac-1', created: false }) : json(400, {});
      case '/graphql': {
        const token = headers['x-authorization']?.replace(/^Bearer /, '') ?? '';
        const g = Number(JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString() || '{}').g);
        if (!refusedOnce || g !== generation) { refusedOnce = true; return json(401, { errors: [{ message: 'token refused', extensions: { code: 'UNAUTHENTICATED' } }] }); }
        const q = String(body.query);
        const v = (body.variables ?? {}) as Record<string, Record<string, string>>;
        if (q.includes('updateProfile')) { Object.assign(card, v.input); return json(200, { data: { updateProfile: card } }); }
        if (q.includes('publish')) { posts.unshift({ id: v.input.id, kind: 'post', author: { id: ACCOUNT, handle: 'ada', name: 'Ada', agent: false }, text: v.input.text, address: v.input.universe, state: 'live', counts: { likes: 0, replies: 0, reposts: 0 } }); return json(200, { data: { publish: { id: v.input.id, state: 'live' } } }); }
        if (q.includes('homeTimeline')) return json(200, { data: { homeTimeline: { items: posts, next: null } } });
        if (q.includes('endAllSessions')) return json(200, { data: { endAllSessions: true } });
        if (q.includes('me')) return json(200, { data: { me: { id: ACCOUNT, tier: 'free', card } } });
        return json(400, { errors: [{ message: 'unknown', extensions: { code: 'BAD_REQUEST' } }] });
      }
      default: return json(404, {});
    }
  }) as typeof globalThis.fetch;
  const state = { challenge: '', codeChallenge: '' };
  return { fetch, calls, card, paths: () => calls.map((c) => c.path), refuseNext: () => { refusedOnce = false; } };
}

function setup(options: Parameters<typeof fakeCell>[0] & { keychain?: boolean; interactive?: boolean; answers?: string[] } = {}) {
  const cell = fakeCell(options);
  const keychain = fakeKeychain(!!options.keychain);
  const h = harness({ fetch: cell.fetch, env: { BREAKROCKS_SULFUR_URL: BASE }, keychain, interactive: options.interactive, answers: options.answers });
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
    // A command not served there yet says so; offline ones work as ever.
    expect(await sulfur('universes', 'join', '%paris', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'NOT_ON_NEW_BACKEND', command: 'universes join' } });
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
    expect(keychain.entries.get('sulfur:default')).toMatch(/rt-1-secret/);
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

  it('refuses --browser and passwords there', async () => {
    const { h, sulfur } = setup();
    expect(await sulfur('login', '--browser', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'NOT_ON_NEW_BACKEND' } });
    expect(await sulfur('login', '--password-stdin', '--json')).toBe(2);
  });
});

async function signedIn(options: Parameters<typeof setup>[0] = {}) {
  const s = setup({ interactive: true, answers: ['12345678'], ...options });
  expect(await s.sulfur('--env', 'dev', 'login', '--email', 'ada@example.com', '--json')).toBe(0);
  s.cell.calls.length = 0;
  return s;
}

describe('the commands on the new backend', () => {
  it('profile show and set, publish, the timeline, sign-out', async () => {
    const { h, cell, metaFile, sulfur } = await signedIn();
    expect(await sulfur('me', 'profile', 'show', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ id: ACCOUNT, handle: 'ada', name: 'Ada' });
    expect(await sulfur('me', 'profile', 'set', '--name', 'Ada L.', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ name: 'Ada L.' });
    expect(cell.calls.at(-1)!.body).toMatchObject({ variables: { input: { name: 'Ada L.' } } });
    expect(await sulfur('me', 'profile', 'set', '--avatar', 'x', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'NOT_ON_NEW_BACKEND' } });
    expect(await sulfur('posts', 'create', 'Hello sulfur', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'ADDRESS_REQUIRED' } });
    expect(await sulfur('posts', 'create', 'Hello sulfur', '--in', 'paris', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ state: 'live', universe: '%paris', id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(await sulfur('posts', 'feed', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ items: [{ text: 'Hello sulfur', address: '%paris', author: { handle: 'ada' } }], next: null });
    expect(await sulfur('posts', 'feed')).toBe(0);
    expect(h.lines.at(-1)).toContain('Hello sulfur');
    expect(cell.calls.every((c) => c.path !== '/graphql' || /^Bearer /.test(c.headers['x-authorization']))).toBe(true);
    expect(await sulfur('logout', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ signedOut: true, revoked: true });
    expect(cell.calls.at(-1)).toMatchObject({ path: '/oauth/revoke', body: { client_id: 'cli', token: expect.stringMatching(/^rt-/) } });
    expect(existsSync(metaFile)).toBe(false);
    expect(await sulfur('whoami', '--json')).toBe(3);
  });

  it('renews an access token that ends, once for concurrent callers', async () => {
    const { h, cell } = await signedIn();
    h.clock.now += 15 * 60_000;
    const ctx = new Context(h.io, { ...NO_FLAGS, backend: 'sulfur' });
    await Promise.all([sulfurApi(ctx, '{ me { id } }'), sulfurApi(ctx, '{ me { id } }'), sulfurApi(ctx, '{ me { id } }')]);
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
