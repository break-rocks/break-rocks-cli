// The universe visit history of the account (D-247, specs v83.0.0), synced on the account: the list, one
// universe removed, all of it cleared (irreversible: "yes"), the pause, and a visit recorded on purpose.
// A visit is NEVER recorded implicitly: reading a universe (universes show, a post, a feed…) does not call
// recordUniverseVisit; only `universes visit` does, and the platform deduplicates it (10 minutes) and
// ignores it while the history is paused.
import { apiCommand } from '../api/command.js';
import { selection } from '../api/graphql.js';
import { doneText } from './shared.js';

type Entry = { universe: string; parent?: string | null; private?: boolean; visitedAt: string };

export const universesHistory = apiCommand({
  name: 'universes history', summary: 'The universe visit history of the account, the most recent visit first (universeHistory; 50 at most kept)',
  description: 'Not the recent universes of Explore (universes list --recent). Entries kept while the history was paused are still listed. --limit from 1 to 50 (10 by default).',
  kind: 'query', op: 'universeHistory',
  text: (r) => (Array.isArray(r) && r.length ? (r as Entry[]).map((e) => `${e.universe}${e.private ? ' (private)' : ''}${e.parent ? `  in ${e.parent}` : ''}  ${e.visitedAt}`).join('\n') : '(none)'),
  examples: ['breakrocks universes history', 'breakrocks universes history --limit 50 --json'],
});

export const universesHistoryRemove = apiCommand({
  name: 'universes history remove', summary: 'Remove one universe from the visit history (removeRecentUniverse; true also when absent)',
  kind: 'mutation', op: 'removeRecentUniverse', positionals: ['universe'], dry: true, descriptions: { universe: 'The universe (%name, %name/sub)' },
  examples: ['breakrocks universes history remove %paris', 'breakrocks universes history remove %paris --dry-run'],
});

export const universesHistoryClear = apiCommand({
  name: 'universes history clear', summary: 'Clear the whole visit history (clearRecentUniverses)',
  kind: 'mutation', op: 'clearRecentUniverses', dry: true, confirm: () => 'Clear the whole universe visit history of the account?',
  examples: ['breakrocks universes history clear --yes', 'breakrocks universes history clear --dry-run'],
});

export const universesVisit = apiCommand({
  name: 'universes visit', summary: 'Record a visit of a universe in the visit history, on purpose (recordUniverseVisit)',
  description: 'The only command that records a visit; nothing else does it by itself. The platform records it once per account and universe within 10 minutes, and not at all while the history is paused: the answer is true when recorded, false when deduplicated or paused.',
  kind: 'mutation', op: 'recordUniverseVisit', positionals: ['universe'], dry: true, descriptions: { universe: 'The universe visited (%name, %name/sub)' },
  text: (r) => (r === true ? 'recorded' : r === false ? 'not recorded (already recorded in the last 10 minutes, or the history is paused)' : String(r)),
  examples: ['breakrocks universes visit %paris', 'breakrocks universes visit %paris --dry-run'],
});

const OTHER_SETTINGS = ['notifications', 'translation', 'recommendations', 'nearbyLabel', 'subtitles', 'tips', 'universeFrame', 'commandLanguage', 'clear', 'messaging', 'privateAnalysisConsent', 'camera', 'autoplay', 'map'].map((f) => `input.${f}`);
export const settingsHistoryPause = apiCommand({
  name: 'settings history-pause', summary: 'Pause (on) or resume (off) the universe visit history: nothing new is recorded while paused, the entries stay (setSettings)',
  kind: 'mutation', op: 'setSettings', positionals: ['state'], dry: true,
  hide: [...OTHER_SETTINGS, 'input.universeHistoryPaused'], extra: { state: { type: 'string', enum: ['on', 'off'], description: 'on: pause the history; off: resume it' } }, require: ['state'],
  prepare: (i) => { const { state, ...rest } = i; return { ...rest, 'input.universeHistoryPaused': state === 'on' }; },
  select: '{ universeHistoryPaused }',
  text: (r) => `visit history ${(r as { universeHistoryPaused?: boolean } | null)?.universeHistoryPaused ? 'paused' : 'recording'}`,
  examples: ['breakrocks settings history-pause on', 'breakrocks settings history-pause off'],
});

// ---- The history of the long videos (specs v122.3.0, D-386, long-videos.feature) ----

type VideoEntry = { post?: { id: string; author?: { handle?: string } | null; text?: string; universe?: string } | null; positionSeconds?: number; watchedAt?: string };
const clock = (s: number) => `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor(s / 60) % 60).padStart(Math.floor(s / 3600) ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;

export const videosHistory = apiCommand({
  name: 'videos history', summary: 'The history of the long videos watched 30 seconds or more, the most recent first, 500 at most kept, private (videoHistory)',
  description: 'Each entry: the post, where one left it, when it was last watched. --limit from 1 to 50 (20 by default), --all follows the pages. "paused" tells whether the history is paused (settings video-history-pause).',
  kind: 'query', op: 'videoHistory', select: `{ items { positionSeconds watchedAt post ${selection('Post', 1)} } next paused }`,
  text: (r) => {
    const p = r as { items?: VideoEntry[]; next?: string | null; paused?: boolean } | null;
    const lines = (p?.items ?? []).map((e) => `${e.post?.id ?? '-'}  ${e.watchedAt ?? ''}  at ${clock(e.positionSeconds ?? 0)}  ${e.post?.author?.handle ? `@${e.post.author.handle}` : '-'}  ${e.post?.universe ?? ''}  ${(e.post?.text ?? '').replace(/\s+/g, ' ').slice(0, 50)}`);
    return [...(lines.length ? lines : ['(none)']), ...(p?.next ? [`next: ${p.next}`] : []), ...(p?.paused ? ['(the history is paused: nothing new is kept)'] : [])].join('\n');
  },
  examples: ['breakrocks videos history', 'breakrocks videos history --all --json'],
});

export const videosHistoryRemove = apiCommand({
  name: 'videos history remove', summary: 'Remove one long video from the history of the long videos (removeFromVideoHistory; true also when absent)',
  kind: 'mutation', op: 'removeFromVideoHistory', positionals: ['postId'], dry: true, require: ['postId'], descriptions: { postId: 'The post with the long video' }, text: doneText,
  examples: ['breakrocks videos history remove <post id>', 'breakrocks videos history remove <post id> --dry-run'],
});

export const videosHistoryClear = apiCommand({
  name: 'videos history clear', summary: 'Clear the whole history of the long videos (removeFromVideoHistory without a post)',
  kind: 'mutation', op: 'removeFromVideoHistory', hide: ['postId'], dry: true, confirm: () => 'Clear the whole history of the long videos of the account?', text: doneText,
  examples: ['breakrocks videos history clear --yes', 'breakrocks videos history clear --dry-run'],
});

export const settingsVideoHistoryPause = apiCommand({
  name: 'settings video-history-pause', summary: 'Pause (on) or resume (off) the history of the long videos: nothing new is kept while paused, the entries stay (setSettings)',
  kind: 'mutation', op: 'setSettings', positionals: ['state'], dry: true,
  hide: [...OTHER_SETTINGS, 'input.universeHistoryPaused', 'input.videoHistoryPaused'], extra: { state: { type: 'string', enum: ['on', 'off'], description: 'on: pause the history of the long videos; off: resume it' } }, require: ['state'],
  prepare: (i) => { const { state, ...rest } = i; return { ...rest, 'input.videoHistoryPaused': state === 'on' }; },
  select: '{ videoHistoryPaused }',
  text: (r) => `long videos history ${(r as { videoHistoryPaused?: boolean } | null)?.videoHistoryPaused ? 'paused' : 'recording'}`,
  examples: ['breakrocks settings video-history-pause on', 'breakrocks settings video-history-pause off'],
});
