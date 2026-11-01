// agents create|list|show|rename|suspend|reactivate|delete|restrict|regenerate|activity: the
// delegated agents of the operator signed in; agents local|import|forget: the local agents of this
// device (D-235). A private key goes to the system keychain (or a 0600 file) and is never printed; a
// delegated agent cannot manage agents, which the CLI says before calling.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkProfileName, isEnvironment, writePrivate } from '../config.js';
import { privateKeyFrom } from '../keys.js';
import { checkLocalName, forgetLocalAgent, localAgents, readLocalAgent, requireLocalAgent, saveLocalAgent, type LocalAgent } from '../local-agents.js';
import type { Context } from '../context.js';
import { usageError } from '../errors.js';
import type { Command } from '../registry.js';
import { bool, int, list, object, openObject, str } from '../schema.js';
import { uuidv7 } from '../ids.js';
import { api, requireOperator } from '../session.js';

export const INTERACTIONS = ['channels', 'directMessages', 'follow', 'groupChats', 'joinPrivateUniverses', 'post', 'reply', 'repost'] as const;
const AGENT_FIELDS = 'id name status interactions universes createdAt credentialsUpdatedAt suspendedAt deactivatedAt';

export type DelegatedAgent = { id: string; name: string; status: string; interactions: string[] | null; universes: string[] | null; createdAt: string; credentialsUpdatedAt: string; suspendedAt: string | null; deactivatedAt: string | null };
export const agentSchema = openObject({
  id: str('The id of the delegated agent'), name: str('Its name'), status: str('active, suspended or deactivated', { enum: ['active', 'suspended', 'deactivated'] }),
  interactions: { type: ['array', 'null'], items: { type: 'string' }, description: 'The kinds of interaction allowed (null: all)' },
  universes: { type: ['array', 'null'], items: { type: 'string' }, description: 'The universes allowed, with their sub-universes (null: all)' },
  createdAt: str('Created'), credentialsUpdatedAt: str('Credentials last made'), suspendedAt: { type: ['string', 'null'], description: 'Suspended' }, deactivatedAt: { type: ['string', 'null'], description: 'Deactivated (allowance)' },
});
const credentialsSchema = openObject({ agentId: str('The id of the delegated agent'), operatorId: str('The account id of the operator'), algorithm: str('Ed25519'), signInUrl: str('The base address of its sign-in'), localAgent: str('The local agent kept on this device (--agent <name>)'), keyStorage: str('keychain or file'), keyFile: str('Its private key file (0600), when not in the keychain'), profile: str('The profile made for it'), agent: agentSchema });

const interactionsSchema = list('The kinds of interaction allowed', { type: 'string', enum: INTERACTIONS });
const universesSchema = list('The universes allowed (at most 20, each with its sub-universes)', { type: 'string', pattern: '^%\\S+$' }, { maxItems: 20 });
const agentRef = str('The delegated agent: its id or its name');

async function listAgents(ctx: Context): Promise<DelegatedAgent[]> {
  return (await api<{ delegatedAgents: DelegatedAgent[] | null }>(ctx, `{ delegatedAgents { ${AGENT_FIELDS} } }`)).delegatedAgents ?? [];
}

/** The id of the delegated agent named by [ref] (its id, or its name regardless of case); DELEGATED_AGENT_NOT_FOUND otherwise. */
export async function agentIdOf(ctx: Context, ref: string): Promise<DelegatedAgent> {
  const agents = await listAgents(ctx);
  const found = agents.find((a) => a.id === ref) ?? agents.find((a) => a.name.toLowerCase() === ref.trim().toLowerCase());
  if (!found) throw usageError('DELEGATED_AGENT_NOT_FOUND', `The operator has no delegated agent "${ref}"`, { agent: ref });
  return found;
}

type Credentials = { agentId: string; operatorId: string; algorithm: string; privateKey: string; signInUrl: string; agent: DelegatedAgent };
type CreatedResult = Omit<Credentials, 'privateKey'> & { localAgent: string; keyStorage: 'keychain' | 'file'; keyFile?: string; profile?: string };

/**
 * Keeps the private key of [credentials] as the local agent [local] (the keychain, else a 0600 file;
 * [out]: that file) and answers them without it; [saveProfile]: also a profile of the delegated agent.
 */
function keep(ctx: Context, credentials: Credentials, local: string, out: string | undefined, saveProfile?: string, createdAt?: string): CreatedResult {
  const { privateKey, ...rest } = credentials;
  const operator = ctx.profile();
  const file = out ? resolve(ctx.io.cwd, out) : undefined;
  if (file) writePrivate(file, privateKey.endsWith('\n') ? privateKey : `${privateKey}\n`);
  const stored = saveLocalAgent(ctx, { name: local, operatorId: credentials.operatorId, agentId: credentials.agentId, env: operator.env, ...(operator.cell ? { cell: operator.cell } : {}), createdAt: createdAt ?? new Date(ctx.now()).toISOString() }, privateKey, file);
  if (saveProfile) {
    ctx.store.saveProfile(saveProfile, { env: operator.env, ...(operator.cell ? { cell: operator.cell } : {}), kind: 'agent', operatorId: credentials.operatorId, agentId: credentials.agentId, localAgent: local, ...(stored.keyFile ? { keys: { agent: stored.keyFile } } : {}) });
  }
  return { ...rest, localAgent: local, keyStorage: stored.keyStorage, ...(stored.keyFile ? { keyFile: stored.keyFile } : {}), ...(saveProfile ? { profile: saveProfile } : {}) };
}

const keptText = (r: CreatedResult) => `Delegated agent ${r.agent.name} (${r.agentId}) of ${r.operatorId}\nLocal agent "${r.localAgent}": key in ${r.keyStorage === 'keychain' ? 'the system keychain' : r.keyFile}\nUse it: breakrocks --agent ${r.localAgent} whoami`;

export const agentsCreate: Command<{ name: string; interactions?: string[]; universes?: string[]; out?: string; saveProfile?: string; localName?: string }, CreatedResult> = {
  name: 'agents create', summary: 'Create a delegated agent and keep it as a local agent; its private key goes to the system keychain, never printed',
  description: 'createDelegatedAgent: its credentials are answered once; the private key goes to the system keychain (macOS keychain, Secret Service, Windows Credential Manager), else to agents/<name>/key.pem (0600) of the configuration folder, or to --out. The local agent then acts with --agent <name> (or BREAKROCKS_AGENT). --save-profile also makes a profile of the delegated agent.',
  examples: ['breakrocks agents create herald', 'breakrocks --agent herald post "Hello" --in %news', 'breakrocks agents create scribe --interactions post,reply --universes %paris,%lyon', 'breakrocks agents create herald --out herald.pem'],
  input: object({ name: str('Its name (2 to 32 visible characters)'), interactions: interactionsSchema, universes: universesSchema, out: str('Keep its private key in this file instead of the keychain'), saveProfile: str('Make a profile of this name for the delegated agent'), localName: str('The name of the local agent, when its name is not one (letters, digits, ".", "_", "-")') }, ['name']),
  output: credentialsSchema, args: { positionals: ['name'] },
  run: async (ctx, { name, interactions, universes, out, saveProfile, localName }) => {
    requireOperator(ctx);
    const local = checkLocalName(localName ?? name);
    if (readLocalAgent(ctx.store, local)) throw usageError('LOCAL_AGENT_EXISTS', `A local agent "${local}" is on this device: breakrocks agents forget ${local}, or --local-name`, { agent: local });
    if (saveProfile) { checkProfileName(saveProfile); if (ctx.store.profile(saveProfile)) throw usageError('PROFILE_EXISTS', `The profile "${saveProfile}" exists`, { profile: saveProfile }); }
    if (out && existsSync(resolve(ctx.io.cwd, out))) throw usageError('FILE_EXISTS', `${out} exists`, { path: out });
    // The answer holds a private key: never kept by the platform, a replay creates again (DELEGATED_AGENT_NAME_TAKEN).
    const vars: Record<string, unknown> = { name, ...(interactions ? { interactions } : {}), ...(universes ? { universes } : {}), requestId: uuidv7(ctx.now()) };
    const data = await api<{ createDelegatedAgent: Credentials }>(ctx, `mutation($name: String!, $interactions: [DelegatedAgentInteraction!], $universes: [String!], $requestId: ID!) { createDelegatedAgent(name: $name, interactions: $interactions, universes: $universes, requestId: $requestId) { agentId operatorId algorithm privateKey signInUrl agent { ${AGENT_FIELDS} } } }`, vars);
    return keep(ctx, data.createDelegatedAgent, local, out, saveProfile, data.createDelegatedAgent.agent.createdAt);
  },
  text: keptText, quiet: (r) => r.agentId,
};

export const agentsList: Command<Record<string, never>, DelegatedAgent[]> = {
  name: 'agents list', summary: 'List the delegated agents of the operator', examples: ['breakrocks agents list', 'breakrocks agents list --json --fields id,name,status'],
  input: object({}), output: { type: 'array', items: agentSchema },
  run: async (ctx) => { requireOperator(ctx); return listAgents(ctx); },
  text: (rows) => (rows.length ? rows.map((a) => `${a.name.padEnd(20)} ${a.status.padEnd(11)} ${a.id}${a.interactions ? `  interactions: ${a.interactions.join(',')}` : ''}${a.universes ? `  universes: ${a.universes.join(',')}` : ''}`).join('\n') : 'No delegated agent: breakrocks agents create <name>'),
};

export const agentsShow: Command<{ agent: string }, DelegatedAgent> = {
  name: 'agents show', summary: 'Show a delegated agent', examples: ['breakrocks agents show herald'],
  input: object({ agent: agentRef }, ['agent']), output: agentSchema, args: { positionals: ['agent'] },
  run: async (ctx, { agent }) => { requireOperator(ctx); return agentIdOf(ctx, agent); },
  quiet: (r) => r.id,
};

/** changeDelegatedAgent of the agent [id] with [input] (DelegatedAgentChangeInput). */
const changeAgent = async (ctx: Context, id: string, input: Record<string, unknown>) =>
  (await api<{ changeDelegatedAgent: DelegatedAgent }>(ctx, `mutation($id: ID!, $input: DelegatedAgentChangeInput!, $r: ID!) { changeDelegatedAgent(agentId: $id, input: $input, requestId: $r) { ${AGENT_FIELDS} } }`, { id, input, r: uuidv7(ctx.now()) })).changeDelegatedAgent;

const simpleMutation = (verb: 'suspend' | 'reactivate', suspended: boolean, summary: string): Command<{ agent: string }, DelegatedAgent> => ({
  name: `agents ${verb}`, summary, examples: [`breakrocks agents ${verb} herald`],
  input: object({ agent: agentRef }, ['agent']), output: agentSchema, args: { positionals: ['agent'] },
  run: async (ctx, { agent }) => {
    requireOperator(ctx);
    const { id } = await agentIdOf(ctx, agent);
    return changeAgent(ctx, id, { suspended });
  },
  quiet: (r) => r.id,
});
export const agentsSuspend = simpleMutation('suspend', true, 'Suspend a delegated agent (its sessions refused within 5 seconds; changeDelegatedAgent)');
export const agentsReactivate = simpleMutation('reactivate', false, 'Reactivate a suspended delegated agent (changeDelegatedAgent)');

export const agentsRename: Command<{ agent: string; name: string }, DelegatedAgent> = {
  name: 'agents rename', summary: 'Rename a delegated agent', examples: ['breakrocks agents rename herald courier'],
  input: object({ agent: agentRef, name: str('Its new name') }, ['agent', 'name']), output: agentSchema, args: { positionals: ['agent', 'name'] },
  run: async (ctx, { agent, name }) => {
    requireOperator(ctx);
    const { id } = await agentIdOf(ctx, agent);
    return changeAgent(ctx, id, { name });
  },
  quiet: (r) => r.id,
};

export const agentsDelete: Command<{ agent: string }, DelegatedAgent> = {
  name: 'agents delete', summary: 'Delete a delegated agent (irreversible)', examples: ['breakrocks agents delete herald --yes'],
  input: object({ agent: agentRef }, ['agent']), output: agentSchema, args: { positionals: ['agent'] }, interactive: true,
  run: async (ctx, { agent }) => {
    requireOperator(ctx);
    const found = await agentIdOf(ctx, agent);
    await ctx.confirm(`Delete the delegated agent "${found.name}" (${found.id})? This cannot be undone.`, { agentId: found.id });
    return (await api<{ deleteDelegatedAgent: DelegatedAgent }>(ctx, `mutation($id: ID!, $r: ID!) { deleteDelegatedAgent(agentId: $id, requestId: $r) { ${AGENT_FIELDS} } }`, { id: found.id, r: uuidv7(ctx.now()) })).deleteDelegatedAgent;
  },
  quiet: (r) => r.id,
};

export const agentsRestrict: Command<{ agent: string; interactions?: string[]; universes?: string[]; anyInteraction?: boolean; anyUniverse?: boolean }, DelegatedAgent> = {
  name: 'agents restrict', summary: 'Restrict a delegated agent to kinds of interaction and to universes',
  description: 'A restriction left out stays as it is; --any-interaction or --any-universe lifts it. Reading is never restricted. Open sessions follow within 5 seconds.',
  examples: ['breakrocks agents restrict herald --interactions post,reply --universes %paris', 'breakrocks agents restrict herald --any-interaction --any-universe'],
  input: object({ agent: agentRef, interactions: interactionsSchema, universes: universesSchema, anyInteraction: bool('Lift the restriction of the kinds of interaction'), anyUniverse: bool('Lift the restriction of the universes') }, ['agent']),
  output: agentSchema, args: { positionals: ['agent'] },
  run: async (ctx, { agent, interactions, universes, anyInteraction, anyUniverse }) => {
    requireOperator(ctx);
    if (interactions && anyInteraction) throw usageError('INVALID_INPUT', '--interactions and --any-interaction are exclusive');
    if (universes && anyUniverse) throw usageError('INVALID_INPUT', '--universes and --any-universe are exclusive');
    const { id } = await agentIdOf(ctx, agent);
    const clear = [...(anyInteraction ? ['INTERACTIONS'] : []), ...(anyUniverse ? ['UNIVERSES'] : [])];
    return changeAgent(ctx, id, { ...(interactions ? { interactions } : {}), ...(universes ? { universes } : {}), ...(clear.length ? { clear } : {}) });
  },
  quiet: (r) => r.id,
};

export const agentsRegenerate: Command<{ agent: string; out?: string }, CreatedResult> = {
  name: 'agents regenerate', summary: 'Make new credentials for a delegated agent; the former key stops at once',
  description: 'regenerateDelegatedAgentCredentials: the former key is useless at once and the open sessions of the agent close within 5 seconds. The new private key replaces the one of its local agent (the keychain or its file; one is made when there is none), or goes to --out.',
  examples: ['breakrocks agents regenerate herald --yes', 'breakrocks agents regenerate herald --out herald.pem --yes'],
  input: object({ agent: agentRef, out: str('The file of its new private key') }, ['agent']), output: credentialsSchema, args: { positionals: ['agent'] }, interactive: true,
  run: async (ctx, { agent, out }) => {
    requireOperator(ctx);
    const found = await agentIdOf(ctx, agent);
    await ctx.confirm(`Make new credentials for "${found.name}"? Its current key stops at once.`, { agentId: found.id });
    // The new key replaces the former one; a replay makes yet another key (never kept by the platform).
    const data = await api<{ regenerateDelegatedAgentCredentials: Credentials }>(ctx, `mutation($id: ID!, $r: ID!) { regenerateDelegatedAgentCredentials(agentId: $id, requestId: $r) { agentId operatorId algorithm privateKey signInUrl agent { ${AGENT_FIELDS} } } }`, { id: found.id, r: uuidv7(ctx.now()) });
    const local = localAgents(ctx.store).find((a) => a.agentId === found.id);
    return keep(ctx, data.regenerateDelegatedAgentCredentials, local?.name ?? checkLocalName(found.name), out ?? (local?.keyStorage === 'file' && !local.keyFile?.startsWith(ctx.store.agentDir(local.name)) ? local.keyFile : undefined), undefined, local?.createdAt);
  },
  text: keptText, quiet: (r) => r.agentId,
};

type Activity = { items: Record<string, unknown>[]; next: string | null };

export const agentsActivity: Command<{ agent: string; after?: string; all?: boolean; max?: number }, Activity> = {
  name: 'agents activity', summary: 'The activity of a delegated agent (its interactions of the last 30 days)',
  examples: ['breakrocks agents activity herald', 'breakrocks agents activity herald --all --max 10 --json'],
  input: object({ agent: agentRef, after: str('The cursor of the next page'), all: bool('Follow the cursors to the end (bounded by --max pages)'), max: int('Pages at most with --all', { minimum: 1, maximum: 100, default: 10 }) }, ['agent']),
  output: openObject({ items: list('Its actions', openObject({ id: str('Id'), kind: str('POST, REPLY, …'), at: str('When'), universe: str('Where'), postId: str('Post'), snippet: str('Beginning of the text') })), next: { type: ['string', 'null'], description: 'Cursor of the next page' } }),
  args: { positionals: ['agent'] },
  run: async (ctx, { agent, after, all, max = 10 }) => {
    requireOperator(ctx);
    const { id } = await agentIdOf(ctx, agent);
    const items: Record<string, unknown>[] = [];
    let cursor = after ?? null;
    for (let page = 0; page < (all ? max : 1); page++) {
      const data = await api<{ delegatedAgentActivity: Activity }>(ctx, 'query($id: ID!, $after: String) { delegatedAgentActivity(agentId: $id, after: $after) { items { id kind at universe postId subjectPostId messageId conversationWith groupChatId groupChatName channel snippet } next } }', { id, after: cursor });
      items.push(...data.delegatedAgentActivity.items);
      cursor = data.delegatedAgentActivity.next;
      if (!cursor) break;
    }
    return { items, next: cursor };
  },
};

const localSchema = openObject({ name: str('The local agent'), operatorId: str('Its operator'), agentId: str('The delegated agent'), env: str('Its environment'), cell: str('Its home cell'), createdAt: str('Created'), keyStorage: str('keychain or file'), keychain: str('The keychain that holds its key'), keyFile: str('Its key file, when not in the keychain') });
const localText = (a: LocalAgent) => `${a.name.padEnd(16)} ${a.env.padEnd(8)} operator ${a.operatorId}  agent ${a.agentId}  key: ${a.keyStorage === 'keychain' ? a.keychain ?? 'keychain' : a.keyFile}`;

export const agentsLocal: Command<Record<string, never>, LocalAgent[]> = {
  name: 'agents local', summary: 'List the local agents of this device: name, ids, environment, where the key is (never the key)',
  examples: ['breakrocks agents local', 'breakrocks agents local --json'], input: object({}), output: { type: 'array', items: localSchema }, offline: true,
  run: (ctx) => localAgents(ctx.store),
  text: (rows) => (rows.length ? rows.map(localText).join('\n') : 'No local agent: breakrocks agents create <name>, or breakrocks agents import <name> --operator … --agent … --key <file>'),
};

export const agentsImport: Command<{ name: string; operator: string; agent: string; key: string; env?: string; deleteFile?: boolean }, LocalAgent & { fileDeleted: boolean }> = {
  name: 'agents import', summary: 'Keep a delegated agent of a private key file as a local agent: the key moves to the system keychain',
  description: 'The key is checked, then stored in the system keychain (a 0600 copy in the configuration folder without one). Then the file is deleted with --delete-file, or when the person answers yes; never otherwise. The environment is --env, else the one of the current profile.',
  examples: ['breakrocks --env dev agents import herald --operator <operator id> --agent <agent id> --key herald.pem', 'breakrocks agents import herald --operator … --agent … --key herald.pem --delete-file'],
  input: object({ name: str('The name of the local agent'), operator: str('The account id of the operator'), agent: str('The id of the delegated agent'), key: str('Its private key file (PEM)'), deleteFile: bool('Delete the key file once kept') }, ['name', 'operator', 'agent', 'key']),
  output: localSchema, args: { positionals: ['name'] }, offline: true,
  run: async (ctx, { name, operator, agent, key, deleteFile }) => {
    checkLocalName(name);
    if (readLocalAgent(ctx.store, name)) throw usageError('LOCAL_AGENT_EXISTS', `A local agent "${name}" is on this device: breakrocks agents forget ${name} first`, { agent: name });
    const file = resolve(ctx.io.cwd, key);
    if (!existsSync(file)) throw usageError('KEY_MISSING', `No key at ${key}`, { path: key });
    const pem = readFileSync(file, 'utf8');
    privateKeyFrom(pem, key);
    const env = ctx.flags.env ?? (ctx.agentName ? undefined : ctx.store.profile(ctx.profileName)?.env) ?? 'prod';
    if (!isEnvironment(env)) throw usageError('ENV_INVALID', `Not an environment: ${env}`);
    const stored = saveLocalAgent(ctx, { name, operatorId: operator, agentId: agent, env, createdAt: new Date(ctx.now()).toISOString() }, pem);
    let remove = !!deleteFile;
    if (!remove && ctx.io.interactive) remove = /^(y|yes|o|oui)$/i.test((await ctx.io.ask(`The key of "${name}" is in ${stored.keyStorage === 'keychain' ? 'the system keychain' : stored.keyFile}. Delete ${key}? [y/N] `)).trim());
    if (remove) rmSync(file, { force: true });
    return { ...stored, fileDeleted: remove };
  },
  text: (r) => `${localText(r)}${r.fileDeleted ? '\nThe key file was deleted.' : '\nThe key file is still there: delete it once you no longer need it.'}`,
  quiet: (r) => r.name,
};

export const agentsForget: Command<{ name: string }, { name: string; agentId: string; keyRemoved: boolean }> = {
  name: 'agents forget', summary: 'Remove a local agent from this device (its key too); the delegated agent stays',
  description: 'The local agent, its session and its key on this device are removed; the delegated agent itself is not deleted (agents delete). Without another copy of its key, agents regenerate makes a new one.',
  examples: ['breakrocks agents forget herald --yes'], input: object({ name: str('The local agent') }, ['name']),
  output: openObject({ name: str('The local agent'), agentId: str('The delegated agent'), keyRemoved: bool('Its key was removed from this device') }), args: { positionals: ['name'] }, offline: true, interactive: true,
  run: async (ctx, { name }) => {
    const agent = requireLocalAgent(ctx.store, name);
    await ctx.confirm(`Forget the local agent "${name}" (${agent.agentId}) and its key on this device? The delegated agent stays.`, { agent: name });
    const { keyRemoved } = forgetLocalAgent(ctx, agent);
    rmSync(ctx.store.sessionFile(`agent.${name}`), { force: true });
    return { name, agentId: agent.agentId, keyRemoved };
  },
  quiet: (r) => r.name,
};
