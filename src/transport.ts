// The network of the CLI, on fetch alone (native-sulfur's transport: src/sulfur/http.ts). A 429 is tried again once, after
// the seconds it gives (Retry-After, at most 60).
import type { Context } from './context.js';
import { networkError } from './errors.js';
import { VERSION } from './version.js';
import { redactText } from './network.js';

export const MAX_RETRY_SECONDS = 60;

export type HttpAnswer = { status: number; json: Record<string, unknown>; headers: Headers };

async function send(ctx: Context, url: string, init: RequestInit): Promise<Response> {
  try {
    return await ctx.io.fetch(url, init);
  } catch (error) {
    const cause = (error as Error & { cause?: Error }).cause?.message;
    throw networkError('NETWORK_ERROR', redactText(`No answer from ${new URL(url).host}: ${(error as Error).message}${cause ? ` (${cause})` : ''}`), { host: new URL(url).host });
  }
}

/** The seconds to wait before trying a 429 again: its Retry-After (seconds or a date), 1 without it. */
export function retryAfterSeconds(headers: Headers, now: number): number {
  const value = headers.get('retry-after');
  if (!value) return 1;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : 1;
}

/** The headers of every request to the break-rocks API (specs v101.20.0, contracts/app-versions.md § The client headers): the client, its version, and the user agent. */
export function clientHeaders(): Record<string, string> {
  return { 'user-agent': `breakrocks/${VERSION}`, 'x-breakrocks-client': 'CLI', 'x-breakrocks-app-version': VERSION };
}

/** A request to the break-rocks API: [request] with the client headers, those of [init] winning. */
export function apiRequest(ctx: Context, url: string, init: RequestInit): Promise<Response> {
  return request(ctx, url, { ...init, headers: { ...clientHeaders(), ...(init.headers as Record<string, string> | undefined) } });
}

/** A request, tried again once after a 429 (when the wait is at most 60 seconds). */
export async function request(ctx: Context, url: string, init: RequestInit): Promise<Response> {
  const first = await send(ctx, url, init);
  if (first.status !== 429) return first;
  const wait = retryAfterSeconds(first.headers, ctx.now());
  if (wait > MAX_RETRY_SECONDS) return first;
  ctx.progress(`Throttled by ${new URL(url).host}: trying again in ${wait} s`);
  await ctx.io.sleep(wait * 1000);
  return send(ctx, url, init);
}
