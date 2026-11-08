// The universe discussions (D-245, specs v83.0.0): their list, their page and the ones with unread
// messages; and, on a message of a discussion, its reactions (a free emoji) and its thread. A reaction or a
// reply is a write: --dry-run tells what would be sent, nothing more. The refusals are the platform's.
import { apiCommand } from '../api/command.js';
import { selection } from '../api/graphql.js';
import type { Context } from '../context.js';
import { usageError } from '../errors.js';
import { api } from '../session.js';

/** The id of a universe discussion given by its address (%paris&velo; a channel too) or by its id. */
export async function discussionIdOf(ctx: Context, value: string): Promise<string> {
  const v = value.trim();
  if (!v.startsWith('%')) return v;
  if (/~[^/~&]+$/.test(v)) throw usageError('INVALID_INPUT', `${v}: a channel is %universe&name ("~" is the sign of a live)`);
  const d = (await api<{ universeDiscussion: { id: string } | null }>(ctx, 'query($a: String!) { universeDiscussion(address: $a) { id } }', { a: v })).universeDiscussion;
  if (!d) throw usageError('CHANNEL_NOT_FOUND', `No universe discussion ${v}`, { address: v });
  return d.id;
}
/** "%paris" and "velo" (or "&velo") → "%paris&velo". */
export const discussionAddress = (universe: string, name: string) => `${universe}&${name.replace(/^&/, '')}`;

type Silence = { until?: string | null; always?: boolean } | null;
export type DiscussionView = {
  address: string; status?: string; lifetime?: string; subject?: string | null; presentCount?: number; unread?: number; mentionedMe?: boolean; muted?: boolean;
  silence?: Silence; messageTtlSeconds?: number | null; messageCount?: number; archived?: boolean;
};

/** "7d", "6h", "90s": how long a message is kept, from messageTtlSeconds. */
export function ttlText(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '-';
  if (seconds > 0 && seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds > 0 && seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${seconds}s`;
}
/** "always", "until <date>", "-". */
export const silenceText = (s: Silence | undefined) => (!s ? '-' : s.always ? 'always' : `until ${s.until ?? '?'}`);

/** One line per discussion: its address, its state, who reads it now, what is unread, how long its messages are kept, its silence. */
export const discussionLine = (d: DiscussionView) =>
  `${d.address}  ${d.status ?? '-'}  present ${d.presentCount ?? 0}  unread ${d.unread ?? 0}${d.mentionedMe ? ' (mentions you)' : ''}  kept ${ttlText(d.messageTtlSeconds)}  silence ${silenceText(d.silence)}${d.muted ? '  muted' : ''}`;

const discussionText = (d: DiscussionView) => [
  `${d.address}${d.subject ? `  ${d.subject}` : ''}`,
  `state: ${d.status ?? '-'}${d.lifetime ? ` (${d.lifetime})` : ''}${d.archived ? ', archived' : ''}   messages: ${d.messageCount ?? '-'}`,
  `present now: ${d.presentCount ?? 0} (approximate)`,
  `unread: ${d.unread ?? 0}   mentioned me: ${d.mentionedMe ? 'yes' : 'no'}`,
  `silence: ${silenceText(d.silence)}   muted: ${d.muted ? 'yes' : 'no'}`,
  `messages kept: ${ttlText(d.messageTtlSeconds)}${d.messageTtlSeconds != null ? ` (${d.messageTtlSeconds} s)` : ''}`,
].join('\n');

const address = { address: 'The universe discussion: its address with its sign (%paris&general)' };
export const discussionsShow = apiCommand({
  name: 'discussions show', summary: 'A universe discussion: its state, who reads it now, unread, mentions, silence, how long its messages are kept (universeDiscussion)',
  kind: 'query', op: 'universeDiscussion', positionals: ['address'], descriptions: address,
  text: (r) => (r ? discussionText(r as DiscussionView) : '(none)'),
  examples: ['breakrocks discussions show %paris&general', 'breakrocks discussions show %paris&general --json'],
});

export const discussionsList = apiCommand({
  name: 'discussions list', summary: 'The universe discussions of a universe: present now, unread, mentions, silence, retention (universeDiscussions; --all-levels: of its sub-universes too)',
  kind: 'query', op: 'universeDiscussions', positionals: ['universe'], descriptions: { universe: 'The universe (%name, %name/sub)' },
  text: (r) => { const l = r as { items?: DiscussionView[] } | null; return l?.items?.length ? l.items.map(discussionLine).join('\n') : '(none)'; },
  examples: ['breakrocks discussions list %paris', 'breakrocks discussions list %paris --all-levels --json'],
});

export const discussionsUnread = apiCommand({
  name: 'discussions unread', summary: 'The universe discussions with unread messages, across the universes of the account, the latest message first (myUnreadDiscussions)',
  description: 'A silenced or muted discussion is listed too (its silence and muted state tell it). --limit from 1 to 50 (20 by default).',
  kind: 'query', op: 'myUnreadDiscussions',
  text: (r) => { const l = r as { items?: DiscussionView[]; next?: string | null } | null; return l?.items?.length ? [...l.items.map(discussionLine), ...(l.next ? [`next: ${l.next}`] : [])].join('\n') : '(none)'; },
  examples: ['breakrocks discussions unread', 'breakrocks discussions unread --limit 50 --all --json'],
});

const MESSAGE = selection('Message', 1);
type ReactionView = { id?: string; reactions?: { reaction: string; count: number }[]; myReactions?: string[]; threadRoot?: string | null; threadReplyCount?: number };
const reactionsText = (r: unknown) => {
  const m = r as ReactionView | null;
  if (!m) return '(none)';
  const mine = new Set(m.myReactions ?? []);
  return `${m.id}: ${m.reactions?.length ? m.reactions.map((x) => `${x.reaction} ${x.count}${mine.has(x.reaction) ? ' (yours)' : ''}`).join(', ') : 'no reaction'}`;
};
const message = { messageId: 'The message of the universe discussion', emoji: 'Exactly one emoji (up to 20 distinct emoji per message)', text: 'The reply (2,000 visible characters at most)' };

export const messagesReact = apiCommand({
  name: 'messages react', summary: 'React to a message of a universe discussion with one emoji (reactToMessage; adding it again changes nothing)',
  kind: 'mutation', op: 'reactToMessage', positionals: ['messageId', 'reaction'], rename: { reaction: 'emoji' }, descriptions: message, select: MESSAGE, dry: true, text: reactionsText,
  examples: ['breakrocks messages react <message id> 👍', 'breakrocks messages react <message id> 🎉 --dry-run'],
});
export const messagesUnreact = apiCommand({
  name: 'messages unreact', summary: 'Remove your reaction from a message of a universe discussion (unreactToMessage; one you did not add: nothing changes)',
  kind: 'mutation', op: 'unreactToMessage', positionals: ['messageId', 'reaction'], rename: { reaction: 'emoji' }, descriptions: message, select: MESSAGE, dry: true, text: reactionsText,
  examples: ['breakrocks messages unreact <message id> 👍'],
});
export const messagesThread = apiCommand({
  name: 'messages thread', summary: 'The thread replies of a message of a universe discussion, the oldest first (threadMessages; --all)',
  description: 'The replies only, not the message itself; a message with no thread: none. --limit from 1 to 100 (50 by default).',
  kind: 'query', op: 'threadMessages', positionals: ['messageId'], descriptions: message, select: `{ items ${MESSAGE} next }`,
  text: (r) => { const p = r as { items?: { id: string; createdAt: string; text?: string | null; deleted?: boolean; author?: { handle?: string | null } | null }[]; next?: string | null } | null; return p?.items?.length ? [...p.items.map((m) => `${m.createdAt}  ${m.author?.handle ? `@${m.author.handle}` : '-'}  ${m.deleted ? '(deleted)' : (m.text ?? '')}  [${m.id}]`), ...(p.next ? [`next: ${p.next}`] : [])].join('\n') : '(no reply)'; },
  examples: ['breakrocks messages thread <message id>', 'breakrocks messages thread <message id> --all --json'],
});
export const messagesReplyThread = apiCommand({
  name: 'messages reply-thread', summary: 'Reply in the thread of a message of a universe discussion (replyInThread)',
  description: 'The reply is a message of the discussion, shown in the thread only; a thread has one level (a reply to a reply goes to the thread of its root). The rules of a message apply (slow mode, writing ban, delegated agents). --request-id makes it once even when sent again.',
  kind: 'mutation', op: 'replyInThread', positionals: ['messageId'], descriptions: message, select: MESSAGE, dry: true,
  text: (r) => { const m = r as { id?: string; threadRoot?: string | null } | null; return m ? `${m.id} replied in the thread of ${m.threadRoot ?? '?'}` : '(none)'; },
  examples: ['breakrocks messages reply-thread <message id> --text "Good idea"'],
});

/** The text of a deleteMessage answer: the message as the caller sees it now. */
const deleteText = (r: unknown) => {
  const m = r as { id?: string; deleted?: boolean; deletedBy?: string | null; deletedForMe?: boolean } | null;
  return m ? `${m.id}: ${m.deleted ? `deleted${m.deletedBy ? ` (by ${String(m.deletedBy).toLowerCase()})` : ''}` : m.deletedForMe ? 'deleted for you' : 'not deleted'}` : '(none)';
};
export const messagesDelete = apiCommand({
  name: 'messages delete', summary: 'Delete a message of a universe discussion, a channel or a group chat, for everyone (--for-me: for yourself only) (deleteMessage)',
  description: 'Name the discussion with exactly one of --channel (a channel or a universe discussion: %paris&general), --group (a group chat id) or --with (a conversation: @handle or id). You delete your own message; the same mutation also lets a group chat admin or a channel moderator delete the message of another for everyone (the platform decides: MESSAGE_NOT_AUTHOR otherwise). --for-me hides it for you only, whoever wrote it. Irreversible: asks for --yes. --dry-run tells what would be sent.',
  kind: 'mutation', op: 'deleteMessage', flatten: ['discussion'], positionals: ['messageId'], select: MESSAGE, dry: true,
  rename: { 'discussion.groupChatId': 'group', 'discussion.accountId': 'with' },
  descriptions: { messageId: 'The message', channel: 'The channel or universe discussion that holds it (%paris&general, %paris&velo)', group: 'The group chat that holds it (its id)', with: 'The other account of the conversation that holds it: @handle or its id', forMe: 'Delete it for yourself only (it stays for the others)' },
  prepare: (i) => {
    const targets = ['channel', 'group', 'with'].filter((k) => i[k] !== undefined);
    if (targets.length !== 1) throw usageError('DISCUSSION_TARGET_INVALID', 'Name the discussion with exactly one of --channel, --group or --with');
    return i;
  },
  confirm: (i) => `Delete the message ${String(i.messageId)}${i.forMe ? ' for yourself' : ' for everyone'}?`,
  text: deleteText,
  examples: ['breakrocks messages delete <message id> --channel %paris&general --yes', 'breakrocks messages delete <message id> --group <group id> --for-me --yes', 'breakrocks messages delete <message id> --channel %paris&general --dry-run'],
});
