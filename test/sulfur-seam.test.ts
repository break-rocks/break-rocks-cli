// The seam of the talc requests on the new backend (src/sulfur/fit.ts, talc.ts, media.ts) and the MP4 header reader
// (src/mp4.ts): documents fitted to the server's schema, answers completed, adapters, uploads in one form or in parts.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Sdl } from '../src/api/sdl.js';
import { fillLeftOut, fitDocument, parseOperations } from '../src/sulfur/fit.js';
import { subSelection } from '../src/sulfur/talc.js';
import { probeMoov } from '../src/mp4.js';
import { Context, NO_FLAGS } from '../src/context.js';
import { saveSulfurSession } from '../src/sulfur/session.js';
import { sulfurUpload, PART_BYTES } from '../src/sulfur/media.js';
import { harness } from './helpers.js';

const TALC: Sdl = {
  query: { post: ['Post', { id: 'ID!' }], me: ['Account'] },
  mutation: { createPost: ['Post', { text: 'String!', universe: 'String', announcement: 'Boolean', policy: 'ReplyPolicy', requestId: 'ID!', input: 'PostInput' }] },
  types: {
    Post: { k: 'o', f: { id: ['ID!'], text: ['String'], tags: ['[String!]!'], author: ['Account'], sources: ['[Source!]!'] } },
    Account: { k: 'o', f: { id: ['ID!'], handle: ['String!'], widths: ['[Int!]'] } },
    Source: { k: 'o', f: { url: ['String!'] } },
    ReplyPolicy: { k: 'e', v: ['everyone'] },
    PostInput: { k: 'i', f: { a: ['String'], b: ['String'] } },
  },
};
const SERVER: Sdl = {
  query: { post: ['Post', { id: 'ID!' }], threadMessages: ['Page', { discussionId: 'ID!' }] },
  mutation: { createPost: ['Post', { text: 'String!', universe: 'String', policy: 'String', requestId: 'ID', input: 'PostInput' }] },
  types: {
    Post: { k: 'o', f: { id: ['ID!'], text: ['String'], author: ['Account'] } },
    Account: { k: 'o', f: { id: ['ID!'], handle: ['String!'] } },
    Page: { k: 'o', f: { next: ['String'] } },
    PostInput: { k: 'i', f: { a: ['String'] } },
  },
};

describe('a talc document fitted to the server', () => {
  it('leaves out the fields the server lacks, answered null or [] (a talc list)', () => {
    const f = fitDocument('query($id: ID!) { post(id: $id) { id text tags sources { url } author { id handle widths } } }', { id: 'p1' }, SERVER, TALC);
    expect(f.document.replace(/\s+/g, ' ')).toBe('query($id: ID!) { post(id: $id) { id text author { id handle } } }');
    expect(f.roots).toEqual([{ key: 'post', name: 'post', kind: 'query' }]);
    const data = fillLeftOut({ post: { id: 'p1', text: 'x', author: { id: 'a', handle: 'h' } } }, f.left);
    expect(data).toEqual({ post: { id: 'p1', text: 'x', tags: [], sources: [], author: { id: 'a', handle: 'h', widths: [] } } });
  });

  it('drops an argument the server does not take when empty, refuses it when given; retypes the variables', () => {
    const doc = 'mutation($text: String!, $announcement: Boolean, $policy: ReplyPolicy, $requestId: ID!) { createPost(text: $text, announcement: $announcement, policy: $policy, requestId: $requestId) { id } }';
    const f = fitDocument(doc, { text: 'hi', announcement: null, policy: 'everyone', requestId: 'r' }, SERVER, TALC);
    expect(f.document.replace(/\s+/g, ' ')).toBe('mutation($text: String!, $policy: String, $requestId: ID) { createPost(text: $text, policy: $policy, requestId: $requestId) { id } }');
    expect(f.variables).toEqual({ text: 'hi', policy: 'everyone', requestId: 'r' });
    expect(() => fitDocument(doc, { text: 'hi', announcement: true, policy: null, requestId: 'r' }, SERVER, TALC)).toThrow(expect.objectContaining({ code: 'NOT_ON_NEW_BACKEND' }));
  });

  it('refuses a root field not served and a required argument missing; fits an input variable', () => {
    expect(() => fitDocument('{ me { id } }', {}, SERVER, TALC)).toThrow(expect.objectContaining({ code: 'NOT_ON_NEW_BACKEND', details: expect.objectContaining({ operation: 'me' }) }));
    expect(() => fitDocument('{ threadMessages { next } }', {}, SERVER, TALC)).toThrow(/requires an argument/);
    const f = fitDocument('mutation($i: PostInput, $t: String!) { createPost(text: $t, input: $i) { id } }', { t: 'x', i: { a: '1', b: null } }, SERVER, TALC);
    expect(f.variables).toEqual({ t: 'x', i: { a: '1' } });
    expect(() => fitDocument('mutation($i: PostInput, $t: String!) { createPost(text: $t, input: $i) { id } }', { t: 'x', i: { b: 'filled' } }, SERVER, TALC)).toThrow(/i\.b/);
  });

  it('keeps the variables used inside a literal object, and reads aliases and inline fragments', () => {
    const doc = 'mutation($a: String, $t: String!) { made: createPost(text: $t, input: { a: $a }) { id ... on Post { text tags } } }';
    const f = fitDocument(doc, { a: '1', t: 'x' }, SERVER, TALC);
    expect(f.variables).toEqual({ a: '1', t: 'x' });
    expect(f.document).toContain('made: createPost(text: $t, input: { a: $a })');
    expect(f.document).not.toContain('tags');
    expect(parseOperations(doc)[0].selection.items[0]).toMatchObject({ key: 'made', name: 'createPost' });
    expect(subSelection('{ account { id handle } address }', 'account')).toBe('{ id handle }');
  });
});

/** A minimal `moov` with an `mvhd` and one `trak/tkhd` (version 0). */
function moov(durationUnits: number, scale: number, w: number, h: number, rotate = false): Uint8Array {
  const box = (type: string, body: Buffer) => Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from(type, 'ascii'), body]).fill(0, 0, 0);
  const sized = (b: Buffer) => { b.writeUInt32BE(b.length, 0); return b; };
  const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(scale, 12); mvhd.writeUInt32BE(durationUnits, 16);
  const tkhd = Buffer.alloc(84);
  const m = 40;
  tkhd.writeInt32BE(rotate ? 0 : 0x10000, m); tkhd.writeInt32BE(rotate ? 0x10000 : 0, m + 4);
  tkhd.writeUInt32BE(w * 65536, m + 36); tkhd.writeUInt32BE(h * 65536, m + 40);
  const trak = sized(box('trak', sized(box('tkhd', tkhd))));
  return sized(box('moov', Buffer.concat([sized(box('mvhd', mvhd)), trak])));
}

describe('the MP4 header', () => {
  it('gives the duration and the orientation, a rotation turning the display size', () => {
    expect(probeMoov(moov(6000, 1000, 360, 640))).toEqual({ durationSec: 6, width: 360, height: 640, orientation: 'v' });
    expect(probeMoov(moov(200 * 600, 600, 640, 360))).toMatchObject({ durationSec: 200, orientation: 'h' });
    expect(probeMoov(moov(1000, 1000, 640, 360, true))).toMatchObject({ orientation: 'v', width: 360 });
    expect(probeMoov(moov(1000, 1000, 500, 500))).toMatchObject({ orientation: 's' });
  });
});

describe('an upload to the new backend', () => {
  function signedIn(env: Record<string, string> = {}) {
    const calls: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
      if (url.endsWith('/graphql')) {
        const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, Record<string, unknown>> };
        calls.push({ url, method: 'POST', body, headers });
        if (body.query.includes('requestUpload')) {
          const i = body.variables.i;
          const parts = Array.isArray(i.partSha256) ? i.partSha256.map((_, n) => ({ n: n + 1, url: `https://s3.test/part/${n + 1}` })) : null;
          return Response.json({ data: { requestUpload: { mediaId: 'eu_m1', uploadId: 'up1', form: parts ? null : { url: 'https://s3.test/form', fields: JSON.stringify({ key: 'k', 'x-amz-checksum-sha256': 'c' }) }, parts, expiresAt: '2026-10-23T11:00:00.000Z' } } });
        }
        if (body.query.includes('completeUpload')) return Response.json({ data: { completeUpload: 'eu_m1' } });
        return Response.json({ errors: [{ message: 'unknown' }] });
      }
      calls.push({ url, method: String(init?.method), body: init?.body, headers });
      return new Response(null, { status: url.includes('/part/') ? 200 : 204, headers: url.includes('/part/') ? { etag: `"e${url.slice(-1)}"` } : {} });
    }) as typeof globalThis.fetch;
    const h = harness({ fetch, env: { BREAKROCKS_SULFUR_URL: 'https://sulfur.test', ...env } });
    const ctx = new Context(h.io, { ...NO_FLAGS, backend: 'sulfur' });
    ctx.saveProfile({ env: 'dev', kind: 'human' });
    saveSulfurSession(ctx, { backend: 'sulfur', env: 'dev', cell: 'eu', accountId: 'eu_a', kind: 'untrusted', method: 'email', signedInAt: '2026-10-23T10:00:00.000Z', accessExpiresAt: '2026-10-23T11:00:00.000Z', storage: 'file', access: 'at', refresh: 'rt' });
    return { h, ctx, calls };
  }

  it('declares the SHA-256 and posts the signed form', async () => {
    const { h, ctx, calls } = signedIn();
    const path = join(h.dir, 'a.jpg');
    writeFileSync(path, 'jpeg bytes');
    expect(await sulfurUpload(ctx, { path, name: 'a.jpg', type: 'image/jpeg', bytes: 10 }, 'image', 'post', 'eu_u1')).toBe('eu_m1');
    expect((calls[0].body as { variables: unknown }).variables).toEqual({ i: { kind: 'image', type: 'image/jpeg', size: 10, destination: 'post', scope: 'eu_u1', sha256: createHash('sha256').update('jpeg bytes').digest('hex') } });
    expect(calls[1]).toMatchObject({ url: 'https://s3.test/form', method: 'POST' });
  });

  it('sends in parts above the threshold, each with its checksum, then completes with the ETags', async () => {
    const { h, ctx, calls } = signedIn({ BREAKROCKS_MULTIPART_ABOVE: '4' });
    const path = join(h.dir, 'doc.pdf');
    writeFileSync(path, '%PDF-1.4 a document');
    expect(await sulfurUpload(ctx, { path, name: 'doc.pdf', type: 'application/pdf', bytes: 19 }, 'document', 'playlist', 'pl1')).toBe('eu_m1');
    const sha = createHash('sha256').update('%PDF-1.4 a document').digest('hex');
    expect((calls[0].body as { variables: { i: Record<string, unknown> } }).variables.i).toMatchObject({ partSha256: [sha] });
    expect(calls[1]).toMatchObject({ url: 'https://s3.test/part/1', method: 'PUT', headers: { 'x-amz-checksum-sha256': Buffer.from(sha, 'hex').toString('base64') } });
    expect((calls[2].body as { variables: unknown }).variables).toEqual({ u: 'up1', p: [{ n: 1, etag: '"e1"', sha256: sha }] });
    expect(PART_BYTES).toBe(64 * 1024 * 1024);
  });
});

describe('the server schema', () => {
  it('src/sulfur/schema.generated.ts is the one of schema/sulfur/server.graphql', async () => {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['scripts/gen-sulfur-schema.mjs', '--check'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  });
});

describe('commands through the seam on the new backend', () => {
  function cell(answers: (query: string, variables: Record<string, unknown>) => unknown) {
    const sent: { query: string; variables: Record<string, unknown> }[] = [];
    const fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      sent.push(body);
      return Response.json({ data: answers(body.query, body.variables) });
    }) as typeof globalThis.fetch;
    const h = harness({ fetch, env: { BREAKROCKS_SULFUR_URL: 'https://sulfur.test', BREAKROCKS_BACKEND: 'sulfur' } });
    const ctx = new Context(h.io, NO_FLAGS);
    ctx.saveProfile({ env: 'dev', kind: 'human' });
    saveSulfurSession(ctx, { backend: 'sulfur', env: 'dev', cell: 'eu', accountId: 'eu_a', kind: 'untrusted', method: 'email', signedInAt: '2026-10-23T10:00:00.000Z', accessExpiresAt: '2026-10-23T11:00:00.000Z', storage: 'file', access: 'at', refresh: 'rt' });
    return { h, sent };
  }

  it('records a measure of a run (submitExperienceMeasure), its input flattened', async () => {
    const { h, sent } = cell(() => ({ submitExperienceMeasure: { id: 'run1', state: 'IN_PROGRESS' } }));
    expect(await h.run('experiences', 'runs', 'measure', 'run1', '--value', '120', '--measured-at', '2026-11-25T10:00:00Z', '--final', '--json')).toBe(0);
    expect(sent[0].query).toContain('submitExperienceMeasure(');
    expect(sent[0].variables).toMatchObject({ input: { runId: 'run1', value: 120, final: true, measuredAt: '2026-11-25T10:00:00Z' } });
  });

  it('saves a place with its name and point read from its card (saveToMyPlaces, deviation 6c-1)', async () => {
    const { h, sent } = cell((q) => (q.includes('placeCard') ? { placeCard: { name: 'Tour Eiffel', point: { lat: 48.85, lon: 2.29 } } } : { saveToMyPlaces: { id: 's1', kind: 'PLACE', name: 'Tour Eiffel' } }));
    expect(await h.run('my-places', 'save', 'PLACE', 'N1', '--json')).toBe(0);
    const save = sent.find((s) => s.query.includes('saveToMyPlaces('))!;
    expect(save.variables).toMatchObject({ input: { kind: 'PLACE', targetId: 'N1', name: 'Tour Eiffel', point: { lat: 48.85, lon: 2.29 } } });
  });

  it('follows with follow(address), and answers the talc Follow', async () => {
    const { h, sent } = cell((q) => (q.includes('follow(') ? { follow: { account: { id: 'eu_b' }, universes: [] } } : { accounts: [{ id: 'eu_b', handle: 'bob' }] }));
    expect(await h.run('accounts', 'follow', '@bob', '--json')).toBe(0);
    expect(sent[0]).toMatchObject({ variables: { a: '@bob' } });
    expect(h.values.at(-1)).toMatchObject({ address: '@bob', account: { id: 'eu_b', handle: 'bob' } });
  });
});

describe('an agent on the new backend (RFC 7523)', () => {
  it('signs an EdDSA assertion: kid the SHA-256 of its raw public key, iss = sub = the agent, aud the token endpoint, 2 minutes', async () => {
    const { generateKeyPairSync, verify } = await import('node:crypto');
    const { assertionOf, keyIdOf } = await import('../src/sulfur/agent.js');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const jwt = assertionOf('eu_agent1', privateKey, 'https://eu.api.dev.break.rocks/oauth/token', Date.parse('2026-11-25T10:00:00Z'));
    const [h, p, sig] = jwt.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString()), claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    const x = (publicKey.export({ format: 'jwk' }) as { x: string }).x;
    expect(header).toEqual({ alg: 'EdDSA', typ: 'JWT', kid: createHash('sha256').update(Buffer.from(x, 'base64url')).digest('hex') });
    expect(keyIdOf(privateKey)).toBe(header.kid);
    // iat 30 s back (a clock a little ahead of the server's), exp 2 minutes ahead.
    expect(claims).toMatchObject({ iss: 'eu_agent1', sub: 'eu_agent1', aud: 'https://eu.api.dev.break.rocks/oauth/token', iat: Date.parse('2026-11-25T10:00:00Z') / 1000 - 30, exp: Date.parse('2026-11-25T10:00:00Z') / 1000 + 120 });
    expect(typeof claims.jti).toBe('string');
    expect(verify(null, Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig, 'base64url'))).toBe(true);
  });

  it('signs in with the BREAKROCKS_* variables at /oauth/token (jwt-bearer), and acts for its owner', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const { privateKey } = generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const sent: { path: string; body: string }[] = [];
    const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'eu_owner', act: { sub: 'eu_agent1' } })).toString('base64url')}.s`;
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      sent.push({ path, body: String(init?.body) });
      if (path === '/oauth/token') return Response.json({ access_token: token, token_type: 'Bearer', expires_in: 900 });
      return Response.json({ data: { me: { id: 'eu_owner', tier: 'free', card: { handle: 'owner', name: null } } } });
    }) as typeof globalThis.fetch;
    const h = harness({ fetch, env: { BREAKROCKS_SULFUR_URL: 'https://sulfur.test', BREAKROCKS_BACKEND: 'sulfur', BREAKROCKS_OPERATOR_ID: 'eu_owner', BREAKROCKS_AGENT_ID: 'eu_agent1', BREAKROCKS_AGENT_KEY: pem } });
    expect(await h.run('--env', 'dev', 'whoami', '--json')).toBe(0);
    expect(h.values.at(-1)).toMatchObject({ actor: 'delegated-agent', agentId: 'eu_agent1', account: { id: 'eu_owner' }, session: { method: 'agent' } });
    const grant = new URLSearchParams(sent[0].body);
    expect(sent[0].path).toBe('/oauth/token');
    expect(grant.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(JSON.parse(Buffer.from(grant.get('assertion')!.split('.')[1], 'base64url').toString())).toMatchObject({ iss: 'eu_agent1', aud: 'https://eu.api.dev.break.rocks/oauth/token' });
    expect(h.all()).not.toMatch(/PRIVATE KEY|eyJ/);
  });
});
