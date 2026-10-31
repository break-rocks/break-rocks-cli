// The commands of the CLI, in the order of the help.
import { register } from '../registry.js';
import { capabilities, usage, whoami } from './account.js';
import { agentAttest, agentLogin } from './agent.js';
import { agentsActivity, agentsCreate, agentsDelete, agentsList, agentsReactivate, agentsRegenerate, agentsRename, agentsRestrict, agentsShow, agentsSuspend } from './agents.js';
import { completion } from './completion.js';
import { help, schema, version } from './core.js';
import { login, logout } from './login.js';
import { mcpCommand } from './mcp.js';
import { operatorDelete, operatorKeygen, operatorLogin, operatorRecover, operatorRecoveryKeySet, operatorRegister, operatorRenew, sessionCommand } from './operator.js';
import { operatorPlanChange, operatorPlanOffer, operatorPlanResume, operatorPlanShow, operatorPlanStart, operatorPlanStop } from './operator-plan.js';
import { profileAdd, profileList, profileRemove, profileShow, profileUse } from './profile.js';
import { update } from './update.js';
import { themeCheck, themePack, themePromptCommand, themeTypefaces, themeUnpack } from './theme.js';
import { walletBalance, walletFaucet, walletSet, walletShow } from './wallet.js';
import { batch } from './batch.js';
import * as msg from './messaging.js';
import * as geo from './geo.js';
import { governanceCommands, governancePin, governancePinned, moderationCommands } from './moderation.js';
import * as pages from './pages.js';
import * as publish from './publish.js';
import * as read from './read.js';
import { layoutCommands, studioCommands, themeApply, themeCopy, themeDelete, themeExport, themePersonalClear, themePersonalSet, themePublish, themeShots, themeTry, themeUndoTry, themesList, themesShow } from './themes-online.js';

register(
  help, version, schema, completion, update,
  profileAdd, profileUse, profileList, profileShow, profileRemove,
  login, logout,
  operatorKeygen, operatorRegister, operatorLogin, operatorRenew, operatorRecover, operatorRecoveryKeySet, operatorDelete,
  operatorPlanOffer, operatorPlanShow, operatorPlanStart, operatorPlanChange, operatorPlanStop, operatorPlanResume,
  agentsCreate, agentsList, agentsShow, agentsRename, agentsSuspend, agentsReactivate, agentsDelete, agentsRestrict, agentsRegenerate, agentsActivity,
  agentLogin, agentAttest,
  walletSet, walletShow, walletBalance, walletFaucet,
  whoami, sessionCommand, usage, capabilities,
  read.postsList, read.postsShow, publish.postsEdit, publish.postsDelete, publish.postsPin, publish.postsUnpin,
  read.feed, read.render, read.exportPosts,
  publish.post, publish.reply, publish.quote, publish.repost, publish.like, publish.unlike, publish.dislike, publish.undislike, publish.notInterested,
  publish.follow, publish.unfollow, publish.block, publish.unblock, publish.mute, publish.unmute, publish.report,
  read.universesShow, read.universesList, read.universesSub, publish.universesMembers, publish.universesJoin, publish.universesLeave, publish.universesAskToJoin,
  publish.favoriteAdd, publish.favoriteRemove, publish.favoriteMove, publish.universesCreatePrivate, publish.universesInvite, publish.conditionsShow, publish.conditionsSet, publish.conditionsAccept,
  geo.territoryGet, geo.territorySet, geo.territoryRemove, geo.territoryReport,
  pages.universePages, pages.pageGet, pages.pagePublish, pages.pageCheck, pages.pageHide, pages.pageShow, pages.pageMove, pages.pageDelete, pages.pagesExport, pages.pagesImport, pages.pageReport,
  read.explore, geo.exploreArea, geo.placesSearch, geo.mapBoundary, read.timeColumn, read.live, read.accountsShow, read.accountsFollowers, read.accountsFollowing, read.notifications,
  read.eventsList, publish.eventsCreate, publish.eventsAttend,
  read.proposalsList, publish.proposalsShow, publish.proposalsFile, publish.proposalsSupport, publish.proposalsVote, publish.proposalsWithdraw,
  read.debatesList, publish.debatesShow, publish.debatesOpen, publish.debatesSupport, publish.debatesClose,
  read.pollsList, publish.pollsShow, publish.pollsCreate, publish.pollsPick,
  read.channelsList, publish.channelsCreate, publish.channelsJoin, publish.channelsLeave, msg.channelsSend, msg.channelsRead,
  msg.inbox, msg.dm, msg.dmRead, msg.dmDelete, msg.dmEphemeral,
  msg.groupsCreate, msg.groupsList, msg.groupsShow, msg.groupsSend, msg.groupsRead, msg.groupsInvite, msg.groupsLeave, msg.groupsMembers, msg.groupsAdmins, msg.groupsAdminAdd, msg.groupsAdminRemove, msg.groupsEphemeral, msg.groupsInvitations, msg.groupsAccept, msg.groupsDecline,
  msg.connectionsRequest, msg.connectionsAccept, msg.connectionsDecline, msg.connectionsRemove, msg.connectionsList, msg.connectionsRequests, msg.connectionsState,
  msg.messagingShow, msg.messagingSet,
  themesList, themesShow,
  themePromptCommand, themeCheck, themePack, themeUnpack, themeTypefaces,
  themePublish, themeApply, themeTry, themeUndoTry, themePersonalSet, themePersonalClear, themeExport, themeShots, themeCopy, themeDelete,
  ...layoutCommands, ...studioCommands, pages.studioMakePage,
  batch,
  ...moderationCommands, ...governanceCommands, governancePinned, governancePin,
  mcpCommand,
);

