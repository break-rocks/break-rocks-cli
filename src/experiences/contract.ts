// The contract of the experiences as the specs publish it (contracts/experiences.md, D-423, D-424): the registry of
// experience engines (engines.json) and the JSON Schema of the experience template breakrocks.experience/4
// (definition.schema.json), the files the backend validates with. The CLI carries a copy of them in
// schema/experiences/ (npm run update:schema, from specs/common), bundled in the build; --contract <folder> reads
// another copy at run time (a checkout of the specs, its contracts/experiences, or a copy of schema/experiences).
// Nothing about an engine is written in the code: an engine the registry and the template carry (visit/1 tomorrow)
// works as soon as the copy holds it.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Context } from '../context.js';
import { usageError } from '../errors.js';
import engines from '../../schema/experiences/engines.json' with { type: 'json' };
import definition from '../../schema/experiences/definition.schema.json' with { type: 'json' };
import index from '../../schema/experiences/index.json' with { type: 'json' };

export type Json = Record<string, unknown>;
/** An engine of the registry (engines.json). */
export type Engine = { name: string; version: number; format: string; what?: string; since?: string; owners?: string[]; creators?: string[]; places?: string[]; proofs?: string[]; rankingMeasures?: string[]; widgets?: string[]; parameterFields?: string[]; vectors?: string };
/** An example document of an engine: the first definition of its test vectors. */
export type Example = { file: string; key: string; document: Json };
export type Contract = {
  /** The version of the specs it comes from ("v136.3.0"), or the folder read. */
  version: string;
  /** Where it was read: "built in" or the folder of --contract. */
  source: string;
  engines: Engine[];
  /** The JSON Schema of the experience template (definition.schema.json). */
  definition: Json;
  examples: Record<string, Example>;
};

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const BUILT_IN: Contract = {
  version: (index as { version?: string | null }).version ?? '?', source: 'built in',
  engines: (engines as { engines: Engine[] }).engines, definition: definition as Json, examples: (index as unknown as { examples: Record<string, Example> }).examples,
};

function readJson(path: string): Json {
  try { return JSON.parse(readFileSync(path, 'utf8')) as Json; } catch (e) { throw usageError('CONTRACT_INVALID', `${path}: not a JSON file (${(e as Error).message})`, { path }); }
}

/** The contract the CLI carries, or the one of [folder] (--contract): a checkout of the specs, its contracts/experiences, or a copy of schema/experiences. */
export function loadContract(ctx: Context, folder?: string): Contract {
  if (!folder) return BUILT_IN;
  const given = resolve(ctx.io.cwd, folder);
  const dir = [given, join(given, 'contracts', 'experiences')].find((d) => existsSync(join(d, 'engines.json')) && existsSync(join(d, 'definition.schema.json')));
  if (!dir) throw usageError('CONTRACT_NOT_FOUND', `${folder}: no engines.json and definition.schema.json (a checkout of the specs, its contracts/experiences folder, or a copy of schema/experiences)`, { path: folder });
  const registry = readJson(join(dir, 'engines.json'));
  if (!Array.isArray(registry.engines)) throw usageError('CONTRACT_INVALID', `${join(dir, 'engines.json')}: no "engines" list`, { path: folder });
  const list = registry.engines as Engine[];
  // The examples: from the test vectors the registry names, else from the index of a copy of schema/experiences.
  const copied = existsSync(join(dir, 'index.json')) ? readJson(join(dir, 'index.json')) : {};
  const examples: Record<string, Example> = { ...(isObject(copied.examples) ? copied.examples as Record<string, Example> : {}) };
  for (const e of list) {
    const file = e.vectors ? join(dir, e.vectors) : undefined;
    if (!file || !existsSync(file) || !statSync(file).isFile()) continue;
    const defs = readJson(file).definitions;
    const first = isObject(defs) ? Object.entries(defs)[0] : undefined;
    if (first && isObject(first[1])) examples[keyOf(e)] = { file: e.vectors!, key: first[0], document: first[1] };
  }
  const version = typeof copied.version === 'string' ? copied.version : readdirSync(dir).includes('VERSION') ? readFileSync(join(dir, 'VERSION'), 'utf8').trim() : folder;
  return { version, source: dir, engines: list, definition: readJson(join(dir, 'definition.schema.json')), examples };
}

export const keyOf = (e: { name: string; version: number }) => `${e.name}/${e.version}`;

/** The format of the experience template of the schema ("breakrocks.experience/4"). */
export function templateFormat(contract: Contract): string {
  const format = (contract.definition.properties as Json | undefined)?.format;
  return isObject(format) && typeof format.const === 'string' ? format.const : '?';
}

/** The engines whose documents the schema of the template defines: their format is the template's. */
export const templateEngines = (contract: Contract) => contract.engines.filter((e) => e.format === templateFormat(contract));

/**
 * The engine "name/version" (or "name": its latest version of the template) of the registry, one whose documents the
 * template defines; ENGINE_UNKNOWN or ENGINE_FORMAT_NOT_SUPPORTED (exit 2) otherwise.
 */
export function engineOf(contract: Contract, given: string): Engine {
  const [name, raw] = given.trim().toLowerCase().split('/');
  const known = templateEngines(contract);
  const list = known.map(keyOf).join(', ');
  const all = contract.engines.filter((e) => e.name === name && (raw === undefined || String(e.version) === raw));
  if (!all.length) throw usageError('ENGINE_UNKNOWN', `No engine ${given} in the registry of experience engines (${contract.source === 'built in' ? `specs ${contract.version}` : contract.source}): ${list || 'none'}`, { engine: given, engines: known.map(keyOf) });
  const engine = all.filter((e) => e.format === templateFormat(contract)).sort((a, b) => b.version - a.version)[0];
  if (!engine) throw usageError('ENGINE_FORMAT_NOT_SUPPORTED', `${keyOf(all[0])} writes ${all[0].format}, not ${templateFormat(contract)}: its experiences are not documents this CLI checks or imports (a place feat is seeded by the platform team). Engines of ${templateFormat(contract)}: ${list}`, { engine: keyOf(all[0]), format: all[0].format });
  const names = enumOf(prop(contract.definition, 'engine'), 'name');
  if (names && !names.includes(engine.name)) throw usageError('ENGINE_NOT_IN_TEMPLATE', `${keyOf(engine)} is in the registry, but the JSON Schema of ${templateFormat(contract)} does not define its documents yet (engine.name: ${names.join(', ')}): a later version of the specs will`, { engine: keyOf(engine) });
  return engine;
}

const prop = (schema: Json, name: string): Json | undefined => {
  const p = (schema.properties as Json | undefined)?.[name];
  return isObject(p) ? p : undefined;
};
const enumOf = (schema: Json | undefined, name: string): unknown[] | undefined => {
  const p = schema && prop(schema, name);
  if (!p) return undefined;
  return Array.isArray(p.enum) ? p.enum : p.const !== undefined ? [p.const] : undefined;
};

/** The fields of the template the platform sets (id, version, copiedFrom): their description says "set by the platform". */
export function platformFields(contract: Contract): string[] {
  return Object.entries((contract.definition.properties as Json | undefined) ?? {}).filter(([, s]) => isObject(s) && typeof s.description === 'string' && /set by the platform/i.test(s.description)).map(([k]) => k);
}

/** The names of the engine blocks of the template: the properties named after an engine (route, challenge). */
export function engineBlocks(contract: Contract): string[] {
  const props = Object.keys((contract.definition.properties as Json | undefined) ?? {});
  return [...new Set(templateEngines(contract).map((e) => e.name))].filter((n) => props.includes(n));
}

/** Whether an "if" holds only when the engine is [name]: { properties: { engine: { properties: { name: { const } } } } }. */
function engineCondition(branch: unknown): string | undefined {
  if (!isObject(branch) || !isObject(branch.if)) return undefined;
  const engine = prop(branch.if, 'engine');
  const name = engine && prop(engine, 'name');
  return name && typeof name.const === 'string' ? name.const : undefined;
}

/** The $defs a schema still refers to ("#/$defs/x"), the others left out. */
function pruneDefs(schema: Json): Json {
  const defs = isObject(schema.$defs) ? schema.$defs : {};
  const used = new Set<string>();
  const scan = (v: unknown) => { for (const m of JSON.stringify(v).matchAll(/"#\/\$defs\/([^"/]+)"/g)) if (!used.has(m[1])) { used.add(m[1]); scan(defs[m[1]]); } };
  const { $defs: _d, ...rest } = schema;
  void _d;
  scan(rest);
  const kept = Object.fromEntries(Object.entries(defs).filter(([k]) => used.has(k)));
  return Object.keys(kept).length ? { ...rest, $defs: kept } : rest;
}

/**
 * The JSON Schema of the documents of [engine] a caller writes, from the schema of the template: its engine fixed, the
 * blocks of the other engines and the fields the platform sets left out, the conditions of its engine applied, those of
 * the others dropped. Derived at run time, never written by hand.
 */
export function engineSchema(contract: Contract, engine: Engine): Json {
  const full = structuredClone(contract.definition);
  const properties = { ...(full.properties as Json) };
  const required = new Set<string>((full.required as string[] | undefined) ?? []);
  properties.engine = { description: (properties.engine as Json | undefined)?.description, type: 'object', additionalProperties: false, required: ['name', 'version'], properties: { name: { const: engine.name }, version: { const: engine.version } } };
  for (const block of engineBlocks(contract)) if (block !== engine.name) delete properties[block];
  for (const field of platformFields(contract)) { delete properties[field]; required.delete(field); }
  const kept: unknown[] = [];
  for (const branch of (full.allOf as unknown[] | undefined) ?? []) {
    const when = engineCondition(branch);
    if (when === undefined) { kept.push(branch); continue; }
    if (when !== engine.name) continue;
    const then = (branch as Json).then;
    if (!isObject(then)) continue;
    for (const r of (then.required as string[] | undefined) ?? []) required.add(r);
    for (const [key, s] of Object.entries((then.properties as Json | undefined) ?? {})) {
      if (s === false || (isObject(s) && s.maxItems === 0)) { delete properties[key]; required.delete(key); }
      else if (properties[key] !== undefined) properties[key] = { allOf: [properties[key], s] };
    }
  }
  const { $id: id, allOf: _a, ...rest } = full;
  void _a;
  return pruneDefs({
    ...rest,
    $comment: `The documents of the engine ${keyOf(engine)}: ${typeof id === 'string' ? id : 'definition.schema.json'} narrowed to this engine by the CLI (its engine fixed, the other engine blocks and the fields the platform sets left out).`,
    properties, required: [...required], ...(kept.length ? { allOf: kept } : {}),
  });
}
