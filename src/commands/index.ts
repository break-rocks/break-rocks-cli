// The commands of the CLI, in the order of the help.
import { register } from '../registry.js';
import { capabilities, usage, whoami } from './account.js';
import { agentAttest, agentLogin } from './agent.js';
import { agentsActivity, agentsCreate, agentsDelete, agentsList, agentsReactivate, agentsRegenerate, agentsRename, agentsRestrict, agentsShow, agentsSuspend } from './agents.js';
import { help, schema, version } from './core.js';
import { mcpCommand } from './mcp.js';
import { operatorDelete, operatorKeygen, operatorLogin, operatorRecover, operatorRecoveryKeySet, operatorRegister, operatorRenew, sessionCommand } from './operator.js';
import { profileAdd, profileList, profileRemove, profileShow, profileUse } from './profile.js';
import { themeCheck, themePack, themePromptCommand, themeTypefaces, themeUnpack } from './theme.js';
import { walletBalance, walletFaucet, walletSet, walletShow } from './wallet.js';
import { batch } from './batch.js';
import { governanceCommands, moderationCommands } from './moderation.js';
import * as publish from './publish.js';
import * as read from './read.js';
import { layoutCommands, studioCommands, themeApply, themeCopy, themeDelete, themeExport, themePersonalClear, themePersonalSet, themePublish, themeShots, themeTry, themeUndoTry, themesList, themesShow } from './themes-online.js';

register(
  help, version, schema,
  profileAdd, profileUse, profileList, profileShow, profileRemove,
  operatorKeygen, operatorRegister, operatorLogin, operatorRenew, operatorRecover, operatorRecoveryKeySet, operatorDelete,
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
  read.explore, read.timeColumn, read.live, read.accountsShow, read.accountsFollowers, read.accountsFollowing, read.notifications,
  read.eventsList, publish.eventsCreate, publish.eventsAttend,
  read.proposalsList, publish.proposalsShow, publish.proposalsFile, publish.proposalsSupport, publish.proposalsVote, publish.proposalsWithdraw,
  read.debatesList, publish.debatesShow, publish.debatesOpen, publish.debatesSupport, publish.debatesClose,
  read.pollsList, publish.pollsShow, publish.pollsCreate, publish.pollsPick,
  read.channelsList, publish.channelsCreate, publish.channelsJoin, publish.channelsLeave, publish.channelsSend, publish.channelsRead,
  themesList, themesShow,
  themePromptCommand, themeCheck, themePack, themeUnpack, themeTypefaces,
  themePublish, themeApply, themeTry, themeUndoTry, themePersonalSet, themePersonalClear, themeExport, themeShots, themeCopy, themeDelete,
  ...layoutCommands, ...studioCommands,
  batch,
  ...moderationCommands, ...governanceCommands,
  mcpCommand,
);

