// The talc operations the new backend (native-sulfur) serves otherwise and the CLI adapts (src/sulfur/talc.ts ADAPTERS):
// the e-mail change over the auth routes, the account deletion read back, a moderator's removal of a message, a page
// published from a studio draft, the clips of the account and of an address.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { saveSulfurSession, type SulfurSession } from '../src/sulfur/session.js';
import { harness, last } from './helpers.js';

const BASE = 'https://sulfur.test';
const jwt = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"EdDSA"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const HUMAN: SulfurSession = { backend: 'sulfur', env: 'dev', cell: 'eu', accountId: 'eu_a', handle: 'ada', kind: 'untrusted', method: 'email', signedInAt: '2026-10-23T10:00:00.000Z', accessExpiresAt: '2099-10-23T11:00:00.000Z', storage: 'file', access: jwt({ sub: 'eu_a' }), refresh: 'rt' };

type Sent = { path: string; query?: string; variables?: Record<string, unknown>; body?: Record<string, unknown> };

/** A cell answering GraphQL with [graphql] (null: an error) and the auth routes with [rest]; every request kept. */
function cell(graphql: (query: string, variables: Record<string, unknown>) => unknown, rest: (path: string, body: Record<string, unknown>) => [number, unknown] = () => [404, {}]) {
  const sent: Sent[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (url.pathname !== '/graphql') {
      sent.push({ path: url.pathname, body });
      const [status, value] = rest(url.pathname, body);
      return Response.json(value, { status });
    }
    sent.push({ path: url.pathname, query: String(body.query), variables: body.variables as Record<string, unknown> });
    const data = graphql(String(body.query), (body.variables ?? {}) as Record<string, unknown>);
    if (data instanceof Response) return data;
    return data === null ? Response.json({ errors: [{ message: 'unknown', extensions: { code: 'BAD_REQUEST' } }] }) : Response.json({ data });
  }) as typeof globalThis.fetch;
  const h = harness({ fetch, env: { BREAKROCKS_SULFUR_URL: BASE, BREAKROCKS_BACKEND: 'sulfur' } });
  const ctx = new Context(h.io, NO_FLAGS);
  ctx.saveProfile({ env: 'dev', kind: 'human' } as never);
  saveSulfurSession(ctx, HUMAN);
  return { h, sent, graphqls: () => sent.filter((s) => s.path === '/graphql') };
}

describe('the e-mail change (auth routes of the new backend)', () => {
  it('starts the change, then confirms it with the address started and the former address\'s code when asked', async () => {
    const { h, sent } = cell(() => null, (path) => (path === '/auth/email/change/start' ? [200, { confirmFormer: true }] : path === '/auth/email/change/verify' ? [200, { changed: true }] : [404, {}]));
    expect(await h.run('me', 'email', 'change', 'new@example.com', '--json')).toBe(0);
    expect(last(h)).toBe(true);
    expect(sent.at(-1)).toMatchObject({ path: '/auth/email/change/start', body: { newEmail: 'new@example.com' } });
    expect(await h.run('me', 'email', 'confirm', '12345678', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'FORMER_CODE_REQUIRED' } });
    expect(await h.run('me', 'email', 'confirm', '12345678', '--former-code', '87654321', '--json')).toBe(0);
    expect(sent.at(-1)).toMatchObject({ path: '/auth/email/change/verify', body: { newEmail: 'new@example.com', codeNew: '12345678', codeOld: '87654321' } });
    // Done: nothing started any more.
    expect(await h.run('me', 'email', 'confirm', '12345678', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'EMAIL_CHANGE_NOT_STARTED' } });
  });

  it('says the server\'s refusal (a sign-in not fresh)', async () => {
    const { h } = cell(() => null, () => [403, { errors: [{ message: 'sign in again', extensions: { code: 'REFUSED', reason: 'FRESH_SIGN_IN_REQUIRED' } }] }]);
    expect(await h.run('me', 'email', 'change', 'new@example.com', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'FRESH_SIGN_IN_REQUIRED' } });
  });
});

describe('the account deletion (no e-mailed token on the new backend)', () => {
  it('me delete confirm reads the deletion asked back; none asked: refused', async () => {
    let deletion: unknown = { requestedAt: '2026-11-27T10:00:00.000Z', effectiveAt: '2026-12-27T10:00:00.000Z' };
    const { h, graphqls } = cell((q) => (q.includes('deletion') ? { me: { deletion } } : null));
    expect(await h.run('me', 'delete', 'confirm', 'any-token', '--yes', '--json')).toBe(0);
    expect(last(h)).toEqual({ deletedAt: '2026-12-27T10:00:00.000Z', disappearsAt: null });
    expect(graphqls().some((s) => /mutation/.test(s.query ?? ''))).toBe(false);
    deletion = null;
    expect(await h.run('me', 'delete', 'confirm', 'any-token', '--yes', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'ACCOUNT_DELETION_NOT_REQUESTED' } });
  });
});

describe('a moderator removes a message (deleteMessage)', () => {
  it('names the discussion by its id (its address resolved) and the thread root when given', async () => {
    const { h, graphqls } = cell((q, v) => {
      if (q.includes('universeDiscussion(')) return { universeDiscussion: { id: 'eu_d1' } };
      if (q.includes('deleteMessage')) return { deleteMessage: { id: v.m } };
      return null;
    });
    expect(await h.run('discussions', 'remove-message', '%paris&general', 'eu_m1', '--article', '3', '--thread-root', 'eu_m0', '--yes', '--json')).toBe(0);
    expect(graphqls().at(-1)!.variables).toMatchObject({ d: { id: 'eu_d1' }, m: 'eu_m1', t: 'eu_m0' });
    expect(last(h)).toMatchObject({ id: 'eu_d1:eu_m1', kind: 'CHANNEL_MESSAGE_REMOVAL', articles: [3] });
  });
});

describe('a page published from a studio draft', () => {
  const page = { name: 'market', icon: 'basket', version: 2, canvases: { desktop: { columns: 12, items: [] } } };
  it('checks the version, saves the page as a draft, uses it, and deletes the draft', async () => {
    const { h, graphqls } = cell((q) => {
      if (q.includes('pageOfUniverse')) return { pageOfUniverse: { version: 2 } };
      if (q.includes('saveStudioDraft')) return { saveStudioDraft: { id: 'eu_draft1' } };
      if (q.includes('useStudioDraft')) return { useStudioDraft: { page: { universe: '%paris', kind: 'CUSTOM', name: 'market', icon: 'basket', order: 1, hidden: false, removed: false, version: 3, url: '/u/paris/market' } } };
      if (q.includes('deleteStudioDraft')) return { deleteStudioDraft: true };
      return null;
    });
    writeFileSync(join(h.dir, 'market.json'), JSON.stringify(page));
    expect(await h.run('universes', 'pages', 'publish', '%paris', '--file', 'market.json', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ name: 'market', version: 3 });
    const sent = graphqls();
    const saved = sent.find((s) => s.query?.includes('saveStudioDraft'))!;
    expect(saved.variables).toMatchObject({ u: '%paris' });
    expect(JSON.parse(String(saved.variables!.d))).toEqual({ name: 'market', icon: 'basket', canvases: page.canvases, format: 'break-rocks-page/1', blocks: [] });
    expect(sent.find((s) => s.query?.includes('useStudioDraft'))!.variables).toMatchObject({ id: 'eu_draft1' });
    expect(sent.at(-1)!.query).toContain('deleteStudioDraft');
  });

  it('refuses a file of another version than the page\'s last, before any draft', async () => {
    const { h, graphqls } = cell((q) => (q.includes('pageOfUniverse') ? { pageOfUniverse: { version: 4 } } : null));
    writeFileSync(join(h.dir, 'market.json'), JSON.stringify(page));
    expect(await h.run('universes', 'pages', 'publish', '%paris', '--file', 'market.json', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'PAGE_VERSION_CONFLICT' } });
    expect(graphqls().some((s) => s.query?.includes('saveStudioDraft'))).toBe(false);
  });
});

describe('the clips (clipFeed)', () => {
  it('the account\'s: For You\'s sequence, its items\' posts; an address\'s: its posts filtered CLIPS', async () => {
    const post = { id: 'eu_p1', kind: 'post', text: 'a clip', author: { id: 'eu_b', handle: 'bob' } };
    const { h, graphqls } = cell((q) => {
      if (q.includes('clipFeedSequence')) return { clipFeedSequence: { items: [{ post }], next: 'c2' } };
      if (q.includes('posts(')) return { posts: { items: [post], next: null } };
      return null;
    });
    expect(await h.run('posts', 'feed', '--clips', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ items: [{ id: 'eu_p1', text: 'a clip' }], next: 'c2' });
    expect(graphqls().at(-1)!.query).toContain('clipFeedSequence');
    expect(await h.run('posts', 'feed', '--clips', '--address', '%gaming', '--json')).toBe(0);
    expect(graphqls().at(-1)!.query).toMatch(/posts\(address: \$a, filter: CLIPS/);
    expect(graphqls().at(-1)!.variables).toMatchObject({ a: '%gaming' });
    expect(last(h)).toMatchObject({ items: [{ id: 'eu_p1' }] });
  });
});
