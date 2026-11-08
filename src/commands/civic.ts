// The governance of a public universe, what was left without a command (D-92, D-303: the operations of before specs
// v83.1.0): proposals (their representative votes, those of the account, projects and their status, a review of a
// refusal, an amendment always refused), the support of a poll and of an event, the change and the deletion of an
// event and its attendees, votes (backup delegate, reception of lent votes, holders), the residents, the welcome
// wall, the news and the pulse, the manifesto versions, the governance of a sub-universe, the pinned posts and
// announcements, the feed removal reviews, the likes of the questions to the leadership, the text of a platform AI
// agent removed; the sanctions of the account and their appeal, and the jury of an appeal.
import { apiCommand } from '../api/command.js';
import { usageError } from '../errors.js';
import { pageText } from './shared.js';

const u = { universe: 'The universe (%name)', in: 'The universe (%name)', account: 'The account: @handle or its id' };
type Ref = { handle?: string } | null | undefined;
const at = (a: Ref) => (a?.handle ? `@${a.handle}` : '-');
type Proposal = { id: string; kind?: string; status?: string; title?: string; universe?: string; createdAt?: string; project?: { status?: string; note?: string | null } | null };
const proposalLine = (p: Proposal) => `${p.id}  ${p.universe ?? ''}  ${p.kind ?? ''}  ${p.status ?? ''}${p.project?.status ? `  project ${p.project.status}` : ''}  ${p.title ?? ''}`;
const proposalText = (r: unknown) => (r ? proposalLine(r as Proposal) : '(none)');
const onProposal = { positionals: ['proposalId'], rename: { proposalId: 'id' }, descriptions: { id: 'The proposal' } };

// ---- Proposals and projects ----

export const proposalsVotes = apiCommand({
  name: 'proposals votes', summary: 'The votes of the representatives on a proposal, the largest first: those who hold lent votes, never the choice of the others (proposalVotes)', kind: 'query', op: 'proposalVotes', ...onProposal,
  text: pageText((v: { account?: Ref; choice?: unknown; votes?: number }) => `${at(v.account)}  ${v.votes ?? 0} vote(s)  ${typeof v.choice === 'string' ? v.choice : JSON.stringify(v.choice ?? null)}`), examples: ['breakrocks proposals votes <id>'],
});
export const proposalsMine = apiCommand({
  name: 'proposals mine', summary: 'The proposals the account filed (--voted: those it voted on), the most recent first (myProposals)', kind: 'query', op: 'myProposals', descriptions: { voted: 'Those voted on, not those filed' },
  text: pageText(proposalLine), examples: ['breakrocks proposals mine', 'breakrocks proposals mine --voted'],
});
export const proposalsProjects = apiCommand({
  name: 'proposals projects', summary: 'The projects of a universe: action proposals adopted and not done, in progress first (projects)', kind: 'query', op: 'projects', positionals: ['universe'], descriptions: u,
  text: pageText(proposalLine), examples: ['breakrocks proposals projects %paris'],
});
export const proposalsProjectStatus = apiCommand({
  name: 'proposals project-status', summary: 'Set the status of a project with a note: in progress or done (setProjectStatus; the leadership, without leadership the residents)', kind: 'mutation', op: 'setProjectStatus', positionals: ['proposalId', 'status'],
  rename: { proposalId: 'id' }, descriptions: { id: 'The proposal', status: 'IN_PROGRESS, DONE (ADOPTED: back)', note: 'The note' }, depth: 1, text: proposalText,
  examples: ['breakrocks proposals project-status <id> IN_PROGRESS --note "Works start in March"'],
});
export const proposalsProjectDone = apiCommand({
  name: 'proposals project-done', summary: 'Declare the project of an adopted action proposal done (declareProjectDone; its author)', kind: 'mutation', op: 'declareProjectDone', ...onProposal, depth: 1, text: proposalText,
  examples: ['breakrocks proposals project-done <id>'],
});
export const proposalsRefusalReview = apiCommand({
  name: 'proposals refusal-review', summary: 'Ask the platform team, once, to review the refusal of a proposal when filed (askProposalRefusalReview; its author)', kind: 'mutation', op: 'askProposalRefusalReview', ...onProposal,
  confirm: (i) => `Ask a review of the refusal of ${String(i.id)}? Asked once.`, examples: ['breakrocks proposals refusal-review <id> --yes'],
});
export const proposalsChange = apiCommand({
  name: 'proposals change', summary: 'Amend a proposal: always refused by the platform, a proposal is withdrawn and filed again (changeProposal)', kind: 'mutation', op: 'changeProposal', ...onProposal, depth: 1, text: proposalText,
  examples: ['breakrocks proposals change <id> --text "A new text"'],
});
export const pollsSupport = apiCommand({
  name: 'polls support', summary: 'Support a poll waiting for support (supportPoll; a resident)', kind: 'mutation', op: 'supportPoll', positionals: ['pollId'], rename: { pollId: 'id' }, descriptions: { id: 'The poll' }, depth: 1,
  examples: ['breakrocks polls support <id>'],
});

// ---- Universe events ----

type Event = { id: string; title?: string; startsAt?: string; minutes?: number; status?: string; attendeeCount?: number; support?: unknown };
const eventText = (r: unknown) => { const e = r as Event | null; return e ? `${e.id}  ${e.startsAt ?? ''}  ${e.title ?? ''}  ${e.status ?? ''}${e.attendeeCount != null ? `  ${e.attendeeCount} attending` : ''}` : '(none)'; };
const onEvent = { positionals: ['eventId'], rename: { eventId: 'id' }, descriptions: { id: 'The event' } };
export const eventsSupport = apiCommand({ name: 'events support', summary: 'Support a universe event proposed by a resident (supportUniverseEvent; a resident who can vote)', kind: 'mutation', op: 'supportUniverseEvent', ...onEvent, depth: 1, text: eventText, examples: ['breakrocks events support <id>'] });
export const eventsChange = apiCommand({
  name: 'events change', summary: 'Change a universe event: title, start, length, place, link, tags, its point, zone or route (changeUniverseEvent; the attendees are told)',
  description: 'Only what is given changes. --point { "lat", "lon" }, --zone, --route (JSON); --clear POINT,ZONE,ROUTE removes them. The leadership, or whoever asked for it.',
  kind: 'mutation', op: 'changeUniverseEvent', positionals: ['input.eventId'], rename: { 'input.eventId': 'id' }, dry: true, descriptions: { id: 'The event', discussion: 'With a discussion of its own' }, depth: 1, text: eventText,
  examples: ['breakrocks events change <id> --title "Night ride" --starts-at 2026-11-20T19:00:00Z'],
});
export const eventsDelete = apiCommand({
  name: 'events delete', summary: 'Delete a universe event (deleteUniverseEvent)', kind: 'mutation', op: 'deleteUniverseEvent', ...onEvent, confirm: (i) => `Delete the event ${String(i.id)}?`,
  text: (r) => (r === true ? 'deleted' : 'nothing changed'), examples: ['breakrocks events delete <id> --yes'],
});
export const eventsAttendees = apiCommand({
  name: 'events attendees', summary: 'The attendees of a universe event, to the residents of its universe (universeEventAttendees)', kind: 'query', op: 'universeEventAttendees', ...onEvent,
  text: pageText((a: { handle?: string; displayName?: string }) => `@${a.handle ?? '?'}  ${a.displayName ?? ''}`), examples: ['breakrocks events attendees <id> --all'],
});

// ---- Governance of a universe ----

export const governanceResidents = apiCommand({
  name: 'governance residents', summary: 'The residents of a public universe: the leadership first, then the moderators, then by recent activity (universeResidents)',
  description: '--query: a part of the name or the handle; --role LEADERSHIP or MODERATOR; --new-residents: joined less than 30 days ago; --locatable; --agents: delegated agents.',
  kind: 'query', op: 'universeResidents', positionals: ['universe'], descriptions: u,
  text: pageText((x: { account?: Ref; role?: string | null; joinedAt?: string }) => `${at(x.account)}  ${x.role ?? 'resident'}  since ${x.joinedAt ?? '-'}`), examples: ['breakrocks governance residents %paris --role LEADERSHIP', 'breakrocks governance residents %paris --query ali'],
});
type NewResident = { account?: Ref; joinedAt?: string; welcomeCount?: number; welcomedByMe?: boolean };
const newResidentLine = (x: NewResident) => `${at(x.account)}  joined ${x.joinedAt ?? '-'}  welcomed ${x.welcomeCount ?? 0}${x.welcomedByMe ? ' (by me)' : ''}`;
export const governanceWelcomeWall = apiCommand({
  name: 'governance welcome-wall', summary: 'The welcome wall: the new residents of the last 7 days (welcomeWall)', kind: 'query', op: 'welcomeWall', positionals: ['universe'], descriptions: u,
  text: pageText(newResidentLine), examples: ['breakrocks governance welcome-wall %paris'],
});
export const governanceWelcome = apiCommand({
  name: 'governance welcome', summary: 'Welcome a new resident on the welcome wall, once (welcomeResident)', kind: 'mutation', op: 'welcomeResident', positionals: ['universe', 'accountId'], rename: { accountId: 'account' }, descriptions: u,
  text: (r) => (r ? newResidentLine(r as NewResident) : '(none)'), examples: ['breakrocks governance welcome %paris @newcomer'],
});
export const governanceNews = apiCommand({ name: 'governance news', summary: 'The news of a universe: the badges of its dashboard and its now page (universeNews)', kind: 'query', op: 'universeNews', positionals: ['universe'], descriptions: u, examples: ['breakrocks governance news %paris --json'] });
export const governancePulse = apiCommand({ name: 'governance pulse', summary: 'The pulse of a public universe, from 10 residents (universePulse)', kind: 'query', op: 'universePulse', positionals: ['universe'], descriptions: u, examples: ['breakrocks governance pulse %paris --json'] });
export const governanceManifestoVersions = apiCommand({
  name: 'governance manifesto-versions', summary: 'The versions of the manifesto of a private universe, the most recent first (universeManifestoVersions)', kind: 'query', op: 'universeManifestoVersions', positionals: ['universe'], descriptions: u,
  examples: ['breakrocks governance manifesto-versions %club.'],
});
export const governanceSubGovernance = apiCommand({
  name: 'governance sub-governance', summary: 'Give a sub-universe a governance of its own: an account and its powers (giveSubUniverseGovernance; the leadership)', kind: 'mutation', op: 'giveSubUniverseGovernance', positionals: ['universe', 'accountId'],
  rename: { accountId: 'account' }, descriptions: { universe: 'The sub-universe (%paris/velo)', account: 'The account: @handle or its id', powers: 'ANNOUNCEMENTS, MODERATION, PINNED_POSTS' }, depth: 1,
  confirm: (i) => `Give ${String(i.universe)} to ${String(i.account)}?`, examples: ['breakrocks governance sub-governance %paris/velo @alice --powers ANNOUNCEMENTS,PINNED_POSTS --yes'],
});
export const governanceMovePinned = apiCommand({
  name: 'governance move-pinned', summary: 'Move a pinned post before another (--before; none: to the end) (movePinnedPost)', kind: 'mutation', op: 'movePinnedPost', positionals: ['universe', 'postId'], descriptions: { ...u, postId: 'The pinned post', before: 'The pinned post it goes before' }, depth: 1,
  examples: ['breakrocks governance move-pinned %paris <post id> --before <post id>'],
});
export const governanceUnpinAnnouncement = apiCommand({
  name: 'governance unpin-announcement', summary: 'Unpin an announcement, those of a former leadership included (unpinAnnouncement; the leadership in place)', kind: 'mutation', op: 'unpinAnnouncement', positionals: ['universe', 'postId'], descriptions: { ...u, postId: 'The announcement' }, depth: 1,
  examples: ['breakrocks governance unpin-announcement %paris <post id>'],
});
type MyVote = { held?: number; lent?: unknown; acceptsVotes?: boolean; backupDelegate?: Ref };
const voteText = (r: unknown) => (r ? Object.entries(r as MyVote).map(([k, v]) => `${k}: ${v && typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('\n') : '(none)');
export const governanceBackupDelegate = apiCommand({
  name: 'governance backup-delegate', summary: 'Choose a backup delegate in a universe (--clear: none) (setBackupDelegate)', kind: 'mutation', op: 'setBackupDelegate', positionals: ['universe', 'accountId'], rename: { accountId: 'account' }, descriptions: u,
  extra: { clear: { type: 'boolean', description: 'No backup delegate' } }, depth: 1,
  prepare: (i) => { const { clear, ...rest } = i; if (!clear === (rest.account === undefined)) throw usageError('INVALID_INPUT', 'An account, or --clear'); return clear ? { ...rest, account: null } : rest; },
  text: voteText, examples: ['breakrocks governance backup-delegate %paris @alice', 'breakrocks governance backup-delegate %paris --clear'],
});
const reception = (accept: boolean) => apiCommand({
  name: `governance votes-${accept ? 'accept' : 'refuse'}`, summary: accept ? 'Accept the votes lent to you in a universe (--everywhere: in all) (setVoteReception)' : 'Refuse the votes lent to you in a universe (--everywhere: in all) (setVoteReception)',
  kind: 'mutation', op: 'setVoteReception', fixed: { accept }, positionals: ['universe'], descriptions: { ...u, everywhere: 'In every universe' }, depth: 1, text: voteText,
  examples: [`breakrocks governance votes-${accept ? 'accept' : 'refuse'} %paris`],
});
export const governanceVotesAccept = reception(true);
export const governanceVotesRefuse = reception(false);
export const governanceVoteHolders = apiCommand({
  name: 'governance vote-holders', summary: 'The top holders of lent votes of a universe, or the votes one account holds (--account) (voteHolders)', kind: 'query', op: 'voteHolders', positionals: ['universe'], rename: { accountId: 'account' }, descriptions: u, select: '{ votes account { id handle displayName kind } }',
  text: (r) => (Array.isArray(r) && r.length ? (r as { account?: Ref; votes?: number }[]).map((v) => `${at(v.account)}  ${v.votes ?? 0}`).join('\n') : '(none)'), examples: ['breakrocks governance vote-holders %paris', 'breakrocks governance vote-holders %paris --account @alice'],
});
type Review = { postId?: string; status?: string; keepVotes?: number; backVotes?: number; myVote?: string | null; endsAt?: string };
const reviewLine = (x: Review) => `${x.postId}  ${x.status ?? ''}  keep ${x.keepVotes ?? 0}  back ${x.backVotes ?? 0}${x.myVote ? `  my vote ${x.myVote}` : ''}  ends ${x.endsAt ?? '-'}`;
export const governanceFeedReviews = apiCommand({
  name: 'governance feed-reviews', summary: 'The feed removal reviews of a public universe, the newest first (feedRemovalReviews)', kind: 'query', op: 'feedRemovalReviews', positionals: ['universe'], descriptions: u,
  text: pageText(reviewLine), examples: ['breakrocks governance feed-reviews %paris'],
});
export const governanceFeedReviewVote = apiCommand({
  name: 'governance feed-review-vote', summary: 'Vote on the feed removal review of a post while it is open (48 hours): KEEP_REMOVED or BACK_TO_FEEDS (voteOnFeedRemovalReview)', kind: 'mutation', op: 'voteOnFeedRemovalReview', positionals: ['postId', 'vote'],
  descriptions: { postId: 'The post', vote: 'KEEP_REMOVED or BACK_TO_FEEDS' }, text: (r) => (r ? reviewLine(r as Review) : '(none)'), examples: ['breakrocks governance feed-review-vote <post id> BACK_TO_FEEDS'],
});
const questionLike = (liked: boolean) => apiCommand({
  name: `governance ${liked ? 'like' : 'unlike'}-question`, summary: liked ? 'Like a question to the leadership (setLeadershipQuestionLike)' : 'Take back the like of a question to the leadership (setLeadershipQuestionLike)',
  kind: 'mutation', op: 'setLeadershipQuestionLike', fixed: { liked }, positionals: ['questionId'], rename: { questionId: 'id' }, descriptions: { id: 'The question' }, depth: 1,
  examples: [`breakrocks governance ${liked ? 'like' : 'unlike'}-question <id>`],
});
export const governanceLikeQuestion = questionLike(true);
export const governanceUnlikeQuestion = questionLike(false);

// ---- The moderation: a text of a platform AI agent ----

export const moderationRemoveAgentText = apiCommand({
  name: 'moderation remove-agent-text', summary: 'Remove a text of a platform AI agent off-charter, citing the article: the summary or the minutes of a proposal, the automatic alternative text of an image (removePlatformAgentText)',
  description: 'PROPOSAL_SUMMARY and VOTE_MINUTES: --proposal-id; AUTOMATIC_ALT: --post-id and --image-id. --article: the article of the charter.',
  kind: 'mutation', op: 'removePlatformAgentText', positionals: ['agentText'], descriptions: { agentText: 'AUTOMATIC_ALT, PROPOSAL_SUMMARY or VOTE_MINUTES', proposalId: 'The proposal', postId: 'The post', imageId: 'The image of the post' },
  confirm: (i) => `Remove the ${String(i.agentText)} text?`, examples: ['breakrocks moderation remove-agent-text PROPOSAL_SUMMARY --proposal-id <id> --article 4 --yes'],
});

// ---- Sanctions of the account and the jury of an appeal ----

type Sanction = { id: string; kind?: string; universe?: string; createdAt?: string; endsAt?: string | null; appealableUntil?: string | null; appeal?: { status?: string } | null };
const sanctionLine = (s: Sanction) => `${s.id}  ${s.universe ?? ''}  ${s.kind ?? ''}  ${s.createdAt ?? ''}${s.endsAt ? ` → ${s.endsAt}` : ''}${s.appeal ? `  appeal ${s.appeal.status ?? ''}` : s.appealableUntil ? `  appealable until ${s.appealableUntil}` : ''}`;
const sanctionText = (r: unknown) => (r ? sanctionLine(r as Sanction) : '(none)');
const onSanction = { positionals: ['sanctionId'], rename: { sanctionId: 'id' }, descriptions: { id: 'The sanction' } };
export const sanctionsList = apiCommand({ name: 'sanctions list', summary: 'The sanctions of the account in universes, the newest first (mySanctions)', kind: 'query', op: 'mySanctions', text: pageText(sanctionLine), examples: ['breakrocks sanctions list'] });
export const sanctionsAppeal = apiCommand({
  name: 'sanctions appeal', summary: 'Appeal a sanction before its date, to a jury of residents (appealSanction; --publish-name: your name published with it)', kind: 'mutation', op: 'appealSanction', ...onSanction,
  descriptions: { id: 'The sanction', publishName: 'Your name published with the appeal' }, confirm: (i) => `Appeal the sanction ${String(i.id)}?`, text: sanctionText,
  examples: ['breakrocks sanctions appeal <id> --no-publish-name --yes'],
});
export const sanctionsPublishName = apiCommand({
  name: 'sanctions publish-name', summary: 'Whether your name is published with your appeal, until the decision (setAppealPublishName)', kind: 'mutation', op: 'setAppealPublishName', positionals: ['sanctionId', 'publishName'], rename: { sanctionId: 'id' },
  descriptions: { id: 'The sanction', publishName: 'on or off' }, text: sanctionText, examples: ['breakrocks sanctions publish-name <id> off'],
});
type Duty = { sanctionId?: string; universe?: string; kind?: string; status?: string; answerBy?: string | null; myVote?: unknown; reviewStatus?: string | null };
const dutyText = (r: unknown) => { const d = r as Duty | null; return d ? `${d.sanctionId}  ${d.universe ?? ''}  ${d.kind ?? ''}  ${d.status ?? ''}${d.answerBy ? `  answer by ${d.answerBy}` : ''}${d.reviewStatus ? `  reviews ${d.reviewStatus}` : ''}` : '(none)'; };
const draw = (accept: boolean) => apiCommand({
  name: `jury ${accept ? 'accept' : 'decline'}`, summary: `${accept ? 'Accept' : 'Decline'} your draw as a juror for the appeal of a sanction, before its answer date (answerJuryDraw)`, kind: 'mutation', op: 'answerJuryDraw', fixed: { accept }, ...onSanction,
  text: dutyText, examples: [`breakrocks jury ${accept ? 'accept' : 'decline'} <sanction id>`],
});
export const juryAccept = draw(true);
export const juryDecline = draw(false);
export const juryReviews = apiCommand({
  name: 'jury reviews', summary: 'Ask, for the jury, the two platform AI agents to review the sanction against the charter, one for and one against, once per appeal (askSanctionReviews)', kind: 'mutation', op: 'askSanctionReviews', ...onSanction,
  text: dutyText, examples: ['breakrocks jury reviews <sanction id>'],
});
export const juryVote = apiCommand({
  name: 'jury vote', summary: 'Vote as a juror on an appeal: an outcome with its reasons (--reduced-to-days for a reduction), or --dismiss (voteAsJuror)', kind: 'mutation', op: 'voteAsJuror', ...onSanction,
  descriptions: { id: 'The sanction', outcome: 'CONFIRMED, REDUCED or CANCELLED', reasons: 'The reasons', reducedToDays: 'The days it is reduced to (REDUCED)', dismiss: 'Dismiss the appeal' },
  confirm: (i) => `Vote ${i.dismiss ? 'to dismiss' : String(i.outcome)} on the appeal of ${String(i.id)}?`, text: dutyText,
  examples: ['breakrocks jury vote <sanction id> --outcome REDUCED --reduced-to-days 2 --reasons "A first time" --yes'],
});
export const juryWithdraw = apiCommand({
  name: 'jury withdraw', summary: 'Withdraw from the jury of an appeal before its vote (withdrawFromJury)', kind: 'mutation', op: 'withdrawFromJury', ...onSanction, confirm: (i) => `Withdraw from the jury of ${String(i.id)}?`, text: dutyText,
  examples: ['breakrocks jury withdraw <sanction id> --yes'],
});

export const civicCommands = [
  proposalsVotes, proposalsMine, proposalsProjects, proposalsProjectStatus, proposalsProjectDone, proposalsRefusalReview, proposalsChange, pollsSupport,
  eventsSupport, eventsChange, eventsDelete, eventsAttendees,
  sanctionsList, sanctionsAppeal, sanctionsPublishName, juryAccept, juryDecline, juryReviews, juryVote, juryWithdraw,
];
export const civicGovernanceCommands = [
  governanceResidents, governanceWelcomeWall, governanceWelcome, governanceNews, governancePulse, governanceManifestoVersions, governanceSubGovernance, governanceMovePinned, governanceUnpinAnnouncement,
  governanceBackupDelegate, governanceVotesAccept, governanceVotesRefuse, governanceVoteHolders, governanceFeedReviews, governanceFeedReviewVote, governanceLikeQuestion, governanceUnlikeQuestion,
  moderationRemoveAgentText,
];
