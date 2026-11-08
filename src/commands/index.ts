// The commands of the CLI, in the order of the help.
import { register } from '../registry.js';
import { capabilities, usage, whoami } from './account.js';
import { agentAttest, agentLogin } from './agent.js';
import { agentsActivity, agentsCreate, agentsForget, agentsImport, agentsLocal, agentsDelete, agentsList, agentsReactivate, agentsRegenerate, agentsRename, agentsRestrict, agentsShow, agentsSuspend, agentsTier } from './agents.js';
import { completion } from './completion.js';
import { doctor } from './doctor.js';
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
import * as disc from './discussions.js';
import * as gallery from './gallery.js';
import * as history from './history.js';
import * as geo from './geo.js';
import { governanceCommands, governancePin, governancePinned, moderationCommands } from './moderation.js';
import * as pages from './pages.js';
import * as publish from './publish.js';
import * as read from './read.js';
import * as drafts from './drafts.js';
import * as playlists from './playlists.js';
import * as routes from './routes.js';
import * as map from './map.js';
import * as appearance from './appearance.js';
import * as measures from './measures.js';
import * as discovery from './discovery.js';
import { meCommands } from './me.js';
import { chatCommands } from './chats.js';
import { layoutCommands, studioCommands, themeApply, themeDelete, themeExport, themePersonalClear, themePersonalSet, themePublish, themeShots, themesList, themesShow } from './themes-online.js';

register(
  help, version, schema, completion, update,
  profileAdd, profileUse, profileList, profileShow, profileRemove,
  login, logout,
  operatorKeygen, operatorRegister, operatorLogin, operatorRenew, operatorRecover, operatorRecoveryKeySet, operatorDelete,
  operatorPlanOffer, operatorPlanShow, operatorPlanStart, operatorPlanChange, operatorPlanStop, operatorPlanResume,
  agentsCreate, agentsList, agentsShow, agentsRename, agentsSuspend, agentsReactivate, agentsDelete, agentsRestrict, agentsRegenerate, agentsTier, agentsActivity, agentsLocal, agentsImport, agentsForget,
  agentLogin, agentAttest,
  walletSet, walletShow, walletBalance, walletFaucet,
  whoami, sessionCommand, usage, capabilities, doctor,
  measures.meMeasures, measures.meMeasuresAppeal, measures.meTerms, measures.meTermsAccept, ...meCommands,
  read.postsList, read.postsShow, publish.postsEdit, publish.postsDelete, publish.postsPin, publish.postsUnpin,
  read.feed, read.render, read.exportPosts,
  drafts.draftsList, drafts.draftsShow, drafts.draftsSave, drafts.draftsSchedule, drafts.draftsPublish, drafts.draftsDelete,
  drafts.repostsRequest, drafts.repostsRequests, drafts.repostsAccept, drafts.repostsDecline,
  playlists.playlistsHub, playlists.playlistsFollowed, playlists.playlistsShow, playlists.playlistsCreate, playlists.playlistsEdit, playlists.playlistsDelete, playlists.playlistsAdd, playlists.playlistsRemove, playlists.playlistsMove,
  playlists.playlistsFollow, playlists.playlistsUnfollow, playlists.playlistsPin, playlists.playlistsUnpin, playlists.playlistsAddLink, playlists.playlistsAddDoc, playlists.playlistsItemEdit, playlists.playlistsItemRemove,
  playlists.playlistsCheck, playlists.playlistsCheckItem, playlists.playlistsResetProgress, playlists.playlistsCheckmarks, playlists.playlistsTags, playlists.playlistsTrack, playlists.playlistsTracks,
  playlists.videosList, playlists.videosChaptersPropose, playlists.videosChaptersSet, playlists.videosPlayback, playlists.videosQuota,
  drafts.postsAlt, drafts.postsSuggestedAlt, drafts.postsSubtitlesOn, drafts.postsSubtitlesOff, drafts.postsSubtitlesCorrect,
  publish.post, publish.reply, publish.quote, publish.repost, publish.like, publish.unlike, publish.dislike, publish.undislike, publish.notInterested,
  publish.follow, publish.unfollow, publish.block, publish.unblock, publish.mute, publish.unmute, publish.report,
  read.universesShow, read.universesList, read.universesSub, publish.universesMembers, publish.universesAgentPosts, publish.universesJoin, publish.universesLeave, publish.universesAskToJoin,
  publish.favoriteAdd, publish.favoriteRemove, publish.favoriteMove, publish.universesCreatePrivate, publish.universesInvite, publish.conditionsShow, publish.conditionsSet, publish.conditionsAccept,
  geo.territoryGet, geo.territorySet, geo.territoryRemove, geo.territoryReport,
  pages.universePages, pages.pageGet, pages.pagePublish, pages.pageCheck, pages.pageHide, pages.pageShow, pages.pageMove, pages.pageDelete, pages.pagesExport, pages.pagesImport, pages.pageReport,
  read.explore, discovery.exploreWhy, discovery.exploreMuted, discovery.exploreMute, discovery.exploreUnmute, discovery.exploreReset, discovery.resolve, geo.exploreArea, geo.placesSearch, geo.mapBoundary, routes.mapRoutes, routes.mapChannels, routes.mapPosts, routes.mapPlaces, map.mapPresences, map.mapGroups,
  map.presenceShow, map.presenceStart, map.presenceUpdate, map.presenceAudience, map.presenceGhostOn, map.presenceGhostOff, map.presenceStop,
  map.liveShareList, map.liveShareIn, map.liveShareStart, map.liveShareStop, map.liveSharePositions, map.liveShareSend,
  map.locatableShow, map.locatableResidents, map.locatableOn, map.locatableOff, map.locatableMove,
  map.meetupsAnswer, map.meetupsChange, map.meetupsCancel,
  map.nearbyToken, map.nearbyRequest, map.nearbyRequests, map.nearbyAccept, map.nearbyDecline, map.nearbyLeave, map.nearbySightings, map.postsPlace,
  routes.routesList, routes.routesShow, routes.routesCreate, routes.routesEdit, routes.routesDelete, routes.routesCopy, routes.routesGpxExport, routes.routesGpxImport, routes.routesPrivacyZones, routes.routesPrivacyZonesSet, routes.routesPlan, read.timeColumn, read.live, read.accountsShow, read.accountsFollowers, read.accountsFollowing, read.notifications,
  read.eventsList, publish.eventsCreate, publish.eventsAttend,
  read.proposalsList, publish.proposalsShow, publish.proposalsFile, publish.proposalsSupport, publish.proposalsVote, publish.proposalsWithdraw,
  read.debatesList, publish.debatesShow, publish.debatesOpen, publish.debatesPropose, publish.debatesSupport, publish.debatesClose,
  read.pollsList, publish.pollsShow, publish.pollsCreate, publish.pollsPick,
  read.channelsList, publish.channelsCreate, publish.channelsJoin, publish.channelsLeave, msg.channelsSend, msg.channelsRead, disc.channelsLevels,
  msg.inbox, msg.dm, msg.dmRead, msg.dmDelete, msg.dmEphemeral,
  msg.groupsCreate, msg.groupsList, msg.groupsShow, msg.groupsSend, msg.groupsRead, msg.groupsInvite, msg.groupsLeave, msg.groupsMembers, msg.groupsAdmins, msg.groupsAdminAdd, msg.groupsAdminRemove, msg.groupsEphemeral, msg.groupsInvitations, msg.groupsAccept, msg.groupsDecline,
  msg.connectionsRequest, msg.connectionsAccept, msg.connectionsDecline, msg.connectionsRemove, msg.connectionsList, msg.connectionsRequests, msg.connectionsState,
  msg.messagingShow, msg.messagingSet, ...chatCommands,
  disc.discussionsList, disc.discussionsShow, disc.discussionsUnread, disc.discussionsPin, disc.discussionsUnpin, disc.discussionsPlaceSet, disc.discussionsPlaceRemove,
  disc.messagesUniverses, disc.messagesMentions, disc.messagesIgnoreMention, disc.messagesRemoveDiscussion, disc.messagesBlockUniverse, disc.messagesUnblockUniverse, disc.messagesVote, disc.messagesUnvote,
  disc.messagesReact, disc.messagesUnreact, disc.messagesThread, disc.messagesReplyThread, disc.messagesDelete,
  themesList, themesShow,
  gallery.themesGallery, gallery.universesAppearanceHistory, gallery.universesAppearanceRestore,
  appearance.appearanceLooks, appearance.appearancePalette, appearance.appearanceBuild, appearance.appearanceApply,
  appearance.universesTagsConventions, appearance.universesTagsSuggestions, appearance.universesTagsView,
  history.universesHistory, history.universesHistoryRemove, history.universesHistoryClear, history.universesVisit, history.settingsHistoryPause,
  themePromptCommand, themeCheck, themePack, themeUnpack, themeTypefaces,
  themePublish, themeApply, themePersonalSet, themePersonalClear, themeExport, themeShots, themeDelete,
  ...layoutCommands, ...studioCommands, pages.studioMakePage,
  measures.adsCampaigns, measures.adsShow, measures.adsCreate, measures.adsUpdate, measures.adsSubmit, measures.adsPause, measures.adsResume, measures.adsEnd, measures.adsPay,
  measures.adsSuggest, measures.adsGroup, measures.adsRepository, measures.adsWhy, measures.adsInterests, measures.adsInterestsSet,
  batch,
  ...moderationCommands, ...governanceCommands, governancePinned, governancePin,
  mcpCommand,
);

