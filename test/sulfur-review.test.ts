// The review of the port onto the new backend (native-sulfur): the former backend never asked for the fields only the new
// one serves; a session of another environment refused; an agent never signed into a human's session; the MCP server and
// batch on the backend of their run; the adapters (isFollowing by scope, a quick poll, the contribution votes, a theme
// deleted by its id, a group made with invitations refused); the fit of documents (false and "" are values, the image of a
// universe); the actor of usage and capabilities; uploads resumed after a network error; doctor for an agent.
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { callCommand } from '../src/mcp/server.js';
import { serverFlagsOf } from '../src/commands/mcp.js';
import { findCommand } from '../src/registry.js';
import { fillLeftOut, fitDocument } from '../src/sulfur/fit.js';
import { followScope, pathKeyOf, splitFollowAddress } from '../src/sulfur/talc.js';
import { readSulfurSession, saveSulfurSession, type SulfurSession } from '../src/sulfur/session.js';
import { sulfurUpload } from '../src/sulfur/media.js';
import { checkLicense } from '../src/media.js';
import { harness, last } from './helpers.js';

const BASE = 'https://sulfur.test';
const jwt = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"EdDSA"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const HUMAN: SulfurSession = { backend: 'sulfur', env: 'dev', cell: 'eu', accountId: 'eu_a', handle: 'ada', kind: 'untrusted', method: 'email', signedInAt: '2026-10-23T10:00:00.000Z', accessExpiresAt: '2026-10-23T11:00:00.000Z', storage: 'file', access: jwt({ sub: 'eu_a' }), refresh: 'rt' };

type Sent = { path: string; query?: string; variables?: Record<string, unknown>; form?: URLSearchParams };

/** A cell answering GraphQL with [answer] (null: an error), and the agent token endpoint; every request kept. */
function cell(answer: (query: string, variables: Record<string, unknown>) => unknown, options: { env?: Record<string, string>; profile?: Record<string, unknown> | null; session?: SulfurSession | null } = {}) {
  const sent: Sent[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const raw = String(init?.body ?? '');
    if (url.pathname === '/oauth/token') {
      const form = new URLSearchParams(raw);
      sent.push({ path: url.pathname, form });
      const claims = JSON.parse(Buffer.from(form.get('assertion')!.split('.')[1], 'base64url').toString()) as { sub: string };
      return Response.json({ access_token: jwt({ sub: 'eu_owner', act: { sub: claims.sub } }), token_type: 'Bearer', expires_in: 900 });
    }
    const body = JSON.parse(raw) as { query: string; variables: Record<string, unknown> };
    sent.push({ path: url.pathname, query: body.query, variables: body.variables });
    if (/^\{ me \{ id card/.test(body.query)) return Response.json({ data: { me: { id: 'eu_owner', card: { handle: 'owner' } } } });
    const data = answer(body.query, body.variables);
    if (data instanceof Response) return data;
    return data === null ? Response.json({ errors: [{ message: 'unknown', extensions: { code: 'BAD_REQUEST' } }] }) : Response.json({ data });
  }) as typeof globalThis.fetch;
  const h = harness({ fetch, env: { BREAKROCKS_SULFUR_URL: BASE, BREAKROCKS_BACKEND: 'sulfur', ...options.env } });
  const ctx = new Context(h.io, NO_FLAGS);
  if (options.profile !== null) ctx.saveProfile({ env: 'dev', kind: 'human', ...options.profile } as never);
  if (options.session !== null) saveSulfurSession(ctx, options.session ?? HUMAN);
  return { h, ctx, sent, graphqls: () => sent.filter((s) => s.path === '/graphql') };
}

const agentKey = () => generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const agentEnv = (agentId = 'eu_agent1') => ({ BREAKROCKS_OPERATOR_ID: 'eu_owner', BREAKROCKS_AGENT_ID: agentId, BREAKROCKS_AGENT_KEY: agentKey() });

describe('the environment of a session on the new backend', () => {
  it('a session of dev is never used for prod: ENV_MISMATCH, nothing sent', async () => {
    const { h, sent } = cell(() => ({ health: { ok: true } }), { profile: { kind: undefined } });
    expect(await h.run('--env', 'prod', 'whoami', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'ENV_MISMATCH', env: 'dev', requested: 'prod' } });
    expect(sent).toEqual([]);
  });

  it('the sign-in keeps the kind of the profile: another --env with it is ENV_MISMATCH before anything', async () => {
    const { h, ctx } = cell(() => null, { profile: null, session: null });
    // As sulfurLogin saves it once signed in.
    ctx.saveProfile({ env: 'dev', kind: 'human' });
    expect(await h.run('--env', 'prod', 'login', '--device', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'ENV_MISMATCH' } });
  });
});

describe('an agent and a human on the new backend', () => {
  it('the BREAKROCKS_* variables beside a human\'s session: PROFILE_HOLDS_HUMAN, the session left as it was', async () => {
    const { h, ctx, sent } = cell(() => ({ health: { ok: true, cell: 'eu' } }), { env: agentEnv(), profile: { kind: undefined } });
    expect(await h.run('whoami', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'PROFILE_HOLDS_HUMAN' } });
    expect(sent).toEqual([]);
    expect(readSulfurSession(ctx)).toMatchObject({ method: 'email', accountId: 'eu_a' });
  });

  it('a profile holding a human, without a session: no agent sign-in into it', async () => {
    const { h, sent } = cell(() => null, { env: agentEnv(), session: null });
    expect(await h.run('usage', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'PROFILE_HOLDS_HUMAN' } });
    expect(await h.run('agents', 'login', '--json')).toBe(2);
    expect(sent).toEqual([]);
  });

  it('an agent session keeps its agent id; another agent signs in again', async () => {
    const first = cell(() => ({ myUsage: { minute: { used: 0, limit: 10, resetAt: 'x' }, hour: { used: 0, limit: 10, resetAt: 'x' }, quota: null, tier: null, byCategory: [] } }), { env: agentEnv('eu_agent1'), profile: { kind: undefined }, session: null });
    expect(await first.h.run('usage', '--json')).toBe(0);
    expect(last(first.h)).toMatchObject({ actor: 'delegated-agent' });
    expect(readSulfurSession(first.ctx)).toMatchObject({ method: 'agent', agentId: 'eu_agent1' });
    expect(first.sent.filter((s) => s.path === '/oauth/token')).toHaveLength(1);
    // The same agent: its session reused.
    expect(await first.h.run('usage', '--json')).toBe(0);
    expect(first.sent.filter((s) => s.path === '/oauth/token')).toHaveLength(1);
    // Another agent in the same profile: never the first one's token.
    Object.assign(first.h.io.env, agentEnv('eu_agent2'));
    expect(await first.h.run('usage', '--json')).toBe(0);
    expect(first.sent.filter((s) => s.path === '/oauth/token')).toHaveLength(2);
    expect(readSulfurSession(first.ctx)).toMatchObject({ agentId: 'eu_agent2' });
  });

  it('login of a person refuses an agent\'s profile and the agent variables; --handle without --email before any request', async () => {
    const a = cell(() => null, { profile: { kind: 'agent' }, session: null });
    expect(await a.h.run('login', '--device', '--json')).toBe(2);
    expect(last(a.h)).toMatchObject({ error: { code: 'PROFILE_HOLDS_AGENT_ACCOUNT' } });
    const b = cell(() => null, { env: agentEnv(), profile: { kind: undefined }, session: null });
    expect(await b.h.run('login', '--device', '--json')).toBe(2);
    expect(last(b.h)).toMatchObject({ error: { code: 'PROFILE_HOLDS_HUMAN' } });
    const c = cell(() => null, { session: null });
    expect(await c.h.run('login', '--device', '--handle', 'my_bot', '--json')).toBe(2);
    expect(last(c.h)).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect([...a.sent, ...b.sent, ...c.sent]).toEqual([]);
  });

  it('doctor signs an agent in with its key when it has no session file yet', async () => {
    const { h, sent } = cell((q) => (q.includes('health') ? { health: { ok: true, cell: 'eu' } } : null), { env: agentEnv(), profile: { kind: undefined }, session: null });
    expect(await h.run('doctor', '--json')).toBe(0);
    const r = last<{ ok: boolean; checks: { name: string; status: string }[] }>(h);
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.name === 'agent')).toMatchObject({ status: 'ok' });
    expect(r.checks.find((c) => c.name === 'session')).toMatchObject({ status: 'ok' });
    // The reach of the cell first (no token), then the sign-in with the key.
    expect(sent.map((s) => s.path).slice(0, 2)).toEqual(['/graphql', '/oauth/token']);
  });

  it('a delegated agent posts a video without --license (none taken at upload there)', () => {
    const h = harness({ env: agentEnv() });
    expect(checkLicense(new Context(h.io, NO_FLAGS), {}, true)).toBeUndefined();
  });
});

describe('usage and capabilities: who acts, from the session', () => {
  const usage = { myUsage: { minute: { used: 1, limit: 10, resetAt: 'x' }, hour: { used: 1, limit: 10, resetAt: 'x' }, quota: null, tier: 'X1', byCategory: [] } };
  it('a human; an operator (an agent session without act)', async () => {
    const a = cell(() => usage);
    expect(await a.h.run('usage', '--json')).toBe(0);
    expect(last(a.h)).toMatchObject({ actor: 'human' });
    const op = cell((q) => (q.includes('delegatedAgentAllowance') ? { delegatedAgentAllowance: { allowance: 3, operated: 1, createdLast24Hours: 0 } } : usage), { profile: { kind: undefined }, session: { ...HUMAN, method: 'agent', kind: 'agent', agentId: 'eu_a', access: jwt({ sub: 'eu_a' }), refresh: undefined } });
    // Without its key here, an operator's session is used until it ends: its allowance read too.
    expect(await op.h.run('usage', '--json')).toBe(0);
    expect(last(op.h)).toMatchObject({ actor: 'operator', allowance: { allowance: 3 } });
    expect(await op.h.run('me', 'capabilities', '--json')).toBe(0);
    expect(last(op.h)).toMatchObject({ actor: 'operator', operator: { id: 'eu_a' } });
  });
});

describe('the MCP server on the backend of its run', () => {
  it('breakrocks mcp --backend sulfur hands it to every tool', async () => {
    const h = harness({ env: {} });
    expect(serverFlagsOf(new Context(h.io, { ...NO_FLAGS, backend: 'sulfur', env: 'dev' }))).toEqual({ profile: undefined, env: 'dev', agent: undefined, backend: 'sulfur' });
    const answer = await callCommand(h.io, { backend: 'sulfur' }, findCommand(['whoami'])!.command, {});
    expect(JSON.parse(answer.content[0].text)).toMatchObject({ error: { code: 'SIGN_IN_REQUIRED', message: expect.stringContaining('native-sulfur') } });
  });
});

describe('batch on the new backend', () => {
  it('runs each line with the command of the backend (its stand-in, its refusal)', async () => {
    const { h } = cell((q) => (q.includes('me {') || q.includes('tier') ? { me: { id: 'eu_a', tier: 'free', card: { handle: 'ada', name: null } } } : null));
    const file = join(h.dir, 'lines.jsonl');
    writeFileSync(file, `${JSON.stringify({ command: 'whoami' })}\n${JSON.stringify({ command: 'operator register', input: { country: 'FR' } })}\n`);
    expect(await h.run('batch', '--file', file, '--continue', '--json')).toBe(1);
    const r = last<{ results: { ok: boolean; result?: Record<string, unknown>; error?: { code: string } }[] }>(h);
    expect(r.results[0]).toMatchObject({ ok: true, result: { backend: 'sulfur', account: { id: 'eu_a' } } });
    expect(r.results[1]).toMatchObject({ ok: false, error: { code: 'NOT_AVAILABLE' } });
  });
});

describe('isFollowing on the new backend (relations: follows, the path keys of the scoped follows)', () => {
  it('reads the address and the path keys', () => {
    expect(splitFollowAddress('@bob')).toEqual({ handle: 'bob', path: null });
    expect(splitFollowAddress('@bob%Paris/Sport')).toEqual({ handle: 'bob', path: 'Paris/Sport' });
    expect(splitFollowAddress('%paris@bob')).toEqual({ handle: 'bob', path: 'paris' });
    expect(splitFollowAddress('@bob%root')).toEqual({ handle: 'bob', path: null });
    expect(pathKeyOf('%Games/Chess10')).toBe('garnes/chesslo');
    expect(pathKeyOf('café')).toBeUndefined();
  });

  it('answers by scope, null when the relation cannot tell', () => {
    expect(followScope({ follows: false, universes: [] }, null)).toBe(false);
    expect(followScope({ follows: true, universes: [] }, null)).toBe(true);
    expect(followScope({ follows: true, universes: [] }, 'paris')).toBe(true);
    expect(followScope({ follows: true, universes: ['paris'] }, 'Paris')).toBe(true);
    expect(followScope({ follows: true, universes: ['paris'] }, null)).toBeNull();
    expect(followScope({ follows: true, universes: ['paris'] }, 'lyon')).toBeNull();
  });

  it('asks the relation of the account, never with the % of the universe', async () => {
    const { h, graphqls } = cell((q) => (q.includes('accountByHandle') ? { accountByHandle: { id: 'eu_b' } } : { relations: [{ follows: true, universes: ['paris/sport'] }] }));
    expect(await h.run('accounts', 'is-following', '@bob%Paris/Sport', '--json')).toBe(0);
    expect(last(h)).toBe(true);
    expect(graphqls().at(-1)!.variables).toEqual({ ids: ['eu_b'] });
  });
});

describe('the adapters of the review', () => {
  it('a follow has no date of this device', async () => {
    const { h } = cell((q) => (q.includes('follow(') ? { follow: { account: { id: 'eu_b' }, universes: [] } } : { accounts: [{ id: 'eu_b', handle: 'bob' }] }));
    expect(await h.run('accounts', 'follow', '@bob', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ address: '@bob', createdAt: null });
  });

  it('a quick poll by the discussion id: a group chat, a conversation (dm.<ids sorted>), a universe discussion', async () => {
    const { h, graphqls } = cell((q) => (q.includes('universeDiscussion') ? { universeDiscussion: { id: 'eu_d9' } } : q.includes('accountByHandle') ? { accountByHandle: { id: 'eu_0' } } : { sendQuickPoll: { id: 'm1' } }));
    expect(await h.run('messages', 'quick-poll', 'Ride?', '--choices', 'yes,no', '--group', 'eu_g1', '--json')).toBe(0);
    expect(graphqls().at(-1)!.variables).toMatchObject({ d: 'eu_g1', q: 'Ride?', c: ['yes', 'no'] });
    expect(await h.run('messages', 'quick-poll', 'Ride?', '--choices', 'yes,no', '--with', 'eu_0', '--json')).toBe(0);
    expect(graphqls().at(-1)!.variables).toMatchObject({ d: 'dm.eu_0.eu_a' });
    expect(await h.run('messages', 'quick-poll', 'Ride?', '--choices', 'yes,no', '--channel', '%paris&general', '--json')).toBe(0);
    expect(graphqls().at(-1)!.variables).toMatchObject({ d: 'eu_d9' });
  });

  it('the contribution votes take --discussion there', async () => {
    const { h, graphqls } = cell(() => ({ voteOnContribution: { id: 'm1', score: 1, myVote: 'UP' }, withdrawContributionVote: { id: 'm1', score: 0, myVote: null } }));
    expect(await h.run('messages', 'vote', 'm1', 'UP', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'DISCUSSION_REQUIRED' } });
    expect(await h.run('messages', 'vote', 'm1', 'UP', '--discussion', 'eu_d1', '--json')).toBe(0);
    expect(graphqls().at(-1)!.variables).toMatchObject({ messageId: 'm1', discussionId: 'eu_d1', vote: 'UP' });
    expect(await h.run('messages', 'unvote', 'm1', '--discussion', 'eu_d1', '--json')).toBe(0);
    expect(graphqls().at(-1)!.query).toContain('withdrawContributionVote(');
  });

  it('a theme is deleted by its id, read by its universe and name', async () => {
    const { h, graphqls } = cell((q) => (q.includes('deleteTheme') ? { deleteTheme: true } : { theme: { id: 'th1', name: 'night', universe: '%paris' } }));
    expect(await h.run('look', 'themes', 'delete', '%paris/night', '--yes', '--json')).toBe(0);
    expect(graphqls()[0].variables).toEqual({ u: '%paris', n: 'night' });
    expect(graphqls()[1]).toMatchObject({ variables: { id: 'th1' } });
  });

  it('a group made with invitations refused: the group kept, the refusals told', async () => {
    const { h } = cell((q) => (q.includes('createGroupChat') ? Response.json({ data: { createGroupChat: { id: 'eu_g1', name: 'Friends' } }, errors: [{ message: 'Some invitations were refused', path: ['createGroupChat'], extensions: { code: 'REFUSED', reason: 'GROUP_INVITATIONS_REFUSED', errorInfo: { refused: [{ accountId: 'eu_c', code: 'NOT_CONNECTED' }] }, partial: true } }] }) : null));
    expect(await h.run('messages', 'groups', 'create', 'Friends', 'eu_c', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ group: { id: 'eu_g1' }, refused: [{ accountId: 'eu_c', code: 'NOT_CONNECTED' }] });
    expect(await h.run('messages', 'groups', 'create', 'Friends', 'eu_c')).toBe(0);
    expect(h.lines.join('\n')).toContain('invitation refused: eu_c (NOT_CONNECTED)');
  });
});

describe('the fit of a document (review)', () => {
  it('false and "" are values: refused where the server takes no such argument; null is none', () => {
    // createPost's `authorship` (talc's, not the server's: every Boolean argument talc had is served since server b822c90a).
    const doc = 'mutation($t: String!, $a: AgentAuthorship, $r: ID!) { createPost(text: $t, authorship: $a, requestId: $r) { id } }';
    expect(() => fitDocument(doc, { t: 'x', a: false, r: 'r1' })).toThrow(expect.objectContaining({ code: 'NOT_AVAILABLE' }));
    expect(() => fitDocument(doc, { t: 'x', a: '', r: 'r1' })).toThrow(expect.objectContaining({ code: 'NOT_AVAILABLE' }));
    expect(fitDocument(doc, { t: 'x', a: null, r: 'r1' }).variables).toEqual({ t: 'x', r: 'r1' });
    expect(() => fitDocument('mutation($t: String!, $r: ID!) { createPost(text: $t, authorship: false, requestId: $r) { id } }', { t: 'x', r: 'r1' })).toThrow(expect.objectContaining({ code: 'NOT_AVAILABLE' }));
  });

  it('a universe\'s image: its shown Image; my universe\'s: the Image of its media id', () => {
    const f = fitDocument('query($n: String!) { universe(name: $n) { name image { id url widths } } }', { n: '%paris' });
    expect(f.document).toContain('image: shownImage { id url widths }');
    const m = fitDocument('{ myUniverses { items { universe image { id url widths } } } }', {});
    expect(m.document.replace(/\s+/g, ' ')).toContain('items { universe image } }');
    const data = fillLeftOut({ myUniverses: { items: [{ universe: '%paris', image: 'eu_m1' }, { universe: '%lyon', image: null }] } }, m.left);
    expect(data.myUniverses.items).toEqual([{ universe: '%paris', image: { id: 'eu_m1', url: null, widths: [] } }, { universe: '%lyon', image: null }]);
  });
});

describe('an upload in parts resumed', () => {
  it('keeps its parts when the resume meets a network error, starts again when the platform refuses it', async () => {
    let mode: 'network' | 'refused' = 'network';
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith('/graphql')) return new Response(null, { status: url.includes('/part/') ? 200 : 204, headers: url.includes('/part/') ? { etag: '"e1"' } : {} });
      const body = JSON.parse(String(init?.body)) as { query: string; variables: { i?: { partSha256?: string[] } } };
      if (body.query.includes('resumeUpload')) return mode === 'network' ? new Response('bad gateway', { status: 502 }) : Response.json({ errors: [{ message: 'gone', extensions: { code: 'REFUSED', reason: 'UPLOAD_NOT_FOUND' } }] });
      if (body.query.includes('requestUpload')) return Response.json({ data: { requestUpload: { mediaId: 'eu_m1', uploadId: 'up1', form: null, parts: body.variables.i!.partSha256!.map((_, n) => ({ n: n + 1, url: `https://s3.test/part/${n + 1}` })), expiresAt: '2026-10-23T11:00:00.000Z' } } });
      if (body.query.includes('completeUpload')) return Response.json({ errors: [{ message: 'later', extensions: { code: 'REFUSED', reason: 'SERVER_BUSY' } }] });
      return Response.json({ errors: [{ message: 'unknown' }] });
    }) as typeof globalThis.fetch;
    const h = harness({ fetch, env: { BREAKROCKS_SULFUR_URL: BASE, BREAKROCKS_MULTIPART_ABOVE: '4' } });
    const ctx = new Context(h.io, { ...NO_FLAGS, backend: 'sulfur' });
    ctx.saveProfile({ env: 'dev', kind: 'human' });
    saveSulfurSession(ctx, HUMAN);
    const path = join(h.dir, 'doc.pdf');
    writeFileSync(path, '%PDF-1.4 a document');
    const file = { path, name: 'doc.pdf', type: 'application/pdf', bytes: 19 };
    // A first run: its part sent, the completion refused: the state kept.
    await expect(sulfurUpload(ctx, file, 'document', 'playlist', 'pl1')).rejects.toMatchObject({ code: 'SERVER_BUSY' });
    const uploads = join(h.dir, 'config', 'uploads');
    expect(readdirSync(uploads)).toHaveLength(1);
    // The resume meets no answer: the state kept for the next run.
    await expect(sulfurUpload(ctx, file, 'document', 'playlist', 'pl1')).rejects.toMatchObject({ exit: 3 });
    expect(readdirSync(uploads)).toHaveLength(1);
    expect(existsSync(join(uploads, readdirSync(uploads)[0]))).toBe(true);
    // Refused by the platform: a new upload (requestUpload again).
    mode = 'refused';
    await expect(sulfurUpload(ctx, file, 'document', 'playlist', 'pl1')).rejects.toMatchObject({ code: 'SERVER_BUSY' });
    expect(createHash('sha256').update('x').digest('hex')).toHaveLength(64);
  });
});

describe('docs/sulfur.md, its table of commands', () => {
  it('an operation whose server arguments talc lacks is never "works" without an adapter; the table is current', async () => {
    const { serverRequiresBeyondTalc } = await import('../src/sulfur/fit.js');
    const { ADAPTERS } = await import('../src/sulfur/talc.js');
    const { CONTRACT } = await import('../src/api/graphql.js');
    expect(serverRequiresBeyondTalc('voteOnContribution', 'mutation')).toEqual(['discussionId']);
    expect(serverRequiresBeyondTalc('deleteTheme', 'mutation')).toEqual(['id']);
    expect(serverRequiresBeyondTalc('pickQuickPollChoice', 'mutation')).toEqual([]);
    // Every talc operation the server serves with an argument more is adapted.
    for (const kind of ['query', 'mutation'] as const) {
      for (const op of Object.keys(CONTRACT[kind])) if (serverRequiresBeyondTalc(op, kind).length) expect(ADAPTERS[op], `${kind} ${op}`).toBeDefined();
    }
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/sulfur-table.ts', '--check'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  }, 30_000);
});
