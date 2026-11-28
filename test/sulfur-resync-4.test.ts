// The server branch of the universe direction and the account layouts served on the new backend (native-sulfur, server
// cc3f09f9): the universe profile (first focus, strip, layouts), look layouts publish / copy / delete, the catalog without
// documents, the new Universe fields printed, and the rejoin delay told.
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

const LAYOUT = { universe: '%paris', name: 'agora', version: 1, platform: false, registryVersion: 3, document: null, deleted: false, starred: false, universeCount: 0 };

describe('the direction of a universe (setUniverseProfile)', () => {
  it('sends the first focus, the strip, the layouts as refs and the clears', async () => {
    const { h, sent } = cell((q) => (q.includes('setUniverseProfile') ? { setUniverseProfile: { name: 'paris', firstFocus: 'MAP', universeStrip: false } } : null));
    expect(await h.run('universes', 'profile', 'set', '%paris', '--first-focus', 'MAP', '--no-universe-strip', '--layout', '%root/agora', '--governance-layout', '%paris/vote', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ firstFocus: 'MAP', universeStrip: false });
    const input = Object.values(sent[0].variables).find((v) => typeof v === 'object' && v !== null) as Record<string, unknown>;
    expect(input).toMatchObject({ firstFocus: 'MAP', universeStrip: false, layoutRef: { universe: '%root', name: 'agora' }, governanceLayoutRef: { universe: '%paris', name: 'vote' } });
    expect(await h.run('universes', 'profile', 'set', '%paris', '--clear', 'FIRST_FOCUS', '--clear', 'GOVERNANCE_LAYOUT', '--json')).toBe(0);
    expect(JSON.stringify(sent.at(-1)!.variables)).toContain('"clear":["FIRST_FOCUS","GOVERNANCE_LAYOUT"]');
  });

  it('universes show prints the first focus, the strip, the governance layout, the URL and the join refusal', async () => {
    const universe = { name: 'paris', field: 'PLACES', fieldSuggested: false, residentCount: 12, memberCount: 12, firstFocus: 'MAP', universeStrip: true, url: 'https://break.rocks/%paris', governanceLayoutRef: { universe: '%paris', name: 'vote' }, joinRefusal: 'REJOIN_TOO_SOON', canJoinAt: '2026-12-05T00:00:00.000Z', pages: [] };
    const { h } = cell((q) => (q.includes('universe(') ? { universe } : q.includes('universeGovernance') ? { universeGovernance: null } : null));
    expect(await h.run('universes', 'show', '%paris')).toBe(0);
    const out = h.lines.join('\n');
    expect(out).toContain('paris  https://break.rocks/%paris');
    expect(out).toContain('first focus: MAP   universe strip: on');
    expect(out).toContain('join: REJOIN_TOO_SOON until 2026-12-05T00:00:00.000Z');
    expect(out).toContain('governance layout: %paris/vote');
  });

  it('a rejoin refused during the delay is told with its instant (REJOIN_WAIT)', async () => {
    const { h } = cell(() => Response.json({ errors: [{ message: '2026-12-05T00:00:00.000Z', extensions: { code: 'REFUSED', reason: 'REJOIN_WAIT' } }] }));
    expect(await h.run('universes', 'join', '%paris', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'REJOIN_WAIT', message: 'You left this universe recently: you can join it again from 2026-12-05T00:00:00.000Z' } });
  });
});

describe('the account layouts', () => {
  it('publish, copy and delete send their operations', async () => {
    const { h, sent } = cell((q) => (q.includes('publishLayout') ? { publishLayout: LAYOUT } : q.includes('copyLayout') ? { copyLayout: { layout: { ...LAYOUT, name: 'mon-agora' }, draft: null } } : q.includes('deleteLayout') ? { deleteLayout: { ...LAYOUT, deleted: true } } : { themeCatalog: { items: [], next: null } }));
    expect(await h.run('look', 'layouts', 'publish', JSON.stringify({ name: 'agora', canvases: [] }), '--in', '%paris', '--json')).toBe(0);
    expect(sent.some((s) => s.query.includes('publishLayout(universe:'))).toBe(true);
    expect(await h.run('look', 'layouts', 'copy', '%root/agora', '--as', 'mon-agora', '--target', '%paris', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ layout: { name: 'mon-agora' } });
    expect(Object.values(sent.find((s) => s.query.includes('copyLayout'))!.variables)).toEqual(expect.arrayContaining(['%root', 'agora', 'mon-agora', '%paris']));
    expect(await h.run('look', 'layouts', 'delete', '%paris/agora', '--yes', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ deleted: true });
  });

  it('the catalog is read without the layouts\' documents', async () => {
    const { h, sent } = cell((q) => (q.includes('layoutCatalog') ? { layoutCatalog: { items: [LAYOUT], next: null } } : { themeCatalog: { items: [], next: null } }));
    expect(await h.run('look', 'layouts', 'list', '--universe', '%paris', '--query', 'ago', '--json')).toBe(0);
    const q = sent.find((s) => s.query.includes('layoutCatalog'))!;
    expect(q.query).not.toMatch(/\bdocument\b/);
    expect(Object.values(q.variables)).toEqual(expect.arrayContaining(['%paris', 'ago']));
  });
});
