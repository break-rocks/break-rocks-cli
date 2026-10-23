// agents create|list|show|rename|suspend|reactivate|delete|restrict|regenerate|activity: the
// delegated agents of the operator signed in. Their private keys are written to a file (0600) and never printed; a delegated agent
// cannot manage agents, which the CLI says before calling.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkProfileName, writePrivate } from '../config.js';
import type { Context } from '../context.js';
import { usageError } from '../errors.js';
import type { Command } from '../registry.js';
import { bool, int, list, object, openObject, str } from '../schema.js';
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
const credentialsSchema = openObject({ agentId: str('The id of the delegated agent'), operatorId: str('The account id of the operator'), algorithm: str('Ed25519'), signInUrl: str('The base address of its sign-in'), keyFile: str('Its private key file (0600)'), profile: str('The profile made for it'), agent: agentSchema });

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

function keyFileFor(ctx: Context, agentId: string, out?: string) {
  return out ? resolve(ctx.io.cwd, out) : join(ctx.store.keysDir(ctx.profileName), 'agents', `${agentId}.pem`);
}

type Credentials = { agentId: string; operatorId: string; algorithm: string; privateKey: string; signInUrl: string; agent: DelegatedAgent };
type CreatedResult = Omit<Credentials, 'privateKey'> & { keyFile: string; profile?: string };

/** Writes the private key of [credentials] and answers them without it; [saveProfile]: a profile of the delegated agent. */
function keep(ctx: Context, credentials: Credentials, out: string | undefined, saveProfile?: string): CreatedResult {
  const { privateKey, ...rest } = credentials;
  const keyFile = keyFileFor(ctx, credentials.agentId, out);
  writePrivate(keyFile, privateKey.endsWith('\n') ? privateKey : `${privateKey}\n`);
  if (saveProfile) {
    const operator = ctx.profile();
    ctx.store.saveProfile(saveProfile, { env: operator.env, ...(operator.cell ? { cell: operator.cell } : {}), kind: 'agent', operatorId: credentials.operatorId, agentId: credentials.agentId, keys: { agent: keyFile } });
  }
  return { ...rest, keyFile, ...(saveProfile ? { profile: saveProfile } : {}) };
}

export const agentsCreate: Command<{ name: string; interactions?: string[]; universes?: string[]; out?: string; saveProfile?: string }, CreatedResult> = {
  name: 'agents create', summary: 'Create a delegated agent; its private key is written to a file, never printed',
  description: 'createDelegatedAgent: its credentials are answered once; the private key goes to --out (0600) or to the configuration folder. --save-profile makes a profile of the delegated agent (agent login --profile <name>).',
  examples: ['breakrocks agents create herald --out herald.pem', 'breakrocks agents create scribe --interactions post,reply --universes %paris,%lyon --save-profile scribe'],
  input: object({ name: str('Its name (2 to 32 visible characters)'), interactions: interactionsSchema, universes: universesSchema, out: str('The file of its private key'), saveProfile: str('Make a profile of this name for the delegated agent') }, ['name']),
  output: credentialsSchema, args: { positionals: ['name'] },
  run: async (ctx, { name, interactions, universes, out, saveProfile }) => {
    requireOperator(ctx);
    if (saveProfile) { checkProfileName(saveProfile); if (ctx.store.profile(saveProfile)) throw usageError('PROFILE_EXISTS', `The profile "${saveProfile}" exists`, { profile: saveProfile }); }
    if (out && existsSync(resolve(ctx.io.cwd, out))) throw usageError('FILE_EXISTS', `${out} exists`, { path: out });
    const vars: Record<string, unknown> = { name, ...(interactions ? { interactions } : {}), ...(universes ? { universes } : {}) };
    const data = await api<{ createDelegatedAgent: Credentials }>(ctx, `mutation($name: String!, $interactions: [DelegatedAgentInteraction], $universes: [String]) { createDelegatedAgent(name: $name, interactions: $interactions, universes: $universes) { agentId operatorId algorithm privateKey signInUrl agent { ${AGENT_FIELDS} } } }`, vars);
    return keep(ctx, data.createDelegatedAgent, out, saveProfile);
  },
  quiet: (r) => r.agentId,
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

const simpleMutation = (verb: 'suspend' | 'reactivate', field: string, summary: string): Command<{ agent: string }, DelegatedAgent> => ({
  name: `agents ${verb}`, summary, examples: [`breakrocks agents ${verb} herald`],
  input: object({ agent: agentRef }, ['agent']), output: agentSchema, args: { positionals: ['agent'] },
  run: async (ctx, { agent }) => {
    requireOperator(ctx);
    const { id } = await agentIdOf(ctx, agent);
    return (await api<Record<string, DelegatedAgent>>(ctx, `mutation($id: ID!) { ${field}(id: $id) { ${AGENT_FIELDS} } }`, { id }))[field];
  },
  quiet: (r) => r.id,
});
export const agentsSuspend = simpleMutation('suspend', 'suspendDelegatedAgent', 'Suspend a delegated agent (its sessions refused within 5 seconds)');
export const agentsReactivate = simpleMutation('reactivate', 'reactivateDelegatedAgent', 'Reactivate a suspended delegated agent');

export const agentsRename: Command<{ agent: string; name: string }, DelegatedAgent> = {
  name: 'agents rename', summary: 'Rename a delegated agent', examples: ['breakrocks agents rename herald courier'],
  input: object({ agent: agentRef, name: str('Its new name') }, ['agent', 'name']), output: agentSchema, args: { positionals: ['agent', 'name'] },
  run: async (ctx, { agent, name }) => {
    requireOperator(ctx);
    const { id } = await agentIdOf(ctx, agent);
    return (await api<{ renameDelegatedAgent: DelegatedAgent }>(ctx, `mutation($id: ID!, $name: String!) { renameDelegatedAgent(id: $id, name: $name) { ${AGENT_FIELDS} } }`, { id, name })).renameDelegatedAgent;
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
    return (await api<{ deleteDelegatedAgent: DelegatedAgent }>(ctx, `mutation($id: ID!) { deleteDelegatedAgent(id: $id) { ${AGENT_FIELDS} } }`, { id: found.id })).deleteDelegatedAgent;
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
    const vars: Record<string, unknown> = { id };
    const args: string[] = ['id: $id'], decl: string[] = ['$id: ID!'];
    if (interactions || anyInteraction) { vars.interactions = anyInteraction ? null : interactions; args.push('interactions: $interactions'); decl.push('$interactions: [DelegatedAgentInteraction]'); }
    if (universes || anyUniverse) { vars.universes = anyUniverse ? null : universes; args.push('universes: $universes'); decl.push('$universes: [String]'); }
    return (await api<{ restrictDelegatedAgent: DelegatedAgent }>(ctx, `mutation(${decl.join(', ')}) { restrictDelegatedAgent(${args.join(', ')}) { ${AGENT_FIELDS} } }`, vars)).restrictDelegatedAgent;
  },
  quiet: (r) => r.id,
};

export const agentsRegenerate: Command<{ agent: string; out?: string }, CreatedResult> = {
  name: 'agents regenerate', summary: 'Make new credentials for a delegated agent; the former key stops at once',
  description: 'regenerateDelegatedAgentCredentials: the former key is useless at once and the open sessions of the agent close within 5 seconds. The new private key replaces the file of the agent (or --out).',
  examples: ['breakrocks agents regenerate herald --yes', 'breakrocks agents regenerate herald --out herald.pem --yes'],
  input: object({ agent: agentRef, out: str('The file of its new private key') }, ['agent']), output: credentialsSchema, args: { positionals: ['agent'] }, interactive: true,
  run: async (ctx, { agent, out }) => {
    requireOperator(ctx);
    const found = await agentIdOf(ctx, agent);
    await ctx.confirm(`Make new credentials for "${found.name}"? Its current key stops at once.`, { agentId: found.id });
    const data = await api<{ regenerateDelegatedAgentCredentials: Credentials }>(ctx, `mutation($id: ID!) { regenerateDelegatedAgentCredentials(id: $id) { agentId operatorId algorithm privateKey signInUrl agent { ${AGENT_FIELDS} } } }`, { id: found.id });
    return keep(ctx, data.regenerateDelegatedAgentCredentials, out);
  },
  quiet: (r) => r.agentId,
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
      const data = await api<{ delegatedAgentActivity: Activity }>(ctx, 'query($id: ID!, $after: String) { delegatedAgentActivity(id: $id, after: $after) { items { id kind at universe postId subjectPostId messageId conversationWith groupId groupName channel snippet } next } }', { id, after: cursor });
      items.push(...data.delegatedAgentActivity.items);
      cursor = data.delegatedAgentActivity.next;
      if (!cursor) break;
    }
    return { items, next: cursor };
  },
};
