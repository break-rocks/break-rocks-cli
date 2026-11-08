import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { CliError } from '../src/errors.js';
import { degrade, nullRemoved, unservedFields } from '../src/api/degrade.js';
import { graphql } from '../src/transport.js';
import { saveSession } from '../src/session.js';
import { harness, last } from './helpers.js';

const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
/** The answer of AppSync to a field it does not serve: a validation error, no data, nothing run. */
const undefinedField = (field: string, type: string, path: string) => ({ path: null, locations: [{ line: 1, column: 20, sourceName: null }], message: `Validation error of type FieldUndefined: Field '${field}' in type '${type}' is undefined @ '${path}'` });
function scripted(...answers: Response[]) {
  const queries: string[] = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    queries.push((JSON.parse(String(init!.body)) as { query: string }).query);
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    return next;
  };
  return { fetch, queries };
}
const ctxOf = (fetch: typeof globalThis.fetch, json = false) => { const h = harness({ fetch }); return { h, ctx: new Context(h.io, { ...NO_FLAGS, json }) }; };

describe('the fields a backend behind this CLI does not serve', () => {
  it('reads them from FieldUndefined validation errors, and only when every error is one', () => {
    expect(unservedFields([undefinedField('digestOf', 'Post', 'post/digestOf'), undefinedField('aiDescription', 'Account', 'me/aiDescription')])).toEqual([{ type: 'Post', field: 'digestOf' }, { type: 'Account', field: 'aiDescription' }]);
    expect(unservedFields([undefinedField('digestOf', 'Post', 'post/digestOf'), { message: 'Something else' }])).toBeUndefined();
    expect(unservedFields([{ message: 'Not authorized', errorType: 'Unauthorized' } as { message: string }])).toBeUndefined();
    expect(unservedFields([])).toBeUndefined();
  });
  it('never degrades an operation the backend does not serve (a field of Query or Mutation)', () => {
    expect(unservedFields([undefinedField('newQuery', 'Query', 'newQuery')])).toBeUndefined();
    expect(unservedFields([undefinedField('newMutation', 'Mutation', 'newMutation')])).toBeUndefined();
  });
});

describe('a degraded selection', () => {
  it('removes the fields by the types of the contract, aliases and nested selections included', () => {
    const d = degrade('query($id: ID!) { post(id: $id) { id digestOf author { id } p2: digestOf } other: me { id aiDescription } }', [{ type: 'Post', field: 'digestOf' }, { type: 'Account', field: 'aiDescription' }])!;
    expect(d.document.replace(/\s+/g, ' ')).toBe('query($id: ID!) { post(id: $id) { id author { id } } other: me { id } }');
    expect(d.removed).toEqual([
      { path: ['post', 'digestOf'], type: 'Post', field: 'digestOf' },
      { path: ['post', 'p2'], type: 'Post', field: 'digestOf' },
      { path: ['other', 'aiDescription'], type: 'Account', field: 'aiDescription' },
    ]);
  });
  it('leaves a field of the same name on another type, and keeps __typename in a selection left empty', () => {
    const d = degrade('{ me { id } post(id: "a \\" { b") { digestOf } }', [{ type: 'Post', field: 'digestOf' }, { type: 'Account', field: 'digestOf' }])!;
    expect(d.document.replace(/\s+/g, ' ')).toBe('{ me { id } post(id: "a \\" { b") { __typename } }');
  });
  it('follows inline and named fragments', () => {
    const d = degrade('query Q { post(id: "1") { ... on Post { digestOf } ...P } } fragment P on Post { id digestOf }', [{ type: 'Post', field: 'digestOf' }])!;
    expect(d.document.replace(/\s+/g, ' ')).toBe('query Q { post(id: "1") { ... on Post { __typename } ...P } } fragment P on Post { id }');
  });
  it('is nothing when no field of the document is refused, or the document cannot be read', () => {
    expect(degrade('{ me { id } }', [{ type: 'Post', field: 'digestOf' }])).toBeUndefined();
    expect(degrade('{ me { id ', [{ type: 'Account', field: 'id' }])).toBeUndefined();
  });
  it('sets the removed fields to null in the answer, in lists too', () => {
    const data = { posts: { items: [{ id: '1' }, { id: '2' }], next: null }, me: null };
    expect(nullRemoved(data, [{ path: ['posts', 'items', 'digestOf'], type: 'Post', field: 'digestOf' }, { path: ['me', 'bio'], type: 'Account', field: 'bio' }]))
      .toEqual({ posts: { items: [{ id: '1', digestOf: null }, { id: '2', digestOf: null }], next: null }, me: null });
  });
});

describe('a backend behind this CLI', () => {
  const query = 'query($id: ID!) { post(id: $id) { id digestOf } }';
  it('answers with the degraded selection: sent again once without the field, null in the answer, said on stderr', async () => {
    const { fetch, queries } = scripted(respond({ data: null, errors: [undefinedField('digestOf', 'Post', 'post/digestOf')] }), respond({ data: { post: { id: '1' } } }));
    const { h, ctx } = ctxOf(fetch, true);
    expect(await graphql(ctx, 'https://api.test/graphql', 'tok', query, { id: '1' })).toEqual({ post: { id: '1', digestOf: null } });
    expect(queries.length).toBe(2);
    expect(queries[1]).not.toContain('digestOf');
    expect(h.errors.join('\n')).toMatch(/The backend is behind this CLI .*the field Post\.digestOf is not served; null in the answer/);
  });
  it('sends the degraded document at once the next time (the next pages), and says it once', async () => {
    const { fetch, queries } = scripted(respond({ data: null, errors: [undefinedField('digestOf', 'Post', 'post/digestOf')] }), respond({ data: { post: { id: '1' } } }), respond({ data: { post: { id: '2' } } }));
    const { h, ctx } = ctxOf(fetch);
    await graphql(ctx, 'https://api.test/graphql', 'tok', query, { id: '1' });
    expect(await graphql(ctx, 'https://api.test/graphql', 'tok', query, { id: '2' })).toEqual({ post: { id: '2', digestOf: null } });
    expect(queries.length).toBe(3);
    expect(queries[2]).not.toContain('digestOf');
    expect(h.errors.filter((e) => e.includes('behind')).length).toBe(1);
  });
  it('tries again only once: a second refusal is the refusal', async () => {
    const { fetch, queries } = scripted(
      respond({ data: null, errors: [undefinedField('digestOf', 'Post', 'post/digestOf')] }),
      respond({ data: null, errors: [undefinedField('id', 'Post', 'post/id')] }),
    );
    const { ctx } = ctxOf(fetch);
    const error = await graphql(ctx, 'https://api.test/graphql', 'tok', query, { id: '1' }).then(() => undefined, (e: unknown) => e as CliError);
    expect(error).toBeInstanceOf(CliError);
    expect(error!.message).toContain("Field 'id' in type 'Post' is undefined");
    expect(queries.length).toBe(2);
  });
  it('does not degrade an operation the backend does not serve', async () => {
    const { fetch, queries } = scripted(respond({ data: null, errors: [undefinedField('post', 'Query', 'post')] }));
    const { ctx } = ctxOf(fetch);
    await expect(graphql(ctx, 'https://api.test/graphql', 'tok', query, { id: '1' })).rejects.toBeInstanceOf(CliError);
    expect(queries.length).toBe(1);
  });
});

describe('a command against a backend behind this CLI', () => {
  const look = { theme: { universe: '%root', name: 'socle' }, name: 'Socle', collection: 'SPORT', character: 'CALM', layout: 'classic', screenshots: { light: 'l', dark: 'd' } };
  const setup = () => {
    const queries: string[] = [];
    const h = harness({
      env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1' },
      fetch: async (_url, init) => {
        const { query } = JSON.parse(String(init!.body)) as { query: string };
        queries.push(query);
        return query.includes('accent') ? respond({ data: null, errors: [undefinedField('accent', 'AppearanceLook', 'appearanceLooks/accent')] }) : respond({ data: { appearanceLooks: [look] } });
      },
    });
    saveSession(new Context(h.io, NO_FLAGS), { kind: 'agent', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op', agentId: 'ag' });
    return { h, queries };
  };
  it('succeeds with --json, the field absent at null, the warning on stderr', async () => {
    const { h, queries } = setup();
    expect(await h.run('appearance', 'looks', '--json')).toBe(0);
    expect(last<unknown[]>(h)).toEqual([{ ...look, accent: null }]);
    expect(queries.length).toBe(2);
    expect(h.errors.join('\n')).toContain('the field AppearanceLook.accent is not served');
  });
  it('succeeds in text too', async () => {
    const { h } = setup();
    expect(await h.run('appearance', 'looks')).toBe(0);
    expect(h.lines.join('\n')).toContain('%root/socle  Socle  SPORT');
  });
});
