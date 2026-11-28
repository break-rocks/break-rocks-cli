// The server branches of messaging and governance served on the new backend (native-sulfur, server 6bd5daf1): the invite
// exceptions and policy, a place or an arrival sent alone, the new Message fields printed, a universe's field and display
// case, and the proposal kinds and changes refused before anything is sent.
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { saveSulfurSession, type SulfurSession } from '../src/sulfur/session.js';
import { harness, last } from './helpers.js';

const BASE = 'https://sulfur.test';
const jwt = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"EdDSA"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const HUMAN: SulfurSession = { backend: 'sulfur', env: 'dev', cell: 'eu', accountId: 'eu_a', handle: 'ada', kind: 'untrusted', method: 'email', signedInAt: '2026-10-23T10:00:00.000Z', accessExpiresAt: '2099-10-23T11:00:00.000Z', storage: 'file', access: jwt({ sub: 'eu_a' }), refresh: 'rt' };

type Sent = { query: string; variables: Record<string, unknown> };

/** A cell answering GraphQL with [graphql] (null: an error); every request kept. */
function cell(graphql: (query: string, variables: Record<string, unknown>) => unknown) {
  const sent: Sent[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (new URL(String(input)).pathname !== '/graphql') return Response.json({}, { status: 404 });
    const entry = { query: String(body.query), variables: (body.variables ?? {}) as Record<string, unknown> };
    sent.push(entry);
    const data = graphql(entry.query, entry.variables);
    return data === null ? Response.json({ errors: [{ message: 'unknown', extensions: { code: 'BAD_REQUEST' } }] }) : Response.json({ data });
  }) as typeof globalThis.fetch;
  const h = harness({ fetch, env: { BREAKROCKS_SULFUR_URL: BASE, BREAKROCKS_BACKEND: 'sulfur' } });
  const ctx = new Context(h.io, NO_FLAGS);
  ctx.saveProfile({ env: 'dev', kind: 'human' } as never);
  saveSulfurSession(ctx, HUMAN);
  return { h, sent };
}

const MESSAGE = { id: 'eu-m1', createdAt: '2026-11-28T10:00:00.000Z', author: { id: 'eu_a', handle: 'ada' }, text: null, kind: 'PLACE', place: { name: 'Bastille' }, arrival: null, stance: null, language: null, via: null, quickPoll: null, myVote: null, spans: [], display: null };

describe('the invite exceptions and the invite policy', () => {
  it('me invite-exceptions add and remove send setInviteException with the account id', async () => {
    const { h, sent } = cell((q) => (q.includes('accountByHandle') ? { accountByHandle: { id: 'eu_b' } } : q.includes('setInviteException') ? { setInviteException: { id: 'eu_b', handle: 'bob', displayName: 'Bob', kind: 'HUMAN' } } : null));
    expect(await h.run('me', 'invite-exceptions', 'add', 'eu_b', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ id: 'eu_b', handle: 'bob' });
    const add = sent.find((s) => s.query.includes('setInviteException'))!;
    expect(add.query).toMatch(/setInviteException\(accountId: \$\w+, excepted: \$\w+, requestId: \$\w+\)/);
    expect(Object.values(add.variables)).toEqual(expect.arrayContaining(['eu_b', true]));
    expect(await h.run('me', 'invite-exceptions', 'remove', 'eu_b', '--json')).toBe(0);
    expect(Object.values(sent.filter((s) => s.query.includes('setInviteException')).at(-1)!.variables)).toEqual(expect.arrayContaining(['eu_b', false]));
  });

  it('messages settings set --read-receipts false and --no-silent-decline send the booleans', async () => {
    const { h, sent } = cell((q) => (q.includes('setSettings') ? { setSettings: { messaging: { readReceipts: false, silentDecline: false } } } : null));
    expect(await h.run('messages', 'settings', 'set', '--read-receipts', 'false', '--no-silent-decline', '--json')).toBe(0);
    expect(JSON.stringify(sent.find((s) => s.query.includes('setSettings'))!.variables)).toMatch(/"readReceipts":false.*"silentDecline":false|"silentDecline":false.*"readReceipts":false/);
  });

  it('messages settings set --invite-policy except sends setSettings.messaging.invitePolicy', async () => {
    const { h, sent } = cell((q) => (q.includes('setSettings') ? { setSettings: { messaging: { invitePolicy: 'except' } } } : null));
    expect(await h.run('messages', 'settings', 'set', '--invite-policy', 'except', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ invitePolicy: 'except' });
    const set = sent.find((s) => s.query.includes('setSettings'))!;
    expect(JSON.stringify(set.variables)).toContain('"invitePolicy":"except"');
  });
});

describe('a place or an arrival sent alone (sendMessage)', () => {
  it('sends the place with no text, and prints it', async () => {
    const { h, sent } = cell((q) => (q.includes('accountByHandle') ? { accountByHandle: { id: 'eu_b' } } : q.includes('sendMessage') ? { sendMessage: MESSAGE } : null));
    expect(await h.run('messages', 'direct', 'send', 'eu_b', '--place-point', '48.853,2.369', '--place-name', 'Bastille', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ id: 'eu-m1', place: { name: 'Bastille' } });
    const input = sent.find((s) => s.query.includes('sendMessage'))!.variables.input as Record<string, unknown>;
    expect(input).toMatchObject({ to: { accountId: 'eu_b' }, text: null, place: { name: 'Bastille', point: { lat: 48.853, lon: 2.369 } } });
  });

  it('sends an arrival in a group chat; refuses a place beside a text, or without its name', async () => {
    const { h, sent } = cell((q) => (q.includes('sendMessage') ? { sendMessage: { ...MESSAGE, kind: 'ARRIVAL', place: null, arrival: { zoneName: 'Gare de Lyon' } } } : null));
    expect(await h.run('messages', 'groups', 'send', 'eu_g1', '--arrival', 'Gare de Lyon', '--json')).toBe(0);
    expect(sent.at(-1)!.variables.input).toMatchObject({ to: { groupChatId: 'eu_g1' }, arrival: { zoneName: 'Gare de Lyon' } });
    const before = sent.length;
    expect(await h.run('messages', 'groups', 'send', 'eu_g1', 'Hello', '--place-point', '48.853,2.369', '--place-name', 'Bastille', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(await h.run('messages', 'groups', 'send', 'eu_g1', '--place-point', '48.853,2.369', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'PLACE_INVALID' } });
    expect(sent.length).toBe(before);
  });

  it('sends a stance and a place in a universe discussion', async () => {
    const { h, sent } = cell((q) => (q.includes('sendMessage') ? { sendMessage: { ...MESSAGE, stance: 'FOR', text: 'Yes' } } : null));
    expect(await h.run('discussions', 'send', '%paris&budget', 'Yes', '--stance', 'FOR', '--json')).toBe(0);
    expect(sent.at(-1)!.variables.input).toMatchObject({ to: { channel: '%paris&budget' }, text: 'Yes', stance: 'FOR' });
    expect(await h.run('discussions', 'send', '%paris&velo', '--place-point', '48.853,2.369', '--place-name', 'Bastille', '--json')).toBe(0);
    expect(sent.at(-1)!.variables.input).toMatchObject({ to: { channel: '%paris&velo' }, place: { name: 'Bastille' } });
  });

  it('asks the new Message fields and prints them in the compact line', async () => {
    const poll = { ...MESSAGE, place: null, text: null, language: 'fr', via: { agentName: 'Atlas' }, quickPoll: { question: 'When?', choices: ['6 pm', '7 pm'], totals: [2, 1], myChoice: 0, closesAt: '2026-11-29T10:00:00.000Z' } };
    const { h, sent } = cell((q) => (q.includes('pinnedMessages') ? { pinnedMessages: [poll, MESSAGE] } : null));
    expect(await h.run('messages', 'pinned', '--group', 'eu_g1')).toBe(0);
    const query = sent.find((s) => s.query.includes('pinnedMessages'))!.query;
    for (const f of ['place', 'arrival', 'stance', 'spans', 'language', 'via', 'myVote', 'quickPoll', 'discussionCard', 'voteCard', 'eventCard', 'playlistCard', 'routeCard']) expect(query).toContain(f);
    const out = h.lines.join('\n');
    expect(out).toContain('poll: When? [*6 pm 2 | 7 pm 1]  via Atlas  (fr)');
    expect(out).toContain('@ada  place: Bastille');
  });
});

describe('a universe\'s field and display case (governance)', () => {
  it('governance field sends setUniverseField', async () => {
    const { h, sent } = cell((q) => (q.includes('setUniverseField') ? { setUniverseField: { name: 'paris', field: 'PLACES' } } : null));
    expect(await h.run('governance', 'field', '%paris', 'PLACES', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ name: 'paris' });
    expect(Object.values(sent[0].variables)).toEqual(expect.arrayContaining(['%paris', 'PLACES']));
  });

  it('governance display sends setUniverseDisplay (true there) and answers the universe read after it', async () => {
    const { h, sent } = cell((q) => (q.includes('setUniverseDisplay') ? { setUniverseDisplay: true } : q.includes('universe(') ? { universe: { name: 'Paris' } } : null));
    expect(await h.run('governance', 'display', '%paris', 'Paris', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ name: 'Paris' });
    expect(sent[0].query).toMatch(/setUniverseDisplay\(universe: \$u, display: \$d, requestId: \$r\) \}/);
    expect(sent[0].variables).toMatchObject({ u: '%paris', d: 'Paris' });
    expect(sent[1].variables).toEqual({ n: '%paris' });
  });
});

describe('the proposals the new backend does not file', () => {
  it('refuses the kinds not served, before anything is sent, naming those served', async () => {
    const { h, sent } = cell(() => null);
    expect(await h.run('proposals', 'file', '%paris', '--kind', 'THEME', '--title', 'A theme', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'NOT_ON_NEW_BACKEND' } });
    expect(JSON.stringify(last(h))).toContain('DISPLAY_CASE');
    expect(await h.run('proposals', 'file', '%paris', '--kind', 'TERRITORY', '--title', 'The city', '--no-territory', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'NOT_ON_NEW_BACKEND' } });
    expect(sent.length).toBe(0);
  });

  it('refuses a change it does not take and a showcase clearing anything but the logo; files a kind served', async () => {
    const { h, sent } = cell((q) => (q.includes('fileProposal') ? { fileProposal: { id: 'eu_p1', kind: 'FIELD', title: 'Places', status: 'WAITING_SUPPORT' } } : null));
    expect(await h.run('proposals', 'file', '%paris', '--kind', 'SHOWCASE', '--title', 'A look', '--appearance', '{"accent":"#123456"}', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'NOT_ON_NEW_BACKEND' } });
    expect(await h.run('proposals', 'file', '%paris', '--kind', 'SHOWCASE', '--title', 'No banner', '--clear', 'BANNER', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'NOT_ON_NEW_BACKEND' } });
    expect(sent.length).toBe(0);
    expect(await h.run('proposals', 'file', '%paris', '--kind', 'FIELD', '--title', 'Places', '--field', 'PLACES', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ id: 'eu_p1' });
    expect(JSON.stringify(sent[0].variables)).toContain('"field":"PLACES"');
  });
});

describe('messages changes --since', () => {
  it('sends a duration back from now as an ISO 8601 instant, a date as an instant, and refuses anything else', async () => {
    const { h, sent } = cell((q) => (q.includes('messageChanges') ? { messageChanges: { items: [], next: null } } : null));
    expect(await h.run('messages', 'changes', '--group', 'eu_g1', '--since', '1h', '--json')).toBe(0);
    const since = (v: Record<string, unknown>) => Object.values(v).find((x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x)) as string;
    const first = since(sent.at(-1)!.variables);
    expect(first).toBe(new Date(h.clock.now - 3_600_000).toISOString());
    expect(await h.run('messages', 'changes', '--group', 'eu_g1', '--since', '2026-11-07T00:00:00+01:00', '--json')).toBe(0);
    expect(since(sent.at(-1)!.variables)).toBe('2026-11-06T23:00:00.000Z');
    const before = sent.length;
    expect(await h.run('messages', 'changes', '--group', 'eu_g1', '--since', 'yesterday', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(sent.length).toBe(before);
  });
});
