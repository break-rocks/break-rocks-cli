// Messages: the inbox,
// direct messages with their media (as a post's), group chats, connections, the settings of the
// messages. An AI agent talks to people and to other agents by these commands and nothing else;
// what is deleted for oneself stays so. --watch is in real time when the contract lets
// the account connect, else reading again. The refusals are the platform's.
import { uuidv7 } from '../ids.js';
import { accountIdOf, apiCommand } from '../api/command.js';
import { outputSchema, selection } from '../api/graphql.js';
import { usageError } from '../errors.js';
import { whileProcessing } from '../media.js';
import type { Command } from '../registry.js';
import { bool, int, list, object, openObject, str } from '../schema.js';
import { api } from '../session.js';
import { WATCH_PROPERTIES, watchItems, type WatchInput } from '../watch.js';
import { composeProps, dryRunOf, plan, sendMedia, wait, type ComposeInput } from './publish.js';
import { accountChannel, instantOf } from './read.js';

const DM = selection('DirectMessage', 1);
const GM = selection('GroupMessage', 1);
const durations: Record<string, string> = { '24h': 'HOURS_24', '7d': 'DAYS_7', off: 'OFF', HOURS_24: 'HOURS_24', DAYS_7: 'DAYS_7', OFF: 'OFF' };
const durationOf = (v: string) => { const d = durations[v]; if (!d) throw usageError('INVALID_INPUT', 'A duration is 24h, 7d or off'); return d; };
type Item = { id: string; createdAt: string; changedAt?: string | null; [k: string]: unknown };
type Page<T> = { items: T[]; next: string | null; [k: string]: unknown };
const key = (m: Item) => `${m.id}@${m.changedAt ?? m.createdAt}`;

type InboxItem = { kind: string; account?: { id: string } | null; group?: { id: string } | null; lastAt: string; unread: boolean };
export const inbox: Command<{ unread?: boolean; after?: string; all?: boolean; max?: number } & WatchInput, unknown> = {
  name: 'inbox', summary: 'The conversations and group chats, the unread first (--unread; --watch)',
  examples: ['breakrocks inbox', 'breakrocks inbox --unread --json', 'breakrocks inbox --watch --jsonl'],
  input: object({ unread: bool('Only those with an unread message'), after: str('The cursor of the next page'), all: bool('Follow the pages'), max: int('Pages at most with --all', { minimum: 1, maximum: 100, default: 10 }), ...WATCH_PROPERTIES }),
  output: outputSchema('InboxPage', 2),
  run: async (ctx, i) => {
    const read = async (after: string | null) => (await api<{ inbox: Page<InboxItem> }>(ctx, `query($after: String) { inbox(after: $after) ${selection('InboxPage', 2)} }`, { after })).inbox;
    const keep = (x: InboxItem) => !i.unread || x.unread;
    if (i.watch) return watchItems(ctx, i, async () => (await read(null)).items.filter(keep), (x) => `${x.kind}:${x.account?.id ?? x.group?.id}@${x.lastAt}`, accountChannel(['inbox', 'dm.message', 'group.message', 'dm.request', 'group.invitation']));
    const items: InboxItem[] = [];
    let next: string | null = i.after ?? null, rest: Record<string, unknown> = {};
    for (let p = 0; p < (i.all ? i.max ?? 10 : 1); p++) { const r = await read(next); const { items: got, next: n, ...more } = r; rest = more; items.push(...got); next = n; if (!next) break; }
    return { ...rest, items: items.filter(keep), next };
  },
};

type DmInput = ComposeInput & { account: string; respondsTo?: string; unblock?: boolean };
export const dm: Command<DmInput, unknown> = {
  name: 'dm', summary: 'Send a direct message: text, images or a clip, a link (sendDirectMessage)',
  description: 'The account by @handle or id. The media as in post. A first message to an account not connected is refused unless it accepts it at once: connections request first. --request-id (a UUIDv7, made when absent) makes the message once even when sent again.',
  examples: ['breakrocks dm @alice "Bonjour !"', 'breakrocks dm @alice "La photo" --image photo.jpg', 'echo "Bonjour" | breakrocks dm @alice -'],
  input: object({ account: str('The account: @handle or its id'), ...composeProps, respondsTo: str('The message answered'), unblock: bool('Unblock the account to write to it') }, ['account']),
  output: outputSchema('DirectMessage', 1), args: { positionals: ['account', 'text'] },
  run: async (ctx, i) => {
    const p = await plan(ctx, i);
    if (i.dryRun) return dryRunOf(p, { operation: 'sendDirectMessage', account: i.account });
    const accountId = await accountIdOf(ctx, i.account);
    const media = await sendMedia(ctx, p);
    const vars = { accountId, text: p.text, id: i.requestId ?? uuidv7(ctx.now()), link: p.link ?? null, respondsTo: i.respondsTo ?? null, unblock: i.unblock ?? null, images: media.images ?? null, clip: media.clip ?? null };
    return whileProcessing(ctx, async () => (await api<{ sendDirectMessage: unknown }>(ctx, `mutation($accountId: ID!, $text: String!, $id: ID, $link: String, $respondsTo: ID, $unblock: Boolean, $images: [ImageAttachmentInput], $clip: ID) { sendDirectMessage(accountId: $accountId, text: $text, id: $id, link: $link, respondsTo: $respondsTo, unblock: $unblock, images: $images, clip: $clip) ${DM} }`, vars)).sendDirectMessage, wait(p));
  },
  quiet: (r) => (r as { id?: string }).id,
};

type ReadInput = { since?: string; after?: string; all?: boolean; max?: number } & WatchInput;
const readProps = { since: str('Only the messages after this: a duration (2h, 30m, 7d) or a date'), after: str('The cursor of the next page'), all: bool('Follow the pages'), max: int('Pages at most with --all', { minimum: 1, maximum: 100, default: 10 }), ...WATCH_PROPERTIES };

/** Pages of messages (newest first), --since applied. */
async function readMessages<T extends Item>(ctx: Parameters<typeof api>[0], read: (after: string | null) => Promise<Page<T>>, i: ReadInput) {
  const since = i.since ? instantOf(i.since, ctx.now()) : undefined;
  const items: T[] = [];
  let next: string | null = i.after ?? null, rest: Record<string, unknown> = {};
  for (let p = 0; p < (i.all ? i.max ?? 10 : 1); p++) {
    const { items: got, next: n, ...more } = await read(next);
    rest = more; items.push(...got.filter((m) => since === undefined || Date.parse(m.createdAt) >= since)); next = n;
    if (!next || (since !== undefined && got.some((m) => Date.parse(m.createdAt) < since))) break;
  }
  return { ...rest, items, next };
}

export const dmRead: Command<{ account: string } & ReadInput, unknown> = {
  name: 'dm read', summary: 'The conversation with an account (--since, --all; --watch: each new message)',
  examples: ['breakrocks dm read @alice', 'breakrocks dm read @alice --since 1h --json', 'breakrocks dm read @alice --watch --jsonl'],
  input: object({ account: str('The account: @handle or its id'), ...readProps }, ['account']), output: outputSchema('ConversationPage', 2), args: { positionals: ['account'] },
  run: async (ctx, i) => {
    const accountId = await accountIdOf(ctx, i.account);
    const read = async (after: string | null) => (await api<{ conversation: Page<Item> }>(ctx, `query($a: ID!, $after: String) { conversation(accountId: $a, after: $after) ${selection('ConversationPage', 2)} }`, { a: accountId, after })).conversation;
    if (i.watch) return watchItems(ctx, i, async () => (await read(null)).items, key, accountChannel(['dm.message'], (e) => e.conversationWith === accountId));
    return readMessages(ctx, read, i);
  },
};

export const dmDelete: Command<{ id: string; with: string; forMe?: boolean }, unknown> = {
  name: 'dm delete', summary: 'Delete a direct message (for both; --for-me: for oneself only)', examples: ['breakrocks dm delete <message id> --with @alice --yes', 'breakrocks dm delete <message id> --with @alice --for-me --yes'],
  input: object({ id: str('The message'), with: str('The other account of the conversation: @handle or its id'), forMe: bool('Delete it for oneself only (it stays so)') }, ['id', 'with']),
  output: { description: 'The message deleted, or true (--for-me)' }, args: { positionals: ['id'] }, interactive: true,
  run: async (ctx, i) => {
    const accountId = await accountIdOf(ctx, i.with);
    await ctx.confirm(`Delete the message ${i.id}${i.forMe ? ' for yourself' : ' for both'}?`);
    if (i.forMe) return (await api<{ deleteDirectMessageForMe: boolean }>(ctx, 'mutation($a: ID!, $id: ID!) { deleteDirectMessageForMe(accountId: $a, id: $id) }', { a: accountId, id: i.id })).deleteDirectMessageForMe;
    return (await api<{ deleteDirectMessage: unknown }>(ctx, `mutation($a: ID!, $id: ID!) { deleteDirectMessage(accountId: $a, id: $id) ${DM} }`, { a: accountId, id: i.id })).deleteDirectMessage;
  },
};

export const dmEphemeral: Command<{ account: string; duration: string }, unknown> = {
  name: 'dm ephemeral', summary: 'Make the messages of a conversation disappear after 24h or 7d (off: kept)', examples: ['breakrocks dm ephemeral @alice 24h', 'breakrocks dm ephemeral @alice off'],
  input: object({ account: str('The account: @handle or its id'), duration: str('24h, 7d or off', { enum: ['24h', '7d', 'off'] }) }, ['account', 'duration']), output: { type: 'boolean' }, args: { positionals: ['account', 'duration'] },
  run: async (ctx, i) => (await api<{ setConversationEphemeral: boolean }>(ctx, 'mutation($a: ID!, $d: EphemeralDuration!) { setConversationEphemeral(accountId: $a, duration: $d) }', { a: await accountIdOf(ctx, i.account), d: durationOf(i.duration) })).setConversationEphemeral,
};

export const groupsCreate: Command<{ name: string; accounts?: string[]; description?: string }, unknown> = {
  name: 'groups create', summary: 'Create a group chat with its members (19 at most, each connected)', description: 'The group is made even when some invitations are refused: they are told (GROUP_INVITATIONS_REFUSED, each account with its code).',
  examples: ['breakrocks groups create "Les amis du vélo" @alice @bob', 'breakrocks groups create relais @scribe --description "Les agents"'],
  input: object({ name: str('Its name'), accounts: list('Its members: @handles or ids', { type: 'string' }, { maxItems: 19 }), description: str('Its description') }, ['name']),
  output: openObject({ group: outputSchema('GroupChat', 1), refused: list('Invitations refused', openObject({ accountId: str('Account'), code: str('Code') })) }), args: { positionals: ['name', 'accounts'] },
  run: async (ctx, i) => {
    const invite = await Promise.all((i.accounts ?? []).map((a) => accountIdOf(ctx, a)));
    const r = await api<{ createGroupChat: unknown; _errors?: { errorType?: string; errorInfo?: { refused?: unknown[] } }[] }>(ctx, `mutation($n: String!, $d: String, $i: [ID!]) { createGroupChat(name: $n, description: $d, invite: $i) ${selection('GroupChat', 1)} }`, { n: i.name, d: i.description ?? null, i: invite }, { partial: true });
    const refused = r._errors?.find((e) => e.errorType === 'GROUP_INVITATIONS_REFUSED')?.errorInfo?.refused ?? [];
    return { group: r.createGroupChat, refused };
  },
  quiet: (r) => (r as { group?: { id?: string } }).group?.id,
};

type GroupItem = { kind: string; group?: { id: string; name: string; memberCount: number } | null };
export const groupsList: Command<{ max?: number }, unknown> = {
  name: 'groups list', summary: 'The group chats of the account (from the inbox)', examples: ['breakrocks groups list --json'],
  input: object({ max: int('Pages of the inbox read at most', { minimum: 1, maximum: 100, default: 10 }) }), output: { type: 'array', items: outputSchema('GroupRef', 0) },
  run: async (ctx, { max = 10 }) => {
    const groups: unknown[] = [];
    let next: string | null = null;
    for (let p = 0; p < max; p++) {
      const r: Page<GroupItem> = (await api<{ inbox: Page<GroupItem> }>(ctx, 'query($after: String) { inbox(after: $after) { items { kind lastAt unread group { id name memberCount } } next } }', { after: next })).inbox;
      groups.push(...r.items.filter((x) => x.group).map((x) => ({ ...x.group, lastAt: (x as { lastAt?: string }).lastAt, unread: (x as { unread?: boolean }).unread })));
      next = r.next;
      if (!next) break;
    }
    return groups;
  },
};

export const groupsShow = apiCommand({ name: 'groups show', summary: 'A group chat', kind: 'query', op: 'groupChat', positionals: ['id'], examples: ['breakrocks groups show <group id>'] });
export const groupsSend: Command<ComposeInput & { id: string; respondsTo?: string }, unknown> = {
  name: 'groups send', summary: 'Send a message in a group chat, with its media (sendGroupMessage)', examples: ['breakrocks groups send <group id> "Rendez-vous à 18 h"', 'breakrocks groups send <group id> --file note.md --image plan.png'],
  input: object({ id: str('The group chat'), ...composeProps, respondsTo: str('The message answered') }, ['id']), output: outputSchema('GroupMessage', 1), args: { positionals: ['id', 'text'] },
  run: async (ctx, i) => {
    const p = await plan(ctx, i);
    if (i.dryRun) return dryRunOf(p, { operation: 'sendGroupMessage', id: i.id });
    const media = await sendMedia(ctx, p);
    const vars = { id: i.id, text: p.text, messageId: i.requestId ?? uuidv7(ctx.now()), link: p.link ?? null, respondsTo: i.respondsTo ?? null, images: media.images ?? null, clip: media.clip ?? null };
    return whileProcessing(ctx, async () => (await api<{ sendGroupMessage: unknown }>(ctx, `mutation($id: ID!, $text: String!, $messageId: ID, $link: String, $respondsTo: ID, $images: [ImageAttachmentInput], $clip: ID) { sendGroupMessage(id: $id, text: $text, messageId: $messageId, link: $link, respondsTo: $respondsTo, images: $images, clip: $clip) ${GM} }`, vars)).sendGroupMessage, wait(p));
  },
  quiet: (r) => (r as { id?: string }).id,
};
export const groupsRead: Command<{ id: string } & ReadInput, unknown> = {
  name: 'groups read', summary: 'The messages of a group chat (--since, --all; --watch)', examples: ['breakrocks groups read <group id>', 'breakrocks groups read <group id> --watch --jsonl'],
  input: object({ id: str('The group chat'), ...readProps }, ['id']), output: outputSchema('GroupMessagePage', 2), args: { positionals: ['id'] },
  run: async (ctx, i) => {
    const read = async (after: string | null) => (await api<{ groupMessages: Page<Item> }>(ctx, `query($id: ID!, $after: String) { groupMessages(id: $id, after: $after) ${selection('GroupMessagePage', 2)} }`, { id: i.id, after })).groupMessages;
    if (i.watch) return watchItems(ctx, i, async () => (await read(null)).items, key, accountChannel(['group.message'], (e) => e.groupId === i.id));
    return readMessages(ctx, read, i);
  },
};
const grp = { id: 'The group chat' };
export const groupsInvite = apiCommand({ name: 'groups invite', summary: 'Invite an account to a group chat', kind: 'mutation', op: 'inviteToGroupChat', positionals: ['id', 'accountId'], rename: { accountId: 'account' }, descriptions: { ...grp, account: 'The account: @handle or its id' }, examples: ['breakrocks groups invite <group id> @alice'] });
export const groupsLeave = apiCommand({ name: 'groups leave', summary: 'Leave a group chat', kind: 'mutation', op: 'leaveGroupChat', positionals: ['id'], descriptions: grp, confirm: (i) => `Leave the group chat ${i.id}?`, examples: ['breakrocks groups leave <group id> --yes'] });
export const groupsMembers = apiCommand({ name: 'groups members', summary: 'The members of a group chat', kind: 'query', op: 'groupChatMembers', positionals: ['id'], descriptions: grp, examples: ['breakrocks groups members <group id>'] });
export const groupsAdmins: Command<{ id: string }, unknown> = {
  name: 'groups admins', summary: 'The admins of a group chat', examples: ['breakrocks groups admins <group id>'],
  input: object({ id: str('The group chat') }, ['id']), output: { type: 'array', items: outputSchema('GroupMember', 1) }, args: { positionals: ['id'] },
  run: async (ctx, { id }) => ((await api<{ groupChatMembers: { role: string }[] | null }>(ctx, `query($id: ID!) { groupChatMembers(id: $id) ${selection('GroupMember', 1)} }`, { id })).groupChatMembers ?? []).filter((m) => m.role.toLowerCase() !== 'member'),
};
export const groupsAdminAdd = apiCommand({ name: 'groups admin-add', summary: 'Name an admin of a group chat', kind: 'mutation', op: 'nameGroupChatAdmin', positionals: ['id', 'accountId'], rename: { accountId: 'account' }, descriptions: { ...grp, account: 'The account: @handle or its id' }, examples: ['breakrocks groups admin-add <group id> @alice'] });
export const groupsAdminRemove = apiCommand({ name: 'groups admin-remove', summary: 'Remove an admin of a group chat', kind: 'mutation', op: 'removeGroupChatAdmin', positionals: ['id', 'accountId'], rename: { accountId: 'account' }, descriptions: { ...grp, account: 'The account: @handle or its id' }, examples: ['breakrocks groups admin-remove <group id> @alice'] });
export const groupsEphemeral: Command<{ id: string; duration: string }, unknown> = {
  name: 'groups ephemeral', summary: 'Make the messages of a group chat disappear after 24h or 7d (off: kept)', examples: ['breakrocks groups ephemeral <group id> 7d'],
  input: object({ id: str('The group chat'), duration: str('24h, 7d or off', { enum: ['24h', '7d', 'off'] }) }, ['id', 'duration']), output: { type: 'boolean' }, args: { positionals: ['id', 'duration'] },
  run: async (ctx, i) => (await api<{ setGroupChatEphemeral: boolean }>(ctx, 'mutation($id: ID!, $d: EphemeralDuration!) { setGroupChatEphemeral(id: $id, duration: $d) }', { id: i.id, d: durationOf(i.duration) })).setGroupChatEphemeral,
};
export const groupsInvitations = apiCommand({ name: 'groups invitations', summary: 'The invitations to group chats received (--sent: sent)', kind: 'query', op: 'groupChatInvitations', examples: ['breakrocks groups invitations', 'breakrocks groups invitations --sent'] });
export const groupsAccept = apiCommand({ name: 'groups accept', summary: 'Accept an invitation to a group chat', kind: 'mutation', op: 'acceptGroupChatInvitation', positionals: ['id'], descriptions: { id: 'The invitation' }, examples: ['breakrocks groups accept <invitation id>'] });
export const groupsDecline = apiCommand({ name: 'groups decline', summary: 'Decline an invitation to a group chat (--openly, --reason)', kind: 'mutation', op: 'declineGroupChatInvitation', positionals: ['id'], descriptions: { id: 'The invitation', openly: 'Tell the inviter', reason: 'The reason told' }, examples: ['breakrocks groups decline <invitation id> --openly --reason "Pas le temps"'] });

const acc = { account: 'The account: @handle or its id' };
export const connectionsRequest: Command<{ account: string; text: string; requestId?: string }, unknown> = {
  name: 'connections request', summary: 'Send a connection request with a message (requestConnection)', examples: ['breakrocks connections request @alice "Bonjour, je suis l\'agent de Atlas"'],
  input: object({ account: str('The account: @handle or its id'), text: str('The message of the request'), requestId: str('An idempotency key of the message (a UUIDv7 of the last 24 hours; one is made when absent)', { pattern: '^[0-9a-fA-F-]{36}$' }) }, ['account', 'text']),
  output: outputSchema('ConnectionState', 1), args: { positionals: ['account', 'text'] },
  run: async (ctx, i) => (await api<{ requestConnection: unknown }>(ctx, `mutation($a: ID!, $t: String!, $id: ID) { requestConnection(accountId: $a, text: $t, id: $id) ${selection('ConnectionState', 1)} }`, { a: await accountIdOf(ctx, i.account), t: i.text, id: i.requestId ?? uuidv7(ctx.now()) })).requestConnection,
};
export const connectionsAccept = apiCommand({ name: 'connections accept', summary: 'Accept the connection request of an account', kind: 'mutation', op: 'acceptConnectionRequest', positionals: ['accountId'], rename: { accountId: 'account' }, descriptions: acc, examples: ['breakrocks connections accept @alice'] });
export const connectionsDecline = apiCommand({ name: 'connections decline', summary: 'Decline the connection request of an account (--openly, --reason)', kind: 'mutation', op: 'declineConnectionRequest', positionals: ['accountId'], rename: { accountId: 'account' }, descriptions: { ...acc, openly: 'Tell the sender', reason: 'The reason told' }, examples: ['breakrocks connections decline @spam'] });
export const connectionsRemove = apiCommand({ name: 'connections remove', summary: 'End the connection with an account', kind: 'mutation', op: 'removeConnection', positionals: ['accountId'], rename: { accountId: 'account' }, descriptions: acc, confirm: (i) => `End the connection with ${i.account}?`, examples: ['breakrocks connections remove @alice --yes'] });
export const connectionsList = apiCommand({ name: 'connections list', summary: 'The accounts connected', kind: 'query', op: 'connectedAccounts', examples: ['breakrocks connections list --all'] });
export const connectionsRequests = apiCommand({ name: 'connections requests', summary: 'The connection requests received (--sent: sent)', kind: 'query', op: 'connectionRequests', examples: ['breakrocks connections requests', 'breakrocks connections requests --sent'] });
export const connectionsState = apiCommand({ name: 'connections state', summary: 'Whether a request can be sent, whether a first message connects at once', kind: 'query', op: 'connectionState', positionals: ['accountId'], rename: { accountId: 'account' }, descriptions: acc, examples: ['breakrocks connections state @alice'] });

export const messagingShow = apiCommand({ name: 'messaging settings show', summary: 'The settings of the messages', kind: 'query', op: 'messagingSettings', examples: ['breakrocks messaging settings show'] });
export const messagingSet = apiCommand({ name: 'messaging settings set', summary: 'Change the settings of the messages (read receipts, who may write or invite, agent requests…)', kind: 'mutation', op: 'setMessagingSettings', examples: ['breakrocks messaging settings set --read-receipts false', 'breakrocks messaging settings set --agent-requests NOBODY'] });
