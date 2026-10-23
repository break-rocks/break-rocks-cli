// The network of the CLI, on fetch alone: the GraphQL API (the token in Authorization as is) and the
// agents host (JSON, POST, Authorization: Bearer <token>), contracts/agent-sign-in.md. A 429 is tried
// again once, after the seconds it gives (Retry-After, at most 60); a GraphQL RATE_LIMITED whose
// retryAt is within 60 seconds likewise. A refusal is a CliError with the code of the contract.
import type { Context } from './context.js';
import { CliError, EXIT, networkError, platformRefusal } from './errors.js';

export const MAX_RETRY_SECONDS = 60;

export type HttpAnswer = { status: number; json: Record<string, unknown>; headers: Headers };

async function send(ctx: Context, url: string, init: RequestInit): Promise<Response> {
  try {
    return await ctx.io.fetch(url, init);
  } catch (error) {
    throw networkError('NETWORK_ERROR', `No answer from ${new URL(url).host}: ${(error as Error).message}`, { host: new URL(url).host });
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

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : { value };
  } catch { return { raw: text.slice(0, 500) }; }
}

/** A POST to the agents host ([base]: `https://agents…/v1`), its answer whatever its status. */
export async function agentsPost(ctx: Context, base: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<HttpAnswer> {
  const res = await request(ctx, `${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await bodyOf(res), headers: res.headers };
}

/** The codes of the agents host that mean "sign in again" (exit 3). */
const SESSION_CODES = new Set(['SESSION_EXPIRED']);

/** The refusal of an answer of the agents host: its `error.code` (agent-sign-in.md § Refusals), else the HTTP status. */
export function agentsRefusal(answer: HttpAnswer): CliError {
  const error = (answer.json.error ?? {}) as { code?: string; message?: string };
  if (answer.status === 429) return platformRefusal('TOO_MANY_REQUESTS', 'The agents host is throttled: try again a few seconds later', { status: 429 });
  if (answer.status >= 500) return networkError('SERVER_ERROR', `The agents host answered ${answer.status}`, { status: answer.status }, 'platform');
  const code = error.code ?? `HTTP_${answer.status}`;
  const refusal = platformRefusal(code, error.message ?? `The agents host answered ${answer.status}`, { status: answer.status });
  return SESSION_CODES.has(code) ? new CliError(code, refusal.message, EXIT.NETWORK, refusal.details, 'platform') : refusal;
}

/** An answer of the agents host that must be [ok] (200 by default), its body; its refusal otherwise. */
export function expectOk(answer: HttpAnswer, ok: readonly number[] = [200]): Record<string, unknown> {
  if (!ok.includes(answer.status)) throw agentsRefusal(answer);
  return answer.json;
}

export type GraphqlError = { errorType?: string; message?: string; errorInfo?: unknown; path?: unknown };

/** Whether a GraphQL refusal is the one of a token refused (the session ended, the agent suspended…): sign in again. */
export const isUnauthorized = (error: unknown) => error instanceof CliError && error.code === 'Unauthorized';

/**
 * A GraphQL request to [url] with [token] (Authorization as is): its data, or the refusal of its first
 * error (`errorType`, contracts/errors.md, with its errorInfo). A token refused (HTTP 401, or
 * Unauthorized) is the code "Unauthorized".
 */
export async function graphql<T = Record<string, unknown>>(ctx: Context, url: string, token: string, query: string, variables: Record<string, unknown> = {}, retried = false): Promise<T> {
  const res = await request(ctx, url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization: token }, body: JSON.stringify({ query, variables }) });
  const body = await bodyOf(res) as { data?: T; errors?: GraphqlError[] };
  const first = body.errors?.[0];
  if (res.status === 401 || res.status === 403 || /^Unauthorized/.test(first?.errorType ?? '')) {
    throw platformRefusal('Unauthorized', first?.message ?? 'The token is refused', { status: res.status });
  }
  if (res.status >= 500 && !first) throw networkError('SERVER_ERROR', `The API answered ${res.status}`, { status: res.status }, 'platform');
  if (first) {
    const code = first.errorType ?? 'GRAPHQL_ERROR';
    const info = (first.errorInfo ?? undefined) as { retryAt?: string } | undefined;
    if (code === 'RATE_LIMITED' && !retried && info?.retryAt) {
      const wait = Math.ceil((Date.parse(info.retryAt) - ctx.now()) / 1000);
      if (Number.isFinite(wait) && wait <= MAX_RETRY_SECONDS) {
        ctx.progress(`Rate limited: trying again in ${Math.max(0, wait)} s`);
        await ctx.io.sleep(Math.max(0, wait) * 1000);
        return graphql<T>(ctx, url, token, query, variables, true);
      }
    }
    throw platformRefusal(code, first.message ?? code, { ...(first.errorInfo ? { errorInfo: first.errorInfo } : {}), ...(first.path ? { path: first.path } : {}) });
  }
  if (!res.ok) throw platformRefusal(`HTTP_${res.status}`, `The API answered ${res.status}`, { status: res.status });
  return (body.data ?? {}) as T;
}
