// Routes (specs v92.1.0, routes.feature): the routes of the account and the universe routes, saved, copied
// ("Do this route"), exported to and imported from GPX, the privacy zones that hide their parts near home; the
// routing of the cartography (route: snapped to the streets and paths on request; ROUTE_NO_WAY, ROUTE_TOO_LONG
// since v101.4.0); and the layers of the map of an area (map cells of resolution 6, 4 at most): the routes,
// the placed channels, the placed posts and the places with a recent post. The writes offer --dry-run.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiCommand } from '../api/command.js';
import { selection } from '../api/graphql.js';
import { usageError } from '../errors.js';
import type { Command } from '../registry.js';
import { bool, object, str } from '../schema.js';
import { api } from '../session.js';
import { cellsProperty, doneText, listText, pageText, pointOf, pointsOf } from './shared.js';

type MapRoute = { id: string; name: string; url?: string; universe?: string | null; visibility?: string; tags?: string[]; owner?: { handle?: string } | null; copiedFrom?: string | null; route?: { mode?: string; metres?: number | null; seconds?: number | null; points?: unknown[]; snapped?: boolean; loop?: boolean; stages?: unknown[] | null } };
const km = (m?: number | null) => (m == null ? '-' : `${(m / 1000).toFixed(1)} km`);
const routeLine = (r: MapRoute) => `${r.id}  ${r.name}  ${r.route?.mode ?? ''}  ${km(r.route?.metres)}  ${r.visibility ?? ''}  ${r.universe ?? (r.owner?.handle ? `@${r.owner.handle}` : '')}${r.tags?.length ? `  #${r.tags.join(' #')}` : ''}${r.copiedFrom ? `  (copy of ${r.copiedFrom})` : ''}`;
const routeText = (r: unknown) => {
  const x = r as MapRoute | null;
  if (!x) return '(none)';
  return [routeLine(x), `points: ${x.route?.points?.length ?? 0}${x.route?.stages?.length ? `, stages: ${x.route.stages.length}` : ''}${x.route?.snapped ? ', snapped to the streets and paths' : ', as drawn'}${x.route?.loop ? ', a loop' : ''}`, ...(x.url ? [x.url] : [])].join('\n');
};
const ROUTE = selection('MapRoute', 2);

export const routesList = apiCommand({
  name: 'routes list', summary: 'The routes of the account, the most recent first (myMapRoutes)', kind: 'query', op: 'myMapRoutes', select: `{ items ${ROUTE} next }`, text: pageText(routeLine),
  examples: ['breakrocks routes list', 'breakrocks routes list --all --json'],
});
export const routesShow: Command<{ route: string }, unknown> = {
  name: 'routes show', summary: 'A route by its id or its URL (/a/alice/w/canal-run), as the account may read it: the parts within the privacy zones of its author left out (mapRoute, mapRouteByUrl)',
  examples: ['breakrocks routes show <route id>', 'breakrocks routes show /a/alice/w/canal-run --json'],
  input: object({ route: str('The route: its id, or its URL (/a/alice/w/canal-run, https://…)') }, ['route']), output: { description: 'The route (MapRoute)' }, args: { positionals: ['route'] },
  run: async (ctx, { route }) => {
    const byUrl = route.startsWith('/') || /^https?:\/\//.test(route);
    const data = await api<Record<string, unknown>>(ctx, byUrl ? `query($v: String!) { mapRouteByUrl(url: $v) ${ROUTE} }` : `query($v: ID!) { mapRoute(id: $v) ${ROUTE} }`, { v: route });
    return data[byUrl ? 'mapRouteByUrl' : 'mapRoute'] ?? null;
  },
  text: routeText, quiet: (r) => (r as { id?: string } | null)?.id,
};

const routeFields = {
  name: 'The name of the route (unique among one\'s routes)', mode: 'FOOT or BICYCLE', universe: 'A universe route of this universe (by its leadership)', visibility: 'PUBLIC, UNLISTED or PRIVATE', tags: 'Its free tags',
  snap: 'Snap it to the streets and paths (the routing of the cartography)', loop: 'A loop', handDrawn: 'Drawn by hand (1,000 points at most)', stages: 'Its stages: [{ "index", "name" }] (JSON)', meetingPoint: 'Its meeting point: { "name", "point": { "lat", "lon" } } (JSON)',
  line: 'The line drawn: [{ "lat", "lon" }] (JSON)', id: 'The route changed',
};
const pointsProp = { points: str('Its points: "<lat>,<lon>;<lat>,<lon>…" (2 to 100 placed point by point), or their JSON') };
const saveRoute = (edit: boolean) => apiCommand({
  name: `routes ${edit ? 'edit' : 'create'}`, summary: edit ? 'Change a route of one\'s own or of one\'s universe: its whole content (saveMapRoute)' : 'Save a new route: its points, its mode, snapped or as drawn, its stages and tags (saveMapRoute)',
  description: 'ROUTE_INVALID: 2 to 100 points placed point by point, or 1,000 drawn by hand, 500 km at most; ROUTE_NAME_TAKEN; a universe route by the leadership only (LEADERSHIP_ONLY). Since v101.4.0 a route that cannot be snapped is kept as drawn.',
  kind: 'mutation', op: 'saveMapRoute', flatten: ['input', 'input.route'], positionals: edit ? ['input.id', 'input.name'] : ['input.name'], dry: true,
  hide: ['input.route.points', 'input.route.ascent', 'input.route.descent', 'input.route.metres', 'input.route.seconds', 'input.route.snapped', ...(edit ? [] : ['input.id'])],
  extra: pointsProp, require: ['points', ...(edit ? ['id'] : [])], descriptions: routeFields,
  prepare: (i) => { const { points, ...rest } = i; return { ...rest, 'input.route.points': pointsOf(String(points), '--points') }; },
  text: routeText,
  examples: edit ? ['breakrocks routes edit <route id> canal-run --mode FOOT --points "48.871,2.366;48.884,2.370" --snap'] : ['breakrocks routes create canal-run --mode FOOT --points "48.871,2.366;48.884,2.370" --snap --tags running', 'breakrocks routes create loop --mode BICYCLE --points "48.85,2.35;48.86,2.36;48.85,2.37" --loop --universe %paris --visibility PUBLIC'],
});
export const routesCreate = saveRoute(false);
export const routesEdit = saveRoute(true);
export const routesDelete = apiCommand({
  name: 'routes delete', summary: 'Delete a route of one\'s own (or of one\'s universe, by its leadership); the events that carry it keep a copy of its line (deleteMapRoute)', kind: 'mutation', op: 'deleteMapRoute', positionals: ['id'],
  descriptions: { id: 'The route' }, confirm: (i) => `Delete the route ${String(i.id)}?`, text: doneText, examples: ['breakrocks routes delete <route id> --yes'],
});
export const routesCopy = apiCommand({
  name: 'routes copy', summary: '"Do this route": copy a route one reads into one\'s own routes, PRIVATE, crediting the original (copyMapRoute)', kind: 'mutation', op: 'copyMapRoute', positionals: ['id'], dry: true,
  descriptions: { id: 'The route copied', name: 'The name of the copy (default: the original\'s)' }, text: routeText, examples: ['breakrocks routes copy <route id>', 'breakrocks routes copy <route id> --name my-canal-run'],
});
export const routesGpxExport: Command<{ id: string; out?: string; force?: boolean }, unknown> = {
  name: 'routes gpx export', summary: 'Export a route to a GPX file, without the parts its privacy zones hide (mapRouteGpx; --out: the file, else the text)',
  examples: ['breakrocks routes gpx export <route id> --out canal-run.gpx', 'breakrocks routes gpx export <route id> > canal-run.gpx'],
  input: object({ id: str('The route'), out: str('The GPX file written (none: the text of the GPX)'), force: bool('Replace the file when it exists') }, ['id']),
  output: { anyOf: [{ type: 'string', description: 'The GPX' }, object({ out: str('The file written'), bytes: { type: 'integer', description: 'Its size' } })] }, args: { positionals: ['id'] },
  run: async (ctx, { id, out, force }) => {
    const path = out ? resolve(ctx.io.cwd, out) : undefined;
    if (path && !force && existsSync(path)) throw usageError('FILE_EXISTS', `${out} exists (--force replaces it)`, { path: out });
    const gpx = (await api<{ mapRouteGpx: string | null }>(ctx, 'query($id: ID!) { mapRouteGpx(id: $id) }', { id })).mapRouteGpx;
    if (gpx == null || !path) return gpx;
    writeFileSync(path, gpx);
    return { out, bytes: Buffer.byteLength(gpx) };
  },
  text: (r) => (typeof r === 'string' ? r : r ? `${(r as { out: string }).out} written (${(r as { bytes: number }).bytes} bytes)` : '(none)'),
};
/** At most 2 MB of GPX (importGpxRoute). */
export const MAX_GPX_BYTES = 2 * 1024 * 1024;
export const routesGpxImport = apiCommand({
  name: 'routes gpx import', summary: 'Import a GPX file as a PRIVATE route: its track simplified to 1,000 points at most, its waypoints as stages (60 at most) (importGpxRoute)', kind: 'mutation', op: 'importGpxRoute', positionals: ['file'], hide: ['gpx'], dry: true,
  extra: { file: str('The GPX file (2 MB at most)') }, require: ['file'], descriptions: { name: routeFields.name, mode: routeFields.mode },
  prepare: (i, ctx) => {
    const { file, ...rest } = i;
    const path = resolve(ctx.io.cwd, String(file));
    if (!existsSync(path) || !statSync(path).isFile()) throw usageError('FILE_NOT_FOUND', `No file ${String(file)}`, { path: file });
    if (statSync(path).size > MAX_GPX_BYTES) throw usageError('ROUTE_GPX_INVALID', `${String(file)}: 2 MB at most`, { path: file });
    return { ...rest, gpx: readFileSync(path, 'utf8') };
  },
  text: routeText, examples: ['breakrocks routes gpx import canal-run.gpx --name canal-run --mode FOOT'],
});
type Zone = { point: { lat: number; lon: number }; metres: number };
const zonesText = listText((z: Zone) => `${z.point.lat},${z.point.lon}  ${z.metres} m`);
export const routesPrivacyZones = apiCommand({
  name: 'routes privacy-zones', summary: 'The privacy zones of the account: the parts of its routes within them are hidden from the others (myRoutePrivacyZones)', kind: 'query', op: 'myRoutePrivacyZones', text: zonesText,
  examples: ['breakrocks routes privacy-zones', 'breakrocks routes privacy-zones --json'],
});
/** "48.85,2.35,500;48.86,2.36,1000" (or their JSON) → the privacy zones. */
export function zonesOf(value: string): Zone[] {
  const s = value.trim();
  if (!s) return [];
  if (s.startsWith('[')) { try { return JSON.parse(s); } catch { throw usageError('INVALID_INPUT', '--zones: JSON expected'); } }
  return s.split(';').map((z) => {
    const parts = z.split(',');
    const metres = Number(parts[2]);
    if (parts.length !== 3 || ![200, 500, 1000].includes(metres)) throw usageError('ROUTE_PRIVACY_ZONES_INVALID', `--zones: <lat>,<lon>,<200|500|1000>;… not "${z}"`);
    return { point: pointOf(parts.slice(0, 2).join(','), '--zones'), metres };
  });
}
export const routesPrivacyZonesSet = apiCommand({
  name: 'routes privacy-zones set', summary: 'Set the privacy zones of the account, 0 to 3, each of 200, 500 or 1,000 metres (setRoutePrivacyZones; --zones "": none)', kind: 'mutation', op: 'setRoutePrivacyZones', hide: ['zones'], dry: true,
  extra: { zones: str('The zones: "<lat>,<lon>,<metres>;…" (200, 500 or 1000 metres), or their JSON; "" none') }, require: ['zones'],
  prepare: (i) => ({ ...i, zones: zonesOf(String(i.zones)) }), text: zonesText,
  examples: ['breakrocks routes privacy-zones set --zones "48.8566,2.3522,500"', 'breakrocks routes privacy-zones set --zones ""'],
});
export const routesPlan = apiCommand({
  name: 'routes plan', summary: 'The route through 2 to 100 points (500 km at most), on foot or by bicycle, snapped to the streets and paths with --snap (route)',
  description: 'Since v101.4.0 a route that cannot be followed says why: ROUTE_NO_WAY, ROUTE_TOO_LONG. Not snapped: the estimated duration of its length (5 km/h on foot, 15 km/h by bicycle). Nothing is saved (routes create).',
  kind: 'query', op: 'route', hide: ['points'], extra: pointsProp, require: ['points'], descriptions: { mode: routeFields.mode, snap: routeFields.snap },
  prepare: (i) => ({ ...i, points: pointsOf(String(i.points), '--points') }),
  text: (r) => { const x = r as { mode?: string; metres?: number | null; seconds?: number | null; snapped?: boolean; ascent?: number | null; line?: unknown[] | null } | null; return x ? `${x.mode} ${km(x.metres)}${x.seconds != null ? `, ${Math.round(x.seconds / 60)} min` : ''}${x.ascent != null ? `, +${x.ascent} m` : ''}${x.snapped ? ', snapped' : ', as drawn'}, ${x.line?.length ?? 0} points` : '(none)'; },
  examples: ['breakrocks routes plan --mode FOOT --points "48.871,2.366;48.884,2.370" --snap', 'breakrocks routes plan --mode BICYCLE --points "48.85,2.35;48.90,2.40" --json'],
});

// ---- The layers of the map of an area ----

const cells = { parentMapCells: 'cells' };
const universeFilter = { universe: 'The universe filter: one public universe (none: every public universe)' };
export const mapRoutes = apiCommand({
  name: 'map routes', summary: 'The routes that cross an area of the map: public routes and universe routes of public universes, 100 at most (mapRoutes)', kind: 'query', op: 'mapRoutes', rename: cells, descriptions: { ...universeFilter, cells: cellsProperty.description! },
  text: listText(routeLine), examples: ['breakrocks map routes --cells 861fb4677ffffff', 'breakrocks map routes --cells 861fb4677ffffff --universe %paris --json'],
});
type Channel = { address: string; presentCount?: number; place?: { name?: string } | null; lastMessage?: { text?: string | null } | null };
export const mapChannels = apiCommand({
  name: 'map channels', summary: 'The placed channels of an area of the map, with their place, who is there and their last message (mapChannels)', kind: 'query', op: 'mapChannels', rename: cells, descriptions: { ...universeFilter, cells: cellsProperty.description! },
  text: listText((c: Channel) => `${c.address}  ${c.place?.name ?? ''}  present ${c.presentCount ?? 0}${c.lastMessage?.text ? `  "${c.lastMessage.text.replace(/\s+/g, ' ').slice(0, 40)}"` : ''}`),
  examples: ['breakrocks map channels --cells 861fb4677ffffff --universe %paris'],
});
type MapPost = { postId: string; universe?: string; createdAt?: string; place?: { name?: string | null; mapCell?: string | null } | null };
export const mapPosts = apiCommand({
  name: 'map posts', summary: 'The placed posts of an area of the map the account may read, the most recent first, 200 at most (mapPosts)', description: 'The layer "Videos" (videosOnly) is deferred by the platform.',
  kind: 'query', op: 'mapPosts', rename: cells, hide: ['videosOnly'], descriptions: { ...universeFilter, cells: cellsProperty.description! },
  text: listText((p: MapPost) => `${p.postId}  ${p.createdAt ?? ''}  ${p.universe ?? ''}  ${p.place?.name ?? p.place?.mapCell ?? ''}`),
  examples: ['breakrocks map posts --cells 861fb4677ffffff', 'breakrocks map posts --cells 861fb4677ffffff,861fb4667ffffff --universe %paris --json'],
});
type RecentPlace = { mapCell: string; pointOfInterest?: boolean; point?: { lat: number; lon: number } | null; lastPostAt?: string };
export const mapPlaces = apiCommand({
  name: 'map places', summary: 'The places of an area of the map with a placed post of less than 1 hour, the most recent first (mapRecentPlaces: the pulse ring)', kind: 'query', op: 'mapRecentPlaces', rename: cells, descriptions: { ...universeFilter, cells: cellsProperty.description! },
  text: listText((p: RecentPlace) => `${p.lastPostAt ?? ''}  ${p.mapCell}${p.pointOfInterest && p.point ? `  point of interest ${p.point.lat},${p.point.lon}` : ''}`),
  examples: ['breakrocks map places --cells 861fb4677ffffff'],
});
