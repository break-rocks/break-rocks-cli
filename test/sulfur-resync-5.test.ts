// The server branch of the posts, the events and the settings served on the new backend (native-sulfur, server 0c747737):
// the author role, the views and the moment of a post printed, a universe event with a drawn route, the support answers, the
// gesture tips and the app tour.
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { saveSulfurSession, type SulfurSession } from '../src/sulfur/session.js';
import { harness, last } from './helpers.js';

const BASE = 'https://sulfur.test';
const jwt = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"EdDSA"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const HUMAN: SulfurSession = { backend: 'sulfur', env: 'dev', cell: 'eu', accountId: 'eu_a', handle: 'ada', kind: 'untrusted', method: 'email', signedInAt: '2026-10-23T10:00:00.000Z', accessExpiresAt: '2099-10-23T11:00:00.000Z', storage: 'file', access: jwt({ sub: 'eu_a' }), refresh: 'rt' };

type Sent = { query: string; variables: Record<string, unknown> };

/** A cell answering GraphQL with [graphql] (a Response as is; null: an error); every request kept. */
function cell(graphql: (query: string, variables: Record<string, unknown>) => unknown) {
  const sent: Sent[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (new URL(String(input)).pathname !== '/graphql') return Response.json({}, { status: 404 });
    const entry = { query: String(body.query), variables: (body.variables ?? {}) as Record<string, unknown> };
    sent.push(entry);
    const data = graphql(entry.query, entry.variables);
    if (data instanceof Response) return data;
    return data === null ? Response.json({ errors: [{ message: 'unknown', extensions: { code: 'BAD_REQUEST' } }] }) : Response.json({ data });
  }) as typeof globalThis.fetch;
  const h = harness({ fetch, env: { BREAKROCKS_SULFUR_URL: BASE, BREAKROCKS_BACKEND: 'sulfur' } });
  const ctx = new Context(h.io, NO_FLAGS);
  ctx.saveProfile({ env: 'dev', kind: 'human' } as never);
  saveSulfurSession(ctx, HUMAN);
  return { h, sent };
}

const POST = { id: 'eu-p1', createdAt: '2026-11-28T10:00:00.000Z', kind: 'POST', display: 'Vote open', author: { handle: 'system', id: 'eu_s' }, universe: '%paris', url: 'u', images: [], replyCount: 0, likeCount: 0, repostCount: 0, tags: [] };

describe('the new Post fields', () => {
  it('posts list prints the author role, the views and the moment', async () => {
    const items = [{ ...POST, authorRole: 'LEADERSHIP', viewCount: 42 }, { ...POST, id: 'eu-p2', moment: 'VOTE_OPENED' }];
    const { h, sent } = cell((q) => (q.includes('posts(') ? { posts: { items, next: null } } : null));
    expect(await h.run('posts', 'list', '%paris')).toBe(0);
    for (const f of ['authorRole', 'viewCount', 'moment', 'projectOf', 'digestOf']) expect(sent[0].query).toContain(f);
    const out = h.lines.join('\n');
    expect(out).toContain('@system (leadership) in %paris, 2026-11-28T10:00:00.000Z  [eu-p1]  42 views');
    expect(out).toContain('[eu-p2]  moment: VOTE_OPENED');
  });
});

describe('a universe event with a drawn route', () => {
  it('events create --route-points sends input.route { mode, points }; refused beside --route-id or with one point', async () => {
    const { h, sent } = cell((q) => (q.includes('createUniverseEvent') ? { createUniverseEvent: { id: 'eu_e1', title: 'Walk', status: 'WAITING_SUPPORT', routeId: 'eu_r1' } } : null));
    expect(await h.run('events', 'create', '%paris', '--title', 'Walk', '--starts-at', '2026-12-01T10:00:00Z', '--minutes', '90', '--tags', 'walk', '--route-points', '48.87,2.36;48.88,2.37', '--route-mode', 'hike', '--json')).toBe(0);
    expect(JSON.stringify(sent[0].variables)).toContain('"route":{"mode":"HIKE","points":[{"lat":48.87,"lon":2.36},{"lat":48.88,"lon":2.37}]}');
    expect(await h.run('events', 'create', '%paris', '--title', 'Walk', '--starts-at', '2026-12-01T10:00:00Z', '--minutes', '90', '--tags', 'walk', '--route-points', '48.87,2.36', '--json')).toBe(2);
    expect(await h.run('events', 'create', '%paris', '--title', 'Walk', '--starts-at', '2026-12-01T10:00:00Z', '--minutes', '90', '--tags', 'walk', '--route-points', '48.87,2.36;48.88,2.37', '--route', '{"mode":"FOOT","points":[]}', '--json')).toBe(2);
    expect(sent.length).toBe(1);
  });

  it('events change --route-points draws the route anew (FOOT by default)', async () => {
    const { h, sent } = cell((q) => (q.includes('changeUniverseEvent') ? { changeUniverseEvent: { id: 'eu_e1', title: 'Walk', status: 'SCHEDULED' } } : null));
    expect(await h.run('events', 'change', 'eu_e1', '--route-points', '48.87,2.36;48.88,2.37', '--json')).toBe(0);
    expect(JSON.stringify(sent[0].variables)).toContain('"route":{"mode":"FOOT"');
  });
});

describe('the support answers', () => {
  it('events support answers the universe event; events relay support the relay', async () => {
    const { h } = cell((q) => (q.includes('supportUniverseEvent') ? { supportUniverseEvent: { id: 'eu_e1', title: 'Walk', startsAt: '2026-12-01T10:00:00.000Z', status: 'WAITING_SUPPORT', attendeeCount: 0 } } : q.includes('supportEventRelay') ? { supportEventRelay: { id: 'eu_rl1', status: 'PROPOSED' } } : null));
    expect(await h.run('events', 'support', 'eu_e1')).toBe(0);
    expect(h.lines.join('\n')).toContain('eu_e1  2026-12-01T10:00:00.000Z  Walk  WAITING_SUPPORT');
    expect(await h.run('events', 'relay', 'support', 'eu_rl1', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ id: 'eu_rl1', status: 'PROPOSED' });
  });
});

describe('the gesture tips and the app tour', () => {
  it('me tips reads mySettings.tips; me tour set writes setSettings.tour', async () => {
    const { h, sent } = cell((q) => (q.includes('tips') && !q.includes('mutation') ? { mySettings: { tips: { homeGestures: true, universeGestures: false, authorSwipe: false } } } : q.includes('setSettings') ? { setSettings: { tour: { state: 'NOT_STARTED', mode: 'LISTEN', autoAdvance: false, resumeCardClosed: false, newNavigationCardDismissed: false, gestures: [] } } } : null));
    expect(await h.run('me', 'tips')).toBe(0);
    expect(h.lines.join('\n')).toContain('the gestures of the home: shown');
    expect(await h.run('me', 'tour', 'set', '--mode', 'LISTEN', '--json')).toBe(0);
    expect(JSON.stringify(sent.at(-1)!.variables)).toContain('"mode":"LISTEN"');
  });
});
