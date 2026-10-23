// The JSON Schemas of the commands (their input and their output) and what derives from them: the
// parsing of the options of a command line, the validation of an input (from the command line or
// from an MCP client), the help of each option. A small subset of JSON Schema (draft 2020-12): the
// types, enum, const, pattern, the bounds of numbers, strings and arrays, required and
// additionalProperties; enough for the inputs of the CLI, without a dependency.
import { usageError } from './errors.js';

export type JsonType = 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';
export type JsonSchema = {
  type?: JsonType | JsonType[];
  description?: string;
  enum?: readonly (string | number | boolean | null)[];
  const?: unknown;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  default?: unknown;
  format?: string;
  anyOf?: JsonSchema[];
  examples?: unknown[];
};
export type ObjectSchema = JsonSchema & { type: 'object'; properties: Record<string, JsonSchema>; required?: readonly string[] };

/** An object schema of [properties], [required] ones, no other property. */
export const object = (properties: Record<string, JsonSchema>, required: readonly string[] = [], description?: string): ObjectSchema =>
  ({ type: 'object', ...(description ? { description } : {}), properties, ...(required.length ? { required } : {}), additionalProperties: false });
/** An object schema whose properties are described, others allowed (outputs: the API may add fields). */
export const openObject = (properties: Record<string, JsonSchema>, description?: string): JsonSchema =>
  ({ type: 'object', ...(description ? { description } : {}), properties, additionalProperties: true });
export const str = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'string', description, ...extra });
export const bool = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'boolean', description, ...extra });
export const int = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'integer', description, ...extra });
export const num = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'number', description, ...extra });
export const list = (description: string, items: JsonSchema = { type: 'string' }, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'array', description, items, ...extra });
export const nullable = (schema: JsonSchema): JsonSchema => ({ ...schema, type: [...(Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []), 'null'] as JsonType[] });

const typesOf = (s: JsonSchema): JsonType[] => (Array.isArray(s.type) ? s.type : s.type ? [s.type] : []);
/** The main type of a schema (the first that is not null). */
export const mainType = (s: JsonSchema): JsonType | undefined => typesOf(s).find((t) => t !== 'null');

function typeMatches(type: JsonType, value: unknown): boolean {
  switch (type) {
    case 'null': return value === null;
    case 'boolean': return typeof value === 'boolean';
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'array': return Array.isArray(value);
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

/** The problems of [value] against [schema] ("agents: must be at most 100"), none when it is valid. */
export function validate(schema: JsonSchema, value: unknown, path = 'input'): string[] {
  const problems: string[] = [];
  if (schema.anyOf) {
    if (!schema.anyOf.some((s) => validate(s, value, path).length === 0)) problems.push(`${path}: matches none of the allowed forms`);
    return problems;
  }
  const types = typesOf(schema);
  if (types.length && !types.some((t) => typeMatches(t, value))) return [`${path}: must be ${types.join(' or ')}`];
  if (schema.const !== undefined && value !== schema.const) problems.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value as never)) problems.push(`${path}: must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) problems.push(`${path}: must have at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && length > schema.maxLength) problems.push(`${path}: must have at most ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) problems.push(`${path}: must match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${path}: must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${path}: must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${path}: must have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${path}: must have at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => problems.push(...validate(schema.items!, item, `${path}[${i}]`)));
  }
  if (typeMatches('object', value)) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (record[key] === undefined) problems.push(`${path}.${key}: is required`);
    for (const [key, v] of Object.entries(record)) {
      if (v === undefined) continue;
      const sub = schema.properties?.[key];
      if (sub) problems.push(...validate(sub, v, `${path}.${key}`));
      else if (schema.additionalProperties === false) problems.push(`${path}.${key}: is not an option`);
      else if (typeof schema.additionalProperties === 'object') problems.push(...validate(schema.additionalProperties, v, `${path}.${key}`));
    }
  }
  return problems;
}

/** [input] checked against [schema]: a usage error (INVALID_INPUT, exit 2) with every problem otherwise. */
export function assertValid(schema: JsonSchema, input: unknown): void {
  const problems = validate(schema, input);
  if (problems.length) throw usageError('INVALID_INPUT', problems.join('; '), { problems });
}

// ---- The command line ----

export const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
export const camel = (flag: string) => flag.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** How a command reads its command line: the properties given as positionals, in order (the last may be an array), and other flag names. */
export type ArgSpec = { positionals?: readonly string[]; aliases?: Readonly<Record<string, string>> };

function coerce(schema: JsonSchema, raw: string, flag: string): unknown {
  const type = mainType(schema);
  if (type === 'integer' || type === 'number') {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) throw usageError('INVALID_INPUT', `${flag}: "${raw}" is not a number`);
    return n;
  }
  if (type === 'boolean') {
    if (/^(true|yes|1|on)$/i.test(raw)) return true;
    if (/^(false|no|0|off)$/i.test(raw)) return false;
    throw usageError('INVALID_INPUT', `${flag}: "${raw}" is not true or false`);
  }
  return raw;
}

/**
 * The input of a command from its command line ([tokens]: what follows its name, the global options
 * taken out): `--flag value`, `--flag=value`, `--flag` and `--no-flag` for a boolean, an array by
 * repeating its flag or by commas; the positionals in the order of [spec]. Flags are the properties
 * in kebab case (maxUsd: --max-usd). Not validated here (assertValid).
 */
export function parseCommandLine(schema: ObjectSchema, spec: ArgSpec, tokens: readonly string[]): Record<string, unknown> {
  const props = schema.properties;
  const input: Record<string, unknown> = {};
  const positionals: string[] = [];
  const propertyOf = (flag: string) => {
    if (spec.aliases?.[flag]) return spec.aliases[flag];
    const name = camel(flag);
    return Object.hasOwn(props, name) && !(spec.positionals ?? []).includes(name) ? name : undefined;
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--') { positionals.push(...tokens.slice(i + 1)); break; }
    if (!token.startsWith('--') || token.length === 2) { positionals.push(token); continue; }
    const eq = token.indexOf('=');
    const flag = token.slice(2, eq < 0 ? undefined : eq);
    const inline = eq < 0 ? undefined : token.slice(eq + 1);
    let name = propertyOf(flag);
    let negated = false;
    if (!name && flag.startsWith('no-')) { name = propertyOf(flag.slice(3)); negated = !!name; }
    if (!name) throw usageError('UNKNOWN_OPTION', `Unknown option --${flag}`, { option: `--${flag}` });
    const sub = props[name];
    const type = mainType(sub);
    if (type === 'boolean') {
      if (negated && inline !== undefined) throw usageError('INVALID_INPUT', `--no-${flag} takes no value`);
      input[name] = inline === undefined ? !negated : coerce(sub, inline, `--${flag}`);
      continue;
    }
    if (negated) throw usageError('UNKNOWN_OPTION', `Unknown option --${flag}`, { option: `--${flag}` });
    const raw = inline ?? tokens[++i];
    if (raw === undefined) throw usageError('MISSING_VALUE', `--${flag} needs a value`, { option: `--${flag}` });
    if (type === 'array') {
      const items = sub.items ?? { type: 'string' };
      const values = raw.split(',').map((v) => v.trim()).filter((v) => v !== '').map((v) => coerce(items, v, `--${flag}`));
      input[name] = [...((input[name] as unknown[]) ?? []), ...values];
    } else input[name] = coerce(sub, raw, `--${flag}`);
  }
  const names = spec.positionals ?? [];
  for (let i = 0; i < names.length && positionals.length; i++) {
    const name = names[i];
    const sub = props[name];
    if (mainType(sub) === 'array' && i === names.length - 1) {
      input[name] = positionals.splice(0).map((v) => coerce(sub.items ?? { type: 'string' }, v, name));
    } else input[name] = coerce(sub, positionals.shift()!, name);
  }
  if (positionals.length) throw usageError('UNEXPECTED_ARGUMENT', `Unexpected argument "${positionals[0]}"`, { argument: positionals[0] });
  return input;
}
