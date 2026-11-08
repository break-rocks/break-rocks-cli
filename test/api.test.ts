// The GraphQL documents of the CLI against the contract: the generated schema is the one of
// schema/api-v2/*.graphql (API v2), every operation's document with its selection is valid,
// and every command sends only valid documents (a fake API validates them with graphql-js).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildSchema, execute as run, getNamedType, isEnumType, isListType, isNonNullType, isObjectType, isScalarType, parse, validate, type GraphQLFieldResolver, type GraphQLOutputType, type GraphQLSchema } from 'graphql';
import { describe, expect, it } from 'vitest';
import { CONTRACT as SCHEMA, documentOf, operation, selection } from '../src/api/graphql.js';
import { SCHEMA as GENERATED } from '../src/api/schema.generated.js';
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
  it('is generated from schema/api-v2/*.graphql (API v2), descriptions and all', async () => {
    const source = join(import.meta.dirname, '..', 'schema', 'api-v2');
    // @ts-expect-error the generator is a script without types
    const { parse: parseSdl, readContract } = await import('../scripts/gen-schema-lib.mjs');
    expect({ ...parseSdl(readContract(source)), version: readFileSync(join(source, 'VERSION'), 'utf8').trim() }).toEqual(JSON.parse(JSON.stringify(GENERATED)));
    expect(GENERATED.version).toBe('v101.5.0');
    // The descriptions ("""…""") are not fields: Query holds the 202 reads of API v2, Mutation its 334 writes.
    expect(Object.keys(GENERATED.query).length).toBe(202);
    expect(Object.keys(GENERATED.mutation).length).toBe(334);
    expect(readdirSync(source).filter((f) => f.endsWith('.graphql')).length).toBe(14);
  });
  it('takes a requestId on every mutation but the four ephemeral signals', () => {
    const without = Object.entries(GENERATED.mutation).filter(([, f]) => !f[1]?.requestId).map(([n]) => n).sort();
    expect(without).toEqual(['recordClipPlays', 'sendLivePositions', 'typing', 'watch']);
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
  post: { text: 'x', in: '%x' }, dm: { account: '@x', text: 'x' }, 'groups send': { id: 'g', text: 'x' }, 'channels send': { channel: '%x&a', text: 'x' }, reply: { id: 'p', text: 'x' }, quote: { id: 'p', text: 'x' }, 'proposals vote': { id: 'p', choice: 'for' }, 'proposals file': { universe: '%x', kind: 'ACTION', title: 'x', tags: ['x'] }, 'layouts check': { document: '{}', in: '%x', online: true },
  'universes territory set': { universe: '%x', circle: '48.85,2.35', radius: '500', name: 'Place' }, 'explore area': { cells: ['851fb463fffffff'] },
  'messages reply-thread': { messageId: 'm', text: 'x' }, 'messages react': { messageId: 'm', emoji: '👍' }, 'messages delete': { messageId: 'm', channel: '%x&general' }, 'messages unreact': { messageId: 'm', emoji: '👍' }, 'places search': { query: 'x', bounds: '48.8,2.2,48.9,2.4' }, 'governance pin': { universe: '%x', channels: ['%x&a'] },
  'drafts schedule': { draftId: 'd', at: '2026-11-10T08:00:00Z' }, 'videos chapters set': { postId: 'p', chapters: '0=Intro' }, 'appearance palette': { media: 'u' }, 'universes tags conventions': { universe: '%x', tags: ['x'] }, 'universes tags view': { universe: '%x#y' }, 'discussions place set': { discussion: 'd', point: '48.85,2.35', name: 'x' },
  'presence start': { point: '48.85,2.35', duration: 'ONE_HOUR', connections: true }, 'presence update': { point: '48.85,2.35' }, 'presence audience': { connections: true },
  'live-share in': { group: 'g' }, 'live-share start': { group: 'g', minutes: 60 }, 'live-share send': { shareId: 's', positions: '48.85,2.35' },
  'locatable on': { universe: '%x', point: '48.85,2.35', activity: 'x', minutes: 60 }, 'locatable move': { universe: '%x', point: '48.85,2.35' },
  'meetups answer': { messageId: 'm', answer: 'ACCEPTED', group: 'g' }, 'meetups change': { messageId: 'm', group: 'g', at: '2026-11-12T18:00:00Z', point: '48.85,2.35', placeName: 'x' }, 'meetups cancel': { messageId: 'm', group: 'g' },
  'posts place': { postId: 'p', point: '48.85,2.35' }, 'routes create': { name: 'x', mode: 'FOOT', points: '48.85,2.35;48.86,2.36' }, 'routes edit': { id: 'r', name: 'x', mode: 'FOOT', points: '48.85,2.35;48.86,2.36' },
  'routes privacy-zones set': { zones: '48.85,2.35,500' }, 'routes plan': { mode: 'FOOT', points: '48.85,2.35;48.86,2.36' }, 'posts subtitles correct': { postId: 'p', file: '[{"startMs":0,"endMs":1,"text":"x"}]' },
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
    const skipped = new Set(['mcp', 'batch', 'operator register', 'operator renew', 'operator recover', 'operator recovery-key set', 'operator delete', 'operator login', 'agent login', 'session', 'login', 'logout', 'update']);
    let ran = 0;
    const operatorOnly = (name: string) => name.startsWith('operator plan ');
    for (const c of commands()) {
      if (skipped.has(c.name) || operatorOnly(c.name)) continue;
      current = c.name;
      const input = SAMPLES[c.name] ?? Object.fromEntries(Object.entries(c.input.properties).filter(([k]) => (c.input.required ?? []).includes(k)).map(([k, v]) => [k, sample(v, k)]));
      try { await execute(ctx, c, input); } catch { /* local checks (files, inputs) may stop a command */ }
      ran++;
    }
    // An agent operator: its plan paid by card (the profile of an operator only).
    ctx.saveProfile({ env: 'dev', kind: 'operator', operatorId: 'eu-op' });
    saveSession(ctx, { kind: 'operator', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op' });
    for (const c of commands().filter((x) => operatorOnly(x.name))) {
      current = c.name;
      const input = Object.fromEntries(Object.entries(c.input.properties).filter(([k]) => (c.input.required ?? []).includes(k)).map(([k, v]) => [k, sample(v, k)]));
      try { await execute(ctx, c, { ...input, ...(c.name === 'operator plan start' ? { open: false } : {}) }); } catch { /* local checks may stop a command */ }
      ran++;
    }
    // A human: its own whoami, capabilities and logout --everywhere (signOutEverywhere).
    ctx.saveProfile({ env: 'dev', kind: 'human', accountId: 'eu-human' });
    saveSession(ctx, { kind: 'human', token: 't', idToken: 'i', refreshToken: 'r', pool: { userPoolId: 'eu-west-1_x', clientId: 'c', region: 'eu-west-1' }, accountId: 'eu-human', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', signInAgainBy: '2099-01-01T00:00:00.000Z' });
    for (const [name, input] of [['whoami', {}], ['capabilities', { universe: '%paris' }], ['usage', {}], ['logout', { everywhere: true }]] as const) {
      current = `${name} (human)`;
      await execute(ctx, commands().find((c) => c.name === name)!, input);
    }
    expect(sent.filter((s) => s.command.endsWith('(human)')).map((s) => s.doc)).toEqual(expect.arrayContaining([expect.stringContaining('mySubscription'), expect.stringContaining('signOutEverywhere')]));
    const invalid = sent.filter((s) => s.errors.length).map((s) => `${s.command}: ${s.errors[0]}`);
    expect(invalid).toEqual([]);
    // No operation, nor field selected, that the contract marks @deprecated (migration.md: the clients move first).
    const deprecated = (GENERATED.deprecated ?? []).filter((d) => /^(Query|Mutation)\./.test(d)).map((d) => d.split('.')[1]);
    const calling = sent.map((s) => ({ command: s.command, op: /^\w+[^{]*\{\s*(\w+)/.exec(s.doc)?.[1] ?? '' })).filter((s) => deprecated.includes(s.op)).map((s) => `${s.command}: ${s.op}`);
    expect([...new Set(calling)]).toEqual([]);
    expect(ran).toBeGreaterThan(150);
    // Those that read a local file first (a document, a GPX file, an image).
    const quiet = new Set(['agent attest', 'wallet balance', 'theme typefaces', 'theme publish', 'map boundary', 'playlists add-doc', 'routes gpx import']);
    const silent = commands().filter((c) => !skipped.has(c.name) && !quiet.has(c.name) && !c.offline && !sent.some((s) => s.command === c.name)).map((c) => c.name);
    expect(silent).toEqual([]);
    expect(sent.length).toBeGreaterThan(150);
  });
});
