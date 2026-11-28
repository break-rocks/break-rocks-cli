// The network of the CLI on fetch alone (native-sulfur's transport: sulfur*.test.ts): a 429 tried again once after its
// Retry-After, a network failure said with exit 3.
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { CliError } from '../src/errors.js';
import { request, retryAfterSeconds } from '../src/transport.js';
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

describe('a request', () => {
  it('tries a 429 again once, after the seconds of Retry-After', async () => {
    const { fetch, seen } = scripted(respond(429, {}, { 'retry-after': '3' }), respond(200, { ok: true }));
    const { h, ctx } = ctxOf(fetch);
    const answer = await request(ctx, 'https://api.test/x', { method: 'POST', body: '{}' });
    expect(answer.status).toBe(200);
    expect(seen.length).toBe(2);
    expect(h.slept).toEqual([3000]);
  });
  it('gives the second 429 back, and does not wait beyond 60 seconds', async () => {
    const twice = scripted(respond(429, {}, { 'retry-after': '1' }), respond(429, {}));
    expect((await request(ctxOf(twice.fetch).ctx, 'https://api.test/x', { method: 'GET' })).status).toBe(429);
    const far = scripted(respond(429, {}, { 'retry-after': '120' }));
    const { h, ctx } = ctxOf(far.fetch);
    expect((await request(ctx, 'https://api.test/x', { method: 'GET' })).status).toBe(429);
    expect(h.slept).toEqual([]);
  });
  it('reads Retry-After as seconds or as a date', () => {
    expect(retryAfterSeconds(new Headers({ 'retry-after': '7' }), 0)).toBe(7);
    expect(retryAfterSeconds(new Headers({ 'retry-after': new Date(10_000).toUTCString() }), 0)).toBe(10);
    expect(retryAfterSeconds(new Headers(), 0)).toBe(1);
  });
  it('says a network failure with exit 3', async () => {
    const { fetch } = scripted(new TypeError('fetch failed'));
    const { ctx } = ctxOf(fetch);
    expect(await error(request(ctx, 'https://api.test/x', { method: 'GET' }))).toMatchObject({ code: 'NETWORK_ERROR', exit: 3 });
  });
});
