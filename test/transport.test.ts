import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { CliError } from '../src/errors.js';
import { agentsPost, agentsRefusal, graphql, retryAfterSeconds } from '../src/transport.js';
import { harness } from './helpers.js';

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
function scripted(...answers: (Response | Error)[]) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, seen };
}
const ctxOf = (fetch: typeof globalThis.fetch) => { const h = harness({ fetch }); return { h, ctx: new Context(h.io, NO_FLAGS) }; };
const error = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as CliError; } throw new Error('no error'); };

describe('the agents host', () => {
  it('tries a 429 again once, after the seconds of Retry-After', async () => {
    const { fetch, seen } = scripted(respond(429, {}, { 'retry-after': '3' }), respond(200, { ok: true }));
    const { h, ctx } = ctxOf(fetch);
    const answer = await agentsPost(ctx, 'https://agents.test/v1', '/operators/challenges', { operatorId: 'x' });
    expect(answer.status).toBe(200);
    expect(seen.length).toBe(2);
    expect(h.slept).toEqual([3000]);
  });
  it('gives up after a second 429: TOO_MANY_REQUESTS, exit 1', async () => {
    const { fetch } = scripted(respond(429, {}, { 'retry-after': '1' }), respond(429, {}));
    const { ctx } = ctxOf(fetch);
    const answer = await agentsPost(ctx, 'https://agents.test/v1', '/x', {});
    expect(agentsRefusal(answer)).toMatchObject({ code: 'TOO_MANY_REQUESTS', exit: 1 });
  });
  it('reads Retry-After as seconds or as a date', () => {
    expect(retryAfterSeconds(new Headers({ 'retry-after': '7' }), 0)).toBe(7);
    expect(retryAfterSeconds(new Headers({ 'retry-after': new Date(10_000).toUTCString() }), 0)).toBe(10);
    expect(retryAfterSeconds(new Headers(), 0)).toBe(1);
  });
  it('says the code of a refusal (exit 1), SESSION_EXPIRED as a session to open again (exit 3)', async () => {
    expect(agentsRefusal({ status: 409, json: { error: { code: 'PUBLIC_KEY_USED', message: 'm' } }, headers: new Headers() })).toMatchObject({ code: 'PUBLIC_KEY_USED', exit: 1, source: 'platform' });
    expect(agentsRefusal({ status: 401, json: { error: { code: 'SESSION_EXPIRED' } }, headers: new Headers() })).toMatchObject({ code: 'SESSION_EXPIRED', exit: 3 });
    expect(agentsRefusal({ status: 503, json: {}, headers: new Headers() })).toMatchObject({ code: 'SERVER_ERROR', exit: 3 });
  });
  it('says a network failure with exit 3', async () => {
    const { fetch } = scripted(new TypeError('fetch failed'));
    const { ctx } = ctxOf(fetch);
    expect(await error(agentsPost(ctx, 'https://agents.test/v1', '/x', {}))).toMatchObject({ code: 'NETWORK_ERROR', exit: 3 });
  });
});

describe('the GraphQL API', () => {
  it('sends the token as it is in Authorization', async () => {
    const { fetch, seen } = scripted(respond(200, { data: { me: { id: 'a' } } }));
    const { ctx } = ctxOf(fetch);
    expect(await graphql(ctx, 'https://api.test/graphql', 'tok', '{ me { id } }')).toEqual({ me: { id: 'a' } });
    expect((seen[0].init!.headers as Record<string, string>).authorization).toBe('tok');
  });
  it('refuses with the errorType of the contract and its errorInfo', async () => {
    const { fetch } = scripted(respond(200, { data: null, errors: [{ errorType: 'DELEGATED_AGENT_ALLOWANCE_REACHED', message: 'x', errorInfo: { allowance: 1 } }] }));
    const { ctx } = ctxOf(fetch);
    expect(await error(graphql(ctx, 'https://api.test/graphql', 't', 'q'))).toMatchObject({ code: 'DELEGATED_AGENT_ALLOWANCE_REACHED', exit: 1, details: { errorInfo: { allowance: 1 } } });
  });
  it('reads a 401 as Unauthorized', async () => {
    const { fetch } = scripted(respond(401, { errors: [{ errorType: 'UnauthorizedException' }] }));
    const { ctx } = ctxOf(fetch);
    expect(await error(graphql(ctx, 'https://api.test/graphql', 't', 'q'))).toMatchObject({ code: 'Unauthorized' });
  });
  it('tries RATE_LIMITED again once when retryAt is near', async () => {
    const { fetch, seen } = scripted(respond(200, { errors: [{ errorType: 'RATE_LIMITED', errorInfo: { limit: 'MINUTE', retryAt: '2026-10-23T10:00:05.000Z' } }] }), respond(200, { data: { ok: 1 } }));
    const { h, ctx } = ctxOf(fetch);
    expect(await graphql(ctx, 'https://api.test/graphql', 't', 'q')).toEqual({ ok: 1 });
    expect(seen.length).toBe(2);
    expect(h.slept).toEqual([5000]);
  });
  it('does not wait for a RATE_LIMITED far away', async () => {
    const { fetch } = scripted(respond(200, { errors: [{ errorType: 'RATE_LIMITED', errorInfo: { limit: 'HOUR', retryAt: '2026-10-23T11:00:00.000Z' } }] }));
    const { ctx } = ctxOf(fetch);
    expect(await error(graphql(ctx, 'https://api.test/graphql', 't', 'q'))).toMatchObject({ code: 'RATE_LIMITED', exit: 1 });
  });
});

describe('the addresses of the API', () => {
  const map = { version: 3, default: 'eu', cells: { eu: { region: 'eu-west-1', api: 'https://eu.api/graphql', agents: 'https://agents.eu' }, us: { region: 'us-east-1', api: 'https://us.api/graphql', agents: 'https://agents.us' } }, byCountry: { US: 'us' } };
  it('come from the cell map of the environment (kept 5 minutes): the cell of the profile, of the id, of the country, else the default', async () => {
    const { endpoints } = await import('../src/endpoints.js');
    const { fetch, seen } = scripted(respond(200, map), respond(200, map));
    const { h, ctx } = ctxOf(fetch);
    expect(await endpoints(ctx, { env: 'staging' })).toMatchObject({ cell: 'eu', api: 'https://eu.api/graphql', agents: 'https://agents.eu/v1' });
    expect(seen[0].url).toBe('https://apps.staging.break.rocks/config/cells.json');
    expect(await endpoints(ctx, { env: 'staging', operatorId: 'us-1234' })).toMatchObject({ cell: 'us', agents: 'https://agents.us/v1' });
    expect(await endpoints(ctx, { env: 'staging' }, 'us')).toMatchObject({ cell: 'us' });
    expect(await endpoints(ctx, { env: 'staging', cell: 'eu', operatorId: 'us-1' })).toMatchObject({ cell: 'eu' });
    expect(seen.length).toBe(1);
    h.clock.now += 301_000;
    await endpoints(ctx, { env: 'staging' });
    expect(seen.length).toBe(2);
    expect(await error(endpoints(ctx, { env: 'staging', cell: 'ap' }))).toMatchObject({ code: 'CELL_UNKNOWN' });
  });
  it('say NETWORK_ERROR (exit 3) when the CDN does not answer and no map is cached', async () => {
    const { endpoints } = await import('../src/endpoints.js');
    const { fetch } = scripted(new TypeError('offline'));
    const { ctx } = ctxOf(fetch);
    expect(await error(endpoints(ctx, { env: 'prod' }))).toMatchObject({ code: 'NETWORK_ERROR', exit: 3 });
  });
  it('are replaced by BREAKROCKS_API_URL and BREAKROCKS_AGENTS_URL', async () => {
    const { endpoints } = await import('../src/endpoints.js');
    const h = harness({ env: { BREAKROCKS_API_URL: 'https://sandbox/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.sandbox/v1/' } });
    expect(await endpoints(new Context(h.io, NO_FLAGS), { env: 'dev' })).toMatchObject({ api: 'https://sandbox/graphql', agents: 'https://agents.sandbox/v1' });
  });
});
