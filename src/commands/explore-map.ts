// The explore filter (specs v128.0.0, D-408 option b, posts/explore-search.feature, contracts/map.md § The explore
// filter): the search of Explore in an area and everywhere, with the explore reasons of each result; the random jump
// (map-highlights.feature) and the highlight of the day (universes/explore.feature). The area is a place (--near, through
// the places search of the backend, then its boundary shape or the map cells around its point), a universe (--where:
// its universe territory) or map cells (--cells): never the position of the machine. The map cells of a point are
// computed by src/h3.ts.
import { CONTRACT } from '../api/graphql.js';
import { paint } from '../colour.js';
import type { Context } from '../context.js';
import { cliRefusal, CliError, usageError } from '../errors.js';
import { cellResolution, cellToParent, isCell, latLngToCell } from '../h3.js';
import type { Command } from '../registry.js';
import { bool, int, list, object, openObject, str, type JsonSchema } from '../schema.js';
import { api } from '../session.js';
import { BOUNDARY_ID, RADII, boundaryShape } from './geo.js';

// ---- The backend behind this CLI ----

const NOT_SERVED = /FieldUndefined: Field '\w+' in type '(?:Query|Mutation)'|UnknownType|Unknown type/;
/**
 * [run], or OPERATION_NOT_SERVED (exit 1) when the backend does not know its operation or its input type yet (a contract
 * older than v128.0.0): "this backend does not serve <what> yet".
 */
export async function served<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CliError && NOT_SERVED.test(error.message)) throw cliRefusal('OPERATION_NOT_SERVED', `This backend does not serve ${what} yet (it came with specs v128.0.0; this CLI is built on ${CONTRACT.version ?? '?'}): breakrocks doctor tells more`, { what });
    throw error;
  }
}

// ---- The area: map cells of one resolution and a zoom band ----

export type ZoomBand = 'COUNTRY' | 'CITY' | 'NEIGHBOURHOOD' | 'STREET';
type Point = { lat: number; lon: number };
type Area = { mapCells: string[]; band: ZoomBand };
/** Where the area comes from, as the answer tells it. */
type WhereFrom = { from: 'place' | 'universe' | 'cells' | 'none'; name?: string; id?: string | null; point?: Point | null; resolution?: number };

export const MAX_EXPLORE_CELLS = 7;
/** The zoom band of a resolution, as the files of the map highlights read them (COUNTRY 0 to 2, CITY 3 and 4, NEIGHBOURHOOD 5 and 6; STREET beyond). */
export const bandOf = (res: number): ZoomBand => (res <= 2 ? 'COUNTRY' : res <= 4 ? 'CITY' : res <= 6 ? 'NEIGHBOURHOOD' : 'STREET');
/** The average edge of a hexagon of the resolutions 0 to 9, in kilometres (H3). */
const EDGE_KM = [1281.256011, 483.0568391, 182.5129565, 68.97922179, 26.07175968, 9.85409099, 3.724532667, 1.406475763, 0.53141401, 0.200786148];
/** The resolution of the area around a point (a place without a boundary shape): 7 cells of about 10 km across, as the map of a neighbourhood. */
export const POINT_RESOLUTION = 6;

/** The point at [km] from [p] towards [bearing] (radians), on the sphere. */
function destination(p: Point, km: number, bearing: number): Point {
  const d = km / 6371.0072, lat1 = p.lat * Math.PI / 180, lon1 = p.lon * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 * 180 / Math.PI, lon: ((lon2 * 180 / Math.PI + 540) % 360) - 180 };
}

/** The map cells of [res] around [p]: its own and those of six points one cell away (7 at most). */
export function cellsAround(p: Point, res: number): string[] {
  const step = Math.sqrt(3) * EDGE_KM[res];
  const points = [p, ...[0, 1, 2, 3, 4, 5].map((k) => destination(p, step, (k * 60 + 30) * Math.PI / 180))];
  return [...new Set(points.map((q) => latLngToCell(q.lat, q.lon, res)))].slice(0, MAX_EXPLORE_CELLS);
}

/** The resolution whose 7 cells around a centre cover a circle of [metres]: the finest one whose two edges reach it. */
export const resolutionForRadius = (metres: number) => { for (let r = 9; r > 0; r--) if (2 * EDGE_KM[r] * 1000 >= metres) return r; return 0; };

/** Cells of several resolutions (a boundary shape, compacted) as cells of one resolution, 7 at most: their parents. */
export function oneResolution(cells: readonly string[]): string[] {
  let res = Math.min(...cells.map(cellResolution));
  let set = [...new Set(cells.map((c) => cellToParent(c, res)))];
  while (set.length > MAX_EXPLORE_CELLS && res > 0) { res--; set = [...new Set(set.map((c) => cellToParent(c, res)))]; }
  return set.sort();
}

const areaOfCells = (cells: string[]): Area => ({ mapCells: cells, band: bandOf(cellResolution(cells[0])) });

/** The cells given by --cells: H3 cells of one resolution (0 to 9), 1 to 7. */
function givenCells(cells: string[]): Area {
  const list = cells.map((c) => c.toLowerCase());
  const bad = list.find((c) => !isCell(c) || cellResolution(c) > 9);
  if (bad) throw usageError('MAP_CELLS_INVALID', `--cells: "${bad}" is not a map cell (H3) of a resolution of 0 to 9`);
  if (new Set(list.map(cellResolution)).size > 1) throw usageError('MAP_CELLS_INVALID', '--cells: map cells of one resolution');
  if (list.length > MAX_EXPLORE_CELLS) throw usageError('MAP_CELLS_INVALID', `--cells: ${MAX_EXPLORE_CELLS} map cells at most`);
  return areaOfCells([...new Set(list)]);
}

/** The area of a boundary (its shape, its cells as one resolution), or undefined when the cartography has no shape for it. */
async function boundaryArea(ctx: Context, id: string): Promise<Area | undefined> {
  if (!new RegExp(BOUNDARY_ID).test(id)) return undefined;
  try {
    const cells = (await boundaryShape(ctx, id)).feature.properties.cells ?? [];
    return cells.length ? areaOfCells(oneResolution(cells.map((c) => c.toLowerCase()))) : undefined;
  } catch { return undefined; }
}

type PlaceMatch = { id?: string | null; name: string; kind?: string | null; point: Point };
const WORLD = { south: -90, west: -180, north: 90, east: 180 };

/** The area of a place by its name: the first match of the places search, its boundary shape, else the cells around its point. */
async function placeArea(ctx: Context, query: string, language: string): Promise<{ area: Area; where: WhereFrom }> {
  const places = (await api<{ places: PlaceMatch[] | null }>(ctx, 'query($q: String!, $b: BoundsInput!, $l: String!) { places(query: $q, bounds: $b, language: $l, limit: 1) { id name kind point { lat lon } } }', { q: query, b: WORLD, l: language })).places ?? [];
  const place = places[0];
  if (!place) throw cliRefusal('PLACE_NOT_FOUND', `No place "${query}" (breakrocks map places search tells what the cartography knows)`, { query });
  const shaped = place.id ? await boundaryArea(ctx, place.id) : undefined;
  const area = shaped ?? areaOfCells(cellsAround(place.point, POINT_RESOLUTION));
  return { area, where: { from: 'place', name: place.name, id: place.id ?? null, point: place.point, resolution: cellResolution(area.mapCells[0]) } };
}

type Territory = { id?: string | null; name: string; kind: string; center?: Point | null; radius?: string | null } | null;
/** The area of a universe: its universe territory (a boundary, or a circle); undefined without one. */
async function universeArea(ctx: Context, universe: string): Promise<{ area?: Area; where: WhereFrom }> {
  const u = (await api<{ universe: { name: string; territory: Territory } | null }>(ctx, 'query($n: String!) { universe(name: $n) { name territory { id kind name center { lat lon } radius } } }', { n: universe })).universe;
  if (!u) throw usageError('UNIVERSE_NOT_FOUND', `No universe ${universe}`, { universe });
  const t = u.territory;
  let area: Area | undefined;
  if (t?.id && !t.center) area = await boundaryArea(ctx, t.id);
  if (!area && t?.center) area = areaOfCells(cellsAround(t.center, resolutionForRadius(RADII[t.radius ?? ''] ?? 1000)));
  return { area, where: { from: 'universe', name: u.name, id: t?.id ?? null, point: t?.center ?? null, ...(area ? { resolution: cellResolution(area.mapCells[0]) } : {}) } };
}

// ---- The explore filter ----

export const EXPLORE_KINDS = ['posts', 'videos', 'feats', 'events', 'routes', 'universes'] as const;
type FilterFlags = { near?: string; where?: string; cells?: string[]; when?: string; kinds?: string[]; families?: string[]; language?: string };
type Filter = { area?: Area | null; query?: string | null; when?: string; days?: number; kinds?: string[]; families?: string[]; mapFilter?: string | null; scope?: string; order?: string };

/** --when: now, tonight, weekend, or <n>d (1 to 90 days; 7d by default). */
export function whenOf(value: string | undefined): { when?: string; days?: number } {
  if (value === undefined) return {};
  const v = value.trim().toLowerCase();
  if (v === 'now' || v === 'tonight') return { when: v.toUpperCase() };
  if (v === 'weekend' || v === 'this-weekend') return { when: 'WEEKEND' };
  const m = /^(\d{1,2})d$/.exec(v);
  const days = m ? Number(m[1]) : NaN;
  if (!(days >= 1 && days <= 90)) throw usageError('INVALID_INPUT', `--when: now, tonight, weekend or <n>d (1d to 90d: 7d, 90d), not "${value}"`);
  return { when: 'DAYS', days };
}

/** The universe of a map filter ("%paris#market" → "%paris"), if any. */
const universeOf = (mapFilter: string) => /^%[^#\s]+/.exec(mapFilter)?.[0];

/** The where of the filter (its area and its map filter) from --near, --where and --cells, and what it came from. */
async function whereOf(ctx: Context, i: FilterFlags): Promise<{ area?: Area; mapFilter?: string; where: WhereFrom }> {
  if (i.near !== undefined && i.cells?.length) throw usageError('INVALID_INPUT', 'The area: --near or --cells, one of them');
  const mapFilter = i.where?.trim() || undefined;
  if (mapFilter && !/^[%#]/.test(mapFilter)) throw usageError('INVALID_INPUT', `--where: a public universe and its tags (%paris, %paris#market, #market), not "${i.where}"`);
  if (i.cells?.length) return { area: givenCells(i.cells), mapFilter, where: { from: 'cells', resolution: cellResolution(i.cells[0].toLowerCase()) } };
  if (i.near !== undefined) {
    if (!i.near.trim()) throw usageError('INVALID_INPUT', '--near: the name of a place');
    const { area, where } = await placeArea(ctx, i.near.trim(), i.language ?? 'en');
    return { area, mapFilter, where };
  }
  const universe = mapFilter && universeOf(mapFilter);
  if (universe) {
    const { area, where } = await universeArea(ctx, universe);
    return { area, mapFilter, where };
  }
  return { mapFilter, where: { from: 'none' } };
}

const filterFlags = {
  near: str('The area: a place by its name ("Vieux-Port, Marseille"), found by the places search of the platform; its boundary shape, else the 7 map cells around its point. Never the position of this machine'),
  where: str('A public universe and its tags (%paris, %paris#market, #market): the universe is where (its universe territory is the area when --near and --cells are absent), its tags are part of what'),
  cells: list(`The area as map cells (H3) of one resolution, 0 to 9, 1 to ${MAX_EXPLORE_CELLS}: the zoom band follows their resolution`, { type: 'string', pattern: '^8[0-9a-fA-F]{14}$' }, { maxItems: MAX_EXPLORE_CELLS }),
  when: str('The time window: now (the next 60 minutes), tonight (6 p.m. to 6 a.m.), weekend (Friday 6 p.m. to Sunday midnight) or <n>d (1d to 90d); 7d by default. It narrows the universe events and the live shares only', { pattern: '^(?:[Nn][Oo][Ww]|[Tt][Oo][Nn][Ii][Gg][Hh][Tt]|(?:this-)?[Ww][Ee][Ee][Kk][Ee][Nn][Dd]|\\d{1,2}[dD])$' }),
  kinds: list('The map kinds (every one by default)', { type: 'string', enum: [...EXPLORE_KINDS] }),
  families: list('The event families, by their key (every one by default)', { type: 'string' }),
  language: str('The language of the names of the places search (fr, en…)', { default: 'en' }),
} satisfies Record<string, JsonSchema>;

/** The filter without its unset values. */
const compact = (f: Filter): Filter => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as Filter;

// ---- The results ----

/** A result of Explore (ExploreResult): what each kind prints, its point, its explore reasons. */
const RESULT = '{ kind point { lat lon } post { id createdAt text universe author { handle } } mapPost { postId universe createdAt video authorId author { handle } place { name } } place { place { placeId name } publishedCount liveliness } event { id title universe startsAt eventType } route { id name mode metres seconds estimatedSeconds ascent difficulty surfaces { surface metres } } universe { universe residentCount count } account { id handle displayName } discussion { address name } playlist { id name } tag reasons { reason value } }';

type Reason = { reason: string; value?: string | null };
export type ExploreResult = {
  kind: string; point?: Point | null; reasons?: Reason[];
  post?: { id: string; createdAt?: string; text?: string | null; universe?: string | null; author?: { handle?: string } | null } | null;
  mapPost?: { postId: string; universe?: string; createdAt?: string; video?: boolean; authorId?: string; author?: { handle?: string } | null; place?: { name?: string } | null } | null;
  place?: { place?: { placeId?: string; name?: string } | null; publishedCount?: number; liveliness?: string | null } | null;
  event?: { id: string; title?: string; universe?: string; startsAt?: string; eventType?: string } | null;
  route?: RouteMarker | null;
  universe?: { universe: string; residentCount?: number | null; count?: number | null } | null;
  account?: { id: string; handle?: string; displayName?: string } | null;
  discussion?: { address?: string; name?: string } | null;
  playlist?: { id: string; name?: string } | null;
  tag?: string | null;
};

const REASONS: Record<string, (v?: string | null) => string> = {
  IN_TIME_WINDOW: () => 'in the time window', IN_AREA: () => 'in the area', CROSSES_AREA: () => 'crosses the area', TERRITORY_IN_AREA: () => 'its territory meets the area',
  WORD_IN_NAME: (v) => `"${v ?? ''}" in its name`, WORD_IN_TEXT: (v) => `"${v ?? ''}" in its text`, WORD_IN_SEARCH_WORDS: (v) => `"${v ?? ''}" in its search words`, CARRIES_TAG: (v) => `carries ${v ?? 'a tag'}`,
};
/** "in the time window · in the area · "jazz" in its text", in the order the platform answers them (time window, place, words, tags). */
export const reasonsText = (reasons: readonly Reason[] = []) => reasons.map((r) => (REASONS[r.reason] ?? (() => r.reason.toLowerCase().replace(/_/g, ' ')))(r.value)).join(' · ');

const excerpt = (text?: string | null) => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
const handle = (a?: { handle?: string } | null) => (a?.handle ? `@${a.handle}` : '');
const pointText = (p?: Point | null) => (p ? `${p.lat},${p.lon}` : '');
const join = (...parts: (string | undefined | null | false)[]) => parts.filter(Boolean).join('  ');

/** What a result is, on one line: its kind, its id, what names it, its point. */
export function resultLine(r: ExploreResult): string {
  const kind = paint.bold(r.kind.padEnd(10));
  const where = paint.dim(pointText(r.point));
  switch (r.kind) {
    case 'POST': case 'VIDEO': {
      const p = r.post, m = r.mapPost;
      return join(kind, p?.id ?? m?.postId, handle(p?.author ?? m?.author), p?.universe ?? m?.universe, m?.place?.name, excerpt(p?.text), where);
    }
    case 'PLACE': return join(kind, r.place?.place?.placeId, r.place?.place?.name, r.place ? `${r.place.publishedCount ?? 0} feat(s)` : '', r.place?.liveliness?.toLowerCase(), where);
    case 'EVENT': return join(kind, r.event?.id, r.event?.title, r.event?.universe, r.event?.startsAt, where);
    case 'ROUTE': return join(kind, r.route ? routeMarkerLine(r.route) : '', where);
    case 'UNIVERSE': return join(kind, r.universe?.universe, r.universe?.residentCount != null ? `${r.universe.residentCount} residents` : '', where);
    case 'ACCOUNT': return join(kind, handle(r.account), r.account?.displayName);
    case 'DISCUSSION': return join(kind, r.discussion?.address);
    case 'PLAYLIST': return join(kind, r.playlist?.id, r.playlist?.name);
    case 'TAG': return join(kind, r.tag);
    default: return join(kind, where);
  }
}
const resultId = (r: ExploreResult): string | undefined => r.post?.id ?? r.mapPost?.postId ?? r.place?.place?.placeId ?? r.event?.id ?? r.route?.id ?? r.universe?.universe ?? r.account?.id ?? r.discussion?.address ?? r.playlist?.id ?? r.tag ?? undefined;
const withReasons = (r: ExploreResult) => [resultLine(r), ...(r.reasons?.length ? [`  ${paint.dim('why:')} ${reasonsText(r.reasons)}`] : [])].join('\n');

// ---- The figures of a route (routes show, routes nearby, a ROUTE result) ----

export type RouteMarker = { id: string; name: string; mode?: string; metres?: number | null; seconds?: number | null; estimatedSeconds?: number | null; ascent?: number | null; difficulty?: string | null; surfaces?: { surface: string; metres: number }[] | null; tags?: string[]; start?: Point | null };
const km = (m?: number | null) => (m == null ? '-' : `${(m / 1000).toFixed(1)} km`);
/** "1 h 20 min", "45 min". */
export const duration = (s: number) => { const min = Math.round(s / 60); return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`; };
/** The duration of a route: measured along the ways, else estimated ("estimated"); "-" when unknown. */
export const routeDuration = (r: { seconds?: number | null; estimatedSeconds?: number | null }) => (r.seconds != null ? duration(r.seconds) : r.estimatedSeconds != null ? `${duration(r.estimatedSeconds)} (estimated)` : '-');
/** "paved 3.1 km, gravel 1.1 km". */
export const surfacesText = (s?: { surface: string; metres: number }[] | null) => (s ?? []).map((x) => `${x.surface.toLowerCase()} ${km(x.metres)}`).join(', ');
/** The four figures of a route: its difficulty, its duration, its length, its elevation gain, then its surfaces. */
export const routeFigures = (r: { metres?: number | null; seconds?: number | null; estimatedSeconds?: number | null; ascent?: number | null; difficulty?: string | null; surfaces?: { surface: string; metres: number }[] | null }) =>
  join(r.difficulty ? r.difficulty.toLowerCase() : '', r.seconds != null || r.estimatedSeconds != null ? routeDuration(r) : '', km(r.metres), r.ascent != null ? `+${r.ascent} m` : '', surfacesText(r.surfaces));
export const routeMarkerLine = (r: RouteMarker) => join(paint.dim(r.id), r.name, r.mode, routeFigures(r), r.tags?.length ? `#${r.tags.join(' #')}` : '');

// ---- explore search ----

type SearchInput = FilterFlags & { words: string; everywhere?: boolean; order?: string; after?: string; limit?: number };
type SearchResults = { inArea: number; everywhere: number; items: ExploreResult[]; next?: string | null; density?: unknown[]; nearest?: ExploreResult | null; postsStatus?: string; retryAfterSeconds?: number | null };
type SearchAnswer = SearchResults & { filter: Filter; where: WhereFrom };
/** "Everywhere · 500+" beyond the bound of search (500 posts). */
export const SEARCH_BOUND = 500;
const everywhereCount = (n: number) => (n >= SEARCH_BOUND ? `${SEARCH_BOUND}+` : String(n));

const whereLine = (w: WhereFrom, f: Filter) => {
  const cells = f.area ? `${f.area.mapCells.length} map cell${f.area.mapCells.length > 1 ? 's' : ''} of resolution ${cellResolution(f.area.mapCells[0])}, ${f.area.band.toLowerCase()}` : 'no area';
  const what = w.from === 'place' ? `near ${w.name}${w.id ? ` [${w.id}]` : ''}` : w.from === 'universe' ? `${w.name}${f.area ? '' : ' (no universe territory: everywhere)'}` : w.from === 'cells' ? 'the map cells given' : 'everywhere (no area: --near, --where or --cells)';
  return paint.dim(`${what} · ${cells}${f.mapFilter ? ` · ${f.mapFilter}` : ''}${f.when ? ` · ${f.when === 'DAYS' ? `${f.days ?? 7} days` : f.when.toLowerCase()}` : ''}`);
};

export const exploreSearch: Command<SearchInput, SearchAnswer> = {
  name: 'explore search', summary: 'Search Explore with words: in an area, everywhere, with the reasons of each result (exploreSearch)',
  // Its MCP tool is breakrocks_explore_filter: breakrocks_explore_search stays the platform search it named until 0.33.0.
  tool: 'breakrocks_explore_filter',
  description: [
    'The explore filter of the map of Explore: where (--near a place, --where a universe and its tags, --cells), when (--when) and what (--kinds, --families, the tags of --where), and the words.',
    'In the area (by default when an area is given) the results come in the order of the map highlights; --everywhere (or no area) reads them everywhere, by relevance or by date (--order), the accounts, discussions, playlists and tags of the platform search included.',
    'Two counts: "In the area · N" and "Everywhere · M" ("500+" beyond the bound of search). Each result tells why it is there (the time window, the place, the words, the tags), never about the reader. When the area holds nothing, the nearest activity that carries the words (within 500 km).',
    'An address of a universe before the words ("%paris jazz") sets where and the words. The area is never the position of this machine: a place is looked up by the platform and turned into map cells here. A signed-in account only. A backend before specs v128.0.0: OPERATION_NOT_SERVED. The platform search of the search bar: breakrocks search.',
  ].join(' '),
  examples: ['breakrocks explore search jazz --near "Vieux-Port, Marseille" --when tonight', 'breakrocks explore search "%paris market" --when weekend --kinds events,posts', 'breakrocks explore search velo --where %paris#bike --everywhere --order date --json', 'breakrocks explore search concert --cells 861fb4677ffffff,861fb4667ffffff --when 90d'],
  input: object({
    words: str('The words (2 to 200 characters); an address of a universe first sets where', { minLength: 2, maxLength: 200 }), ...filterFlags,
    everywhere: bool('The results everywhere, the area aside (it still gives the count "In the area")'),
    order: str('Everywhere: relevance (the default) or date; in the area, the order of the map highlights only', { enum: ['relevance', 'date', 'highlights'] }),
    after: str('The next page: the "next" of the page before'), limit: int('How many results per page (20 by default)', { minimum: 1, maximum: 60 }),
  }, ['words']),
  output: openObject({ inArea: int('"In the area · N"'), everywhere: int('"Everywhere · M" (500: the bound of search)'), items: list('The results (ExploreResult), with their explore reasons', { type: 'object' }), next: str('The next page'), nearest: { type: ['object', 'null'], description: 'The nearest activity that carries the words, when the area holds none' }, postsStatus: str('The state of the search engine of the posts'), filter: { type: 'object', description: 'The explore filter sent (ExploreFilterInput)' }, where: { type: 'object', description: 'Where the area came from: a place, a universe, map cells, none' } }),
  args: { positionals: ['words'] },
  run: async (ctx, i) => {
    let words = i.words.trim();
    let whereFlag = i.where;
    // "%paris jazz": the address of a universe followed by words sets where and the words.
    const lead = /^(%[^\s]+)\s+(.+)$/.exec(words);
    if (lead && whereFlag === undefined) { whereFlag = lead[1]; words = lead[2].trim(); }
    if (/^[%@#][^\s]+$/.test(words)) throw usageError('INVALID_INPUT', `"${words}" is an address alone: breakrocks explore resolve ${words}, or explore random --where ${words}`);
    if (words.length < 2) throw usageError('INVALID_INPUT', 'The words: 2 to 200 characters');
    const { area, mapFilter, where } = await whereOf(ctx, { ...i, where: whereFlag });
    const scope = i.everywhere || !area ? 'EVERYWHERE' : 'AREA';
    const order = i.order?.toUpperCase();
    if (scope === 'AREA' && order && order !== 'HIGHLIGHTS') throw usageError('INVALID_INPUT', '--order relevance|date orders the results everywhere (--everywhere); in the area they come in the order of the map highlights');
    if (scope === 'EVERYWHERE' && order === 'HIGHLIGHTS') throw usageError('INVALID_INPUT', '--order highlights is the order of the area: everywhere, relevance or date');
    const filter = compact({ area: area ?? null, query: words, ...whenOf(i.when), kinds: i.kinds?.map((k) => k.toUpperCase()), families: i.families, mapFilter: mapFilter ?? null, scope, order: order ?? (scope === 'AREA' ? 'HIGHLIGHTS' : 'RELEVANCE') });
    const results = await served('explore search', async () => (await api<{ exploreSearch: SearchResults | null }>(ctx, `query($f: ExploreFilterInput!, $a: String, $l: Int) { exploreSearch(filter: $f, after: $a, limit: $l) { inArea everywhere items ${RESULT} next density { mapCell kind count } nearest ${RESULT} postsStatus retryAfterSeconds } }`, { f: filter, a: i.after ?? null, l: i.limit ?? null })).exploreSearch);
    return { ...(results ?? { inArea: 0, everywhere: 0, items: [], next: null, density: [], nearest: null, postsStatus: 'READY', retryAfterSeconds: null }), filter, where };
  },
  text: (r) => {
    const counts = `${paint.bold(`In the area · ${r.filter.area ? r.inArea : '—'}`)}   ${paint.bold(`Everywhere · ${everywhereCount(r.everywhere)}`)}`;
    const status = r.postsStatus && r.postsStatus !== 'READY' ? [paint.warn(`posts: ${r.postsStatus}${r.retryAfterSeconds ? `, read again in ${r.retryAfterSeconds} s` : ''}`)] : [];
    const nearest = r.filter.scope === 'AREA' && r.inArea === 0 ? [r.nearest ? `Nothing in the area; the nearest: ${resultLine(r.nearest)}` : 'Nothing in the area, nor within 500 km'] : [];
    return [whereLine(r.where, r.filter), counts, ...status, ...nearest, ...r.items.map(withReasons), ...(r.next ? [paint.dim(`next: ${r.next}`)] : [])].join('\n');
  },
  quiet: (r) => (r.items[0] ? resultId(r.items[0]) : undefined),
};

// ---- explore random ----

type RandomInput = FilterFlags & { words?: string; except?: string };
type Activity = { mapCell: string; name?: string | null; contents: number; kinds: { kind: string; count: number }[] };
type RandomAnswer = { result: ExploreResult; activity: Activity; candidates: number; filter: Filter; where: WhereFrom } | { result: null; filter: Filter; where: WhereFrom };

export const exploreRandom: Command<RandomInput, RandomAnswer> = {
  name: 'explore random', summary: 'Jump to a map highlight of a very lively map cell, at random (randomHighlight)',
  description: 'The random jump of the map of Explore, in two steps: a very lively map cell of the filter (at least 20 public contents of the last 7 days), then one of its map highlights, each with the same chance: a placed post, a placed video, a place with a place feat or a universe event, never a person, a universe nor a route, never a content of an account blocked either way. The same for every reader. The area: --near, --where or --cells; none: the whole world. --except: the map highlight just jumped to, never drawn again. Nothing when the filter holds no very lively map cell. A backend before specs v128.0.0: OPERATION_NOT_SERVED.',
  examples: ['breakrocks explore random', 'breakrocks explore random --near Marseille --kinds posts,videos', 'breakrocks explore random --where %paris --except <post id> --json'],
  input: object({ words: str('Words: the draw among the results that carry them (2 to 200 characters)', { minLength: 2, maxLength: 200 }), ...filterFlags, except: str('The map highlight not to draw again (the last one jumped to: its id)') }),
  output: openObject({ result: { type: ['object', 'null'], description: 'The map highlight drawn (ExploreResult), null when no very lively map cell' }, activity: { type: 'object', description: 'The activity of its map cell over the last 7 days' }, candidates: int('The number of very lively map cells it was drawn from'), filter: { type: 'object', description: 'The explore filter sent' }, where: { type: 'object', description: 'Where the area came from' } }),
  args: { positionals: ['words'] },
  run: async (ctx, i) => {
    const { area, mapFilter, where } = await whereOf(ctx, i);
    const filter = compact({ area: area ?? null, query: i.words?.trim() || null, ...whenOf(i.when), kinds: i.kinds?.map((k) => k.toUpperCase()), families: i.families, mapFilter: mapFilter ?? null });
    const drawn = await served('the random jump', async () => (await api<{ randomHighlight: { result: ExploreResult; activity: Activity; candidates: number } | null }>(ctx, `query($f: ExploreFilterInput!, $e: ID) { randomHighlight(filter: $f, exceptId: $e) { result ${RESULT} activity { mapCell name contents kinds { kind count } } candidates } }`, { f: filter, e: i.except ?? null })).randomHighlight);
    return drawn ? { ...drawn, filter, where } : { result: null, filter, where };
  },
  text: (r) => {
    if (!r.result || !('activity' in r)) return `${whereLine(r.where, r.filter)}\n(no very lively map cell here: nothing to jump to)`;
    const a = r.activity;
    return [whereLine(r.where, r.filter), resultLine(r.result), `${a.name ?? a.mapCell}: ${a.contents} public contents in 7 days${a.kinds.length ? ` (${a.kinds.map((k) => `${k.kind.toLowerCase()} ${k.count}`).join(', ')})` : ''}`, paint.dim(`drawn among ${r.candidates} very lively map cell${r.candidates === 1 ? '' : 's'}; again: --except ${resultId(r.result) ?? '<id>'}`)].join('\n');
  },
  quiet: (r) => (r.result ? resultId(r.result) : undefined),
};

// ---- explore today ----

type TodayAnswer = { country: string; result: ExploreResult | null; computedAt: string | null };
export const exploreToday: Command<{ country?: string }, TodayAnswer> = {
  name: 'explore today', summary: 'The highlight of the day of a country (highlightOfTheDay)',
  description: 'The placed post or placed video of the public universes of the last 24 hours with the highest highlight score in the country, computed every hour, the same for every reader of the country. --country: ISO 3166-1 alpha-2 (FR); by default the country of the account. Nothing when the country holds none. A backend before specs v128.0.0: OPERATION_NOT_SERVED.',
  examples: ['breakrocks explore today', 'breakrocks explore today --country FR --json'],
  input: object({ country: str('The country, ISO 3166-1 alpha-2 (FR); by default the country of the account', { pattern: '^[A-Za-z]{2}$' }) }),
  output: openObject({ country: str('The country'), result: { type: ['object', 'null'], description: 'The highlight of the day (ExploreResult: POST or VIDEO, with its author)' }, computedAt: { type: ['string', 'null'], description: 'When it was computed (every hour)' } }),
  run: async (ctx, i) => {
    let country = i.country?.toUpperCase();
    if (!country) {
      const me = (await api<{ me: { own?: { country?: string | null } | null } | null }>(ctx, 'query { me { own { country } } }')).me?.own;
      if (!me?.country) throw usageError('INVALID_INPUT', 'The account has no country: --country <ISO 3166-1 alpha-2> (FR)');
      country = me.country.toUpperCase();
    }
    const day = await served('the highlight of the day', async () => (await api<{ highlightOfTheDay: { result: ExploreResult; computedAt: string } | null }>(ctx, `query($c: String!) { highlightOfTheDay(country: $c) { result ${RESULT} computedAt } }`, { c: country })).highlightOfTheDay);
    return { country, result: day?.result ?? null, computedAt: day?.computedAt ?? null };
  },
  text: (r) => (r.result ? [paint.bold(`The highlight of the day in ${r.country}`), resultLine(r.result), paint.dim(`computed at ${r.computedAt ?? '-'}`)].join('\n') : `(no highlight of the day in ${r.country})`),
  quiet: (r) => (r.result ? resultId(r.result) : undefined),
};
