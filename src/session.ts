// Sessions of agent operators and delegated agents: an
// auth challenge signed with the private key, a session of 1 hour kept in the configuration folder
// (sessions/<profile>.json, 0600), renewed when it ends within 5 minutes by signing a new
// challenge with the current token in Authorization: Bearer (same sessionId). A delegated agent
// signs in with its key file, or with BREAKROCKS_OPERATOR_ID, BREAKROCKS_AGENT_ID and
// BREAKROCKS_AGENT_KEY (never printed, never stored). A token refused by the API (Unauthorized)
// signs in once more: the agents host tells why (DELEGATED_AGENT_SUSPENDED, OPERATOR_SUSPENDED…).
import type { KeyObject } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { Context } from './context.js';
import type { Profile } from './config.js';
import { readJson, writePrivate } from './config.js';
import { endpoints, type Endpoints } from './endpoints.js';
import { CliError, EXIT, cliRefusal, networkError } from './errors.js';
import { privateKeyFrom, readPrivateKey, signChallenge } from './keys.js';
import { agentsPost, expectOk, graphql, isUnauthorized } from './transport.js';

/** A session is renewed when it ends within 5 minutes. */
export const RENEW_BEFORE_MS = 5 * 60 * 1000;

export type Session = {
  kind: 'operator' | 'agent';
  token: string;
  sessionId: string;
  expiresAt: string;
  operatorId: string;
  agentId?: string;
  recoveryKeyRequired?: boolean;
  /** Where the agent's key came from: its file or the environment (agents only). */
  keySource?: 'file' | 'env';
};

/** What signs in the profile: the operator's key, or a delegated agent's (its file, or the BREAKROCKS_* variables). */
export type Credentials =
  | { kind: 'operator'; operatorId: string; key: KeyObject }
  | { kind: 'agent'; operatorId: string; agentId: string; key: KeyObject; source: 'file' | 'env' };

/** The delegated agent of the BREAKROCKS_* variables, when all three are set. */
export function agentFromEnv(env: NodeJS.ProcessEnv): Credentials | undefined {
  const operatorId = env.BREAKROCKS_OPERATOR_ID?.trim(), agentId = env.BREAKROCKS_AGENT_ID?.trim(), pem = env.BREAKROCKS_AGENT_KEY;
  if (!operatorId || !agentId || !pem) return undefined;
  const { key } = privateKeyFrom(pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem, 'BREAKROCKS_AGENT_KEY');
  return { kind: 'agent', operatorId, agentId, key, source: 'env' };
}

/** The credentials of [profile]: the BREAKROCKS_* variables first (explicit for this process), then the profile's key files. */
export function credentialsOf(ctx: Context, profile: Profile): Credentials | undefined {
  const fromEnv = agentFromEnv(ctx.env);
  if (fromEnv) return fromEnv;
  if (profile.kind === 'operator' && profile.operatorId && profile.keys?.operator) {
    return { kind: 'operator', operatorId: profile.operatorId, key: readPrivateKey(profile.keys.operator, 'The operator key').key };
  }
  if (profile.kind === 'agent' && profile.operatorId && profile.agentId && profile.keys?.agent) {
    return { kind: 'agent', operatorId: profile.operatorId, agentId: profile.agentId, key: readPrivateKey(profile.keys.agent, 'The agent key').key, source: 'file' };
  }
  return undefined;
}

export const readSession = (ctx: Context): Session | undefined => readJson<Session>(ctx.store.sessionFile(ctx.profileName));
export const saveSession = (ctx: Context, session: Session) => writePrivate(ctx.store.sessionFile(ctx.profileName), `${JSON.stringify(session, null, 2)}\n`);
export const forgetSession = (ctx: Context) => rmSync(ctx.store.sessionFile(ctx.profileName), { force: true });

const sameActor = (s: Session, c: Credentials) => s.kind === c.kind && s.operatorId === c.operatorId && (c.kind === 'operator' || s.agentId === c.agentId);

/** Signs in with [credentials] (a new session, or the renewal of [current]); the session saved. */
export async function signIn(ctx: Context, at: Endpoints, credentials: Credentials, current?: Session): Promise<Session> {
  const renew = current && sameActor(current, credentials) && Date.parse(current.expiresAt) > ctx.now() ? { authorization: `Bearer ${current.token}` } : undefined;
  const isAgent = credentials.kind === 'agent';
  const prefix = isAgent ? '/delegated-agents' : '/operators';
  const challenge = expectOk(await agentsPost(ctx, at.agents, `${prefix}/challenges`, isAgent ? { operatorId: credentials.operatorId, agentId: credentials.agentId } : { operatorId: credentials.operatorId })) as { challengeId: string; challenge: string };
  let answer = await agentsPost(ctx, at.agents, `${prefix}/sessions`, { challengeId: challenge.challengeId, signature: signChallenge(challenge.challenge, credentials.key) }, renew);
  if (renew && answer.status === 401 && (answer.json.error as { code?: string } | undefined)?.code === 'SESSION_EXPIRED') {
    // The session to renew ended meanwhile: a new one.
    const again = expectOk(await agentsPost(ctx, at.agents, `${prefix}/challenges`, isAgent ? { operatorId: credentials.operatorId, agentId: credentials.agentId } : { operatorId: credentials.operatorId })) as { challengeId: string; challenge: string };
    answer = await agentsPost(ctx, at.agents, `${prefix}/sessions`, { challengeId: again.challengeId, signature: signChallenge(again.challenge, credentials.key) });
  }
  const body = expectOk(answer) as { token: string; sessionId: string; expiresAt: string; recoveryKeyRequired?: boolean };
  const session: Session = {
    kind: credentials.kind, token: body.token, sessionId: body.sessionId, expiresAt: body.expiresAt, operatorId: credentials.operatorId,
    ...(isAgent ? { agentId: credentials.agentId, keySource: credentials.source } : {}),
    ...(body.recoveryKeyRequired ? { recoveryKeyRequired: true } : {}),
  };
  saveSession(ctx, session);
  return session;
}

/**
 * The session of the profile, opened or renewed when needed: kept while it ends in more than 5
 * minutes; renewed (or opened) with the profile's credentials otherwise. Without credentials, a
 * session still open is used until it ends; then SIGN_IN_REQUIRED (exit 3). [renew]: renew it now
 * (same session); [fresh]: open a new one (the token was refused).
 */
export async function ensureSession(ctx: Context, options: { renew?: boolean; fresh?: boolean } = {}): Promise<{ session: Session; at: Endpoints }> {
  const profile = ctx.profile();
  const credentials = credentialsOf(ctx, profile);
  const current = readSession(ctx);
  const usable = current && (!credentials || sameActor(current, credentials)) ? current : undefined;
  const left = usable ? Date.parse(usable.expiresAt) - ctx.now() : -1;
  const force = options.renew || options.fresh;
  if (!credentials && !(usable && left > 0 && !force)) {
    throw networkError('SIGN_IN_REQUIRED', profile.kind
      ? `The session of the profile "${ctx.profileName}" ended and its key is not here: sign in again`
      : `The profile "${ctx.profileName}" has no account: breakrocks operator register, or breakrocks agent login`, { profile: ctx.profileName });
  }
  const at = await endpoints(ctx, { ...profile, operatorId: profile.operatorId ?? credentials?.operatorId });
  if (usable && ((!force && left > RENEW_BEFORE_MS) || !credentials)) return { session: usable, at };
  if (!credentials) throw new Error('unreachable');
  return { session: await signIn(ctx, at, credentials, options.fresh ? undefined : usable), at };
}

/**
 * A GraphQL request with the session of the profile; a token refused (Unauthorized) signs in once
 * more and tries again, and the sign-in tells why when it is refused.
 */
export async function api<T = Record<string, unknown>>(ctx: Context, query: string, variables: Record<string, unknown> = {}, options: { partial?: boolean } = {}): Promise<T> {
  const { session, at } = await ensureSession(ctx);
  try {
    return await graphql<T>(ctx, at.api, session.token, query, variables, false, !!options.partial);
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
    let fresh: Session;
    try {
      fresh = (await ensureSession(ctx, { fresh: true })).session;
    } catch (signInError) {
      if (signInError instanceof CliError && signInError.code === 'SIGN_IN_REQUIRED') throw new CliError('SESSION_EXPIRED', 'The session was refused and cannot be opened again here: sign in again', EXIT.NETWORK, {}, 'platform');
      throw signInError;
    }
    return graphql<T>(ctx, at.api, fresh.token, query, variables, false, !!options.partial);
  }
}

/** The session of the profile must be an operator's (a delegated agent cannot manage agents; said before calling). */
export function requireOperator(ctx: Context): void {
  const fromEnv = agentFromEnv(ctx.env);
  const profile = ctx.profile();
  if (fromEnv || profile.kind === 'agent') {
    throw cliRefusal('DELEGATED_AGENT_CANNOT_MANAGE_AGENTS', 'A delegated agent cannot manage delegated agents nor its operator: use the profile of the operator', { profile: ctx.profileName });
  }
}
