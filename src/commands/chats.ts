// Connections and private messages (D-92, D-303: the operations of before specs v83.1.0 still without a command):
// the connected accounts, the deletion of a conversation, what a group chat admin changes (its name, its
// description, its members, its meeting point), the mute of a group chat, and what works in any discussion (a
// conversation, a group chat, a universe discussion: --with, --group or --channel): edit a message, say one types,
// catch up the changes, pin a message, silence the discussion, send a quick poll and pick one of its choices.
import { apiCommand } from '../api/command.js';
import { selection } from '../api/graphql.js';
import { usageError } from '../errors.js';
import { discussionTarget, doneText, listText, oneDiscussion, pageText, pointOf } from './shared.js';

const MESSAGE = selection('Message', 1);
type Message = { id: string; createdAt?: string; author?: { handle?: string } | null; text?: string | null; deletedForMe?: boolean; editedAt?: string | null };
const messageLine = (m: Message) => `${m.id}  ${m.createdAt ?? ''}  @${m.author?.handle ?? '?'}  ${m.deletedForMe ? '(deleted for me)' : (m.text ?? '').replace(/\s+/g, ' ')}`;
const messageText = (r: unknown) => (r ? messageLine(r as Message) : '(none)');
const targetHelp = 'Name the discussion with exactly one of --with (a conversation: @handle or its id), --group (a group chat id) or --channel (a universe discussion: %paris&general).';
const inDiscussion = { ...discussionTarget, prepare: oneDiscussion };

export const connectionsMine = apiCommand({
  name: 'connections mine', summary: 'The connected accounts, in a stable order, without those blocked either way (myConnections)', kind: 'query', op: 'myConnections',
  text: pageText((a: { id: string; handle?: string; displayName?: string }) => `@${a.handle ?? '?'}  ${a.displayName ?? ''}  ${a.id}`),
  examples: ['breakrocks connections mine', 'breakrocks connections mine --all --json'],
});
export const dmDeleteConversation = apiCommand({
  name: 'dm delete-conversation', summary: 'Delete a conversation for yourself: its messages are no longer shown to you (deleteConversation)', kind: 'mutation', op: 'deleteConversation', positionals: ['accountId'], rename: { accountId: 'with' },
  descriptions: { with: 'The other account of the conversation: @handle or its id' }, confirm: (i) => `Delete the conversation with ${String(i.with)}?`, text: doneText,
  examples: ['breakrocks dm delete-conversation @alice --yes'],
});

// ---- Group chats ----

const group = { rename: { groupChatId: 'id' }, descriptions: { id: 'The group chat (its id)', account: 'The account: @handle or its id' } };
type GroupChat = { id: string; name?: string | null; description?: string | null; announcement?: boolean; membersCanInvite?: boolean; memberCount?: number; muted?: boolean; meetingPoint?: { name?: string } | null };
const groupText = (r: unknown) => {
  const g = r as GroupChat | null;
  return g ? [`${g.id}  ${g.name ?? '(no name)'}${g.memberCount != null ? `  ${g.memberCount} member(s)` : ''}${g.announcement ? '  announcements only' : ''}${g.muted ? '  muted' : ''}`, ...(g.description ? [g.description] : []), ...(g.meetingPoint?.name ? [`meeting point: ${g.meetingPoint.name}`] : [])].join('\n') : '(none)';
};
export const groupsEdit = apiCommand({
  name: 'groups edit', summary: 'Change a group chat: its name, its description, announcements only, whether members may invite (changeGroupChat; its admins)',
  description: 'Only what is given changes; --description "" removes it.', kind: 'mutation', op: 'changeGroupChat', positionals: ['groupChatId'], hide: ['expected'], dry: true, ...group,
  text: groupText, examples: ['breakrocks groups edit <group id> --name "Club ride" --members-can-invite', 'breakrocks groups edit <group id> --announcement --description "Ride news"'],
});
export const groupsRemove = apiCommand({
  name: 'groups remove', summary: 'Remove a member from a group chat (removeGroupChatMember; its admins)', kind: 'mutation', op: 'removeGroupChatMember', positionals: ['groupChatId', 'accountId'],
  ...group, rename: { groupChatId: 'id', accountId: 'account' }, confirm: (i) => `Remove ${String(i.account)} from the group chat ${String(i.id)}?`, text: groupText,
  examples: ['breakrocks groups remove <group id> @bob --yes'],
});
export const groupsMeetingPoint = apiCommand({
  name: 'groups meeting-point', summary: 'Set the meeting point of a group chat: a name and a point (--clear: remove it) (setMeetingPoint)', kind: 'mutation', op: 'setMeetingPoint', positionals: ['groupChatId'], hide: ['place'], ...group,
  extra: { name: { type: 'string', description: 'The name of the place' }, point: { type: 'string', description: 'The point: <lat>,<lon>' }, clear: { type: 'boolean', description: 'Remove the meeting point' } },
  prepare: (i) => {
    const { name, point, clear, ...rest } = i;
    if (clear) { if (name !== undefined || point !== undefined) throw usageError('INVALID_INPUT', '--clear, or --name and --point'); return { ...rest, place: null }; }
    if (name === undefined || point === undefined) throw usageError('INVALID_INPUT', '--name and --point <lat>,<lon> (or --clear)');
    return { ...rest, place: { name, point: pointOf(String(point), '--point') } };
  },
  text: groupText, examples: ['breakrocks groups meeting-point <group id> --name "Bastille" --point 48.8532,2.3691', 'breakrocks groups meeting-point <group id> --clear'],
});
export const groupsStepDown = apiCommand({
  name: 'groups step-down', summary: 'Stop being an admin of a group chat (stepDownAsGroupChatAdmin)', kind: 'mutation', op: 'stepDownAsGroupChatAdmin', positionals: ['groupChatId'], ...group,
  confirm: (i) => `Stop being an admin of the group chat ${String(i.id)}?`, text: groupText, examples: ['breakrocks groups step-down <group id> --yes'],
});
const groupMute = (muted: boolean) => apiCommand({
  name: `groups ${muted ? 'mute' : 'unmute'}`, summary: muted ? 'Mute a group chat for yourself (setGroupChatMuted; --mentions: still notified when mentioned)' : 'Unmute a group chat (setGroupChatMuted)',
  kind: 'mutation', op: 'setGroupChatMuted', fixed: { muted }, positionals: ['groupChatId'], ...group, ...(muted ? {} : { hide: ['mentions'] }),
  descriptions: { ...group.descriptions, mentions: 'Still notified when mentioned' }, text: groupText,
  examples: [`breakrocks groups ${muted ? 'mute' : 'unmute'} <group id>${muted ? ' --mentions' : ''}`],
});
export const groupsMute = groupMute(true);
export const groupsUnmute = groupMute(false);

// ---- Any discussion: a conversation, a group chat, a universe discussion ----

export const messagesEdit = apiCommand({
  name: 'messages edit', summary: 'Edit the text of one of your messages (changeMessage)', description: targetHelp,
  kind: 'mutation', op: 'changeMessage', positionals: ['messageId', 'text'], select: MESSAGE, dry: true, ...inDiscussion,
  descriptions: { ...discussionTarget.descriptions, messageId: 'The message', text: 'Its new text' }, text: messageText,
  examples: ['breakrocks messages edit <message id> "See you at 8" --with @alice', 'breakrocks messages edit <message id> "Fixed" --channel %paris&general'],
});
export const messagesTyping = apiCommand({
  name: 'messages typing', summary: 'Say you are typing in a discussion: shown for 5 seconds, never stored (typing)', description: `${targetHelp} At most one every 3 seconds is published.`,
  kind: 'mutation', op: 'typing', ...inDiscussion, text: doneText, examples: ['breakrocks messages typing --with @alice'],
});
export const messagesChanges = apiCommand({
  name: 'messages changes', summary: 'Catch up: the messages of a discussion changed or deleted since a time, at most 30 days back (messageChanges)', description: targetHelp,
  kind: 'query', op: 'messageChanges', ...inDiscussion, descriptions: { ...discussionTarget.descriptions, since: 'Since when (ISO 8601)' }, depth: 1,
  text: pageText(messageLine), examples: ['breakrocks messages changes --group <group id> --since 2026-11-07T00:00:00Z'],
});
export const messagesPinned = apiCommand({
  name: 'messages pinned', summary: 'The pinned messages of a group chat or a universe discussion, the most recent first, 3 at most (pinnedMessages)', description: targetHelp,
  kind: 'query', op: 'pinnedMessages', ...inDiscussion, select: MESSAGE, text: listText(messageLine), examples: ['breakrocks messages pinned --channel %paris&general'],
});
const pin = (pinned: boolean) => apiCommand({
  name: `messages ${pinned ? 'pin' : 'unpin'}`, summary: pinned ? 'Pin a message of a group chat or a universe discussion for everyone: its admins or moderators, 3 at most (setPinnedMessage)' : 'Unpin a message (setPinnedMessage)',
  description: targetHelp, kind: 'mutation', op: 'setPinnedMessage', fixed: { pinned }, positionals: ['messageId'], ...inDiscussion, select: MESSAGE,
  descriptions: { ...discussionTarget.descriptions, messageId: 'The message' }, text: listText(messageLine),
  examples: [`breakrocks messages ${pinned ? 'pin' : 'unpin'} <message id> --group <group id>`],
});
export const messagesPin = pin(true);
export const messagesUnpin = pin(false);
const silence = (silenced: boolean) => apiCommand({
  name: `messages ${silenced ? 'silence' : 'unsilence'}`, summary: silenced ? 'Silence a discussion for yourself: readable, without notifications, for 1, 8 or 24 hours, or always (setDiscussionSilence)' : 'End the silence of a discussion (setDiscussionSilence)',
  description: targetHelp, kind: 'mutation', op: 'setDiscussionSilence', fixed: { silenced }, ...inDiscussion, ...(silenced ? {} : { hide: ['hours'] }),
  descriptions: { ...discussionTarget.descriptions, hours: '1, 8 or 24; none: always' }, text: doneText,
  examples: [silenced ? 'breakrocks messages silence --channel %paris&general --hours 8' : 'breakrocks messages unsilence --channel %paris&general'],
});
export const messagesSilence = silence(true);
export const messagesUnsilence = silence(false);
export const messagesQuickPoll = apiCommand({
  name: 'messages quick-poll', summary: 'Send a quick poll in a discussion: 2 to 10 choices, closed after 24 hours, not a poll of the governance (sendQuickPoll)', description: targetHelp,
  kind: 'mutation', op: 'sendQuickPoll', positionals: ['question'], ...inDiscussion, select: MESSAGE, dry: true,
  descriptions: { ...discussionTarget.descriptions, question: 'The question', choices: 'The choices, 2 to 10 (commas, or the flag repeated)' }, text: messageText,
  examples: ['breakrocks messages quick-poll "Ride on Sunday?" --choices yes,no --group <group id>'],
});
export const messagesQuickPollPick = apiCommand({
  name: 'messages quick-poll-pick', summary: 'Pick a choice of a quick poll (pickQuickPollChoice; the first choice is 0)', kind: 'mutation', op: 'pickQuickPollChoice', positionals: ['messageId', 'choice'], select: MESSAGE,
  descriptions: { messageId: 'The message of the quick poll', choice: 'The choice: its index, the first is 0' }, text: messageText,
  examples: ['breakrocks messages quick-poll-pick <message id> 0'],
});

export const chatCommands = [
  connectionsMine, dmDeleteConversation, groupsEdit, groupsRemove, groupsMeetingPoint, groupsStepDown, groupsMute, groupsUnmute,
  messagesEdit, messagesTyping, messagesChanges, messagesPinned, messagesPin, messagesUnpin, messagesSilence, messagesUnsilence, messagesQuickPoll, messagesQuickPollPick,
];
