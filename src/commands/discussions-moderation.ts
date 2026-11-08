// The universe discussions of a universe and their moderation (D-92, D-303: the operations "*UniverseDiscussion*" of
// before specs v83.1.0 still without a command): those joined, the limits, the extension and the summary of a temporary
// one, the cap, the creation by members of a private universe, and what its moderators set: archived, order, slow
// mode, writing bans, removed messages, delegated agents, moderators, deletion; the mute for oneself. A universe
// discussion is named by its address (%paris&general) or its id.
import { apiCommand } from '../api/command.js';
import type { Context } from '../context.js';
import { discussionIdOf } from './discussions.js';
import { listText } from './shared.js';

const ID = { id: 'The universe discussion: its address (%paris&general) or its id' };
const u = { universe: 'The universe (%name)', account: 'The account: @handle or its id' };
/** The universe discussions given by their address resolved to their id ([keys]: "id" and others). */
const byAddress = (...keys: string[]) => async (i: Record<string, unknown>, ctx: Context) => {
  const out = { ...i };
  for (const k of keys) if (typeof out[k] === 'string') out[k] = await discussionIdOf(ctx, out[k] as string);
  return out;
};
const onDiscussion = { positionals: ['id'], descriptions: ID, prepare: byAddress('id') };
type Discussion = { id: string; address?: string; status?: string; lifetime?: string; archived?: boolean; slowModeSeconds?: number | null; agentsForbidden?: boolean; muted?: boolean; endsAt?: string | null; unread?: number };
const discussionLine = (d: Discussion) => `${d.address ?? d.id}  ${d.lifetime ?? ''} ${d.status ?? ''}${d.archived ? '  archived' : ''}${d.slowModeSeconds ? `  slow ${d.slowModeSeconds}s` : ''}${d.agentsForbidden ? '  no agents' : ''}${d.muted ? '  muted' : ''}${d.endsAt ? `  ends ${d.endsAt}` : ''}${d.unread ? `  unread ${d.unread}` : ''}`;
const discussionText = (r: unknown) => (r ? discussionLine(r as Discussion) : '(none)');
const accountLine = (a: { handle?: string; displayName?: string }) => `@${a.handle ?? '?'}  ${a.displayName ?? ''}`;

export const discussionsMine = apiCommand({
  name: 'discussions mine', summary: 'The universe discussions you joined in a universe, at every level, the most recently active first, with their unread (myUniverseDiscussions)', kind: 'query', op: 'myUniverseDiscussions', positionals: ['universe'], descriptions: u, depth: 1,
  text: listText(discussionLine), examples: ['breakrocks discussions mine %paris'],
});
export const discussionsLimits = apiCommand({
  name: 'discussions limits', summary: 'The limits of the universe discussions of a universe: the support a proposal needs, the cap of open temporary ones, your proposal waiting (universeDiscussionLimits)', kind: 'query', op: 'universeDiscussionLimits', positionals: ['universe'], descriptions: u,
  examples: ['breakrocks discussions limits %paris'],
});
export const discussionsModerators = apiCommand({ name: 'discussions moderators', summary: 'The moderators of a universe discussion (universeDiscussionModerators)', kind: 'query', op: 'universeDiscussionModerators', ...onDiscussion, text: listText(accountLine), examples: ['breakrocks discussions moderators %paris&general'] });
export const discussionsWritingBans = apiCommand({
  name: 'discussions writing-bans', summary: 'The writing bans of a universe discussion (universeDiscussionWritingBans)', kind: 'query', op: 'universeDiscussionWritingBans', ...onDiscussion,
  text: listText((b: { account?: { handle?: string }; by?: { handle?: string } | null; until?: string | null }) => `@${b.account?.handle ?? '?'}  until ${b.until ?? 'lifted'}${b.by?.handle ? `  by @${b.by.handle}` : ''}`), examples: ['breakrocks discussions writing-bans %paris&general'],
});
export const discussionsActive = apiCommand({ name: 'discussions active', summary: 'Who wrote in a universe discussion in the last 24 hours, the most recent first, 50 at most ("/who"; universeDiscussionActiveMembers)', kind: 'query', op: 'universeDiscussionActiveMembers', ...onDiscussion, text: listText(accountLine), examples: ['breakrocks discussions active %paris&general'] });
export const discussionsExtend = apiCommand({
  name: 'discussions extend', summary: 'Extend a temporary universe discussion opened by the governance, once, 168 hours in all (extendUniverseDiscussion)', kind: 'mutation', op: 'extendUniverseDiscussion', ...onDiscussion, positionals: ['id', 'hours'],
  descriptions: { ...ID, hours: 'How many hours more' }, depth: 1, text: discussionText, examples: ['breakrocks discussions extend %paris&budget 24'],
});
const summary = (approve: boolean) => apiCommand({
  name: `discussions summary ${approve ? 'approve' : 'decline'}`, summary: `${approve ? 'Approve' : 'Decline'} the summary of a temporary universe discussion, within 24 hours of its end (answerUniverseDiscussionSummary; the leadership)`,
  kind: 'mutation', op: 'answerUniverseDiscussionSummary', fixed: { approve }, ...onDiscussion, depth: 1, examples: [`breakrocks discussions summary ${approve ? 'approve' : 'decline'} %paris&budget`],
});
export const discussionsSummaryApprove = summary(true);
export const discussionsSummaryDecline = summary(false);
export const discussionsCap = apiCommand({
  name: 'discussions cap', summary: 'Raise the cap of open temporary universe discussions of a universe, from 10 up to 50 (setUniverseDiscussionCap; the governance)', kind: 'mutation', op: 'setUniverseDiscussionCap', positionals: ['universe', 'maxOpenTemporary'],
  descriptions: { ...u, maxOpenTemporary: 'The cap, 10 to 50' }, examples: ['breakrocks discussions cap %paris 20'],
});
const creation = (membersCreate: boolean) => apiCommand({
  name: `discussions creation ${membersCreate ? 'members' : 'managers'}`, summary: membersCreate ? 'Let the members of a private universe create its universe discussions (setUniverseDiscussionCreation)' : 'Only the owner and the admins of a private universe create its universe discussions (setUniverseDiscussionCreation)',
  kind: 'mutation', op: 'setUniverseDiscussionCreation', fixed: { membersCreate }, positionals: ['universe'], descriptions: u, depth: 1, examples: [`breakrocks discussions creation ${membersCreate ? 'members' : 'managers'} %club.`],
});
export const discussionsCreationMembers = creation(true);
export const discussionsCreationManagers = creation(false);
const archived = (on: boolean) => apiCommand({
  name: `discussions ${on ? 'archive' : 'unarchive'}`, summary: on ? 'Archive a universe discussion: read-only (setUniverseDiscussionArchived)' : 'Take a universe discussion out of the archive (setUniverseDiscussionArchived)',
  kind: 'mutation', op: 'setUniverseDiscussionArchived', fixed: { archived: on }, ...onDiscussion, depth: 1, text: discussionText, examples: [`breakrocks discussions ${on ? 'archive' : 'unarchive'} %paris&velo`],
});
export const discussionsArchive = archived(true);
export const discussionsUnarchive = archived(false);
export const discussionsMove = apiCommand({
  name: 'discussions move', summary: 'Move a universe discussion before another in the list of its universe (--before; none: to the end) (moveUniverseDiscussion)', kind: 'mutation', op: 'moveUniverseDiscussion', ...onDiscussion, prepare: byAddress('id', 'before'),
  descriptions: { ...ID, before: 'The universe discussion it goes before (its address or its id)' }, depth: 1, text: discussionText, examples: ['breakrocks discussions move %paris&velo --before %paris&general'],
});
export const discussionsSlowMode = apiCommand({
  name: 'discussions slow-mode', summary: 'Set the slow mode of a universe discussion: seconds between two messages of an account, 0 to turn it off (setUniverseDiscussionSlowMode)', kind: 'mutation', op: 'setUniverseDiscussionSlowMode', ...onDiscussion, positionals: ['id', 'seconds'],
  descriptions: { ...ID, seconds: 'Seconds between two messages (0: off)' }, depth: 1, text: discussionText, examples: ['breakrocks discussions slow-mode %paris&general 30'],
});
const writingBan = (banned: boolean) => apiCommand({
  name: `discussions ${banned ? 'ban' : 'unban'}`, summary: banned ? 'Ban an account from writing in a universe discussion (--hours; none: until lifted), citing an article (setUniverseDiscussionWritingBan)' : 'Lift the writing ban of an account in a universe discussion (setUniverseDiscussionWritingBan)',
  kind: 'mutation', op: 'setUniverseDiscussionWritingBan', fixed: { banned }, ...onDiscussion, positionals: ['id', 'accountId'], rename: { accountId: 'account' }, ...(banned ? {} : { hide: ['hours', 'article'] }),
  descriptions: { ...ID, account: 'The account: @handle or its id', hours: 'How many hours (none: until lifted)' },
  ...(banned ? { confirm: (i: Record<string, unknown>) => `Ban ${String(i.account)} from writing in ${String(i.id)}?` } : {}),
  examples: [banned ? 'breakrocks discussions ban %paris&general @spammer --hours 24 --article 3 --yes' : 'breakrocks discussions unban %paris&general @alice'],
});
export const discussionsBan = writingBan(true);
export const discussionsUnban = writingBan(false);
export const discussionsRemoveMessage = apiCommand({
  name: 'discussions remove-message', summary: 'Remove a message of a universe discussion as a moderator, citing an article (removeUniverseDiscussionMessage)', kind: 'mutation', op: 'removeUniverseDiscussionMessage', ...onDiscussion, positionals: ['id', 'messageId'],
  descriptions: { ...ID, messageId: 'The message' }, confirm: (i) => `Remove the message ${String(i.messageId)}?`, examples: ['breakrocks discussions remove-message %paris&general <message id> --article 3 --yes'],
});
export const discussionsDelete = apiCommand({
  name: 'discussions delete', summary: 'Delete an archived permanent universe discussion (deleteUniverseDiscussion)', kind: 'mutation', op: 'deleteUniverseDiscussion', ...onDiscussion,
  confirm: (i) => `Delete the universe discussion ${String(i.id)} and its messages?`, text: (r) => (r === true ? 'deleted' : 'nothing changed'), examples: ['breakrocks discussions delete %paris&old --yes'],
});
const agents = (forbidden: boolean) => apiCommand({
  name: `discussions agents ${forbidden ? 'forbid' : 'allow'}`, summary: `${forbidden ? 'Forbid' : 'Allow'} the delegated agents in a permanent universe discussion (setUniverseDiscussionAgents)`,
  kind: 'mutation', op: 'setUniverseDiscussionAgents', fixed: { forbidden }, ...onDiscussion, depth: 1, text: discussionText, examples: [`breakrocks discussions agents ${forbidden ? 'forbid' : 'allow'} %paris&general`],
});
export const discussionsAgentsForbid = agents(true);
export const discussionsAgentsAllow = agents(false);
const mute = (muted: boolean) => apiCommand({
  name: `discussions ${muted ? 'mute' : 'unmute'}`, summary: muted ? 'Mute a universe discussion for yourself (--mentions: still notified when mentioned) (setUniverseDiscussionMuted)' : 'Unmute a universe discussion (setUniverseDiscussionMuted)',
  kind: 'mutation', op: 'setUniverseDiscussionMuted', fixed: { muted }, ...onDiscussion, ...(muted ? {} : { hide: ['mentions'] }), descriptions: { ...ID, mentions: 'Still notified when mentioned' }, depth: 1, text: discussionText,
  examples: [`breakrocks discussions ${muted ? 'mute' : 'unmute'} %paris&general${muted ? ' --mentions' : ''}`],
});
export const discussionsMute = mute(true);
export const discussionsUnmute = mute(false);
const moderator = (on: boolean) => apiCommand({
  name: `discussions moderators ${on ? 'add' : 'remove'}`, summary: on ? 'Name a moderator of a universe discussion (setUniverseDiscussionModerator)' : 'Remove a moderator of a universe discussion (setUniverseDiscussionModerator)',
  kind: 'mutation', op: 'setUniverseDiscussionModerator', fixed: { moderator: on }, ...onDiscussion, positionals: ['id', 'accountId'], rename: { accountId: 'account' }, descriptions: { ...ID, account: 'The account: @handle or its id' }, depth: 1, text: discussionText,
  examples: [`breakrocks discussions moderators ${on ? 'add' : 'remove'} %paris&velo @alice`],
});
export const discussionsModeratorsAdd = moderator(true);
export const discussionsModeratorsRemove = moderator(false);

export const discussionModerationCommands = [
  discussionsMine, discussionsLimits, discussionsModerators, discussionsModeratorsAdd, discussionsModeratorsRemove, discussionsWritingBans, discussionsActive, discussionsExtend, discussionsSummaryApprove, discussionsSummaryDecline,
  discussionsCap, discussionsCreationMembers, discussionsCreationManagers, discussionsArchive, discussionsUnarchive, discussionsMove, discussionsSlowMode, discussionsBan, discussionsUnban,
  discussionsRemoveMessage, discussionsDelete, discussionsAgentsForbid, discussionsAgentsAllow, discussionsMute, discussionsUnmute,
];
