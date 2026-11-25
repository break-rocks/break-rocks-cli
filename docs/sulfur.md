# The CLI on the new backend (native-sulfur)

`--backend sulfur` (or `BREAKROCKS_BACKEND=sulfur`, or `config set backend sulfur`) runs the CLI against native-sulfur
(dev: `https://eu.api.dev.break.rocks`). The former backend (`legacy`) is unchanged and stays the default. README § The new
backend says how the sign-in, the tokens and the transport work; this page says what each command does there.

## How the commands run there

The new backend serves the talc GraphQL schema (API v2, the CLI's own contract) as its starting point (D-612), with the
deviations of the server's `docs/talc-deviations.md`. So the CLI keeps its commands and their `--json` outputs, and every
GraphQL request goes through one seam (`src/session.ts` `api()` → `src/sulfur/talc.ts`):

- **Served as is**: the document is fitted to the schema the server serves (`src/sulfur/fit.ts`; the schema copied in
  `schema/sulfur/server.graphql` and compacted in `src/sulfur/schema.generated.ts` by `npm run update:sulfur-schema`, from
  the server checkout `../server`): a field the server's type lacks is left out and answered `null` (`[]` where talc answers
  a list); an argument the server does not take is left out when the command gave it no value, and refused with
  `NOT_ON_NEW_BACKEND` when it did (never sent without it); a variable is declared with the server's type of its argument
  (an enum the server takes as a `String`, an optional `requestId`); the fields of an input the server lacks are left out
  when empty, refused when given.
- **Adapted**: an operation the server serves otherwise by design has an adapter (`src/sulfur/talc.ts` `ADAPTERS`) that asks
  the server's operation and answers the talc shape: `me` and `account` (the talc account read by `accounts(ids)`),
  `updateProfile` (`ProfileInput { name, bio, avatar }`), `setFollow` (`follow` / `unfollow`), `isFollowing` (`relations`),
  `setBlock` (`block` / `unblock`), `setMute` (`mute` / `unmute`), `saveToMyPlaces` (a place saved with its name and
  point, read from its `placeCard`: deviation 6c-1).
- **Media**: `requestUpload` (`src/sulfur/media.ts`): the kind (`image`, `clip` = a post's video of at most 3 minutes, `video`
  = a long video, horizontal, more than 3 minutes, `document`), the destination (`post`, `reply`, `quote` scoped by the
  universe's id; `avatar`; `playlist` scoped by the playlist), the SHA-256 of the file, and for a clip or a long video its
  duration and orientation read from its MP4 header (`src/mp4.ts`; a WebM or a fragmented MP4 is refused before anything is
  sent: `VIDEO_HEADER_UNREADABLE`). Up to 500 MB, the signed form; above (or above `BREAKROCKS_MULTIPART_ABOVE` bytes), in
  parts of 64 MiB, each `PUT` with its own `x-amz-checksum-sha256`, tried again alone, then `completeUpload`; the parts done
  are kept in `uploads/` so the same command run again resumes (`resumeUpload`). A post is created while its media are
  processed (`publication: PROCESSING`, then `PUBLISHED`); the avatar waits until its image is processed.
- **Not served**: an operation the server does not serve answers `NOT_ON_NEW_BACKEND` (exit 1) with `operation` named; the
  commands of the former backend's own hosts (operator registration and sign-in, `session`, `agents tier`) are refused the
  same way, and so is anything that would open a session of the former backend.
- **Own commands**: `login` (e-mail code, browser, device code), `logout`, `whoami`.

## For automation (several personas)

```sh
export BREAKROCKS_BACKEND=sulfur BREAKROCKS_KEYCHAIN=off
export BREAKROCKS_CLI_DIR=~/personas/alice        # one folder per persona: its profile, its session, its uploads
breakrocks --env dev login --email alice@inbox.dev.break.rocks --sign-up --json   # {"codeSent":true,...}
echo "1234 5678" | breakrocks --env dev login --email alice@inbox.dev.break.rocks --code - --handle alice_bot --json
breakrocks whoami --json
```

The session is renewed on its own (single-flight across processes); it ends after 24 hours unused or 7 days: sign in again.

## Server findings

What the server refused or answered otherwise while the CLI was run against dev (2026-11-25, server at `e6d0f0da` for the
schema). None is worked around in the CLI.

| Operation | What happens | Code | Note |
|---|---|---|---|
| `requestUpload(destination: post, scope: <universe id>)` | A post's media name the id of an existing universe, so the first post of a new universe (or sub-level) cannot carry media: the CLI says so (`UNIVERSE_REQUIRED`) and the text post creates it | (CLI guard) | Publish a text first, then the media post. Clients that create a universe by its first post with an image need a scope for a universe not created yet. |
| `requestUpload(kind: video)` | A long video is refused to a free account | `SUBSCRIPTION_REQUIRED` | By design (D-454); billing is dormant, so no account of dev can post one: the long video path (single and in parts) is checked with a clip sent in parts. |
| `follow(address: "%universe")` | A universe alone cannot be followed | `UNIVERSE_ALONE` | By design: one joins a universe; `accounts follow @handle` and `@handle%universe` work. |
| `createPost` → `Post.author.displayName` | `""` for an account without a display name, where `Account.displayName` falls back to the handle (talc-deviations 1d) | — | Cosmetic. |
| `createUniverseEvent` | Refused to a member who cannot vote yet: `RESIDENTS_ONLY` before joining, then `REQUIREMENT_NOT_MET` ("you cannot vote here yet": an account of 3 days and a membership of 1 day at the first level) | `REQUIREMENT_NOT_MET` | By design (governance levels). Dev was reset on 2026-11-25, so no account can create an event there before 2026-11-28; the CLI's request is fitted and reaches the server's rule. |
| `startPlaceFeatRun`, `endPlaceFeatRun`, `publishFeat` | No place feat on dev (they are seeded by the back office): `placeFeats` and `mapPlaceFeats` answer `[]`, `publishFeat` of a challenge run `EXPERIENCE_INSTANCE_NOT_FOUND` | — | Not verifiable on dev until place feats are seeded. A challenge's run, its measures and its feat flag work. |
| `startExperienceRun` (tournament, contest) | A tournament or a judged contest is run in a group instance only (`EXPERIENCE_RUN_PLACE_INVALID`) and names an edition (`EDITION_NAME_INVALID`) | — | `experiences runs start <id> --discussion '{"groupChatId":"…"}' --edition <name>`; by design. |
| `createGroupChat(invite: [not connected])` | The group is created with the creator alone, the account not connected is left out without a word (no refusal, no invitation) | — | `inviteToGroupChat` refuses it (`NOT_CONNECTED`): connect first (`connections request`, `connections accept`). |
| (posts) emoji reactions | Neither talc nor the server has a reaction on a post (likes and dislikes only); reactions are on messages | — | `posts like` / `posts dislike`; `messages react` for messages. |

## Commands

Generated by `npx tsx scripts/sulfur-table.ts --write` from the code (the operations each command sends, checked against
the server's schema and the adapters); **Dev** marks the commands run against dev (`scripts/sulfur-verified.ts`). "works"
means the server serves every operation the command sends under its talc name: the server may still refuse a case (its
deviations), which the command then reports with the server's code.

<!-- table -->
648 commands: 560 work as they are, 22 through an adapter, 4 partly, 36 not available, 26 offline; 62 run against dev.

#### account

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `login` | works | yes | (own: auth, me) | stand-in of the new backend |
| `logout` | works | yes | (own: auth, me) | stand-in of the new backend |
| `whoami` | works | yes | (own: auth, me) | stand-in of the new backend |
| `me session` | not available |  | (former hosts) | not served: the former backend's session or agents host |
| `me capabilities` | adapted | yes | me, delegatedAgentAllowance, myUsage | adapted: me |
| `me measures` | works |  | myPlatformMeasures |  |
| `me measures appeal` | works |  | appealPlatformMeasure |  |
| `me terms` | works |  | myTermsAcceptance |  |
| `me terms accept` | works |  | acceptTerms, myTermsAcceptance |  |
| `me profile show` | adapted | yes | me | adapted: me |
| `me profile set` | adapted | yes | updateProfile, (media upload) | adapted: updateProfile, media upload (requestUpload) |
| `me handle check` | works |  | handleAvailability |  |
| `me handle change` | works |  | changeHandle |  |
| `me password` | not available |  | changePassword | not served: changePassword |
| `me email change` | not available |  | requestEmailChange | not served: requestEmailChange |
| `me email confirm` | not available |  | confirmEmailChange | not served: confirmEmailChange |
| `me delete` | works |  | requestAccountDeletion |  |
| `me delete confirm` | not available |  | confirmAccountDeletion | not served: confirmAccountDeletion |
| `me data requests` | works |  | myDataRequests |  |
| `me data copy` | works |  | requestDataCopy |  |
| `me data download` | works |  | dataCopyDownload |  |
| `me data erase` | works |  | requestBulkErasure |  |
| `me data erase-cancel` | works |  | cancelBulkErasure |  |
| `me data confirm` | works |  | confirmDataRequest |  |
| `me data rectify` | works |  | requestRectification |  |
| `me onboarding` | works |  | onboarding |  |
| `me onboarding start` | works |  | startOnboarding |  |
| `me onboarding skip` | works |  | skipOnboarding |  |
| `me onboarding record` | works |  | recordOnboardingActivity |  |
| `me invitation-link` | works |  | personalInvitationLink |  |
| `me invitation-link renew` | works |  | renewPersonalInvitationLink |  |
| `me invitation-link read` | works |  | publicInvitationLink |  |
| `me interactions` | works |  | myInteractions |  |
| `me posts` | works |  | myPosts |  |
| `me reports` | works |  | myReports |  |
| `me invite-exceptions add` | not available |  | setInviteException | not served: setInviteException |
| `me invite-exceptions remove` | not available |  | setInviteException | not served: setInviteException |
| `me notifications` | works |  | notifications, markRead |  |
| `me sanctions` | works |  | mySanctions |  |
| `me sanctions appeal` | works |  | appealSanction |  |
| `me sanctions publish-name` | works |  | setAppealPublishName |  |
| `me navigation` | works |  | mySettings |  |
| `me navigation set` | works |  | setSettings |  |
| `me privacy share-activity` | works |  | mySettings |  |
| `me privacy share-activity set` | works |  | setSettings |  |
| `me tour` | works |  | mySettings |  |
| `me tour skip` | works |  | setSettings |  |
| `me tour set` | works |  | setSettings |  |

#### agents

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `operator keygen` | offline |  |  | no platform request |
| `operator register` | not available |  |  | an agent operator registers on the agents host of the former backend |
| `operator login` | not available |  |  | an agent operator signs in on the agents host of the former backend |
| `operator renew` | not available |  |  | the agents host of the former backend |
| `operator recover` | not available |  |  | the agents host of the former backend |
| `operator recovery-key set` | not available |  |  | the agents host of the former backend |
| `operator delete` | not available |  |  | the agents host of the former backend |
| `operator plan offer` | works |  | operatorPlanOffer |  |
| `operator plan show` | works |  | myOperatorPlan |  |
| `operator plan start` | adapted |  | startOperatorPlan, me, operatorPlanOffer | adapted: me |
| `operator plan change` | works |  | changeOperatorPlan |  |
| `operator plan stop` | works |  | setOperatorPlanRenewal |  |
| `operator plan resume` | works |  | setOperatorPlanRenewal |  |
| `agents create` | works |  | createDelegatedAgent |  |
| `agents list` | works |  |  | no talc operation found by the scan: not checked |
| `agents show` | works |  | changeDelegatedAgent |  |
| `agents rename` | works |  |  | no talc operation found by the scan: not checked |
| `agents suspend` | works |  |  | no talc operation found by the scan: not checked |
| `agents reactivate` | works |  |  | no talc operation found by the scan: not checked |
| `agents delete` | works |  | deleteDelegatedAgent |  |
| `agents restrict` | works |  |  | no talc operation found by the scan: not checked |
| `agents regenerate` | works |  | regenerateDelegatedAgentCredentials |  |
| `agents tier` | not available |  |  | x402 on the agents host of the former backend |
| `agents activity` | works |  | delegatedAgentActivity |  |
| `agents local` | offline |  |  | no platform request |
| `agents import` | offline |  |  | no platform request |
| `agents forget` | offline |  |  | no platform request |
| `agents login` | not available |  | (former hosts) | not served: the former backend's session or agents host |
| `agents attest` | works |  |  | no talc operation found by the scan: not checked |
| `wallet set` | offline |  |  | no platform request |
| `wallet show` | offline |  |  | no platform request |
| `wallet balance` | works |  |  | no talc operation found by the scan: not checked |
| `wallet faucet` | offline |  |  | no platform request |

#### universes

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `universes show` | works | yes | universe, theme, universeGovernance, universeMembers |  |
| `universes list` | works |  | exploreUniverses |  |
| `universes sub` | works |  | subUniverses |  |
| `universes members` | works |  | universeMembers |  |
| `universes agent-posts` | not available |  | setUniverseAgentPosts | not served: setUniverseAgentPosts |
| `universes join` | works | yes | joinUniverse |  |
| `universes leave` | works | yes | leaveUniverse |  |
| `universes private ask-to-join` | works |  | askToJoinUniverse |  |
| `universes favorite add` | works |  | addFavoriteUniverse |  |
| `universes favorite remove` | works |  | removeFavoriteUniverse |  |
| `universes favorite move` | works |  | moveFavoriteUniverse |  |
| `universes favorite list` | works |  | favoriteUniverses |  |
| `universes favorite alerts-on` | works |  | setUniverseAlerts |  |
| `universes favorite alerts-off` | works |  | setUniverseAlerts |  |
| `universes favorite skip` | works |  | skipFavoriteUniverses |  |
| `universes private create` | works |  | createPrivateUniverse |  |
| `universes private invite` | works |  | inviteToUniverse |  |
| `universes private conditions` | works |  | universeConditions |  |
| `universes private conditions set` | works |  | setUniverseConditions |  |
| `universes private conditions accept` | works |  | acceptUniverseConditions |  |
| `universes private join-requests` | works |  | joinRequests |  |
| `universes private join-requests accept` | works |  | answerJoinRequest |  |
| `universes private join-requests decline` | works |  | answerJoinRequest |  |
| `universes private join-requests accept-all` | works |  | answerAllJoinRequests |  |
| `universes private join-requests decline-all` | works |  | answerAllJoinRequests |  |
| `universes private invitations` | works |  | universeInvitations |  |
| `universes private invitations accept` | works |  | answerUniverseInvitation |  |
| `universes private invitations decline` | works |  | answerUniverseInvitation |  |
| `universes private admins add` | works |  | setUniverseAdmin |  |
| `universes private admins remove` | works |  | setUniverseAdmin |  |
| `universes private transfer accept` | works |  | answerUniverseTransfer |  |
| `universes private transfer decline` | works |  | answerUniverseTransfer |  |
| `universes private delete` | works |  | deletePrivateUniverse |  |
| `universes private delete-cancel` | works |  | cancelUniverseDeletion |  |
| `universes private set` | works |  | changePrivateUniverse |  |
| `universes private domains` | works |  | pendingDomains |  |
| `universes private domains check` | works |  | checkDnsProof |  |
| `universes private team-tier` | works |  | chooseTeamMemberTier |  |
| `universes private declare` | not available |  | declareUniverse | not served: declareUniverse |
| `universes private expose` | works |  | exposeUniverse |  |
| `universes private hide` | works |  | hideUniverse |  |
| `universes private reactivate` | works |  | reactivateUniverse |  |
| `universes private reputation` | not available |  | privateUniverseReputation | not served: privateUniverseReputation |
| `universes private reputation set` | not available |  | setUniverseReputation | not served: setUniverseReputation |
| `universes search-words` | works |  | setUniverseSearchWords |  |
| `universes identity` | adapted |  | setUniverseIdentity, (media upload) | adapted: media upload (requestUpload) |
| `universes private tiers offer` | works |  | offerSubscriptionTier |  |
| `universes private tiers change` | works |  | changeSubscriptionTier |  |
| `universes private tiers withdraw` | works |  | withdrawSubscriptionTier |  |
| `universes private tiers subscribe` | works |  | startTierSubscription |  |
| `universes private tiers renewal on` | works |  | setTierSubscriptionRenewal |  |
| `universes private tiers renewal off` | works |  | setTierSubscriptionRenewal |  |
| `universes residences` | works |  | myPresences |  |
| `universes sub-map` | works |  | subUniverseMap |  |
| `universes landing` | works |  | universeLanding |  |
| `universes land` | works |  | markLanding |  |
| `universes listed` | works |  | setListedOnMembersPage |  |
| `universes unlisted` | works |  | setListedOnMembersPage |  |
| `universes territory get` | works |  | universe |  |
| `universes territory set` | works |  | setUniverseTerritory |  |
| `universes territory remove` | works |  | setUniverseTerritory |  |
| `universes territory report` | works |  | report |  |
| `universes pages` | works |  | universe |  |
| `universes pages get` | works |  | pageOfUniverse |  |
| `universes pages publish` | not available |  | publishUniversePage | not served: publishUniversePage |
| `universes pages check` | works |  | checkLayout |  |
| `universes pages hide` | works |  | setUniversePageHidden |  |
| `universes pages unhide` | works |  | setUniversePageHidden |  |
| `universes pages move` | works |  | moveUniversePage |  |
| `universes pages delete` | works |  | deleteUniversePage |  |
| `universes pages export` | works |  | exportUniversePages |  |
| `universes pages import` | works |  | importUniversePages |  |
| `universes pages report` | works |  | report |  |
| `universes time-column` | works |  | timeColumn |  |
| `universes live` | works |  | liveLine |  |
| `universes tags conventions` | works |  | setUniverseTagConventions |  |
| `universes tags suggestions` | works |  | universeTagSuggestions |  |
| `universes tags view` | works |  | universeTagView |  |
| `universes history` | works |  | universeHistory |  |
| `universes history remove` | works |  | removeRecentUniverse |  |
| `universes history clear` | works |  | clearRecentUniverses |  |
| `universes history visit` | works |  | recordUniverseVisit |  |
| `universes history pause` | works |  | setSettings |  |

#### content

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `posts list` | works | yes | posts |  |
| `posts show` | works | yes | post, thread, reposts |  |
| `posts edit` | works |  | changePost | arguments not taken (refused when given): changePost(authorship) |
| `posts delete` | works | yes | deletePost |  |
| `posts pin` | works |  | setPinnedPost |  |
| `posts unpin` | works |  | setPinnedPost |  |
| `posts feed` | partly | yes | newPosts, clipFeed, timeline | not served: clipFeed |
| `posts render` | works |  | post |  |
| `posts export` | works |  | exportUniversePosts |  |
| `drafts list` | works |  | postDrafts |  |
| `drafts show` | works |  | postDraft |  |
| `drafts save` | adapted |  | savePostDraft, (media upload) | adapted: media upload (requestUpload) |
| `drafts schedule` | works |  | schedulePostDraft |  |
| `drafts publish` | works |  | publishPostDraft |  |
| `drafts delete` | works |  | deletePostDraft |  |
| `posts repost-request` | works |  | requestRepost |  |
| `posts repost-requests` | works |  | repostRequests |  |
| `posts repost-requests accept` | works |  | answerRepostRequest |  |
| `posts repost-requests decline` | works |  | answerRepostRequest |  |
| `playlists hub` | works | yes | playlistsHub |  |
| `playlists followed` | works |  | followedPlaylists |  |
| `playlists show` | works | yes | playlist |  |
| `playlists create` | works | yes | createPlaylist |  |
| `playlists edit` | works |  | updatePlaylist |  |
| `playlists delete` | works |  | deletePlaylist |  |
| `playlists add` | works | yes | addToPlaylist |  |
| `playlists remove` | works |  | removeFromPlaylist |  |
| `playlists move` | works |  | movePlaylistItem |  |
| `playlists follow` | works |  | setPlaylistFollow |  |
| `playlists unfollow` | works |  | setPlaylistFollow |  |
| `playlists pin` | works |  | pinPlaylist |  |
| `playlists unpin` | works |  | pinPlaylist |  |
| `playlists add-link` | works |  | addLinkToPlaylist |  |
| `playlists add-doc` | adapted |  | addDocumentToPlaylist, (media upload) | adapted: media upload (requestUpload) |
| `playlists item-edit` | works |  | updatePlaylistCourseItem |  |
| `playlists item-remove` | works |  | removePlaylistCourseItem |  |
| `playlists check` | works |  | checkPlaylistItem |  |
| `playlists check-item` | works |  | checkPlaylistCourseItem |  |
| `playlists reset-progress` | works |  | resetPlaylistProgress |  |
| `playlists checkmarks` | works |  | setPlaylistCheckmarks |  |
| `playlists tags` | works |  | setPlaylistItemTags |  |
| `playlists track` | works |  | setPlaylistTrack |  |
| `playlists tracks` | works |  | setPlaylistTracks |  |
| `videos list` | works |  | longVideos |  |
| `videos chapters propose` | works |  | proposedChapters |  |
| `videos chapters set` | works |  | setChapters |  |
| `videos playback` | works |  | recordPlayback |  |
| `videos quota` | works |  | myVideoQuota |  |
| `videos history` | works |  | videoHistory |  |
| `videos history remove` | works |  | removeFromVideoHistory |  |
| `videos history clear` | works |  | removeFromVideoHistory |  |
| `videos history pause` | works |  | setSettings |  |
| `posts alt` | works |  | setImageAlt |  |
| `posts suggested-alt` | works |  | suggestedAlt |  |
| `posts subtitles on` | works |  | setAutomaticSubtitles |  |
| `posts subtitles off` | works |  | setAutomaticSubtitles |  |
| `posts subtitles correct` | works |  | correctSubtitles |  |
| `posts create` | adapted | yes | createPost, setPostPlace, (media upload) | adapted: media upload (requestUpload); arguments not taken (refused when given): createPost(announcement, authorship, document) |
| `posts reply` | adapted | yes | replyTo, (media upload) | adapted: media upload (requestUpload); arguments not taken (refused when given): replyTo(authorship) |
| `posts quote` | adapted | yes | quote, (media upload) | adapted: media upload (requestUpload); arguments not taken (refused when given): quote(authorship, document) |
| `posts repost` | works | yes | repost | arguments not taken (refused when given): repost(authorship) |
| `posts like` | works | yes | setLike |  |
| `posts unlike` | works |  | setLike |  |
| `posts dislike` | works |  | setDislike |  |
| `posts undislike` | works |  | setDislike |  |
| `posts not-interested` | works |  | setNotInterested |  |
| `posts clips` | works |  | clipFeedSequence |  |
| `posts clips platform` | works |  | platformClips |  |
| `posts clips popular` | works |  | popularClips |  |
| `posts place` | works | yes | setPostPlace |  |
| `posts thread` | works | yes | thread |  |
| `posts reposts` | works |  | reposts |  |
| `posts link-preview` | works |  | linkPreview |  |
| `posts reply-policy` | works |  | setReplyPolicy |  |
| `polls list` | works |  | polls |  |
| `polls show` | works |  | poll |  |
| `polls create` | works |  | createPoll |  |
| `polls pick` | works |  | pickPollChoice |  |
| `polls support` | works |  | supportPoll |  |

#### talk

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `messages meetups answer` | works |  | answerMeetUp |  |
| `messages meetups change` | works |  | changeMeetUp |  |
| `messages meetups cancel` | works |  | cancelMeetUp |  |
| `discussions debates list` | works |  | universeDiscussions |  |
| `discussions debates show` | works |  | universeDiscussion |  |
| `discussions debates open` | works |  | openUniverseDiscussion |  |
| `discussions debates propose` | works |  | proposeUniverseDiscussion |  |
| `discussions debates support` | works |  | supportUniverseDiscussion |  |
| `discussions debates close` | works |  | closeUniverseDiscussion |  |
| `discussions channels` | works |  | universeDiscussions |  |
| `discussions channels create` | works |  | openUniverseDiscussion |  |
| `discussions channels join` | works |  | joinUniverseDiscussion |  |
| `discussions channels leave` | works |  | leaveUniverseDiscussion |  |
| `discussions send` | works |  |  | no talc operation found by the scan: not checked |
| `discussions read` | works |  |  | no talc operation found by the scan: not checked |
| `discussions channels levels` | not available |  | channelProposalLevels | not served: channelProposalLevels |
| `messages inbox` | adapted |  | inbox, sendMessage, (media upload) | adapted: media upload (requestUpload) |
| `messages direct send` | works |  | messages |  |
| `messages direct read` | works |  | deleteMessage |  |
| `messages direct delete` | works |  |  | no talc operation found by the scan: not checked |
| `messages direct ephemeral` | works |  | setConversationEphemeral |  |
| `messages groups create` | works | yes | createGroupChat |  |
| `messages groups` | works |  | inbox |  |
| `messages groups show` | works |  | groupChat |  |
| `messages groups send` | works |  |  | no talc operation found by the scan: not checked |
| `messages groups read` | works |  |  | no talc operation found by the scan: not checked |
| `messages groups invite` | works | yes | inviteToGroupChat |  |
| `messages groups leave` | works |  | leaveGroupChat |  |
| `messages groups members` | works |  | groupChatMembers |  |
| `messages groups admins` | works |  | groupChatMembers |  |
| `messages groups admin-add` | works |  | setGroupChatAdmin |  |
| `messages groups admin-remove` | works |  | setGroupChatAdmin |  |
| `messages groups ephemeral` | works |  | setGroupChatEphemeral |  |
| `messages groups invitations` | works | yes | groupChatInvitations |  |
| `messages groups accept` | works | yes | answerGroupChatInvitation |  |
| `messages groups decline` | works |  | answerGroupChatInvitation |  |
| `messages settings` | works |  | mySettings |  |
| `messages settings set` | works |  | setSettings |  |
| `messages direct delete-conversation` | works |  | deleteConversation |  |
| `messages groups edit` | works |  | changeGroupChat |  |
| `messages groups remove` | works |  | removeGroupChatMember |  |
| `messages groups meeting-point` | works |  | setMeetingPoint |  |
| `messages groups step-down` | works |  | stepDownAsGroupChatAdmin |  |
| `messages groups mute` | works |  | setGroupChatMuted |  |
| `messages groups unmute` | works |  | setGroupChatMuted |  |
| `messages edit` | works |  | changeMessage |  |
| `messages typing` | works |  | typing |  |
| `messages changes` | works |  | messageChanges |  |
| `messages pinned` | works |  | pinnedMessages |  |
| `messages pin` | works |  | setPinnedMessage |  |
| `messages unpin` | works |  | setPinnedMessage |  |
| `messages silence` | works |  | setDiscussionSilence |  |
| `messages unsilence` | works |  | setDiscussionSilence |  |
| `messages quick-poll` | works |  | sendQuickPoll | arguments not taken (refused when given): sendQuickPoll(discussion) |
| `messages quick-poll-pick` | works |  | pickQuickPollChoice |  |
| `discussions list` | works |  | universeDiscussions |  |
| `discussions show` | works |  | universeDiscussion |  |
| `discussions unread` | works |  | myUnreadDiscussions |  |
| `discussions pin` | works |  | setUniverseDiscussionPinnedByMe |  |
| `discussions unpin` | works |  | setUniverseDiscussionPinnedByMe |  |
| `discussions place set` | not available |  | setUniverseDiscussionPlace | not served: setUniverseDiscussionPlace |
| `discussions place remove` | not available |  | setUniverseDiscussionPlace | not served: setUniverseDiscussionPlace |
| `discussions mine` | works |  | myUniverseDiscussions |  |
| `discussions limits` | works |  | universeDiscussionLimits |  |
| `discussions moderators` | works |  | universeDiscussionModerators |  |
| `discussions moderators add` | works |  | setUniverseDiscussionModerator |  |
| `discussions moderators remove` | works |  | setUniverseDiscussionModerator |  |
| `discussions writing-bans` | works |  | universeDiscussionWritingBans |  |
| `discussions active` | works |  | universeDiscussionActiveMembers |  |
| `discussions extend` | works |  | extendUniverseDiscussion |  |
| `discussions summary approve` | works |  | answerUniverseDiscussionSummary |  |
| `discussions summary decline` | works |  | answerUniverseDiscussionSummary |  |
| `discussions cap` | works |  | setUniverseDiscussionCap |  |
| `discussions creation members` | works |  | setUniverseDiscussionCreation |  |
| `discussions creation managers` | works |  | setUniverseDiscussionCreation |  |
| `discussions archive` | works |  | setUniverseDiscussionArchived |  |
| `discussions unarchive` | works |  | setUniverseDiscussionArchived |  |
| `discussions move` | not available |  | moveUniverseDiscussion | not served: moveUniverseDiscussion |
| `discussions slow-mode` | works |  | setUniverseDiscussionSlowMode |  |
| `discussions ban` | works |  | setUniverseDiscussionWritingBan |  |
| `discussions unban` | works |  | setUniverseDiscussionWritingBan |  |
| `discussions remove-message` | not available |  | removeUniverseDiscussionMessage | not served: removeUniverseDiscussionMessage |
| `discussions delete` | works |  | deleteUniverseDiscussion |  |
| `discussions agents forbid` | works |  | setUniverseDiscussionAgents |  |
| `discussions agents allow` | works |  | setUniverseDiscussionAgents |  |
| `discussions mute` | works |  | setUniverseDiscussionMuted |  |
| `discussions unmute` | works |  | setUniverseDiscussionMuted |  |
| `discussions presence-choice set` | works |  | setPresenceVisibility |  |
| `discussions presence-choice` | works |  | mySettings |  |
| `discussions present` | works |  | universeDiscussionPresent |  |
| `messages universes` | works |  | myDiscussionsInMessages |  |
| `messages mentions` | works |  | myDiscussionMentions |  |
| `messages ignore-mention` | works |  | ignoreDiscussionMention |  |
| `messages remove-discussion` | works |  | removeDiscussionFromMessages |  |
| `messages block-universe` | works |  | setUniverseBlockedInMessages |  |
| `messages unblock-universe` | works |  | setUniverseBlockedInMessages |  |
| `messages vote` | works |  | voteOnContribution |  |
| `messages unvote` | works |  | withdrawContributionVote |  |
| `messages react` | works |  | reactToMessage |  |
| `messages unreact` | works |  | unreactToMessage |  |
| `messages thread` | works |  | threadMessages |  |
| `messages reply-thread` | works |  | replyInThread |  |
| `messages delete` | works |  | deleteMessage |  |

#### map

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `map places search` | works | yes | places |  |
| `map boundary` | works |  |  | no talc operation found by the scan: not checked |
| `map routes` | works |  | mapRouteMarkers |  |
| `map posts` | works | yes | mapPosts |  |
| `map places` | works |  | mapRecentPlaces |  |
| `map place-feats` | works |  | mapPlaceFeats |  |
| `map place-card` | works |  | placeCard |  |
| `map presences` | works |  | mapPresences |  |
| `map groups` | works |  | mapPresenceGroups |  |
| `map presence` | works |  | myMapPresence |  |
| `map presence start` | works |  | startMapPresence |  |
| `map presence update` | works |  | updateMapPresence |  |
| `map presence audience` | works |  | setMapPresenceAudience |  |
| `map presence ghost on` | works |  | setGhostMode |  |
| `map presence ghost off` | works |  | setGhostMode |  |
| `map presence stop` | works |  | stopMapPresence |  |
| `map live-share list` | works |  | myLiveShares |  |
| `map live-share in` | works |  | liveShares |  |
| `map live-share start` | works |  | setLiveShare |  |
| `map live-share stop` | works |  | setLiveShare |  |
| `map live-share positions` | works |  | livePositions |  |
| `map live-share send` | works |  | sendLivePositions |  |
| `map locatable` | works |  | myLocatable |  |
| `map locatable residents` | works |  | locatableResidents |  |
| `map locatable on` | works |  | setLocatable |  |
| `map locatable off` | works |  | setLocatable |  |
| `map locatable move` | works |  | updateLocatableCell |  |
| `map nearby token` | works |  | createNearbyToken |  |
| `map nearby request` | works |  | requestNearbyConnection |  |
| `map nearby requests` | works |  | nearbyRequests |  |
| `map nearby accept` | works |  | answerNearbyConnection |  |
| `map nearby decline` | works |  | answerNearbyConnection |  |
| `map nearby leave` | works |  | leaveNearby |  |
| `map nearby sightings` | works |  | recordNearbySightings |  |
| `my-places list` | works | yes | myPlaces |  |
| `my-places show` | works |  | mySavedItem |  |
| `my-places save` | adapted | yes | saveToMyPlaces | adapted: saveToMyPlaces |
| `my-places edit` | works |  | updateSavedItem |  |
| `my-places remove` | works |  | removeSavedItem |  |
| `my-places clear` | works |  | clearMyPlaces |  |
| `my-places tags` | works |  | myPlacesTags |  |
| `my-places tags create` | works |  | createMyPlacesTag |  |
| `my-places tags edit` | works |  | updateMyPlacesTag |  |
| `my-places tags delete` | works |  | deleteMyPlacesTag |  |
| `my-places share` | works |  | shareMyPlaces |  |
| `my-places shared` | works |  | myPlacesPlaylist |  |
| `my-places playlist` | works |  | playlist |  |
| `routes list` | works |  | myMapRoutes |  |
| `routes show` | works |  | mapRouteByUrl, mapRoute |  |
| `routes nearby` | works |  | nearbyRoutes |  |
| `routes create` | works |  | saveMapRoute |  |
| `routes edit` | works |  | saveMapRoute |  |
| `routes delete` | works |  | deleteMapRoute |  |
| `routes copy` | works |  | copyMapRoute |  |
| `routes gpx export` | works |  | mapRouteGpx |  |
| `routes gpx import` | works |  | importGpxRoute |  |
| `routes privacy-zones` | works |  | myRoutePrivacyZones |  |
| `routes privacy-zones set` | works |  | setRoutePrivacyZones |  |
| `routes plan` | works |  | route |  |
| `map avatar` | works |  | myMapAvatar |  |

#### events

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `experiences list` | works |  | experiences |  |
| `experiences show` | works |  | experience |  |
| `experiences export` | works |  | experience, checkExperience |  |
| `experiences check` | works |  | checkExperience, updateExperience, createExperience, publishExperience, experiences |  |
| `experiences import` | works | yes | createExperience |  |
| `experiences prompt` | offline |  |  | no platform request |
| `experiences kinds` | works | yes | experienceKinds |  |
| `experiences publish` | works | yes | publishExperience |  |
| `experiences runs start` | works | yes | startExperienceRun |  |
| `experiences runs join` | works | yes | joinExperienceRun |  |
| `experiences runs leave` | works | yes | leaveExperienceRun |  |
| `experiences runs measure` | works | yes | submitExperienceMeasure |  |
| `experiences runs end` | works | yes | endExperienceRun |  |
| `experiences runs show` | works | yes | experienceRun |  |
| `experiences runs list` | works | yes | myExperienceRuns |  |
| `experiences runs ranking` | works | yes | experienceRunRanking |  |
| `experiences runs draw` | works | yes | drawTournament |  |
| `experiences runs tournament` | works | yes | actOnTournament |  |
| `experiences runs contest` | works | yes | actOnContest |  |
| `experiences runs entries` | works | yes | contestEntries |  |
| `experiences feats list` | works | yes | myFeats |  |
| `experiences feats at` | works | yes | placeFeats |  |
| `experiences feats start` | works |  | startPlaceFeatRun |  |
| `experiences feats end` | works |  | endPlaceFeatRun |  |
| `experiences feats publish` | works | yes | publishFeat |  |
| `experiences prefill keys` | offline |  |  | no platform request |
| `experiences prefill build` | works |  |  | no talc operation found by the scan: not checked |
| `experiences prefill open` | works |  |  | no talc operation found by the scan: not checked |
| `events list` | works | yes | universeEvents |  |
| `events create` | works | yes | createUniverseEvent |  |
| `events attend` | works |  | attendUniverseEvent |  |
| `events support` | works |  | supportUniverseEvent |  |
| `events change` | works |  | changeUniverseEvent |  |
| `events delete` | works |  | deleteUniverseEvent |  |
| `events attendees` | works |  | universeEventAttendees |  |
| `events relay` | works |  | relayUniverseEvent |  |
| `events relay support` | works |  | supportEventRelay |  |
| `events relay remove` | works |  | removeEventRelay |  |
| `events relays proposals` | works |  | eventRelayProposals |  |
| `events catalog` | works | yes | eventCatalog |  |

#### governance

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `moderation report` | works |  | report |  |
| `proposals list` | works |  | proposals |  |
| `proposals show` | works |  | proposal |  |
| `proposals file` | works |  | fileProposal |  |
| `proposals support` | works |  | supportProposal |  |
| `proposals vote` | works |  | voteOnProposal |  |
| `proposals withdraw` | works |  | withdrawProposal |  |
| `proposals votes` | works |  | proposalVotes |  |
| `proposals mine` | works |  | myProposals |  |
| `proposals projects` | works |  | projects |  |
| `proposals project-status` | works |  | setProjectStatus |  |
| `proposals project-done` | works |  | declareProjectDone |  |
| `proposals refusal-review` | works |  | askProposalRefusalReview |  |
| `proposals change` | works |  | changeProposal |  |
| `jury accept` | works |  | answerJuryDraw |  |
| `jury decline` | works |  | answerJuryDraw |  |
| `jury reviews` | works |  | askSanctionReviews |  |
| `jury vote` | works |  | voteAsJuror |  |
| `jury withdraw` | works |  | withdrawFromJury |  |
| `moderation awaiting` | works |  | postsAwaitingApproval |  |
| `moderation approve` | works |  | approvePost |  |
| `moderation remove` | works |  | removePostAsModerator |  |
| `moderation dismiss-reports` | works |  | dismissReports |  |
| `moderation hide-reply` | works |  | setReplyHidden |  |
| `moderation unhide-reply` | works |  | setReplyHidden |  |
| `moderation posting-ban` | works |  | givePostingBan |  |
| `moderation ban` | works |  | setUniverseBan |  |
| `moderation lift-ban` | works |  | setUniverseBan |  |
| `moderation bans` | works |  | universeBans |  |
| `moderation reports` | works |  | reportedContent |  |
| `moderation appearance-reports` | works |  | reportedContent |  |
| `moderation log` | works |  | moderationLog |  |
| `moderation moderators` | works |  | universeModerators |  |
| `moderation appoint` | works |  | appointModerator |  |
| `moderation appeals` | works |  | universeAppeals |  |
| `moderation decide-appeal` | works |  | decideUniverseAppeal |  |
| `governance show` | works |  | universeGovernance |  |
| `governance history` | works |  | governanceMoments |  |
| `governance ask` | not available |  | askLeadership | not served: askLeadership |
| `governance questions` | works |  | leadershipQuestions |  |
| `governance answer` | not available |  | answerLeadershipQuestion | not served: answerLeadershipQuestion |
| `governance manifesto` | works |  | universeManifesto |  |
| `governance manifesto-set` | works |  | setUniverseManifesto |  |
| `governance successors` | works |  | setUniverseSuccessors |  |
| `governance transfer` | works |  | transferUniverse |  |
| `governance field` | not available |  | setUniverseField | not served: setUniverseField |
| `governance display` | not available |  | setUniverseDisplay | not served: setUniverseDisplay |
| `governance territory` | works |  | setUniverseTerritory |  |
| `governance my-vote` | works |  | myStandingIn |  |
| `governance lend-votes` | works |  | lendVotes |  |
| `governance withdraw-votes` | works |  | withdrawVotes |  |
| `governance proposals` | works |  | proposals |  |
| `governance record` | works |  | governanceRecords |  |
| `governance duties` | works |  | myJuryDuties |  |
| `governance layout` | works |  | appliedLayout |  |
| `governance pinned` | works |  | universe |  |
| `governance pin` | not available |  | setPinnedUniverseDiscussions | not served: setPinnedUniverseDiscussions |
| `governance residents` | works |  | universeResidents |  |
| `governance welcome-wall` | works |  | welcomeWall |  |
| `governance welcome` | works |  | welcomeResident |  |
| `governance news` | works |  | universeNews |  |
| `governance pulse` | works |  | universePulse |  |
| `governance manifesto-versions` | works |  | universeManifestoVersions |  |
| `governance sub-governance` | works |  | giveSubUniverseGovernance |  |
| `governance move-pinned` | works |  | movePinnedPost |  |
| `governance unpin-announcement` | works |  | unpinAnnouncement |  |
| `governance backup-delegate` | works |  | setBackupDelegate |  |
| `governance votes-accept` | works |  | setVoteReception |  |
| `governance votes-refuse` | works |  | setVoteReception |  |
| `governance vote-holders` | works |  | voteHolders |  |
| `governance feed-reviews` | works |  | feedRemovalReviews |  |
| `governance feed-review-vote` | works |  | voteOnFeedRemovalReview |  |
| `governance like-question` | not available |  | setLeadershipQuestionLike | not served: setLeadershipQuestionLike |
| `governance unlike-question` | not available |  | setLeadershipQuestionLike | not served: setLeadershipQuestionLike |
| `moderation remove-agent-text` | works |  | removePlatformAgentText |  |

#### look

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `look themes list` | works |  | themeCatalog, theme |  |
| `look themes show` | works |  | themeCatalog |  |
| `look themes gallery` | works |  | themeCatalog |  |
| `look appearance history` | works |  | universeAppearanceHistory |  |
| `look appearance restore` | works |  | restoreUniverseAppearance, theme |  |
| `look appearance show` | works |  | universe, theme, appliedLayout, universeAppearanceHistory, proposals |  |
| `look appearance looks` | works |  | appearanceLooks |  |
| `look appearance palette` | works |  | imagePalette |  |
| `look appearance build` | works |  | buildUniverseAppearance |  |
| `look appearance apply` | works |  | applyUniverseAppearance, theme |  |
| `look themes prompt` | offline |  |  | no platform request |
| `look themes check` | offline |  |  | no platform request |
| `look themes pack` | offline |  |  | no platform request |
| `look themes unpack` | offline |  |  | no platform request |
| `look themes typefaces` | works |  | approvedTypefaces |  |
| `look themes publish` | adapted |  | publishTheme, themeCatalog, (media upload) | adapted: media upload (requestUpload); arguments not taken (refused when given): publishTheme(universe) |
| `look themes apply` | works |  | setUniverseProfile |  |
| `look personal set` | works |  | setPersonalTheme |  |
| `look personal clear` | works |  | setPersonalTheme |  |
| `look personal saved` | not available | yes | personalThemes | not served: personalThemes |
| `look themes export` | partly |  | themeCatalog, (former hosts) | not served: the former backend's session or agents host |
| `look themes shots` | works |  | themeCatalog |  |
| `look themes delete` | works |  | deleteTheme | arguments not taken (refused when given): deleteTheme(name, universe) |
| `look layouts list` | works |  | layoutCatalog |  |
| `look layouts show` | works |  | layout |  |
| `look layouts check` | works |  | checkLayout, themeCatalog |  |
| `look layouts publish` | partly |  | publishLayout, themeCatalog | not served: publishLayout |
| `look layouts publish-version` | partly |  | publishLayout, themeCatalog | not served: publishLayout |
| `look layouts apply` | works |  | setUniverseProfile |  |
| `look layouts copy` | not available |  | copyLayout | not served: copyLayout |
| `look layouts delete` | not available |  | deleteLayout | not served: deleteLayout |
| `look studio drafts` | works |  | studioDrafts |  |
| `look studio show` | works |  | studioDraft |  |
| `look studio save` | works |  | saveStudioDraft, themeCatalog |  |
| `look studio delete` | works |  | deleteStudioDraft |  |
| `look studio use` | works |  | useStudioDraft |  |
| `look studio make-theme` | works |  | useStudioDraft |  |
| `look studio try` | works |  | startUniverseThemeTrial |  |
| `look studio end-try` | works |  | endUniverseThemeTrial |  |
| `look studio preview` | works |  | startDraftPreview |  |
| `look studio end-preview` | works |  | endDraftPreview |  |
| `look studio make-layout` | works |  | useStudioDraft |  |
| `look studio make-page` | works |  | useStudioDraft |  |

#### explore

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `accounts follow` | adapted | yes | setFollow | adapted: setFollow |
| `accounts unfollow` | adapted | yes | setFollow | adapted: setFollow |
| `accounts block` | adapted |  | setBlock | adapted: setBlock |
| `accounts unblock` | adapted |  | setBlock | adapted: setBlock |
| `accounts mute` | adapted |  | setMute | adapted: setMute |
| `accounts unmute` | adapted |  | setMute | adapted: setMute |
| `explore` | works |  | recommendations, timeColumn, suggestions |  |
| `explore why` | works |  | whyRecommended |  |
| `explore muted` | works |  | myMutedUniverses |  |
| `explore mute` | works |  | muteUniverseDiscovery |  |
| `explore unmute` | works |  | unmuteUniverseDiscovery |  |
| `explore reset` | works |  | resetRecommendations |  |
| `explore resolve` | not available |  | resolveAddress | not served: resolveAddress |
| `search` | works |  | search |  |
| `interests show` | works |  | myInterestProfile |  |
| `interests add` | works |  | addInterests |  |
| `interests fields` | works |  | chooseFields |  |
| `interests forget` | works |  | forgetInterests |  |
| `interests tags` | works |  | myEngagedTags |  |
| `interests not-interested` | works |  | myNotInterested |  |
| `explore search` | works |  | exploreSearch |  |
| `explore random` | works |  | randomHighlight |  |
| `explore today` | adapted |  | me, highlightOfTheDay | adapted: me |
| `explore area` | works |  | exploreUniverses |  |
| `accounts show` | adapted | yes | accountByHandle, account | adapted: account |
| `accounts followers` | works |  | followers |  |
| `accounts following` | works |  | following |  |
| `accounts replies` | works |  | replies |  |
| `accounts is-following` | adapted | yes | isFollowing | adapted: isFollowing |
| `connections request` | works | yes | requestConnection |  |
| `connections accept` | works | yes | answerConnectionRequest |  |
| `connections decline` | works |  | answerConnectionRequest |  |
| `connections remove` | works |  | removeConnection |  |
| `connections list` | works |  | myAccounts |  |
| `connections requests` | works | yes | connectionRequests |  |
| `connections state` | works |  | connectionStates |  |
| `connections mine` | works |  | myConnections |  |

#### money

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `subscription show` | works |  | mySubscription |  |
| `subscription offer` | works |  | subscriptionOffer |  |
| `subscription start` | works |  | startSubscription |  |
| `subscription renewal on` | works |  | setAutomaticRenewal |  |
| `subscription renewal off` | works |  | setAutomaticRenewal |  |
| `subscription billing-day offer` | works |  | billingDayOffer |  |
| `subscription billing-day set` | works |  | setBillingDay |  |
| `subscription portal` | works |  | openBillingPortal |  |
| `subscription seller-verify` | works |  | verifySellerIdentity |  |
| `gift-codes offer` | works |  | giftCodeOffer |  |
| `gift-codes list` | works |  | myGiftCodes |  |
| `gift-codes buy` | works |  | buyGiftCode |  |
| `gift-codes redeem` | works |  | redeemGiftCode |  |
| `gift-codes refund` | works |  | refundGiftCode |  |
| `ads campaigns` | works |  | myAdCampaigns |  |
| `ads show` | works |  | adCampaign |  |
| `ads create` | works |  | createAdCampaign |  |
| `ads update` | works |  | updateAdCampaign |  |
| `ads submit` | works |  | submitAdCampaign |  |
| `ads pause` | works |  | setAdCampaignState |  |
| `ads resume` | works |  | setAdCampaignState |  |
| `ads end` | works |  | setAdCampaignState |  |
| `ads pay` | works |  | payAdBudget |  |
| `ads suggest` | works |  | adUniverseSuggestions |  |
| `ads group` | works |  | adUniverseGroup |  |
| `ads repository` | works |  | adRepository |  |
| `ads why` | works |  | adWhy |  |
| `ads interests` | works |  | myAdInterests |  |
| `ads interests set` | works |  | setAdInterests |  |

#### tools

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `help` | offline |  |  | no platform request |
| `version` | offline |  |  | no platform request |
| `schema` | offline |  |  | no platform request |
| `completion` | offline |  |  | no platform request |
| `update` | offline |  |  | no platform request |
| `config add` | offline |  |  | no platform request |
| `config use` | offline |  |  | no platform request |
| `config list` | offline |  |  | no platform request |
| `config show` | offline |  |  | no platform request |
| `config remove` | offline |  |  | no platform request |
| `config set` | offline |  |  | no platform request |
| `config unset` | offline |  |  | no platform request |
| `usage` | works | yes | universe, myStandingIn, delegatedAgentAllowance, myUsage |  |
| `doctor` | works |  |  | no talc operation found by the scan: not checked |
| `links shorten` | works |  | createShortLink |  |
| `links resolve` | works |  | shortLink |  |
| `batch` | works |  |  | no talc operation found by the scan: not checked |
| `mcp` | offline |  |  | no platform request |

<!-- /table -->
