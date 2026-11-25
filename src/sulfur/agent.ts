// A delegated agent (or an agent operator) signing in on the new backend (native-sulfur, server src/core/auth/grants.ts):
// RFC 7523, a JWT assertion signed with its Ed25519 private key (header `alg: EdDSA`, `kid`: the SHA-256, hex, of its raw
// public key; claims `iss` = `sub` = its account id, `aud` = the cell's token endpoint, `iat`, `exp` within 5 minutes, a
// `jti` used once) exchanged at `/oauth/token` (`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`) for an access token
// acting for its owner, without a refresh token: a new assertion renews it. Its credentials are the CLI's own (a local agent,
// `--agent`, or BREAKROCKS_OPERATOR_ID, BREAKROCKS_AGENT_ID and BREAKROCKS_AGENT_KEY): the private key never leaves the
// device, the token is kept as a session of the new backend (src/sulfur/session.ts), never printed.
import { createHash, randomUUID, sign, type KeyObject, createPublicKey } from 'node:crypto';
import type { Context } from '../context.js';
import type { Environment } from '../config.js';
import { credentialsOf } from '../session.js';
import { authRefusal, SULFUR_SITES, sulfurBase, sulfurGraphql, sulfurPost } from './http.js';
import { sessionFromTokens, saveSulfurSession, type SulfurSession } from './session.js';

export const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
/** The life of an assertion (the server takes 5 minutes at most). */
export const ASSERTION_SECONDS = 120;

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url');

/** The `kid` of a key: the SHA-256 (hex) of its raw Ed25519 public key. */
export function keyIdOf(key: KeyObject): string {
  const jwk = createPublicKey(key).export({ format: 'jwk' }) as { x?: string };
  return createHash('sha256').update(Buffer.from(jwk.x ?? '', 'base64url')).digest('hex');
}

/** The assertion of [agentId] for [audience], signed with [key]. */
export function assertionOf(agentId: string, key: KeyObject, audience: string, nowMs: number): string {
  const iat = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: keyIdOf(key) }));
  const payload = b64url(JSON.stringify({ iss: agentId, sub: agentId, aud: audience, iat, exp: iat + ASSERTION_SECONDS, jti: randomUUID() }));
  const signature = sign(null, Buffer.from(`${header}.${payload}`), key);
  return `${header}.${payload}.${b64url(signature)}`;
}

/** The cell of an account id (`eu_…`). */
const cellOfId = (id: string) => (/^[a-z]{2}_/.test(id) ? id.slice(0, 2) : undefined);

/** Whether this run acts as an agent with credentials of its own (a local agent, a profile of an agent, the BREAKROCKS_* variables). */
export function agentCredentials(ctx: Context): { agentId: string; operatorId: string; key: KeyObject } | undefined {
  const c = credentialsOf(ctx, ctx.profile());
  return c ? { agentId: c.kind === 'agent' ? c.agentId : c.operatorId, operatorId: c.operatorId, key: c.key } : undefined;
}

/** Signs the agent of this run in (RFC 7523) and keeps its session. */
export async function agentSignIn(ctx: Context, creds: { agentId: string; operatorId: string; key: KeyObject }): Promise<SulfurSession> {
  const env = ctx.profile().env as Environment;
  const cell = cellOfId(creds.agentId) ?? 'eu';
  const base = sulfurBase(ctx, env, cell);
  // The audience is the cell's token endpoint on its domain (the signInUrl of the credentials), whatever host is reached.
  const audience = ctx.env.BREAKROCKS_SULFUR_TOKEN_ENDPOINT?.trim() || `https://${cell}.api.${SULFUR_SITES[env]}/oauth/token`;
  const answer = await sulfurPost(ctx, base, '/oauth/token', { grant_type: JWT_BEARER, assertion: assertionOf(creds.agentId, creds.key, audience, ctx.now()) }, { form: true });
  if (answer.status !== 200) throw authRefusal(answer, 'The agent sign-in');
  const access = String(answer.json.access_token ?? '');
  const me = (await sulfurGraphql<{ me: { id: string; card: { handle: string } } }>(ctx, base, access, '{ me { id card { handle } } }')).me;
  const session = sessionFromTokens(ctx, answer.json, { backend: 'sulfur', env, cell, accountId: me.id, handle: me.card.handle, method: 'agent', signedInAt: new Date(ctx.now()).toISOString(), kind: 'agent' });
  return saveSulfurSession(ctx, session);
}
