// The universe visit history of the account (D-247, specs v83.0.0), synced on the account: the list, one
// universe removed, all of it cleared (irreversible: "yes"), the pause, and a visit recorded on purpose.
// A visit is NEVER recorded implicitly: reading a universe (universes show, a post, a feed…) does not call
// recordUniverseVisit; only `universes visit` does, and the platform deduplicates it (10 minutes) and
// ignores it while the history is paused.
import { apiCommand } from '../api/command.js';

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

const OTHER_SETTINGS = ['notifications', 'translation', 'recommendations', 'nearbyLabel', 'subtitles', 'tips', 'universeFrame', 'commandLanguage', 'clear', 'messaging'].map((f) => `input.${f}`);
export const settingsHistoryPause = apiCommand({
  name: 'settings history-pause', summary: 'Pause (on) or resume (off) the universe visit history: nothing new is recorded while paused, the entries stay (setSettings)',
  kind: 'mutation', op: 'setSettings', positionals: ['state'], dry: true,
  hide: [...OTHER_SETTINGS, 'input.universeHistoryPaused'], extra: { state: { type: 'string', enum: ['on', 'off'], description: 'on: pause the history; off: resume it' } }, require: ['state'],
  prepare: (i) => { const { state, ...rest } = i; return { ...rest, 'input.universeHistoryPaused': state === 'on' }; },
  select: '{ universeHistoryPaused }',
  text: (r) => `visit history ${(r as { universeHistoryPaused?: boolean } | null)?.universeHistoryPaused ? 'paused' : 'recording'}`,
  examples: ['breakrocks settings history-pause on', 'breakrocks settings history-pause off'],
});
