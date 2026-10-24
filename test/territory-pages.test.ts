// The universe territory, the map, the pages of a universe and the governance page against a
// scripted API and a fake cartography (no network): the inputs of the contract sent, the shapes read
// from the catalogue, the refusals told plainly, the files read and written.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boundsOf, pointOf, radiusOf } from '../src/commands/geo.js';
import { pageOfDocument } from '../src/commands/pages.js';
import { Context, NO_FLAGS } from '../src/context.js';
import { tools } from '../src/mcp/server.js';
import { saveSession } from '../src/session.js';
import { harness, last } from './helpers.js';

type Call = { field: string; variables: Record<string, unknown>; query: string };
const PARIS = { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [] }, properties: { schema: 1, id: 'R7444', name: 'Paris', level: 8, kind: 'boundary:administrative', wikidata: 'Q90', bbox: [2.22, 48.81, 2.47, 48.9], cells: ['851fb463fffffff', '851fb467fffffff'], attribution: '© OpenStreetMap contributors' } };
const CATALOG = { schema: 1, boundaries: { version: '2026-10-24', url: 'https://map.test/boundaries/2026-10-24/{id}.geojson', count: 1 } };

/** A harness signed in as a delegated agent; the API answers by the first field of each request, the map host serves the catalogue and R7444. */
function scripted(handlers: Record<string, (v: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  const map: string[] = [];
  const h = harness({
    env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1', BREAKROCKS_MAP_URL: 'https://map.test' },
    fetch: async (url, init) => {
      const u = String(url);
      if (u.startsWith('https://map.test/')) {
        map.push(u);
        if (u === 'https://map.test/catalog.json') return Response.json(CATALOG);
        if (u.endsWith('/R7444.geojson')) return Response.json(PARIS);
        return new Response('not found', { status: 404 });
      }
      const { query, variables } = JSON.parse(String(init!.body));
      const field = /\{\s*(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      calls.push({ field, variables, query });
      try { return Response.json({ data: { [field]: handlers[field]?.(variables) ?? null } }); } catch (e) {
        const [code, limit] = (e as Error).message.split(':');
        return Response.json({ data: null, errors: [{ errorType: code, message: 'refused', ...(limit ? { errorInfo: { limit: Number(limit) } } : {}) }] });
      }
    },
  });
  saveSession(new Context(h.io, NO_FLAGS), { kind: 'agent', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op', agentId: 'ag' });
  return { h, calls, map };
}
const universe = (v: Record<string, unknown>) => ({ name: v.u ?? v.n, territory: v.t ? { id: (v.t as { boundaryId?: string }).boundaryId ?? null, name: 'x', kind: 'circle', center: null, radius: null } : null, pages: [], pagesVersion: 3, private: true, pinnedChannels: [] });
const page = { name: 'market', icon: 'basket', canvases: { desktop: { columns: 12, items: [] } } };
const served = (name = 'market') => ({ universe: '%x', kind: 'CUSTOM', name, icon: 'basket', order: 1, hidden: false, removed: false, version: 1, modifiedAt: '2026-10-24T10:00:00.000Z', url: `https://dev.break.rocks/u/x/p/${name}` });

describe('the forms of a universe territory', () => {
  it('read a radius in metres or kilometres, a point and the bounds of an area', () => {
    expect([radiusOf('150'), radiusOf('2.5km'), radiusOf('1 km'), radiusOf('KM25'), radiusOf('25000')]).toEqual(['M150', 'KM2_5', 'KM1', 'KM25', 'KM25']);
    expect(() => radiusOf('300')).toThrow(/150, 250, 500/);
    expect(pointOf('48.8566, 2.3522')).toEqual({ lat: 48.8566, lon: 2.3522 });
    expect(() => pointOf('91,2')).toThrow(/lat/);
    expect(boundsOf('48.81,2.22,48.90,2.47')).toEqual({ south: 48.81, west: 2.22, north: 48.9, east: 2.47 });
    expect(() => boundsOf('1,2,3')).toThrow(/south/);
  });
  it('take a page from a file: the page itself, or the page of a document /3', () => {
    expect(pageOfDocument(page)).toBe(page);
    expect(pageOfDocument({ format: 'break-rocks-layout/3', pages: [page] })).toBe(page);
    expect(pageOfDocument({ format: 'break-rocks-layout/3', pages: [page, { name: 'quiz' }] }, 'quiz')).toEqual({ name: 'quiz' });
    expect(() => pageOfDocument({ format: 'break-rocks-layout/3', pages: [page, { name: 'quiz' }] })).toThrow(/--name/);
    expect(() => pageOfDocument({ format: 'break-rocks-layout/1', pages: [page] })).toThrow(/break-rocks-layout\/3/);
  });
});

describe('universes territory', () => {
  it('sets a boundary by its id, its name and kind read from its shape', async () => {
    const { h, calls } = scripted({ setUniverseTerritory: universe });
    expect(await h.run('universes', 'territory', 'set', '%paris', '--boundary', 'R7444', '--json')).toBe(0);
    expect(calls[0].variables).toEqual({ u: '%paris', t: { boundaryId: 'R7444', name: 'Paris', kind: 'boundary:administrative' } });
    expect(last(h)).toMatchObject({ universe: '%paris', territory: { id: 'R7444' } });
  });
  it('sets a circle around a named place; refuses a circle without its radius or its name', async () => {
    const { h, calls } = scripted({ setUniverseTerritory: universe });
    expect(await h.run('universes', 'territory', 'set', '%marche', '--circle', '48.85,2.35', '--radius', '1km', '--name', 'Place du marché', '--json')).toBe(0);
    expect(calls[0].variables.t).toEqual({ center: { name: 'Place du marché', lat: 48.85, lon: 2.35 }, radius: 'KM1' });
    expect(await h.run('universes', 'territory', 'set', '%marche', '--circle', '48.85,2.35', '--radius', '1km', '--json')).toBe(2);
    expect(last<{ error: { code: string; message: string } }>(h).error.message).toContain('--name');
    expect(await h.run('universes', 'territory', 'set', '%marche', '--json')).toBe(2);
    expect(calls.length).toBe(1);
  });
  it('reads, removes and reports it', async () => {
    const { h, calls } = scripted({ universe: () => ({ name: '%paris', territory: { id: 'R7444', name: 'Paris', kind: 'boundary:administrative', center: null, radius: null } }), setUniverseTerritory: universe, reportUniverseTerritory: () => ({ id: 'r1', reason: 'MISLEADING' }) });
    expect(await h.run('universes', 'territory', 'get', '%paris')).toBe(0);
    expect(h.lines.join('\n')).toContain('boundary Paris [R7444]');
    expect(h.lines.join('\n')).toContain('breakrocks map boundary R7444');
    expect(await h.run('universes', 'territory', 'remove', '%paris', '--json')).toBe(0);
    expect(calls[1].query).toContain('remove: true');
    expect(await h.run('universes', 'territory', 'report', '%paris', '--reason', 'MISLEADING', '--json')).toBe(0);
    expect(calls[2].variables).toMatchObject({ universe: '%paris', reason: 'MISLEADING' });
    expect(await h.run('universes', 'territory', 'report', '%paris', '--reason', 'OFF_TOPIC', '--json')).toBe(2);
  });
  it('is proposed by proposals file --kind TERRITORY: a circle, or no territory', async () => {
    const { h, calls } = scripted({ fileProposal: (v) => ({ id: 'p1', kind: v.kind, title: v.title }) });
    expect(await h.run('proposals', 'file', '%marche', '--kind', 'TERRITORY', '--title', 'Le quartier', '--circle', '48.85,2.35', '--radius', '500', '--territory-name', 'Place', '--json')).toBe(0);
    expect(calls[0].variables).toMatchObject({ universe: '%marche', kind: 'TERRITORY', territory: { center: { name: 'Place', lat: 48.85, lon: 2.35 }, radius: 'M500' } });
    expect(calls[0].variables).not.toHaveProperty('removeTerritory');
    expect(await h.run('proposals', 'file', '%marche', '--kind', 'TERRITORY', '--title', 'Aucun', '--no-territory', '--json')).toBe(0);
    expect(calls[1].variables).toMatchObject({ removeTerritory: true });
    expect(calls[1].variables).not.toHaveProperty('territory');
    expect(await h.run('proposals', 'file', '%marche', '--kind', 'TERRITORY', '--title', 'x', '--boundary', 'R7444', '--no-territory', '--json')).toBe(2);
  });
});

describe('the map', () => {
  it('reads the shape of a boundary from the catalogue (kept an hour), its GeoJSON with --geojson, a 404 told plainly', async () => {
    const { h, map } = scripted({});
    expect(await h.run('map', 'boundary', 'R7444', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ id: 'R7444', name: 'Paris', level: 8, cells: ['851fb463fffffff', '851fb467fffffff'], version: '2026-10-24', url: 'https://map.test/boundaries/2026-10-24/R7444.geojson' });
    expect(await h.run('map', 'boundary', 'R7444', '--geojson', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ type: 'Feature', geometry: { type: 'MultiPolygon' } });
    expect(await h.run('map', 'boundary', 'R1', '--json')).toBe(1);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('BOUNDARY_SHAPE_NOT_FOUND');
    expect(map.filter((u) => u.endsWith('catalog.json')).length).toBe(1);
    expect(await h.run('map', 'boundary', '../x', '--json')).toBe(2);
  });
  it('lists the universes of an area by its map cells, or by the cells of a boundary', async () => {
    const { h, calls } = scripted({ universesInArea: () => ({ items: [{ universe: '%paris', count: 3, territory: { id: 'R7444', name: 'Paris', kind: 'boundary:administrative' } }], next: null }) });
    expect(await h.run('explore', 'area', '--boundary', 'R7444')).toBe(0);
    expect(calls[0].variables).toEqual({ c: ['851fb463fffffff', '851fb467fffffff'] });
    expect(h.lines.join('\n')).toContain('%paris  activity 3');
    expect(await h.run('explore', 'area', '--cells', '851FB463FFFFFFF', '--json')).toBe(0);
    expect(calls[1].variables).toEqual({ c: ['851fb463fffffff'] });
    expect(await h.run('explore', 'area', '--cells', '841fb46ffffffff', '--json')).toBe(2);
  });
  it('searches the places of an area with the universes that hold them', async () => {
    const { h, calls } = scripted({ places: () => [{ id: 'R7444', name: 'Paris', kind: 'boundary:administrative', point: { lat: 48.85, lon: 2.35 }, universes: ['%paris'] }] });
    expect(await h.run('places', 'search', 'Paris', '--bounds', '48.81,2.22,48.90,2.47', '--language', 'fr')).toBe(0);
    expect(calls[0].variables).toEqual({ q: 'Paris', b: { south: 48.81, west: 2.22, north: 48.9, east: 2.47 }, l: 'fr', n: null });
    expect(h.lines.join('\n')).toContain('universes: %paris');
  });
});

describe('universes pages', () => {
  it('publishes a page from a document /3, as JSON', async () => {
    const { h, calls } = scripted({ publishUniversePage: () => served() });
    writeFileSync(join(h.dir, 'pages.json'), JSON.stringify({ format: 'break-rocks-layout/3', pages: [page] }));
    expect(await h.run('universes', 'page', 'publish', '%x', '--file', 'pages.json', '--quiet')).toBe(0);
    expect(JSON.parse(calls[0].variables.p as string)).toEqual(page);
    expect(h.lines.at(-1)).toBe('market');
  });
  it('tells the refusals of a publication plainly, the code kept, the limit of the back office given', async () => {
    const conflict = scripted({ publishUniversePage: () => { throw new Error('PAGE_VERSION_CONFLICT'); } });
    writeFileSync(join(conflict.h.dir, 'p.json'), JSON.stringify(page));
    expect(await conflict.h.run('universes', 'page', 'publish', '%x', '--file', 'p.json', '--json')).toBe(1);
    expect(last<{ error: { code: string; message: string } }>(conflict.h).error).toMatchObject({ code: 'PAGE_VERSION_CONFLICT', message: expect.stringContaining('read it again') });
    const limit = scripted({ publishUniversePage: () => { throw new Error('CANVAS_ITEMS_LIMIT:40'); } });
    writeFileSync(join(limit.h.dir, 'p.json'), JSON.stringify(page));
    expect(await limit.h.run('universes', 'page', 'publish', '%x', '--file', 'p.json', '--json')).toBe(1);
    expect(last<{ error: { message: string; errorInfo: unknown } }>(limit.h).error).toMatchObject({ message: expect.stringContaining('at most 40'), errorInfo: { limit: 40 } });
  });
  it('checks a page with checkLayout, as a document /3 of that page; exit 1 with a refusal', async () => {
    const { h, calls } = scripted({ checkLayout: () => ({ document: null, refusals: [{ code: 'PAGE_HEADING_REQUIRED', path: 'pages[0]', widget: null, limit: null }] }) });
    writeFileSync(join(h.dir, 'p.json'), JSON.stringify(page));
    expect(await h.run('universes', 'page', 'check', '%x', '--file', 'p.json')).toBe(1);
    expect(JSON.parse(calls[0].variables.d as string)).toEqual({ format: 'break-rocks-layout/3', pages: [page] });
    expect(h.lines.join('\n')).toContain('PAGE_HEADING_REQUIRED at pages[0]');
  });
  it('lists the pages, reads one with its document, hides, moves and deletes (confirmed)', async () => {
    const { h, calls } = scripted({
      universe: () => ({ name: '%x', pagesVersion: 3, pages: [{ ...served('home'), kind: 'HOME', order: null, version: null }, served()] }),
      pageOfUniverse: () => ({ ...served(), document: JSON.stringify(page) }), setUniversePageHidden: () => ({ ...served('agenda'), kind: 'AGENDA', hidden: true }),
      moveUniversePage: () => [served()], deleteUniversePage: () => true,
    });
    expect(await h.run('universes', 'pages', '%x')).toBe(0);
    expect(h.lines.join('\n')).toContain('pages version 3');
    expect(await h.run('universes', 'page', 'get', '%x', 'market', '--document', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ name: 'market', document: page });
    expect(calls[1].query).toContain('document');
    expect(await h.run('universes', 'page', 'hide', '%x', 'agenda', '--json')).toBe(0);
    expect(calls[2].variables).toMatchObject({ universe: '%x', name: 'agenda', hidden: true });
    expect(await h.run('universes', 'page', 'show', '%x', 'agenda', '--json')).toBe(0);
    expect(calls[3].variables).toMatchObject({ hidden: false });
    expect(await h.run('universes', 'page', 'move', '%x', 'market', '--before', 'quiz', '--json')).toBe(0);
    expect(await h.run('universes', 'page', 'delete', '%x', 'market', '--json')).toBe(2);
    expect(await h.run('universes', 'page', 'delete', '%x', 'market', '--yes', '--json')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['universe', 'pageOfUniverse', 'setUniversePageHidden', 'setUniversePageHidden', 'moveUniversePage', 'deleteUniversePage']);
  });
  it('exports the pages to a file and imports them as studio drafts', async () => {
    const doc = { format: 'break-rocks-layout/3', universe: '%x', pages: [page] };
    const { h, calls } = scripted({ exportUniversePages: () => JSON.stringify(doc), importUniversePages: () => [{ id: 'd1', kind: 'PAGE', universe: '%x', savedAt: '2026-10-24T10:00:00.000Z' }] });
    expect(await h.run('universes', 'pages', 'export', '%x', '--out', 'out.json', '--json')).toBe(0);
    expect(JSON.parse(readFileSync(join(h.dir, 'out.json'), 'utf8'))).toEqual(doc);
    expect(await h.run('universes', 'pages', 'export', '%x', '--out', 'out.json', '--json')).toBe(2);
    expect(await h.run('universes', 'pages', 'import', '%x', '--file', 'out.json')).toBe(0);
    expect(JSON.parse(calls[1].variables.f as string)).toEqual(doc);
    expect(h.lines.join('\n')).toContain('breakrocks studio make-page');
  });
});

describe('the governance page', () => {
  it('pins channels in their order, unpins them all with --none; reads the layout of the governance page', async () => {
    const { h, calls } = scripted({ setPinnedChannels: (v) => ({ name: v.u, private: true, pinnedChannels: (v.c as string[]).map((address) => ({ address })) }), appliedLayout: () => ({ source: 'PLATFORM', retouched: false }) });
    expect(await h.run('governance', 'pin', '%team.', '%team.~general', '%team.~dev')).toBe(0);
    expect(calls[0].variables).toEqual({ u: '%team.', c: ['%team.~general', '%team.~dev'] });
    expect(h.lines.join('\n')).toContain('2. %team.~dev');
    expect(await h.run('governance', 'pin', '%team.', '--none', '--json')).toBe(0);
    expect(calls[1].variables).toEqual({ u: '%team.', c: [] });
    expect(await h.run('governance', 'pin', '%team.', '--json')).toBe(2);
    expect(await h.run('governance', 'layout', '%paris', '--json')).toBe(0);
    expect(calls[2].variables).toMatchObject({ universe: '%paris', page: 'GOVERNANCE' });
  });
  it('reads the proposals by status, the record, the duties of a universe', async () => {
    const { h, calls } = scripted({ proposals: () => ({ items: [], next: null }), governanceRecord: () => ({ items: [], next: null }), myJuryDuties: () => ({ items: [], next: null }) });
    expect(await h.run('governance', 'proposals', '%paris', '--status', 'WAITING_SUPPORT', '--kind', 'TERRITORY', '--json')).toBe(0);
    expect(calls[0].variables).toMatchObject({ universe: '%paris', status: 'WAITING_SUPPORT', kind: 'TERRITORY' });
    expect(await h.run('governance', 'record', '%paris', '--json')).toBe(0);
    expect(calls[1].query).toContain('statementOfReasons');
    expect(await h.run('governance', 'duties', '--universe', '%paris', '--json')).toBe(0);
    expect(calls[2].variables).toMatchObject({ universe: '%paris' });
  });
  it('gives each command its MCP tool', () => {
    const names = tools().map((t) => t.name);
    for (const n of ['universes_territory_get', 'universes_territory_set', 'universes_territory_remove', 'universes_territory_report', 'universes_pages', 'universes_page_get', 'universes_page_publish', 'universes_page_check', 'universes_page_hide', 'universes_page_show', 'universes_page_move', 'universes_page_delete', 'universes_pages_export', 'universes_pages_import', 'universes_page_report', 'studio_make_page', 'explore_area', 'places_search', 'map_boundary', 'governance_proposals', 'governance_record', 'governance_duties', 'governance_layout', 'governance_pinned', 'governance_pin']) expect(names).toContain(`breakrocks_${n}`);
    expect(tools().find((t) => t.name === 'breakrocks_universes_page_delete')!.inputSchema.properties).toHaveProperty('yes');
  });
});
