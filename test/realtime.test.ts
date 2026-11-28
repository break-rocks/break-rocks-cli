// --watch in real time on native-sulfur: the cell map's Event API (rendezvous hashing over `realtimeApis`), the account's
// channel or a discussion's (liveMode), our own token in the `header-…` subprotocol, a read on each event, and the fallback
// to reading again when the real time is not there (a cell map missing, a refused connection, a discussion polled).
import { describe, expect, it } from 'vitest';
import { apiFor, fnv1a32 } from '../src/sulfur/live.js';
import { parseEvent } from '../src/realtime.js';
import { harness, last, sulfurSession } from './helpers.js';

const BASE = 'https://api.test';
const CELLS = 'https://cells.test/client/cells.json';
const RT = 'wss://rt.appsync-realtime-api.test/event/realtime';
const EV = 'https://rt.appsync-api.test/event';

type Sent = { type: string; id?: string; channel?: string; authorization?: Record<string, string> };

/** A WebSocket of the Event API: acks, subscribes (or refuses), then publishes [events] on the first channel subscribed. */
function fakeSocket(options: { events?: unknown[]; refuse?: boolean } = {}) {
  const sockets: { url: string; protocols: string[]; sent: Sent[] }[] = [];
  class FakeSocket {
    private listeners = new Map<string, ((e: unknown) => void)[]>();
    private record: { url: string; protocols: string[]; sent: Sent[] };
    constructor(url: string, init: { protocols: string[] }) {
      this.record = { url, protocols: init.protocols, sent: [] };
      sockets.push(this.record);
      queueMicrotask(() => this.emit('open', {}));
    }
    addEventListener(type: string, f: (e: unknown) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]); }
    private emit(type: string, e: unknown) { for (const f of this.listeners.get(type) ?? []) f(e); }
    private message(v: unknown) { queueMicrotask(() => this.emit('message', { data: JSON.stringify(v) })); }
    send(data: string) {
      const m = JSON.parse(data) as Sent;
      this.record.sent.push(m);
      if (m.type === 'connection_init') this.message(options.refuse ? { type: 'connection_error', errors: [{ errorType: 'UnauthorizedException' }] } : { type: 'connection_ack', payload: { connectionTimeoutMs: 300000 } });
      if (m.type === 'subscribe') {
        this.message({ type: 'subscribe_success', id: m.id });
        for (const ev of options.events ?? []) this.message({ type: 'data', id: m.id, event: JSON.stringify(JSON.stringify(ev)) });
      }
    }
    close() { queueMicrotask(() => this.emit('close', { code: 1000 })); }
  }
  return { sockets, Socket: FakeSocket as unknown as typeof WebSocket };
}

/** A profile of dev signed in as a person; the API answers [answers] by field, the cell map [cells] (null: 404). */
function setup(answers: Record<string, (n: number) => unknown>, cells: unknown | null, socket = fakeSocket()) {
  const reads: Record<string, number> = {};
  const h = harness({
    env: { BREAKROCKS_SULFUR_URL: BASE, BREAKROCKS_SULFUR_CELLS: CELLS },
    fetch: async (url, init) => {
      if (String(url) === CELLS) return cells ? Response.json(cells) : new Response('no', { status: 404 });
      if (String(url) !== `${BASE}/graphql`) throw new Error(`unexpected ${String(url)}`);
      const { query } = JSON.parse(String(init!.body));
      const field = /\{\s*(?:\w+\s*:\s*)?(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      reads[field] = (reads[field] ?? 0) + 1;
      const answer = answers[field];
      if (!answer) throw new Error(`no answer for ${field}`);
      return Response.json({ data: { [field]: answer(reads[field]) } });
    },
  });
  h.io.WebSocket = socket.Socket;
  h.io.env.BREAKROCKS_PROFILE = 'me';
  sulfurSession(h.io, 'human', { accountId: 'eu_alice', env: 'prod' });
  return { h, reads, sockets: socket.sockets };
}
const cellMap = { schema: 1, default: 'eu', cells: { eu: { realtime: RT, events: EV, realtimeApis: [{ id: 'a0', realtime: RT, events: EV }] } } };
const inboxPage = (n: number) => ({ items: Array.from({ length: Math.min(n, 2) }, (_, i) => ({ kind: 'DM', account: { id: `eu_b${i}` }, lastAt: `2026-11-28T10:0${i}:00.000Z`, unread: true })), next: null });

describe('--watch in real time', () => {
  it('subscribes to the account\'s channel on the cell\'s Event API with our token, and reads again on an event', async () => {
    const socket = fakeSocket({ events: [{ ev: 'msgs', d: 'dm.x', msgs: [] }] });
    const { h, reads, sockets } = setup({ inbox: inboxPage, accountChannel: () => '/m/a/eu_alice/0' }, cellMap, socket);
    expect(await h.run('messages', 'inbox', '--watch', '--duration', '20', '--json'), h.all()).toBe(0);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe(RT);
    expect(sockets[0].protocols[0]).toBe('aws-appsync-event-ws');
    const header = JSON.parse(Buffer.from(sockets[0].protocols[1].slice('header-'.length), 'base64url').toString());
    expect(header).toMatchObject({ host: 'rt.appsync-api.test', Authorization: expect.stringMatching(/^Bearer /) });
    expect(sockets[0].sent.find((m) => m.type === 'subscribe')).toMatchObject({ channel: '/m/a/eu_alice/0' });
    expect(last(h)).toMatchObject({ watched: true, mode: 'realtime', events: 1 });
    expect(reads.inbox).toBeGreaterThanOrEqual(2);
  });

  it('reads again when the real time is not there: no cell map, a refused connection, a discussion the platform polls', async () => {
    const noMap = setup({ inbox: inboxPage, accountChannel: () => '/m/a/eu_alice/0' }, null);
    expect(await noMap.h.run('messages', 'inbox', '--watch', '--duration', '30', '--interval', '15', '--json')).toBe(0);
    expect(last(noMap.h)).toMatchObject({ mode: 'polling' });
    expect(noMap.h.errors.join('\n')).toMatch(/Real time not used \(CELL_MAP_UNAVAILABLE/);
    const refused = setup({ inbox: inboxPage, accountChannel: () => '/m/a/eu_alice/0' }, cellMap, fakeSocket({ refuse: true }));
    expect(await refused.h.run('messages', 'inbox', '--watch', '--duration', '30', '--interval', '15', '--json')).toBe(0);
    expect(last(refused.h)).toMatchObject({ mode: 'polling' });
    expect(refused.h.errors.join('\n')).toMatch(/REALTIME_REFUSED/);
    const polled = setup({ messages: () => ({ items: [], next: null }), liveMode: () => ({ mode: 'poll', channel: null }) }, cellMap);
    expect(await polled.h.run('messages', 'groups', 'read', 'g1', '--watch', '--duration', '30', '--interval', '15', '--json'), polled.h.all()).toBe(0);
    expect(last(polled.h)).toMatchObject({ mode: 'polling' });
    expect(polled.h.errors.join('\n')).toMatch(/poll mode/);
    expect(polled.sockets).toEqual([]);
    const off = setup({ inbox: inboxPage, accountChannel: () => '/m/a/eu_alice/0' }, cellMap);
    expect(await off.h.run('messages', 'inbox', '--watch', '--realtime', 'off', '--duration', '15', '--interval', '15', '--json')).toBe(0);
    expect(off.sockets).toEqual([]);
  });

  it('subscribes to a group\'s channel at its epoch (liveMode)', async () => {
    const socket = fakeSocket({ events: [{ ev: 'msgs', d: 'g1', msgs: [] }] });
    const { h, sockets } = setup({ messages: () => ({ items: [], next: null }), liveMode: () => ({ mode: 'push', channel: '/m/g/g1/3' }) }, cellMap, socket);
    expect(await h.run('messages', 'groups', 'read', 'g1', '--watch', '--duration', '10', '--json'), h.all()).toBe(0);
    expect(sockets[0].sent.find((m) => m.type === 'subscribe')).toMatchObject({ channel: '/m/g/g1/3' });
    expect(last(h)).toMatchObject({ mode: 'realtime' });
  });

  it('picks the Event API of a subject as the server does, and reads an event sent as a JSON text of JSON', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    const apis = [{ id: 'a0' }, { id: 'a1' }, { id: 'a2' }];
    const chosen = apiFor('eu_alice', apis);
    expect(chosen.id).toBe(apis.reduce((b, a) => (fnv1a32(`${a.id}|eu_alice`) > fnv1a32(`${b.id}|eu_alice`) ? a : b)).id);
    expect(apiFor('x', [{ id: 'a0' }]).id).toBe('a0');
    expect(parseEvent(JSON.stringify(JSON.stringify({ ev: 'msgs' })))).toEqual({ ev: 'msgs' });
    expect(parseEvent('not json')).toBeNull();
  });
});
