// The transport of the new backend (native-sulfur, client port plan § GraphQL transport): one host per cell
// (`<cell>.api.<site>`) serving `/graphql`, `/auth/*` and `/oauth/*` behind CloudFront with origin access control, so every
// POST carries `x-amz-content-sha256` (the SHA-256 of the exact bytes sent) and the token travels in `x-authorization`
// (the function URL's own `Authorization` is CloudFront's signature). BREAKROCKS_SULFUR_URL replaces the host (a cell not
// on its custom domain yet: its CloudFront address). Refusals: GraphQL `errors[0].extensions {code, reason}`, the
// reason being the contract's code; OAuth `{error, error_description}`.
import { createHash } from 'node:crypto';
import type { Context } from '../context.js';
import type { Environment } from '../config.js';
import { CliError, EXIT, networkError, platformRefusal, refusalText } from '../errors.js';
import { apiRequest } from '../transport.js';

/** The web site of an environment: the cells' API hosts live under it (`{cell}.api.{site}`, server config/cells.json). */
export const SULFUR_SITES: Record<Environment, string> = { dev: 'dev.break.rocks', staging: 'staging.break.rocks', prod: 'break.rocks' };
/** The cell a sign-in starts from when nothing names one (the one cell at the opening). */
export const SULFUR_DEFAULT_CELL = 'eu';

/** The base address of [cell] in [env] (no trailing slash). */
export function sulfurBase(ctx: Context, env: Environment, cell: string = SULFUR_DEFAULT_CELL): string {
  const override = ctx.env.BREAKROCKS_SULFUR_URL?.trim();
  if (override) return override.replace(/\/+$/, '');
  return `https://${cell}.api.${SULFUR_SITES[env]}`;
}

export const sha256Hex = (body: string) => createHash('sha256').update(body, 'utf8').digest('hex');

export type SulfurAnswer = { status: number; json: Record<string, unknown> };

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : { value: v };
  } catch { return { raw: text.slice(0, 300) }; }
}

/** A POST to the new backend: JSON, or a form for `/oauth/*` ([form]); its answer whatever its status. */
export async function sulfurPost(ctx: Context, base: string, path: string, payload: Record<string, string | undefined> | Record<string, unknown>, options: { form?: boolean; token?: string } = {}): Promise<SulfurAnswer> {
  const body = options.form
    ? new URLSearchParams(Object.entries(payload).filter((e): e is [string, string] => typeof e[1] === 'string')).toString()
    : JSON.stringify(payload);
  const res = await apiRequest(ctx, `${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': options.form ? 'application/x-www-form-urlencoded' : 'application/json',
      accept: 'application/json',
      'x-amz-content-sha256': sha256Hex(body),
      ...(options.token ? { 'x-authorization': `Bearer ${options.token}` } : {}),
    },
    body,
  });
  return { status: res.status, json: await bodyOf(res) };
}

/** The refusal of an auth answer (`/auth/*`: GraphQL-like errors or `{error}`; `/oauth/*`: RFC 6749 errors). */
export function authRefusal(answer: SulfurAnswer, what: string): CliError {
  const j = answer.json as { error?: unknown; error_description?: string; errors?: { message?: string; extensions?: { code?: string; reason?: string } }[]; code?: string; reason?: string; message?: string };
  if (answer.status === 429) return platformRefusal('TOO_MANY_REQUESTS', `${what}: too many requests, try again later`, { status: 429 });
  const e = j.errors?.[0];
  const code = e?.extensions?.reason ?? e?.extensions?.code ?? j.reason ?? (typeof j.error === 'string' ? (j.error_description && /^[A-Z_]+$/.test(j.error_description) ? j.error_description : j.error) : undefined) ?? j.code;
  if (answer.status >= 500 && !code) return networkError('SERVER_ERROR', `${what}: the new backend answered ${answer.status}`, { status: answer.status }, 'platform');
  if (answer.status === 403 && !code) return networkError('FORBIDDEN', `${what}: the new backend refused the request (403; its edge or its origin access)`, { status: 403 }, 'platform');
  return platformRefusal(code ?? `HTTP_${answer.status}`, `${what}: ${e?.message ?? j.message ?? j.error_description ?? code ?? `HTTP ${answer.status}`}`, { status: answer.status });
}

/** The answer of an auth call that must succeed (2xx), its body. */
export function expectAuthOk(answer: SulfurAnswer, what: string): Record<string, unknown> {
  if (answer.status < 200 || answer.status >= 300) throw authRefusal(answer, what);
  return answer.json;
}

/** A GraphQL error of the new backend. */
type GqlError = { message?: string; extensions?: { code?: string; reason?: string; errorInfo?: unknown } };

/** A token refused by the API: the caller renews it once and tries again. */
export const isTokenRefused = (e: unknown) => e instanceof CliError && e.code === 'TOKEN_REFUSED';

/**
 * A GraphQL request with [token]: its data, or the refusal of its first error (the reason, the contract's code, before the
 * kind). 401 is TOKEN_REFUSED (the session renewed by the caller), a 403 CREDENTIAL_ACT_REQUIRES_HUMAN or INSUFFICIENT_SCOPE
 * says what the session may not do.
 */
export async function sulfurGraphql<T>(ctx: Context, base: string, token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const answer = await sulfurPost(ctx, base, '/graphql', { query, variables }, { token });
  const body = answer.json as { data?: T; errors?: GqlError[] };
  const first = body.errors?.[0];
  if (answer.status === 401) throw new CliError('TOKEN_REFUSED', first?.message ?? 'The access token is refused', EXIT.NETWORK, {}, 'platform');
  if (first) {
    const code = first.extensions?.reason ?? first.extensions?.code ?? 'GRAPHQL_ERROR';
    if (code === 'CREDENTIAL_ACT_REQUIRES_HUMAN') throw platformRefusal(code, 'This session may not do that (a device-code session reaches content only): sign in with the email code (login --email) for account changes');
    // The facts of the refusal (`extensions.errorInfo`: a bound, a date…) kept for --json, and told when they say more (D-659).
    const errorInfo = first.extensions?.errorInfo;
    throw platformRefusal(code, refusalText(code, first.message && first.message !== code ? first.message : code, errorInfo), { ...(first.extensions?.code ? { kind: first.extensions.code } : {}), ...(errorInfo ? { errorInfo } : {}) });
  }
  if (answer.status >= 500) throw networkError('SERVER_ERROR', `The new backend answered ${answer.status}`, { status: answer.status }, 'platform');
  if (answer.status >= 400) throw authRefusal(answer, 'The API');
  return (body.data ?? {}) as T;
}
