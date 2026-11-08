// Playlists (specs v86.0.0, playlists.feature): series, account playlists, universe playlists and "Watch later",
// their forms (SIMPLE, SECTIONS, CHAPTERS, ROUTE since v101.3.0: its items tied to the stages of a route), courses
// with their links and documents (v87.1.0, v87.5.0), the progress, checkmarks, tags and tracks of the reader; and
// the long videos (v86.0.0, long-videos.feature): their view, chapters, playback and the video quota. A playlist
// is named by its address (@erin>journey, %paris>walks) or its id. Continuous play, passages and montages are
// deferred by the platform (NOT_IMPLEMENTED since v101.5.0): not offered. The writes offer --dry-run.
import { apiCommand } from '../api/command.js';
import { selection } from '../api/graphql.js';
import type { Context } from '../context.js';
import { usageError } from '../errors.js';
import { checkDocument, uploadDocument } from '../media.js';
import { str } from '../schema.js';
import { api } from '../session.js';
import { doneText, pageText } from './shared.js';

/** The id of a playlist given by its address (with ">") or by its id. */
export async function playlistIdOf(ctx: Context, value: string): Promise<string> {
  const v = value.trim();
  if (!v.includes('>')) return v;
  const p = (await api<{ playlist: { id: string } | null }>(ctx, 'query($a: String!) { playlist(address: $a) { id } }', { a: v })).playlist;
  if (!p) throw usageError('PLAYLIST_NOT_FOUND', `No playlist ${v}`, { address: v });
  return p.id;
}

const PLAYLIST_DESC = 'The playlist: its address (@erin>journey, %paris>walks) or its id';
/** A command on one playlist: --playlist (positional first) in place of playlistId. */
const onPlaylist = (more: string[] = []) => ({
  positionals: ['playlist', ...more], hide: ['playlistId'], extra: { playlist: str(PLAYLIST_DESC) }, require: ['playlist'],
  prepare: async (i: Record<string, unknown>, ctx: Context) => { const { playlist, ...rest } = i; return { ...rest, playlistId: await playlistIdOf(ctx, String(playlist)) }; },
});

type Playlist = { id: string; address?: string | null; name: string; kind: string; form?: string; visibility?: string; itemCount?: number; followerCount?: number; followed?: boolean; pinned?: boolean; route?: { id: string; name: string } | null };
const playlistLine = (p: Playlist) => `${p.address ?? p.id}  ${p.name}  ${p.kind}${p.form ? `/${p.form}` : ''}  ${p.visibility ?? ''}  ${p.itemCount ?? 0} items${p.followed ? '  followed' : ''}${p.pinned ? '  pinned' : ''}${p.route ? `  route ${p.route.name}` : ''}  [${p.id}]`;
const playlistText = (r: unknown) => (r ? playlistLine(r as Playlist) : '(none)');
const PLAYLIST = selection('Playlist', 2);

export const playlistsHub = apiCommand({
  name: 'playlists hub', summary: 'The playlists of the account: its own, those it follows, and "Watch later" (playlistsHub)', kind: 'query', op: 'playlistsHub', select: `{ mine ${selection('Playlist', 1)} followed ${selection('Playlist', 1)} watchLater ${selection('Playlist', 1)} }`,
  text: (r) => { const h = r as { mine?: Playlist[]; followed?: Playlist[]; watchLater?: Playlist } | null; if (!h) return '(none)'; return ['mine:', ...(h.mine ?? []).map((p) => `  ${playlistLine(p)}`), 'followed:', ...(h.followed ?? []).map((p) => `  ${playlistLine(p)}`), ...(h.watchLater ? ['watch later:', `  ${playlistLine(h.watchLater)}`] : [])].join('\n'); },
  examples: ['breakrocks playlists hub', 'breakrocks playlists hub --json'],
});
export const playlistsFollowed = apiCommand({
  name: 'playlists followed', summary: 'The playlists the account follows, the most recently changed first (followedPlaylists)', kind: 'query', op: 'followedPlaylists', select: `{ items ${selection('Playlist', 1)} next }`,
  text: pageText(playlistLine), examples: ['breakrocks playlists followed', 'breakrocks playlists followed --all --json'],
});

type Entry = { item?: { position: number; kind: string; checked?: boolean; watched?: boolean; stageIndex?: number | null; tags?: string[]; post?: { id: string; text?: string } } | null; courseItem?: { id: string; position: number; kind: string; title: string; url?: string | null; checked?: boolean } | null; locked?: unknown; removed?: unknown };
const ENTRY = '{ item { position kind checked watched tags sectionId stageIndex addedAt post { id text url } } courseItem { id position kind title url checked sectionId tags document { __typename } } locked { __typename } removed { __typename } }';
export const playlistsShow = apiCommand({
  name: 'playlists show', summary: 'A playlist and its items (50 at most), as the account reads it: its form, its route and the stage of each item, the progress (playlist)',
  description: 'A PUBLIC or UNLISTED playlist is read by anyone, a PRIVATE one by its owner only (PLAYLIST_NOT_FOUND otherwise).',
  kind: 'query', op: 'playlist', positionals: ['address'], descriptions: { address: 'The address of the playlist (@erin>journey, %paris>walks)' },
  select: `${PLAYLIST.slice(0, -1)} entries(limit: 50) { entries ${ENTRY} next } }`,
  text: (r) => {
    const p = r as (Playlist & { entries?: { entries?: Entry[] } }) | null;
    if (!p) return '(none)';
    const lines = (p.entries?.entries ?? []).map((e) => e.item ? `${e.item.position}. ${e.item.kind}${e.item.stageIndex != null ? ` stage ${e.item.stageIndex}` : ''}${e.item.checked || e.item.watched ? ' ✓' : ''}  ${e.item.post?.id ?? ''}  ${(e.item.post?.text ?? '').replace(/\s+/g, ' ').slice(0, 50)}`
      : e.courseItem ? `${e.courseItem.position}. ${e.courseItem.kind}${e.courseItem.checked ? ' ✓' : ''}  ${e.courseItem.title}${e.courseItem.url ? `  ${e.courseItem.url}` : ''}  [${e.courseItem.id}]` : e.locked ? '(locked)' : '(removed)');
    return [playlistLine(p), ...lines].join('\n');
  },
  examples: ['breakrocks playlists show @erin>journey', 'breakrocks playlists show %paris>walks --json'],
});
const playlistInput = {
  name: 'The name of the playlist', kind: 'ACCOUNT (an account playlist), SERIES (a series of one\'s long videos) or UNIVERSE (by the leadership of --universe)', form: 'SIMPLE, SECTIONS, CHAPTERS (a course) or ROUTE (with --route-id; MONTAGE is deferred)',
  routeId: 'The route of the form ROUTE: its items tied to its stages (routes list)', universe: 'The universe of a universe playlist', visibility: 'PUBLIC, UNLISTED or PRIVATE',
  sections: 'The sections: [{ "name", "title" }] (JSON)', course: 'The course: { "orderedPlayback", "sections": [{ "title" }] } (JSON)', revealMembership: 'Make public a PRIVATE playlist holding videos of private universes (PLAYLIST_REVEALS_MEMBERSHIP otherwise)',
};
export const playlistsCreate = apiCommand({
  name: 'playlists create', summary: 'Create a playlist: an account playlist, a series, or a universe playlist; its form, a route for the form ROUTE (createPlaylist)',
  kind: 'mutation', op: 'createPlaylist', positionals: ['input.name'], descriptions: playlistInput, dry: true, text: playlistText,
  examples: ['breakrocks playlists create journey --kind ACCOUNT --visibility PUBLIC', 'breakrocks playlists create canal-walk --kind ACCOUNT --form ROUTE --route-id <route id>'],
});
export const playlistsEdit = apiCommand({
  name: 'playlists edit', summary: 'Change a playlist: its name, description, form, route, visibility, sections or course (updatePlaylist; a field not given stays)',
  kind: 'mutation', op: 'updatePlaylist', ...onPlaylist(), descriptions: playlistInput, dry: true, text: playlistText,
  examples: ['breakrocks playlists edit @erin>journey --visibility UNLISTED', 'breakrocks playlists edit <playlist id> --form ROUTE --route-id <route id>'],
});
export const playlistsDelete = apiCommand({
  name: 'playlists delete', summary: 'Delete a playlist (never "Watch later"); its videos stay (deletePlaylist)', kind: 'mutation', op: 'deletePlaylist', ...onPlaylist(),
  confirm: (i) => `Delete the playlist ${String(i.playlist ?? i.playlistId)}?`, text: doneText, examples: ['breakrocks playlists delete @erin>journey --yes'],
});
export const playlistsAdd = apiCommand({
  name: 'playlists add', summary: 'Add a post with a video (a post without one to a course) to a playlist, at a position, in a section, tied to a stage of its route (addToPlaylist)',
  description: 'A video already there is moved; 500 items at most (PLAYLIST_FULL). --stage: in a playlist of the form ROUTE, the index of the stage of its route the item is tied to (the order of the stages is kept). "Watch later": the id of playlists hub. Passages (passageStartMs, passageEndMs) are deferred by the platform.',
  kind: 'mutation', op: 'addToPlaylist', ...onPlaylist(['postId']), hide: ['playlistId', 'passageStartMs', 'passageEndMs'], rename: { stageIndex: 'stage' }, dry: true, text: playlistText,
  descriptions: { postId: 'The post', position: 'Its position, from 1 (none: at the end)', sectionId: 'The section of a course', stage: 'The index of the stage of the route (form ROUTE)', revealMembership: playlistInput.revealMembership },
  examples: ['breakrocks playlists add @erin>journey <post id>', 'breakrocks playlists add @erin>canal-walk <post id> --stage 2'],
});
export const playlistsRemove = apiCommand({
  name: 'playlists remove', summary: 'Remove a video from a playlist (removeFromPlaylist)', kind: 'mutation', op: 'removeFromPlaylist', ...onPlaylist(['postId']), dry: true, text: doneText,
  descriptions: { postId: 'The post' }, examples: ['breakrocks playlists remove @erin>journey <post id>'],
});
export const playlistsMove = apiCommand({
  name: 'playlists move', summary: 'Move a video of a playlist to a position (from 1) and, in a course, a section (movePlaylistItem)', description: 'In a playlist of the form ROUTE, a move that breaks the order of the stages: INVALID_REQUEST.',
  kind: 'mutation', op: 'movePlaylistItem', ...onPlaylist(['postId', 'position']), dry: true, text: playlistText,
  descriptions: { postId: 'The post', position: 'Its new position, from 1', sectionId: 'The section of a course' }, examples: ['breakrocks playlists move @erin>journey <post id> 1'],
});
const follow = (following: boolean) => apiCommand({
  name: `playlists ${following ? 'follow' : 'unfollow'}`, summary: `${following ? 'Follow' : 'Stop following'} a playlist (setPlaylistFollow)`, kind: 'mutation', op: 'setPlaylistFollow', fixed: { following }, positionals: ['address'],
  descriptions: { address: 'The address of the playlist (@erin>journey)' }, text: playlistText, examples: [`breakrocks playlists ${following ? 'follow' : 'unfollow'} @erin>journey`],
});
export const playlistsFollow = follow(true);
export const playlistsUnfollow = follow(false);
const pin = (pinned: boolean) => apiCommand({
  name: `playlists ${pinned ? 'pin' : 'unpin'}`, summary: `${pinned ? 'Pin' : 'Unpin'} a universe playlist on the page of its universe, by its leadership (pinPlaylist${pinned ? '; 3 at most' : ''})`, kind: 'mutation', op: 'pinPlaylist', fixed: { pinned }, ...onPlaylist(),
  text: playlistText, examples: [`breakrocks playlists ${pinned ? 'pin' : 'unpin'} %paris>walks`],
});
export const playlistsPin = pin(true);
export const playlistsUnpin = pin(false);

const courseItem = { title: 'Its title (1 to 80 visible characters)', url: 'The link (https, no redirect to another domain)', position: 'Its position, from 1', sectionId: 'Its section of the course', tags: 'Its playlist tags (8 per playlist)', itemId: 'The course link or course document (its id: playlists show)' };
export const playlistsAddLink = apiCommand({
  name: 'playlists add-link', summary: 'Add a course link to a course (form CHAPTERS): its title and its https destination, reviewed as the destination of an ad (addLinkToPlaylist)',
  kind: 'mutation', op: 'addLinkToPlaylist', ...onPlaylist(), descriptions: courseItem, dry: true, text: playlistText,
  examples: ['breakrocks playlists add-link @erin>course --title "The reference" --url https://example.org/ref'],
});
type DocInput = { playlist: string; file: string; rightsConfirmed?: boolean; title?: string; itemId?: string; position?: number; sectionId?: string; tags?: string[]; dryRun?: boolean };
export const playlistsAddDoc = apiCommand({
  name: 'playlists add-doc', summary: 'Add a course document to a course (or a new version of one, --item-id): a PDF of 20 MB or a markdown text of 200 KB, sent then checked (requestDocumentUpload, addDocumentToPlaylist)',
  description: 'The file is checked, sent, then added; it stays CHECKING until its malware scan and its media review are done. --rights-confirmed is required (DOCUMENT_RIGHTS_REQUIRED). DOCUMENT_LIMIT: 50 course documents per account (100 with X2, 500 with X10).',
  kind: 'mutation', op: 'addDocumentToPlaylist', ...onPlaylist(['file']), hide: ['playlistId', 'input.uploadId'], dry: true, text: playlistText,
  extra: { playlist: str(PLAYLIST_DESC), file: str('The document: a .pdf or a .md file') }, require: ['playlist', 'file'],
  descriptions: { ...courseItem, rightsConfirmed: 'I hold the rights to share this document (required)' },
  prepare: async (i, ctx) => {
    const { playlist, file, ...rest } = i as DocInput & Record<string, unknown>;
    const doc = checkDocument(ctx, file);
    const playlistId = await playlistIdOf(ctx, playlist);
    if (rest.dryRun) return { ...rest, playlistId, 'input.uploadId': `(${doc.name}, ${doc.type}, ${doc.bytes} bytes: sent on the real run)` };
    return { ...rest, playlistId, 'input.uploadId': await uploadDocument(ctx, doc, playlistId) };
  },
  examples: ['breakrocks playlists add-doc @erin>course notes.pdf --title "The notes" --rights-confirmed', 'breakrocks playlists add-doc @erin>course notes.md --item-id <item id> --rights-confirmed'],
});
export const playlistsItemEdit = apiCommand({
  name: 'playlists item-edit', summary: 'Change a course link or a course document: its title, the URL of a link, its place, its tags (updatePlaylistCourseItem)', kind: 'mutation', op: 'updatePlaylistCourseItem', ...onPlaylist(['itemId']), descriptions: courseItem, dry: true, text: playlistText,
  examples: ['breakrocks playlists item-edit @erin>course <item id> --title "The reference, 2nd edition"'],
});
export const playlistsItemRemove = apiCommand({
  name: 'playlists item-remove', summary: 'Remove a course link or a course document from a course (its file deleted) (removePlaylistCourseItem)', kind: 'mutation', op: 'removePlaylistCourseItem', ...onPlaylist(['itemId']), descriptions: courseItem, text: doneText,
  confirm: (i) => `Remove the item ${String(i.itemId)} from ${String(i.playlist)}?`, examples: ['breakrocks playlists item-remove @erin>course <item id> --yes'],
});
export const playlistsCheck = apiCommand({
  name: 'playlists check', summary: 'Check a post of a course for oneself, once opened from it (checkPlaylistItem; a video is checked by videos playback)', kind: 'mutation', op: 'checkPlaylistItem', ...onPlaylist(['postId']), text: doneText,
  descriptions: { postId: 'The post (kind POST) of the course' }, examples: ['breakrocks playlists check @erin>course <post id>'],
});
export const playlistsCheckItem = apiCommand({
  name: 'playlists check-item', summary: 'Check a course link or a course document for oneself, once opened (checkPlaylistCourseItem)', kind: 'mutation', op: 'checkPlaylistCourseItem', ...onPlaylist(['itemId']), descriptions: courseItem, text: doneText,
  examples: ['breakrocks playlists check-item @erin>course <item id>'],
});
export const playlistsResetProgress = apiCommand({
  name: 'playlists reset-progress', summary: 'Clear every checkmark of one\'s own in a playlist, every track together; the resume point stays (resetPlaylistProgress)', kind: 'mutation', op: 'resetPlaylistProgress', ...onPlaylist(), text: doneText,
  confirm: (i) => `Clear your progress in ${String(i.playlist)}?`, examples: ['breakrocks playlists reset-progress @erin>course --yes'],
});
export const playlistsCheckmarks = apiCommand({
  name: 'playlists checkmarks', summary: 'Show (--shown) or hide (--no-shown) the checkmarks of a SIMPLE playlist for oneself (setPlaylistCheckmarks)', kind: 'mutation', op: 'setPlaylistCheckmarks', ...onPlaylist(), text: playlistText,
  descriptions: { shown: 'true: show them; false: hide them' }, examples: ['breakrocks playlists checkmarks @erin>journey --no-shown'],
});
export const playlistsTags = apiCommand({
  name: 'playlists tags', summary: 'Set the playlist tags of an item, all at once (none: --tags ""; 8 per playlist) (setPlaylistItemTags)', kind: 'mutation', op: 'setPlaylistItemTags', ...onPlaylist(['postId', 'tags']), dry: true, text: playlistText,
  descriptions: { postId: 'The post', tags: 'Its playlist tags' }, examples: ['breakrocks playlists tags @erin>course <post id> basics video'],
});
export const playlistsTrack = apiCommand({
  name: 'playlists track', summary: 'Pick one\'s playlist track (none: back to the track by default) (setPlaylistTrack)', kind: 'mutation', op: 'setPlaylistTrack', ...onPlaylist(['track']), text: playlistText,
  descriptions: { track: 'The name of the track (none: the default track)' }, examples: ['breakrocks playlists track @erin>course quick', 'breakrocks playlists track @erin>course'],
});
export const playlistsTracks = apiCommand({
  name: 'playlists tracks', summary: 'Set the playlist tracks of a playlist, all at once, in order (10 at most; [] none) (setPlaylistTracks)', kind: 'mutation', op: 'setPlaylistTracks', ...onPlaylist(), dry: true, text: playlistText,
  descriptions: { tracks: 'The tracks: [{ "name", "title", "tags": [...] }] (JSON)' }, examples: ['breakrocks playlists tracks @erin>course --tracks \'[{"name":"quick","title":"The quick way","tags":["basics"]}]\''],
});

// ---- Long videos ----

type PostLine = { id: string; createdAt?: string; author?: { handle?: string } | null; text?: string; universe?: string };
export const videosList = apiCommand({
  name: 'videos list', summary: 'The long videos of an address (a universe, an account, a tag), or of what the account follows; --query searches their posts (longVideos)', kind: 'query', op: 'longVideos', positionals: ['address'], select: `{ items ${selection('Post', 1)} next }`,
  descriptions: { address: 'The address (%universe, @handle, #tag); none: what the account follows', query: 'A text searched in their posts' },
  text: pageText((p: PostLine) => `${p.id}  ${p.createdAt ?? ''}  ${p.author?.handle ? `@${p.author.handle}` : '-'}  ${p.universe ?? ''}  ${(p.text ?? '').replace(/\s+/g, ' ').slice(0, 60)}`),
  examples: ['breakrocks videos list %paris', 'breakrocks videos list --query "final" --json'],
});
const chapterLine = (c: { startSeconds: number; title: string }) => `${Math.floor(c.startSeconds / 60)}:${String(c.startSeconds % 60).padStart(2, '0')}  ${c.title}`;
export const videosChaptersPropose = apiCommand({
  name: 'videos chapters propose', summary: 'The chapters the platform proposes from the subtitles of one\'s long video, shown to nobody until set (proposedChapters)', kind: 'query', op: 'proposedChapters', positionals: ['postId'],
  descriptions: { postId: 'The post with the long video' }, text: (r) => (Array.isArray(r) && r.length ? r.map(chapterLine).join('\n') : '(none)'), examples: ['breakrocks videos chapters propose <post id>'],
});
/** "0=Intro;1:30=The match" (or the JSON [{ startSeconds, title }]) → the chapters. */
export function chaptersOf(value: string): { startSeconds: number; title: string }[] {
  const s = value.trim();
  if (!s) return [];
  if (s.startsWith('[')) { try { return JSON.parse(s); } catch { throw usageError('CHAPTERS_INVALID', '--chapters: JSON expected'); } }
  return s.split(';').map((part) => {
    const at = part.indexOf('=');
    const time = part.slice(0, at).trim(), title = part.slice(at + 1).trim();
    if (at < 0 || !/^\d+(:\d{1,2}){0,2}$/.test(time) || !title) throw usageError('CHAPTERS_INVALID', `--chapters: <time>=<title>;… (0=Intro;1:30=The match), not "${part}"`);
    return { startSeconds: time.split(':').reduce((n, x) => n * 60 + Number(x), 0), title };
  });
}
export const videosChaptersSet = apiCommand({
  name: 'videos chapters set', summary: 'Set the chapters of one\'s long video, all at once ("" removes them) (setChapters)', kind: 'mutation', op: 'setChapters', positionals: ['postId'], hide: ['chapters'], dry: true,
  extra: { chapters: str('The chapters: <time>=<title>;… (0=Intro;1:30=The match), or their JSON [{ "startSeconds", "title" }]; "" none') }, require: ['chapters'],
  descriptions: { postId: 'The post with the long video' },
  prepare: (i) => ({ ...i, chapters: chaptersOf(String(i.chapters)) }),
  text: (r) => { const v = r as { id?: string; chapters?: { startSeconds: number; title: string }[] } | null; return v ? [`${v.id}: ${v.chapters?.length ?? 0} chapters`, ...(v.chapters ?? []).map(chapterLine)].join('\n') : '(none)'; },
  examples: ['breakrocks videos chapters set <post id> --chapters "0=Intro;1:30=The match"'],
});
export const videosPlayback = apiCommand({
  name: 'videos playback', summary: 'Record where one is in a long video (the second; --watched once at 90 %), from a playlist or not (recordPlayback)', kind: 'mutation', op: 'recordPlayback', positionals: ['postId', 'seconds'], hide: ['playlistId'], text: doneText,
  extra: { playlist: { type: 'string', description: `The playlist it is played from: ${PLAYLIST_DESC}` } },
  descriptions: { postId: 'The post with the long video', seconds: 'The second reached', watched: 'Played to 90 % of its length (checks it in the playlist)' },
  prepare: async (i, ctx) => { const { playlist, ...rest } = i; return playlist ? { ...rest, playlistId: await playlistIdOf(ctx, String(playlist)) } : rest; },
  examples: ['breakrocks videos playback <post id> 120', 'breakrocks videos playback <post id> 3540 --watched --playlist @erin>journey'],
});
export const videosQuota = apiCommand({
  name: 'videos quota', summary: 'The video quota of the account: its minutes, those left, when minutes come back (myVideoQuota)', kind: 'query', op: 'myVideoQuota',
  text: (r) => { const q = r as { limitMinutes: number; minutesLeft: number; nextReturnAt?: string | null } | null; return q ? `${q.minutesLeft} of ${q.limitMinutes} minutes left${q.nextReturnAt ? `, more back at ${q.nextReturnAt}` : ''}` : '(none)'; },
  examples: ['breakrocks videos quota', 'breakrocks videos quota --json'],
});
