// The commands that are one operation of the API (most of them): their input schema derived from
// the arguments of the operation in the contract (names, types, enums, required ones), their answer
// selected from its type, their output schema likewise. An account is given by its id or its
// @handle (resolved with accountByHandle); a theme or a layout by "%universe/name"; an input object
// by its JSON; a page (items, next) is followed with --all, bounded by --max.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Context } from '../context.js';
import { usageError } from '../errors.js';
import type { Command } from '../registry.js';
import { camel, kebab, type JsonSchema, type ObjectSchema } from '../schema.js';
import { uuidv7 } from '../ids.js';
import { api } from '../session.js';
import { documentOf, fieldsOf, inputSchema, isInputType, operation, outputSchema, pageItemType, selection, typeRef, type Operation, type OperationKind } from './graphql.js';

/** What the arguments of the contract mean, when their name says it. */
export const ARG_DESCRIPTIONS: Record<string, string> = {
  universe: 'The universe (%name, %name/sub)', address: 'The address (%universe, %universe/sub, %universe#tag, #tag, @handle)', id: 'The id',
  accountId: 'The account: its id, or @handle', accountIds: 'The accounts: ids or @handles', after: 'The cursor of the next page (the "next" of an answer)',
  text: 'The text', name: 'The name', channel: 'The channel (%universe~name)', limit: 'How many at most', postId: 'The id of the post',
  reason: 'The reason', article: 'The article of the rules or the charter', requestId: 'An idempotency key (a UUIDv7): a request sent again with it is done once (one is made when absent)',
  replyPolicy: 'Who may reply', images: 'Images: [{ "id": <upload id>, "alt": <text> }]', link: 'A link (https)', clip: 'The id of an uploaded video (requestMediaUpload VIDEO)',
  theme: 'A theme: %universe/name (or { "universe", "name", "version" })', layoutRef: 'A layout: %universe/name (or { "universe", "name" })', field: 'A field (UniverseField)',
  language: 'A language (BCP 47: fr, en…)', title: 'The title', choices: 'The choices', question: 'The question', startsAt: 'When it starts (ISO 8601)', minutes: 'How long, in minutes',
  hours: 'How long, in hours', days: 'How long, in days', subject: 'The subject', document: 'The document (JSON, or a file with @path)', kind: 'The kind', order: 'The order',
};

type ArgView = { property: string; arg: string; path: string[]; schema: JsonSchema; required: boolean; type: string };

export type ApiDef<O = unknown> = {
  name: string; summary: string; description?: string; examples: string[];
  kind: OperationKind; op: string;
  /** The properties given as positionals (names of the command, after the renames). */
  positionals?: string[];
  /** A GraphQL argument (or a field of a flattened input: "input.universe") under another name in the command ("universe" → "in"). */
  rename?: Record<string, string>;
  descriptions?: Record<string, string>;
  /** Arguments (or fields of a flattened input: "to.channel") set by the command, not offered (fixed values). */
  fixed?: Record<string, unknown>;
  /** Arguments (or fields of a flattened input) not offered. */
  hide?: string[];
  /**
   * The input objects whose fields are offered as properties of their own (the argument "input", or
   * "input.change", "discussion"…): default ["input"]. A field takes its own name, unless renamed by its path.
   */
  flatten?: string[];
  depth?: number;
  select?: string;
  /** A confirmation before the request (an irreversible action). */
  confirm?: (input: Record<string, unknown>) => string;
  /** The answer turned into the command's (default: the field of the operation). */
  map?: (data: unknown, input: Record<string, unknown>) => O;
  text?: (result: O) => string;
  quiet?: (result: O) => string | undefined;
  /** Extra properties of the command (not arguments of the operation) and how they turn into arguments. */
  extra?: Record<string, JsonSchema>;
  /** Extra properties required. */
  require?: string[];
  prepare?: (input: Record<string, unknown>, ctx: Context) => Promise<Record<string, unknown>> | Record<string, unknown>;
  mcp?: false;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Sets [value] at [path] in [target] (the objects on the way made). */
export function setPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let at = target;
  for (const key of path.slice(0, -1)) { if (!isObject(at[key])) at[key] = {}; at = at[key] as Record<string, unknown>; }
  at[path[path.length - 1]] = value;
}

/** "%paris/velo/my-theme" → { universe: "%paris/velo", name: "my-theme" }. */
export function refOf(value: unknown, what: string): unknown {
  if (isObject(value) || value == null) return value;
  const s = String(value).trim();
  if (s.startsWith('{')) { try { return JSON.parse(s); } catch { throw usageError('INVALID_INPUT', `${what}: not JSON`); } }
  const at = s.lastIndexOf('/');
  if (!s.startsWith('%') || at < 2) throw usageError('INVALID_INPUT', `${what}: %universe/name, for example %root/socle`);
  return { universe: s.slice(0, at), name: s.slice(at + 1) };
}

/** The id of an account given by its id or its @handle. */
export async function accountIdOf(ctx: Context, value: string): Promise<string> {
  const v = value.trim();
  if (!v.startsWith('@')) return v;
  const data = await api<{ accountByHandle: { id: string } | null }>(ctx, 'query($h: String!) { accountByHandle(handle: $h) { id } }', { h: v.slice(1) });
  if (!data.accountByHandle) throw usageError('ACCOUNT_NOT_FOUND', `No account ${v}`, { handle: v });
  return data.accountByHandle.id;
}

/** The arguments of an operation (and the fields of its flattened inputs) as the properties of a command. */
export function argViews(def: Pick<ApiDef, 'kind' | 'op' | 'rename' | 'descriptions' | 'fixed' | 'hide' | 'flatten'>): ArgView[] {
  const op = operation(def.kind, def.op);
  const flatten = new Set(def.flatten ?? ['input']);
  const views: ArgView[] = [];
  const visit = (path: string[], type: string, ancestorsRequired: boolean) => {
    const key = path.join('.');
    if ((def.fixed && key in def.fixed) || def.hide?.includes(key)) return;
    const named = typeRef(type).name;
    if (flatten.has(key) && isInputType(named) && !typeRef(type).list) {
      for (const [field, f] of Object.entries(fieldsOf(named))) visit([...path, field], f[0], ancestorsRequired && type.endsWith('!'));
      return;
    }
    const leaf = path[path.length - 1];
    const property = def.rename?.[key] ?? leaf;
    let schema = inputSchema(type);
    if (named === 'ThemeRefInput' || named === 'LayoutRefInput') schema = { anyOf: [{ type: 'string', pattern: '^%\\S+/[^/]+$' }, schema] };
    if (named === 'AWSJSON') schema = { anyOf: [{ type: 'object' }, { type: 'array' }, { type: 'string' }] };
    const description = def.descriptions?.[property] ?? def.descriptions?.[key] ?? ARG_DESCRIPTIONS[leaf] ?? `${kebab(leaf).replace(/-/g, ' ')} (${type})`;
    views.push({ property, arg: path[0], path, type, schema: { ...schema, description }, required: ancestorsRequired && type.endsWith('!') && leaf !== 'requestId' });
  };
  for (const [arg, type] of Object.entries(op.args)) visit([arg], type, true);
  return views;
}

/** The answer of a page followed to its end ([max] pages), its items together. */
async function pages(ctx: Context, document: string, field: string, variables: Record<string, unknown>, max: number) {
  const items: unknown[] = [];
  let next: unknown = variables.after ?? null;
  let first: Record<string, unknown> | undefined;
  for (let page = 0; page < max; page++) {
    const data = await api<Record<string, Record<string, unknown> | null>>(ctx, document, { ...variables, after: next });
    const answer = data[field];
    if (!answer) break;
    first ??= answer;
    items.push(...((answer.items as unknown[]) ?? []));
    next = answer.next ?? null;
    if (!next) break;
  }
  return { ...(first ?? {}), items, next };
}

/** The variables of a request from the input of the command: accounts resolved, references and JSON read. */
export async function variablesOf(ctx: Context, views: ArgView[], input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const vars: Record<string, unknown> = {};
  for (const v of views) {
    let value = input[v.property];
    if (value === undefined) continue;
    const named = typeRef(v.type).name;
    const leaf = v.path[v.path.length - 1];
    if (leaf === 'accountId' && typeof value === 'string') value = await accountIdOf(ctx, value);
    else if (leaf === 'accountIds' && Array.isArray(value)) value = await Promise.all(value.map((a) => accountIdOf(ctx, String(a))));
    else if (named === 'ThemeRefInput' || named === 'LayoutRefInput') value = typeRef(v.type).list && Array.isArray(value) ? value.map((x) => refOf(x, v.property)) : refOf(value, v.property);
    else if (named === 'AWSJSON') {
      if (typeof value === 'string' && value.startsWith('@')) value = readFileSync(resolve(ctx.io.cwd, value.slice(1)), 'utf8');
      value = typeof value === 'string' ? value : JSON.stringify(value);
    }
    else if (typeRef(v.type).list === false && typeof value === 'string' && SCHEMA_OBJECTS.has(named)) {
      try { value = JSON.parse(value); } catch { throw usageError('INVALID_INPUT', `--${kebab(v.property)}: JSON expected`); }
    }
    setPath(vars, v.path, value);
  }
  return vars;
}
const SCHEMA_OBJECTS = new Set<string>();

/** A command that is one operation of the API. */
/** Whether [path] ("input.change.territory") names an argument of [op] or a field of its inputs. */
function pathExists(op: Operation, path: string): boolean {
  const [arg, ...rest] = path.split('.');
  let type = op.args[arg];
  for (const field of rest) {
    if (!type) return false;
    type = fieldsOf(typeRef(type).name)[field]?.[0];
  }
  return !!type;
}

/** A definition that names what its operation does not have is an error of the CLI, found at load time (and by the tests). */
function checkDef(def: ApiDef<unknown>, op: Operation, properties: Record<string, JsonSchema>): void {
  const wrong = [...Object.keys(def.rename ?? {}), ...(def.hide ?? []), ...Object.keys(def.fixed ?? {}), ...(def.flatten ?? [])].filter((p) => !pathExists(op, p));
  const positionals = (def.positionals ?? []).map((p) => def.rename?.[p] ?? p.split('.').pop()!).filter((p) => !(p in properties));
  if (wrong.length || positionals.length) throw new Error(`${def.name}: ${op.name} has no ${[...wrong, ...positionals.map((p) => `property ${p}`)].join(', ')}`);
}

export function apiCommand<O = unknown>(def: ApiDef<O>): Command<Record<string, unknown>, O> {
  const op = operation(def.kind, def.op);
  const views = argViews(def);
  for (const v of views) if (inputSchema(v.type).type === 'object') SCHEMA_OBJECTS.add(typeRef(v.type).name);
  const paged = !!pageItemType(op.type) && 'after' in op.args;
  const properties: Record<string, JsonSchema> = Object.fromEntries(views.map((v) => [v.property, v.schema]));
  if (paged) {
    properties.all = { type: 'boolean', description: 'Follow the pages to the end (bounded by --max)' };
    properties.max = { type: 'integer', minimum: 1, maximum: 100, default: 10, description: 'Pages at most with --all' };
  }
  Object.assign(properties, def.extra ?? {});
  checkDef(def as ApiDef<unknown>, op, properties);
  const required = [...views.filter((v) => v.required).map((v) => v.property), ...(def.require ?? [])];
  const input: ObjectSchema = { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
  const depth = def.depth ?? 2;
  return {
    name: def.name, summary: def.summary, examples: def.examples,
    description: [def.description, `The ${op.kind} ${op.name} of the API.`].filter(Boolean).join(' '),
    input, output: def.map ? { description: `The answer of ${op.name}, as the command gives it` } : outputSchema(op.type, depth),
    args: { positionals: (def.positionals ?? []).map((p) => def.rename?.[p] ?? p.split('.').pop()!) }, ...(def.confirm ? { interactive: true } : {}), ...(def.mcp === false ? { mcp: false as const } : {}),
    run: async (ctx, raw) => {
      const given = def.prepare ? await def.prepare({ ...raw }, ctx) : raw;
      const vars: Record<string, unknown> = await variablesOf(ctx, views, given);
      for (const [key, value] of Object.entries(def.fixed ?? {})) setPath(vars, key.split('.'), value);
      for (const key of def.hide ?? []) if (given[key] !== undefined) setPath(vars, key.split('.'), given[key]);
      // A flattened input that is required is sent, even empty (its fields optional).
      for (const key of def.flatten ?? ['input']) if (!key.includes('.') && op.args[key]?.endsWith('!') && vars[key] === undefined) vars[key] = {};
      if ('requestId' in op.args && vars.requestId === undefined) vars.requestId = uuidv7(ctx.now());
      if (def.confirm) await ctx.confirm(def.confirm(given));
      const doc = documentOf(op, Object.keys(vars).concat(paged && given.all ? ['after'] : []), def.select ?? selection(typeRef(op.type).name, depth));
      const data = paged && given.all
        ? { [op.name]: await pages(ctx, doc, op.name, vars, (given.max as number | undefined) ?? 10) }
        : await api<Record<string, unknown>>(ctx, doc, vars);
      return (def.map ? def.map(data[op.name], given) : data[op.name]) as O;
    },
    ...(def.text ? { text: def.text } : {}),
    quiet: def.quiet ?? ((r: O) => (isObject(r) && typeof r.id === 'string' ? r.id : undefined)),
  };
}


/** The flag of a property ("accountId" → --account-id), and back. */
export const flagOf = (property: string) => `--${kebab(property)}`;
export const propertyOfFlag = (flag: string) => camel(flag.replace(/^--/, ''));
