// The real-time updates (contracts/realtime.md) with a fake WebSocket: the subprotocols and the
// messages of AppSync Events, an event seen once, a refusal; --watch in real time, and its reading
// again when the connection is refused or the account may not connect.
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { connect, realtimeUnavailable } from '../src/realtime.js';
import { saveSession } from '../src/session.js';
import { harness, last } from './helpers.js';

type Sent = Record<string, unknown>;
/** A fake WebSocket of the Event API: [behaviour] answers each message sent. */
function fakeSocket(behaviour: (msg: Sent, socket: any) => void) {
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    url: string; protocols: string[]; sent: Sent[] = []; listeners: Record<string, ((e: unknown) => void)[]> = {};
    constructor(url: string, protocols: string[]) { this.url = url; this.protocols = protocols; sockets.push(this); setTimeout(() => this.emit('open', {}), 0); }
    addEventListener(type: string, f: (e: unknown) => void) { (this.listeners[type] ??= []).push(f); }
    emit(type: string, e: unknown) { for (const f of this.listeners[type] ?? []) f(e); }
    message(m: unknown) { this.emit('message', { data: JSON.stringify(m) }); }
    send(text: string) { const msg = JSON.parse(text); this.sent.push(msg); behaviour(msg, this); }
    close() { this.emit('close', { code: 1000 }); }
  }
  return { Socket: FakeSocket as unknown as typeof WebSocket, sockets };
}
const ok = (onSubscribe?: (msg: Sent, s: { message: (m: unknown) => void }) => void) => (msg: Sent, s: { message: (m: unknown) => void }) => {
  if (msg.type === 'connection_init') s.message({ type: 'connection_ack', payload: { connectionTimeoutMs: 300000 } });
  if (msg.type === 'subscribe') { s.message({ type: 'subscribe_success', id: msg.id }); onSubscribe?.(msg, s); }
};

describe('the Event API', () => {
  it('connects with the subprotocols of AppSync Events, subscribes, and gives each event once', async () => {
    const { Socket, sockets } = fakeSocket(ok((msg, s) => {
      const event = JSON.stringify({ id: 'e1', type: 'dm.message', conversationWith: 'eu-b' });
      s.message({ type: 'data', id: msg.id, event });
      s.message({ type: 'data', id: msg.id, event });
    }));
    const h = harness();
    h.io.WebSocket = Socket;
    const events: unknown[] = [];
    const c = await connect(new Context(h.io, NO_FLAGS), { realtimeUrl: 'wss://rt.test/event/realtime', httpUrl: 'https://ev.test/event', token: 'tok', channels: ['/users/eu-a'], onEvent: (e) => events.push(e) });
    const s = sockets[0] as unknown as { url: string; protocols: string[]; sent: Sent[] };
    expect(s.url).toBe('wss://rt.test/event/realtime');
    expect(s.protocols[0]).toBe('aws-appsync-event-ws');
    expect(JSON.parse(Buffer.from(s.protocols[1].replace(/^header-/, ''), 'base64url').toString())).toEqual({ host: 'ev.test', Authorization: 'tok' });
    expect(s.sent[0]).toEqual({ type: 'connection_init' });
    expect(s.sent[1]).toMatchObject({ type: 'subscribe', channel: '/users/eu-a', authorization: { host: 'ev.test', Authorization: 'tok' } });
    expect(events).toEqual([{ id: 'e1', type: 'dm.message', conversationWith: 'eu-b' }]);
    c.close();
  });
  it('says the refusal of the platform (REALTIME_REFUSED)', async () => {
    const { Socket } = fakeSocket((msg, s) => { if (msg.type === 'connection_init') (s as unknown as { message: (m: unknown) => void }).message({ type: 'connection_error', errors: [{ errorType: 'UnauthorizedException' }] }); });
    const h = harness();
    h.io.WebSocket = Socket;
    await expect(connect(new Context(h.io, NO_FLAGS), { realtimeUrl: 'wss://rt.test/x', httpUrl: 'https://ev.test/event', token: 't', channels: ['/users/a'], onEvent: () => {} })).rejects.toMatchObject({ code: 'REALTIME_REFUSED' });
  });
  it('is not tried for a delegated agent or an operator unless asked (the contract)', () => {
    expect(realtimeUnavailable('auto', 'agent', 'wss://x')).toBeUndefined();
    expect(realtimeUnavailable('auto', 'operator', 'wss://x')).toBeUndefined();
    expect(realtimeUnavailable('on', 'agent', 'wss://x')).toBeUndefined();
    expect(realtimeUnavailable('off', 'human', 'wss://x')).toMatch(/off/);
    expect(realtimeUnavailable('on', 'agent', undefined)).toMatch(/no real-time address/);
  });
});

function signedIn(Socket?: typeof WebSocket, conversation?: (n: number) => unknown[]) {
  let reads = 0;
  const h = harness({
    env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1', BREAKROCKS_REALTIME_URL: 'wss://rt.test/event/realtime', BREAKROCKS_EVENTS_URL: 'https://ev.test/event' },
    fetch: async (_url, init) => {
      const { query } = JSON.parse(String(init!.body));
      if (query.includes('accountByHandle')) return Response.json({ data: { accountByHandle: { id: 'eu-b' } } });
      reads++;
      return Response.json({ data: { conversation: { items: conversation!(reads), next: null } } });
    },
  });
  if (Socket) h.io.WebSocket = Socket;
  saveSession(new Context(h.io, NO_FLAGS), { kind: 'agent', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-a', agentId: 'ag' });
  return h;
}
const msg = (id: string) => ({ id, createdAt: '2026-10-23T10:00:00.000Z', display: id });

describe('dm read --watch', () => {
  it('reads again on each event of the conversation, in real time', async () => {
    const { Socket, sockets } = fakeSocket(ok((m, s) => {
      s.message({ type: 'data', id: m.id, event: JSON.stringify({ id: 'e1', type: 'dm.message', conversationWith: 'eu-b' }) });
      s.message({ type: 'data', id: m.id, event: JSON.stringify({ id: 'e2', type: 'dm.message', conversationWith: 'eu-other' }) });
    }));
    const h = signedIn(Socket, (n) => (n === 1 ? [msg('m1')] : [msg('m2'), msg('m1')]));
    expect(await h.run('dm', 'read', '@bob', '--watch', '--realtime', 'on', '--duration', '5', '--jsonl')).toBe(0);
    expect(h.lines.map((l) => JSON.parse(l).id)).toEqual(['m2']);
    expect((sockets[0] as unknown as { sent: Sent[] }).sent[1]).toMatchObject({ channel: '/users/eu-a' });
    expect(h.errors.join('\n')).toMatch(/Watching in real time/);
  });
  it('reads again every --interval when the platform refuses the connection, and says why once', async () => {
    const { Socket } = fakeSocket((m, s) => { if (m.type === 'connection_init') (s as unknown as { message: (x: unknown) => void }).message({ type: 'connection_error', errors: [{ errorType: 'UnauthorizedException' }] }); });
    const h = signedIn(Socket, (n) => (n === 1 ? [msg('m1')] : [msg('m2'), msg('m1')]));
    expect(await h.run('dm', 'read', '@bob', '--watch', '--realtime', 'on', '--interval', '15', '--duration', '15', '--json')).toBe(0);
    expect(h.errors.join('\n')).toMatch(/Real time not used \(REALTIME_REFUSED.*UnauthorizedException\)/);
    expect(last(h)).toMatchObject({ mode: 'polling', items: 1 });
  });
  it('tries for an agent by default (specs v49.3.0), and reads again when its channel is refused', async () => {
    const { Socket } = fakeSocket((m, s) => {
      const socket = s as unknown as { message: (x: unknown) => void };
      if (m.type === 'connection_init') socket.message({ type: 'connection_ack', payload: { connectionTimeoutMs: 300000 } });
      if (m.type === 'subscribe') socket.message({ type: 'subscribe_error', id: m.id, errors: [{ errorType: 'UnauthorizedException' }] });
    });
    const h = signedIn(Socket, () => [msg('m1')]);
    expect(await h.run('dm', 'read', '@bob', '--watch', '--interval', '15', '--duration', '15', '--json')).toBe(0);
    expect(h.errors.join('\n')).toMatch(/Real time not used \(REALTIME_REFUSED/);
    expect(last(h)).toMatchObject({ mode: 'polling' });
  });
});
