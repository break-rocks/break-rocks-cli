// The experience template as a portable JSON document (contracts/experiences.md § The experience template): what
// `experiences export` writes and `experiences import` sends. The keys in a fixed order (those of the JSON Schema,
// then the others sorted), the fields the platform sets (id, version, copiedFrom) left out, so that export, import and
// export again give the same bytes. The local check: the JSON Schema of the specs and what the registry of engines
// tells, with the codes of the platform (DocumentProblem); the rest is the platform's (checkExperience).
import { validateJsonSchema } from '../theme/json-schema.js';
import { engineBlocks, keyOf, platformFields, templateFormat, type Contract, type Json } from './contract.js';

/** One problem of a document, as checkExperience answers it: its code, its JSON pointer ("" for the whole), what is wrong. */
export type DocumentProblem = { code: string; path: string; message: string; source?: 'cli' | 'platform' };

/** A document weighs 16 KB at most in UTF-8 (contracts/experiences.md, DOCUMENT_TOO_LARGE). */
export const MAX_DOCUMENT_BYTES = 16 * 1024;
/** The JSON Schema keeps a cap in code points of 4 per visible character (contracts/experiences.md § Lengths). */
const CODE_POINTS_PER_CHARACTER = 4;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const visible = (s: string) => [...segmenter.segment(s)].length;

/** [schema] with its local $ref followed. */
function resolved(root: Json, schema: unknown): Json | undefined {
  let s = schema;
  for (let i = 0; i < 20 && isObject(s) && typeof s.$ref === 'string' && s.$ref.startsWith('#/'); i++) {
    s = (s.$ref as string).slice(2).split('/').reduce<unknown>((o, k) => (isObject(o) ? o[k] : undefined), root);
  }
  return isObject(s) ? s : undefined;
}

/** [value] with the keys of its objects in a fixed order: those its schema declares, in their order, then the others sorted. */
export function canonical(value: unknown, root: Json, schema: unknown = root): unknown {
  if (Array.isArray(value)) {
    const items = resolved(root, schema)?.items;
    return value.map((v) => canonical(v, root, items));
  }
  if (!isObject(value)) return value;
  const s = resolved(root, schema);
  const declared = isObject(s?.properties) ? Object.keys(s.properties) : [];
  const keys = [...declared.filter((k) => k in value), ...Object.keys(value).filter((k) => !declared.includes(k)).sort()];
  const sub = (k: string) => (isObject(s?.properties) && k in s.properties ? s.properties[k] : s?.additionalProperties);
  return Object.fromEntries(keys.filter((k) => value[k] !== undefined).map((k) => [k, canonical(value[k], root, sub(k))]));
}

/** The portable document: the fields the platform sets left out, the keys in their fixed order. */
export function portable(document: Json, contract: Contract): Json {
  const set = platformFields(contract);
  const kept = Object.fromEntries(Object.entries(document).filter(([k]) => !set.includes(k)));
  return canonical(kept, contract.definition) as Json;
}

/** The text of a document as `experiences export` writes it: 2 spaces, a final new line. */
export const documentText = (document: Json) => `${JSON.stringify(document, null, 2)}\n`;

/** The address of an experience of [owner] and [name]: "@alice*squats-100", "%paris*plank", "*five-k" for %root. */
export function addressOf(owner: string, name: string): string {
  return owner === '%root' ? `*${name}` : `${owner}*${name}`;
}

/** One problem per path, the first kept (as the platform answers them). */
export function onePerPath(problems: DocumentProblem[]): DocumentProblem[] {
  const seen = new Set<string>();
  return problems.filter((p) => (seen.has(p.path) ? false : (seen.add(p.path), true)));
}

/**
 * The problems of [document] (its [bytes] as sent) found without the platform: the JSON Schema of the template
 * (SCHEMA), the size (DOCUMENT_TOO_LARGE), the visible characters (TEXT_TOO_LONG), the fields the platform sets
 * (FIELD_SET_BY_PLATFORM), and from the registry of engines: ENGINE_NOT_AVAILABLE, RANKING_MEASURE_NOT_SUPPORTED,
 * RANKING_MEASURE_MISMATCH, RANKING_SELF_REPORTED, PARAMETER_KEY_TWICE, PARAMETER_FIELD_TWICE, PARAMETER_BOUNDS_INVALID.
 * The others need the platform: NAME_INVALID, NAME_TAKEN, OWNER_NOT_ALLOWED, PARAMETER_WITHOUT_TARGET,
 * PARAMETER_OUT_OF_BOUNDS, TARGET_BEYOND_DURATION, ROUTE_NOT_AVAILABLE, ROUTE_NAME_MISMATCH.
 */
export function checkLocally(document: unknown, bytes: number, contract: Contract): DocumentProblem[] {
  const problems: DocumentProblem[] = [];
  const add = (code: string, path: string, message: string) => problems.push({ code, path, message, source: 'cli' });
  if (bytes > MAX_DOCUMENT_BYTES) add('DOCUMENT_TOO_LARGE', '', `the document weighs ${bytes} bytes in UTF-8, ${MAX_DOCUMENT_BYTES} at most`);
  const tooLong = new Map<string, string>();
  const checked = validateJsonSchema(contract.definition, document, {
    pointer: true,
    onValue: (path, value, schema) => {
      if (typeof value !== 'string' || typeof schema.maxLength !== 'number') return;
      const limit = Math.floor(schema.maxLength / CODE_POINTS_PER_CHARACTER);
      const count = visible(value);
      if (count > limit) tooLong.set(path, `${count} visible characters, ${limit} at most`);
    },
  });
  for (const [path, message] of tooLong) add('TEXT_TOO_LONG', path, message);
  for (const p of checked.problems) {
    if (p.keyword === 'maxLength' && tooLong.has(p.path)) continue;
    add('SCHEMA', p.path, p.message);
  }
  if (!isObject(document)) return onePerPath(problems);
  for (const field of platformFields(contract)) if (document[field] !== undefined) add('FIELD_SET_BY_PLATFORM', `/${field}`, `"${field}" is set by the platform, never given (leave it out)`);
  // The registry of engines.
  const engine = isObject(document.engine) ? document.engine : undefined;
  const known = engine && contract.engines.find((e) => e.name === engine.name && e.version === engine.version && e.format === document.format);
  if (engine && typeof engine.name === 'string' && typeof engine.version === 'number' && !known) {
    add('ENGINE_NOT_AVAILABLE', '/engine', `${engine.name}/${engine.version} is not an engine of ${templateFormat(contract)} in the registry (${contract.engines.filter((e) => e.format === templateFormat(contract)).map(keyOf).join(', ')})`);
  }
  const block = known && engineBlocks(contract).includes(known.name) && isObject(document[known.name]) ? document[known.name] as Json : undefined;
  const ranking = isObject(document.ranking) ? document.ranking : undefined;
  if (known && ranking && typeof ranking.measure === 'string') {
    if (!(known.rankingMeasures ?? []).includes(ranking.measure)) add('RANKING_MEASURE_NOT_SUPPORTED', '/ranking/measure', `${keyOf(known)} ranks on ${(known.rankingMeasures ?? []).join(' or ') || 'nothing'}, not ${ranking.measure}`);
    else if (block && typeof block.measure === 'string' && block.measure !== ranking.measure) add('RANKING_MEASURE_MISMATCH', '/ranking/measure', `the ranking is on ${ranking.measure}, the measure of the ${known.name} is ${block.measure}`);
    else if (block && isObject(block.proof) && block.proof.validation === 'SELF_REPORTED') add('RANKING_SELF_REPORTED', '/ranking', 'a self-reported result is never ranked: no ranking under proof.validation SELF_REPORTED');
  }
  const parameters = Array.isArray(document.parameters) ? document.parameters : [];
  const keys = new Set<unknown>(), fields = new Set<unknown>();
  parameters.forEach((p, i) => {
    if (!isObject(p)) return;
    if (keys.has(p.key)) add('PARAMETER_KEY_TWICE', `/parameters/${i}/key`, `the key "${String(p.key)}" is given twice`);
    keys.add(p.key);
    if (fields.has(p.field)) add('PARAMETER_FIELD_TWICE', `/parameters/${i}/field`, `the field "${String(p.field)}" has two parameters`);
    fields.add(p.field);
    if ([p.min, p.default, p.max].every((n) => typeof n === 'number') && !((p.min as number) <= (p.default as number) && (p.default as number) <= (p.max as number))) add('PARAMETER_BOUNDS_INVALID', `/parameters/${i}`, `min ≤ default ≤ max is not true (${String(p.min)}, ${String(p.default)}, ${String(p.max)})`);
  });
  return onePerPath(problems);
}

/** The document of [text]: its JSON, or the problem of the whole document. */
export function parseDocument(text: string): { document?: unknown; problem?: DocumentProblem } {
  const clean = text.replace(/^﻿/, '');
  try { return { document: JSON.parse(clean) }; } catch (e) {
    return { problem: { code: 'SCHEMA', path: '', message: `not JSON: ${(e as Error).message}`, source: 'cli' } };
  }
}

/** The bytes the document weighs as the CLI sends it (compact JSON, UTF-8). */
export const sentBytes = (document: unknown) => Buffer.byteLength(JSON.stringify(document), 'utf8');

/** The lines of problems: "  SCHEMA  /title/en: must have at least 1 characters". */
export const problemLines = (problems: readonly DocumentProblem[], indent = '  ') => problems.map((p) => `${indent}${p.code}  ${p.path || '(document)'}: ${p.message}`);
