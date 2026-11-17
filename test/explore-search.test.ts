// Specs v128.0.0 (D-408 b): the explore filter (explore search), the random jump (explore random), the highlight of the
// day (explore today), the four figures and the surfaces of a route (routes show) and the nearby routes (routes nearby);
// the map cells of an area computed without a dependency (src/h3.ts); a backend before v128.0.0. Against a fake API.
import { describe, expect, it } from 'vitest';
import { bandOf, cellsAround, oneResolution, reasonsText, resolutionForRadius, routeFigures, whenOf } from '../src/commands/explore-map.js';
import { Context, NO_FLAGS } from '../src/context.js';
import { cellResolution, cellToParent, isCell, latLngToCell } from '../src/h3.js';
import { saveSession } from '../src/session.js';
import { harness, last } from './helpers.js';
import { scripted } from './scripted.js';

type Call = { field: string; variables: Record<string, unknown>; query: string };
/** A fake API and a fake cartography (catalog.json and the boundary shapes of [shapes]), every request kept. */
function fake(answers: Record<string, unknown>, shapes: Record<string, string[]> = {}, errors?: { message: string; errorType?: string }[]) {
  const calls: Call[] = [];
  const h = harness({
    env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1', BREAKROCKS_MAP_URL: 'https://map.test' },
    fetch: async (url, init) => {
      const u = String(url);
      if (u === 'https://map.test/catalog.json') return Response.json({ schema: 1, boundaries: { version: 'b1', url: 'https://map.test/boundaries/b1/{id}.geojson' } });
      const shape = /boundaries\/b1\/(\w+)\.geojson$/.exec(u)?.[1];
      if (shape) return shapes[shape] ? Response.json({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { id: shape, name: shape, level: 8, kind: 'boundary:administrative', bbox: [0, 0, 1, 1], cells: shapes[shape] } }) : new Response('not found', { status: 404 });
      const { query, variables } = JSON.parse(String(init!.body));
      const field = /\{\s*(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      calls.push({ field, query, variables });
      if (errors && field !== 'places' && field !== 'universe') return Response.json({ data: null, errors });
      const answer = answers[field];
      return Response.json({ data: { [field]: typeof answer === 'function' ? answer(variables) : answer ?? null } });
    },
  });
  saveSession(new Context(h.io, NO_FLAGS), { kind: 'agent', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op', agentId: 'ag' });
  return { h, calls };
}

const post = { kind: 'POST', point: { lat: 43.2951, lon: 5.3744 }, post: { id: 'p1', createdAt: '2026-11-17T18:00:00.000Z', text: 'Jazz on the quay tonight', universe: '%marseille', author: { handle: 'alice' } }, mapPost: null, place: null, event: null, route: null, universe: null, account: null, discussion: null, playlist: null, tag: null, reasons: [{ reason: 'IN_AREA', value: null }, { reason: 'WORD_IN_TEXT', value: 'jazz' }] };
const event = { ...post, kind: 'EVENT', post: null, event: { id: 'e1', title: 'Jazz night', universe: '%marseille', startsAt: '2026-11-17T20:00:00.000Z', eventType: 'concert' }, reasons: [{ reason: 'IN_TIME_WINDOW', value: null }, { reason: 'IN_AREA', value: null }, { reason: 'WORD_IN_NAME', value: 'jazz' }, { reason: 'CARRIES_TAG', value: '#jazz' }] };
const page = (over: Record<string, unknown> = {}) => ({ inArea: 2, everywhere: 812, items: [event, post], next: 'n2', density: [], nearest: null, postsStatus: 'READY', retryAfterSeconds: null, ...over });

describe('the map cells of an area (src/h3.ts, checked against h3-js)', () => {
  it('finds the cell of a point at each resolution, and its parents', () => {
    expect(latLngToCell(48.8566, 2.3522, 6)).toBe('861fb4667ffffff');
    expect(latLngToCell(43.2965, 5.3698, 9)).toBe('893968152bbffff');
    expect(latLngToCell(-33.8688, 151.2093, 0)).toBe('80bffffffffffff');
    expect(latLngToCell(64.7, 10.5, 3)).toBe('830800fffffffff');
    expect(latLngToCell(23.717925271222974, -67.13232636643566, 5)).toBe('854c0003fffffff'); // a pentagon
    expect(cellToParent('891fb466257ffff', 5)).toBe('851fb467fffffff');
    expect(cellResolution('861fb4667ffffff')).toBe(6);
    expect(isCell('861fb4667ffffff')).toBe(true);
    expect(isCell('nope')).toBe(false);
  });
  it('covers a point with 7 cells at most, a circle by its radius, a compacted shape with one resolution', () => {
    const around = cellsAround({ lat: 48.8566, lon: 2.3522 }, 6);
    expect(around[0]).toBe('861fb4667ffffff');
    expect(around.length).toBeGreaterThan(1);
    expect(around.length).toBeLessThanOrEqual(7);
    expect(new Set(around.map(cellResolution))).toEqual(new Set([6]));
    expect([150, 500, 1000, 2500, 25000].map(resolutionForRadius)).toEqual([9, 8, 8, 7, 4]);
    const mixed = ['841fb47ffffffff', '851fb463fffffff', '851fb467fffffff'];
    expect(oneResolution(mixed)).toEqual(['841fb47ffffffff', cellToParent('851fb463fffffff', 4)].filter((c, i, a) => a.indexOf(c) === i).sort());
    expect([0, 2, 3, 4, 5, 6, 7, 9].map(bandOf)).toEqual(['COUNTRY', 'COUNTRY', 'CITY', 'CITY', 'NEIGHBOURHOOD', 'NEIGHBOURHOOD', 'STREET', 'STREET']);
  });
});

describe('explore search', () => {
  it('reads the area of map cells with the time window and the kinds, and prints the counts and the reasons', async () => {
    const { h, calls } = fake({ exploreSearch: page() });
    expect(await h.run('explore', 'search', 'jazz', '--cells', '861FB4677ffffff,861fb4667ffffff', '--when', 'tonight', '--kinds', 'posts,events', '--families', 'music')).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].variables).toEqual({ f: { area: { mapCells: ['861fb4677ffffff', '861fb4667ffffff'], band: 'NEIGHBOURHOOD' }, query: 'jazz', when: 'TONIGHT', kinds: ['POSTS', 'EVENTS'], families: ['music'], mapFilter: null, scope: 'AREA', order: 'HIGHLIGHTS' }, a: null, l: null });
    expect(h.lines.at(-1)).toBe([
      'the map cells given · 2 map cells of resolution 6, neighbourhood · tonight',
      'In the area · 2   Everywhere · 500+',
      'EVENT       e1  Jazz night  %marseille  2026-11-17T20:00:00.000Z  43.2951,5.3744',
      '  why: in the time window · in the area · "jazz" in its name · carries #jazz',
      'POST        p1  @alice  %marseille  Jazz on the quay tonight  43.2951,5.3744',
      '  why: in the area · "jazz" in its text',
      'next: n2',
    ].join('\n'));
    expect(await h.run('--quiet', 'explore', 'search', 'jazz', '--cells', '861fb4677ffffff')).toBe(0);
    expect(h.lines.at(-1)).toBe('e1');
  });
  it('finds the area of a place by the places search: its boundary shape, else the cells around its point; never a position of the machine', async () => {
    const shape = ['851fb463fffffff', '851fb467fffffff'];
    const { h, calls } = fake({ places: (v: { q: string }) => (v.q === 'Paris' ? [{ id: 'R7444', name: 'Paris', kind: 'city', point: { lat: 48.8566, lon: 2.3522 } }] : v.q === 'Vieux-Port' ? [{ id: 'N1', name: 'Vieux-Port', kind: 'harbour', point: { lat: 43.2951, lon: 5.3744 } }] : []), exploreSearch: page({ inArea: 1, everywhere: 3 }) }, { R7444: shape });
    expect(await h.run('explore', 'search', 'jazz', '--near', 'Paris', '--json')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'places', variables: { q: 'Paris', b: { south: -90, west: -180, north: 90, east: 180 }, l: 'en' } });
    expect(calls[1].variables.f).toMatchObject({ area: { mapCells: shape, band: 'NEIGHBOURHOOD' }, scope: 'AREA' });
    expect(last(h)).toMatchObject({ inArea: 1, everywhere: 3, where: { from: 'place', name: 'Paris', id: 'R7444', resolution: 5 } });
    expect(await h.run('explore', 'search', 'jazz', '--near', 'Vieux-Port', '--language', 'fr')).toBe(0);
    const area = (calls[3].variables.f as { area: { mapCells: string[]; band: string } }).area;
    expect(area.band).toBe('NEIGHBOURHOOD');
    expect(area.mapCells).toEqual(cellsAround({ lat: 43.2951, lon: 5.3744 }, 6));
    expect(calls[2].variables.l).toBe('fr');
    expect(h.lines.at(-1)).toContain('near Vieux-Port [N1] · ');
    expect(await h.run('explore', 'search', 'jazz', '--near', 'Nowhere', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'PLACE_NOT_FOUND' } });
  });
  it('takes a universe as where: its territory as the area, an address before the words, its tags', async () => {
    const { h, calls } = fake({ universe: { name: '%paris', territory: { id: null, kind: 'circle', name: 'Place de la République', center: { lat: 48.8676, lon: 2.3631 }, radius: 'KM1' } }, exploreSearch: page() });
    expect(await h.run('explore', 'search', '%paris#market jazz', '--when', '90d')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'universe', variables: { n: '%paris' } });
    expect(calls[1].variables.f).toEqual({ area: { mapCells: cellsAround({ lat: 48.8676, lon: 2.3631 }, 8), band: 'STREET' }, query: 'jazz', when: 'DAYS', days: 90, mapFilter: '%paris#market', scope: 'AREA', order: 'HIGHLIGHTS' });
    expect(await h.run('explore', 'search', '%paris', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });
  it('reads everywhere without an area or with --everywhere, by relevance or by date; says "—" for the area without one', async () => {
    const { h, calls } = fake({ universe: { name: '%nowhere', territory: null }, exploreSearch: page({ items: [], next: null, everywhere: 41 }) });
    expect(await h.run('explore', 'search', 'velo')).toBe(0);
    expect(calls[0].variables.f).toEqual({ area: null, query: 'velo', mapFilter: null, scope: 'EVERYWHERE', order: 'RELEVANCE' });
    expect(h.lines.at(-1)).toBe('everywhere (no area: --near, --where or --cells) · no area\nIn the area · —   Everywhere · 41');
    expect(await h.run('explore', 'search', 'velo', '--cells', '861fb4677ffffff', '--everywhere', '--order', 'date')).toBe(0);
    expect(calls[1].variables.f).toMatchObject({ area: { mapCells: ['861fb4677ffffff'] }, scope: 'EVERYWHERE', order: 'DATE' });
    expect(await h.run('explore', 'search', 'velo', '--where', '%nowhere')).toBe(0);
    expect(calls[3].variables.f).toMatchObject({ area: null, mapFilter: '%nowhere', scope: 'EVERYWHERE' });
    expect(h.lines.at(-1)).toContain('%nowhere (no universe territory: everywhere)');
    expect(await h.run('explore', 'search', 'velo', '--cells', '861fb4677ffffff', '--order', 'date', '--json')).toBe(2);
    expect(await h.run('explore', 'search', 'velo', '--order', 'highlights', '--json')).toBe(2);
  });
  it('tells the nearest activity when the area holds nothing, and a search engine that starts', async () => {
    const { h } = fake({ exploreSearch: page({ inArea: 0, everywhere: 4, items: [], next: null, nearest: post, postsStatus: 'STARTING', retryAfterSeconds: 20 }) });
    expect(await h.run('explore', 'search', 'jazz', '--cells', '861fb4677ffffff')).toBe(0);
    expect(h.lines.at(-1)!.split('\n').slice(1)).toEqual(['In the area · 0   Everywhere · 4', 'posts: STARTING, read again in 20 s', 'Nothing in the area; the nearest: POST        p1  @alice  %marseille  Jazz on the quay tonight  43.2951,5.3744']);
  });
  it('refuses a bad area or time window before any request', async () => {
    const { h, calls } = fake({});
    for (const args of [['--cells', '861fb4677ffffff,851fb463fffffff'], ['--cells', '8a1fb4677ffffff'], ['--cells', 'x'], ['--when', '91d'], ['--when', 'soon'], ['--near', 'Paris', '--cells', '861fb4677ffffff'], ['--where', 'paris'], ['--kinds', 'people']]) {
      expect(await h.run('explore', 'search', 'jazz', ...args, '--json'), args.join(' ')).toBe(2);
    }
    expect(calls).toEqual([]);
    expect(whenOf('7d')).toEqual({ when: 'DAYS', days: 7 });
    expect(whenOf('weekend')).toEqual({ when: 'WEEKEND' });
    expect(reasonsText([{ reason: 'CROSSES_AREA' }, { reason: 'TERRITORY_IN_AREA' }, { reason: 'WORD_IN_SEARCH_WORDS', value: 'velo' }])).toBe('crosses the area · its territory meets the area · "velo" in its search words');
  });
  it('says clearly that a backend before v128.0.0 does not serve it, exit 1, no trace', async () => {
    for (const message of ["Validation error of type FieldUndefined: Field 'exploreSearch' in type 'Query' is undefined @ 'exploreSearch'", 'Validation error of type UnknownType: Unknown type ExploreFilterInput']) {
      const { h } = fake({}, {}, [{ message }]);
      expect(await h.run('explore', 'search', 'jazz', '--cells', '861fb4677ffffff')).toBe(1);
      expect(h.errors.join('\n')).toMatch(/OPERATION_NOT_SERVED.*This backend does not serve explore search yet/);
      expect(h.errors.join('\n')).not.toMatch(/\bat \w+ \(/);
    }
    const { h } = fake({}, {}, [{ message: "Validation error of type FieldUndefined: Field 'nearbyRoutes' in type 'Query' is undefined" }]);
    expect(await h.run('routes', 'nearby', 'rt1', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'OPERATION_NOT_SERVED', what: 'the nearby routes' } });
  });
  it('keeps the platform search of the search bar as breakrocks search', async () => {
    const { h, calls } = scripted({ search: { addresses: [], tags: [], accounts: [], universeResults: [], posts: [], postsStatus: 'OK', next: null } });
    expect(await h.run('search', 'velo paris')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'search', variables: { query: 'velo paris' } });
    expect(await h.run('schema', 'search', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ command: 'search', mcpTool: 'breakrocks_search', formerMcpTools: ['breakrocks_explore_search'] });
    expect(await h.run('schema', 'explore', 'search', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ command: 'explore search', mcpTool: 'breakrocks_explore_filter' });
  });
});

describe('explore random and explore today', () => {
  const activity = { mapCell: '883968152bfffff', name: 'Vieux-Port, Marseille', contents: 34, kinds: [{ kind: 'POSTS', count: 20 }, { kind: 'VIDEOS', count: 14 }] };
  it('jumps at random over the whole world or an area, never the one just jumped to', async () => {
    const { h, calls } = fake({ randomHighlight: (v: { e: string | null }) => (v.e === 'none-left' ? null : { result: { ...post, reasons: [] }, activity, candidates: 12 }) });
    expect(await h.run('explore', 'random')).toBe(0);
    expect(calls[0].variables).toEqual({ f: { area: null, query: null, mapFilter: null }, e: null });
    expect(h.lines.at(-1)).toBe(['everywhere (no area: --near, --where or --cells) · no area', 'POST        p1  @alice  %marseille  Jazz on the quay tonight  43.2951,5.3744', 'Vieux-Port, Marseille: 34 public contents in 7 days (posts 20, videos 14)', 'drawn among 12 very lively map cells; again: --except p1'].join('\n'));
    expect(await h.run('explore', 'random', '--cells', '861fb4677ffffff', '--kinds', 'videos', '--except', 'none-left')).toBe(0);
    expect(calls[1].variables).toEqual({ f: { area: { mapCells: ['861fb4677ffffff'], band: 'NEIGHBOURHOOD' }, query: null, kinds: ['VIDEOS'], mapFilter: null }, e: 'none-left' });
    expect(h.lines.at(-1)).toContain('(no very lively map cell here: nothing to jump to)');
  });
  it('reads the highlight of the day of a country, by default the country of the account', async () => {
    const { h, calls } = fake({ me: { own: { country: 'fr' } }, highlightOfTheDay: { result: { ...post, kind: 'VIDEO', reasons: [] }, computedAt: '2026-11-17T09:00:00.000Z' } });
    expect(await h.run('explore', 'today')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['me', 'highlightOfTheDay']);
    expect(calls[1].variables).toEqual({ c: 'FR' });
    expect(h.lines.at(-1)).toBe('The highlight of the day in FR\nVIDEO       p1  @alice  %marseille  Jazz on the quay tonight  43.2951,5.3744\ncomputed at 2026-11-17T09:00:00.000Z');
    expect(await h.run('explore', 'today', '--country', 'de', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ country: 'DE', computedAt: '2026-11-17T09:00:00.000Z' });
    const none = fake({ me: { own: { country: null } }, highlightOfTheDay: null });
    expect(await none.h.run('explore', 'today', '--json')).toBe(2);
    expect(await none.h.run('explore', 'today', '--country', 'FR')).toBe(0);
    expect(none.h.lines.at(-1)).toBe('(no highlight of the day in FR)');
  });
});

describe('the four figures of a route and the nearby routes', () => {
  const marker = { id: 'r2', name: 'Canal loop', mode: 'FOOT', metres: 4200, start: { lat: 48.87, lon: 2.36 }, end: null, tags: ['canal'], seconds: 3900, estimatedSeconds: null, ascent: 45, difficulty: 'EASY', surfaces: [{ surface: 'PAVED', metres: 3100 }, { surface: 'GRAVEL', metres: 1100 }] };
  it('shows the difficulty, the duration, the length, the elevation gain and the surfaces of a route', async () => {
    const route = { id: 'rt1', name: 'canal-run', url: 'https://break.rocks/a/alice/w/canal-run', visibility: 'PUBLIC', universe: null, owner: { handle: 'alice' }, tags: [], route: { mode: 'FOOT', metres: 12400, seconds: null, estimatedSeconds: 8928, ascent: 420, difficulty: 'MODERATE', surfaces: [], points: [{}, {}], snapped: false, loop: false, stages: null } };
    const { h, calls } = fake({ mapRouteByUrl: route });
    expect(await h.run('routes', 'show', '/a/alice/w/canal-run')).toBe(0);
    expect(calls[0].query).toContain('route { surfaces { surface metres } ');
    expect(h.lines.at(-1)!.split('\n')[1]).toBe('moderate  2 h 29 min (estimated)  12.4 km  +420 m');
    expect(routeFigures(marker)).toBe('easy  1 h 05 min  4.2 km  +45 m  paved 3.1 km, gravel 1.1 km');
  });
  it('lists the nearby routes of a route given by its id or its URL', async () => {
    const { h, calls } = fake({ mapRouteByUrl: { id: 'rt1' }, nearbyRoutes: [marker] });
    expect(await h.run('routes', 'nearby', 'https://break.rocks/a/alice/w/canal-run')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['mapRouteByUrl', 'nearbyRoutes']);
    expect(calls[1].variables).toEqual({ r: 'rt1' });
    expect(h.lines.at(-1)).toBe('r2  Canal loop  FOOT  easy  1 h 05 min  4.2 km  +45 m  paved 3.1 km, gravel 1.1 km  #canal');
    expect(await h.run('routes', 'nearby', 'rt1')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'nearbyRoutes', variables: { r: 'rt1' } });
    const empty = fake({ nearbyRoutes: [] });
    expect(await empty.h.run('routes', 'nearby', 'rt9')).toBe(0);
    expect(empty.h.lines.at(-1)).toBe('(no nearby route)');
  });
});
