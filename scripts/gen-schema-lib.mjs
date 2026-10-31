// The contract of API v2 in its compact form (scripts/gen-schema.mjs; test/api.test.ts): the SDL files
// read in the order of their names, parsed by graphql-js (descriptions and comments dropped), the AppSync
// scalars declared (the contract does not declare them).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSchema, isEnumType, isInputObjectType, isInterfaceType, isObjectType, isScalarType, isUnionType } from 'graphql';

/** The scalars of AppSync, declared for graphql-js when the SDL uses them. */
export const AWS_SCALARS = ['AWSDateTime', 'AWSDate', 'AWSTime', 'AWSTimestamp', 'AWSURL', 'AWSJSON', 'AWSEmail', 'AWSPhone', 'AWSIPAddress'];

/** The SDL of a folder of the contract: its .graphql files in the order of their names. */
export function readContract(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.graphql')).sort().map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
}

/** The SDL with the AppSync scalars it uses declared. */
export function withScalars(sdl) {
  const declared = new Set([...sdl.matchAll(/^scalar\s+(\w+)/gm)].map((m) => m[1]));
  const scalars = AWS_SCALARS.filter((s) => !declared.has(s) && new RegExp(`\\b${s}\\b`).test(sdl)).map((s) => `scalar ${s}`);
  return `${scalars.join('\n')}\n${sdl}`;
}

/** The SDL in its compact form: { types: { Name: { k: 'o'|'i'|'e'|'u'|'s', f?: { field: [type, args?] }, v?: [values] } }, query, mutation }. */
export function parse(sdl) {
  const schema = buildSchema(withScalars(sdl));
  const fieldsOf = (type) => Object.fromEntries(Object.values(type.getFields()).map((f) => {
    const args = Object.fromEntries((f.args ?? []).map((a) => [a.name, String(a.type)]));
    return [f.name, Object.keys(args).length ? [String(f.type), args] : [String(f.type)]];
  }));
  const builtIn = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);
  const types = {};
  for (const type of Object.values(schema.getTypeMap()).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (type.name.startsWith('__') || builtIn.has(type.name) || type === schema.getQueryType() || type === schema.getMutationType()) continue;
    if (isEnumType(type)) types[type.name] = { k: 'e', v: type.getValues().map((v) => v.name) };
    else if (isUnionType(type)) types[type.name] = { k: 'u', v: type.getTypes().map((t) => t.name) };
    else if (isScalarType(type)) types[type.name] = { k: 's' };
    else if (isInputObjectType(type)) types[type.name] = { k: 'i', f: fieldsOf(type) };
    else if (isObjectType(type) || isInterfaceType(type)) types[type.name] = { k: 'o', f: fieldsOf(type) };
  }
  return { types, query: fieldsOf(schema.getQueryType()), mutation: fieldsOf(schema.getMutationType()) };
}
