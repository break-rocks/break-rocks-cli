// Where the API of an environment is (contracts/cells.md § The cell map): like the apps, the CLI
// reads the cell map of the environment (`https://apps[.<env>].break.rocks/config/cells.json`), kept
// 5 minutes in its cache, then takes the home cell of the account (the profile's, else the prefix of
// its id, "eu-…"), else the cell of the country at registration (byCountry), else the default cell.
// BREAKROCKS_API_URL and BREAKROCKS_AGENTS_URL replace them (a personal sandbox, a test).
import type { UserPool } from './cognito.js';
import type { Context } from './context.js';
import type { Environment, Profile } from './config.js';
import { readJson, writePrivate } from './config.js';
import { cliRefusal, networkError } from './errors.js';
import { request } from './transport.js';

export const APPS_HOSTS: Record<Environment, string> = { dev: 'https://apps.dev.break.rocks', staging: 'https://apps.staging.break.rocks', prod: 'https://apps.break.rocks' };
export const CELL_MAP_SECONDS = 300;

export type Cell = { region: string; api: string; agents: string; media?: string; realtime?: string; events?: string; auth?: UserPool };
export type CellMap = { version: number; publishedAt?: string; default: string; cells: Record<string, Cell>; byCountry?: Record<string, string> };
export type Endpoints = { env: Environment; cell: string; region?: string; api: string; agents: string; media?: string; events?: string; realtime?: string; auth?: UserPool };

const cellMapUrl = (env: Environment) => `${APPS_HOSTS[env]}/config/cells.json`;

/** The cell map of [env]: the cached one when younger than 5 minutes, else read again (the cached one when the read fails). */
export async function cellMap(ctx: Context, env: Environment): Promise<CellMap> {
  const file = ctx.store.cacheFile(`cells-${env}.json`);
  const cached = readJson<{ fetchedAt: number; map: CellMap }>(file);
  if (cached && ctx.now() - cached.fetchedAt < CELL_MAP_SECONDS * 1000) return cached.map;
  try {
    const res = await request(ctx, cellMapUrl(env), { method: 'GET', headers: { accept: 'application/json' } });
    if (!res.ok) throw networkError('CELL_MAP_UNAVAILABLE', `The cell map of ${env} answered ${res.status}`);
    const map = await res.json() as CellMap;
    if (!map?.cells || !map.default) throw networkError('CELL_MAP_UNAVAILABLE', `The cell map of ${env} is not one`);
    writePrivate(file, JSON.stringify({ fetchedAt: ctx.now(), map }));
    return map;
  } catch (error) {
    if (cached) return cached.map;
    throw error;
  }
}

/** The cell of an account id ("eu-32757404-…": eu), none for an id without a prefix (the default cell). */
export const cellOfId = (id: string | undefined) => (id && /^[a-z]{2}-/.test(id) ? id.slice(0, 2) : undefined);

/** The addresses of the API and of the agents host for [profile] ([country]: the one of a registration). */
export async function endpoints(ctx: Context, profile: Profile, country?: string): Promise<Endpoints> {
  const api = ctx.env.BREAKROCKS_API_URL, agents = ctx.env.BREAKROCKS_AGENTS_URL;
  const realtimeOverride = ctx.env.BREAKROCKS_REALTIME_URL, eventsOverride = ctx.env.BREAKROCKS_EVENTS_URL;
  if (api && agents) return { env: profile.env, cell: profile.cell ?? 'override', api, agents: agents.replace(/\/+$/, ''), ...(eventsOverride ? { events: eventsOverride } : {}), ...(realtimeOverride ? { realtime: realtimeOverride } : {}) };
  const map = await cellMap(ctx, profile.env);
  const cell = profile.cell ?? cellOfId(profile.operatorId ?? profile.accountId) ?? (country ? map.byCountry?.[country.toUpperCase()] : undefined) ?? map.default;
  const found = map.cells[cell];
  if (!found) throw cliRefusal('CELL_UNKNOWN', `The cell "${cell}" is not in the cell map of ${profile.env}`, { cell });
  return { env: profile.env, cell, region: found.region, api: api ?? found.api, agents: (agents ?? `${found.agents}/v1`).replace(/\/+$/, ''), media: found.media, events: eventsOverride ?? found.events, realtime: realtimeOverride ?? found.realtime, ...(found.auth ? { auth: found.auth } : {}) };
}

// The directory of the environment (contracts/cells.md § The directory): the cell of an email, for a
// sign-in on a new device. BREAKROCKS_DIRECTORY_URL replaces it.
export const DIRECTORY_HOSTS: Record<Environment, string> = { dev: 'https://directory.dev.break.rocks', staging: 'https://directory.staging.break.rocks', prod: 'https://directory.break.rocks' };

/** The home cell of [email] (`POST /v1/cell`: an unknown email gets the default cell), undefined when the directory does not answer. */
export async function cellOfEmail(ctx: Context, env: Environment, email: string): Promise<string | undefined> {
  const base = (ctx.env.BREAKROCKS_DIRECTORY_URL ?? DIRECTORY_HOSTS[env]).replace(/\/+$/, '');
  try {
    const res = await request(ctx, `${base}/v1/cell`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ email }) });
    if (!res.ok) return undefined;
    const { cell } = await res.json() as { cell?: unknown };
    return typeof cell === 'string' && /^[a-z]{2}$/.test(cell) ? cell : undefined;
  } catch { return undefined; }
}

/**
 * The web app of an environment (contracts/urls.md: https://<env>.break.rocks; production serves
 * the app on beta.break.rocks until the launch, backend docs/ci-cd.md § 7). BREAKROCKS_WEB_URL
 * replaces it. TEMPORARY (technical debt, until the launch): production's host is beta.break.rocks.
 */
export const WEB_HOSTS: Record<Environment, string> = { dev: 'https://dev.break.rocks', staging: 'https://staging.break.rocks', prod: 'https://beta.break.rocks' };
export const webOrigin = (ctx: Context, env: Environment) => new URL(ctx.env.BREAKROCKS_WEB_URL ?? WEB_HOSTS[env]).origin;
