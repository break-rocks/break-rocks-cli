// The GraphQL contract at run time (src/api/schema.generated.ts): the type of an operation and of
// its arguments, the selection of an answer built from its type (every field without a required
// argument, the nested objects down to a depth, a type never inside itself), the document of a
// request with the arguments given, and the JSON Schemas of the inputs and the outputs of the
// commands, for --json, `breakrocks schema` and the MCP tools.
import type { JsonSchema } from '../schema.js';
import { SCHEMA as GENERATED } from './schema.generated.js';
import type { Sdl, SdlField } from './sdl.js';

/** The contract (the generated schema). */
export const CONTRACT: Sdl = GENERATED;
const SCHEMA = CONTRACT;

export type TypeRef = { name: string; list: boolean; nonNull: boolean; itemNonNull: boolean };

/** "[Post!]!" → { name: Post, list, nonNull, itemNonNull }. */
export function typeRef(raw: string): TypeRef {
  const nonNull = raw.endsWith('!');
  const inner = nonNull ? raw.slice(0, -1) : raw;
  const list = inner.startsWith('[');
  const item = list ? inner.slice(1, -1) : inner;
  return { name: item.replace(/!$/, ''), list, nonNull, itemNonNull: list && item.endsWith('!') };
}

export type OperationKind = 'query' | 'mutation';
export type Operation = { kind: OperationKind; name: string; type: string; args: Record<string, string> };

/** An operation of the contract (UNKNOWN_OPERATION, an error of the CLI itself, otherwise). */
export function operation(kind: OperationKind, name: string): Operation {
  const field: SdlField | undefined = SCHEMA[kind][name];
  if (!field) throw new Error(`The contract has no ${kind} ${name}`);
  return { kind, name, type: field[0], args: field[1] ?? {} };
}

export const isObjectType = (name: string) => SCHEMA.types[name]?.k === 'o';
export const fieldsOf = (name: string) => SCHEMA.types[name]?.f ?? {};
export const enumValues = (name: string) => (SCHEMA.types[name]?.k === 'e' ? SCHEMA.types[name].v ?? [] : undefined);

/** The fields of a page type (items and next): the type of its items, else undefined. */
export function pageItemType(raw: string): string | undefined {
  const t = typeRef(raw);
  const f = fieldsOf(t.name);
  return !t.list && f.items && f.next ? typeRef(f.items[0]).name : undefined;
}

const requiresArgs = (field: SdlField) => Object.values(field[1] ?? {}).some((t) => t.endsWith('!'));

/**
 * The selection of [typeName]: its scalar and enum fields, its object fields down to [depth] (a
 * type is never selected inside itself), unions by their __typename. Empty for a scalar or an enum.
 */
export function selection(typeName: string, depth = 2, path: readonly string[] = []): string {
  const type = SCHEMA.types[typeName];
  if (!type || type.k === 'e' || type.k === 's') return '';
  if (type.k === 'u') return '{ __typename }';
  const parts: string[] = [];
  for (const [name, field] of Object.entries(type.f ?? {})) {
    if (requiresArgs(field)) continue;
    const inner = typeRef(field[0]).name;
    const kind = SCHEMA.types[inner]?.k;
    if (!kind || kind === 'e' || kind === 's') { parts.push(name); continue; }
    if (kind === 'u') { parts.push(`${name} { __typename }`); continue; }
    if (depth <= 0 || path.includes(inner) || inner === typeName) continue;
    const sub = selection(inner, depth - 1, [...path, typeName]);
    if (sub && sub !== '{  }') parts.push(`${name} ${sub}`);
  }
  return parts.length ? `{ ${parts.join(' ')} }` : '';
}

/** The document of [op] with the arguments [given] (their names), and its selection. */
export function documentOf(op: Operation, given: readonly string[], select?: string): string {
  const names = given.filter((n) => op.args[n]);
  const decl = names.length ? `(${names.map((n) => `$${n}: ${op.args[n]}`).join(', ')})` : '';
  const call = names.length ? `(${names.map((n) => `${n}: $${n}`).join(', ')})` : '';
  const sel = select ?? selection(typeRef(op.type).name);
  return `${op.kind}${decl} { ${op.name}${call}${sel ? ` ${sel}` : ''} }`;
}

const SCALAR_SCHEMAS: Record<string, JsonSchema> = {
  String: { type: 'string' }, ID: { type: 'string' }, Int: { type: 'integer' }, Float: { type: 'number' }, Boolean: { type: 'boolean' },
  AWSDateTime: { type: 'string', format: 'date-time' }, AWSDate: { type: 'string', format: 'date' }, AWSTime: { type: 'string' }, AWSURL: { type: 'string', format: 'uri' },
  AWSEmail: { type: 'string', format: 'email' }, AWSPhone: { type: 'string' }, AWSIPAddress: { type: 'string' }, AWSTimestamp: { type: 'integer' },
  AWSJSON: { description: 'JSON (an object, or its text)' },
};

/** The JSON Schema of a GraphQL input type (an argument), nested inputs included. */
export function inputSchema(raw: string, depth = 4): JsonSchema {
  const t = typeRef(raw);
  const item = (): JsonSchema => {
    const values = enumValues(t.name);
    if (values) return { type: 'string', enum: values };
    const type = SCHEMA.types[t.name];
    if (type?.k === 'i' && depth > 0) {
      const props = Object.fromEntries(Object.entries(type.f ?? {}).map(([n, f]) => [n, inputSchema(f[0], depth - 1)]));
      const required = Object.entries(type.f ?? {}).filter(([, f]) => f[0].endsWith('!')).map(([n]) => n);
      return { type: 'object', properties: props, ...(required.length ? { required } : {}), additionalProperties: false };
    }
    return { ...(SCALAR_SCHEMAS[t.name] ?? { type: 'string' }) };
  };
  return t.list ? { type: 'array', items: item() } : item();
}

/** The JSON Schema of an answer of type [raw], as its selection reads it (down to [depth]). */
export function outputSchema(raw: string, depth = 2, path: readonly string[] = []): JsonSchema {
  const t = typeRef(raw);
  const nullable = (s: JsonSchema): JsonSchema => (t.nonNull || !s.type ? s : { ...s, type: [...(Array.isArray(s.type) ? s.type : [s.type]), 'null'] as JsonSchema['type'] });
  const item = (): JsonSchema => {
    const values = enumValues(t.name);
    if (values) return { type: 'string', enum: values };
    const type = SCHEMA.types[t.name];
    if (type?.k === 'u') return { type: 'object', description: `One of ${type.v?.join(', ')}`, properties: { __typename: { type: 'string' } } };
    if (type?.k === 'o') {
      const props: Record<string, JsonSchema> = {};
      for (const [n, f] of Object.entries(type.f ?? {})) {
        if (requiresArgs(f)) continue;
        const inner = typeRef(f[0]).name;
        const k = SCHEMA.types[inner]?.k;
        if (k === 'o' && (depth <= 0 || path.includes(inner) || inner === t.name)) continue;
        props[n] = outputSchema(f[0], depth - 1, [...path, t.name]);
      }
      return { type: 'object', properties: props, additionalProperties: true };
    }
    return { ...(SCALAR_SCHEMAS[t.name] ?? {}) };
  };
  return t.list ? nullable({ type: 'array', items: item() }) : nullable(item());
}
