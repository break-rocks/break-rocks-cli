// The server's scalability audit of 2026-11-26 as the CLI sees it on the new backend (docs/talc-deviations.md, the "Client
// change" column): the refusals of the cells and the limits told for people, a message sent again with a new id when the
// platform dates it too far, the catch-up followed to its end, a post's media sent with its posting address.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { refusalText } from '../src/errors.js';
import { saveSulfurSession, type SulfurSession } from '../src/sulfur/session.js';
import { harness, last } from './helpers.js';

const HUMAN: SulfurSession = { backend: 'sulfur', env: 'dev', cell: 'eu', accountId: 'eu_a', handle: 'ada', kind: 'untrusted', method: 'email', signedInAt: '2026-10-23T10:00:00.000Z', accessExpiresAt: '2026-10-23T11:00:00.000Z', storage: 'file', access: 'at' } as SulfurSession;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

type Sent = { query: string; variables: Record<string, unknown> };

/** A cell answering GraphQL with [answer] (a Response, or the data), every request kept. */
function cell(answer: (query: string, variables: Record<string, any>, n: number) => unknown) {
  const sent: Sent[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname !== '/graphql') return new Response(null, { status: 204 });
    const body = JSON.parse(String(init?.body)) as Sent;
    sent.push(body);
    if (/^\{ me \{ id card/.test(body.query)) return Response.json({ data: { me: { id: 'eu_a', card: { handle: 'ada' } } } });
    const data = answer(body.query, body.variables, sent.length);
    return data instanceof Response ? data : Response.json({ data });
  }) as typeof globalThis.fetch;
  const h = harness({ fetch, env: { BREAKROCKS_SULFUR_URL: 'https://sulfur.test', BREAKROCKS_BACKEND: 'sulfur' } });
  const ctx = new Context(h.io, NO_FLAGS);
  ctx.saveProfile({ env: 'dev', kind: 'human' } as never);
  saveSulfurSession(ctx, HUMAN);
  return { h, sent };
}
const refused = (reason: string, code = 'REFUSED', errorInfo?: unknown, message = reason) => Response.json({ errors: [{ message, extensions: { code, reason, ...(errorInfo ? { errorInfo } : {}) } }] });

describe('the new refusals, told for people', () => {
  it('says what the cells, the limits and the closed provider mean', () => {
    expect(refusalText('ACCOUNT_IN_OTHER_CELL', 'x', { cell: 'us' })).toBe('This account is served from another region (cell us): it cannot be followed or blocked from yours yet');
    expect(refusalText('UNIVERSE_IN_OTHER_CELL', 'x', { cell: 'us' })).toContain('served from another region (cell us)');
    expect(refusalText('CROSS_CELL_NOT_SUPPORTED', 'x', { cell: 'us' })).toContain('two regions (cell us)');
    expect(refusalText('CROSS_CELL_NOT_SUPPORTED', 'x', undefined)).toBe('Not available yet: a conversation, a connection or a group invitation between accounts of two regions');
    expect(refusalText('FOLLOWING_LIMIT', 'x', { max: 10000 })).toBe('You follow the most accounts allowed (10000): unfollow an account to follow another');
    expect(refusalText('FOLLOWING_LIMIT', 'at most 10 playlists followed', undefined)).toBe('at most 10 playlists followed');
    expect(refusalText('AUDIENCE_QUOTA', 'at most 4 an hour', undefined)).toContain('as much as your audience allows');
    expect(refusalText('PROVIDER_NOT_AVAILABLE', 'x', undefined)).toContain('payments are closed');
    expect(refusalText('MESSAGE_ID_INVALID', 'x', undefined)).toContain('check the date and time');
    expect(refusalText('CURSOR_INVALID', 'x', undefined)).toContain('start again from the first page');
    expect(refusalText('CURSOR_INVALID', 'x', '{"cell":"eu"}')).toContain('start again');
  });

  it('keeps the code, the kind and the errorInfo in --json', async () => {
    const { h } = cell(() => refused('FOLLOWING_LIMIT', 'REFUSED', { max: 10000 }));
    expect(await h.run('accounts', 'follow', '@bob', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'FOLLOWING_LIMIT', source: 'platform', kind: 'REFUSED', errorInfo: { max: 10000 }, message: expect.stringContaining('unfollow an account') } });
    const posts = cell(() => refused('AUDIENCE_QUOTA', 'THROTTLED'));
    expect(await posts.h.run('posts', 'create', 'hello', '--in', '%root', '--json')).toBe(1);
    expect(last(posts.h)).toMatchObject({ error: { code: 'AUDIENCE_QUOTA', kind: 'THROTTLED' } });
  });
});

describe('a message refused MESSAGE_ID_INVALID', () => {
  it('is sent again once with an id of now', async () => {
    const { h, sent } = cell((q, _v, n) => (q.includes('sendMessage') ? (n === 1 ? refused('MESSAGE_ID_INVALID') : { sendMessage: { id: 'eu-1' } }) : {}));
    h.clock.now += 5 * 60_000;
    expect(await h.run('messages', 'direct', 'send', 'eu_b', 'hello', '--request-id', '01000000-0000-7000-8000-000000000000', '--json')).toBe(0);
    const sends = sent.filter((s) => s.query.includes('sendMessage'));
    expect(sends).toHaveLength(2);
    expect(sends[0].variables.requestId).toBe('01000000-0000-7000-8000-000000000000');
    const again = String(sends[1].variables.requestId);
    expect(again).not.toBe(sends[0].variables.requestId);
    expect(again).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(again.replace(/-/g, '').slice(0, 12), 16)).toBe(h.clock.now);
  });

  it('is refused (and told) when the new id is refused too, never sent a third time', async () => {
    const { h, sent } = cell((q) => (q.includes('sendMessage') ? refused('MESSAGE_ID_INVALID') : {}));
    expect(await h.run('messages', 'direct', 'send', 'eu_b', 'hello', '--json')).toBe(1);
    expect(sent.filter((s) => s.query.includes('sendMessage'))).toHaveLength(2);
    expect(last(h)).toMatchObject({ error: { code: 'MESSAGE_ID_INVALID', message: expect.stringContaining('check the date and time') } });
  });

  it('applies to a connection request and leaves other refusals alone', async () => {
    const asks = cell((q, _v, n) => (q.includes('requestConnection') ? (n === 1 ? refused('MESSAGE_ID_INVALID') : { requestConnection: { accountId: 'eu_b' } }) : {}));
    expect(await asks.h.run('connections', 'request', 'eu_b', 'Hello', '--json')).toBe(0);
    expect(asks.sent.filter((s) => s.query.includes('requestConnection'))).toHaveLength(2);
    const other = cell((q) => (q.includes('sendMessage') ? refused('NOT_CONNECTED') : {}));
    expect(await other.h.run('messages', 'direct', 'send', 'eu_b', 'hello', '--json')).toBe(1);
    expect(other.sent.filter((s) => s.query.includes('sendMessage'))).toHaveLength(1);
  });
});

describe('the catch-up (messageChanges)', () => {
  it('follows next to the end by default, each page from the cursor of the last', async () => {
    const pages: Record<string, unknown> = { '': { items: [{ id: 'eu-1' }], next: 'c1' }, c1: { items: [{ id: 'eu-2' }], next: 'c2' }, c2: { items: [{ id: 'eu-3' }], next: null } };
    const { h, sent } = cell((q, v) => (q.includes('messageChanges') ? { messageChanges: pages[String(v.after ?? '')] } : {}));
    expect(await h.run('messages', 'changes', '--group', 'eu_g1', '--since', '2026-10-23T09:00:00Z', '--json')).toBe(0);
    expect(last<{ items: { id: string }[]; next: string | null }>(h)).toMatchObject({ items: [{ id: 'eu-1' }, { id: 'eu-2' }, { id: 'eu-3' }], next: null });
    expect(sent.filter((s) => s.query.includes('messageChanges')).map((s) => s.variables.after ?? null)).toEqual([null, 'c1', 'c2']);
  });

  it('continues from --after, and stops at --max with the cursor to go on', async () => {
    const { h, sent } = cell((q, v) => (q.includes('messageChanges') ? { messageChanges: { items: [{ id: `eu-${String(v.after ?? 'first')}` }], next: `${String(v.after ?? 'c')}x` } } : {}));
    expect(await h.run('messages', 'changes', '--group', 'eu_g1', '--since', '2026-10-23T09:00:00Z', '--after', 'k', '--max', '2', '--json')).toBe(0);
    expect(last<{ items: unknown[]; next: string }>(h)).toMatchObject({ items: [{ id: 'eu-k' }, { id: 'eu-kx' }], next: 'kxx' });
    expect(sent.filter((s) => s.query.includes('messageChanges'))).toHaveLength(2);
  });
});

describe('a post\'s media on the new backend', () => {
  it('name the posting address: no universe lookup, the first post of a new universe carries its image', async () => {
    const { h, sent } = cell((q) => (q.includes('requestUpload') ? { requestUpload: { mediaId: 'eu_m1', uploadId: 'u1', form: { url: 'https://s3.test/form', fields: '{"key":"k"}' }, parts: null, expiresAt: '2026-10-23T11:00:00.000Z' } } : q.includes('myMedia') ? { myMedia: [{ id: 'eu_m1', state: 'ready', reason: null }] } : {}));
    const file = join(h.dir, 'a.png');
    writeFileSync(file, PNG);
    await h.run('posts', 'create', 'First', '--in', '%brandnew/sub', '--image', file, '--json');
    const upload = sent.find((s) => s.query.includes('requestUpload'))!;
    expect(upload.variables.i).toMatchObject({ kind: 'image', destination: 'post', address: '%brandnew/sub' });
    expect(upload.variables.i).not.toHaveProperty('scope');
    expect(sent.some((s) => /universe\(name/.test(s.query))).toBe(false);
    await h.run('posts', 'create', 'Bare', '--in', 'brandnew', '--image', file, '--json');
    expect(sent.filter((s) => s.query.includes('requestUpload')).pop()!.variables.i).toMatchObject({ address: '%brandnew' });
  });
});
