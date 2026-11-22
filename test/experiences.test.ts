// Specs v136.3.0 (D-423, D-424, contracts/experiences.md): the experience definitions as portable documents: list, show,
// export, check (offline by the JSON Schema of the specs, then checkExperience), import (one file or a folder, the daily
// limit, a delegated agent never public) and the prompt kit built from the contract the CLI carries. Against a scripted API.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { saveSession } from '../src/session.js';
import { harness, last, tempDir } from './helpers.js';

type Call = { field: string; variables: Record<string, unknown>; query: string };
type Refusal = { error: { code: string; info?: unknown } };
const refusal = (code: string, info?: unknown): Refusal => ({ error: { code, info } });

/** A fake API: [answers] by field (a function gets the variables; { error } refuses), as a human or a delegated agent. */
function fake(answers: Record<string, unknown>, as: 'human' | 'agent' = 'human') {
  const calls: Call[] = [];
  const h = harness({
    env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1' },
    fetch: async (_url, init) => {
      const { query, variables } = JSON.parse(String(init!.body));
      const field = /\{\s*(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      calls.push({ field, variables, query });
      const raw = answers[field];
      const answer = typeof raw === 'function' ? raw(variables) : raw ?? null;
      const error = (answer as Refusal | null)?.error;
      if (error) return Response.json({ data: { [field]: null }, errors: [{ errorType: error.code, message: '', ...(error.info ? { errorInfo: error.info } : {}) }] });
      return Response.json({ data: { [field]: answer } });
    },
  });
  const ctx = new Context(h.io, NO_FLAGS);
  if (as === 'human') {
    ctx.saveProfile({ env: 'dev', kind: 'human', accountId: 'eu-alice' });
    saveSession(ctx, { kind: 'human', token: 't', idToken: 'i', refreshToken: 'r', pool: { userPoolId: 'eu-west-1_x', clientId: 'c', region: 'eu-west-1' }, accountId: 'eu-alice', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', signInAgainBy: '2099-01-01T00:00:00.000Z' });
  } else {
    saveSession(ctx, { kind: 'agent', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op', agentId: 'ag' });
  }
  const write = (name: string, value: unknown) => { const path = join(h.dir, name); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value)); return path; };
  return { h, calls, write };
}

/** A simple challenge as an LLM may write it: keys in any order, two languages. */
const squats = (over: Record<string, unknown> = {}) => ({
  challenge: { endsWithinHours: 24, proof: { validation: 'ORGANIZER', media: ['VIDEO'] }, target: { atLeast: 100 }, unit: { fr: 'squats', en: 'squats' }, measure: 'COUNT' },
  instruction: { en: 'Do 100 squats and film the last ten.' }, title: { fr: '100 squats', en: '100 squats' },
  name: 'squats-100', owner: '@alice', engine: { version: 1, name: 'challenge' }, format: 'breakrocks.experience/4',
  warnings: ['PHYSICAL_EFFORT'], ranking: { order: 'HIGHER_FIRST', measure: 'COUNT' }, parameters: [{ default: 100, max: 1000, min: 10, field: 'target', key: 'count' }],
  ...over,
});
const ID = 'eu-0199f3c2-8a00-7c3a-9d2f-0a1b2c3d4e60';
const experience = (over: Record<string, unknown> = {}) => ({
  id: ID, address: '@alice*squats-100', url: 'https://break.rocks/a/alice/e/squats-100', name: 'squats-100', ownerAccount: { id: 'eu-alice', handle: 'alice' }, ownerUniverse: null,
  title: '100 squats', instruction: 'Do 100 squats and film the last ten.', version: '1.0', engine: { name: 'CHALLENGE', version: 1 }, visibility: 'PRIVATE', check: null,
  warnings: ['PHYSICAL_EFFORT'], rankingMeasure: 'COUNT', rankingOrder: 'HIGHER_FIRST', copiedFrom: null, adoptedBy: [], automated: false, via: null, ...over,
});

describe('export and import', () => {
  it('round-trips: export writes the portable document, import sends it, export again gives the same bytes', async () => {
    // The platform keeps the template as created, with the fields it sets.
    let stored: Record<string, unknown> = { ...squats(), id: ID, version: '1.0', copiedFrom: { experienceId: 'eu-0199f3c2-8a00-7c3a-9d2f-0a1b2c3d4e61', version: '2.0' } };
    const { h, calls } = fake({
      resolveAddress: () => ({ experience: { ...experience(), document: JSON.stringify(stored) } }),
      experience: () => ({ ...experience(), document: JSON.stringify(stored) }),
      createExperience: (v: { d: string }) => { stored = { ...JSON.parse(v.d), id: ID, version: '1.0' }; return experience(); },
    });
    expect(await h.run('experiences', 'export', '@alice*squats-100', '--out', 'squats.json')).toBe(0);
    expect(h.lines.at(-1)).toBe(`squats.json written (${readFileSync(join(h.dir, 'squats.json')).length} bytes): @alice*squats-100 [${ID}]`);
    const first = readFileSync(join(h.dir, 'squats.json'), 'utf8');
    const doc = JSON.parse(first);
    // The fields the platform sets are left out; the keys in the order of the schema, the text maps sorted.
    expect(Object.keys(doc)).toEqual(['format', 'engine', 'owner', 'name', 'title', 'instruction', 'warnings', 'ranking', 'parameters', 'challenge']);
    expect(Object.keys(doc.challenge)).toEqual(['measure', 'unit', 'target', 'proof', 'endsWithinHours']);
    expect(Object.keys(doc.title)).toEqual(['en', 'fr']);
    expect(first.endsWith('}\n')).toBe(true);
    expect(await h.run('experiences', 'export', '@alice*squats-100', '--out', 'squats.json')).toBe(2);
    expect(h.errors.join('\n')).toMatch(/FILE_EXISTS/);

    expect(await h.run('experiences', 'import', 'squats.json', '--request-id', '0199f3c2-8a00-7c3a-9d2f-0a1b2c3d4e70')).toBe(0);
    const create = calls.find((c) => c.field === 'createExperience')!;
    expect(create.variables.r).toBe('0199f3c2-8a00-7c3a-9d2f-0a1b2c3d4e70');
    expect(create.variables.d).toBe(JSON.stringify(doc));
    expect(calls.some((c) => c.field === 'publishExperience')).toBe(false);
    expect(h.lines.at(-1)).toBe(`created @alice*squats-100 [${ID}], version 1.0, PRIVATE`);

    expect(await h.run('experiences', 'export', ID, '--out', 'again.json')).toBe(0);
    expect(readFileSync(join(h.dir, 'again.json'), 'utf8')).toBe(first);
    expect(await h.run('experiences', 'export', ID, '--json')).toBe(0);
    expect(last(h)).toEqual(doc);
  });

  it('refuses to export the template of someone else: only its owner reads it', async () => {
    const { h } = fake({ resolveAddress: { experience: { ...experience({ visibility: 'PUBLIC', ownerAccount: { id: 'eu-bob', handle: 'bob' } }), document: null } } });
    expect(await h.run('experiences', 'export', '@bob*squats-100', '--json')).toBe(1);
    expect(last<{ error: { code: string; message: string } }>(h).error).toMatchObject({ code: 'EXPERIENCE_DOCUMENT_NOT_READABLE', message: expect.stringMatching(/copied into your experiences/) });
  });

  it('leaves out the fields the platform sets, replaces @me, --owner and --name, and publishes only when asked', async () => {
    let created = experience();
    const { h, calls, write } = fake({
      me: { handle: 'alice' },
      createExperience: (v: { d: string }) => (created = experience({ name: JSON.parse(v.d).name, address: `@alice*${JSON.parse(v.d).name}` })),
      publishExperience: (v: { v: string }) => ({ ...created, visibility: v.v === 'PUBLIC' ? 'PRIVATE' : v.v, check: v.v === 'PUBLIC' ? { status: 'CHECKING', explanation: null, reviewPending: false, version: '1.0' } : null }),
    });
    write('raw.json', { ...squats({ owner: '@me' }), id: ID, version: '3.1' });
    expect(await h.run('experiences', 'import', 'raw.json', '--name', 'squats-50', '--visibility', 'public')).toBe(0);
    const sent = JSON.parse(String(calls.find((c) => c.field === 'createExperience')!.variables.d));
    expect(sent).toMatchObject({ owner: '@alice', name: 'squats-50' });
    expect(sent.id).toBeUndefined();
    expect(sent.version).toBeUndefined();
    expect(calls.find((c) => c.field === 'publishExperience')!.variables).toMatchObject({ id: ID, v: 'PUBLIC' });
    expect(h.lines.at(-1)).toMatch(/^created @alice\*squats-50 .*PRIVATE; being checked before it is PUBLIC \(experiences show @alice\*squats-50 tells the outcome\) \(left out, set by the platform: id, version\)$/);
    expect(await h.run('experiences', 'import', 'raw.json', '--visibility', 'unlisted', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ result: 'created', visibility: 'UNLISTED' });
  });

  it('updates an experience of yours at the address with --update, refuses one that is not yours', async () => {
    let mine = true;
    const { h, calls, write } = fake({
      resolveAddress: () => ({ experience: { id: ID, visibility: 'PUBLIC', document: mine ? '{}' : null } }),
      updateExperience: experience({ version: '1.1', visibility: 'PUBLIC', check: { status: 'CHECKING', explanation: null, reviewPending: false, version: '1.1' } }),
    });
    write('squats.json', squats());
    expect(await h.run('experiences', 'import', 'squats.json', '--update')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['resolveAddress', 'updateExperience']);
    expect(calls[0].variables).toEqual({ a: '@alice*squats-100' });
    expect(calls[1].variables).toMatchObject({ id: ID });
    expect(h.lines.at(-1)).toMatch(/^updated @alice\*squats-100 .*version 1\.1, PUBLIC; being checked/);
    mine = false;
    expect(await h.run('experiences', 'import', 'squats.json', '--update', '--json')).toBe(1);
    expect(last<{ error: { code: string; source: string } }>(h).error).toMatchObject({ code: 'EXPERIENCE_NOT_YOURS', source: 'cli' });
  });

  it('creates when --update finds nothing, and says the name is taken without --update', async () => {
    const { h, calls, write } = fake({ resolveAddress: refusal('EXPERIENCE_NOT_FOUND'), createExperience: refusal('EXPERIENCE_NAME_TAKEN') });
    write('squats.json', squats());
    expect(await h.run('experiences', 'import', 'squats.json', '--update', '--json')).toBe(1);
    expect(calls.map((c) => c.field)).toEqual(['resolveAddress', 'createExperience']);
    expect(last<{ error: { code: string; message: string } }>(h).error).toMatchObject({ code: 'EXPERIENCE_NAME_TAKEN', message: expect.stringMatching(/--update replaces it when it is yours/) });
  });

  it('sends nothing when the document has a problem, and prints the problems of the platform', async () => {
    const problems = [{ code: 'NAME_TAKEN', path: '/name', message: 'the name is held by a route of @alice' }];
    const { h, calls, write } = fake({ createExperience: refusal('EXPERIENCE_DOCUMENT_INVALID', { problems }) });
    write('bad.json', squats({ title: { fr: 'x' } }));
    expect(await h.run('experiences', 'import', 'bad.json')).toBe(1);
    expect(calls).toEqual([]);
    expect(h.errors.join('\n')).toMatch(/EXPERIENCE_DOCUMENT_INVALID.*1 problem \(found before sending it\):\n {2}SCHEMA {2}\/title\/en: is required/s);
    write('good.json', squats());
    expect(await h.run('experiences', 'import', 'good.json', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'EXPERIENCE_DOCUMENT_INVALID', source: 'platform', problems: [{ ...problems[0], source: 'platform' }] } });
  });

  it('checks with the platform and writes nothing with --dry-run', async () => {
    const { h, calls, write } = fake({ checkExperience: [] });
    write('squats.json', squats());
    expect(await h.run('experiences', 'import', 'squats.json', '--dry-run')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['checkExperience']);
    expect(h.lines.at(-1)).toBe('squats.json: OK, would create @alice*squats-100 as PRIVATE (dry run: nothing written)');
  });
});

describe('a delegated agent', () => {
  it('never makes an experience public: refused before anything is sent', async () => {
    const { h, calls, write } = fake({ createExperience: experience({ automated: true, via: 'coach' }) }, 'agent');
    write('squats.json', squats());
    expect(await h.run('experiences', 'import', 'squats.json', '--visibility', 'public', '--json')).toBe(1);
    expect(calls).toEqual([]);
    expect(last(h)).toMatchObject({ error: { code: 'EXPERIENCE_VISIBILITY_NOT_ALLOWED', source: 'cli', message: expect.stringMatching(/never makes it public/) } });
    expect(await h.run('experiences', 'import', '--dir', '.', '--visibility', 'PUBLIC')).toBe(1);
    expect(calls).toEqual([]);
    // Private, it creates for its human, with the Automated mark.
    expect(await h.run('experiences', 'import', 'squats.json')).toBe(0);
    expect(h.lines.at(-1)).toMatch(/PRIVATE; Automated mark \(coach\)$/);
  });
  it('gets the platform refusal said plainly when it asks for a public experience anyway', async () => {
    const { h, write } = fake({ resolveAddress: { experience: { id: ID, visibility: 'PRIVATE', document: '{}' } }, updateExperience: experience(), publishExperience: refusal('EXPERIENCE_VISIBILITY_NOT_ALLOWED') }, 'agent');
    write('squats.json', squats());
    expect(await h.run('experiences', 'import', 'squats.json', '--update', '--visibility', 'unlisted', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'EXPERIENCE_VISIBILITY_NOT_ALLOWED', source: 'platform', message: expect.stringMatching(/^Updated @alice\*squats-100 .*not made unlisted.*a delegated agent never makes an experience public/) } });
  });
});

describe('a folder', () => {
  it('imports every *.json in order, goes on after a failure, prints a table and exits 1', async () => {
    let n = 0;
    const { h, calls, write } = fake({ createExperience: (v: { d: string }) => { n++; const name = JSON.parse(v.d).name; return experience({ id: `eu-${n}`, name, address: `@alice*${name}` }); } });
    write('xp/a.json', squats({ name: 'a-one' }));
    write('xp/b.json', squats({ name: 'b-two', title: {} }));
    write('xp/c.json', squats({ name: 'c-three' }));
    write('xp/notes.txt', 'not a document');
    expect(await h.run('experiences', 'import', '--dir', 'xp', '--rate', '30')).toBe(1);
    expect(calls.filter((c) => c.field === 'createExperience').map((c) => JSON.parse(String(c.variables.d)).name)).toEqual(['a-one', 'c-three']);
    expect(h.slept).toEqual([2000, 2000]);
    expect(h.lines.at(-1)).toBe([
      'FILE    RESULT   ADDRESS         ID OR CODE',
      'a.json  created  @alice*a-one    eu-1',
      'b.json  failed                   EXPERIENCE_DOCUMENT_INVALID',
      '    SCHEMA  /title/en: is required',
      'c.json  created  @alice*c-three  eu-2',
      '3 files: 2 created, 0 updated, 1 failed.',
    ].join('\n'));
  });
  it('stops cleanly at the daily limit, with the time it opens again, the rest not tried', async () => {
    let n = 0;
    const retryAt = '2026-11-19T00:00:00.000Z';
    const { h, calls, write } = fake({ createExperience: () => (++n > 1 ? refusal('EXPERIENCE_RATE_LIMITED', { retryAt }) : experience()) });
    for (const name of ['a', 'b', 'c', 'd']) write(`xp/${name}.json`, squats({ name: `${name}-x` }));
    expect(await h.run('experiences', 'import', '--dir', 'xp', '--json')).toBe(1);
    expect(calls.filter((c) => c.field === 'createExperience')).toHaveLength(2);
    expect(last(h)).toMatchObject({ total: 4, created: 1, failed: 1, notTried: 2, stopped: { code: 'EXPERIENCE_RATE_LIMITED', retryAt }, results: [{ file: 'a.json', result: 'created' }, { file: 'b.json', result: 'failed', code: 'EXPERIENCE_RATE_LIMITED', retryAt }, { file: 'c.json', result: 'not tried' }, { file: 'd.json', result: 'not tried' }] });
    expect(await h.run('experiences', 'import', '--dir', 'xp')).toBe(1);
    expect(h.lines.at(-1)).toMatch(/4 files: 0 created, 0 updated, 1 failed, 3 not tried\. Stopped: EXPERIENCE_RATE_LIMITED, again from 2026-11-19T00:00:00\.000Z\.$/);
  });
  it('stops at once while the platform keeps the experiences closed', async () => {
    const { h, calls, write } = fake({ createExperience: refusal('EXPERIENCES_NOT_OPEN') });
    for (const name of ['a', 'b']) write(`xp/${name}.json`, squats({ name: `${name}-x` }));
    expect(await h.run('experiences', 'import', '--dir', 'xp', '--json')).toBe(1);
    expect(calls).toHaveLength(1);
    expect(last(h)).toMatchObject({ failed: 1, notTried: 1, stopped: { code: 'EXPERIENCES_NOT_OPEN' } });
    expect(await h.run('experiences', 'import', 'xp/a.json')).toBe(1);
    expect(h.errors.at(-1)).toMatch(/EXPERIENCES_NOT_OPEN.*the switch experiences\.open is off/s);
  });
});

describe('experiences check', () => {
  it('prints every problem with its code and JSON pointer, one per path, exit 1', async () => {
    const { h, calls, write } = fake({});
    write('bad.json', { ...squats({ name: 'event', warnings: ['PHYSICAL_EFFORT', 'PHYSICAL_EFFORT'], ranking: { measure: 'TIME', order: 'HIGHER_FIRST' }, title: { en: '🏋️'.repeat(101) } }), id: ID });
    expect(await h.run('experiences', 'check', 'bad.json', '--offline')).toBe(1);
    expect(calls).toEqual([]);
    expect(h.lines.at(-1)).toBe([
      'bad.json: challenge/1, @alice*event: 5 problems (checked offline only (--offline); specs v158.0.0)',
      '  TEXT_TOO_LONG  /title/en: 101 visible characters, 100 at most',
      '  SCHEMA  /name: must not be "event" nor "route"',
      '  SCHEMA  /warnings: must not hold the same item twice',
      '  FIELD_SET_BY_PLATFORM  /id: "id" is set by the platform, never given (leave it out)',
      '  RANKING_MEASURE_MISMATCH  /ranking/measure: the ranking is on TIME, the measure of the challenge is COUNT',
    ].join('\n'));
    expect(await h.run('experiences', 'check', 'bad.json', '--offline', '--json')).toBe(1);
    expect(last<{ problems: { code: string; path: string; source: string }[] }>(h).problems.map((p) => `${p.code} ${p.path} ${p.source}`)).toContain('SCHEMA /name cli');
    write('broken.json', '{ "format": ');
    expect(await h.run('experiences', 'check', 'broken.json', '--offline')).toBe(1);
    expect(h.lines.at(-1)).toMatch(/^broken\.json: no engine: 1 problem .*\n {2}SCHEMA {2}\(document\): not JSON/);
  });
  it('adds the problems of the platform, its own first, and says when it could not ask it', async () => {
    let open = true;
    const { h, calls, write } = fake({ checkExperience: () => (open ? [{ code: 'NAME_TAKEN', path: '/name', message: 'held by a route of the owner' }] : refusal('EXPERIENCES_NOT_OPEN')) });
    write('squats.json', squats());
    expect(await h.run('experiences', 'check', 'squats.json')).toBe(1);
    expect(calls[0].variables).toEqual({ d: JSON.stringify(squats()) });
    expect(h.lines.at(-1)).toBe('squats.json: challenge/1, @alice*squats-100: 1 problem (checked by the platform too (checkExperience); specs v158.0.0)\n  NAME_TAKEN  /name: held by a route of the owner');
    open = false;
    expect(await h.run('experiences', 'check', 'squats.json')).toBe(0);
    expect(h.lines.at(-1)).toMatch(/OK \(checked offline only: the platform does not open the experiences yet \(EXPERIENCES_NOT_OPEN\)/);
  });
  it('reads the standard input, and checks offline when the profile is not signed in', async () => {
    const h = harness({ env: { BREAKROCKS_API_URL: 'https://api.test/graphql' } });
    h.io.readStdin = async () => JSON.stringify(squats());
    expect(await h.run('experiences', 'check', '-')).toBe(0);
    expect(h.lines.at(-1)).toMatch(/^-: challenge\/1, @alice\*squats-100: OK \(checked offline only: the profile is not signed in/);
  });
});

describe('experiences list and show', () => {
  it('lists yours by default, an account by its id beside its handle', async () => {
    const { h, calls } = fake({ me: { handle: 'alice' }, experiences: { items: [experience({ visibility: 'PUBLIC', check: { status: 'PASSED', reviewPending: false, version: '1.0' } }), experience({ id: 'eu-2', address: '@alice*plank', title: 'Plank', automated: true, via: 'coach' })], next: 'n2' } });
    expect(await h.run('experiences', 'list')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['me', 'experiences']);
    expect(calls[1].variables).toMatchObject({ o: '@alice' });
    expect(h.lines.at(-1)).toBe([
      `@alice*squats-100  challenge/1 v1.0  PUBLIC  100 squats  owner @alice (eu-alice)  [${ID}]`,
      '@alice*plank  challenge/1 v1.0  PRIVATE  Plank  owner @alice (eu-alice)  Automated (coach)  [eu-2]',
      'next: n2',
    ].join('\n'));
    expect(await h.run('experiences', 'list', '--owner', '*')).toBe(0);
    expect(calls.at(-1)!.variables).toMatchObject({ o: '%root' });
    expect(await h.run('experiences', 'list', '--owner', '%paris', '--mine')).toBe(2);
  });
  it('shows one by its address or its id', async () => {
    const { h, calls } = fake({ resolveAddress: { experience: experience({ check: { status: 'REFUSED', explanation: 'It asks to climb a fence.', reviewPending: false, version: '1.0' } }) }, experience: experience() });
    expect(await h.run('experiences', 'show', '@alice*squats-100')).toBe(0);
    expect(h.lines.at(-1)).toMatch(/^@alice\*squats-100 {2}\[eu-0199[\s\S]*\n {2}owner @alice \(eu-alice\)\n {2}check refused \(version 1\.0\): It asks to climb a fence\./m);
    expect(await h.run('experiences', 'show', ID, '--quiet')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'experience', variables: { id: ID } });
    expect(h.lines.at(-1)).toBe(ID);
  });
});

describe('experiences prompt', () => {
  it('is built from the contract the CLI carries: the schema of the engine, its rules, an example; it sends nothing', async () => {
    const h = harness();
    expect(await h.run('experiences', 'prompt', '--engine', 'challenge/1', '--theme', 'a morning workout', '--language', 'fr', '--json')).toBe(0);
    const r = last<{ prompt: string; engine: string; specs: string; example: string }>(h);
    expect(r).toMatchObject({ engine: 'challenge/1', specs: 'v158.0.0', example: 'vectors/challenge-1.json#squats' });
    const shipped = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'schema', 'experiences', 'definition.schema.json'), 'utf8'));
    const schema = JSON.parse(/# JSON Schema[^\n]*\n\n```json\n([\s\S]*?)\n```/.exec(r.prompt)![1]);
    expect(schema.properties.engine.properties).toEqual({ name: { const: 'challenge' }, version: { const: 1 } });
    // The block of the engine, narrowed to its version (challenge/2 beside it since D-461: no measuredBy for challenge/1).
    expect(JSON.stringify(schema.properties.challenge)).toContain(JSON.stringify(shipped.properties.challenge));
    expect(JSON.stringify(schema.properties.challenge)).toContain('"measuredBy":false');
    expect(schema.$defs.challenge).toEqual(shipped.$defs.challenge);
    expect(schema.properties.route).toBeUndefined();
    expect(schema.properties.id).toBeUndefined();
    expect(schema.required).toContain('challenge');
    expect(r.prompt).toMatch(/Answer with the JSON document only/);
    expect(r.prompt).toMatch(/\/title 1 to 100; \/instruction 1 to 500; \/challenge\/unit 1 to 30/);
    expect(r.prompt).toMatch(/No reward, no prize, no money/);
    expect(r.prompt).toMatch(/"fr" and English/);
    const example = JSON.parse(/# Example[^\n]*\n\n```json\n([\s\S]*?)\n```/.exec(r.prompt)![1]);
    expect(example).toMatchObject({ name: 'squats-100', engine: { name: 'challenge', version: 1 } });
    expect(example.version).toBeUndefined();
    // route/1: no ranking, no parameters; the place feats are not documents of this CLI.
    expect(await h.run('experiences', 'prompt', '--engine', 'route', '--json')).toBe(0);
    const route = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(last<{ prompt: string }>(h).prompt)![1]);
    expect(Object.keys(route.properties)).toEqual(['format', 'engine', 'owner', 'name', 'title', 'instruction', 'warnings', 'route']);
    expect(await h.run('experiences', 'prompt', '--engine', 'presence/3', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'ENGINE_FORMAT_NOT_SUPPORTED' } });
    expect(await h.run('experiences', 'prompt', '--engine', 'quiz/1', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'ENGINE_UNKNOWN', engines: ['route/1', 'challenge/1', 'challenge/2', 'meetup/1', 'multiday/1', 'rounds/1', 'tournament/1', 'tournament/2', 'visit/1', 'contest/1'] } });
    expect(await h.run('experiences', 'prompt', '--engine', 'challenge/1', '--language', 'french', '--json')).toBe(2);
  });

  it('takes the candidate places of a file (what map places search --json answers) and writes the prompt to a file', async () => {
    const h = harness();
    writeFileSync(join(h.dir, 'places.json'), JSON.stringify([{ id: 'R7444', name: 'Paris', kind: 'city', point: { lat: 48.8566, lon: 2.3522 }, address: null, universes: ['%paris'] }, { name: 'Bassin de la Villette', lat: 48.8867, lon: 2.3708 }]));
    expect(await h.run('experiences', 'prompt', '--engine', 'challenge/1', '--area', '48.81,2.22,48.90,2.47', '--places-file', 'places.json', '--out', 'prompt.md')).toBe(0);
    expect(h.lines.at(-1)).toMatch(/^prompt\.md written \(\d+ bytes\): the prompt for challenge\/1$/);
    const prompt = readFileSync(join(h.dir, 'prompt.md'), 'utf8');
    expect(prompt).toMatch(/Area: the box from latitude 48\.81 to 48\.9 and longitude 2\.22 to 2\.47/);
    expect(prompt).toMatch(/No invented place\. .*copied exactly/);
    expect(JSON.parse(/# Candidate places[^\n]*\n\n```json\n([\s\S]*?)\n```/.exec(prompt)![1])).toEqual([{ id: 'R7444', name: 'Paris', lat: 48.8566, lon: 2.3522, kind: 'city' }, { name: 'Bassin de la Villette', lat: 48.8867, lon: 2.3708 }]);
    writeFileSync(join(h.dir, 'bad.json'), JSON.stringify([{ name: 'Nowhere' }]));
    expect(await h.run('experiences', 'prompt', '--engine', 'challenge/1', '--places-file', 'bad.json', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'PLACES_FILE_INVALID' } });
    expect(await h.run('experiences', 'prompt', '--engine', 'challenge/1', '--stages', '5', '--json')).toBe(0);
    expect(last<{ prompt: string }>(h).prompt).toMatch(/has no stages, so describe them in the instruction/);
  });

  it('sees an engine the specs add, from another copy of the contract, never written in the code', async () => {
    const h = harness();
    const copy = join(tempDir('breakrocks-contract-'), 'experiences');
    cpSync(join(import.meta.dirname, '..', 'schema', 'experiences'), copy, { recursive: true });
    const enginesFile = join(copy, 'engines.json');
    const registry = JSON.parse(readFileSync(enginesFile, 'utf8'));
    registry.engines.push({ name: 'scavenger', version: 1, since: 'v999.0.0', format: 'breakrocks.experience/4', what: 'The scavenger hunt: a few stages among the places of an area.', owners: ['account'], places: ['solo'], proofs: ['DEVICE_CHECKED'], rankingMeasures: [], widgets: ['MAP_PROGRESS'], parameterFields: [] });
    writeFileSync(enginesFile, JSON.stringify(registry));
    // In the registry only: the template does not define its documents yet.
    expect(await h.run('experiences', 'prompt', '--engine', 'scavenger/1', '--contract', copy, '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'ENGINE_NOT_IN_TEMPLATE' } });
    // And in the template: its block and its condition.
    const schemaFile = join(copy, 'definition.schema.json');
    const schema = JSON.parse(readFileSync(schemaFile, 'utf8'));
    schema.properties.engine.properties.name.enum.push('scavenger');
    schema.properties.scavenger = { type: 'object', additionalProperties: false, required: ['stages'], properties: { stages: { type: 'array', minItems: 2, maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['placeId', 'lat', 'lon'], properties: { placeId: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' } } } } } };
    schema.allOf.push({ if: { properties: { engine: { type: 'object', properties: { name: { const: 'scavenger' } } } } }, then: { required: ['scavenger'], properties: { route: false, challenge: false, ranking: false } } });
    for (const branch of schema.allOf.slice(0, 2)) branch.then.properties.scavenger = false;
    writeFileSync(schemaFile, JSON.stringify(schema));
    expect(await h.run('experiences', 'prompt', '--engine', 'scavenger/1', '--contract', copy, '--stages', '4', '--json')).toBe(0);
    const r = last<{ prompt: string; engine: string; example: string | null }>(h);
    expect(r).toMatchObject({ engine: 'scavenger/1', example: null });
    expect(r.prompt).toMatch(/The engine scavenger\/1: The scavenger hunt: a few stages among the places of an area\./);
    expect(r.prompt).toMatch(/About 4 stages/);
    const narrowed = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(r.prompt)![1]);
    expect(narrowed.properties.engine.properties.name).toEqual({ const: 'scavenger' });
    expect(narrowed.properties.scavenger).toEqual(schema.properties.scavenger);
    expect(narrowed.required).toContain('scavenger');
    expect(narrowed.properties.challenge).toBeUndefined();
    expect(narrowed.properties.route).toBeUndefined();
    // The CLI does not carry scavenger/1: it is unknown to it without --contract.
    expect(await h.run('experiences', 'prompt', '--engine', 'scavenger/1', '--json')).toBe(2);
    // The offline check reads the same copy.
    writeFileSync(join(h.dir, 'visit.json'), JSON.stringify({ format: 'breakrocks.experience/4', engine: { name: 'scavenger', version: 1 }, owner: '@alice', name: 'old-paris', title: { en: 'Old Paris' }, instruction: { en: 'Visit the stages.' }, scavenger: { stages: [{ placeId: 'p1', lat: 48.85, lon: 2.35 }] } }));
    expect(await h.run('experiences', 'check', 'visit.json', '--offline', '--contract', copy)).toBe(1);
    expect(h.lines.at(-1)).toMatch(/1 problem .*\n {2}SCHEMA {2}\/scavenger\/stages: must have at least 2 items$/);
  });
});
