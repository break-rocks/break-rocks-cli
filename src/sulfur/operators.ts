// An agent operator's REST routes on native-sulfur (server src/features/billing/operators.ts, D-651): one POST to the cell's API
// host (`/v1/operators/*`, JSON, `x-amz-content-sha256`), each proved by a JWT signed with a key of the operator — `EdDSA`,
// `kid` the SHA-256 (hex) of its raw public key, `iss` = `sub` = the operator's id (`registration` before it has one), `aud`
// the route's exact URL on the cell's domain, `iat`, `exp` within 5 minutes, a `jti` used once — instead of the former
// backend's signed challenges. The registration and the renewal are paid with x402 (402, then PAYMENT-SIGNATURE). Ed25519
// keys only (D-542: ML-DSA-65 is not accepted yet). A refusal is `{ error: { code, message } }` with its HTTP status.
import { createPublicKey, randomUUID, sign, type KeyObject } from 'node:crypto';
import type { Context } from '../context.js';
import type { Environment } from '../config.js';
import { CliError, EXIT, networkError, platformRefusal } from '../errors.js';
import { apiRequest, type HttpAnswer } from '../transport.js';
import { keyIdOf, IAT_BACKDATE_SECONDS } from './agent.js';
import { sha256Hex, SULFUR_SITES, sulfurBase } from './http.js';

/** The life of a proof (the server takes 5 minutes at most). */
export const PROOF_SECONDS = 120;

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url');

/** The cell of an account or registration id (`eu_…`). */
export const cellOfId = (id: string | undefined) => (id && /^[a-z]{2}_/.test(id) ? id.slice(0, 2) : undefined);

/**
 * The base of the proofs' audience: the cell's API host on its domain, whatever host is reached (BREAKROCKS_SULFUR_URL);
 * BREAKROCKS_SULFUR_AUDIENCE replaces it (a sandbox whose server names another base).
 */
export const audienceBase = (ctx: Context, env: Environment, cell: string) => (ctx.env.BREAKROCKS_SULFUR_AUDIENCE?.trim() || `https://${cell}.api.${SULFUR_SITES[env]}`).replace(/\/+$/, '');

/** A proof signed with [key] for [issuer] and the route [path] (its claims beside: rk, npk, nrk). */
export function proofOf(ctx: Context, key: KeyObject, issuer: string, audience: string, claims: Record<string, string> = {}): string {
  const now = Math.floor(ctx.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: keyIdOf(key) }));
  const payload = b64url(JSON.stringify({ iss: issuer, sub: issuer, aud: audience, iat: now - IAT_BACKDATE_SECONDS, exp: now + PROOF_SECONDS, jti: randomUUID(), ...claims }));
  return `${header}.${payload}.${b64url(sign(null, Buffer.from(`${header}.${payload}`), key))}`;
}

/** The SHA-256 (hex) of a key's raw Ed25519 public key: what the server names a key by. */
export const fingerprintOfKey = (key: KeyObject) => keyIdOf(key);

/** A key's public half as SPKI PEM (what the routes take). */
export const publicPem = (key: KeyObject) => createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();

/** A POST to an operator route of the cell: its answer whatever its status, headers included (402, PAYMENT-RESPONSE). */
export async function operatorsPost(ctx: Context, env: Environment, cell: string, path: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<HttpAnswer> {
  const text = JSON.stringify(body);
  const res = await apiRequest(ctx, `${sulfurBase(ctx, env, cell)}${path}`, {
    method: 'POST', body: text,
    headers: { 'content-type': 'application/json', accept: 'application/json', 'x-amz-content-sha256': sha256Hex(text), ...headers },
  });
  let json: Record<string, unknown> = {};
  const raw = await res.text();
  if (raw) { try { const v = JSON.parse(raw) as unknown; json = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : { value: v }; } catch { json = { raw: raw.slice(0, 300) }; } }
  return { status: res.status, json, headers: res.headers };
}

/** The refusal of an operator route: its code and message, the status kept; a 5xx without a code is the network's. */
export function operatorsRefusal(answer: HttpAnswer, what: string): CliError {
  const e = answer.json.error as { code?: string; message?: string } | undefined;
  if (!e?.code) {
    if (answer.status >= 500) return networkError('SERVER_ERROR', `${what}: native-sulfur answered ${answer.status}`, { status: answer.status }, 'platform');
    if (answer.status === 403) return networkError('FORBIDDEN', `${what}: native-sulfur refused the request (403; its edge or its origin access)`, { status: 403 }, 'platform');
    return platformRefusal(`HTTP_${answer.status}`, `${what}: native-sulfur answered ${answer.status}`, { status: answer.status });
  }
  // The payment being confirmed (503 PAYMENT_PENDING): try again later, nothing charged twice.
  if (e.code === 'PAYMENT_PENDING') return new CliError(e.code, `${what}: ${e.message ?? e.code}`, EXIT.NETWORK, { status: answer.status }, 'platform');
  const extra = Object.fromEntries(Object.entries(answer.json).filter(([k]) => k !== 'error'));
  return platformRefusal(e.code, `${what}: ${e.message && e.message !== e.code ? e.message : e.code}`, { status: answer.status, ...extra });
}

/** The answer of a route that must succeed ([ok] statuses), its body. */
export function expectOperatorsOk(answer: HttpAnswer, what: string, ok: readonly number[] = [200]): Record<string, unknown> {
  if (!ok.includes(answer.status)) throw operatorsRefusal(answer, what);
  return answer.json;
}
