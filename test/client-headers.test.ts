// The client headers (specs v101.20.0, D-323, contracts/app-versions.md § The client headers): every request of
// the CLI to the API carries x-breakrocks-client, x-breakrocks-app-version and the user agent, on every path.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { sulfurGraphql } from '../src/sulfur/http.js';
import { apiRequest, clientHeaders, request } from '../src/transport.js';
import { VERSION } from '../src/version.js';
import { harness } from './helpers.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const EXPECTED = { 'x-breakrocks-client': 'CLI', 'x-breakrocks-app-version': pkg.version, 'user-agent': `breakrocks/${pkg.version}` };

type Seen = { url: string; headers: Record<string, string> };
const lower = (h: unknown) => Object.fromEntries(Object.entries((h ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
const respond = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
function recorded(...answers: Response[]) {
  const seen: Seen[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => { seen.push({ url: String(url), headers: lower(init?.headers) }); return answers.shift() ?? respond(200, { data: {} }); };
  return { fetch, seen };
}
const ctxOf = (fetch: typeof globalThis.fetch) => { const h = harness({ fetch }); return new Context(h.io, NO_FLAGS); };

describe('the client headers', () => {
  it('are the CLI, its version of package.json and the user agent breakrocks/<version>', () => {
    expect(VERSION).toBe(pkg.version);
    expect(clientHeaders()).toEqual(EXPECTED);
  });

  it('are sent on a GraphQL request of native-sulfur, the retry after a 429 included', async () => {
    const { fetch, seen } = recorded(respond(429, {}, { 'retry-after': '1' }), respond(200, { data: { ok: 1 } }));
    await sulfurGraphql(ctxOf(fetch), 'https://api.test', 'tok', '{ ok }');
    expect(seen.length).toBe(2);
    for (const s of seen) expect(s.headers).toMatchObject({ ...EXPECTED, 'x-authorization': 'Bearer tok', 'content-type': 'application/json' });
  });

  it('let a caller override one (a header given wins), and stay off the other hosts (GitHub, npm)', async () => {
    const { fetch, seen } = recorded(respond(200, {}), respond(200, {}));
    const ctx = ctxOf(fetch);
    await apiRequest(ctx, 'https://api.test/graphql', { method: 'POST', headers: { 'user-agent': 'custom' } });
    await request(ctx, 'https://registry.npmjs.org/breakrocks/latest', { method: 'GET', headers: { accept: 'application/json' } });
    expect(seen[0].headers['user-agent']).toBe('custom');
    expect(seen[0].headers['x-breakrocks-client']).toBe('CLI');
    expect(seen[1].headers['x-breakrocks-client']).toBeUndefined();
    expect(seen[1].headers['x-breakrocks-app-version']).toBeUndefined();
  });
});
