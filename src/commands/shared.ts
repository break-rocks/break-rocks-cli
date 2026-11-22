// What the commands of the operations added since specs v83.1.0 share: the text of a page (one line per
// item), points and lists of points given as "lat,lon", the map cells of an area, and the discussion
// (a channel, a group chat or a conversation) a message belongs to.
import { readFileSync } from 'node:fs';
import { paint } from '../colour.js';
import { resolve } from 'node:path';
import type { Context } from '../context.js';
import { usageError } from '../errors.js';
import type { JsonSchema } from '../schema.js';
import { pointOf } from './geo.js';

export { pointOf };

type Page<T> = { items?: T[]; next?: string | null } | null | undefined;

/** One line per item of a page, then its "next" cursor; "(none)" when empty. */
export const pageText = <T>(line: (item: T) => string) => (r: unknown) => {
  const p = r as Page<T>;
  return p?.items?.length ? [...p.items.map(line), ...(p.next ? [`next: ${p.next}`] : [])].join('\n') : '(none)';
};
/** One line per item of a list; "(none)" when empty. */
export const listText = <T>(line: (item: T) => string) => (r: unknown) => (Array.isArray(r) && r.length ? (r as T[]).map(line).join('\n') : '(none)');
/** "done" for an answer true, "nothing changed" for false. */
export const doneText = (r: unknown) => (r === true ? paint.ok('done') : r === false ? 'nothing changed' : r == null ? '(none)' : JSON.stringify(r));

/** "48.85,2.35;48.86,2.36" (or the JSON of [{ lat, lon }]) → the points. */
export function pointsOf(value: string, flag: string): { lat: number; lon: number }[] {
  const s = value.trim();
  if (s.startsWith('[')) {
    try { return JSON.parse(s) as { lat: number; lon: number }[]; } catch { throw usageError('INVALID_INPUT', `${flag}: JSON expected`); }
  }
  return s.split(/[;\s]+/).filter(Boolean).map((p) => pointOf(p, flag));
}

/** The text of a file given as "@path", or the value itself. */
export function textOrFile(ctx: Context, value: string): string {
  return value.startsWith('@') ? readFileSync(resolve(ctx.io.cwd, value.slice(1)), 'utf8') : value;
}

/** The map cells of resolution 6 of an area shown (1 to 4, as the map reads them). */
export const CELL_R6 = '^86[0-9a-fA-F]{13}$';
export const cellsProperty: JsonSchema = { type: 'array', items: { type: 'string', pattern: CELL_R6 }, minItems: 1, maxItems: 4, description: 'The map cells of resolution 6 (H3) of the area shown, 1 to 4 (the CLI computes none from a box)' };

/** The discussion that holds a message: exactly one of --channel, --group or --with (DiscussionRefInput). */
export const discussionTarget = {
  flatten: ['discussion'],
  rename: { 'discussion.groupChatId': 'group', 'discussion.accountId': 'with' },
  descriptions: { channel: 'The channel or universe discussion that holds it (%paris&general)', group: 'The group chat that holds it (its id)', with: 'The other account of the conversation that holds it: @handle or its id' },
};
export function oneDiscussion(i: Record<string, unknown>): Record<string, unknown> {
  const targets = ['channel', 'group', 'with'].filter((k) => i[k] !== undefined);
  if (targets.length !== 1) throw usageError('DISCUSSION_TARGET_INVALID', 'Name the discussion with exactly one of --channel, --group or --with');
  return i;
}

/** The universe and the tag of "%paris#market" (or of a universe and a tag given apart). */
export function universeAndTag(value: string, tag?: string): { universe: string; tag: string } {
  const at = value.indexOf('#');
  if (at > 0) return { universe: value.slice(0, at), tag: value.slice(at + 1) };
  if (!tag) throw usageError('INVALID_INPUT', `${value}: a universe and a tag, %universe#tag (or the tag after it)`);
  return { universe: value, tag: tag.replace(/^#/, '') };
}

/**
 * `--explore-map shown|kept|by-type` of the universe events (exploreMapChoice, specs v122.0.0, D-383): SHOWN beyond its universe on
 * the Map view of Experiences (Explore), KEPT in its universe only, BY_TYPE as its event type says. A command spreads [exploreMapFlag] and calls [exploreMapPrepare].
 * The refusals are the platform's: EVENT_EXPLORE_MAP_NOT_ALLOWED (no place, zone nor route, the format "online", an access other than "public"),
 * EVENT_EXPLORE_MAP_LIMIT (3 upcoming universe events shown beyond their universe at once).
 */
export const EXPLORE_MAP_CHOICES = ['shown', 'kept', 'by-type'] as const;
export const exploreMapFlag = {
  hide: ['input.exploreMapChoice'],
  extra: { exploreMap: { type: 'string', enum: [...EXPLORE_MAP_CHOICES], description: 'The Map view of Experiences (Explore): shown (beyond its universe, 3 upcoming at most per universe), kept (in its universe only), by-type (as its event type says; the default)' } as JsonSchema },
};
export function exploreMapPrepare(input: Record<string, unknown>): Record<string, unknown> {
  const { exploreMap, ...rest } = input;
  return exploreMap === undefined ? rest : { ...rest, 'input.exploreMapChoice': String(exploreMap).toUpperCase().replace(/-/g, '_') };
}
