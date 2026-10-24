// The local server of login --browser (127.0.0.1 only): CORS for the origin of the web app on
// /callback only, the state checked, one code taken, the wait bounded; the page address and the
// S256 challenge of the verifier.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { callbackServer, loginPageUrl, loginSecrets } from '../src/browser-login.js';
import { realtimeUnavailable } from '../src/realtime.js';

const ORIGIN = 'https://dev.break.rocks';
const post = (port: number, body: unknown, origin = ORIGIN) => fetch(`http://127.0.0.1:${port}/callback`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('the local server of login --browser', () => {
  it('answers the preflight of the web app only, with the private network allowed', async () => {
    const server = await callbackServer({ origin: ORIGIN, state: 's'.repeat(43), timeoutMs: 5000 });
    try {
      const preflight = await fetch(`http://127.0.0.1:${server.port}/callback`, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' } });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');
      expect(preflight.headers.get('access-control-allow-methods')).toBe('POST');
      const other = await fetch(`http://127.0.0.1:${server.port}/callback`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
      expect(other.status).toBe(403);
      expect(other.headers.get('access-control-allow-origin')).toBeNull();
      expect((await fetch(`http://127.0.0.1:${server.port}/`, { headers: { origin: ORIGIN } })).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${server.port}/callback`, { method: 'PUT', headers: { origin: ORIGIN } })).status).toBe(405);
    } finally { server.close(); }
  });
  it('takes one code with the right state and stops listening; a wrong state is refused and the wait goes on', async () => {
    const { state } = loginSecrets();
    const server = await callbackServer({ origin: ORIGIN, state, timeoutMs: 5000 });
    expect((await post(server.port, { state: 'x'.repeat(43), code: 'c'.repeat(20) })).status).toBe(400);
    expect((await post(server.port, { state, code: 'short' })).status).toBe(400);
    expect((await post(server.port, { state, code: 'c'.repeat(20) }, 'https://evil.example')).status).toBe(403);
    const ok = await post(server.port, { state, code: 'c'.repeat(20), username: 'u-1', cell: 'eu' });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    await expect(server.result).resolves.toEqual({ code: 'c'.repeat(20), username: 'u-1', cell: 'eu' });
    await expect(post(server.port, { state, code: 'd'.repeat(20) })).rejects.toThrow();
  });
  it('takes the code by a navigation too, and sends the browser back to the page of the outcome', async () => {
    const { state } = loginSecrets();
    const server = await callbackServer({ origin: ORIGIN, state, timeoutMs: 5000 });
    const go = (query: Record<string, string>) => fetch(`http://127.0.0.1:${server.port}/callback?${new URLSearchParams(query)}`, { redirect: 'manual' });
    const wrong = await go({ state: 'x'.repeat(43), code: 'c'.repeat(20) });
    expect([wrong.status, wrong.headers.get('location')]).toEqual([303, 'https://dev.break.rocks/cli/login?outcome=refused']);
    const ok = await go({ state, code: 'c'.repeat(20), username: 'u-1', cell: 'eu' });
    expect([ok.status, ok.headers.get('location'), ok.headers.get('referrer-policy')]).toEqual([303, 'https://dev.break.rocks/cli/login?outcome=done', 'no-referrer']);
    await expect(server.result).resolves.toEqual({ code: 'c'.repeat(20), username: 'u-1', cell: 'eu' });
  });
  it('gives up after its time: BROWSER_LOGIN_TIMEOUT (exit 3)', async () => {
    const server = await callbackServer({ origin: ORIGIN, state: 's', timeoutMs: 50 });
    await expect(server.result).rejects.toMatchObject({ code: 'BROWSER_LOGIN_TIMEOUT', exit: 3 });
  });
  it('builds the page address with the port, the state and the S256 challenge of the verifier', () => {
    const { state, verifier, challenge } = loginSecrets();
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(loginPageUrl(ORIGIN, 49152, state, challenge)).toBe(`https://dev.break.rocks/cli/login?port=49152&state=${state}&challenge=${challenge}`);
  });
  it('lets a human use the real time (its id token)', () => {
    expect(realtimeUnavailable('auto', 'human', 'wss://x')).toBeUndefined();
  });
});
