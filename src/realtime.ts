// The real-time updates: the WebSocket of the AppSync Event API of the cell,
// the subprotocols aws-appsync-event-ws and header-<base64url {host, Authorization}>, connection_init,
// connection_ack (its connectionTimeoutMs: no "ka" within it, the connection is lost), one subscribe
// per Event API channel, each event a JSON string in "data"; events seen once (their id). WebSocket
// of Node 24, no dependency. The contract lets humans connect (their Cognito id token); "delegated
// agents and agent operators cannot connect yet": for them --watch reads again, unless --realtime on
// tries anyway (the refusal of the platform is then told, and the reading goes on).
import { randomUUID } from 'node:crypto';
import type { Context } from './context.js';
import { CliError, EXIT } from './errors.js';

export type RealtimeEvent = { id: string; at?: string; type: string; [field: string]: unknown };
export type RealtimeMode = 'auto' | 'on' | 'off';
export const ACK_TIMEOUT_MS = 10_000;

let lingering = 0;
/** Sockets closed by us whose close handshake the server has not answered: Node keeps the process alive until it does (70 to 90 s on AppSync). */
export const lingeringSockets = () => lingering;
/** Ends the process once the CLI is done: at once if nothing lingers, else after a short grace (the sockets are dropped, not waited for). */
export function exitWhenDone(code: number, graceMs = 250): void {
  process.exitCode = code;
  if (lingering > 0) setTimeout(() => process.exit(code), graceMs).unref();
}

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Why the real-time updates cannot be used, or undefined when they can be tried ([_sessionKind]: every account may). */
export function realtimeUnavailable(mode: RealtimeMode, _sessionKind: string, url: string | undefined): string | undefined {
  if (mode === 'off') return 'off (--realtime off)';
  if (!url) return 'the cell map has no real-time address';
  return undefined;
}

export type Connection = { close: () => void; closed: Promise<string> };

/**
 * Connects to [realtimeUrl] with [token] and subscribes to [channels]; [onEvent] for each event
 * (once by id). Resolves once every subscription succeeded; refuses with REALTIME_REFUSED (the
 * connection_error or subscribe_error of the platform) or REALTIME_UNREACHABLE. [closed] resolves
 * with the reason when the connection is lost (no keep-alive within its timeout, closed).
 */
export async function connect(ctx: Context, options: { realtimeUrl: string; httpUrl: string; token: string; channels: string[]; onEvent: (event: RealtimeEvent) => void; seen?: Set<string> }): Promise<Connection> {
  const Socket = ctx.io.WebSocket ?? globalThis.WebSocket;
  const host = new URL(options.httpUrl).host;
  const auth = { host, Authorization: options.token };
  const seen = options.seen ?? new Set<string>();
  const socket = new Socket(options.realtimeUrl, ['aws-appsync-event-ws', `header-${b64url(auth)}`]);
  let socketClosed = false;
  socket.addEventListener('close', () => { if (!socketClosed) { socketClosed = true; lingering--; } });
  lingering++;
  let timeoutMs = 300_000, lastKa = ctx.now(), resolveClosed!: (r: string) => void;
  const closed = new Promise<string>((r) => { resolveClosed = r; });
  let ticker: ReturnType<typeof setInterval> | undefined;
  const pending = new Map<string, { channel: string; resolve: () => void; reject: (e: Error) => void }>();
  const finish = (reason: string) => { if (ticker) clearInterval(ticker); for (const p of pending.values()) p.reject(new CliError('REALTIME_UNREACHABLE', reason, EXIT.NETWORK)); pending.clear(); resolveClosed(reason); };
  const acked = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CliError('REALTIME_UNREACHABLE', 'No connection_ack from the Event API', EXIT.NETWORK)), ACK_TIMEOUT_MS);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'connection_init' })));
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new CliError('REALTIME_UNREACHABLE', 'The WebSocket of the Event API failed', EXIT.NETWORK)); });
    socket.addEventListener('close', (e) => { clearTimeout(timer); reject(new CliError('REALTIME_UNREACHABLE', `The Event API closed the connection (${(e as CloseEvent).code})`, EXIT.NETWORK)); finish(`closed (${(e as CloseEvent).code})`); });
    socket.addEventListener('message', (m) => {
      let msg: { type?: string; id?: string; event?: string; payload?: { connectionTimeoutMs?: number }; errors?: { errorType?: string; message?: string }[] };
      try { msg = JSON.parse(String((m as MessageEvent).data)); } catch { return; }
      switch (msg.type) {
        case 'connection_ack': clearTimeout(timer); timeoutMs = msg.payload?.connectionTimeoutMs ?? timeoutMs; lastKa = ctx.now(); resolve(); break;
        case 'connection_error': clearTimeout(timer); reject(new CliError('REALTIME_REFUSED', `The Event API refused the connection: ${msg.errors?.map((e) => e.errorType ?? e.message).join(', ') ?? 'connection_error'}`, EXIT.REFUSED, { errors: msg.errors ?? [] }, 'platform')); break;
        case 'ka': lastKa = ctx.now(); break;
        case 'subscribe_success': pending.get(msg.id ?? '')?.resolve(); pending.delete(msg.id ?? ''); break;
        case 'subscribe_error': { const p = pending.get(msg.id ?? ''); p?.reject(new CliError('REALTIME_REFUSED', `The Event API refused the channel ${p.channel}: ${msg.errors?.map((e) => e.errorType ?? e.message).join(', ') ?? 'subscribe_error'}`, EXIT.REFUSED, { channel: p.channel, errors: msg.errors ?? [] }, 'platform')); pending.delete(msg.id ?? ''); break; }
        case 'data': {
          let event: RealtimeEvent;
          try { event = JSON.parse(msg.event ?? ''); } catch { return; }
          if (!event?.type || (event.id && seen.has(event.id))) return;
          if (event.id) seen.add(event.id);
          options.onEvent(event);
          break;
        }
      }
    });
  });
  try {
    await acked;
    ticker = setInterval(() => { if (ctx.now() - lastKa > timeoutMs) { socket.close(); finish('no keep-alive'); } }, 5000);
    (ticker as { unref?: () => void }).unref?.();
    await Promise.all(options.channels.map((channel) => new Promise<void>((resolve, reject) => {
      const id = randomUUID();
      pending.set(id, { channel, resolve, reject });
      socket.send(JSON.stringify({ type: 'subscribe', id, channel, authorization: auth }));
    })));
  } catch (error) {
    try { socket.close(); } catch { /* closed */ }
    finish('refused');
    throw error;
  }
  return { close: () => { try { socket.close(); } catch { /* closed */ } finish('closed'); }, closed };
}
