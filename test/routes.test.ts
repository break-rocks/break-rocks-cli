// Specs v92.1.0 to v101.4.0: routes (saved, copied, GPX, privacy zones, the routing) and the layers of the map of
// an area. Against a scripted API (no network).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zonesOf } from '../src/commands/routes.js';
import { last } from './helpers.js';
import { scripted } from './scripted.js';

const route = { id: 'rt1', name: 'canal-run', url: 'https://break.rocks/a/alice/w/canal-run', visibility: 'PRIVATE', universe: null, owner: { handle: 'alice' }, tags: ['running'], route: { mode: 'FOOT', metres: 4200, points: [{}, {}], snapped: true, loop: false, stages: null } };

describe('routes', () => {
  it('creates one from its points, changes it, copies it, deletes it only with yes', async () => {
    const { h, calls } = scripted({ saveMapRoute: route, copyMapRoute: { ...route, id: 'rt2', copiedFrom: route.url }, deleteMapRoute: true });
    expect(await h.run('routes', 'create', 'canal-run', '--mode', 'FOOT', '--points', '48.871,2.366;48.884,2.370', '--snap', '--tags', 'running')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'saveMapRoute', variables: { input: { name: 'canal-run', tags: ['running'], route: { mode: 'FOOT', snap: true, points: [{ lat: 48.871, lon: 2.366 }, { lat: 48.884, lon: 2.370 }] } } } });
    expect(calls[0].variables.input).not.toHaveProperty('id');
    expect(h.lines.at(-1)).toBe('rt1  canal-run  FOOT  4.2 km  PRIVATE  @alice  #running\npoints: 2, snapped to the streets and paths\nhttps://break.rocks/a/alice/w/canal-run');
    expect(await h.run('routes', 'create', 'x', '--mode', 'FOOT', '--points', '48.8', '--json')).toBe(2);
    expect(await h.run('routes', 'edit', 'rt1', 'canal-run', '--mode', 'BICYCLE', '--points', '[{"lat":1,"lon":2},{"lat":3,"lon":4}]')).toBe(0);
    expect(calls[1].variables.input).toMatchObject({ id: 'rt1', name: 'canal-run', route: { mode: 'BICYCLE', points: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] } });
    expect(await h.run('routes', 'copy', 'rt1', '--name', 'mine')).toBe(0);
    expect(calls[2].variables).toMatchObject({ id: 'rt1', name: 'mine' });
    expect(await h.run('routes', 'delete', 'rt1', '--json')).toBe(2);
    expect(await h.run('--yes', 'routes', 'delete', 'rt1')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'deleteMapRoute', variables: { id: 'rt1' } });
  });
  it('shows one by its id or by its URL, and lists them', async () => {
    const { h, calls } = scripted({ mapRoute: route, mapRouteByUrl: route, myMapRoutes: { items: [route], next: null } });
    expect(await h.run('routes', 'show', 'rt1', '--json')).toBe(0);
    expect(await h.run('routes', 'show', '/a/alice/w/canal-run', '--json')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['mapRoute', 'mapRouteByUrl']);
    expect(await h.run('routes', 'list')).toBe(0);
    expect(h.lines.at(-1)).toBe('rt1  canal-run  FOOT  4.2 km  PRIVATE  @alice  #running');
  });
  it('exports to GPX (a file, or the text) and imports a GPX file', async () => {
    const gpx = '<?xml version="1.0"?><gpx></gpx>';
    const { h, calls } = scripted({ mapRouteGpx: gpx, importGpxRoute: route });
    expect(await h.run('routes', 'gpx', 'export', 'rt1')).toBe(0);
    expect(h.lines.at(-1)).toBe(gpx);
    expect(await h.run('routes', 'gpx', 'export', 'rt1', '--out', 'run.gpx')).toBe(0);
    expect(readFileSync(join(h.io.cwd, 'run.gpx'), 'utf8')).toBe(gpx);
    expect(await h.run('routes', 'gpx', 'export', 'rt1', '--out', 'run.gpx', '--json')).toBe(2);
    expect(await h.run('routes', 'gpx', 'import', 'run.gpx', '--name', 'imported', '--mode', 'FOOT')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'importGpxRoute', variables: { gpx, name: 'imported', mode: 'FOOT' } });
    expect(await h.run('routes', 'gpx', 'import', 'none.gpx', '--name', 'x', '--mode', 'FOOT', '--json')).toBe(2);
    expect(existsSync(join(h.io.cwd, 'none.gpx'))).toBe(false);
  });
  it('reads and sets the privacy zones (200, 500 or 1,000 metres; "" none)', async () => {
    const zones = [{ point: { lat: 48.8566, lon: 2.3522 }, metres: 500 }];
    const { h, calls } = scripted({ myRoutePrivacyZones: zones, setRoutePrivacyZones: zones });
    expect(await h.run('routes', 'privacy-zones')).toBe(0);
    expect(h.lines.at(-1)).toBe('48.8566,2.3522  500 m');
    expect(await h.run('routes', 'privacy-zones', 'set', '--zones', '48.8566,2.3522,500')).toBe(0);
    expect(calls[1].variables.zones).toEqual(zones);
    expect(await h.run('routes', 'privacy-zones', 'set', '--zones', '')).toBe(0);
    expect(calls[2].variables.zones).toEqual([]);
    expect(() => zonesOf('48,2,300')).toThrow(/200\|500\|1000/);
  });
  it('plans a route without saving it', async () => {
    const { h, calls } = scripted({ route: { mode: 'FOOT', metres: 1500, seconds: 1080, snapped: true, line: [{}, {}, {}] } });
    expect(await h.run('routes', 'plan', '--mode', 'FOOT', '--points', '48.871,2.366;48.884,2.370', '--snap')).toBe(0);
    expect(calls[0].variables).toEqual({ mode: 'FOOT', points: [{ lat: 48.871, lon: 2.366 }, { lat: 48.884, lon: 2.370 }], snap: true });
    expect(h.lines.at(-1)).toBe('FOOT 1.5 km, 18 min, snapped, 3 points');
  });
});

describe('the layers of the map of an area', () => {
  it('reads the routes, the placed channels, the placed posts and the recent places of map cells of resolution 6', async () => {
    const { h, calls } = scripted({ mapRoutes: [route], mapChannels: [{ address: '%paris&canal', presentCount: 4, place: { name: 'Canal' }, lastMessage: { text: 'On my way' } }], mapPosts: [{ postId: 'p1', universe: '%paris', createdAt: '2026-11-08T10:00:00.000Z', place: { name: 'Canal', mapCell: '88x' } }], mapRecentPlaces: [{ mapCell: '881fb4677ffffff', pointOfInterest: false, lastPostAt: '2026-11-08T10:00:00.000Z' }] });
    const cells = '861fb4677ffffff';
    for (const layer of ['routes', 'channels', 'posts', 'places']) expect(await h.run('map', layer, '--cells', cells, '--universe', '%paris'), layer).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['mapRoutes', 'mapChannels', 'mapPosts', 'mapRecentPlaces']);
    for (const c of calls) expect(c.variables).toEqual({ parentMapCells: [cells], universe: '%paris' });
    expect(calls[2].query).not.toContain('videosOnly');
    expect(h.lines.slice(-3)).toEqual(['%paris&canal  Canal  present 4  "On my way"', 'p1  2026-11-08T10:00:00.000Z  %paris  Canal', '2026-11-08T10:00:00.000Z  881fb4677ffffff']);
    expect(await h.run('map', 'posts', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });
});
