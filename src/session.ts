// Who acts and the GraphQL requests of the commands. The sessions themselves are native-sulfur's (src/sulfur/session.ts: a
// person's tokens, or an agent's access token from an assertion signed with its key, src/sulfur/agent.ts); the former
// backend's (Cognito, the agents host) were retired with it on 2026-11-28. What signs an agent in: the operator's key, or a
// delegated agent's (its file, or BREAKROCKS_OPERATOR_ID, BREAKROCKS_AGENT_ID and BREAKROCKS_AGENT_KEY: never printed,
// never stored).
import type { KeyObject } from 'node:crypto';
import type { Context } from './context.js';
import type { Profile } from './config.js';
import { cliRefusal } from './errors.js';
import { privateKeyFrom, readPrivateKey } from './keys.js';
import { localAgentKey, requireLocalAgent } from './local-agents.js';
import { readSulfurSession, sulfurActorOf } from './sulfur/session.js';
import { sulfurTalc } from './sulfur/talc.js';

/** What signs in the profile: the operator's key, or a delegated agent's (its file, or the BREAKROCKS_* variables). */
export type Credentials =
  | { kind: 'operator'; operatorId: string; key: KeyObject }
  | { kind: 'agent'; operatorId: string; agentId: string; key: KeyObject; source: 'file' | 'env' | 'keychain' };

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
  if (profile.localAgent) {
    const agent = requireLocalAgent(ctx.store, profile.localAgent);
    return { kind: 'agent', operatorId: agent.operatorId, agentId: agent.agentId, key: localAgentKey(ctx, agent), source: agent.keyStorage };
  }
  if (profile.kind === 'operator' && profile.operatorId && profile.keys?.operator) {
    return { kind: 'operator', operatorId: profile.operatorId, key: readPrivateKey(profile.keys.operator, 'The operator key').key };
  }
  if (profile.kind === 'agent' && profile.operatorId && profile.agentId && profile.keys?.agent) {
    return { kind: 'agent', operatorId: profile.operatorId, agentId: profile.agentId, key: readPrivateKey(profile.keys.agent, 'The agent key').key, source: 'file' };
  }
  return undefined;
}

/** The kind of account the profile's session acts as (an agent operator, a delegated agent, a person), or none. */
export function sessionKind(ctx: Context): 'human' | 'operator' | 'agent' | undefined {
  const s = readSulfurSession(ctx);
  if (!s) return undefined;
  const { actor } = sulfurActorOf(s);
  return actor === 'delegated-agent' ? 'agent' : actor;
}

/**
 * A GraphQL request of a command (API v2, under the operation names native-sulfur serves them: D-612) with the session of
 * the profile, through the seam of src/sulfur/talc.ts: sent as is where the server serves the operation, adapted where it
 * deviates, NOT_AVAILABLE otherwise.
 */
export function api<T = Record<string, unknown>>(ctx: Context, query: string, variables: Record<string, unknown> = {}, options: { partial?: boolean } = {}): Promise<T> {
  return sulfurTalc<T>(ctx, query, variables, options);
}

/** The session of the profile must be an operator's (a delegated agent cannot manage agents; said before calling). */
export function requireOperator(ctx: Context): void {
  const fromEnv = agentFromEnv(ctx.env);
  const profile = ctx.profile();
  if (fromEnv || profile.kind === 'agent') {
    throw cliRefusal('DELEGATED_AGENT_CANNOT_MANAGE_AGENTS', 'A delegated agent cannot manage delegated agents nor its operator: use the profile of the operator', { profile: ctx.profileName });
  }
}
