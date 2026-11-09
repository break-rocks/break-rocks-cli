// The client headers (specs v101.20.0, D-323, contracts/app-versions.md § The client headers): every request of
// the CLI to the API carries x-breakrocks-client, x-breakrocks-app-version and the user agent, on every path.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { createServer } from '../src/mcp/server.js';
import { connect } from '../src/realtime.js';
import { agentsPost, apiRequest, clientHeaders, graphql, request } from '../src/transport.js';
import { VERSION } from '../src/version.js';
import { fakePayer, fakePlatform } from './fake-platform.js';
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
const isApi = (s: Seen) => /^https:\/\/(api|agents)\.test/.test(s.url);

describe('the client headers', () => {
  it('are the CLI, its version of package.json and the user agent breakrocks/<version>', () => {
    expect(VERSION).toBe(pkg.version);
    expect(clientHeaders()).toEqual(EXPECTED);
  });

  it('are sent on a GraphQL request, the retry after a 429 and the retry after RATE_LIMITED included', async () => {
    const { fetch, seen } = recorded(respond(429, {}, { 'retry-after': '1' }), respond(200, { errors: [{ errorType: 'RATE_LIMITED', errorInfo: { retryAt: '2026-10-23T10:00:02.000Z' } }] }), respond(200, { data: { ok: 1 } }));
    await graphql(ctxOf(fetch), 'https://api.test/graphql', 'tok', '{ ok }');
    expect(seen.length).toBe(3);
    for (const s of seen) expect(s.headers).toMatchObject({ ...EXPECTED, authorization: 'tok', 'content-type': 'application/json' });
  });

  it('are sent on a request to the agents host (REST /v1/...)', async () => {
    const { fetch, seen } = recorded(respond(200, { ok: true }));
    await agentsPost(ctxOf(fetch), 'https://agents.test/v1', '/operators/challenges', { operatorId: 'x' }, { authorization: 'Bearer t' });
    expect(seen[0].url).toBe('https://agents.test/v1/operators/challenges');
    expect(seen[0].headers).toMatchObject({ ...EXPECTED, authorization: 'Bearer t' });
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

  it('are sent on the handshake of the real-time connection', async () => {
    const sockets: { url: string; init: { protocols: string[]; headers: Record<string, string> } }[] = [];
    class FakeSocket {
      constructor(url: string, init: { protocols: string[]; headers: Record<string, string> }) { sockets.push({ url, init }); }
      addEventListener() { /* never opens: the test only reads the handshake */ }
      send() { /* nothing */ }
      close() { /* nothing */ }
    }
    const h = harness();
    h.io.WebSocket = FakeSocket as unknown as typeof WebSocket;
    void connect(new Context(h.io, NO_FLAGS), { realtimeUrl: 'wss://rt.test/event/realtime', httpUrl: 'https://ev.test/event', token: 't', channels: ['/users/a'], onEvent: () => {} }).catch(() => {});
    expect(sockets[0].init.protocols[0]).toBe('aws-appsync-event-ws');
    expect(sockets[0].init.headers).toEqual(EXPECTED);
  });

  it('reach every request of an operator journey, the registration and the first call after it included', async () => {
    const seen: Seen[] = [];
    const holder: { platform?: ReturnType<typeof fakePlatform> } = {};
    const wrap: typeof globalThis.fetch = (input, init) => { seen.push({ url: String(input), headers: lower(init?.headers) }); return holder.platform!.fetch(input, init); };
    const h = harness({ fetch: wrap, payer: fakePayer });
    holder.platform = fakePlatform({ now: () => h.clock.now });
    writeFileSync(join(h.dir, 'w.key'), '44'.repeat(32));
    await h.run('--env', 'dev', 'operator', 'keygen', '--json');
    await h.run('--env', 'dev', 'wallet', 'set', '--key', join(h.dir, 'w.key'), '--json');
    expect(await h.run('--env', 'dev', 'operator', 'register', '--country', 'FR', '--full-age', '--yes', '--json')).toBe(0);
    expect(await h.run('whoami', '--json')).toBe(0);
    const api = seen.filter(isApi);
    expect(api.some((s) => s.url.startsWith('https://agents.test'))).toBe(true);
    expect(api.some((s) => s.url.startsWith('https://api.test'))).toBe(true);
    for (const s of api) expect(s.headers, s.url).toMatchObject(EXPECTED);
  });

  it('reach the sign-in of a delegated agent and its calls through the MCP server', async () => {
    const seen: Seen[] = [];
    const holder: { platform?: ReturnType<typeof fakePlatform> } = {};
    const wrap: typeof globalThis.fetch = (input, init) => { seen.push({ url: String(input), headers: lower(init?.headers) }); return holder.platform!.fetch(input, init); };
    const op = harness({ fetch: wrap, payer: fakePayer });
    holder.platform = fakePlatform({ now: () => op.clock.now });
    writeFileSync(join(op.dir, 'w.key'), '44'.repeat(32));
    await op.run('--env', 'dev', 'operator', 'keygen', '--json');
    await op.run('--env', 'dev', 'wallet', 'set', '--key', join(op.dir, 'w.key'), '--json');
    await op.run('--env', 'dev', 'operator', 'register', '--country', 'FR', '--full-age', '--yes', '--json');
    const out = join(op.dir, 'a.pem');
    await op.run('agents', 'create', 'relay', '--out', out, '--json');
    const created = op.values[op.values.length - 1] as { agentId: string; operatorId: string };
    seen.length = 0;
    const agent = harness({ fetch: wrap, env: { BREAKROCKS_OPERATOR_ID: created.operatorId, BREAKROCKS_AGENT_ID: created.agentId, BREAKROCKS_AGENT_KEY: readFileSync(out, 'utf8') } });
    agent.clock.now = op.clock.now;
    const server = createServer(agent.io, { env: 'dev' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(b);
    await client.callTool({ name: 'breakrocks_agent_login', arguments: {} });
    const who = await client.callTool({ name: 'breakrocks_whoami', arguments: {} });
    expect(who.isError).toBeFalsy();
    const api = seen.filter(isApi);
    expect(api.some((s) => s.url.startsWith('https://agents.test'))).toBe(true);
    expect(api.some((s) => s.url.startsWith('https://api.test'))).toBe(true);
    for (const s of api) expect(s.headers, s.url).toMatchObject(EXPECTED);
  });
});
