// What the completion proposes without the network (README § Autocomplétion): the universes and the
// accounts used lately (history.json of the configuration folder, the last 100, written for the user
// alone: an address and when it was used, never a text or the content of a message) and the themes
// and layouts the profile published (cache/published-<profile>.json). BREAKROCKS_NO_HISTORY=1 keeps
// nothing.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writePrivate, type ConfigStore } from '../config.js';

export const HISTORY_SIZE = 100;
/** A universe (%name, %name/sub, %name#tag) or an account (@handle): one word, nothing else. */
export const ADDRESS = /^[%@][^\s]{1,200}$/u;

type History = { version: 1; entries: { value: string; at: string }[] };
type Published = { version: 1; themes: string[]; layouts: string[] };

export const historyFile = (store: ConfigStore) => join(store.dir, 'history.json');
const publishedFile = (store: ConfigStore, profile: string) => store.cacheFile(`published-${profile}.json`);

export const historyDisabled = (env: NodeJS.ProcessEnv) => !!env.BREAKROCKS_NO_HISTORY && env.BREAKROCKS_NO_HISTORY !== '0';

function readHistory(store: ConfigStore): History {
  const h = readJson<History>(historyFile(store));
  return h && Array.isArray(h.entries) ? { version: 1, entries: h.entries.filter((e) => e && typeof e.value === 'string' && ADDRESS.test(e.value)) } : { version: 1, entries: [] };
}

/** Puts [values] first in the history (the addresses only), the last [HISTORY_SIZE] kept. */
export function remember(store: ConfigStore, values: readonly string[], now: number): void {
  const fresh = [...new Set(values.filter((v) => ADDRESS.test(v)))];
  if (!fresh.length) return;
  const at = new Date(now).toISOString();
  const kept = readHistory(store).entries.filter((e) => !fresh.includes(e.value));
  writePrivate(historyFile(store), `${JSON.stringify({ version: 1, entries: [...fresh.map((value) => ({ value, at })), ...kept].slice(0, HISTORY_SIZE) }, null, 2)}\n`);
}

/** The addresses of the history beginning with [sigil] (% universes, @ accounts), the most recent first. */
export const recent = (store: ConfigStore, sigil: '%' | '@') => readHistory(store).entries.map((e) => e.value).filter((v) => v.startsWith(sigil));

function readPublished(store: ConfigStore, profile: string): Published {
  const p = readJson<Published>(publishedFile(store, profile));
  const refs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && ADDRESS.test(x)) : []);
  return { version: 1, themes: refs(p?.themes), layouts: refs(p?.layouts) };
}

/** The themes or the layouts the profile published (%universe/name), the most recent first. */
export const published = (store: ConfigStore, profile: string, what: 'themes' | 'layouts') => readPublished(store, profile)[what];

/** Adds [add] to (and takes [remove] out of) the themes or the layouts the profile published. */
export function updatePublished(store: ConfigStore, profile: string, what: 'themes' | 'layouts', change: { add?: string; remove?: string }): void {
  const p = readPublished(store, profile);
  const list = p[what].filter((r) => r !== change.add && r !== change.remove);
  if (change.add && ADDRESS.test(change.add)) list.unshift(change.add);
  p[what] = list.slice(0, HISTORY_SIZE);
  writePrivate(publishedFile(store, profile), `${JSON.stringify(p, null, 2)}\n`);
}

export const forgetPublished = (store: ConfigStore, profile: string) => rmSync(publishedFile(store, profile), { force: true });
