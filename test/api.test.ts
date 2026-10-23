// The GraphQL documents of the CLI against the contract: the generated schema is the one of
// schema/schema.graphql, every operation's document with its selection is valid,
// and every command sends only valid documents (a fake API validates them with graphql-js).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSchema, execute as run, getNamedType, isEnumType, isListType, isNonNullType, isObjectType, isScalarType, parse, validate, type GraphQLFieldResolver, type GraphQLOutputType, type GraphQLSchema } from 'graphql';
import { describe, expect, it } from 'vitest';
import { documentOf, operation, selection } from '../src/api/graphql.js';
import { SCHEMA } from '../src/api/schema.generated.js';
import { Context, NO_FLAGS } from '../src/context.js';
import { commands, execute } from '../src/registry.js';
import type { JsonSchema } from '../src/schema.js';
import { saveSession } from '../src/session.js';
import { harness } from './helpers.js';

/** The SDL of the compact schema (the AWS scalars declared). */
function sdlOf(): string {
  const out: string[] = ['scalar AWSDateTime', 'scalar AWSDate', 'scalar AWSTime', 'scalar AWSURL', 'scalar AWSJSON', 'scalar AWSEmail', 'scalar AWSPhone', 'scalar AWSIPAddress', 'scalar AWSTimestamp'];
  const field = (name: string, f: [string, Record<string, string>?]) => `  ${name}${f[1] && Object.keys(f[1]).length ? `(${Object.entries(f[1]).map(([a, t]) => `${a}: ${t}`).join(', ')})` : ''}: ${f[0]}`;
  for (const [name, t] of Object.entries(SCHEMA.types)) {
    if (t.k === 'e') out.push(`enum ${name} { ${t.v!.join(' ')} }`);
    else if (t.k === 'u') out.push(`union ${name} = ${t.v!.join(' | ')}`);
    else if (t.k === 's') { if (!out.includes(`scalar ${name}`)) out.push(`scalar ${name}`); } else out.push(`${t.k === 'i' ? 'input' : 'type'} ${name} {\n${Object.entries(t.f ?? {}).map(([n, f]) => field(n, f)).join('\n')}\n}`);
  }
  out.push(`type Query {\n${Object.entries(SCHEMA.query).map(([n, f]) => field(n, f)).join('\n')}\n}`, `type Mutation {\n${Object.entries(SCHEMA.mutation).map(([n, f]) => field(n, f)).join('\n')}\n}`);
  return out.join('\n');
}
const schema: GraphQLSchema = buildSchema(sdlOf());
const problems = (doc: string) => validate(schema, parse(doc)).map((e) => e.message);

/** A fake answer of the shape of the document: one item per list, the first value of an enum, no next page. */
function mock(type: GraphQLOutputType, field: string): unknown {
  if (isNonNullType(type)) return mock(type.ofType, field);
  if (isListType(type)) return [mock(type.ofType, field)];
  if (isEnumType(type)) return type.getValues()[0].value;
  if (isScalarType(type)) {
    if (field === 'next') return null;
    switch (type.name) {
      case 'Int': return 1; case 'Float': return 1.5; case 'Boolean': return true; case 'AWSJSON': return '{}';
      case 'AWSDateTime': return '2026-10-23T10:00:00.000Z'; case 'AWSDate': return '2026-10-23'; default: return field === 'id' ? 'id-1' : 'x';
    }
  }
  return {};
}
const fieldResolver: GraphQLFieldResolver<unknown, unknown> = (_source, _args, _ctx, info) => mock(info.returnType, info.fieldName);
const typeResolver = (_v: unknown, _c: unknown, info: { returnType: GraphQLOutputType }) => { const t = getNamedType(info.returnType); return isObjectType(t) ? t.name : (schema.getPossibleTypes(t as never)[0]?.name); };

describe('the contract of the API', () => {
  it('is generated from schema/schema.graphql', async () => {
    const source = join(import.meta.dirname, '..', 'schema', 'schema.graphql');
    if (!existsSync(source)) return;
    // @ts-expect-error the generator is a script without types
    const { parse: parseSdl } = await import('../scripts/gen-schema-lib.mjs');
    expect(parseSdl(readFileSync(source, 'utf8'))).toEqual(JSON.parse(JSON.stringify(SCHEMA)));
  });
  it('gives each operation a valid document and selection', () => {
    const invalid: string[] = [];
    for (const kind of ['query', 'mutation'] as const) for (const name of Object.keys(SCHEMA[kind])) {
      const op = operation(kind, name);
      const errors = problems(documentOf(op, Object.keys(op.args)));
      if (errors.length) invalid.push(`${name}: ${errors[0]}`);
    }
    expect(invalid).toEqual([]);
    expect(Object.keys(SCHEMA.query).length).toBeGreaterThan(100);
    expect(selection('Post', 1)).toContain('author {');
  });
});

/** A sample value of a JSON Schema: enough to run a command. */
function sample(s: JsonSchema, name: string): unknown {
  if (s.anyOf) return sample(s.anyOf[0], name);
  if (s.enum) return s.enum[0];
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type;
  if (type === 'integer' || type === 'number') return s.minimum ?? 1;
  if (type === 'boolean') return true;
  if (type === 'array') return [sample(s.items ?? { type: 'string' }, name)];
  if (type === 'object') return Object.fromEntries(Object.entries(s.properties ?? {}).filter(([k]) => s.required?.includes(k)).map(([k, v]) => [k, sample(v, k)]));
  if (s.pattern?.startsWith('^%\\S+/')) return '%x/name';
  if (s.pattern?.startsWith('^%')) return '%x';
  if (s.pattern?.includes('[0-9a-fA-F-]{36}')) return '00000000-0000-4000-8000-000000000000';
  if (s.format === 'date-time') return '2026-10-23T10:00:00.000Z';
  if (/universe|^in$|^to$|address/i.test(name)) return '%x';
  if (/account/i.test(name)) return 'eu-1';
  return 'x';
}

/** Inputs of the commands whose required properties are not enough to send a request. */
const SAMPLES: Record<string, Record<string, unknown>> = {
  post: { text: 'x', in: '%x' }, dm: { account: '@x', text: 'x' }, 'groups send': { id: 'g', text: 'x' }, reply: { id: 'p', text: 'x' }, quote: { id: 'p', text: 'x' }, 'proposals vote': { id: 'p', choice: 'for' },
};

describe('every command', () => {
  it('sends only documents valid against the contract', async () => {
    const sent: { command: string; doc: string; errors: string[] }[] = [];
    let current = '';
    const h = harness({
      env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1' },
      fetch: async (url, init) => {
        if (String(url) !== 'https://api.test/graphql') return new Response('{}', { status: 404 });
        const { query, variables } = JSON.parse(String(init!.body));
        const errors = problems(query);
        sent.push({ command: current, doc: query, errors });
        if (errors.length) return new Response(JSON.stringify({ data: null, errors: [{ errorType: 'INVALID', message: errors[0] }] }), { status: 200 });
        const answer = await run({ schema, document: parse(query), variableValues: variables, fieldResolver, typeResolver: typeResolver as never });
        return new Response(JSON.stringify(answer), { status: 200 });
      },
    });
    const ctx = new Context(h.io, { ...NO_FLAGS, yes: true, env: 'dev' });
    saveSession(ctx, { kind: 'agent', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op', agentId: 'ag' });
    const skipped = new Set(['mcp', 'batch', 'operator register', 'operator renew', 'operator recover', 'operator recovery-key set', 'operator delete', 'operator login', 'agent login', 'session']);
    let ran = 0;
    for (const c of commands()) {
      if (skipped.has(c.name)) continue;
      current = c.name;
      const input = SAMPLES[c.name] ?? Object.fromEntries(Object.entries(c.input.properties).filter(([k]) => (c.input.required ?? []).includes(k)).map(([k, v]) => [k, sample(v, k)]));
      try { await execute(ctx, c, input); } catch { /* local checks (files, inputs) may stop a command */ }
      ran++;
    }
    const invalid = sent.filter((s) => s.errors.length).map((s) => `${s.command}: ${s.errors[0]}`);
    expect(invalid).toEqual([]);
    expect(ran).toBeGreaterThan(150);
    const quiet = new Set(['agent attest', 'wallet balance', 'theme typefaces', 'theme publish']);
    const silent = commands().filter((c) => !skipped.has(c.name) && !quiet.has(c.name) && !c.offline && !sent.some((s) => s.command === c.name)).map((c) => c.name);
    expect(silent).toEqual([]);
    expect(sent.length).toBeGreaterThan(150);
  });
});
