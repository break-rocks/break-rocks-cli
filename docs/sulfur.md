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
  a list); an argument the server does not take is left out when the command gave it no value (`null`, or an empty
  list), and refused with `NOT_ON_NEW_BACKEND` when it did, `false` and `""` included (never sent without it); a variable is declared with the server's type of its argument
  (an enum the server takes as a `String`, an optional `requestId`); the fields of an input the server lacks are left out
  when empty, refused when given. Talc's `Universe.image` (an `Image`) is asked as the server's `shownImage`; an `image` the
  server answers as a media id where talc answers an `Image` (`MyUniverse.image`, `GroupChat.image`) comes back as the
  `Image` of that id, its other fields `null` (`[]` for a list).
- **Adapted**: an operation the server serves otherwise by design has an adapter (`src/sulfur/talc.ts` `ADAPTERS`) that asks
  the server's operation and answers the talc shape: `me` and `account` (the talc account read by `accounts(ids)`),
  `updateProfile` (`ProfileInput { name, bio, avatar }`), `setFollow` (`follow` / `unfollow`; the server's `Following`
  has no date: `createdAt` is `null`), `isFollowing` (`relations`, below), `setBlock` (`block` / `unblock`), `setMute`
  (`mute` / `unmute`), `saveToMyPlaces` (a place saved with its name and point, read from its `placeCard`: deviation
  6c-1), `sendQuickPoll` (the discussion by its id: a group chat's id, `dm.<the two account ids, sorted>` for a
  conversation, a universe discussion's read by `universeDiscussion(address)`), `voteOnContribution` and
  `withdrawContributionVote` (with `--discussion`, as the messages below), `deleteTheme` (the theme read by
  `theme(universe, name)`, deleted by its id; the answer is the theme as it was, `deleted: true`), and since 0.46.0:
  - `requestEmailChange` / `confirmEmailChange` (deviation 1d): the auth service's `POST /auth/email/change/start` and
    `/verify`, on a fresh sign-in (≤ 10 minutes; else the server's refusal, told with its code); the change
    started is kept 10 minutes for the profile (`sessions/<profile>.sulfur-email-change.json`, 0600: the new address, never a
    code) so that `me email confirm` names it; an account signed in by e-mail gets a second code at its former address:
    `me email confirm <code> --former-code <code>`. The change ends the trust of every session: sign in again (with the new
    address) before the next credential act;
  - `confirmAccountDeletion` (deviation 1d, TO-CONFIRM D-558 on the server): no e-mailed token; `me delete` on a fresh
    sign-in is the deletion itself, in its recovery window; `me delete confirm` sends nothing and reads it back
    (`me.deletion`): `deletedAt` is when it takes effect, `disappearsAt` `null`; none asked: `ACCOUNT_DELETION_NOT_REQUESTED`;
  - `removeUniverseDiscussionMessage` (deviation 1c): `deleteMessage` by a moderator, the discussion by its id (a reply of a
    thread with `--thread-root`); no entry of the moderation log yet (4a): the talc entry is drawn from what was asked;
  - `publishUniversePage` (3e): the page saved as a studio draft (`saveStudioDraft(kind: PAGE)`; a talc page, its canvases, is
    sent as a `break-rocks-page/1` document with no block beside them), then used (`useStudioDraft`: the next version of the
    page of its name, or a new page), the draft deleted after; the version the file holds is checked first against
    `pageOfUniverse` (`PAGE_VERSION_CONFLICT`, `errorInfo.version`);
  - `clipFeed` (P4): the account's clips are For You's sequence (`clipFeedSequence`, its items' posts; `reason` `null`), an
    address's are its posts filtered `CLIPS` (`posts(address, filter: CLIPS)`);
  - since 0.47.0, `setUniverseDisplay` (§ Proposal changes of the server): the server answers `true` where talc answers the
    universe, so the universe is read after it (`universe(name)`) with the command's selection.
- **isFollowing**: the server's `relations` tells `follows` (any follow) and `universes`, the path keys of the scoped
  follows (no `%`; each level case-folded and mapped through the Unicode confusables: `games` is `garnes`), never the
  everywhere follow. So `accounts is-following @bob` is `true` when Bob is followed and no universe is listed, `@bob%paris`
  is `true` when Paris is listed or the follow is everywhere, `false` when Bob is not followed; and `null` when the
  relation cannot tell (Bob followed in universes, asked everywhere or in another universe: the everywhere follow may be
  there too; a universe name beyond ASCII, which the CLI cannot key). A server field `everywhere` on `Relation` would
  remove the `null`.
- **Groups**: `messages groups create` with an account not connected: the server makes the group and answers the
  refused invitations beside it (a partial answer: `GROUP_INVITATIONS_REFUSED`, `errorInfo.refused`): the CLI keeps the
  group and tells each invitation refused (`refused` in `--json`).
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
- **Own commands**: `login` (e-mail code, browser, device code), `logout`, `whoami`, `doctor` (the session, the API's
  health, the talc operations the server does not serve), `agents login` and `operator login` (below).
- **Agents** (RFC 7523, `src/sulfur/agent.ts`): a delegated agent (`agents create` keeps its key as a local agent; `--agent
  <name>`, or BREAKROCKS_OPERATOR_ID, BREAKROCKS_AGENT_ID and BREAKROCKS_AGENT_KEY) or an agent operator signs an EdDSA
  assertion (`kid`: the SHA-256 of its raw public key; `iss` = `sub` = its id; `aud`: the cell's token endpoint; 2 minutes;
  a `jti`) exchanged at `/oauth/token` (`jwt-bearer`) for a token acting for its owner; every command does it by itself and
  again when the token ends (no refresh token), `iat` 30 seconds back (a clock a little ahead of the server's). `whoami`,
  `usage` and `me capabilities` say who acts from the session: `human`, `delegated-agent` (its `agentId`) or `operator`.
  The session keeps the id of the agent that signed it in: another agent in the same profile signs in again, never with
  its token. An agent is never signed into a human's session file: the BREAKROCKS_* variables (or the key of an agent's
  profile) beside a profile holding a human, or beside a human's session, are refused with `PROFILE_HOLDS_HUMAN`; a person
  signs in (`login`) neither into an agent's profile (`PROFILE_HOLDS_AGENT_ACCOUNT`) nor with those variables set.
  `doctor` signs an agent in with its key when it has no session yet. A delegated agent posts a video there without
  `--license`: the server takes no media license at upload yet (a license given is refused, `NOT_ON_NEW_BACKEND`), so the
  former backend's `MEDIA_LICENSE_REQUIRED` is not asked there.
- **Environment**: a session is of one environment. `login` keeps the profile as a person's (`kind: human`) with its
  environment, so another `--env` with it is refused (`ENV_MISMATCH`, exit 2); a session of another environment than the one
  asked is refused the same way, before any request: a command for dev never reaches prod with a session of prod.
- **MCP and batch**: `breakrocks --backend sulfur mcp` serves every tool on the new backend (as `--profile`, `--env` and
  `--agent`); `batch` runs each line on the backend of its run (its stand-in, or its refusal there).
- **Messages**: the server names a message by its discussion (D-628): `messages react`, `unreact`, `thread`,
  `reply-thread`, `vote` and `unvote` take `--discussion <id>` there (and `--thread-root`); the answers of the message
  reads carry `discussion.id`. `messages quick-poll` names its discussion as everywhere (`--with`, `--group`, `--channel`).
  Since 0.47.0 (server `6bd5daf1`): `messages direct send`, `messages groups send` and `discussions send` send a place alone
  (`--place-point <lat>,<lon> --place-name <name>`: `SendMessageInput.place`), the first two an arrival notice alone
  (`--arrival <zone name>`), and `discussions send --stance FOR|AGAINST|QUESTION` its stance (a temporary universe
  discussion only: `STANCE_NOT_ALLOWED` elsewhere); a place or an arrival beside a text, a file, media or a link is refused
  before anything is sent. The message reads answer the server's new `Message` fields (`place`, `arrival`, `stance`,
  `spans`, `display`, `language`, `via`, `myVote`, `quickPoll` and the cards `discussionCard`, `voteCard`, `eventCard`,
  `playlistCard`, `routeCard`; `event` stays `null`, TO-CONFIRM D-712 on the server) in `--json` and in plain text; the
  one-line form (`messages changes`, `pinned`, `edit`, `quick-poll`) adds the place, the arrival, the stance, my vote, the
  quick poll (its choices, `*` mine, the totals once shown), the agent (`via`) and the language.
- **Universe direction and layouts** (server `cc3f09f9`): `universes profile set %u` (`setUniverseProfile`)
  sets the first focus (`--first-focus POSTS|CLIPS|MAP|DEBATES`), the universe strip (`--no-universe-strip`), the default
  layout (`--layout %u/name`) and the governance page's (`--governance-layout`), and clears them (`--clear FIRST_FOCUS`,
  `LAYOUT`, `GOVERNANCE_LAYOUT`); the theme stays `look themes apply`. `look layouts publish`, `publish-version`, `copy` and
  `delete` are served; `look layouts list` reads the catalog without the layouts' documents (the server reads an account
  layout's document only when asked: `look layouts show` reads one), `--query` is a name prefix. `universes show` prints the
  new `Universe` fields: `url`, `field` (and `fieldSuggested`, always false there), `residentCount`, `firstFocus`,
  `universeStrip`, `governanceLayoutRef`, `joinRefusal` with `canJoinAt`. `universes join` during the rejoin delay is
  refused `REJOIN_WAIT` (the server's message is the instant one may join again; `Universe.joinRefusal` says
  `REJOIN_TOO_SOON`): told "You left this universe recently: you can join it again from <instant>". Run against dev on
  2026-11-28 (a fresh account, deleted after): a copy kept as a studio draft then deleted, a copy published in `%paris`, its
  document read, its next version published, the catalog by prefix, the layout deleted; the strip and a layout of a private
  universe set, read back and cleared (`%paris` refused `UNIVERSE_GOVERNED`); join, leave and `REJOIN_WAIT`.
- **Invitations to group chats**: `messages settings set --invite-policy connections|nobody|except` (`setSettings.messaging`)
  and `me invite-exceptions add|remove @handle` (`setInviteException`, 1,000 at most) are served. An invitation the policy
  refuses is declined silently: the inviter gets its invitation, the invitee never sees it (checked on dev on 2026-11-28).
- **Proposals** (`proposals file`): the server files the kinds `ACTION`, `OTHER`, `CHARTER` (with `--max-moderators`),
  `MANIFESTO`, `MODERATION_RULES`, `MODERATOR_ELECTION`, `MODERATOR_REVOCATION`, `RECALL`, `PROPOSAL_SUMMARIES`, `SHOWCASE`,
  `DISPLAY_CASE`, `FIELD`, `DAILY_DIGEST`, `CONVERSATION_STARTERS`, `VOTING_METHOD` (`DELEGATED` only),
  `SUB_UNIVERSE_GOVERNANCE_WITHDRAWAL` and `PINNED_CHANNELS`; the CLI refuses the others before anything is sent
  (`NOT_ON_NEW_BACKEND`, with why and the kinds filed there: `THEME`, `LAYOUT`, `APPEARANCE`, `PAGE`, `PLAYLIST`,
  `CHANNEL`, `TERRITORY`, `ADVERTISING`, `FOLDING_COEFFICIENT`, `SECOND_ROUND`), and so the changes the server does not take
  (`watermark`, `territory`, `theme`, `layoutRef`, `restoreLayoutVersion`, `appearance`, `studioDraftId`,
  `playlistAction`, `channelAction`, `local`, `foldingCoefficient`) and a showcase clearing anything but its image (`LOGO`)
  (`src/sulfur/talc.ts` `GUARDS`). `governance field` (`setUniverseField`) and `governance display` (adapted, above) are the
  leadership's (`ONLY_LEADERSHIP_SETS_FIELD`, `LEADERSHIP_ONLY`; without leadership, a proposal of kind `FIELD` or
  `DISPLAY_CASE`). `Proposal.discussion` and `notApplied`, `UniverseNews.decisions` and `LiveLine.vote` / `poll` are
  answered.

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

What the server refused or answered otherwise while the CLI was run against dev (2026-11-25, server at `e6d0f0da`; the rows
of the media, the place feats and billing revised on 2026-11-26 for the server at `3e3a9fba`). None is worked around in the CLI.

| Operation | What happens | Code | Note |
|---|---|---|---|
| `requestUpload(destination: post \| reply \| quote, address)` | A post's media name its posting address (talc's `MediaUploadInput.address`; `scope` and `address` together are `BAD_DESTINATION`): no universe is looked up, so the first post of a new universe (or sub-level) carries its images, its clip or its video. The universe is placed when the media are processed (a moment later: `universes show` answers `UNIVERSE_NOT_FOUND` until then) | — | Works: the CLI sends the address as given (`%` added when missing); `UNIVERSE_REQUIRED` is gone. A universe's image or banner still names the universe's id (`scope`). |
| `requestUpload(kind: video)` | A long video is refused to a free account | `SUBSCRIPTION_REQUIRED` | By design (D-454); billing is dormant, so no account of dev can post one: the long video path (single and in parts) is checked with a clip sent in parts. |
| `follow(address: "%universe")` | A universe alone cannot be followed | `UNIVERSE_ALONE` | By design: one joins a universe; `accounts follow @handle` and `@handle%universe` work. |
| `createPost` → `Post.author.displayName` | `""` for an account without a display name, where `Account.displayName` falls back to the handle (talc-deviations 1d) | — | Cosmetic. |
| `createUniverseEvent` | Refused to a member who cannot vote yet: `RESIDENTS_ONLY` before joining, then, since the server's D-659 revision, `VOTE_ACCOUNT_TOO_RECENT` or `VOTE_JOINED_TOO_RECENTLY` with `errorInfo { days, minutes, at }` (at the first level, the group of friends, an account of 1 day and a membership of 1 day, in every environment; it was 3 days and 1 day) | `VOTE_ACCOUNT_TOO_RECENT`, `VOTE_JOINED_TOO_RECENTLY` | By design (governance levels). The CLI tells "You can vote here from <at>: …" and keeps the code and `errorInfo` in `--json`; `universes residences` tells where the resident stands ("account 0 of 1 day"). |
| `startPlaceFeatRun`, `endPlaceFeatRun`, `publishFeat` | Place feats are seeded on dev (the five landmarks of Paris, the server's `tools/place-feats/seed.ts`): `mapPlaceFeats` answers them (checked on 2026-11-26 with `map place-feats --cells 861fb4677ffffff`); `publishFeat` of a challenge run still answers `EXPERIENCE_INSTANCE_NOT_FOUND` | — | Reads work. The journey does not start a place feat run yet (it needs a position near the place). A challenge's run, its measures and its feat flag work. |
| `startExperienceRun` (tournament, contest) | A tournament or a judged contest is run in a group instance only (`EXPERIENCE_RUN_PLACE_INVALID`) and names an edition (`EDITION_NAME_INVALID`) | — | `experiences runs start <id> --discussion '{"groupChatId":"…"}' --edition <name>`; by design. |
| `createPost` (and every post) with an agent's token (RFC 7523, `act.sub` = the agent) | The post is created, but its `author` is a tombstone (`handle: ""`, `deleted: true`) and it carries no agent mark (`via: null`, `ai: false`, `automated: false`) | — | Server bug: an agent's post must show its owner's card with the agent mark. |
| `reactToMessage(discussionId: <group chat>)` | A message of a group chat answers `MESSAGE_NOT_FOUND` | `MESSAGE_NOT_FOUND` | Reactions and threads are for universe discussions (talc; `replyInThread` says so with `THREAD_NOT_ALLOWED`); a clearer refusal than "not found" would help. Universe discussions are opened by the governance (`LEADERSHIP_ONLY`), so not verifiable with new accounts on dev. |
| `buyGiftCode`, `billingPortal`, `startSubscription` and the other sales | Billing is gated: while the cell's Stripe webhook secret (`native-stripe-webhook`) is absent, as in dev ("Stripe sales closed in this cell"), they are refused before any Stripe call (server talc-deviations 5a, `syncedCatalog`) | `PROVIDER_NOT_AVAILABLE` | The CLI tells "Not available yet: payments are closed on this platform until its payment provider is set up" and keeps the code. Never run by the journey (no payment, no gift code). |
| Operator registration (REST `features/billing/operators.ts`, x402) | Not ported to the CLI | — | `operator register` answers `NOT_ON_NEW_BACKEND`; an operator with a key signs in by RFC 7523 (`operator login`). |
| `sendMessage(place \| arrival)` (server `6bd5daf1`, 2026-11-28) | A place or an arrival sent alone is stored and read back (`place.name`, `arrival.zoneName`), but its `kind` is `message` and its `text` `""` | — | talc's description names "a message of kind ARRIVAL"; the CLI shows the place or the arrival whatever the kind. |
| `connectionStates` → `canInvite` (2026-11-28) | `true` for an account whose invite policy is `nobody`, or `except` with the caller excepted, though the invitation is then declined silently | — | talc: "whether the caller can invite it (its invitePolicy and its exceptions)". |
| `setUniverseProfile(governanceLayoutRef)` on a private universe (server `cc3f09f9`, 2026-11-28) | Answers the universe with `governanceLayoutRef: null`, no refusal: nothing is set | — | A private universe has no governance page; a refusal would say so. The private universe's `firstFocus` is refused `UNIVERSE_FOCUS_NOT_OFFERED`, a layout other than `feed-first`, `village-square` or `hud` `UNIVERSE_LAYOUT_NOT_OFFERED`. |
| `Message.language` (2026-11-28) | `null` for a short French sentence ("Bonjour à tous, voici https://break.rocks") | — | By design when unsure (detection at read). |
| (posts) emoji reactions | Neither talc nor the server has a reaction on a post (likes and dislikes only); reactions are on messages | — | `posts like` / `posts dislike`; `messages react` for messages. |

## Commands

Generated by `npx tsx scripts/sulfur-table.ts --write` from the code (the operations each command sends, checked against
the server's schema and the adapters); **Dev** marks the commands run against dev (last on 2026-11-28, `scripts/sulfur-verified.ts`): they did what they say, or met a refusal of the server listed above. "works"
means the server serves every operation the command sends under its talc name: the server may still refuse a case (its
deviations), which the command then reports with the server's code.

<!-- table -->
649 commands: 573 work as they are, 37 through an adapter, 1 partly, 12 not available, 26 offline; 164 run against dev.

#### account

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `login` | works | yes | (own: auth, me) | stand-in of the new backend |
| `logout` | works | yes | (own: auth, me) | stand-in of the new backend |
| `whoami` | works | yes | (own: auth, me) | stand-in of the new backend |
| `me session` | not available |  | (former hosts) | not served: the former backend's session or agents host |
| `me capabilities` | adapted | yes | me, delegatedAgentAllowance, myUsage | adapted: me |
| `me measures` | works | yes | myPlatformMeasures |  |
| `me measures appeal` | works |  | appealPlatformMeasure |  |
| `me terms` | works | yes | myTermsAcceptance |  |
| `me terms accept` | works |  | acceptTerms, myTermsAcceptance |  |
| `me profile show` | adapted | yes | me | adapted: me |
| `me profile set` | adapted | yes | updateProfile, (media upload) | adapted: updateProfile, media upload (requestUpload) |
| `me handle check` | works |  | handleAvailability |  |
| `me handle change` | works |  | changeHandle |  |
| `me password` | not available |  | changePassword | not served: changePassword |
| `me email change` | adapted | yes | requestEmailChange | adapted: requestEmailChange |
| `me email confirm` | adapted | yes | confirmEmailChange | adapted: confirmEmailChange |
| `me delete` | works | yes | requestAccountDeletion |  |
| `me delete confirm` | adapted | yes | confirmAccountDeletion | adapted: confirmAccountDeletion |
| `me data requests` | works | yes | myDataRequests |  |
| `me data copy` | works |  | requestDataCopy |  |
| `me data download` | works |  | dataCopyDownload |  |
| `me data erase` | works |  | requestBulkErasure |  |
| `me data erase-cancel` | works |  | cancelBulkErasure |  |
| `me data confirm` | works |  | confirmDataRequest |  |
| `me data rectify` | works |  | requestRectification |  |
| `me onboarding` | works | yes | onboarding |  |
| `me onboarding start` | works |  | startOnboarding |  |
| `me onboarding skip` | works |  | skipOnboarding |  |
| `me onboarding record` | works |  | recordOnboardingActivity |  |
| `me invitation-link` | works |  | personalInvitationLink |  |
| `me invitation-link renew` | works |  | renewPersonalInvitationLink |  |
| `me invitation-link read` | works |  | publicInvitationLink |  |
| `me interactions` | works |  | myInteractions |  |
| `me posts` | works |  | myPosts |  |
| `me reports` | works |  | myReports |  |
| `me invite-exceptions add` | works | yes | setInviteException |  |
| `me invite-exceptions remove` | works | yes | setInviteException |  |
| `me notifications` | works |  | notifications, markRead |  |
| `me sanctions` | works |  | mySanctions |  |
| `me sanctions appeal` | works |  | appealSanction |  |
| `me sanctions publish-name` | works |  | setAppealPublishName |  |
| `me navigation` | works |  | mySettings |  |
| `me navigation set` | works |  | setSettings |  |
| `me privacy share-activity` | works |  | mySettings |  |
| `me privacy share-activity set` | works |  | setSettings |  |
| `me tour` | works | yes | mySettings |  |
| `me tour skip` | works |  | setSettings |  |
| `me tour set` | works |  | setSettings |  |

#### agents

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `operator keygen` | offline |  |  | no platform request |
| `operator register` | not available |  |  | the registration of an agent operator (REST and x402 on the new backend) is not ported to the CLI yet |
| `operator login` | works |  | (own: auth, me) | stand-in of the new backend |
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
| `agents create` | works | yes | createDelegatedAgent |  |
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
| `agents login` | works | yes | (own: auth, me) | stand-in of the new backend |
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
| `universes sub` | works | yes | subUniverses |  |
| `universes members` | works | yes | universeMembers |  |
| `universes agent-posts` | works |  | setUniverseAgentPosts |  |
| `universes join` | works | yes | joinUniverse |  |
| `universes leave` | works | yes | leaveUniverse |  |
| `universes private ask-to-join` | works |  | askToJoinUniverse |  |
| `universes favorite add` | works | yes | addFavoriteUniverse |  |
| `universes favorite remove` | works |  | removeFavoriteUniverse |  |
| `universes favorite move` | works |  | moveFavoriteUniverse |  |
| `universes favorite list` | works | yes | favoriteUniverses |  |
| `universes favorite alerts-on` | works |  | setUniverseAlerts |  |
| `universes favorite alerts-off` | works |  | setUniverseAlerts |  |
| `universes favorite skip` | works |  | skipFavoriteUniverses |  |
| `universes private create` | works | yes | createPrivateUniverse |  |
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
| `universes private delete` | works | yes | deletePrivateUniverse |  |
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
| `universes pages get` | works | yes | pageOfUniverse |  |
| `universes pages publish` | adapted | yes | publishUniversePage | adapted: publishUniversePage |
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
| `universes history` | works | yes | universeHistory |  |
| `universes history remove` | works |  | removeRecentUniverse |  |
| `universes history clear` | works |  | clearRecentUniverses |  |
| `universes history visit` | works |  | recordUniverseVisit |  |
| `universes history pause` | works |  | setSettings |  |
| `universes profile set` | works | yes | setUniverseProfile |  |

#### content

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `posts list` | works | yes | posts |  |
| `posts show` | works | yes | post, thread, reposts |  |
| `posts edit` | works | yes | changePost | arguments not taken (refused when given): changePost(authorship) |
| `posts delete` | works | yes | deletePost |  |
| `posts pin` | works |  | setPinnedPost |  |
| `posts unpin` | works |  | setPinnedPost |  |
| `posts feed` | adapted | yes | newPosts, clipFeed, timeline | adapted: clipFeed |
| `posts render` | works |  | post |  |
| `posts export` | works |  | exportUniversePosts |  |
| `drafts list` | works | yes | postDrafts |  |
| `drafts show` | works |  | postDraft |  |
| `drafts save` | adapted | yes | savePostDraft, (media upload) | adapted: media upload (requestUpload) |
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
| `videos list` | works | yes | longVideos |  |
| `videos chapters propose` | works |  | proposedChapters |  |
| `videos chapters set` | works |  | setChapters |  |
| `videos playback` | works |  | recordPlayback |  |
| `videos quota` | works |  | myVideoQuota |  |
| `videos history` | works | yes | videoHistory |  |
| `videos history remove` | works |  | removeFromVideoHistory |  |
| `videos history clear` | works |  | removeFromVideoHistory |  |
| `videos history pause` | works |  | setSettings |  |
| `posts alt` | works |  | setImageAlt |  |
| `posts suggested-alt` | works |  | suggestedAlt |  |
| `posts subtitles on` | works |  | setAutomaticSubtitles |  |
| `posts subtitles off` | works |  | setAutomaticSubtitles |  |
| `posts subtitles correct` | works |  | correctSubtitles |  |
| `posts create` | adapted | yes | createPost, setPostPlace, (media upload) | adapted: media upload (requestUpload); arguments not taken (refused when given): createPost(authorship) |
| `posts reply` | adapted | yes | replyTo, (media upload) | adapted: media upload (requestUpload); arguments not taken (refused when given): replyTo(authorship) |
| `posts quote` | adapted | yes | quote, (media upload) | adapted: media upload (requestUpload); arguments not taken (refused when given): quote(authorship, document) |
| `posts repost` | works | yes | repost | arguments not taken (refused when given): repost(authorship) |
| `posts like` | works | yes | setLike |  |
| `posts unlike` | works |  | setLike |  |
| `posts dislike` | works | yes | setDislike |  |
| `posts undislike` | works |  | setDislike |  |
| `posts not-interested` | works |  | setNotInterested |  |
| `posts clips` | works |  | clipFeedSequence |  |
| `posts clips platform` | works |  | platformClips |  |
| `posts clips popular` | works |  | popularClips |  |
| `posts place` | works | yes | setPostPlace |  |
| `posts thread` | works | yes | thread |  |
| `posts reposts` | works | yes | reposts |  |
| `posts link-preview` | works | yes | linkPreview |  |
| `posts reply-policy` | works | yes | setReplyPolicy |  |
| `polls list` | works | yes | polls |  |
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
| `discussions channels create` | works | yes | openUniverseDiscussion |  |
| `discussions channels join` | works |  | joinUniverseDiscussion |  |
| `discussions channels leave` | works |  | leaveUniverseDiscussion |  |
| `discussions send` | works | yes |  | no talc operation found by the scan: not checked |
| `discussions read` | works |  |  | no talc operation found by the scan: not checked |
| `discussions channels levels` | works | yes | channelProposalLevels |  |
| `messages inbox` | adapted | yes | inbox, sendMessage, (media upload) | adapted: media upload (requestUpload) |
| `messages direct send` | works | yes | messages |  |
| `messages direct read` | works | yes | deleteMessage |  |
| `messages direct delete` | works |  |  | no talc operation found by the scan: not checked |
| `messages direct ephemeral` | works |  | setConversationEphemeral |  |
| `messages groups create` | works | yes | createGroupChat |  |
| `messages groups` | works |  | inbox |  |
| `messages groups show` | works |  | groupChat |  |
| `messages groups send` | works | yes |  | no talc operation found by the scan: not checked |
| `messages groups read` | works | yes |  | no talc operation found by the scan: not checked |
| `messages groups invite` | works | yes | inviteToGroupChat |  |
| `messages groups leave` | works | yes | leaveGroupChat |  |
| `messages groups members` | works |  | groupChatMembers |  |
| `messages groups admins` | works |  | groupChatMembers |  |
| `messages groups admin-add` | works |  | setGroupChatAdmin |  |
| `messages groups admin-remove` | works |  | setGroupChatAdmin |  |
| `messages groups ephemeral` | works |  | setGroupChatEphemeral |  |
| `messages groups invitations` | works | yes | groupChatInvitations |  |
| `messages groups accept` | works | yes | answerGroupChatInvitation |  |
| `messages groups decline` | works | yes | answerGroupChatInvitation |  |
| `messages settings` | works | yes | mySettings |  |
| `messages settings set` | works | yes | setSettings |  |
| `messages direct delete-conversation` | works |  | deleteConversation |  |
| `messages groups edit` | works |  | changeGroupChat |  |
| `messages groups remove` | works |  | removeGroupChatMember |  |
| `messages groups meeting-point` | works |  | setMeetingPoint |  |
| `messages groups step-down` | works |  | stepDownAsGroupChatAdmin |  |
| `messages groups mute` | works |  | setGroupChatMuted |  |
| `messages groups unmute` | works |  | setGroupChatMuted |  |
| `messages edit` | works |  | changeMessage |  |
| `messages typing` | works |  | typing |  |
| `messages changes` | works | yes | messageChanges |  |
| `messages pinned` | works |  | pinnedMessages |  |
| `messages pin` | works |  | setPinnedMessage |  |
| `messages unpin` | works |  | setPinnedMessage |  |
| `messages silence` | works |  | setDiscussionSilence |  |
| `messages unsilence` | works |  | setDiscussionSilence |  |
| `messages quick-poll` | adapted | yes | sendQuickPoll | adapted: sendQuickPoll |
| `messages quick-poll-pick` | works |  | pickQuickPollChoice |  |
| `discussions list` | works | yes | universeDiscussions |  |
| `discussions show` | works |  | universeDiscussion |  |
| `discussions unread` | works | yes | myUnreadDiscussions |  |
| `discussions pin` | works |  | setUniverseDiscussionPinnedByMe |  |
| `discussions unpin` | works |  | setUniverseDiscussionPinnedByMe |  |
| `discussions place set` | works |  | setUniverseDiscussionPlace |  |
| `discussions place remove` | works |  | setUniverseDiscussionPlace |  |
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
| `discussions move` | works |  | moveUniverseDiscussion |  |
| `discussions slow-mode` | works |  | setUniverseDiscussionSlowMode |  |
| `discussions ban` | works |  | setUniverseDiscussionWritingBan |  |
| `discussions unban` | works |  | setUniverseDiscussionWritingBan |  |
| `discussions remove-message` | adapted | yes | removeUniverseDiscussionMessage | adapted: removeUniverseDiscussionMessage |
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
| `messages vote` | adapted |  | voteOnContribution | adapted: voteOnContribution |
| `messages unvote` | adapted |  | withdrawContributionVote | adapted: withdrawContributionVote |
| `messages react` | adapted | yes | reactToMessage | adapted: reactToMessage |
| `messages unreact` | adapted |  | unreactToMessage | adapted: unreactToMessage |
| `messages thread` | adapted | yes | threadMessages | adapted: threadMessages |
| `messages reply-thread` | adapted | yes | replyInThread | adapted: replyInThread |
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
| `map presence` | works | yes | myMapPresence |  |
| `map presence start` | works |  | startMapPresence |  |
| `map presence update` | works |  | updateMapPresence |  |
| `map presence audience` | works |  | setMapPresenceAudience |  |
| `map presence ghost on` | works |  | setGhostMode |  |
| `map presence ghost off` | works |  | setGhostMode |  |
| `map presence stop` | works |  | stopMapPresence |  |
| `map live-share list` | works | yes | myLiveShares |  |
| `map live-share in` | works |  | liveShares |  |
| `map live-share start` | works |  | setLiveShare |  |
| `map live-share stop` | works |  | setLiveShare |  |
| `map live-share positions` | works |  | livePositions |  |
| `map live-share send` | works |  | sendLivePositions |  |
| `map locatable` | works | yes | myLocatable |  |
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
| `my-places tags` | works | yes | myPlacesTags |  |
| `my-places tags create` | works |  | createMyPlacesTag |  |
| `my-places tags edit` | works |  | updateMyPlacesTag |  |
| `my-places tags delete` | works |  | deleteMyPlacesTag |  |
| `my-places share` | works |  | shareMyPlaces |  |
| `my-places shared` | works |  | myPlacesPlaylist |  |
| `my-places playlist` | works |  | playlist |  |
| `routes list` | works | yes | myMapRoutes |  |
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
| `moderation report` | works | yes | report |  |
| `proposals list` | works | yes | proposals |  |
| `proposals show` | works |  | proposal |  |
| `proposals file` | works | yes | fileProposal |  |
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
| `moderation log` | works | yes | moderationLog |  |
| `moderation moderators` | works |  | universeModerators |  |
| `moderation appoint` | works |  | appointModerator |  |
| `moderation appeals` | works |  | universeAppeals |  |
| `moderation decide-appeal` | works |  | decideUniverseAppeal |  |
| `governance show` | works | yes | universeGovernance |  |
| `governance history` | works |  | governanceMoments |  |
| `governance ask` | works |  | askLeadership |  |
| `governance questions` | works |  | leadershipQuestions |  |
| `governance answer` | works |  | answerLeadershipQuestion |  |
| `governance manifesto` | works |  | universeManifesto |  |
| `governance manifesto-set` | works |  | setUniverseManifesto |  |
| `governance successors` | works |  | setUniverseSuccessors |  |
| `governance transfer` | works |  | transferUniverse |  |
| `governance field` | works | yes | setUniverseField |  |
| `governance display` | adapted | yes | setUniverseDisplay | adapted: setUniverseDisplay |
| `governance territory` | works |  | setUniverseTerritory |  |
| `governance my-vote` | works |  | myStandingIn |  |
| `governance lend-votes` | works |  | lendVotes |  |
| `governance withdraw-votes` | works |  | withdrawVotes |  |
| `governance proposals` | works |  | proposals |  |
| `governance record` | works |  | governanceRecords |  |
| `governance duties` | works |  | myJuryDuties |  |
| `governance layout` | works |  | appliedLayout |  |
| `governance pinned` | works |  | universe |  |
| `governance pin` | works |  | setPinnedUniverseDiscussions |  |
| `governance residents` | works | yes | universeResidents |  |
| `governance welcome-wall` | works |  | welcomeWall |  |
| `governance welcome` | works |  | welcomeResident |  |
| `governance news` | works | yes | universeNews |  |
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
| `governance like-question` | works |  | setLeadershipQuestionLike |  |
| `governance unlike-question` | works |  | setLeadershipQuestionLike |  |
| `moderation remove-agent-text` | works |  | removePlatformAgentText |  |

#### look

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `look themes list` | works | yes | themeCatalog, theme |  |
| `look themes show` | works |  | themeCatalog |  |
| `look themes gallery` | works |  | themeCatalog |  |
| `look appearance history` | works |  | universeAppearanceHistory |  |
| `look appearance restore` | works |  | restoreUniverseAppearance, theme |  |
| `look appearance show` | works | yes | universe, theme, appliedLayout, universeAppearanceHistory, proposals |  |
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
| `look themes delete` | adapted |  | deleteTheme | adapted: deleteTheme |
| `look layouts list` | works | yes | layoutCatalog, themeCatalog |  |
| `look layouts show` | works | yes | layout |  |
| `look layouts check` | works | yes | checkLayout, themeCatalog |  |
| `look layouts publish` | works | yes | publishLayout, themeCatalog |  |
| `look layouts publish-version` | works |  | publishLayout, themeCatalog |  |
| `look layouts apply` | works |  | setUniverseProfile |  |
| `look layouts copy` | works | yes | copyLayout |  |
| `look layouts delete` | works | yes | deleteLayout |  |
| `look studio drafts` | works | yes | studioDrafts |  |
| `look studio show` | works |  | studioDraft |  |
| `look studio save` | works |  | saveStudioDraft, themeCatalog |  |
| `look studio delete` | works | yes | deleteStudioDraft |  |
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
| `accounts block` | adapted | yes | setBlock | adapted: setBlock |
| `accounts unblock` | adapted | yes | setBlock | adapted: setBlock |
| `accounts mute` | adapted | yes | setMute | adapted: setMute |
| `accounts unmute` | adapted | yes | setMute | adapted: setMute |
| `explore` | works | yes | recommendations, timeColumn, suggestions |  |
| `explore why` | works |  | whyRecommended |  |
| `explore muted` | works |  | myMutedUniverses |  |
| `explore mute` | works |  | muteUniverseDiscovery |  |
| `explore unmute` | works |  | unmuteUniverseDiscovery |  |
| `explore reset` | works |  | resetRecommendations |  |
| `explore resolve` | works | yes | resolveAddress |  |
| `search` | works | yes | search |  |
| `interests show` | works | yes | myInterestProfile |  |
| `interests add` | works |  | addInterests |  |
| `interests fields` | works |  | chooseFields |  |
| `interests forget` | works |  | forgetInterests |  |
| `interests tags` | works |  | myEngagedTags |  |
| `interests not-interested` | works |  | myNotInterested |  |
| `explore search` | works | yes | exploreSearch |  |
| `explore random` | works | yes | randomHighlight |  |
| `explore today` | adapted |  | me, highlightOfTheDay | adapted: me |
| `explore area` | works |  | exploreUniverses |  |
| `accounts show` | adapted | yes | accountByHandle, account | adapted: account |
| `accounts followers` | works | yes | followers |  |
| `accounts following` | works | yes | following |  |
| `accounts replies` | works | yes | replies |  |
| `accounts is-following` | adapted | yes | isFollowing | adapted: isFollowing |
| `connections request` | works | yes | requestConnection |  |
| `connections accept` | works | yes | answerConnectionRequest |  |
| `connections decline` | works |  | answerConnectionRequest |  |
| `connections remove` | works | yes | removeConnection |  |
| `connections list` | works | yes | myAccounts |  |
| `connections requests` | works | yes | connectionRequests |  |
| `connections state` | works | yes | connectionStates |  |
| `connections mine` | works |  | myConnections |  |

#### money

| Command | On sulfur | Dev | Operations | Note |
|---|---|---|---|---|
| `subscription show` | works | yes | mySubscription |  |
| `subscription offer` | works | yes | subscriptionOffer |  |
| `subscription start` | works |  | startSubscription |  |
| `subscription renewal on` | works |  | setAutomaticRenewal |  |
| `subscription renewal off` | works |  | setAutomaticRenewal |  |
| `subscription billing-day offer` | works |  | billingDayOffer |  |
| `subscription billing-day set` | works |  | setBillingDay |  |
| `subscription portal` | works | yes | openBillingPortal |  |
| `subscription seller-verify` | works |  | verifySellerIdentity |  |
| `gift-codes offer` | works |  | giftCodeOffer |  |
| `gift-codes list` | works | yes | myGiftCodes |  |
| `gift-codes buy` | works | yes | buyGiftCode |  |
| `gift-codes redeem` | works |  | redeemGiftCode |  |
| `gift-codes refund` | works |  | refundGiftCode |  |
| `ads campaigns` | works | yes | myAdCampaigns |  |
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
| `doctor` | works | yes | (own: auth, me) | stand-in of the new backend |
| `links shorten` | works | yes | createShortLink |  |
| `links resolve` | works |  | shortLink |  |
| `batch` | works |  |  | no talc operation found by the scan: not checked |
| `mcp` | offline | yes |  | no platform request |

<!-- /table -->
