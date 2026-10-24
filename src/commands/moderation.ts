// The moderation and the governance of a universe (C-15): in groups of their own, out of the basic
// help (breakrocks help moderation, breakrocks help governance). A delegated agent does not
// moderate (DELEGATED_AGENT_NOT_ALLOWED): the platform says so.
import { apiCommand } from '../api/command.js';
import { outputSchema, selection } from '../api/graphql.js';
import { usageError } from '../errors.js';
import type { Command } from '../registry.js';
import { bool, list, object, openObject, str } from '../schema.js';
import { api } from '../session.js';

const u = { universe: 'The universe (%name)', in: 'The universe (%name)', account: 'The account: @handle or its id' };
const acc = { accountId: 'account', universe: 'in' };

export const moderationCommands = [
  apiCommand({ name: 'moderation awaiting', summary: 'The posts awaiting approval in a universe', kind: 'query', op: 'postsAwaitingApproval', positionals: ['universe'], descriptions: u, examples: ['breakrocks moderation awaiting %paris'] }),
  apiCommand({ name: 'moderation approve', summary: 'Approve a post awaiting approval', kind: 'mutation', op: 'approvePost', positionals: ['id'], depth: 1, examples: ['breakrocks moderation approve <id>'] }),
  apiCommand({ name: 'moderation remove', summary: 'Remove a post as a moderator (--article: the article of the rules)', kind: 'mutation', op: 'removePostAsModerator', positionals: ['id'], confirm: (i) => `Remove the post ${i.id}?`, examples: ['breakrocks moderation remove <id> --article 3 --yes'] }),
  apiCommand({ name: 'moderation dismiss-reports', summary: 'Dismiss the reports of a post', kind: 'mutation', op: 'dismissPostReports', positionals: ['id'], examples: ['breakrocks moderation dismiss-reports <id>'] }),
  apiCommand({ name: 'moderation hide-reply', summary: 'Hide a reply (its author: the post\'s)', kind: 'mutation', op: 'hideReply', positionals: ['id'], depth: 1, examples: ['breakrocks moderation hide-reply <id>'] }),
  apiCommand({ name: 'moderation unhide-reply', summary: 'Show a hidden reply again', kind: 'mutation', op: 'unhideReply', positionals: ['id'], depth: 1, examples: ['breakrocks moderation unhide-reply <id>'] }),
  apiCommand({ name: 'moderation posting-ban', summary: 'Give a posting ban in a universe', kind: 'mutation', op: 'givePostingBan', positionals: ['accountId'], rename: acc, descriptions: u, confirm: (i) => `Ban ${i.account} from posting in ${i.in} for ${i.days} day(s)?`, examples: ['breakrocks moderation posting-ban @spammer --in %paris --days 7 --yes'] }),
  apiCommand({ name: 'moderation ban', summary: 'Ban an account from a universe', kind: 'mutation', op: 'banFromUniverse', positionals: ['accountId'], rename: acc, descriptions: u, confirm: (i) => `Ban ${i.account} from ${i.in}?`, examples: ['breakrocks moderation ban @spammer --in %paris --yes'] }),
  apiCommand({ name: 'moderation lift-ban', summary: 'Lift the ban of an account', kind: 'mutation', op: 'liftUniverseBan', positionals: ['accountId'], rename: acc, descriptions: u, examples: ['breakrocks moderation lift-ban @alice --in %paris'] }),
  apiCommand({ name: 'moderation bans', summary: 'The bans of a universe', kind: 'query', op: 'universeBans', positionals: ['universe'], descriptions: u, examples: ['breakrocks moderation bans %paris'] }),
  apiCommand({ name: 'moderation reports', summary: 'The reports of a universe', kind: 'query', op: 'universeReports', positionals: ['universe'], descriptions: u, examples: ['breakrocks moderation reports %paris --all'] }),
  apiCommand({ name: 'moderation appearance-reports', summary: 'The reports of the themes and banners of a universe', kind: 'query', op: 'universeAppearanceReports', positionals: ['universe'], descriptions: u, examples: ['breakrocks moderation appearance-reports %paris'] }),
  apiCommand({ name: 'moderation log', summary: 'The moderation log of a universe', kind: 'query', op: 'moderationLog', positionals: ['universe'], descriptions: u, examples: ['breakrocks moderation log %paris'] }),
  apiCommand({ name: 'moderation moderators', summary: 'The moderators of a universe', kind: 'query', op: 'universeModerators', positionals: ['universe'], descriptions: u, examples: ['breakrocks moderation moderators %paris'] }),
  apiCommand({ name: 'moderation appoint', summary: 'Appoint a moderator', kind: 'mutation', op: 'appointModerator', positionals: ['accountId'], rename: acc, descriptions: u, examples: ['breakrocks moderation appoint @alice --in %paris'] }),
  apiCommand({ name: 'moderation appeals', summary: 'The appeals of a universe', kind: 'query', op: 'universeAppeals', positionals: ['universe'], descriptions: u, examples: ['breakrocks moderation appeals %paris'] }),
  apiCommand({ name: 'moderation decide-appeal', summary: 'Decide an appeal', kind: 'mutation', op: 'decideUniverseAppeal', positionals: ['sanctionId'], rename: { universe: 'in' }, descriptions: { ...u, reasons: 'The statement of reasons' }, confirm: (i) => `Decide the appeal of ${i.sanctionId}: ${i.outcome}?`, examples: ['breakrocks moderation decide-appeal <sanction id> --in %paris --outcome DECLINED --reasons "…" --yes'] }),
];

export const governanceCommands = [
  apiCommand({ name: 'governance show', summary: 'Who governs a universe, its level, its votes', kind: 'query', op: 'universeGovernance', positionals: ['universe'], descriptions: u, examples: ['breakrocks governance show %paris'] }),
  apiCommand({ name: 'governance history', summary: 'The governance history of a universe', kind: 'query', op: 'governanceHistory', positionals: ['universe'], descriptions: u, examples: ['breakrocks governance history %paris --all'] }),
  apiCommand({ name: 'governance ask', summary: 'Ask the leadership a question', kind: 'mutation', op: 'askLeadership', positionals: ['universe', 'text'], descriptions: u, examples: ['breakrocks governance ask %paris "Quand la prochaine réunion ?"'] }),
  apiCommand({ name: 'governance questions', summary: 'The questions to the leadership', kind: 'query', op: 'leadershipQuestions', positionals: ['universe'], descriptions: u, examples: ['breakrocks governance questions %paris --archived'] }),
  apiCommand({ name: 'governance answer', summary: 'Answer a question (the leadership)', kind: 'mutation', op: 'answerLeadershipQuestion', positionals: ['id', 'text'], examples: ['breakrocks governance answer <id> "Jeudi"'] }),
  apiCommand({ name: 'governance manifesto', summary: 'The manifesto of a universe (a version)', kind: 'query', op: 'universeManifesto', positionals: ['universe'], descriptions: u, examples: ['breakrocks governance manifesto %paris'] }),
  apiCommand({ name: 'governance manifesto-set', summary: 'Set the manifesto (the leadership)', kind: 'mutation', op: 'setUniverseManifesto', positionals: ['universe', 'text'], descriptions: u, examples: ['breakrocks governance manifesto-set %paris "Un village ouvert"'] }),
  apiCommand({ name: 'governance successors', summary: 'Name the successors of the owner (10 at most)', kind: 'mutation', op: 'setUniverseSuccessors', positionals: ['universe', 'accountIds'], descriptions: u, examples: ['breakrocks governance successors %club @alice @bob'] }),
  apiCommand({ name: 'governance transfer', summary: 'Transfer a universe to an account (irreversible once accepted)', kind: 'mutation', op: 'transferUniverse', positionals: ['universe', 'accountId'], rename: { accountId: 'account' }, descriptions: u, confirm: (i) => `Transfer ${i.universe} to ${i.account}?`, examples: ['breakrocks governance transfer %club @alice --yes'] }),
  apiCommand({ name: 'governance field', summary: 'Set the field of a universe', kind: 'mutation', op: 'setUniverseField', positionals: ['universe', 'field'], descriptions: u, depth: 1, examples: ['breakrocks governance field %paris PLACES'] }),
  apiCommand({ name: 'governance display', summary: 'Set the display name of a universe', kind: 'mutation', op: 'setUniverseDisplay', positionals: ['universe', 'display'], descriptions: u, examples: ['breakrocks governance display %paris "Paris"'] }),
  apiCommand({ name: 'governance territory', summary: 'Set (or --remove) the territory of a universe (the arguments as built; universes territory set is the plain form)', kind: 'mutation', op: 'setUniverseTerritory', positionals: ['universe'], descriptions: u, depth: 1, examples: ['breakrocks governance territory %paris --kind city --name Paris'] }),
  apiCommand({ name: 'governance my-vote', summary: 'My votes in a universe (held, lent, received)', kind: 'query', op: 'myVote', positionals: ['universe'], descriptions: u, examples: ['breakrocks governance my-vote %paris'] }),
  apiCommand({ name: 'governance lend-votes', summary: 'Lend my votes to an account', kind: 'mutation', op: 'lendVotes', positionals: ['universe', 'accountId'], rename: { accountId: 'account' }, descriptions: u, examples: ['breakrocks governance lend-votes %paris @alice'] }),
  apiCommand({ name: 'governance withdraw-votes', summary: 'Take back the votes lent', kind: 'mutation', op: 'withdrawVotes', positionals: ['universe'], descriptions: u, examples: ['breakrocks governance withdraw-votes %paris'] }),
  // The governance page (specs v49.9.0, living-universes.md § The governance page; as built, backend 66ba2a2).
  apiCommand({ name: 'governance proposals', summary: 'The proposals of a universe by status and kind, as the governance page groups them', kind: 'query', op: 'proposals', positionals: ['universe'],
    description: 'WAITING_SUPPORT (waiting for support: supportProposal), OPEN and COUNTING (in vote), ADOPTED, REJECTED, WITHDRAWN, ANNULLED, CANCELLED. Read by everyone in a public universe.',
    descriptions: { ...u, status: 'Only this status (ProposalStatus)', kind: 'Only this kind (ProposalKind)' }, examples: ['breakrocks governance proposals %paris --status WAITING_SUPPORT', 'breakrocks governance proposals %paris --kind TERRITORY --all'] }),
  apiCommand({ name: 'governance record', summary: 'The governance history of the governance page: proposals adopted or annulled, platform measures, changes of leadership (governanceRecord)', kind: 'query', op: 'governanceRecord', positionals: ['universe'],
    description: 'The most recent first; the first page holds the last 90 days, --all the older ones. A platform measure names what was removed (TERRITORY, THEME, LAYOUT, BANNER, PAGE, BLOCK), never an account. [] for a private universe.',
    descriptions: u, depth: 3, examples: ['breakrocks governance record %paris', 'breakrocks governance record %paris --all --json'] }),
  apiCommand({ name: 'governance duties', summary: 'My jury duties (My duties), in every universe or in one (myJuryDuties)', kind: 'query', op: 'myJuryDuties',
    description: 'Those waiting for an answer or a juror vote are what the live button of My duties counts. Never another account\'s.',
    descriptions: { universe: 'Only the duties of this universe (%name)' }, examples: ['breakrocks governance duties', 'breakrocks governance duties --universe %paris'] }),
  apiCommand({ name: 'governance layout', summary: 'The layout of the governance page of a universe, as it applies (appliedLayout page GOVERNANCE)', kind: 'query', op: 'appliedLayout', positionals: ['universe'],
    fixed: { page: 'GOVERNANCE' }, hide: ['switcher'], descriptions: { ...u, device: 'The device it applies to (phone, tablet, desktop)' }, examples: ['breakrocks governance layout %paris --json'] }),
];

type Pinned = { universe: string; private: boolean; pinnedChannels: unknown[] };
const CHANNEL = selection('Channel', 1);
const pinnedText = (r: Pinned) => (r.pinnedChannels.length ? (r.pinnedChannels as { address: string; unread?: number; joined?: boolean }[]).map((c, i) => `${i + 1}. ${c.address}${c.joined && c.unread ? `  ${c.unread} unread` : ''}`).join('\n') : `${r.universe}: no pinned channel`);
const pinnedOutput = openObject({ universe: str('The universe'), private: { type: 'boolean', description: 'A private universe (the only ones with pinned channels)' }, pinnedChannels: list('The pinned channels, in their order', outputSchema('Channel', 1)) });

export const governancePinned: Command<{ universe: string }, Pinned> = {
  name: 'governance pinned', summary: 'The pinned channels of a private universe, in their order (Universe.pinnedChannels)',
  description: 'At most 5; [] for a public universe and for a non-member.', examples: ['breakrocks governance pinned %team-fra.'],
  input: object({ universe: str('The universe (%name)') }, ['universe']), output: pinnedOutput, args: { positionals: ['universe'] },
  run: async (ctx, { universe }) => {
    const r = (await api<{ universe: { name: string; private: boolean; pinnedChannels: unknown[] } | null }>(ctx, `query($n: String!) { universe(name: $n) { name private pinnedChannels ${CHANNEL} } }`, { n: universe })).universe;
    if (!r) throw usageError('UNIVERSE_NOT_FOUND', `No universe ${universe}`, { universe });
    return { universe: r.name, private: r.private, pinnedChannels: r.pinnedChannels };
  },
  text: pinnedText,
};

export const governancePin: Command<{ universe: string; channels?: string[]; none?: boolean }, Pinned> = {
  name: 'governance pin', summary: 'Pin the channels of a private universe: the whole list, in its order (setPinnedChannels; --none unpins them all)',
  description: 'The owner and the admins (CHANNEL_MANAGERS_ONLY); at most 5 (PINNED_CHANNELS_LIMIT), channels of that private universe at any of its levels, not archived, each once. A public universe: PRIVATE_UNIVERSE_NOT_FOUND.',
  examples: ['breakrocks governance pin %team-fra. %team-fra.~general %team-fra./tech~dev', 'breakrocks governance pin %team-fra. --none'],
  input: object({ universe: str('The universe (%name)'), channels: list('The channels, in their order (%universe~name)', { type: 'string' }, { maxItems: 5 }), none: bool('Unpin every channel') }, ['universe']),
  output: pinnedOutput, args: { positionals: ['universe', 'channels'] },
  run: async (ctx, { universe, channels, none }) => {
    if (!!channels?.length === !!none) throw usageError('INVALID_INPUT', 'The channels to pin, or --none');
    const r = (await api<{ setPinnedChannels: { name: string; private: boolean; pinnedChannels: unknown[] } }>(ctx, `mutation($u: String!, $c: [String!]!) { setPinnedChannels(universe: $u, channels: $c) { name private pinnedChannels ${CHANNEL} } }`, { u: universe, c: none ? [] : channels })).setPinnedChannels;
    return { universe: r?.name ?? universe, private: r?.private ?? true, pinnedChannels: r?.pinnedChannels ?? [] };
  },
  text: pinnedText,
};
