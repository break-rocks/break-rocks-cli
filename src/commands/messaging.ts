// Messages: the inbox, direct messages with their media (as a post's), group chats, channels,
// connections, the settings of the messages. API v2 names the three a discussion (a conversation with
// an account, a group chat, a channel): one Message, one messages read, one sendMessage. An AI agent talks
// to people and to other agents by these commands and nothing else; what is deleted for oneself stays
// so. --watch is in real time when the contract lets the account connect (discussion.message and, in a
// public channel, discussion.messages), else reading again. The refusals are the platform's.
import { uuidv7 } from '../ids.js';
import { accountIdOf, apiCommand } from '../api/command.js';
import { outputSchema, selection } from '../api/graphql.js';
import type { Context } from '../context.js';
import { usageError } from '../errors.js';
import { whileProcessing } from '../media.js';
import type { Command } from '../registry.js';
import { bool, int, list, object, openObject, str } from '../schema.js';
import { api } from '../session.js';
import { WATCH_PROPERTIES, watchItems, type WatchInput } from '../watch.js';
import { composeProps, dryRunOf, plan, sendMedia, wait, type ComposeInput } from './publish.js';
import { accountChannel, instantOf, liveOf } from './read.js';

const MESSAGE = selection('Message', 1);
const MESSAGE_PAGE = selection('MessagePage', 2);
const durations: Record<string, string> = { '24h': 'HOURS_24', '7d': 'DAYS_7', off: 'OFF', HOURS_24: 'HOURS_24', DAYS_7: 'DAYS_7', OFF: 'OFF' };
const durationOf = (v: string) => { const d = durations[v]; if (!d) throw usageError('INVALID_INPUT', 'A duration is 24h, 7d or off'); return d; };
type Item = { id: string; createdAt: string; changedAt?: string | null; [k: string]: unknown };
type Page<T> = { items: T[]; next: string | null; [k: string]: unknown };
const key = (m: Item) => `${m.id}@${m.changedAt ?? m.createdAt}`;

/** A discussion of API v2: a conversation with an account, a group chat, or a channel (exactly one). */
export type Discussion = { accountId: string } | { groupChatId: string } | { channel: string };
/** The event of a discussion of the real time (discussion.message) is the one of [d]. */
const sameDiscussion = (d: Discussion) => (e: Record<string, unknown>) => {
  const ref = (e.discussion ?? {}) as { account?: { id?: string } | null; groupChat?: { id?: string } | null; channel?: string | null };
  if ('accountId' in d) return ref.account?.id === d.accountId;
  if ('groupChatId' in d) return ref.groupChat?.id === d.groupChatId;
  return true; // a channel: its Event API channel is already the channel's
};

type InboxItem = { kind: string; account?: { id: string } | null; group?: { id: string } | null; lastAt: string; unread: boolean };
export const inbox: Command<{ unread?: boolean; after?: string; all?: boolean; max?: number } & WatchInput, unknown> = {
  name: 'inbox', summary: 'The conversations and group chats, the unread first (--unread; --watch)',
  examples: ['breakrocks inbox', 'breakrocks inbox --unread --json', 'breakrocks inbox --watch --jsonl'],
  input: object({ unread: bool('Only those with an unread message'), after: str('The cursor of the next page'), all: bool('Follow the pages'), max: int('Pages at most with --all', { minimum: 1, maximum: 100, default: 10 }), ...WATCH_PROPERTIES }),
  output: outputSchema('InboxPage', 2),
  run: async (ctx, i) => {
    const read = async (after: string | null) => (await api<{ inbox: Page<InboxItem> }>(ctx, `query($after: String) { inbox(after: $after) ${selection('InboxPage', 2)} }`, { after })).inbox;
    const keep = (x: InboxItem) => !i.unread || x.unread;
    if (i.watch) return watchItems(ctx, i, async () => (await read(null)).items.filter(keep), (x) => `${x.kind}:${x.account?.id ?? x.group?.id}@${x.lastAt}`, accountChannel(['inbox', 'discussion.message', 'dm.request', 'group.invitation']));
    const items: InboxItem[] = [];
    let next: string | null = i.after ?? null, rest: Record<string, unknown> = {};
    for (let p = 0; p < (i.all ? i.max ?? 10 : 1); p++) { const r = await read(next); const { items: got, next: n, ...more } = r; rest = more; items.push(...got); next = n; if (!next) break; }
    return { ...rest, items: items.filter(keep), next };
  },
};

/** Sends a message with its media in [to] (sendMessage); its requestId (a UUIDv7) makes it once, and its id is <cell>-<requestId>. */
async function sendTo(ctx: Context, to: Discussion, i: ComposeInput & { respondsTo?: string; unblock?: boolean }, operation: string, shown: Record<string, unknown>) {
  const p = await plan(ctx, i);
  if (i.dryRun) return dryRunOf(p, { operation, ...shown });
  const destination = 'accountId' in to ? 'DIRECT_MESSAGE' : 'groupChatId' in to ? 'GROUP_MESSAGE' : 'CHANNEL_MESSAGE';
  const media = await sendMedia(ctx, p, { destination });
  const input = { to, text: p.text, link: p.link ?? null, respondsTo: i.respondsTo ?? null, ...(i.unblock !== undefined ? { unblock: i.unblock } : {}), images: media.images ?? null, clip: media.clip ?? null };
  return whileProcessing(ctx, async () => (await api<{ sendMessage: unknown }>(ctx, `mutation($input: SendMessageInput!, $requestId: ID!) { sendMessage(input: $input, requestId: $requestId) ${MESSAGE} }`, { input, requestId: p.requestId })).sendMessage, wait(p));
}

const messageRequestId = { requestId: str('An idempotency key (a UUIDv7 of the last 24 hours; one is made when absent): sent again, the message is made once; its id is <cell>-<requestId>', { pattern: '^[0-9a-fA-F-]{36}$' }) };

type DmInput = ComposeInput & { account: string; respondsTo?: string; unblock?: boolean };
export const dm: Command<DmInput, unknown> = {
  name: 'dm', summary: 'Send a direct message: text, images or a clip, a link (sendMessage)',
  description: 'The account by @handle or id. The media as in post. A first message to an account not connected is refused unless it accepts it at once: connections request first. --request-id (a UUIDv7, made when absent) makes the message once even when sent again.',
  examples: ['breakrocks dm @alice "Bonjour !"', 'breakrocks dm @alice "La photo" --image photo.jpg', 'echo "Bonjour" | breakrocks dm @alice -'],
  input: object({ account: str('The account: @handle or its id'), ...composeProps, ...messageRequestId, respondsTo: str('The message answered'), unblock: bool('Unblock the account to write to it') }, ['account']),
  output: outputSchema('Message', 1), args: { positionals: ['account', 'text'] },
  run: async (ctx, i) => (i.dryRun ? sendTo(ctx, { accountId: i.account }, i, 'sendMessage', { account: i.account }) : sendTo(ctx, { accountId: await accountIdOf(ctx, i.account) }, i, 'sendMessage', { account: i.account })),
  quiet: (r) => (r as { id?: string }).id,
};

type ReadInput = { since?: string; after?: string; all?: boolean; max?: number; limit?: number } & WatchInput;
const readProps = { since: str('Only the messages after this: a duration (2h, 30m, 7d) or a date'), after: str('The cursor of the next page'), limit: int('Messages per page', { minimum: 1, maximum: 100 }), all: bool('Follow the pages'), max: int('Pages at most with --all', { minimum: 1, maximum: 100, default: 10 }), ...WATCH_PROPERTIES };

/** Pages of messages (newest first), --since applied. */
async function readMessages<T extends Item>(ctx: Context, read: (after: string | null) => Promise<Page<T>>, i: ReadInput) {
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

/** The messages of a discussion (messages), --watch in real time: the account's channel, or the lease of a channel (watch). */
async function readDiscussion(ctx: Context, discussion: Discussion, i: ReadInput) {
  const read = async (after: string | null) => (await api<{ messages: Page<Item> }>(ctx, `query($d: DiscussionRefInput!, $after: String, $limit: Int) { messages(discussion: $d, after: $after, limit: $limit) ${MESSAGE_PAGE} }`, { d: discussion, after, limit: i.limit ?? null })).messages;
  if (i.watch) {
    const live = 'channel' in discussion
      ? liveOf(ctx, { channel: discussion.channel }, ['discussion.message', 'discussion.messages'])
      : accountChannel(['discussion.message'], sameDiscussion(discussion));
    return watchItems(ctx, i, async () => (await read(null)).items, key, live);
  }
  return readMessages(ctx, read, i);
}

export const dmRead: Command<{ account: string } & ReadInput, unknown> = {
  name: 'dm read', summary: 'The conversation with an account (--since, --all; --watch: each new message)',
  examples: ['breakrocks dm read @alice', 'breakrocks dm read @alice --since 1h --json', 'breakrocks dm read @alice --watch --jsonl'],
  input: object({ account: str('The account: @handle or its id'), ...readProps }, ['account']), output: outputSchema('MessagePage', 2), args: { positionals: ['account'] },
  run: async (ctx, i) => readDiscussion(ctx, { accountId: await accountIdOf(ctx, i.account) }, i),
};

/** Deletes a message of a discussion (deleteMessage), for all or for oneself only. */
const deleteIn = async (ctx: Context, discussion: Discussion, messageId: string, forMe: boolean) =>
  (await api<{ deleteMessage: unknown }>(ctx, `mutation($d: DiscussionRefInput!, $m: ID!, $f: Boolean, $r: ID!) { deleteMessage(discussion: $d, messageId: $m, forMe: $f, requestId: $r) ${MESSAGE} }`, { d: discussion, m: messageId, f: forMe || null, r: uuidv7(ctx.now()) })).deleteMessage;

export const dmDelete: Command<{ id: string; with: string; forMe?: boolean }, unknown> = {
  name: 'dm delete', summary: 'Delete a direct message (for both; --for-me: for oneself only)', examples: ['breakrocks dm delete <message id> --with @alice --yes', 'breakrocks dm delete <message id> --with @alice --for-me --yes'],
  input: object({ id: str('The message'), with: str('The other account of the conversation: @handle or its id'), forMe: bool('Delete it for oneself only (it stays so)') }, ['id', 'with']),
  output: outputSchema('Message', 1), args: { positionals: ['id'] }, interactive: true,
  run: async (ctx, i) => {
    const accountId = await accountIdOf(ctx, i.with);
    await ctx.confirm(`Delete the message ${i.id}${i.forMe ? ' for yourself' : ' for both'}?`);
    return deleteIn(ctx, { accountId }, i.id, !!i.forMe);
  },
  quiet: (r) => (r as { id?: string } | null)?.id,
};

export const dmEphemeral: Command<{ account: string; duration: string }, unknown> = {
  name: 'dm ephemeral', summary: 'Make the messages of a conversation disappear after 24h or 7d (off: kept)', examples: ['breakrocks dm ephemeral @alice 24h', 'breakrocks dm ephemeral @alice off'],
  input: object({ account: str('The account: @handle or its id'), duration: str('24h, 7d or off', { enum: ['24h', '7d', 'off'] }) }, ['account', 'duration']), output: { type: 'boolean' }, args: { positionals: ['account', 'duration'] },
  run: async (ctx, i) => (await api<{ setConversationEphemeral: boolean }>(ctx, 'mutation($a: ID!, $d: EphemeralDuration!, $r: ID!) { setConversationEphemeral(accountId: $a, duration: $d, requestId: $r) }', { a: await accountIdOf(ctx, i.account), d: durationOf(i.duration), r: uuidv7(ctx.now()) })).setConversationEphemeral,
};

export const groupsCreate: Command<{ name: string; accounts?: string[]; description?: string }, unknown> = {
  name: 'groups create', summary: 'Create a group chat with its members (19 at most, each connected)', description: 'The group is made even when some invitations are refused: they are told (GROUP_INVITATIONS_REFUSED, each account with its code).',
  examples: ['breakrocks groups create "Les amis du vélo" @alice @bob', 'breakrocks groups create relais @scribe --description "Les agents"'],
  input: object({ name: str('Its name'), accounts: list('Its members: @handles or ids', { type: 'string' }, { maxItems: 19 }), description: str('Its description') }, ['name']),
  output: openObject({ group: outputSchema('GroupChat', 1), refused: list('Invitations refused', openObject({ accountId: str('Account'), code: str('Code') })) }), args: { positionals: ['name', 'accounts'] },
  run: async (ctx, i) => {
    const invite = await Promise.all((i.accounts ?? []).map((a) => accountIdOf(ctx, a)));
    const r = await api<{ createGroupChat: unknown; _errors?: { errorType?: string; errorInfo?: { refused?: unknown[] } }[] }>(ctx, `mutation($n: String!, $d: String, $i: [ID!], $r: ID!) { createGroupChat(name: $n, description: $d, invite: $i, requestId: $r) ${selection('GroupChat', 1)} }`, { n: i.name, d: i.description ?? null, i: invite, r: uuidv7(ctx.now()) }, { partial: true });
    const refused = r._errors?.find((e) => e.errorType === 'GROUP_INVITATIONS_REFUSED')?.errorInfo?.refused ?? [];
    return { group: r.createGroupChat, refused };
  },
  quiet: (r) => (r as { group?: { id?: string } }).group?.id,
};

type GroupItem = { kind: string; lastAt: string; unread: boolean; group?: { id: string; name: string; memberCount: number } | null };
export const groupsList: Command<{ max?: number }, unknown> = {
  name: 'groups list', summary: 'The group chats of the account (inbox GROUP_CHAT)', examples: ['breakrocks groups list --json'],
  input: object({ max: int('Pages of the inbox read at most', { minimum: 1, maximum: 100, default: 10 }) }), output: { type: 'array', items: outputSchema('GroupRef', 0) },
  run: async (ctx, { max = 10 }) => {
    const groups: unknown[] = [];
    let next: string | null = null;
    for (let p = 0; p < max; p++) {
      const r: Page<GroupItem> = (await api<{ inbox: Page<GroupItem> }>(ctx, 'query($after: String) { inbox(kind: GROUP_CHAT, after: $after) { items { kind lastAt unread group { id name memberCount } } next } }', { after: next })).inbox;
      groups.push(...r.items.filter((x) => x.group).map((x) => ({ ...x.group, lastAt: x.lastAt, unread: x.unread })));
      next = r.next;
      if (!next) break;
    }
    return groups;
  },
};

const grp = { id: 'The group chat' };
const onGroup = { rename: { groupChatId: 'id' }, descriptions: { ...grp, account: 'The account: @handle or its id' } };
export const groupsShow = apiCommand({ name: 'groups show', summary: 'A group chat', kind: 'query', op: 'groupChat', positionals: ['id'], descriptions: grp, examples: ['breakrocks groups show <group id>'] });
export const groupsSend: Command<ComposeInput & { id: string; respondsTo?: string }, unknown> = {
  name: 'groups send', summary: 'Send a message in a group chat, with its media (sendMessage)', examples: ['breakrocks groups send <group id> "Rendez-vous à 18 h"', 'breakrocks groups send <group id> --file note.md --image plan.png'],
  input: object({ id: str('The group chat'), ...composeProps, ...messageRequestId, respondsTo: str('The message answered') }, ['id']), output: outputSchema('Message', 1), args: { positionals: ['id', 'text'] },
  run: async (ctx, i) => sendTo(ctx, { groupChatId: i.id }, i, 'sendMessage', { id: i.id }),
  quiet: (r) => (r as { id?: string }).id,
};
export const groupsRead: Command<{ id: string } & ReadInput, unknown> = {
  name: 'groups read', summary: 'The messages of a group chat (--since, --all; --watch)', examples: ['breakrocks groups read <group id>', 'breakrocks groups read <group id> --watch --jsonl'],
  input: object({ id: str('The group chat'), ...readProps }, ['id']), output: outputSchema('MessagePage', 2), args: { positionals: ['id'] },
  run: async (ctx, i) => readDiscussion(ctx, { groupChatId: i.id }, i),
};
export const groupsInvite = apiCommand({ name: 'groups invite', summary: 'Invite an account to a group chat', kind: 'mutation', op: 'inviteToGroupChat', positionals: ['groupChatId', 'accountId'], ...onGroup, rename: { groupChatId: 'id', accountId: 'account' }, examples: ['breakrocks groups invite <group id> @alice'] });
export const groupsLeave = apiCommand({ name: 'groups leave', summary: 'Leave a group chat', kind: 'mutation', op: 'leaveGroupChat', positionals: ['groupChatId'], ...onGroup, confirm: (i) => `Leave the group chat ${i.id}?`, examples: ['breakrocks groups leave <group id> --yes'] });
export const groupsMembers = apiCommand({ name: 'groups members', summary: 'The members of a group chat', kind: 'query', op: 'groupChatMembers', positionals: ['groupChatId'], ...onGroup, examples: ['breakrocks groups members <group id>'] });
export const groupsAdmins: Command<{ id: string }, unknown> = {
  name: 'groups admins', summary: 'The admins of a group chat', examples: ['breakrocks groups admins <group id>'],
  input: object({ id: str('The group chat') }, ['id']), output: { type: 'array', items: outputSchema('GroupMember', 1) }, args: { positionals: ['id'] },
  run: async (ctx, { id }) => ((await api<{ groupChatMembers: { role: string }[] | null }>(ctx, `query($id: ID!) { groupChatMembers(groupChatId: $id) ${selection('GroupMember', 1)} }`, { id })).groupChatMembers ?? []).filter((m) => m.role.toLowerCase() !== 'member'),
};
export const groupsAdminAdd = apiCommand({ name: 'groups admin-add', summary: 'Name an admin of a group chat (setGroupChatAdmin)', kind: 'mutation', op: 'setGroupChatAdmin', fixed: { admin: true }, positionals: ['groupChatId', 'accountId'], ...onGroup, rename: { groupChatId: 'id', accountId: 'account' }, examples: ['breakrocks groups admin-add <group id> @alice'] });
export const groupsAdminRemove = apiCommand({ name: 'groups admin-remove', summary: 'Remove an admin of a group chat (setGroupChatAdmin)', kind: 'mutation', op: 'setGroupChatAdmin', fixed: { admin: false }, positionals: ['groupChatId', 'accountId'], ...onGroup, rename: { groupChatId: 'id', accountId: 'account' }, examples: ['breakrocks groups admin-remove <group id> @alice'] });
export const groupsEphemeral: Command<{ id: string; duration: string }, unknown> = {
  name: 'groups ephemeral', summary: 'Make the messages of a group chat disappear after 24h or 7d (off: kept)', examples: ['breakrocks groups ephemeral <group id> 7d'],
  input: object({ id: str('The group chat'), duration: str('24h, 7d or off', { enum: ['24h', '7d', 'off'] }) }, ['id', 'duration']), output: outputSchema('GroupChat', 1), args: { positionals: ['id', 'duration'] },
  run: async (ctx, i) => (await api<{ setGroupChatEphemeral: unknown }>(ctx, `mutation($id: ID!, $d: EphemeralDuration!, $r: ID!) { setGroupChatEphemeral(groupChatId: $id, duration: $d, requestId: $r) ${selection('GroupChat', 1)} }`, { id: i.id, d: durationOf(i.duration), r: uuidv7(ctx.now()) })).setGroupChatEphemeral,
  quiet: (r) => (r as { id?: string } | null)?.id,
};
export const groupsInvitations = apiCommand({ name: 'groups invitations', summary: 'The invitations to group chats received (--sent: sent)', kind: 'query', op: 'groupChatInvitations', examples: ['breakrocks groups invitations', 'breakrocks groups invitations --sent'] });
const invitation = { rename: { groupChatId: 'id' }, positionals: ['groupChatId'], descriptions: { id: 'The group chat of the invitation', openly: 'Tell the inviter', reason: 'The reason told' } };
export const groupsAccept = apiCommand({ name: 'groups accept', summary: 'Accept an invitation to a group chat (answerGroupChatInvitation)', kind: 'mutation', op: 'answerGroupChatInvitation', fixed: { accept: true }, hide: ['openly', 'reason'], ...invitation, examples: ['breakrocks groups accept <group id>'] });
export const groupsDecline = apiCommand({ name: 'groups decline', summary: 'Decline an invitation to a group chat (--openly, --reason; answerGroupChatInvitation)', kind: 'mutation', op: 'answerGroupChatInvitation', fixed: { accept: false }, ...invitation, examples: ['breakrocks groups decline <group id> --openly --reason "Pas le temps"'] });

// The channels of a universe: their messages are those of a discussion { channel }.
const ch = { channel: 'The channel (%universe~name)' };
export const channelsSend: Command<ComposeInput & { channel: string; respondsTo?: string }, unknown> = {
  name: 'channels send', summary: 'Send a message in a channel, with its media (sendMessage)', examples: ['breakrocks channels send %paris~velo "Rendez-vous à 18 h"'],
  input: object({ channel: str(ch.channel), ...composeProps, ...messageRequestId, respondsTo: str('The message answered') }, ['channel']), output: outputSchema('Message', 1), args: { positionals: ['channel', 'text'] },
  run: async (ctx, i) => sendTo(ctx, { channel: i.channel }, i, 'sendMessage', { channel: i.channel }),
  quiet: (r) => (r as { id?: string }).id,
};
export const channelsRead: Command<{ channel: string } & ReadInput, unknown> = {
  name: 'channels read', summary: 'The messages of a channel (--since, --all; --watch: its lease, then each new message)', examples: ['breakrocks channels read %paris~velo --json', 'breakrocks channels read %team-fra.~general --watch --jsonl'],
  input: object({ channel: str(ch.channel), ...readProps }, ['channel']), output: outputSchema('MessagePage', 2), args: { positionals: ['channel'] },
  run: async (ctx, i) => readDiscussion(ctx, { channel: i.channel }, i),
};

const acc = { account: 'The account: @handle or its id' };
export const connectionsRequest: Command<{ account: string; text: string; requestId?: string; unblock?: boolean }, unknown> = {
  name: 'connections request', summary: 'Send a connection request with a message (requestConnection)', examples: ['breakrocks connections request @alice "Bonjour, je suis l\'agent de Atlas"'],
  input: object({ account: str('The account: @handle or its id'), text: str('The message of the request'), ...messageRequestId, unblock: bool('Unblock the account to send it') }, ['account', 'text']),
  output: outputSchema('ConnectionState', 1), args: { positionals: ['account', 'text'] },
  run: async (ctx, i) => (await api<{ requestConnection: unknown }>(ctx, `mutation($a: ID!, $t: String!, $u: Boolean, $r: ID!) { requestConnection(accountId: $a, text: $t, unblock: $u, requestId: $r) ${selection('ConnectionState', 1)} }`, { a: await accountIdOf(ctx, i.account), t: i.text, u: i.unblock ?? null, r: i.requestId ?? uuidv7(ctx.now()) })).requestConnection,
};
const answer = { positionals: ['accountId'], rename: { accountId: 'account' }, descriptions: { ...acc, openly: 'Tell the sender', reason: 'The reason told' } };
export const connectionsAccept = apiCommand({ name: 'connections accept', summary: 'Accept the connection request of an account (answerConnectionRequest)', kind: 'mutation', op: 'answerConnectionRequest', fixed: { accept: true }, hide: ['openly', 'reason'], ...answer, examples: ['breakrocks connections accept @alice'] });
export const connectionsDecline = apiCommand({ name: 'connections decline', summary: 'Decline the connection request of an account (--openly, --reason; answerConnectionRequest)', kind: 'mutation', op: 'answerConnectionRequest', fixed: { accept: false }, ...answer, examples: ['breakrocks connections decline @spam'] });
export const connectionsRemove = apiCommand({ name: 'connections remove', summary: 'End the connection with an account', kind: 'mutation', op: 'removeConnection', positionals: ['accountId'], rename: { accountId: 'account' }, descriptions: acc, confirm: (i) => `End the connection with ${i.account}?`, examples: ['breakrocks connections remove @alice --yes'] });
export const connectionsList = apiCommand({ name: 'connections list', summary: 'The accounts connected (myAccounts CONNECTED)', kind: 'query', op: 'myAccounts', fixed: { list: 'CONNECTED' }, examples: ['breakrocks connections list --all'] });
export const connectionsRequests = apiCommand({ name: 'connections requests', summary: 'The connection requests received (--sent: sent)', kind: 'query', op: 'connectionRequests', examples: ['breakrocks connections requests', 'breakrocks connections requests --sent'] });
export const connectionsState: Command<{ account: string }, unknown> = {
  name: 'connections state', summary: 'Whether a request can be sent, whether a first message connects at once (connectionStates)', examples: ['breakrocks connections state @alice'],
  input: object({ account: str(acc.account) }, ['account']), output: outputSchema('ConnectionState', 1), args: { positionals: ['account'] },
  run: async (ctx, i) => ((await api<{ connectionStates: unknown[] | null }>(ctx, `query($ids: [ID!]!) { connectionStates(accountIds: $ids) ${selection('ConnectionState', 1)} }`, { ids: [await accountIdOf(ctx, i.account)] })).connectionStates ?? [])[0] ?? null,
};

export const messagingShow = apiCommand({ name: 'messaging settings show', summary: 'The settings of the messages (mySettings.messaging)', kind: 'query', op: 'mySettings', select: `{ messaging ${selection('MessagingSettings', 1)} }`, map: (d) => (d as { messaging?: unknown } | null)?.messaging ?? null, examples: ['breakrocks messaging settings show'] });
export const messagingSet = apiCommand({
  name: 'messaging settings set', summary: 'Change the settings of the messages (read receipts, who may write or invite, agent requests…; setSettings)', kind: 'mutation', op: 'setSettings', flatten: ['input', 'input.messaging'],
  hide: ['input.notifications', 'input.translation', 'input.recommendations', 'input.nearbyLabel', 'input.subtitles', 'input.tips', 'input.universeFrame', 'input.clear'],
  select: `{ messaging ${selection('MessagingSettings', 1)} }`, map: (d) => (d as { messaging?: unknown } | null)?.messaging ?? null,
  examples: ['breakrocks messaging settings set --read-receipts false', 'breakrocks messaging settings set --agent-requests decline'],
});
