// What a command watches in real time on native-sulfur (server src/core/messaging/realtime.ts): the account's own channel
// (`accountChannel`: its DMs and its inbox) or a discussion's (`liveMode`: `/m/d/<id>` for a public one, `/m/g/<id>/<epoch>`
// for a group or a private channel; a discussion the platform polls has none). The Event API of a subject is one of the
// cell's (client-config `realtimeApis`, MSGRT-03: rendezvous hashing, `fnv1a32("<api id>|<subject>")` the highest), read
// from the cell map (`client/cells.json`, kept 5 minutes; BREAKROCKS_SULFUR_CELLS replaces its address).
import type { Context } from '../context.js';
import type { Environment } from '../config.js';
import { readJson, writePrivate } from '../config.js';
import { networkError } from '../errors.js';
import type { RealtimeEvent } from '../realtime.js';
import { request } from '../transport.js';
import { SULFUR_SITES } from './http.js';
import { readSulfurSession, sulfurApi } from './session.js';

/** What a reading watches: its channels and the subject they live by (an account id, a discussion id); none: it is polled. */
export type LiveTarget = { channels: string[]; subject: string } | { channels: []; why: string };
export type LiveSource = { resolve: () => Promise<LiveTarget>; matches: (event: RealtimeEvent) => boolean };

/** The cell map of an environment: dev's `id` distribution (no custom domain yet), else `https://id.<site>`. */
export const CELL_MAPS: Record<Environment, string> = { dev: 'https://d2pd7vzqc9wyqe.cloudfront.net/client/cells.json', staging: 'https://id.staging.break.rocks/client/cells.json', prod: `https://id.${SULFUR_SITES.prod}/client/cells.json` };
export const CELL_MAP_SECONDS = 300;

export type RealtimeApi = { id: string; realtime: string; events: string };
type CellMap = { schema: number; default: string; cells: Record<string, { realtime?: string; events?: string; realtimeApis?: RealtimeApi[] }> };

/** The FNV-1a hash (32 bits) of a text's UTF-8 bytes, as the server's (platform/shards/shard.ts). */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (const byte of Buffer.from(text, 'utf8')) { h ^= byte; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** The Event API of [subject] among [apis]: the highest `fnv1a32("<id>|<subject>")`; one API: that one. */
export function apiFor<T extends { id: string }>(subject: string, apis: readonly T[]): T {
  let best = apis[0]!, top = -1;
  if (apis.length > 1) for (const a of apis) { const score = fnv1a32(`${a.id}|${subject}`); if (score > top) { top = score; best = a; } }
  return best;
}

/** The Event APIs of [cell] in [env], from the cell map (cached 5 minutes; the cached one when the read fails). */
export async function realtimeApis(ctx: Context, env: Environment, cell: string): Promise<RealtimeApi[]> {
  const url = ctx.env.BREAKROCKS_SULFUR_CELLS?.trim() || CELL_MAPS[env];
  const file = ctx.store.cacheFile(`sulfur-cells-${env}.json`);
  const cached = readJson<{ fetchedAt: number; url: string; map: CellMap }>(file);
  let map = cached && cached.url === url && ctx.now() - cached.fetchedAt < CELL_MAP_SECONDS * 1000 ? cached.map : undefined;
  if (!map) {
    try {
      const res = await request(ctx, url, { method: 'GET', headers: { accept: 'application/json' } });
      if (!res.ok) throw networkError('CELL_MAP_UNAVAILABLE', `The cell map answered ${res.status}`);
      const read = await res.json() as CellMap;
      if (read?.schema !== 1 || !read.cells) throw networkError('CELL_MAP_UNAVAILABLE', 'The cell map is not one this CLI reads');
      map = read;
      writePrivate(file, JSON.stringify({ fetchedAt: ctx.now(), url, map }));
    } catch (error) {
      if (!cached || cached.url !== url) throw error;
      map = cached.map;
    }
  }
  const c = map.cells[cell] ?? map.cells[map.default];
  const listed = (c?.realtimeApis ?? []).filter((a) => a?.realtime?.startsWith('wss://') && a.events?.startsWith('https://'));
  if (listed.length) return listed;
  if (c?.realtime?.startsWith('wss://') && c.events?.startsWith('https://')) return [{ id: 'a0', realtime: c.realtime, events: c.events }];
  throw networkError('REALTIME_UNAVAILABLE', `The cell map names no Event API for the cell ${cell}`);
}

/** The account's own channel: its DMs and its inbox (events [evs]). */
export const accountLive = (ctx: Context, evs: string[] = ['msgs', 'inbox', 'event']): LiveSource => ({
  resolve: async () => {
    const { accountChannel } = await sulfurApi<{ accountChannel: string }>(ctx, '{ accountChannel }');
    return { channels: [accountChannel], subject: readSulfurSession(ctx)?.accountId ?? accountChannel };
  },
  matches: (e) => !!e.ev && (evs.includes(e.ev) || ['gen'].includes(e.ev)),
});

/** A discussion's channel ([discussionId] read when the command runs): pushed, or polled by the platform (none). */
export const discussionLive = (ctx: Context, discussionId: () => Promise<string>): LiveSource => ({
  resolve: async () => {
    const id = await discussionId();
    const { liveMode } = await sulfurApi<{ liveMode: { mode: string; channel: string | null } }>(ctx, 'query($d: ID!) { liveMode(discussionId: $d) { mode channel } }', { d: id });
    if (!liveMode.channel) return { channels: [], why: liveMode.mode === 'poll' ? 'the platform serves this discussion by its tail (poll mode)' : 'a conversation\'s messages come on the account\'s channel' };
    return { channels: [liveMode.channel], subject: id };
  },
  matches: (e) => !!e.ev && ['msgs', 'event', 'epoch', 'mode'].includes(e.ev),
});

/** The events after which the channels are asked again (a generation, an epoch or a mode moved): a reconnection. */
export const RESUBSCRIBE = new Set(['gen', 'epoch', 'mode']);
