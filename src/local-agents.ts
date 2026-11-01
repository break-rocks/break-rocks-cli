// Local agents (D-235): the delegated agents kept on this device, each in agents/<name>/agent.json
// (operator id, agent id, environment, cell, when created, where its key is) with its private key in
// the system keychain, or in agents/<name>/key.pem (0600) without one. A key is never printed; the
// keychain holds it under the account "agent:<agent id>".
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigStore, Environment, Profile } from './config.js';
import { PROFILE_NAME, readJson, writePrivate } from './config.js';
import type { Context } from './context.js';
import { cliRefusal, usageError } from './errors.js';
import { privateKeyFrom } from './keys.js';
import { systemKeychain, type Keychain } from './keychain.js';

export type KeyStorage = 'keychain' | 'file';
export type LocalAgent = {
  name: string; operatorId: string; agentId: string; env: Environment; cell?: string; createdAt: string;
  /** Where its private key is: the system keychain, or a file (its path). */
  keyStorage: KeyStorage; keyFile?: string; keychain?: string;
};

export const keychainAccount = (agentId: string) => `agent:${agentId}`;
export const keychainOf = (ctx: Context): Keychain => ctx.io.keychain ?? systemKeychain(ctx.env);

/** A local agent's name: a profile name (letters, digits, ".", "_", "-"), checked (AGENT_NAME_INVALID). */
export function checkLocalName(name: string): string {
  if (!PROFILE_NAME.test(name)) throw usageError('AGENT_NAME_INVALID', `A local agent name has 1 to 64 letters, digits, ".", "_" or "-", beginning with a letter or a digit: give --local-name for "${name}"`, { name });
  return name;
}

const fileOf = (store: ConfigStore, name: string) => join(store.agentDir(name), 'agent.json');

export function readLocalAgent(store: ConfigStore, name: string): LocalAgent | undefined {
  const agent = readJson<LocalAgent>(fileOf(store, name));
  return agent && agent.agentId ? { ...agent, name } : undefined;
}

export function localAgents(store: ConfigStore): LocalAgent[] {
  if (!existsSync(store.agentsDir())) return [];
  return readdirSync(store.agentsDir()).sort().map((name) => readLocalAgent(store, name)).filter((a): a is LocalAgent => !!a);
}

/** The local agent named [name], else LOCAL_AGENT_NOT_FOUND (exit 2). */
export function requireLocalAgent(store: ConfigStore, name: string): LocalAgent {
  const agent = readLocalAgent(store, name);
  if (!agent) throw usageError('LOCAL_AGENT_NOT_FOUND', `No local agent "${name}" on this device: breakrocks agents local lists them`, { agent: name });
  return agent;
}

/**
 * Keeps [pem] for a local agent: in the keychain when it takes it, else in agents/<name>/key.pem
 * (0600); [file]: the key stays in this file (agents create --out). Writes agent.json.
 */
export function saveLocalAgent(ctx: Context, agent: Omit<LocalAgent, 'keyStorage' | 'keyFile' | 'keychain'>, pem: string, file?: string): LocalAgent {
  const keychain = keychainOf(ctx);
  let stored: LocalAgent;
  if (file) stored = { ...agent, keyStorage: 'file', keyFile: file };
  else if (keychain.available() && keychain.set(keychainAccount(agent.agentId), pem)) {
    stored = { ...agent, keyStorage: 'keychain', keychain: keychain.name };
    rmSync(join(ctx.store.agentDir(agent.name), 'key.pem'), { force: true });
  } else {
    const keyFile = join(ctx.store.agentDir(agent.name), 'key.pem');
    writePrivate(keyFile, pem.endsWith('\n') ? pem : `${pem}\n`);
    stored = { ...agent, keyStorage: 'file', keyFile };
  }
  const { name: _name, ...json } = stored;
  writePrivate(fileOf(ctx.store, agent.name), `${JSON.stringify(json, null, 2)}\n`);
  return stored;
}

/** The PEM of a local agent's key (KEY_MISSING when it is no longer where agent.json says). */
export function localAgentKey(ctx: Context, agent: LocalAgent) {
  let pem: string | undefined;
  if (agent.keyStorage === 'keychain') pem = keychainOf(ctx).get(keychainAccount(agent.agentId));
  else if (agent.keyFile && existsSync(agent.keyFile)) pem = readFileSync(agent.keyFile, 'utf8');
  if (!pem) throw cliRefusal('KEY_MISSING', `The private key of the local agent "${agent.name}" is not in ${agent.keyStorage === 'keychain' ? 'the system keychain' : agent.keyFile}: breakrocks agents import ${agent.name} …, or agents regenerate`, { agent: agent.name });
  return privateKeyFrom(pem, `The key of the local agent "${agent.name}"`).key;
}

/** Removes a local agent from this device: agent.json, its key file of the folder, its keychain entry. */
export function forgetLocalAgent(ctx: Context, agent: LocalAgent): { keyRemoved: boolean } {
  let keyRemoved = false;
  if (agent.keyStorage === 'keychain') keyRemoved = keychainOf(ctx).delete(keychainAccount(agent.agentId));
  rmSync(ctx.store.agentDir(agent.name), { recursive: true, force: true });
  if (agent.keyStorage === 'file') keyRemoved = !!agent.keyFile?.startsWith(ctx.store.agentDir(agent.name));
  return { keyRemoved };
}

/** The profile of a local agent, as the rest of the CLI sees one. */
export const profileOfAgent = (agent: LocalAgent): Profile => ({ env: agent.env, ...(agent.cell ? { cell: agent.cell } : {}), kind: 'agent', operatorId: agent.operatorId, agentId: agent.agentId, localAgent: agent.name });

/** The name under which a local agent's session and cache are kept (sessions/agent.<name>.json). */
export const sessionNameOf = (name: string) => `agent.${name}`;
