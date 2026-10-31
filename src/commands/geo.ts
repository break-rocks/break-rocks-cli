// The universe territory and the map: read, set, remove and report the
// universe territory of a universe (a boundary of the cartography, or a circle around a place), the
// places search with the universes whose territory holds each place, the universes of an area of
// the map (map cells of resolution 5), and the shape of a boundary read from the catalogue of the
// cartography of the environment (catalog.json → boundaries.url). The CLI has no H3 library: an area
// is given by its map cells, or by a boundary whose shape lists the cells it meets.
import { apiCommand } from '../api/command.js';
import { outputSchema, selection } from '../api/graphql.js';
import { readJson, writePrivate, type Environment } from '../config.js';
import type { Context } from '../context.js';
import { cliRefusal, networkError, usageError } from '../errors.js';
import type { Command } from '../registry.js';
import { bool, int, list, object, openObject, str } from '../schema.js';
import { uuidv7 } from '../ids.js';
import { api } from '../session.js';
import { request } from '../transport.js';

// ---- The cartography: its catalogue and the shapes of the boundaries ----

export const MAP_HOSTS: Record<Environment, string> = { dev: 'https://map.dev.break.rocks', staging: 'https://map.staging.break.rocks', prod: 'https://map.break.rocks' };
/** The catalogue is kept an hour, as the map service keeps it (the apps read it once a day). */
export const CATALOG_SECONDS = 3600;
export const BOUNDARY_ID = '^[A-Za-z0-9_-]{1,64}$';

type Catalog = { schema?: number; boundaries?: { version: string; url: string; index?: string; count?: number; levels?: number[]; resolution?: number } | null; attribution?: string };
export type BoundaryFeature = {
  type: 'Feature'; geometry: { type: string; coordinates: unknown };
  properties: { schema?: number; id: string; name: string; names?: Record<string, string>; level: number; kind: string; wikidata?: string | null; bbox: number[]; cells: string[]; attribution?: string };
};

const mapHost = (ctx: Context) => (ctx.env.BREAKROCKS_MAP_URL ?? MAP_HOSTS[ctx.profile().env]).replace(/\/+$/, '');

/** The catalogue of the cartography of the environment: the cached one when younger than an hour, else read again (the cached one when the read fails). */
export async function mapCatalog(ctx: Context): Promise<Catalog> {
  const host = mapHost(ctx);
  const file = ctx.store.cacheFile(`map-catalog-${ctx.profile().env}.json`);
  const cached = readJson<{ fetchedAt: number; host: string; catalog: Catalog }>(file);
  if (cached && cached.host === host && ctx.now() - cached.fetchedAt < CATALOG_SECONDS * 1000) return cached.catalog;
  try {
    const res = await request(ctx, `${host}/catalog.json`, { method: 'GET', headers: { accept: 'application/json' } });
    if (!res.ok) throw networkError('MAP_CATALOG_UNAVAILABLE', `The catalogue of the map (${host}) answered ${res.status}`, { status: res.status });
    const catalog = await res.json() as Catalog;
    writePrivate(file, JSON.stringify({ fetchedAt: ctx.now(), host, catalog }));
    return catalog;
  } catch (error) {
    if (cached && cached.host === host) return cached.catalog;
    throw error;
  }
}

/** The shape of the boundary [id] (the id of its PlaceMatch, R<OSM relation>): BOUNDARY_SHAPE_NOT_FOUND on a 404 (the readers fall back to the point). */
export async function boundaryShape(ctx: Context, id: string): Promise<{ feature: BoundaryFeature; version: string; url: string }> {
  if (!new RegExp(BOUNDARY_ID).test(id)) throw usageError('INVALID_INPUT', `"${id}" is not the id of a boundary (R7444, as a PlaceMatch gives it)`);
  const catalog = await mapCatalog(ctx);
  const b = catalog.boundaries;
  if (!b?.url) throw cliRefusal('BOUNDARY_SHAPES_UNAVAILABLE', 'The cartography of this environment serves no boundary shape yet (no "boundaries" in its catalogue)');
  const url = b.url.replace('{id}', encodeURIComponent(id));
  const res = await request(ctx, url, { method: 'GET', headers: { accept: 'application/geo+json, application/json' } });
  if (res.status === 404) throw cliRefusal('BOUNDARY_SHAPE_NOT_FOUND', `No shape for the boundary ${id} (a level left out, or a relation cut by the area built): the apps fall back to its point`, { id, version: b.version });
  if (!res.ok) throw networkError('MAP_UNAVAILABLE', `The shape of ${id} answered ${res.status}`, { id, status: res.status });
  return { feature: await res.json() as BoundaryFeature, version: b.version, url };
}

// ---- The universe territory ----

const TERRITORY = '{ id name kind center { lat lon } radius }';
export const RADII: Record<string, number> = { M150: 150, M250: 250, M500: 500, KM1: 1000, KM2_5: 2500, KM5: 5000, KM10: 10000, KM25: 25000 };

/** "2500", "2.5km", "500 m", "KM2_5": the TerritoryRadius it names (INVALID_INPUT outside the eight). */
export function radiusOf(value: string): string {
  const v = value.trim();
  if (RADII[v.toUpperCase()]) return v.toUpperCase();
  const m = /^(\d+(?:[.,]\d+)?)\s*(m|km)?$/i.exec(v);
  const metres = m ? Math.round(Number(m[1].replace(',', '.')) * (m[2]?.toLowerCase() === 'km' ? 1000 : 1)) : NaN;
  const found = Object.entries(RADII).find(([, r]) => r === metres);
  if (!found) throw usageError('INVALID_INPUT', `--radius: one of 150, 250, 500, 1000, 2500, 5000, 10000 or 25000 metres (or 2.5km…), not "${value}"`);
  return found[0];
}

/** "48.8566,2.3522": the point it names (INVALID_INPUT otherwise). */
export function pointOf(value: string, flag = '--circle'): { lat: number; lon: number } {
  const parts = value.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n)) || Math.abs(parts[0]) > 90 || Math.abs(parts[1]) > 180) throw usageError('INVALID_INPUT', `${flag}: <lat>,<lon> in degrees (48.8566,2.3522), not "${value}"`);
  return { lat: parts[0], lon: parts[1] };
}

export type TerritoryFlags = { boundary?: string; circle?: string; radius?: string; name?: string };

/** The TerritoryChoiceInput of a boundary (its name and kind read from its shape when not given) or of a circle around a named place. */
export async function territoryChoice(ctx: Context, i: TerritoryFlags): Promise<Record<string, unknown>> {
  if (!!i.boundary === !!i.circle) throw usageError('INVALID_INPUT', 'A universe territory is a boundary (--boundary <id>) or a circle (--circle <lat>,<lon> --radius <m> --name <place>), one of them');
  if (i.boundary) {
    let name = i.name, kind: string | undefined;
    try { const { feature } = await boundaryShape(ctx, i.boundary); name ??= feature.properties.name; kind = feature.properties.kind; } catch { /* no shape: the id alone, the backend finds it again */ }
    return { boundaryId: i.boundary, ...(name ? { name } : {}), ...(kind ? { kind } : {}) };
  }
  if (!i.radius) throw usageError('INVALID_INPUT', '--circle needs --radius (150 m to 25 km)');
  if (!i.name?.trim()) throw usageError('INVALID_INPUT', '--circle needs --name: the place at its center, made public with the universe territory (1 to 100 characters)');
  return { center: { name: i.name, point: pointOf(i.circle!) }, radius: radiusOf(i.radius) };
}

const territoryProps = {
  boundary: str('A boundary: the id of its place (R7444, the "id" of a PlaceMatch of breakrocks places search)', { pattern: BOUNDARY_ID }),
  circle: str('A circle: its center, <lat>,<lon> (only the center is sent, never a position of the device)'),
  radius: str('The radius of the circle: 150, 250, 500, 1000, 2500, 5000, 10000 or 25000 metres (2.5km…)'),
};

type Territory = { id?: string | null; name: string; kind: string; center?: { lat: number; lon: number } | null; radius?: string | null } | null;
type TerritoryAnswer = { universe: string; territory: Territory };

const metres = (radius?: string | null) => { const m = RADII[radius ?? '']; return m === undefined ? '?' : m >= 1000 ? `${m / 1000} km` : `${m} m`; };
export function describeTerritory(t: Territory): string {
  if (!t) return 'none';
  if (t.center || t.kind === 'circle') return `circle around ${t.name}${t.center ? ` (${t.center.lat},${t.center.lon})` : ''}, radius ${metres(t.radius)}`;
  return `boundary ${t.name} [${t.id ?? '?'}] (${t.kind})`;
}
const territoryText = (r: TerritoryAnswer) => [`${r.universe}: ${describeTerritory(r.territory)}`, ...(r.territory?.id ? [`shape: breakrocks map boundary ${r.territory.id}`] : [])].join('\n');
const territoryOutput = openObject({ universe: str('The universe'), territory: outputSchema('Territory', 1) });

export const territoryGet: Command<{ universe: string }, TerritoryAnswer> = {
  name: 'universes territory get', summary: 'The universe territory of a universe: a boundary or a circle (Universe.territory)',
  description: 'Read it before proposing or setting one, and to place a universe on a map. A public universe of the first level only; null for a private universe, the root universe and a sub-universe. A boundary has a shape (breakrocks map boundary <id>).',
  examples: ['breakrocks universes territory get %paris', 'breakrocks universes territory get %paris --json'],
  input: object({ universe: str('The universe (%name)') }, ['universe']), output: territoryOutput, args: { positionals: ['universe'] },
  run: async (ctx, { universe }) => {
    const u = (await api<{ universe: { name: string; territory: Territory } | null }>(ctx, `query($n: String!) { universe(name: $n) { name territory ${TERRITORY} } }`, { n: universe })).universe;
    if (!u) throw usageError('UNIVERSE_NOT_FOUND', `No universe ${universe}`, { universe });
    return { universe: u.name, territory: u.territory };
  },
  text: territoryText, quiet: (r) => r.territory?.id ?? undefined,
};

export const territorySet: Command<{ universe: string } & TerritoryFlags, TerritoryAnswer> = {
  name: 'universes territory set', summary: 'Set the universe territory of a universe: a boundary, or a circle around a place (setUniverseTerritory)',
  description: 'The leadership only (UNIVERSE_GOVERNED otherwise: file a proposal, breakrocks proposals file --kind TERRITORY). A public universe of the first level only (TERRITORY_FIRST_LEVEL_ONLY). A boundary by the id of its place (its name read from its shape when --name is absent); a circle by its center, its radius among eight and the name of the place at its center (made public). It replaces the former one; it restricts nothing.',
  examples: ['breakrocks universes territory set %paris --boundary R7444', 'breakrocks universes territory set %marche --circle 48.8566,2.3522 --radius 500 --name "Place du marché"'],
  input: object({ universe: str('The universe (%name)'), ...territoryProps, name: str('The name: of the place at the center of a circle (required), of a boundary (read from its shape otherwise)', { maxLength: 100 }) }, ['universe']),
  output: territoryOutput, args: { positionals: ['universe'] },
  run: async (ctx, i) => {
    const territory = await territoryChoice(ctx, i);
    const u = (await api<{ setUniverseTerritory: { name: string; territory: Territory } }>(ctx, `mutation($u: String!, $i: UniverseTerritoryInput!, $r: ID!) { setUniverseTerritory(universe: $u, input: $i, requestId: $r) { name territory ${TERRITORY} } }`, { u: i.universe, i: { territory }, r: uuidv7(ctx.now()) })).setUniverseTerritory;
    return { universe: u?.name ?? i.universe, territory: u?.territory ?? null };
  },
  text: territoryText, quiet: (r) => r.territory?.id ?? undefined,
};

export const territoryRemove: Command<{ universe: string }, TerritoryAnswer> = {
  name: 'universes territory remove', summary: 'Remove the universe territory of a universe (setUniverseTerritory clear; the leadership)',
  description: 'Without leadership: breakrocks proposals file --kind TERRITORY --no-territory.',
  examples: ['breakrocks universes territory remove %paris'],
  input: object({ universe: str('The universe (%name)') }, ['universe']), output: territoryOutput, args: { positionals: ['universe'] },
  run: async (ctx, { universe }) => {
    const u = (await api<{ setUniverseTerritory: { name: string; territory: Territory } }>(ctx, `mutation($u: String!, $r: ID!) { setUniverseTerritory(universe: $u, input: { clear: true }, requestId: $r) { name territory ${TERRITORY} } }`, { u: universe, r: uuidv7(ctx.now()) })).setUniverseTerritory;
    return { universe: u?.name ?? universe, territory: u?.territory ?? null };
  },
  text: territoryText,
};

export const territoryReport = apiCommand({
  name: 'universes territory report', summary: 'Report the universe territory of a universe to the platform team (report UNIVERSE_TERRITORY)', kind: 'mutation', op: 'report', flatten: ['target'], positionals: ['target.universe'], require: ['universe'],
  fixed: { 'target.kind': 'UNIVERSE_TERRITORY' }, hide: ['agentText', 'proposalId', 'postId', 'imageId', 'messageId', 'discussion', 'name', 'themePart', 'block', 'accountId', 'word'].map((f) => `target.${f}`),
  description: 'MISLEADING (it does not match the universe), PLATFORM_RULES or ILLEGAL; always to the platform team. One\'s own: REPORT_OWN_CONTENT; none: TERRITORY_NOT_FOUND.',
  descriptions: { universe: 'The universe (%name)', article: 'The article of the platform rules (with PLATFORM_RULES)' }, depth: 1,
  examples: ['breakrocks universes territory report %paris --reason MISLEADING'],
});
territoryReport.input.properties.reason = { type: 'string', enum: ['MISLEADING', 'PLATFORM_RULES', 'ILLEGAL'], description: 'The reason: MISLEADING, PLATFORM_RULES or ILLEGAL' };

// ---- The places search, the map of Explore, the shapes ----

/** "south,west,north,east": the BoundsInput it names. */
export function boundsOf(value: string): { south: number; west: number; north: number; east: number } {
  const p = value.split(',').map((x) => Number(x.trim()));
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n)) || p[0] > p[2] || Math.abs(p[0]) > 90 || Math.abs(p[2]) > 90) throw usageError('INVALID_INPUT', `--bounds: <south>,<west>,<north>,<east> in degrees (48.81,2.22,48.90,2.47), not "${value}"`);
  return { south: p[0], west: p[1], north: p[2], east: p[3] };
}

type PlaceMatch = { id?: string | null; name: string; kind?: string | null; address?: string | null; point: { lat: number; lon: number }; universes: string[] };
export const placesSearch: Command<{ query: string; bounds: string; language?: string; limit?: number }, PlaceMatch[]> = {
  name: 'places search', summary: 'Search a place in an area: its point, its kind, the universes whose territory holds it (places)',
  description: 'The places within --bounds first, then at most 2 cities, regions or countries from elsewhere; never the position of the device. The id of a boundary (R7444) is what universes territory set --boundary and proposals file --boundary take. MAP_SERVICE_STARTING: the search wakes up, try again after errorInfo.retryAfterSeconds.',
  examples: ['breakrocks places search Paris --bounds 48.81,2.22,48.90,2.47', 'breakrocks places search "Buttes-Chaumont" --bounds 48.81,2.22,48.90,2.47 --language fr --json'],
  input: object({ query: str('What to search'), bounds: str('The area shown: <south>,<west>,<north>,<east>'), language: str('The language of the names (fr, en…)', { default: 'en' }), limit: int('How many at most', { minimum: 1, maximum: 10 }) }, ['query', 'bounds']),
  output: outputSchema('[PlaceMatch!]!', 1), args: { positionals: ['query'] },
  run: async (ctx, i) => (await api<{ places: PlaceMatch[] }>(ctx, `query($q: String!, $b: BoundsInput!, $l: String!, $n: Int) { places(query: $q, bounds: $b, language: $l, limit: $n) ${selection('PlaceMatch', 1)} }`, { q: i.query, b: boundsOf(i.bounds), l: i.language ?? 'en', n: i.limit ?? null })).places,
  text: (r) => (r.length ? r.map((p) => `${p.name}${p.kind ? ` (${p.kind})` : ''}${p.id ? ` [${p.id}]` : ''}  ${p.point.lat},${p.point.lon}${p.address ? `\n  ${p.address}` : ''}\n  universes: ${p.universes.length ? p.universes.join(', ') : '-'}`).join('\n') : '(no place)'),
  quiet: (r) => r[0]?.id ?? undefined,
};

/** A map cell of resolution 5 (H3: 15 hexadecimal digits, "85…"). */
export const CELL_R5 = '^85[0-9a-fA-F]{13}$';
export const MAX_AREA_CELLS = 19;

/** The page of Explore with the whole territory of each universe (its center too). */
const AREA_PAGE = selection('ExploreUniversePage', 2).replace('territory { id kind name radius }', `territory ${TERRITORY}`);

export const exploreArea: Command<{ cells?: string[]; boundary?: string }, unknown> = {
  name: 'explore area', summary: 'The universes of an area of the map: those whose universe territory meets its map cells (exploreUniverses AREA)',
  description: `The area is 1 to ${MAX_AREA_CELLS} map cells of resolution 5 (H3), given by --cells, or by --boundary: the cells its shape meets (breakrocks map boundary). The CLI computes no map cell from a box (no H3 library). 100 universes at most, the most active of the last hour first, each with its territory.`,
  examples: ['breakrocks explore area --boundary R7444', 'breakrocks explore area --cells 851fb463fffffff,851fb467fffffff --json'],
  input: object({ cells: list(`Map cells of resolution 5 (1 to ${MAX_AREA_CELLS})`, { type: 'string', pattern: CELL_R5 }, { minItems: 1, maxItems: MAX_AREA_CELLS }), boundary: str('A boundary whose shape gives the cells (R7444)', { pattern: BOUNDARY_ID }) }),
  output: outputSchema('ExploreUniversePage', 2),
  run: async (ctx, i) => {
    if (!!i.cells?.length === !!i.boundary) throw usageError('INVALID_INPUT', '--cells or --boundary, one of them');
    let cells = (i.cells ?? []).map((c) => c.toLowerCase());
    if (i.boundary) {
      const all = (await boundaryShape(ctx, i.boundary)).feature.properties.cells ?? [];
      cells = all.filter((c) => new RegExp(CELL_R5).test(c));
      if (cells.length !== all.length) throw usageError('MAP_CELLS_INVALID', `The shape of ${i.boundary} is compacted to coarser map cells (a large boundary): give --cells of resolution 5`, { boundary: i.boundary });
      if (cells.length > MAX_AREA_CELLS) throw usageError('MAP_CELLS_INVALID', `The shape of ${i.boundary} meets ${cells.length} map cells; exploreUniverses takes ${MAX_AREA_CELLS} at most: give --cells`, { boundary: i.boundary, cells: cells.length });
    }
    return (await api<{ exploreUniverses: unknown }>(ctx, `query($c: [String!]!) { exploreUniverses(by: AREA, mapCells: $c) ${AREA_PAGE} }`, { c: cells })).exploreUniverses;
  },
  text: (r) => {
    const page = r as { items?: { universe: string; count?: number | null; residentCount?: number | null; territory?: Territory }[] } | null;
    if (!page?.items?.length) return '(no universe in this area)';
    return page.items.map((u) => `${u.universe}  activity ${u.count ?? 0}, residents ${u.residentCount ?? '-'}  territory: ${describeTerritory(u.territory ?? null)}`).join('\n');
  },
};

type BoundaryAnswer = { id: string; name: string; level: number; kind: string; wikidata: string | null; bbox: number[]; cells: string[]; version: string; url: string; attribution: string | null } | BoundaryFeature;
export const mapBoundary: Command<{ id: string; geojson?: boolean }, BoundaryAnswer> = {
  name: 'map boundary', summary: 'The shape of a boundary of the cartography: its name, level, box and map cells (--geojson: the whole GeoJSON Feature)',
  description: 'Read from the catalogue of the cartography of the environment (https://map[.<env>].break.rocks/catalog.json, boundaries.url; BREAKROCKS_MAP_URL replaces the host), without a session. The id is the one of the boundary as a PlaceMatch gives it, and as Territory.id serves it. A boundary without a shape: BOUNDARY_SHAPE_NOT_FOUND (the readers fall back to its point).',
  examples: ['breakrocks map boundary R7444', 'breakrocks map boundary R7444 --geojson > paris.geojson'],
  input: object({ id: str('The id of the boundary (R7444)', { pattern: BOUNDARY_ID }), geojson: bool('The whole GeoJSON Feature, its geometry included') }, ['id']),
  output: openObject({ id: str('Its id'), name: str('Its name'), level: int('Its administrative level (2 country … 8 municipality)'), kind: str('Its kind'), bbox: list('[west, south, east, north]', { type: 'number' }), cells: list('The map cells of resolution 5 it meets, compacted'), version: str('The version of the shapes'), url: str('The address of the shape') }),
  args: { positionals: ['id'] },
  run: async (ctx, { id, geojson }) => {
    const { feature, version, url } = await boundaryShape(ctx, id);
    if (geojson) return feature;
    const p = feature.properties;
    return { id: p.id, name: p.name, level: p.level, kind: p.kind, wikidata: p.wikidata ?? null, bbox: p.bbox, cells: p.cells, version, url, attribution: p.attribution ?? null };
  },
  text: (r) => ('type' in r ? JSON.stringify(r) : [`${r.name} [${r.id}]  level ${r.level}, ${r.kind}${r.wikidata ? `, ${r.wikidata}` : ''}`, `bbox: ${r.bbox.join(', ')}`, `cells (${r.cells.length}): ${r.cells.join(', ')}`, `shape: ${r.url}`, ...(r.attribution ? [r.attribution] : [])].join('\n')),
  quiet: (r) => ('type' in r ? r.properties.id : r.id),
};
