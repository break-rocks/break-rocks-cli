// The pre-filled links of the experiences (specs v156.0.0, D-510, D-512 (9), (10); contracts/urls.md § Pre-filled links,
// contracts/experiences.md § Pre-filled link keys, experiences/experience-sharing.feature): /new/<template>/v/<key>=<value>;…
// with ?after=<address>, the values of the choices of a creation template of the catalogue (creation-templates.json, a
// copy in schema/experiences), never an owner, a place of discussion, a name nor an edition. The keys come from the
// pointers of the choices, so nothing about a creation template is written in the code. Offline: building a link and
// reading one create nothing.
import catalogue from '../../schema/experiences/creation-templates.json' with { type: 'json' };
import { visible } from './document.js';

export type Choice = { kind: 'INTEGER' | 'ENUM' | 'SET' | 'TEXT'; values?: unknown[]; min?: number; max?: number; minItems?: number; optional?: boolean };
export type CreationTemplate = { key: string; version: number; engine: { name: string; version: number }; choices: Record<string, Choice>; free?: string[] };
export type Catalogue = { catalogueVersion: number; templates: CreationTemplate[] };

export const CATALOGUE = catalogue as unknown as Catalogue;
/** The bound of a pre-filled link: its path and query, percent-encoded, without scheme nor host. */
export const MAX_LINK = 2000;
/** Beyond it, a poster holds a short link to the URL (/go/<code>). */
export const SHORT_LINK_BEYOND = 300;
const MAX_TEXT = 100;

/** The key of a choice: its pointer without its engine block, kebab-case segments joined by "." (/tournament/entrants/max → entrants.max). */
export function keyOfPointer(pointer: string, engine: string): string {
  const parts = pointer.split('/').filter(Boolean);
  if (parts[0] === engine && parts.length > 1) parts.shift();
  return parts.map((p) => p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)).join('.');
}

/** A value of the catalogue as a link writes it: an object by its values joined by "-" (WITNESSES-2-true), the rest as it is. */
export const valueText = (v: unknown): string => (typeof v === 'object' && v !== null ? Object.values(v).map(String).join('-') : String(v));

export type Key = { key: string; pointer: string; choice: Choice; required: boolean };
/** The keys of a creation template, sorted in byte order. */
export function keysOf(t: CreationTemplate): Key[] {
  return Object.entries(t.choices).map(([pointer, choice]) => ({ key: keyOfPointer(pointer, t.engine.name), pointer, choice, required: !choice.optional }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export const templateOf = (key: string, cat: Catalogue = CATALOGUE) => cat.templates.find((t) => t.key === key);

/** What a choice accepts, in words. */
export function acceptsText(c: Choice): string {
  if (c.kind === 'INTEGER') return `an integer from ${c.min ?? '-'} to ${c.max ?? '-'}`;
  if (c.kind === 'TEXT') return `a text of ${MAX_TEXT} visible characters at most`;
  const values = (c.values ?? []).map(valueText).join(', ');
  return c.kind === 'SET' ? `a set of ${values}, joined by ","` : values;
}

/** Checks one value (as typed, decoded) against its choice: its canonical text, or why it is refused. */
export function checkValue(c: Choice, raw: string): { value: string } | { problem: string } {
  if (c.kind === 'INTEGER') {
    if (!/^\d+$/.test(raw)) return { problem: `"${raw}" is not an integer` };
    const n = Number(raw);
    if ((c.min != null && n < c.min) || (c.max != null && n > c.max)) return { problem: `${n} is outside ${c.min} to ${c.max}` };
    return { value: String(n) };
  }
  if (c.kind === 'TEXT') {
    if (!raw.trim()) return { problem: 'an empty text' };
    if (visible(raw) > MAX_TEXT) return { problem: `${visible(raw)} visible characters, ${MAX_TEXT} at most` };
    return { value: raw };
  }
  const allowed = (c.values ?? []).map(valueText);
  if (c.kind === 'ENUM') return allowed.includes(raw) ? { value: raw } : { problem: `"${raw}" is not one of ${allowed.join(', ')}` };
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = items.filter((i) => !allowed.includes(i));
  if (unknown.length) return { problem: `${unknown.join(', ')} not among ${allowed.join(', ')}` };
  if (new Set(items).size !== items.length) return { problem: 'a value given twice' };
  if (items.length < (c.minItems ?? 0)) return { problem: `${c.minItems} value(s) at least` };
  // A set in the order of the catalogue, so that the same values always make the same link.
  return { value: allowed.filter((a) => items.includes(a)).join(',') };
}

/** Percent-encodes a value of a link: what separates the keys and the values (";", "=", "?", "#", "/", "%", spaces) never stays raw; "," (the separator of a set) stays. */
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%2C/g, ',');

export type Built = { template: string; path: string; length: number; values: Record<string, string>; asked: string[]; after: string | null; shortLinkNeeded: boolean };
export type BuildProblem = { key: string; problem: string };

/**
 * The pre-filled link of [t] with [given] (key → value as typed): each key once, the keys sorted, an absent optional choice
 * not written (its default), [after] the experience it comes from. The problems (unknown key, value outside its choice) come
 * back instead of a link: building writes only values the catalogue allows.
 */
export function buildLink(t: CreationTemplate, given: Record<string, string>, after?: string): { built: Built } | { problems: BuildProblem[] } {
  const keys = keysOf(t);
  const problems: BuildProblem[] = [];
  const values: Record<string, string> = {};
  for (const [key, raw] of Object.entries(given)) {
    const k = keys.find((x) => x.key === key);
    if (!k) { problems.push({ key, problem: `not a key of ${t.key} (its keys: ${keys.map((x) => x.key).join(', ') || 'none'})` }); continue; }
    if (raw === '') continue;
    const r = checkValue(k.choice, raw);
    if ('problem' in r) problems.push({ key, problem: r.problem }); else values[key] = r.value;
  }
  if (problems.length) return { problems };
  const pairs = keys.filter((k) => values[k.key] !== undefined).map((k) => `${k.key}=${encode(values[k.key])}`);
  const path = `/new/${t.key}${pairs.length ? `/v/${pairs.join(';')}` : ''}${after ? `?after=${encode(after)}` : ''}`;
  return { built: { template: t.key, path, length: path.length, values, asked: keys.filter((k) => k.required && values[k.key] === undefined).map((k) => k.key), after: after ?? null, shortLinkNeeded: path.length > SHORT_LINK_BEYOND } };
}

export type Opened =
  | { valid: false; template: string; reason: string }
  | { valid: true; template: string; engine: string; templateVersion: number; filled: { key: string; pointer: string; value: string }[]; askedAgain: { key: string; value: string; problem: string }[]; asked: string[]; ignored: string[]; after: string | null; length: number; tooLong: boolean };

/** The path and query of a pre-filled link (a full URL of break.rocks, or its path), or null when it is not one. */
export function prefilledPath(given: string): string | null {
  let s = given.trim();
  try { if (/^https?:\/\//i.test(s)) { const u = new URL(s); s = `${u.pathname}${u.search}`; } } catch { return null; }
  return /^\/new\/[^/?#]+/.test(s) ? s : null;
}

/**
 * What opening a pre-filled link fills, as the apps read it (urls.md § Pre-filled links): an unknown key ignored, a value
 * outside the choices or the bounds left out and asked again, what is missing asked; a creation template no longer in the
 * catalogue: the link is no longer valid. Nothing is created.
 */
export function openLink(path: string, cat: Catalogue = CATALOGUE): Opened {
  const [pathname, query = ''] = path.split('?', 2);
  const m = /^\/new\/([^/]+)(?:\/v\/(.*))?\/?$/.exec(pathname);
  const template = m ? decodeURIComponent(m[1]) : '';
  const t = m ? templateOf(template, cat) : undefined;
  if (!t) return { valid: false, template, reason: m ? `"${template}" is no creation template of the catalogue: the link is no longer valid` : 'not a pre-filled link (/new/<template>/v/<key>=<value>;…)' };
  const keys = keysOf(t);
  const filled: { key: string; pointer: string; value: string }[] = [];
  const askedAgain: { key: string; value: string; problem: string }[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();
  for (const pair of (m![2] ?? '').split(';').filter(Boolean)) {
    const at = pair.indexOf('=');
    const key = decodeURIComponent(at < 0 ? pair : pair.slice(0, at));
    let value: string;
    try { value = decodeURIComponent(at < 0 ? '' : pair.slice(at + 1)); } catch { value = pair.slice(at + 1); }
    const k = keys.find((x) => x.key === key);
    if (!k || seen.has(key)) { ignored.push(key); continue; }
    seen.add(key);
    const r = checkValue(k.choice, value);
    if ('problem' in r) askedAgain.push({ key, value, problem: r.problem }); else filled.push({ key, pointer: k.pointer, value: r.value });
  }
  const afterRaw = new URLSearchParams(query).get('after');
  return {
    valid: true, template: t.key, engine: `${t.engine.name}/${t.engine.version}`, templateVersion: t.version, filled, askedAgain,
    asked: keys.filter((k) => k.required && !filled.some((f) => f.key === k.key)).map((k) => k.key), ignored, after: afterRaw || null,
    length: path.length, tooLong: path.length > MAX_LINK,
  };
}
