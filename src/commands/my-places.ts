// My places (specs v129.1.0, D-411, map/my-places.feature, contracts/map.md § My places): what the account saved from the
// map to its own private map: a place, an experience feat, a universe event or a route (never a post), 5,000 at most,
// each with 0 to 5 My places tags (100 at most, "To try" and "Done" from the start) and a private note of 500 characters;
// a tag or the whole of My places shared as a playlist of the form MAP (never the note), "In common" with a connected
// account over its playlists of that form. The proximity alert is a setting of the device (no command). A delegated agent
// reads, saves, tags and writes notes for its human, and removes one saved item per call; it never shares My places,
// never deletes the whole of it, never touches a shared tag (DELEGATED_AGENT_NOT_ALLOWED, told in plain words). Every
// operation answers MY_PLACES_NOT_OPEN while the platform keeps map.savePlace off; a backend before v129.1.0 answers
// OPERATION_NOT_SERVED.
import { apiCommand } from '../api/command.js';
import { CliError, platformRefusal, usageError } from '../errors.js';
import { cellResolution, isCell } from '../h3.js';
import type { Context } from '../context.js';
import type { AnyCommand, Command } from '../registry.js';
import { bool, int, list, object, openObject, str } from '../schema.js';
import { api } from '../session.js';
import { doneText, pageText } from './shared.js';
import { served } from './explore-map.js';
import { playlistIdOf } from './playlists.js';

const SINCE = 'v129.1.0';

// ---- The backend and the delegated agents ----

const NOT_ALLOWED = 'DELEGATED_AGENT_NOT_ALLOWED';
/**
 * [command] on a backend before v129.1.0 (OPERATION_NOT_SERVED), and with the refusal of a delegated agent told in plain words:
 * the code stays DELEGATED_AGENT_NOT_ALLOWED (platform), the sentence says what the agent may not do and who may.
 */
function mine<T extends AnyCommand>(command: T, notAllowed?: string): T {
  const run = command.run;
  return {
    ...command,
    run: async (ctx: Context, input: unknown) => {
      try {
        return await served('My places', () => run(ctx, input), SINCE);
      } catch (error) {
        if (notAllowed && error instanceof CliError && error.code === NOT_ALLOWED) throw platformRefusal(NOT_ALLOWED, `${notAllowed} Ask your human to do it from the app, or from a sign-in of their own.`, error.details);
        throw error;
      }
    },
  };
}
const NEVER_SHARES = 'A delegated agent never shares My places of its human.';
const NEVER_CLEARS = 'A delegated agent never deletes the whole of My places of its human.';
const NEVER_SHARED_TAG = 'A delegated agent never saves, tags, renames or deletes so that a saved item shows in a shared playlist (a shared My places tag, or the whole of My places shared).';

// ---- My places tags: by name or by id ----

type Tag = { id: string; name: string; color: string; starter?: string | null; itemCount?: number; playlist?: { id: string; address?: string | null; name: string; visibility?: string } | null };
const TAG = '{ id name color starter itemCount playlist { id address name visibility } }';
const TAG_REF = '{ id name starter }';
/** A tag the account typed (#to-try, to-try, TO_TRY, or its id) as its id; what matches none is sent as it is and the platform answers MY_PLACES_TAG_NOT_FOUND. */
export async function tagIdsOf(ctx: Context, values: readonly string[]): Promise<string[]> {
  if (!values.length) return [];
  const tags = (await api<{ myPlacesTags: { id: string; name: string; starter?: string | null }[] | null }>(ctx, `query { myPlacesTags ${TAG_REF} }`)).myPlacesTags ?? [];
  return values.map((raw) => {
    const v = raw.trim().replace(/^#/, '');
    const key = v.toLowerCase().replace(/_/g, '-');
    return (tags.find((t) => t.id === v) ?? tags.find((t) => t.name.toLowerCase() === key) ?? tags.find((t) => t.starter?.toLowerCase().replace(/_/g, '-') === key))?.id ?? raw.trim();
  });
}
const tagIdOf = async (ctx: Context, value: string) => (await tagIdsOf(ctx, [value]))[0];
const TAG_DESC = 'The My places tag: its name (#to-try, done) or its id (my-places tags)';
const colour = (c: string) => c.toLowerCase();
const tagLine = (t: Tag) => `${t.id}  #${t.name}  ${colour(t.color)}  ${t.itemCount ?? 0} saved item${t.itemCount === 1 ? '' : 's'}${t.starter ? `  starter ${t.starter}` : ''}${t.playlist ? `  shared as ${t.playlist.address ?? t.playlist.id} (${(t.playlist.visibility ?? '').toLowerCase()})` : ''}`;
const tagText = (r: unknown) => (r ? tagLine(r as Tag) : '(none)');

// ---- Saved items ----

type Point = { lat: number; lon: number };
type Saved = { id: string; kind: string; targetId: string; exists: boolean; name?: string | null; point?: Point | null; mapCell?: string | null; endsAt?: string | null; doneAt?: string | null; tags?: Tag[]; note?: string; savedAt?: string };
const SAVED = `{ id kind targetId exists name point { lat lon } mapCell endsAt doneAt tags ${TAG_REF.slice(0, -1)} color } note savedAt }`;
const savedLine = (s: Saved) => [
  `${s.id}  ${s.kind}  ${s.exists ? s.name ?? s.targetId : `no longer exists (${s.targetId})`}`,
  s.point ? `${s.point.lat},${s.point.lon}` : '',
  ...(s.tags ?? []).map((t) => `#${t.name}`),
  s.doneAt ? `done on ${s.doneAt.slice(0, 10)}` : '',
  s.endsAt ? `ends ${s.endsAt}` : '',
  s.note ? `note: ${JSON.stringify(s.note)}` : '',
].filter(Boolean).join('  ');
const savedText = (r: unknown) => (r ? savedLine(r as Saved) : '(none)');
type SavedPage = { items?: Saved[]; next?: string | null; total?: number } | null;
const savedPageText = (r: unknown) => {
  const p = r as SavedPage;
  return p?.items?.length ? [`${p.total ?? p.items.length} saved item${(p.total ?? p.items.length) === 1 ? '' : 's'}`, pageText(savedLine)(r)].join('\n') : '(none)';
};

const SAVED_KINDS = 'PLACE (a point of interest, with or without a place feat; its place id), FEAT (a published experience feat; the id of its experience instance), EVENT (a universe event; its id) or ROUTE (a route; its id). Never a post';
const itemDescriptions = {
  kind: `What it is: ${SAVED_KINDS}`, targetId: 'The identifier of the thing, by its kind',
  tags: 'Its My places tags, 0 to 5: names (#to-try, done) or ids (my-places tags); the starting tags are to-try and done', note: 'Its private My places note, 0 to 500 visible characters, never shared (an empty text removes it)',
  itemId: 'The saved item: its id (my-places list)',
};
const checkCells = (cells: unknown, flag: string): void => {
  if (cells === undefined) return;
  const c = cells as string[];
  if (!c.length || c.length > 7 || !c.every(isCell) || new Set(c.map(cellResolution)).size !== 1 || cellResolution(c[0]) > 9) {
    throw usageError('INVALID_REQUEST', `${flag}: 1 to 7 H3 map cells of one resolution, 0 to 9, that cover the area shown`);
  }
};

export const myPlacesList = mine(apiCommand({
  name: 'my-places list', summary: 'Your saved items, the latest saved first (myPlaces)',
  description: 'The saved items of My places, read by their owner only (a delegated agent reads those of its human), notes included; never the position of the machine, the apps order by distance on the device. --tag: one My places tag ("All" without it). --cells: the saved items whose point lies in the H3 map cells of the area (1 to 7 cells of one resolution, 0 to 9). --in-common: the saved items that are also in those playlists of the form MAP (1 to 20, of one connected account, each one you may read and opened or follow: MY_PLACES_IN_COMMON_NOT_ALLOWED otherwise). The first line gives how many saved items the read answers in all. Pass --all to follow the pages.',
  kind: 'query', op: 'myPlaces', rename: { tagId: 'tag', mapCells: 'cells', inCommonPlaylistIds: 'inCommon' }, select: `{ items ${SAVED} next total }`,
  descriptions: { tag: TAG_DESC, cells: 'The H3 map cells that cover the area shown: 1 to 7 of one resolution, 0 to 9', inCommon: 'Playlists of the form MAP of one connected account (their addresses @erin>places or their ids): the saved items you saved too', limit: 'How many at most per page, 1 to 500 (100 by default)' },
  prepare: async (i, ctx) => {
    checkCells(i.cells, '--cells');
    const inCommon = i.inCommon as string[] | undefined;
    if (inCommon && (inCommon.length < 1 || inCommon.length > 20)) throw usageError('INVALID_REQUEST', '--in-common: 1 to 20 playlists');
    return {
      ...i,
      ...(i.tag !== undefined ? { tag: await tagIdOf(ctx, String(i.tag)) } : {}),
      ...(inCommon ? { inCommon: await Promise.all(inCommon.map((p) => playlistIdOf(ctx, p))) } : {}),
    };
  },
  text: savedPageText,
  examples: ['breakrocks my-places list', 'breakrocks my-places list --tag to-try --all', 'breakrocks my-places list --cells 891fb46741bffff --in-common @erin>places'],
}));

export const myPlacesShow = mine(apiCommand({
  name: 'my-places show', summary: 'Whether a thing is saved, and its saved item (mySavedItem)', kind: 'query', op: 'mySavedItem', positionals: ['kind', 'targetId'], select: SAVED,
  description: `Read when the card or the sheet of a thing opens ("Save" or "Saved"): the saved item, or "(not saved)". ${SAVED_KINDS}.`,
  descriptions: itemDescriptions, text: (r) => (r ? savedLine(r as Saved) : '(not saved)'),
  examples: ['breakrocks my-places show PLACE <place id>', 'breakrocks my-places show ROUTE <route id> --json'],
}));

export const myPlacesSave = mine(apiCommand({
  name: 'my-places save', summary: 'Save a place, an experience feat, an event or a route to My places (saveToMyPlaces)',
  description: `${SAVED_KINDS}. A thing already saved answers its saved item unchanged. Nobody is told. MY_PLACES_FULL (5,000, those that no longer exist included), MY_PLACES_TARGET_INVALID (a post, a thing that does not exist or that you may not read, an experience feat not published), MY_PLACES_TAGS_TOO_MANY (5), MY_PLACES_NOTE_TOO_LONG (500). A delegated agent saves for its human, never so that the saved item shows in a shared playlist.`,
  kind: 'mutation', op: 'saveToMyPlaces', positionals: ['input.kind', 'input.targetId'], rename: { 'input.tagIds': 'tags' }, select: SAVED, dry: true,
  descriptions: itemDescriptions, prepare: async (i, ctx) => (i.tags ? { ...i, tags: await tagIdsOf(ctx, i.tags as string[]) } : i), text: savedText,
  examples: ['breakrocks my-places save PLACE <place id>', 'breakrocks my-places save ROUTE <route id> --tags to-try --note "Ride it in spring"'],
}), NEVER_SHARED_TAG);

export const myPlacesEdit = mine(apiCommand({
  name: 'my-places edit', summary: 'Change the tags and the note of a saved item (updateSavedItem)',
  description: 'A field not given stays: --tags replaces the My places tags (0 to 5; --clear-tags for none), --note the note (an empty text removes it). Putting the starting tag done records the date. A delegated agent never puts a shared My places tag.',
  kind: 'mutation', op: 'updateSavedItem', positionals: ['itemId'], rename: { 'input.tagIds': 'tags' }, select: SAVED, dry: true,
  extra: { clearTags: bool('Take every My places tag off the saved item') },
  descriptions: itemDescriptions,
  prepare: async (i, ctx) => {
    const { clearTags, ...rest } = i;
    if (clearTags && rest.tags !== undefined) throw usageError('INVALID_INPUT', '--clear-tags and --tags together');
    if (clearTags) return { ...rest, tags: [] };
    return rest.tags ? { ...rest, tags: await tagIdsOf(ctx, rest.tags as string[]) } : rest;
  },
  text: savedText, examples: ['breakrocks my-places edit <item id> --tags done', 'breakrocks my-places edit <item id> --clear-tags --note ""'],
}), NEVER_SHARED_TAG);

export const myPlacesRemove = mine(apiCommand({
  name: 'my-places remove', summary: 'Remove one saved item from My places (removeSavedItem)', kind: 'mutation', op: 'removeSavedItem', positionals: ['itemId'], dry: true,
  description: 'In one gesture, for good; the thing itself is not touched. One saved item per call, a delegated agent too, within the rate limits of its account.',
  descriptions: itemDescriptions, text: doneText, examples: ['breakrocks my-places remove <item id>'],
}));

export const myPlacesClear = mine(apiCommand({
  name: 'my-places clear', summary: 'Delete the whole of My places, for good (clearMyPlaces)',
  description: 'Deletes every saved item, every My places tag and the playlists of the form MAP that shared them; the account then has "To try" and "Done" again, as at the start. Final: it needs --yes (a confirmation). A delegated agent never does it (DELEGATED_AGENT_NOT_ALLOWED).',
  kind: 'mutation', op: 'clearMyPlaces', confirm: () => 'Delete the whole of My places: every saved item, every My places tag, and the playlists that share them? This is final.', text: doneText,
  examples: ['breakrocks my-places clear --yes'],
}), NEVER_CLEARS);

// ---- My places tags ----

export const myPlacesTags = mine(apiCommand({
  name: 'my-places tags', summary: 'Your My places tags, with their saved items and what is shared (myPlacesTags)', kind: 'query', op: 'myPlacesTags', select: TAG,
  description: '100 at most; "To try" and "Done" first until deleted, then in the order created. The tags play the role of the lists of My places.',
  text: (r) => (Array.isArray(r) && r.length ? (r as Tag[]).map(tagLine).join('\n') : '(no My places tag)'), examples: ['breakrocks my-places tags', 'breakrocks my-places tags --json'],
}));

export const myPlacesTagsCreate = mine(apiCommand({
  name: 'my-places tags create', summary: 'Create a My places tag (createMyPlacesTag)', kind: 'mutation', op: 'createMyPlacesTag', positionals: ['name'], select: TAG, dry: true,
  description: 'It follows the rules of a tag (TAG_INVALID), of one color among the 8 of the ambiance colors: AUBERGINE, BRICK, FOREST, INK, LAGOON, MUSTARD, OLIVE, SLATE. MY_PLACES_TAG_NAME_TAKEN, MY_PLACES_TAG_LIMIT (100).',
  descriptions: { name: 'Its name, without "#"', color: 'Its color: AUBERGINE, BRICK, FOREST, INK, LAGOON, MUSTARD, OLIVE or SLATE' },
  prepare: (i) => ({ ...i, name: String(i.name).trim().replace(/^#/, '') }), text: tagText,
  examples: ['breakrocks my-places tags create bakeries --color MUSTARD'],
}));

export const myPlacesTagsEdit = mine(apiCommand({
  name: 'my-places tags edit', summary: 'Rename a My places tag or change its color (updateMyPlacesTag)', kind: 'mutation', op: 'updateMyPlacesTag', positionals: ['tag'], hide: ['tagId'], select: TAG, dry: true,
  description: 'A field not given stays. A starting tag renamed is shown as written from then on. The playlist that shares the tag keeps its name. A delegated agent never renames a shared My places tag.',
  extra: { tag: str(TAG_DESC) }, require: ['tag'], descriptions: { name: 'Its new name, without "#"', color: 'Its new color: AUBERGINE, BRICK, FOREST, INK, LAGOON, MUSTARD, OLIVE or SLATE' },
  prepare: async (i, ctx) => {
    const { tag, ...rest } = i;
    return { ...rest, tagId: await tagIdOf(ctx, String(tag)), ...(rest.name !== undefined ? { name: String(rest.name).trim().replace(/^#/, '') } : {}) };
  },
  text: tagText, examples: ['breakrocks my-places tags edit to-try --color LAGOON', 'breakrocks my-places tags edit bakeries --name pastry'],
}), NEVER_SHARED_TAG);

export const myPlacesTagsDelete = mine(apiCommand({
  name: 'my-places tags delete', summary: 'Delete a My places tag; its saved items stay (deleteMyPlacesTag)', kind: 'mutation', op: 'deleteMyPlacesTag', positionals: ['tag'], hide: ['tagId'], dry: true,
  description: 'In one gesture: the tag leaves its saved items, which stay; the playlist of the form MAP that shares it is deleted. A delegated agent never deletes a shared My places tag.',
  extra: { tag: str(TAG_DESC) }, require: ['tag'], prepare: async (i, ctx) => { const { tag, ...rest } = i; return { ...rest, tagId: await tagIdOf(ctx, String(tag)) }; },
  text: doneText, examples: ['breakrocks my-places tags delete bakeries'],
}), NEVER_SHARED_TAG);

// ---- Sharing: playlists of the form MAP ----

type Shared = { id: string; address?: string | null; name: string; form?: string; visibility?: string; itemCount?: number };
const PLAYLIST = '{ id address name form visibility itemCount }';
const sharedLine = (p: Shared) => `${p.address ?? p.id}  ${p.name}  ${p.form ?? 'MAP'}  ${(p.visibility ?? '').toLowerCase()}  ${p.itemCount ?? 0} saved items`;

export const myPlacesShare = mine(apiCommand({
  name: 'my-places share', summary: 'Share a My places tag, or all of My places, as a playlist (shareMyPlaces)',
  description: 'Shares a My places tag (--tag), or the whole of My places (no --tag), as an account playlist of the form MAP named <name> (PLAYLIST_NAME_INVALID, PLAYLIST_NAME_TAKEN, ACCOUNT_PLAYLIST_LIMIT), PRIVATE unless --visibility says PUBLIC or UNLISTED. It holds the saved items of the tag, or of all of My places, as they change, never their notes nor their other tags. Sharing all of My places shares what you save later too: it needs --yes. MY_PLACES_ALREADY_SHARED when it already is. A delegated agent never shares My places (DELEGATED_AGENT_NOT_ALLOWED). Stop sharing: playlists delete <address>.',
  kind: 'mutation', op: 'shareMyPlaces', positionals: ['name'], rename: { tagId: 'tag' }, select: PLAYLIST, dry: true,
  descriptions: { name: 'The name of the playlist', tag: TAG_DESC, visibility: 'PUBLIC, UNLISTED or PRIVATE (the default)' },
  prepare: async (i, ctx) => {
    if (i.tag === undefined && !i.dryRun) await ctx.confirm('Share the whole of My places as a playlist? What you save later is shared too (never the notes).');
    return i.tag === undefined ? i : { ...i, tag: await tagIdOf(ctx, String(i.tag)) };
  },
  text: (r) => (r ? sharedLine(r as Shared) : '(none)'),
  examples: ['breakrocks my-places share bakeries --tag bakeries --visibility PUBLIC', 'breakrocks my-places share "All my places" --yes'],
}), NEVER_SHARES);
export const myPlacesSharedAll = mine(apiCommand({
  name: 'my-places shared', summary: 'The playlist that shares all of My places, if any (myPlacesPlaylist)', kind: 'query', op: 'myPlacesPlaylist', select: PLAYLIST,
  description: 'None when the whole of My places is not shared (a shared tag: my-places tags). Deleting the playlist stops sharing; the tag and the saved items stay.',
  text: (r) => (r ? sharedLine(r as Shared) : '(the whole of My places is not shared)'), examples: ['breakrocks my-places shared'],
}));
// `my-places share` asks its own confirmation for the whole of My places only: MCP and the help must know.
export const myPlacesShareInteractive: Command<Record<string, unknown>, unknown> = { ...myPlacesShare, interactive: true };

// ---- The saved items of a playlist of the form MAP ----

type MapItem = { kind: string; targetId: string; name: string; point?: Point | null; inCommon: boolean };
type MapItems = { id: string; address?: string | null; name: string; form?: string; visibility?: string; itemCount?: number; mapItems: { items: MapItem[]; next: string | null; total: number } | null };
const mapItemLine = (m: MapItem) => `${m.kind}  ${m.name}  ${m.targetId}${m.point ? `  ${m.point.lat},${m.point.lon}` : ''}${m.inCommon ? '  in common' : ''}`;

export const myPlacesPlaylist: Command<{ playlist: string; inCommon?: boolean; cells?: string[]; after?: string; limit?: number; all?: boolean; max?: number }, MapItems | null> = {
  name: 'my-places playlist', summary: 'The saved items of a shared My places playlist (a playlist of the form MAP)',
  description: 'Reads the saved items of a playlist of the form MAP (Playlist.mapItems) as you may read them, by name, never by date saved, without any note nor other tag; a route at its route start marker for you; those that no longer exist and those of an account blocked either way left out. --in-common: only those you saved too, for a playlist you opened (by its address) or follow (MY_PLACES_IN_COMMON_NOT_ALLOWED otherwise). --cells: the H3 map cells of the area shown (1 to 7 of one resolution, 0 to 9). Another playlist form: nothing (playlists show). While the platform keeps My places closed, the playlist is "not available" (PLAYLIST_NOT_FOUND).',
  examples: ['breakrocks my-places playlist @erin>places', 'breakrocks my-places playlist @erin>places --in-common --all'],
  input: object({
    playlist: str('The playlist: its address (@erin>places)'), inCommon: bool('Only the saved items you saved too'),
    cells: list('The H3 map cells that cover the area shown: 1 to 7 of one resolution, 0 to 9', { type: 'string' }), after: str('The cursor of the next page (the "next" of an answer)'),
    limit: int('How many at most per page, 1 to 500 (100 by default)', { minimum: 1, maximum: 500 }), all: bool('Follow the pages to the end (bounded by --max)'),
    max: int('Pages at most with --all', { minimum: 1, maximum: 100, default: 10 }),
  }, ['playlist']),
  output: openObject({ id: str('The playlist'), address: str('Its address'), name: str('Its name'), mapItems: openObject({ items: list('The saved items', { type: 'object' }), next: str('The next page'), total: int('How many in all') }) }, 'The playlist and its saved items (Playlist.mapItems)'),
  args: { positionals: ['playlist'] },
  run: async (ctx, i) => {
    checkCells(i.cells, '--cells');
    const address = i.playlist.trim();
    if (!address.includes('>')) throw usageError('PLAYLIST_ADDRESS_INVALID', 'The playlist is read by its address (@erin>places): the API reads a playlist by its address only');
    return served('My places', async () => {
      const read = async (after: string | undefined) => (await api<{ playlist: MapItems | null }>(ctx, `query($a: String!, $c: Boolean, $m: [String!], $n: String, $l: Int) { playlist(address: $a) { id address name form visibility itemCount mapItems(inCommon: $c, mapCells: $m, after: $n, limit: $l) { items { kind targetId name point { lat lon } inCommon } next total } } }`, { a: address, c: i.inCommon, m: i.cells, n: after, l: i.limit })).playlist;
      let page = await read(i.after);
      if (page?.mapItems && i.all) {
        const items = [...page.mapItems.items];
        let next = page.mapItems.next;
        for (let n = 1; next && n < (i.max ?? 10); n++) {
          const more = (await read(next))?.mapItems;
          if (!more) break;
          items.push(...more.items);
          next = more.next;
        }
        page = { ...page, mapItems: { ...page.mapItems, items, next } };
      }
      return page;
    }, SINCE);
  },
  text: (r) => {
    if (!r) return '(none)';
    if (!r.mapItems) return `${r.address ?? r.id}  ${r.name}: not a playlist of the form MAP (${r.form ?? 'SIMPLE'}): breakrocks playlists show`;
    const m = r.mapItems;
    return [`${r.address ?? r.id}  ${r.name}  ${m.total} saved item${m.total === 1 ? '' : 's'}`, ...m.items.map(mapItemLine), ...(m.next ? [`next: ${m.next}`] : [])].join('\n');
  },
  quiet: (r) => r?.id,
};

export const myPlacesCommands = [myPlacesList, myPlacesShow, myPlacesSave, myPlacesEdit, myPlacesRemove, myPlacesClear, myPlacesTags, myPlacesTagsCreate, myPlacesTagsEdit, myPlacesTagsDelete, myPlacesShareInteractive, myPlacesSharedAll, myPlacesPlaylist];
