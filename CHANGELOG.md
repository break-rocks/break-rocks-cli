# Changelog

All notable changes of break-rocks-cli. The format follows [Keep a Changelog](https://keepachangelog.com/);
the contract is API v2 of the platform (`schema/api-v2/*.graphql`). The scope was decided on 2026-10-23.

## [Unreleased]

## [0.47.0] - 2026-11-28

The new backend's schema resynced (`schema/sulfur`, server `6bd5daf1`: the messaging and governance branches).

### Added

- `messages direct send` and `messages groups send` send a place (`--place-point <lat>,<lon> --place-name <name>`) or an
  arrival notice (`--arrival <zone name>`) alone; `discussions send` a place alone. A place or an arrival beside a text, a
  file, media or a link is refused before anything is sent (`INVALID_INPUT`, `PLACE_INVALID`, `ARRIVAL_ZONE_INVALID`).
- The one-line form of a message (`messages changes`, `pinned`, `edit`, `quick-poll`) shows its place, arrival, stance, my
  vote, quick poll (its choices, `*` mine, the totals once shown), agent (`via`) and language.
- New backend: `governance display` goes through an adapter (`setUniverseDisplay` answers `true` there: the universe is
  read after it).
- New backend: `proposals file` refuses before sending the kinds the new backend does not file (`THEME`, `LAYOUT`,
  `APPEARANCE`, `PAGE`, `PLAYLIST`, `CHANNEL`, `TERRITORY`, `ADVERTISING`, `FOLDING_COEFFICIENT`, `SECOND_ROUND`), the
  changes it does not take (`watermark`, `territory`, `theme`, `layoutRef`, `restoreLayoutVersion`, `appearance`,
  `studioDraftId`, `playlistAction`, `channelAction`, `local`, `foldingCoefficient`) and a showcase clearing anything but
  `LOGO`, saying why and naming the kinds filed there (`NOT_ON_NEW_BACKEND`).

### Changed

- New backend: the schema resynced at server `6bd5daf1`: `me invite-exceptions add|remove`, `governance field` and
  `governance display` are served again; `messages settings set --invite-policy` takes `nobody` and `except`; the message
  reads answer `place`, `arrival`, `stance`, `spans`, `display`, `language`, `via`, `myVote`, `quickPoll` and the cards;
  `Proposal.discussion`, `notApplied`, `UniverseNews.decisions`, `LiveLine.vote` and `poll` are answered.

## [0.46.0] - 2026-11-27

The new backend's schema resynced (`schema/sulfur`, server `b822c90a`) and the operations it serves otherwise adapted in the
seam (`src/sulfur/talc.ts`, docs/sulfur.md § Adapted).

### Added

- New backend: `me email change` and `me email confirm` over the auth service's `/auth/email/change/start` and `/verify`
  (on a fresh sign-in); `me email confirm --former-code <code>` when the former address got a code too.
- New backend: `me delete confirm` reads the deletion asked back (`me.deletion`): there is no e-mailed token, `me delete` on a
  fresh sign-in is the deletion itself (`ACCOUNT_DELETION_NOT_REQUESTED` when none was asked).
- New backend: `discussions remove-message` is `deleteMessage` by a moderator; `--thread-root` names the thread of a reply.
- New backend: `universes pages publish` saves the page as a studio draft, uses it (the next version of the page of its name,
  or a new page) and deletes the draft; the version the file holds is checked first (`PAGE_VERSION_CONFLICT`).
- New backend: `posts feed --clips` reads For You's clip sequence (`clipFeedSequence`); with `--address`, the address's posts
  filtered `CLIPS`.

### Changed

- New backend: the schema resynced at server `b822c90a`: `universes agent-posts`, `discussions channels levels`,
  `discussions place set` / `remove`, `discussions move`, `governance ask`, `answer`, `pin`, `like-question`,
  `unlike-question` are served again; `posts create --announcement` is sent.

## [0.45.0] - 2026-11-26

The server's client-visible changes of the dev audit fixes and the scalability audit of 2026-11-26 (server `3e3a9fba`,
`docs/talc-deviations.md`, column "Client change"), on the new backend.

### Added

- New backend: `messages changes` follows `next` to the end by default (up to `--max` pages, 100 by default; `--after`
  continues from a cursor): `messageChanges` is paged and answers the new messages as well as the changed and deleted ones,
  from a few seconds before `--since` (a message near it may come twice: merge by id). `--json` keeps its shape
  (`items`, `next`).
- The new refusals are told for people, their code, `kind` and `errorInfo` kept in `--json`: `ACCOUNT_IN_OTHER_CELL`,
  `UNIVERSE_IN_OTHER_CELL`, `CROSS_CELL_NOT_SUPPORTED` ("served from another region", `errorInfo.cell`), `FOLLOWING_LIMIT`
  (`errorInfo.max`), `AUDIENCE_QUOTA` (`THROTTLED`: "try again later"), `PROVIDER_NOT_AVAILABLE` (payments closed while the
  payment provider is not wired), `MESSAGE_ID_INVALID` and `CURSOR_INVALID` ("start again from the first page").
- New backend: a message refused `MESSAGE_ID_INVALID` (`messages direct send`, `groups send`, `discussions send`,
  `connections request`, `messages reply-thread`, `messages quick-poll`) is sent again once with a new id dated now (an id made
  before a long media upload or a slow turn, or from a skewed clock); refused again, it is told to check the clock. A message
  stored already is answered whatever the age of its id, so nothing is made twice.
- `explore resolve` works on the new backend (`resolveAddress` is served), and the snapshot of the server's schema
  (`schema/sulfur/server.graphql`) is refreshed to `3e3a9fba` (`UploadInput.address`, `creationTemplates`).

### Changed

- New backend: a post's, reply's or quote's media are uploaded with the posting `address` (no `universe(name)` lookup, no
  wait): the first post of a new universe or sub-level carries its images, its clip or its video. The `UNIVERSE_REQUIRED`
  guard is removed; `scope` stays for the image or the banner of a universe. The universe appears once the media are
  processed, a moment after the post.
- The help of every `--after` says the cursor is opaque (a refused one means starting again).
- docs/sulfur.md: the findings of the media upload, the place feats (seeded on dev) and billing (gated, `PROVIDER_NOT_AVAILABLE`)
  are revised; `npm run e2e:sulfur` covers the first post with images, `explore resolve` and the catch-up.

## [0.44.0] - 2026-11-26

### Added

- Vote requirement in minutes (D-659, revised on 2026-11-26: at the group of friends, an account of 1 day joined 1 day
  ago, in every environment; the other levels unchanged): `VoteRequirement.accountMinutes`, `presenceMinutes` and
  `VoteStatus.accountMinutesDone`, `presenceMinutesDone` requested on both backends (dropped where a backend lacks them,
  null in `--json`; no key removed or renamed). `universes residences` tells, until the resident votes, the requirement
  and where it stands in the largest whole unit (days, else hours, else minutes: "account 0 of 1 day, residence 0 of
  1 day"), nothing for a requirement of 0 (none today), in days on a backend without the minute fields. The talc copy
  (`schema/api-v2/governance.graphql`, its vote requirement types taken from the specs' change) and the sulfur snapshot
  (`schema/sulfur/server.graphql`) carry the fields until the specs and the server publish them.
- The refusals of the vote requirement, `VOTE_ACCOUNT_TOO_RECENT` and `VOTE_JOINED_TOO_RECENTLY`, are told from their
  `errorInfo { days, minutes, at }` ("You can vote here from <at>: an account of 1 day is required"; the recipient of
  `governance lend-votes` named by `accountId`), on both backends; `--json` keeps the code and `errorInfo`. The new
  backend's refusals now keep `extensions.errorInfo` as `errorInfo` in `--json`.
- New backend: adapters for `messages quick-poll` (the discussion by its id), `messages vote` and `unvote` (with
  `--discussion`, as the other message operations) and `look themes delete` (the theme read by its universe and name,
  deleted by its id); `scripts/sulfur-table.ts` counts an operation whose server arguments talc lacks as not available
  without an adapter, and `--check` keeps docs/sulfur.md current (tested).
- New backend: `messages groups create` keeps the group when the server answers it with refused invitations beside it
  (`GROUP_INVITATIONS_REFUSED`, a partial answer), and tells each one.

### Fixed

- The former backend is never asked for the fields only the new one serves (the vote requirement in minutes): the
  document is sent without them, once, and answers them `null`; `doctor` sees no `SCHEMA_DRIFT` and no "backend is
  behind" warning for them.
- New backend: a session of another environment than the one asked is refused (`ENV_MISMATCH`) before any request, and
  `login` keeps the profile as a person's (`kind: human`), so another `--env` with it is refused too.
- New backend: an agent's session keeps its agent id (another agent signs in again); the BREAKROCKS_* variables or an
  agent's key beside a human's profile or session are refused (`PROFILE_HOLDS_HUMAN`); `login` refuses an agent's profile
  (`PROFILE_HOLDS_AGENT_ACCOUNT`) and the agent variables; `--handle` without `--email` is refused before any browser or code.
- `breakrocks --backend sulfur mcp` serves its tools on the new backend; `batch` runs each line on a context of its own
  and with the command of the backend (its stand-in, its refusal).
- New backend: `isFollowing` reads the server's path keys (no `%`) by scope, `null` when the relation cannot tell; a
  follow's `createdAt` is `null` (never this device's time); `false` and `""` are values in the fit of a document (refused
  where the server takes no such argument); a universe's `image` is its `shownImage`, a media id answered where talc answers
  an `Image` becomes the `Image` of that id; `usage` and `me capabilities` say who acts from the session (human, delegated
  agent, operator); a resumed upload in parts keeps its parts on a network error; a delegated agent posts a video without
  `--license` (the server takes none at upload yet); `doctor` signs an agent in with its key when it has no session file;
  an agent's assertion is dated 30 seconds back.
- `npm run e2e:sulfur` checks the results of join, leave, unfollow and delete by reading them back, waits for a post's
  publication before replying, and checks a group, a quick poll and the environment guard.

## [0.43.0] - 2026-11-25

### Added

- New backend: delegated agents and agent operators sign in with their key (RFC 7523 JWT bearer, `src/sulfur/agent.ts`),
  by themselves on every command and again when the token ends; `agents login`, `operator login`; `whoami` says
  `delegated-agent` and the `agentId`.
- New backend: `doctor` (the session, the API's health, the talc operations not served); `messages react`, `unreact`,
  `thread`, `reply-thread` take `--discussion` (and `--thread-root`), the message reads answer `discussion.id`.
- docs/sulfur.md: messaging, search, explore, governance, moderation, themes, billing, agents and the MCP server checked
  against dev; new server findings.

## [0.42.0] - 2026-11-25

### Added

- Experiences: `experiences kinds` (experienceKinds), `experiences publish` (publishExperience); runs: `experiences runs start`
  (a challenge, a tournament or a contest; `--discussion`, `--edition`, `--tournament`, `--contest`), `join`, `leave`,
  `measure` (submitExperienceMeasure), `end`, `show`, `list`, `ranking`, `draw` (drawTournament), `tournament`
  (actOnTournament), `contest` (actOnContest), `entries` (contestEntries); place feats: `experiences feats list`, `at`,
  `start`, `end`, `publish` (publishFeat). On both backends.
- New backend: `my-places save PLACE` adapted (the place's name and point read from its card, deviation 6c-1); events,
  playlists, my places, placed posts and experiences checked against dev (docs/sulfur.md).

## [0.41.0] - 2026-11-25

The CLI's commands on the new backend (native-sulfur), which serves the talc schema (API v2) as its starting point (D-612):
docs/sulfur.md lists each command, served, adapted or not, and the server findings.

### Added

- The seam of the talc requests on the new backend (`src/sulfur/talc.ts`, `src/sulfur/fit.ts`): each document fitted to the
  server's schema (`schema/sulfur/server.graphql`, `npm run update:sulfur-schema`, `npm run gen:sulfur-schema`), adapters for
  the operations the server serves otherwise (`me`, `account`, `updateProfile`, `setFollow`, `isFollowing`, `setBlock`,
  `setMute`), `NOT_ON_NEW_BACKEND` with the operation named for the others.
- Media on the new backend (`src/sulfur/media.ts`, `src/mp4.ts`): images, clips, long videos (in parts of 64 MiB above
  500 MB, resumable), avatars, course documents through `requestUpload`, the SHA-256 declared, a video's duration and
  orientation read from its MP4 header; `BREAKROCKS_MULTIPART_ABOVE`.
- Headless sign-in for automation: `login --email … --code -` (the code on stdin), `BREAKROCKS_EMAIL_CODE`, `--handle` (the
  handle taken once signed in); `BREAKROCKS_CLI_DIR` (an alias of `BREAKROCKS_CONFIG_DIR`), a keychain entry per
  configuration folder.
- `posts create --point <lat>,<lon>` / `--place-id`: the post placed once created (`setPostPlace`), on both backends.
- `usage` and `me capabilities` on the new backend.
- `scripts/sulfur-table.ts` (the table of docs/sulfur.md); the dev journey (`npm run e2e:sulfur`) covers media, replies,
  quotes, reposts, likes, universes, follows and deletion.

- New backend: `login --browser` (the web page `/cli/login`, a loopback redirect `http://127.0.0.1:<port>/cb`, PKCE S256;
  `--no-open`, `--timeout`), `login --device`; `login` alone is the browser when one can be opened (a terminal, no SSH, a
  display on Linux) and the device code otherwise; `BREAKROCKS_BROWSER`, `BREAKROCKS_NO_BROWSER`.
- `BROWSER_LOGIN_DENIED`, `BROWSER_LOGIN_TIMEOUT`, `LOGIN_MODES_CONFLICT`.

### Changed

- On the new backend, `me profile show`, `me profile set`, `posts create` and `posts feed` are the CLI's own commands (their
  options and `--json` outputs those of the former backend) instead of the stand-ins of 0.40.0 (`--name`: `--display-name`).
- The device code refused on the other device (`access_denied`) says so (`DEVICE_CODE_DENIED`, exit 1).

## [0.40.0] - 2026-11-25

The new backend, native-sulfur, behind a backend switch (client port plan Q-5, Q-6; README § The new backend).

### Added

- The backend switch: `--backend legacy|sulfur`, `BREAKROCKS_BACKEND`, `config set backend`; the former backend stays the
  default.
- On the new backend: `login` by a device code (RFC 8628) or by an e-mail code in the terminal (`--email`, `--code`,
  `--sign-up`), as the client `cli`; the tokens in the system keychain, else a 0600 file, never printed; the renewal
  single-flight within the process and across processes (a lock file); `logout` (`--everywhere`), `whoami`, `me profile show`,
  `me profile set --name --bio`, `posts feed`, `posts create "text" --in %universe`. Every other command that reaches the
  platform answers `NOT_ON_NEW_BACKEND`.
- `me profile show` on the former backend too (`me`: handle, display name, bio, links).
- `npm run e2e:sulfur`: the journey on dev (sign-up by e-mail code, profile, post, timeline, sign-out, sign-in again).

## [0.39.0] - 2026-11-22

Specs v158.0.0 (`specs/common` pinned on that tag; D-514, D-515 of v157.0.0, D-516 of v158.0.0). `schema/api-v2` regenerated
(272 reads, 439 writes: no new operation; `Settings.tour`, `TourSettings`, `OnboardingActivity.TOUR_FINISHED`).

### Added

- `me tour`: the state of the app tour of the account (`Settings.tour`): its state, its step while in progress, the tour mode,
  the voice language, "Move on alone after a successful gesture" and the hidden gestures reached.
- `me tour skip`: "Skip the tour" (`setSettings` `tour: { state: SKIPPED }`), with `--dry-run`; `TOUR_STATE_INVALID` from the
  platform when the tour is finished.
- `me tour set --mode READ|LISTEN|BOTH --voice-language <BCP 47> --auto-advance|--no-auto-advance`: the preferences of the app
  tour, at least one, with `--dry-run`. The state, the step and the gestures are written by the apps as the tour is played.
- `NO_APP_TOUR_FOR_AGENT_OPERATOR` (CLI side): the three commands refuse a session of an agent operator without calling the API
  (D-515).

### Changed

- `messages settings set` hides the new `tour` field of `SettingsInput`.

### Notes

- The permanent kind of a universe (`permanent: capital|domain`, `capitalOf`, `domainKey`) is not in API v2 as of v158.0.0
  (contract files only), so the CLI shows nothing of it yet.

## [0.38.0] - 2026-11-22

The themes and the app navigation of D-506 (specs v156.0.0; `specs/common` unchanged, the theme model needs no new
surface).

### Added

- `look themes check`: `THEME_MARK_CONTRAST`, the primary of a variant under 3:1 on the bar of the places of Socle (night,
  dim night, day), where the mark of Experiences takes the primary of the universe shown; a warning with the color the
  apps draw, an error with `--strict`.

### Changed

- `look themes prompt`: the generated prompt names the surfaces of the new navigation (the pages bar and the view
  selector on `page`, the place view chosen and the row of pills on `block`, the counts on `control`, the mark of
  Experiences on the bar of the platform at 3:1).

## [0.37.0] - 2026-11-22

Specs v156.1.0 (`specs/common` pinned on that tag; D-506, D-510, D-512, and what came between v136.3.0 and v156.1.0).
`schema/api-v2` regenerated (272 reads, 439 writes, 17 files); `schema/experiences/creation-templates.json` copied by
`npm run update:schema`.

### Added

- `me navigation` and `me navigation set map|now|my-experiences|last-view`: "The center button opens" (`Settings.navigation`).
- `me privacy share-activity` and `me privacy share-activity set on|off`: "Share my activity with my close ones"
  (`Settings.shareActivityWithCloseOnes`).
- `experiences prefill keys`, `experiences prefill build` and `experiences prefill open`: the pre-filled links
  `/new/<template>/v/…` of the creation templates, offline, creating nothing.
- `links shorten` and `links resolve`: the short links `/go/<code>` (`createShortLink`, `shortLink`), the daily limit
  told with its `retryAt`.

### Changed

- The help of `explore` names Explore as the Map view of Experiences.
- The setting commands hide every other field of `SettingsInput`, read from the contract.

### Removed

- `map channels` (D-469: `mapChannels` deprecated, a placed channel is drawn on no map).

## [0.36.0] - 2026-11-18

Specs v136.3.0 (`specs/common` pinned on that tag; D-423, D-424, the experiences of route/1 and challenge/1; D-433, the
experience opinions; D-412 to D-422 between v129.1.0 and v136.3.0). `schema/api-v2` regenerated (242 reads, 389
writes). New: `schema/experiences/`, the registry of experience engines and the JSON Schema of the experience template
`breakrocks.experience/4` copied from the specs by `npm run update:schema`, with `index.json` (the version, an example
per engine from the test vectors).

### Added

- The group `experiences` (domain `events`): `list` (`--owner`, `--mine`, `--all`), `show` (`--document`), `export`
  (`--out`, `--force`), `check` (`--offline`, `--contract`), `import` (`--owner`, `--name`, `--visibility`, `--update`,
  `--dry-run`, `--request-id`, `--dir`, `--rate`, `--contract`) and `prompt` (`--engine`, `--theme`, `--area`,
  `--language`, `--stages`, `--places-file`, `--owner`, `--out`, `--contract`).
- `experiences export` writes the portable document: the template without `id`, `version` and `copiedFrom`, the keys in the
  order of the JSON Schema, so that export, import and export again give the same bytes.
- `experiences check` checks offline by the JSON Schema and the registry of the specs (the problem codes of
  `checkExperience`, each with its JSON pointer), then by `checkExperience` when signed in; exit 1 on a problem.
- `experiences import` checks, then creates (or updates with `--update`) PRIVATE; `--visibility public` goes through
  `publishExperience` and its experience check, and the command says the experience is being checked. `--dir` imports a
  folder with a table and stops cleanly at the daily limit (20 creations a day per account) with its `retryAt`.
- A delegated agent never makes an experience public: refused before anything is sent (`EXPERIENCE_VISIBILITY_NOT_ALLOWED`,
  source `cli`, exit 1); what it creates prints the Automated mark.
- `experiences prompt` writes a self-contained prompt for an external LLM from the contract the CLI carries (the schema
  narrowed to the engine at run time, the rules, an example of the test vectors, the candidate places of
  `--places-file`); offline, it calls no LLM and sends nothing. `--area` is text in the prompt.
- `EXPERIENCES_NOT_OPEN` has a sentence of its own when the platform sends none; a backend before v136.2.0 answers
  `OPERATION_NOT_SERVED`.
- The JSON Schema checker of the CLI (`src/theme/json-schema.ts`) reads `allOf`, `not`, `uniqueItems`, `propertyNames`,
  `minProperties` and `maxProperties`, and gives JSON pointers on demand.

### Changed

- `npm run update:schema` also copies `contracts/experiences` of a checkout of the specs into `schema/experiences/`.
- The domain `events` lists `events, experiences`.

### Notes

- Specs v135.0.0 and v136.0.0 (D-422) stop refusing a post or a message whose media is not ready, and require the length
  of a video before its upload, for an app of `posts.publishWhenReadyMinAppVersion` (0.135.0) and
  `messages.publishWhenReadyMinAppVersion` (0.136.0) or later; the CLI (0.36.0) is below both and keeps the former
  behaviour (it waits on `IMAGE_NOT_READY` and `CLIP_NOT_READY`), which the contract keeps for it: nothing to change here.

## [0.35.0] - 2026-11-17

Specs v129.1.0 (`specs/common` pinned on that tag; D-411, My places). `schema/api-v2` regenerated: `myPlaces`,
`myPlacesPlaylist`, `myPlacesTags`, `mySavedItem` (228 reads), `saveToMyPlaces`, `updateSavedItem`, `removeSavedItem`,
`clearMyPlaces`, `createMyPlacesTag`, `updateMyPlacesTag`, `deleteMyPlacesTag`, `shareMyPlaces` (362 writes),
`Playlist.mapItems` and the playlist form `MAP`.

### Added

- The group `my-places` (domain `map`): `list` (`--tag`, `--cells`, `--in-common`, `--all`), `show`, `save`, `edit`
  (`--clear-tags`), `remove`, `clear`, `tags`, `tags create`, `tags edit`, `tags delete`, `share`, `shared`, `playlist`.
  My places tags are given by name or id. `--dry-run` on the writes.
- `my-places clear` deletes the whole of My places and needs `--yes` (exit 2 without it; `"yes": true` from the MCP
  server). `my-places share` without `--tag` shares all of My places, which shares what is saved later too: it needs
  `--yes` as well.
- `my-places playlist <address>` reads the saved items of a playlist of the form MAP (`Playlist.mapItems`), with `--in-common`.
- A delegated agent refused (`DELEGATED_AGENT_NOT_ALLOWED`: sharing, deleting the whole, a shared tag) gets a sentence that
  says what it may not do and that its human may; the code and the source are unchanged.
- `MY_PLACES_NOT_OPEN` has a sentence of its own when the platform sends none; a backend before v129.1.0 answers
  `OPERATION_NOT_SERVED` (exit 1, "This backend does not serve My places yet (it came with specs v129.1.0 …)").
- No command for the proximity alert: it is a setting of the device.

## [0.34.0] - 2026-11-17

Specs v128.0.0 (`specs/common` pinned on that tag; D-408 b, the search of Explore keeps its map). `schema/api-v2`
regenerated: `exploreSearch`, `randomHighlight`, `highlightOfTheDay`, `nearbyRoutes` (224 reads), the explore filter
types, `Route.difficulty`, `estimatedSeconds`, `surfaces`, the figures of `MapRouteMarker`.

### Added

- `explore search <words>`: the explore filter, in an area (`--near "<place>"`, `--where %universe[#tag]`, `--cells`)
  or everywhere (`--everywhere`, or no area), with `--when now|tonight|weekend|<n>d`, `--kinds`, `--families`,
  `--order relevance|date` everywhere, `--after`, `--limit` (1 to 60). Prints where the area came from, the counts
  `In the area · N   Everywhere · M` (`500+` at the bound of search), each result with its explore reasons (`why: …`),
  the nearest activity when the area holds nothing. `%paris jazz` sets where and the words. `--near` goes through the
  places search of the platform, then the boundary shape of the place or the map cells around its point: never the
  position of the machine.
- `explore random [<words>]`: the random jump (the whole world without an area; `--except <id>`), with the activity of
  its very lively map cell.
- `explore today [--country FR]`: the highlight of the day of a country, by default the country of the account.
- `routes nearby <route id|url>`: the nearby routes of a route, 5 at most within 5 km, with their figures.
- `src/h3.ts`: the H3 cell of a point and the parent of a cell, without a dependency (ported from H3 v4.1.0, Apache 2.0;
  checked against h3-js on 330,000 points and resolutions).

### Changed

- `explore search` is now the search of Explore (`exploreSearch`). The platform search of the search bar (`search`,
  `explore search` from 0.25.0 to 0.33.0) is `search <words>`, unchanged otherwise.
- `routes show` prints the four figures of a route (difficulty, duration measured or estimated, length, elevation gain)
  and its route surfaces; `map routes` prints the same figures.
- A backend before v128.0.0 answers these commands `OPERATION_NOT_SERVED` (exit 1: "This backend does not serve explore
  search yet"), with no trace.

### MCP tools

- The tool names stay stable: a name an earlier command held is never given to another one. `breakrocks_explore_search`
  is still the platform search, listed as deprecated ("Deprecated: use breakrocks_search."), with the same input;
  `breakrocks_search` is the platform search. The search of Explore of v128.0.0 is the new tool
  `breakrocks_explore_filter` (the same filter as `explore search`); `breakrocks_explore_random`,
  `breakrocks_explore_today` and `breakrocks_routes_nearby` are new tools.
- A command may name its tool (`tool`) and keep former tool names (`formerTools`); `breakrocks schema` gives
  `mcpTool` and `formerMcpTools`.

## [0.33.0] - 2026-11-16

Specs v127.0.0 (`specs/common` pinned on that tag; D-402 a). `schema/api-v2` regenerated: comments only, no schema change.

### Changed

- `look appearance show`: with a universal theme, the pages of the universe show the palette of the theme and the colors
  computed from its name serve only the monogram and the address badges. The line `universe colors: … kept with a
  universal theme (contract)…` becomes `name colors (monogram, address badges): primary … accent … tint day … tint night
  …`; the palettes are labelled `day palette (the pages)` and `night palette (the pages)`; the monogram is drawn `on the
  name's primary` with a universal theme (or on Socle), `on the theme's primary` with another universe theme.
  `--json`: `logo.value.monogram.from` (`name` or `theme`), the monogram of a universal theme on the primary of the name
  (it was the primary of the theme).

## [0.32.0] - 2026-11-16

### Added

- `look appearance show`, `look themes show`: `--signed-links` asks for time-limited links to the images; the API has no
  operation for them yet, so it says so (text: `signed links: not available…`; `--json`: `signedLinks { available: false,
  reason }`).

### Fixed

- `look appearance show`, `look themes show`: the image links open. The API serves an image as the folder of its variants
  (`url` + `widths`), which the media CDN answers 403; the CLI now prints `<url>/<width>.webp`, the 1080 (or the smallest
  wider, else the largest) and the largest, day and night, and the universe image (logo) the same. `--json` keeps `url` and
  adds `links` (`{ variant, width, url, expiresAt }`, `expiresAt` null: public, no expiry) on each image.

## [0.31.0] - 2026-11-16

### Added

- `me measures`: what each measure targets, from `PlatformMeasure.targetKind` (specs v126.1.0): the account, a post, a
  universe search word, the whole list of universe search words (D-397)…; a value not known yet prints `a content`. `--json`
  carries `targetKind`.

### Changed

- `specs/common` on v126.1.0, `schema/api-v2` regenerated.
- `look appearance show`: `applied: on <date> by @x` (`by the platform` for a country theme) and the proposal adopted, read
  from `Universe.appearanceApplied` instead of inferred from the history and the proposals; the official theme of its field
  is told apart, given by default or chosen by the universe ("the official theme of its field, given by default"); a trial
  shows the URLs of `UniverseThemeTrial.imageSlots` instead of the upload ids of its draft; `themeOf` read as the contract
  says (a universe above, else null), the universe itself still tolerated. Against a backend before v126.1.0 these fields
  are said not served and the 0.30.0 inference applies; `--json` adds `source.appliedFrom` (`api` or `inferred`).

## [0.30.0] - 2026-11-16

### Added

- `look appearance show <universe>`, also typed `look appearance <universe>` (the default action of the group, told in its
  help): the appearance applied to a universe, resolved as the apps draw it, each value tagged with its origin (`set`,
  `theme`, `trial`, `country`, `default`, `unknown`): the source (theme applied, appearance built or started from a theme
  in Customize, 24 h trial, country theme, universal or field theme chosen by the platform, Socle), when and by whom when
  the API says it, the accent and the character, the image (URLs, focal point, no image), the image display, the layout,
  the sky, the logo or the monogram, the day and night palettes, the default colors of the universe, the typefaces, the
  contrast level, the proposals pending and the command of the history. `--json`: the resolved object, an `origin` per
  field. MCP tool `breakrocks_look_appearance_show`.

### Changed

- `look themes gallery`: its help says it lists the themes offered in a universe (the gallery), not what is applied, and
  points to `look appearance show`.

## [0.29.0] - 2026-11-16

### Changed

- `look themes gallery` and `look themes list` in text: a header naming the columns (theme, version, field, title
  typeface, image slots filled, screenshots, universes, accounts, the palette of the variant shown), the rows grouped
  under the title of their section instead of the reason on each row, a theme already listed in an earlier section not
  listed again (`also in MOST_USED` on its first row, the section title counts it), and the next page as a command line
  (`more: breakrocks look themes gallery '%lyon' --all  (or --after eyIwIjoiMDAw…; --json holds the full cursor)`)
  instead of the raw cursor. The JSON is unchanged.
- `look themes show` in text: a page with labelled lines (universe, collection, creator, created and updated, contrast,
  typefaces, use), the night and day palettes, each image slot with its URLs or removed (timeColumn and channelHeader
  when the document names them), the screenshot URLs, the page of a universe per breakpoint and the `look themes shots`
  command that downloads them.

### Added

- Palette swatches: a color of a theme drawn on its own background when stdout is coloured and the terminal draws 24-bit
  colours (`COLORTERM=truecolor`, `24bit`, or `FORCE_COLOR=3`); the plain text is unchanged (README § Colour).
- `look themes list --all` (bounded by `--max`, 10 pages by default) follows the pages.
- A command's text renderer receives the input of the command line (`Command.text(result, input)`).

## [0.28.0] - 2026-11-16

### Changed

- The top-level help shows the domains in lower case under a line `Domains (breakrocks <domain>, or breakrocks help
  <domain>):`, so that they no longer read as commands.

### Added

- A domain typed as a command shows its help, in any case (`breakrocks talk`, `breakrocks Account`); a command or a
  group of the same name wins (`agents`, `universes`, `map`, `events`, `governance`, `look`, `explore`: `breakrocks
  help <domain>` shows the domain).
- Colour in the readable outputs, only when the stream is a terminal (`src/colour.ts`, hand-written ANSI, no
  dependency): command names bold, domains magenta, addresses cyan, ids and timestamps dim, `Error CODE:` red with the
  code bold, warnings yellow, confirmations green. Never with `--json`, in a pipe or in the MCP server; off with the new
  global option `--no-color`, `NO_COLOR` or `TERM=dumb`; `FORCE_COLOR` forces it. The text itself is unchanged (README
  § Colour).
- `UNKNOWN_COMMAND` names the domain first when the unknown command starts with one, ignoring case (`Did you mean the
  domain "account"? breakrocks help account.`; `--json`: `domain`).

## [0.27.0] - 2026-11-16

Specs v125.1.0 (`specs/common` pinned on that tag, `schema/api-v2` regenerated).

### Changed

- `me measures` also lists the platform measures against a universe the account leads (D-398: the removal of its
  universe theme, banner or a page) and prints their `universe` (`--json` carries it); such a measure is counted
  against no account, unless written against the author of a page. It prints `snippet` and `subjectWhere` when set,
  such as the search words removed from a universe and the universe (D-397).
- `me measures appeal`: a measure against a universe is appealed by its leadership, once whoever files it; new
  refusals named in its help: `PLATFORM_APPEAL_LEADERSHIP_ONLY` (another member) and `PLATFORM_APPEAL_EXISTS`
  (already appealed, by anyone), each printed with its sentence when the API answers the code alone.

## [0.26.0] - 2026-11-16

Specs v125.0.0 (`specs/common` pinned on that tag, `schema/api-v2` regenerated: 15 SDL files, 220 queries, 354 mutations).

### Added

- `map place-feats --cells …` (`mapPlaceFeats`): the places with a place feat of an area, with `foldedCount`, `foldedVideoCount` and
  `foldedClipCount` (the "+N" of their round, D-393).
- `map place-card <place id>` (`placeCard`): the card of a place, with its section "Also here" (`alsoHere`, D-395).
- `me data confirm <data request id>` (`confirmDataRequest`, D-394): confirm a data copy or a bulk erasure recorded from a contact message;
  a recent sign-in is required (`RECENT_SIGN_IN_REQUIRED`), as for the other writes of My data.

### Changed

- `map posts` prints `foldedPlaceId` (D-393) on a place-folded post.
- `me data requests` prints `confirm by` (`DataRequest.confirmBy`) for a request `AWAITING_CONFIRMATION`, and `NOT_CONFIRMED` in the history (D-394).

## [0.25.0] - 2026-11-15

Online help by domains and a command tree (D-390); proxy support.

### Changed

- Online help and command organization (D-390). `breakrocks help` shows 12 domains in about 25 lines (Account, Agents,
  Universes, Content, Talk, Map, Events, Governance, Look, Explore, Money, Tools), each with its groups, instead of the
  full list of the 588 commands (550 lines and more). `breakrocks help <domain>` lists the commands of a domain, `breakrocks help <group>`
  (or `breakrocks <group>`) those of a group or a subgroup with the subgroups folded, `breakrocks help options` the
  global options, `breakrocks help --all` every command.
- The list descriptions are one line of 60 characters at most, with no API operation name, limit or legal reference;
  the help of a command keeps them: its details, and a line `API: <operation>` (instead of "The query X of the API.").
- 85 groups become 40. The CLI profiles are `config` (`config add|use|list|show|remove`), apart from the account
  profile (`me profile set`). The completion scripts, `breakrocks schema` (its `formerNames`), the MCP tools
  (`breakrocks_<path>`) and the README tables (one per domain) follow the new tree, kept in `src/tree.ts`.
- Every move (former name → new path):
  - `profile add` → `config add`, `profile use` → `config use`, `profile list` → `config list`, `profile show` → `config show`, `profile remove` → `config remove`;
  - `agent login` → `agents login`, `agent attest` → `agents attest`;
  - `session` → `me session`;
  - `capabilities` → `me capabilities`;
  - `feed` → `posts feed`;
  - `render` → `posts render`;
  - `export` → `posts export`;
  - `reposts request` → `posts repost-request`, `reposts requests` → `posts repost-requests`, `reposts accept` → `posts repost-requests accept`, `reposts decline` → `posts repost-requests decline`;
  - `settings video-history-pause` → `videos history pause`, `settings presence` → `discussions presence-choice set`, `settings presence show` → `discussions presence-choice`, `settings history-pause` → `universes history pause`;
  - `post` → `posts create`;
  - `reply` → `posts reply`;
  - `quote` → `posts quote`;
  - `repost` → `posts repost`;
  - `like` → `posts like`;
  - `unlike` → `posts unlike`;
  - `dislike` → `posts dislike`;
  - `undislike` → `posts undislike`;
  - `not-interested` → `posts not-interested`;
  - `follow` → `accounts follow`;
  - `unfollow` → `accounts unfollow`;
  - `block` → `accounts block`;
  - `unblock` → `accounts unblock`;
  - `mute` → `accounts mute`;
  - `unmute` → `accounts unmute`;
  - `report` → `moderation report`;
  - `universes ask-to-join` → `universes private ask-to-join`, `universes create-private` → `universes private create`, `universes invite` → `universes private invite`, `universes conditions show` → `universes private conditions`, `universes conditions set` → `universes private conditions set`, `universes conditions accept` → `universes private conditions accept`, `universes join-requests` → `universes private join-requests`, `universes join-requests accept` → `universes private join-requests accept`, `universes join-requests decline` → `universes private join-requests decline`, `universes join-requests accept-all` → `universes private join-requests accept-all`, `universes join-requests decline-all` → `universes private join-requests decline-all`, `universes invitations` → `universes private invitations`, `universes invitations accept` → `universes private invitations accept`, `universes invitations decline` → `universes private invitations decline`, `universes admins add` → `universes private admins add`, `universes admins remove` → `universes private admins remove`, `universes transfer accept` → `universes private transfer accept`, `universes transfer decline` → `universes private transfer decline`, `universes delete` → `universes private delete`, `universes delete-cancel` → `universes private delete-cancel`, `universes domains` → `universes private domains`, `universes domains check` → `universes private domains check`, `universes team-tier` → `universes private team-tier`, `universes declare` → `universes private declare`, `universes expose` → `universes private expose`, `universes hide` → `universes private hide`, `universes reactivate` → `universes private reactivate`, `universes reputation` → `universes private reputation`, `universes reputation set` → `universes private reputation set`, `universes tiers offer` → `universes private tiers offer`, `universes tiers change` → `universes private tiers change`, `universes tiers withdraw` → `universes private tiers withdraw`, `universes tiers subscribe` → `universes private tiers subscribe`, `universes tiers renewal on` → `universes private tiers renewal on`, `universes tiers renewal off` → `universes private tiers renewal off`, `universes page get` → `universes pages get`, `universes page publish` → `universes pages publish`, `universes page check` → `universes pages check`, `universes page hide` → `universes pages hide`, `universes page show` → `universes pages unhide`, `universes page move` → `universes pages move`, `universes page delete` → `universes pages delete`, `universes page report` → `universes pages report`, `universes appearance-history` → `look appearance history`, `universes appearance-restore` → `look appearance restore`, `universes visit` → `universes history visit`;
  - `resolve` → `explore resolve`;
  - `search` → `explore search`;
  - `clips feed` → `posts clips`, `clips platform` → `posts clips platform`, `clips popular` → `posts clips popular`;
  - `places search` → `map places search`;
  - `presence show` → `map presence`, `presence start` → `map presence start`, `presence update` → `map presence update`, `presence audience` → `map presence audience`, `presence ghost on` → `map presence ghost on`, `presence ghost off` → `map presence ghost off`, `presence stop` → `map presence stop`;
  - `live-share list` → `map live-share list`, `live-share in` → `map live-share in`, `live-share start` → `map live-share start`, `live-share stop` → `map live-share stop`, `live-share positions` → `map live-share positions`, `live-share send` → `map live-share send`;
  - `locatable show` → `map locatable`, `locatable residents` → `map locatable residents`, `locatable on` → `map locatable on`, `locatable off` → `map locatable off`, `locatable move` → `map locatable move`;
  - `meetups answer` → `messages meetups answer`, `meetups change` → `messages meetups change`, `meetups cancel` → `messages meetups cancel`;
  - `nearby token` → `map nearby token`, `nearby request` → `map nearby request`, `nearby requests` → `map nearby requests`, `nearby accept` → `map nearby accept`, `nearby decline` → `map nearby decline`, `nearby leave` → `map nearby leave`, `nearby sightings` → `map nearby sightings`;
  - `time-column` → `universes time-column`;
  - `live` → `universes live`;
  - `notifications` → `me notifications`;
  - `debates list` → `discussions debates list`, `debates show` → `discussions debates show`, `debates open` → `discussions debates open`, `debates propose` → `discussions debates propose`, `debates support` → `discussions debates support`, `debates close` → `discussions debates close`;
  - `sanctions list` → `me sanctions`, `sanctions appeal` → `me sanctions appeal`, `sanctions publish-name` → `me sanctions publish-name`;
  - `channels list` → `discussions channels`, `channels create` → `discussions channels create`, `channels join` → `discussions channels join`, `channels leave` → `discussions channels leave`, `channels send` → `discussions send`, `channels read` → `discussions read`, `channels levels` → `discussions channels levels`;
  - `inbox` → `messages inbox`;
  - `dm` → `messages direct send`, `dm read` → `messages direct read`, `dm delete` → `messages direct delete`, `dm ephemeral` → `messages direct ephemeral`, `dm delete-conversation` → `messages direct delete-conversation`;
  - `groups create` → `messages groups create`, `groups list` → `messages groups`, `groups show` → `messages groups show`, `groups send` → `messages groups send`, `groups read` → `messages groups read`, `groups invite` → `messages groups invite`, `groups leave` → `messages groups leave`, `groups members` → `messages groups members`, `groups admins` → `messages groups admins`, `groups admin-add` → `messages groups admin-add`, `groups admin-remove` → `messages groups admin-remove`, `groups ephemeral` → `messages groups ephemeral`, `groups invitations` → `messages groups invitations`, `groups accept` → `messages groups accept`, `groups decline` → `messages groups decline`, `groups edit` → `messages groups edit`, `groups remove` → `messages groups remove`, `groups meeting-point` → `messages groups meeting-point`, `groups step-down` → `messages groups step-down`, `groups mute` → `messages groups mute`, `groups unmute` → `messages groups unmute`;
  - `messaging settings show` → `messages settings`, `messaging settings set` → `messages settings set`;
  - `themes list` → `look themes list`, `themes show` → `look themes show`, `themes gallery` → `look themes gallery`;
  - `appearance looks` → `look appearance looks`, `appearance palette` → `look appearance palette`, `appearance build` → `look appearance build`, `appearance apply` → `look appearance apply`;
  - `theme prompt` → `look themes prompt`, `theme check` → `look themes check`, `theme pack` → `look themes pack`, `theme unpack` → `look themes unpack`, `theme typefaces` → `look themes typefaces`, `theme publish` → `look themes publish`, `theme apply` → `look themes apply`, `theme personal set` → `look personal set`, `theme personal clear` → `look personal clear`, `theme personal saved` → `look personal saved`, `theme export` → `look themes export`, `theme shots` → `look themes shots`, `theme delete` → `look themes delete`;
  - `layouts list` → `look layouts list`, `layouts show` → `look layouts show`, `layouts check` → `look layouts check`, `layouts publish` → `look layouts publish`, `layouts publish-version` → `look layouts publish-version`, `layouts apply` → `look layouts apply`, `layouts copy` → `look layouts copy`, `layouts delete` → `look layouts delete`;
  - `studio drafts` → `look studio drafts`, `studio show` → `look studio show`, `studio save` → `look studio save`, `studio delete` → `look studio delete`, `studio use` → `look studio use`, `studio make-theme` → `look studio make-theme`, `studio try` → `look studio try`, `studio end-try` → `look studio end-try`, `studio preview` → `look studio preview`, `studio end-preview` → `look studio end-preview`, `studio make-layout` → `look studio make-layout`, `studio make-page` → `look studio make-page`.

### Added

- `breakrocks help <word>` searches the names and the descriptions of the commands; an unknown command suggests the
  closest commands ("did you mean …?", `suggestions` in the JSON refusal).
- Command names of up to 5 words (`universes private tiers renewal on`).
- Proxy support (README § Proxy). Every request (the API, the sign-in and Cognito, the uploads, x402 and the wallet
  RPC, the update check, the real-time WebSocket, the MCP server) goes through one dispatcher of undici made global for
  Node's `fetch`. The proxy comes from the global option `--proxy <url>`, else the CLI profile
  (`breakrocks config set proxy <url>`, `config unset proxy`), else `https_proxy` / `HTTPS_PROXY` and `http_proxy` /
  `HTTP_PROXY`; `NO_PROXY` / `no_proxy` (or `config set no-proxy`) lists the hosts reached directly. http and https
  proxies with credentials in the URL; socks5 through undici's experimental `Socks5ProxyAgent`; SOCKS4 not supported.
- A corporate CA bundle: `--ca-file <file>` or `breakrocks config set ca-file <file>`, added to the authorities of
  Node (`NODE_EXTRA_CA_CERTS` still works alone).
- `breakrocks config set` / `config unset` (proxy, no-proxy, ca-file of a CLI profile); `config show` gives the
  settings in effect (`network`).
- `doctor` checks `proxy`: the proxy in use (redacted), its source, `NO_PROXY`, the CA bundle; its `api` check says it
  went through the proxy, and points at the proxy when it fails.

### Security

- Proxy credentials are never printed: `config show`, `doctor`, errors (text and `--json`) and MCP refusals show
  `http://***:***@host:port/`. In a profile, `config.json` keeps the proxy URL without its credentials; the full URL is
  in `proxies/<profile>.url`, for the user alone (0600 on POSIX), removed with the profile.

### Dependencies

- `undici` 7.30.2 (2026-11-05), asked by the user for the proxy: loaded only when a proxy or a CA bundle is set.

### Deprecated

- The former names of the moved commands stay as hidden aliases until 0.27.0 (two minor versions): the command line
  writes one line on stderr naming the new path (stdout stays clean, `--json` included), `batch` accepts them (a line
  on stderr too), and the MCP server accepts the former tool names (`breakrocks_dm`, `breakrocks_profile_list`…)
  while it lists the new ones only. `breakrocks <former group>` (`breakrocks theme`) shows where its commands went.

## [0.24.0] - 2026-11-15

Specs v124.0.0 (`specs/common` pinned on that tag, `schema/api-v2` regenerated: 15 SDL files, 220 queries, 353 mutations).
The new read `universeEventPostalAddress` (D-364) and `PlaceContent.featInstance` / `featTitle` (D-369) have no command here.

### Changed

- `map posts` prints the id of the author of each placed post (`MapPost.authorId`, D-365).

## [0.23.0] - 2026-11-15

Specs v123.1.0 (`specs/common` pinned on that tag, `schema/api-v2` regenerated: 15 SDL files, 219 queries, 353 mutations).

### Added

- `settings presence show` (`mySettings.presenceVisibility`): the presence choice made everywhere with `settings presence`
  without `--in`; `none` when no choice was made (`null` in `--json`).

## [0.22.0] - 2026-11-15

Specs v123.0.0 (`specs/common` pinned on that tag, `schema/api-v2` regenerated: 15 SDL files, 219 queries, 353 mutations).
The operations of v122.3.0 (D-386) have their commands; v122.4.0 and v123.0.0 change no operation.

### Added

- `videos list --tab for-you|following` (`longVideos(tab)`).
- `videos history [--limit] [--all]` (`videoHistory`), `videos history remove <post id>` and `videos history clear --yes`
  (`removeFromVideoHistory`), `settings video-history-pause on|off` (`videoHistoryPaused`).
- `post --long-video`: above 500 MB (up to 5 GB) the video goes by `startMultipartUpload`: parts read by slices and sent with a
  PUT, 4 tries per part, progress, then `completeMultipartUpload` with the ETags; the requestId and the parts done are kept in
  `uploads/` of the configuration folder so that the same command run again within 24 hours resumes the upload. At 500 MB or
  below, `requestMediaUpload` as before. `--dry-run` tells `upload: multipart|single`.
- `universes show` tells the long videos mode (`hasLongVideos`).

### Changed

- `messaging settings set` leaves out `videoHistoryPaused`, and `settings history-pause` the settings it does not change
  (`camera`, `autoplay`, `map`, `privateAnalysisConsent`).

## [0.21.0] - 2026-11-15

Specs v122.2.0 (`specs/common` pinned on that tag, `schema/api-v2` regenerated: 15 SDL files, 218 queries, 350 mutations).
The operations of v122.0.0 to v122.2.0 have their commands.

### Added

- `events create` and `events change`: `--explore-map shown|kept|by-type` (`exploreMapChoice`; `EVENT_EXPLORE_MAP_NOT_ALLOWED`,
  `EVENT_EXPLORE_MAP_LIMIT`). `events list` shows `onExploreMap`, `exploreMapChoice`, `relayedIn` and `relay`.
- `events catalog [--language]` (`eventCatalog`): the event families and event types, with `onExploreMap`.
- `events relay <event id> --in %universe` (`relayUniverseEvent`), `events relay support <relay id>` (`supportEventRelay`),
  `events relay remove <relay id> --yes` (`removeEventRelay`), `events relays proposals %universe [--all]`
  (`eventRelayProposals`); `EVENT_RELAY_NOT_ALLOWED`, `EVENT_RELAY_EXISTS`, `EVENT_RELAY_PROPOSALS_LIMIT`.
- `settings presence hidden|connections|everyone [--in %universe]` (`setPresenceVisibility`), `discussions present <address
  or id>` (`universeDiscussionPresent`); `capabilities --universe` tells the `presenceVisibility` of the account.
- `proposals show` carries `myHolderBallot` (`CAST`, `NOT_CAST`).

## [0.20.0] - 2026-11-15

Specs v122.1.0 (`specs/common` pinned on that tag, `schema/api-v2` regenerated: 15 SDL files, 217 queries, 347 mutations).
The theme tools follow the format the platform accepts today.

### Added

- `theme check` and `theme publish` take the ZIP archive of a theme as the import of the apps reads it (`theme.json`, else
  its only JSON; its images by their names; `IMPORT_NO_JSON`, `IMPORT_SEVERAL_JSON`).
- `theme check`: the block appearance as the platform keeps it (`appearance` in the report; `THEME_APPEARANCE_IGNORED`
  without an accent, `THEME_IMAGE_SHOWS_READ` when `imageShows` is missing or unknown; the sky `column` or `band`), and
  `IMAGE_SMALL` for an image of the page under 2,160 × 1,620.
- `theme prompt --image-shows none|subtle|through --sky column|band`; the prompt (and the MCP prompt `theme-prompt`, which
  takes `imageShows`, `sky` and `template`) writes the block `appearance`, `pageImageOnPhone` and the list of the 4 images
  (slot, variant, size, content, what lies over them, the scrims and the readability mask). An example in
  `docs/theme-prompt-example.fr.md`.
- `themes list --order QUICK_START|COUNTRY --group LOOK|COUNTRY|OFFICIAL|UNIVERSAL --with-image --without-image`; its text
  tells the reason and the background image. `themes show` answers in text (image slots, widths, screenshots, corrections).
- The approved typefaces Sora, Fraunces and Figtree.

### Changed

- `theme check` accepts `pageImageOnPhone` and tells a key unknown at the top of the document (`THEME_KEY_IGNORED`)
  instead of refusing it; a block appearance kept allows a gradient of any `#RRGGBB`; an `imageShows` the platform does not
  know is no longer refused (read from `ground`, as the platform).
- `theme pack` runs `theme check` first (`THEME_CHECK_FAILED`, `--allow-invalid`) and tells its result; `theme unpack`
  tells the theme document.
- `theme publish` removes `screenshots` too.
- `map routes` reads `mapRouteMarkers` (`mapRoutes` deprecated, D-374): the markers of the routes, no line.

### Fixed

- A long video is 5 GB at most, as the platform (`VIDEO_SIZE_INVALID` before anything is sent; 20 GB before), and a video
  larger than a Node buffer is checked (its type read from its first bytes only).

### Not offered yet

- The 28 operations added to the contract since v101.8.0 but `mapRouteMarkers`.

## [0.19.1] - 2026-11-09

Specs v101.20.0 (`specs/common` pinned on that tag; D-323, `contracts/app-versions.md` § The client headers).

### Added

- The client headers sent to the API: every request of the CLI to the GraphQL API, to the agents host (`/v1/...`, the sign-in included) and the handshake of the real-time connection carries `x-breakrocks-client: CLI`, `x-breakrocks-app-version: <version of the CLI>` and `user-agent: breakrocks/<version>`, from the very first request after the sign-in. The MCP server goes through the same transport. The calls to other hosts (Cognito, the media storage, GitHub, npm) do not carry them.
- Tolerance to a backend behind this CLI (pinned on an older minor version of the specs): a request refused by AppSync because it selects a field the backend does not serve yet (`Validation error of type FieldUndefined`) is sent again once with a degraded selection, without those fields; the command succeeds, the fields are `null` in the answer (`--json` included), and a warning on stderr names them once per run. One retry, no loop; an operation not served is refused as before (README, The API contract).

## [0.19.0] - 2026-11-08

Specs v101.8.0 (`specs/common` pinned on that tag, `schema/api-v2` regenerated). D-309: the videos of delegated agents under a declared media license.

### Added

- `post`, `reply`, `quote` (`--video`, `--long-video`) and `drafts save` take `--license CC0|CC_BY|CC_BY_SA|PUBLIC_DOMAIN|OWN_WORK_ALL_RIGHTS` and `--attribution "<author, source>"`, sent with `requestMediaUpload` (`MediaUploadInput.license`, `attribution`); `--dry-run` shows them.
- `drafts save --video <file>`: the video sent first (under its media license), as the clip of the draft.
- Checked before anything is sent (exit 2): `MEDIA_LICENSE_REQUIRED` (a delegated agent posting a video without a license), `MEDIA_ATTRIBUTION_REQUIRED` (CC BY and CC BY-SA), `MEDIA_ATTRIBUTION_TOO_LONG` (200 visible characters), `MEDIA_LICENSE_NOT_ALLOWED` (no video, or an attribution without a license). The same refusals of the platform, and `VIDEO_QUOTA_EXCEEDED`, are said plainly with their code kept.
- Reading: the line of the media license ("CC BY · Jane Doe", "CC0", "Public domain", "All rights reserved") in `posts show`, `render`, `posts list` and `videos list`; `--json` carries `license` and `attribution` (of the clip and of the long video; `render`: at its top level).
- MCP: `license` (an enum) and `attribution` on `breakrocks_post`, `breakrocks_reply`, `breakrocks_quote`, `breakrocks_drafts_save`; the instructions say a delegated agent declares the media license of every video.

### Changed

- `videos quota`: its help says the video quota of a delegated agent is its own (600, 6,000 and 60,000 minutes over 30 days with X1, X10 and X100), never paid with x402.

## [0.18.1] - 2026-11-08

D-307: the shared library of the design system comes from the public repository break-rocks-design-lib, generated from break-rocks-design.

### Changed

- The submodule `design` (break-rocks-design v4.1.0, private) is replaced by `design-lib` (`https://github.com/break-rocks/break-rocks-design-lib.git`, public, MIT) pinned on v4.2.0; the imports, the build (esbuild), the lint and the types read `design-lib/`. A clone builds and tests without any token.
- CI and the release check out `design-lib` only, without `SUBMODULES_TOKEN`; `specs/common` (private) is read by `npm run update:schema` alone, by hand.
- `layouts check` follows the design system v4.2.0: a layout no longer has to place the live line (`LAYOUT_LIVE_LINE_REQUIRED` is no longer raised); a live line placed before is accepted and ignored.

## [0.18.0] - 2026-11-08

Specs v101.6.0 (`specs/common` pinned on that tag: the glossary only, `schema/api-v2` regenerated). D-303 lot 4c: the operations of API v2 of before v83.1.0 that are not deprecated and had no command are covered (159 operations, 181 commands), each in text and `--json`, with its JSON schemas, its completion and its MCP tool. Every operation of the contract that is not deprecated now has a command, but the 17 below.

### Added

- The account: `me profile set` (`--avatar-file`), `me handle check|change`, `me password` (no option, not an MCP tool), `me email change|confirm`, `me delete [confirm]`, `me data requests|copy|download|erase|erase-cancel|rectify`, `me onboarding [start|skip|record]`, `me invitation-link [renew|read]`, `me interactions`, `me posts`, `me reports`, `me invite-exceptions add|remove`.
- Connections and messages: `connections mine`, `dm delete-conversation`, `groups edit|remove|meeting-point|step-down|mute|unmute`, `messages edit|typing|changes|pinned|pin|unpin|silence|unsilence|quick-poll|quick-poll-pick`.
- Private universes: `universes join-requests [accept|decline|accept-all|decline-all]`, `universes invitations [accept|decline]`, `universes admins add|remove`, `universes transfer accept|decline`, `universes delete|delete-cancel`, `universes private set`, `universes domains [check]`, `universes team-tier|declare|expose|hide|reactivate`, `universes reputation [set]`, `universes search-words`, `universes identity` (image files sent first), `universes tiers offer|change|withdraw|subscribe|renewal on|off`; `universes residences|sub-map|landing|land|listed|unlisted`, `universes favorite list|alerts-on|alerts-off|skip`.
- Governance: `proposals votes|mine|projects|project-status|project-done|refusal-review|change`, `polls support`, `events support|change|delete|attendees`, `governance residents|welcome-wall|welcome|news|pulse|manifesto-versions|sub-governance|move-pinned|unpin-announcement|backup-delegate|votes-accept|votes-refuse|vote-holders|feed-reviews|feed-review-vote|like-question|unlike-question`, `moderation remove-agent-text`, `sanctions list|appeal|publish-name`, `jury accept|decline|reviews|vote|withdraw`.
- The moderation of universe discussions: `discussions mine|limits|moderators [add|remove]|writing-bans|active|extend|summary approve|decline|cap|creation members|managers|archive|unarchive|move|slow-mode|ban|unban|remove-message|delete|agents forbid|allow|mute|unmute`.
- The paid tiers: `subscription show|offer|start|renewal on|off|billing-day offer|set|portal|seller-verify`, `gift-codes offer|list|buy|redeem|refund` (a payment page given as its address).
- Search and reading: `search`, `clips feed|platform|popular`, `interests show|add|fields|forget|tags|not-interested`, `posts thread|reposts|link-preview|reply-policy`, `accounts replies|is-following`, `map avatar`, `theme personal saved`.

### Not offered

- Deferred by the platform: `avatarParts`, `setMapAvatar`, `buyAvatarPart`, `playlistTimeline`, `recordMontageView`, `maskPostMedia`, `answerMaskRequest`, `pointsOfView`. For an app only: `recordAdImpression`, `recordAdClick`, `recordClipPlays`, `setPushDevice`, `createCliSignInCode`, `createNfcToken`, `confirmNfcConnection`, `checkNfcConnection`; `experienceKinds`.

## [0.17.0] - 2026-11-08

Specs v101.5.0 (`specs/common` pinned on that tag, `schema/api-v2` regenerated). D-303 lot 4b: the operations of API v2 added since v83.1.0 that had no command are covered (123 operations, 135 commands), each in text and `--json`, with its JSON schemas, its completion and its MCP tool.

### Added

- Posts: `drafts list|show|save|schedule|publish|delete` (drafts and scheduled posts); `reposts request|requests|accept|decline`; `posts alt`, `posts suggested-alt`, `posts subtitles on|off|correct` (WebVTT, SRT or JSON cues); `posts place`; `post --long-video <file>`.
- Playlists: `playlists hub|followed|show|create|edit|delete|add|remove|move|follow|unfollow|pin|unpin|add-link|add-doc|item-edit|item-remove|check|check-item|reset-progress|checkmarks|tags|track|tracks`, the form ROUTE (`--route-id`, `add --stage`, the stage of each item in `show`). Long videos: `videos list|playback|quota`, `videos chapters propose|set`.
- Routes: `routes list|show|create|edit|delete|copy|plan`, `routes gpx export|import`, `routes privacy-zones [set]`; `map routes|channels|posts|places|presences|groups` (map cells of resolution 6).
- The people on the map: `presence show|start|update|audience|ghost on|ghost off|stop`, `live-share list|in|start|stop|positions|send` (a minor sharer read at the center of its map cell), `locatable show|residents|on|off|move`, `meetups answer|change|cancel`, `nearby token|request|requests|accept|decline|leave|sightings`.
- Appearance: `appearance looks|palette|build|apply` (an image sent with the destination THEME and waited for, `--image-shows`, `--focal`, `--character`, `--propose`). Tags: `universes tags conventions|suggestions|view`.
- Discussions: `messages universes|mentions|ignore-mention|remove-discussion|block-universe|unblock-universe|vote|unvote`, `discussions pin|unpin|place set|place remove`, `channels levels`; `channels read --top`, `channels send --stance`.
- Measures and terms: `me measures`, `me measures appeal`, `me terms`, `me terms accept`. Advertising: `ads campaigns|show|create|update|submit|pause|resume|end|pay|suggest|group|repository|why`, `ads interests [set]`. Discovery: `explore why|muted|mute|unmute|reset`; `resolve`.

### Not offered

- What the platform defers since v101.5.0 (`NOT_IMPLEMENTED`): map avatars, continuous play, passages and montages, masks after posting, placed videos (`pointsOfView`, `videosOnly`, the precision of a place); `recordAdImpression`, `recordAdClick`; `experienceKinds`.

## [0.16.0] - 2026-11-08

Specs v101.3.3 (schema/api-v2 regenerated, `specs/common` and `design` v4.1.0 mounted as submodules). **The `--json` outputs change**: the fields added since v83.1.0 are selected, the deprecated ones no longer.

### Added

- `events create --tags` (1 to 5, required), `--route-id`, `--no-discussion`, `--from-discussion`; `proposals file --tags` (1 to 5 for ACTION and OTHER, at most 5 otherwise), `--from-discussion`, `--appearance`, `--tag-conventions`, `--playlist-action`, `--restore-layout-version`, the channel action PLACE (`--place-point`, `--place-zone`, `--place-name`).
- `report`: the reasons of the contract, the targets `playlist`, `playlist-item`, `route`, `post-place`, `place-message`, `map-presence`, `--details` and `--good-faith` (required with ILLEGAL).
- `debates propose` (`proposeUniverseDiscussion`); `universes appearance-history` and `universes appearance-restore` (`--propose`).
- `layouts check` offline by `design/lib/layout` (`--online`: the API).
- `doctor`: the version of the contract of the CLI and the check `contract` (`CLI_CONTRACT_BEHIND` when the API serves what the CLI does not know).
- The extra usage of a delegated agent beyond its quota paid with x402 (`PAYMENT_REQUIRED`, then `PAYMENT-SIGNATURE`), `wallet set --extra-usage`, `BREAKROCKS_MAX_USD`; `agents tier <agent> --tier X10|X100 --months n`.
- `theme prompt --template` (the fields left as `<…>`).

### Changed

- `theme check` and `theme publish` rest on the design system (JSON Schema and `design/lib/theme`): the four families page, sky, block, control; former surfaces read and deprecated; radii, borders, opacities, text backdrop and accent typeface ignored, never refused; image slots page and pageHeader; the readability mask computed. `theme prompt` and the MCP prompt `theme-prompt` rewritten on the model of specs v99, one title typeface (`--fonts` takes one).
- `channels list|create|join|leave`, `debates list|show|open|support|close` and `governance pin` call the universe discussions; a channel is `%universe&name`.
- `theme personal set`: the accent (`#RRGGBB` or `universe`) and the display settings only; `theme personal clear` removes the accent and the display mode.
- `npm run build` bundles with esbuild in `dist/index.js`; CI checks the submodules out.

### Removed

- `themes star|unstar|starred|try|untry|trials`, `theme try|undo-try|copy`, `layouts retouch|reset-retouches`, `universes theme-follow`; `universes theme-history|theme-restore` (renamed appearance-history|appearance-restore). Withdrawn by the platform since specs v96 (D-289).

## [0.15.1] - 2026-11-01

### Added

- `messages delete <messageId>` (`deleteMessage`): the author deletes their own message in a universe discussion or any channel (`--channel %paris&general`), a group chat (`--group <id>`) or a conversation (`--with @handle`); `--for-me` hides it for yourself only. It needs `--yes` (`"yes": true` as an MCP tool) and offers `--dry-run`. The help says that the same mutation lets a group chat admin or a channel moderator delete the message of another for everyone.

## [0.15.0] - 2026-11-01

Specs v83.1.0 (schema/api-v2 updated; the backend serves it in dev and staging).

### Added

- Discussions (D-245): `discussions list <universe>`, `discussions show <address>` and `discussions unread` (`myUnreadDiscussions`) show `presentCount`, `silence`, `mentionedMe` and `messageTtlSeconds` (a line each in text, the fields in `--json`).
- Messages of a universe discussion (D-245): `messages react <id> <emoji>`, `messages unreact <id> <emoji>`, `messages thread <id>` (`threadMessages`, `--all`) and `messages reply-thread <id> --text` (`replyInThread`).
- Theme gallery (D-244): `themes gallery <universe>` (`--high-contrast`, `--night` or `--day`), `themes star|unstar|starred`, `themes try <universe> --theme [--layout]` (`startGalleryTrial`), `themes untry <universe>`, `themes trials`; `universes theme-history`, `universes theme-restore <universe> <entryId>` and `universes theme-follow`.
- Universe visit history (D-247): `universes history`, `universes history remove <universe>`, `universes history clear` (needs `--yes`), `settings history-pause on|off`, and `universes visit <universe>` (`recordUniverseVisit`), the only command that records a visit: no other command does it implicitly.
- `--dry-run` on these writes (reactions, thread reply, stars, trials, theme restore and follow, history, pause, visit): the operation and its variables are written, nothing is sent or asked.
- Every command above is also an MCP tool; `universes show` tells a frozen theme version and a gallery trial.

### Fixed

- `doctor`: a field missing on the deployed API that the contract marks `@deprecated` (`ChannelActivity.channel`, `LiveLine.debate`, `MessagePage.channel`, whose replacements dev serves) is a `warn` of the `schema` check, listed in `missingDeprecatedFields`; only a missing field that is not deprecated is a `FAIL`. `schema.generated.ts` carries the list of deprecated fields (`deprecated`).

### Changed

- `messaging settings set` no longer offers `--universe-history-paused` (it is `settings history-pause`).

## [0.14.2] - 2026-11-01

### Fixed

- The global option `--agent <name>` before the command (`breakrocks --agent herald whoami`) was ignored and its value taken as the command; it now parses like `--profile` and `--env`.

## [0.14.1] - 2026-11-01

### Fixed

- The single executable stopped at start with `TypeError: Class2 is not a constructor` (0.13.0 and 0.14.0 were never released): since the zod override of 0.12.2, the MCP SDK (loaded at start) and `@x402/*` (loaded on demand) share one zod, and esbuild wrapped it in lazy initialisers that the eager code never ran. `scripts/build-sea.mjs` now gives the x402 side its own bundled copy of zod.

### Changed

- CI builds the single executable on every system and runs `--version`, `doctor --help`, `schema all` and `theme prompt`, close to what the release workflow does.

## [0.14.0] - 2026-11-01

### Added

- Local agents (D-235, specs v81.9.0): `agents create` keeps the delegated agent in `agents/<name>/agent.json` with its private key in the system keychain (macOS `security`, Linux `secret-tool`, Windows Credential Manager through PowerShell), else `agents/<name>/key.pem` (0600); `--out` still writes a file. `agents local`, `agents import`, `agents forget`.
- `--agent <name>` global option and `BREAKROCKS_AGENT`: sign in with the stored key, session cached and renewed before its end; the `BREAKROCKS_OPERATOR_ID`/`AGENT_ID`/`AGENT_KEY` variables still come first.
- `breakrocks mcp --agent <name>`; MCP prompts `whoami`, `agents` and `login`.
- `doctor [--json]` (also an MCP tool): version against the latest published, profile, local agent, session, API reachability, schema drift by introspection.

### Changed

- The configuration folder is `~/.breakrocks` (`BREAKROCKS_HOME`, `BREAKROCKS_CONFIG_DIR` and an explicit `XDG_CONFIG_HOME` first; `%APPDATA%\breakrocks` on Windows); `~/.config/breakrocks` is copied once and kept with a `MIGRATED` note.
- `agents regenerate` replaces the key of the local agent (keychain or file).

## [0.13.0] - 2026-11-01

### Added

- `--source <url>[=title]` (repeatable, 10 at most) on `post`, `reply`, `quote` and `posts edit`: the post sources of specs v81.8.0 (D-230), not counted in the 1,000 characters; `posts edit --no-sources` removes them, neither keeps them.
- `universes agent-posts <universe> --forbidden | --no-forbidden`: agents forbidden for posts (`setUniverseAgentPosts`, D-232); read it with `universes show` (`agentPostsForbidden`).
- Both exposed as MCP tools.

### Changed

- The contract `schema/api-v2` follows specs v81.8.0 (`Post.automated`, `Post.sources`, `Universe.agentPostsForbidden`, D-229).

## [0.12.2] - 2026-10-31

### Security

- `zod` is forced to 4.6.7 under `@x402/core` and `@x402/evm` (npm `overrides`), which pulled 3.25.76 (GHSA-mrhx-c7xc-m3w5, memory exhaustion on oversized constrained collections, fixed in 4.6.6). The top-level `zod` was already 4.6.7.

## [0.12.1] - 2026-10-31

### Fixed

- The release builds the macOS arm64 binary on `macos-15` (the `macos-14` runner was not assigned): 0.12.0 was tagged but never published.

## [0.12.0] - 2026-10-31

**Breaking.** The CLI moves to API v2 of the platform, entirely, with no way back to API v1. The
behaviors do not change; the form of the API does, and so do **the JSON outputs** (`--json`, the MCP
tools) of many commands: scripts that read them must be checked. The names of the commands stay.

### Changed

- **The contract** is the versioned copy of the SDL of API v2, `schema/api-v2/*.graphql` (12 files, one
  per domain). `scripts/gen-schema-lib.mjs` reads it with the `graphql` package (the files in the order of
  their names; the `"""` descriptions and the comments are not fields; the AppSync scalars, which the
  contract does not declare, are declared); `npm run update:schema -- <path>` copies the `.graphql` files
  of `contracts/api-v2/` of a checkout of the specifications (or of a folder) and regenerates
  `src/api/schema.generated.ts`.
- **The endpoint** is the key `graphql` of the cell in the cell map (`https://api.<cell>.<env>.break.rocks/graphql`).
  A cell without it does not serve API v2 yet: `API_V2_UNAVAILABLE` (exit 3); `BREAKROCKS_API_URL` names
  the endpoint meanwhile, and alone it keeps the rest of the cell map.
- **A human signs the requests with its id token** (API v2 answers `SIGN_IN_REQUIRED` to an access
  token); operators and delegated agents keep their agent token.
- **Every write sends a `requestId`**, a UUIDv7 made by the CLI when `--request-id` is absent (a write
  played again with it is done once); the id of a post, a reply, a quote, a repost or a message is
  `<cell>-<requestId>`. The commands that are one operation offer `--request-id`.
- **The operations renamed or merged**, under the same commands: `like`/`unlike` (`setLike`),
  `dislike`/`undislike` (`setDislike`), `not-interested` (`setNotInterested`, its input flattened:
  `--scope`, `--post-id`, `--account`, `--universe`, `--tag`), `follow`/`unfollow` (`setFollow`),
  `block`/`unblock` (`setBlock`), `mute`/`unmute` (`setMute`), `posts pin`/`unpin` (`setPinnedPost`),
  `moderation ban`/`lift-ban` (`setUniverseBan`), `moderation hide-reply`/`unhide-reply`
  (`setReplyHidden`), `moderation dismiss-reports` (`dismissReports`, target `POST`), `moderation
  reports`/`appearance-reports` (`reportedContent`, queues `POSTS` and `APPEARANCE`), `governance
  history` (`governanceMoments`), `governance record` (`governanceRecords`), `governance my-vote`
  (`myStandingIn`, its `vote`), `groups accept`/`decline` (`answerGroupChatInvitation`: the id of the
  group chat), `groups admin-add`/`admin-remove` (`setGroupChatAdmin`), `connections accept`/`decline`
  (`answerConnectionRequest`), `connections list` (`myAccounts` `CONNECTED`), `connections state`
  (`connectionStates`), `messaging settings show|set` (`mySettings`, `setSettings`, its messaging part),
  `theme try`/`undo-try` (`setTriedTheme`), `studio make-theme|make-layout|make-page` (`useStudioDraft`),
  `layouts publish-version` (`publishLayout`, as `layouts publish`), `theme publish` (`publishTheme`
  makes the next version; `--version` kept, changes nothing), `universes list` and `explore area`
  (`exploreUniverses(by)`), `explore --happening` (the time column: `timeColumn`), `accounts show <id>`
  (`account`), `notifications --mark-read` (`markRead`), `agents suspend|reactivate|rename|restrict`
  (`changeDelegatedAgent`; `--any-interaction`, `--any-universe` clear a restriction).
- **The messages are discussions**: `dm`, `groups send` and `channels send` send `sendMessage` to an
  account, a group chat or a channel; `dm read`, `groups read` and `channels read` read `messages`;
  `dm delete` sends `deleteMessage`. A message is a `Message` (`discussion`, `author`, `deletedBy`…), a
  page a `MessagePage`. `channels send` takes a text, images, a clip, a link like `groups send`.
- **`report`** sends `report` with its target (`ReportTargetInput`); new targets `page` (`%u/name`,
  `--block`) and `territory`. `universes page report` and `universes territory report` likewise.
- **The inputs of API v2** are flattened into options: `universes create-private`, `events create`,
  `proposals file` (the fields of its change: `--territory`, `--channel-action`, `--clear`…;
  `--no-territory` is `--clear TERRITORY`), `theme personal set` (`--clear ACCENT` in place of
  `--remove-accent`), `theme apply`, `layouts apply`, `governance territory` (`--clear` in place of
  `--remove`), `messaging settings set` (`--agent-requests answer|accept|decline`…, the values of API v2).
- **The media** go through `requestMediaUpload` with their media destination: a post in its universe
  (`--in`, the universe of the post replied to or quoted), a direct message, a group chat, a channel, a
  theme.
- **The answers** of API v2: a toggle answers its object in its new state (`block` a `ConnectionState`,
  `follow` a `Follow`, `unfollow` `null` once stopped), `universes join` a `UniverseJoined`, an account its
  `avatar` (an `Image`, no `avatarKey`) and, for itself, `own` (`whoami` and `capabilities` keep its
  fields flat, as before); the default selections leave out the navigable fields (`Universe.posts`).
- **The real time**: `--watch` listens to `discussion.message` (and `discussion.messages` in a public
  channel) and ignores the events of API v1 (`dm.message`, `group.message`, `channel.message`); `watch`
  leases the Event API channels (`eventChannels`) of `posts list`, `feed` and, new, `channels read --watch`.

### Added

- `studio use <draft id>`: use any draft of the studio (`useStudioDraft`).
- `channels read --watch`, `--since`, `--limit`, `--all` as the other readings of messages.
- A command whose definition names an argument, a field or a positional its operation does not have
  fails at load time (and in the tests).

### Fixed

- `--watch` hands control back within a second of `--duration`: the WebSocket of the Event API, closed
  by the CLI, was kept open by Node until the server answered the close handshake (70 to 90 s); the
  process now exits after a short grace (`exitWhenDone`).
- `universes show` reads `Universe.conditionsAccepted` again (the backend answers it, in dev, staging and
  production).

### Removed

- `schema/schema.graphql` (API v1) and its line-based parser.

## [0.11.2] - 2026-10-30

### Fixed

- The npm job of `release.yml` stages the package (`npm stage publish`), the only publication the
  trusted publishing of the package allows; a maintainer approves it with two-factor authentication.

## [0.11.1] - 2026-10-30

### Changed

- The schema of the platform is a versioned copy, `schema/schema.graphql`, instead of a submodule:
  `npm run gen:schema` and the freshness test of `test/api.test.ts` read it, and the CI needs no token.
  `npm run update:schema -- <path>` copies a new version from a local checkout of the specifications
  (or a `schema.graphql` file) and regenerates `src/api/schema.generated.ts`.

- The npm job of `release.yml` publishes with npm trusted publishing (OIDC, `id-token: write`) and
  the provenance of the package, with npm 11.21.1: no `NPM_TOKEN` secret any more; the repository
  variable `NPM_PUBLISH=true` still gates it, and the tag must still be the version of `package.json`.

### Removed

- The references to internal documents (decision numbers, versions and files of the specifications,
  other repositories) in the code comments, the README, the CHANGELOG and the workflows.
- The tests that compared the theme computations with a checkout of the backend beside this one.

## [0.11.0] - 2026-10-28

### Added

- The plans of delegated agents paid by card: `operator plan offer` (`operatorPlanOffer`, the prices read from the API), `operator plan
  show` (`myOperatorPlan`), `operator plan start <agents>` (`startOperatorPlan`: says the price and,
  when a period paid with x402 runs, that the plan takes it over at once without refund, then opens
  the Stripe Checkout page in the browser, `--no-open` to write its address only), `operator plan
  change <agents>` (`changeOperatorPlan`: a larger plan at once, paid pro rata; a smaller one at the
  end of the paid period, the delegated agents beyond it deactivated then, the inactive ones first,
  then the oldest; a confirmation, `--yes`), `operator plan stop` and `operator plan resume`
  (`setOperatorPlanRenewal`). Beyond 1,000 delegated agents, any number is sent as is: the platform
  answers (`PLAN_NOT_OFFERED` until it builds the multiples of 1,000).
- `operator register --plan <agents>` (`--interval`, `--currency`, `--return-path`, `--no-open`,
  `--no-wait`): the registration paid by a plan by card (`agent-sign-in.md` § Plan at registration,
  `POST /v1/operators/registrations/{id}/plan`); the CLI opens the payment page, waits for the payment
  by trying to sign in every 5 seconds (`REGISTRATION_NOT_PAID` meanwhile, `PLAN_NOT_PAID` once the
  page has ended), then signs in and reads the plan. Running it again within the hour finishes a
  registration paid meanwhile.
- `operator register` writes a plain-text summary (the account, the paid period, the payment or the plan).

### Changed

- The contract regenerated (`npm run gen:schema`):
  the operator plans, the gift codes, `PaidTier.X10`, search and the other additions of v56 to v61.
  No existing command breaks.
- `operator register --months 12`: a year costs 10 times the monthly price (was 10% off).

## [0.10.1] - 2026-10-27

### Changed

- The contract regenerated (`npm run gen:schema`): it now carries the theme
  trials and previews, `PostTransparency`, `setPersonalTheme(postTransparency)`, `StudioDraft.served`
  and `DELEGATED_AGENTS_DEACTIVATED`; `src/api/ahead.ts` (what the API served ahead of the contract)
  is removed, with its test and its technical debt.
- `theme prompt` (and `--universal`) follows the current specifications of the theme prompts: 7
  images, no `cardTexture` (the prompt tells the AI not to provide a card texture: the cards are
  transparent), the post cards 30 to 60, `quoteCard` 80, the secondary text of the buttons and the
  badge.
- `theme check` does not warn of a theme without `cardTexture` (the default now); a `cardTexture`
  slot stays accepted.

## [0.10.0] - 2026-10-27

### Added

- The transparency of the themes: `theme check` accepts `opacity` (an
  integer from 0 to 100) on each theme surface of each variant, `surfaceOpacity`, `textBackdrop`
  (`block` or `surface`) and the theme surface `block`; it refuses `textScrims` and `scrims`
  (`THEME_SCRIMS_COMPUTED`), an opacity that is not an integer from 0 to 100
  (`THEME_OPACITY_INVALID`), another text backdrop (`THEME_TEXT_BACKDROP_INVALID`), and these keys in
  the format 1. It warns (`THEME_OPACITY_RAISED`) of an opacity below 100 given to `primaryButton`,
  `secondaryButton` or `badge` (raised to 100) and of an opacity raised with a whole-surface backdrop,
  and shows the surface opacity of each theme surface, the text scrims or the opacities raised, as
  the platform computes them (`src/theme/opacity.ts`, a port of the backend's `opacity.ts`, checked
  against it by a test; offline, the images are read as black and white).
- `theme prompt --universal`: the prompt of a universal theme (no field, the palette and the
  typeface of Socle, `%root` by default, its own rules); the MCP prompt `theme-prompt` takes
  `universal`.
- `theme personal set --post-transparency OPAQUE|THEME|MORE|LIQUID`.
- `studio try`, `studio end-try`, `studio preview`, `studio end-preview` (the universe theme
  trials and the draft previews); `universes show` tells the trial under way and one's preview;
  `studio drafts` and `studio show` answer `served`.

### Changed

- `theme prompt` follows the current specifications of the theme prompts: the opacities and their
  guides (the post cards 30 to 60, the quote card 80, the buttons and the badge 100), the text
  backdrop, `focusBar` and `rail`, the secondary text of the buttons and the badge, the 8 images and
  their sizes; `--field` is required unless `--universal`.
- `theme publish` removes `scrims` and `textScrims` (told), keeps the opacities, and tells each color
  and each surface opacity the platform corrected with the value kept (`corrected`); `theme export`
  removes `textScrims` too.
- The contract regenerated (`npm run gen:schema`).
- What the API serves ahead of the published contract (the post transparency, the trials and the
  previews, `StudioDraft.served`) is declared in `src/api/ahead.ts` (TEMPORARY), merged with the
  contract; a test fails once the contract carries it.

### Fixed

- `--version` after a command is the option of that command (`theme publish --version` published
  a new theme instead of a new version); before a command it stays the version of the CLI.

## [0.9.0] - 2026-10-24

### Added

- The universe territory: `universes territory get`,
  `set` (a boundary by the id of its place, its name and kind read from its shape; or a circle,
  `--circle <lat>,<lon> --radius <m> --name <place>`, the radius among the eight), `remove` and
  `report` (`reportUniverseTerritory`: `MISLEADING`, `PLATFORM_RULES`, `ILLEGAL`);
  `proposals file --kind TERRITORY` takes `--boundary`, `--circle`, `--radius`, `--territory-name`
  and `--no-territory` (`fileProposal(territory, removeTerritory)`).
- The map: `places search <text> --bounds` (`places`, the universes that hold each place),
  `explore area --cells <h3,…> | --boundary <id>` (`universesInArea`, 1 to 19 map cells of
  resolution 5; no `--bbox`: the CLI has no H3 library), `map boundary <id> [--geojson]` (the shape
  read from the catalogue of the cartography of the environment, `catalog.json` → `boundaries.url`,
  kept an hour; `BOUNDARY_SHAPE_NOT_FOUND` on a 404; `BREAKROCKS_MAP_URL` replaces the host).
- The pages of a universe: `universes pages`, `universes page get [--document]`,
  `publish --file`, `check --file` (online, `checkLayout` with a document `break-rocks-layout/3` of
  that page: the shared library of the design is not shipped here), `hide`, `show`, `move`,
  `delete`, `report [--block]`, `universes pages export [--out]`, `universes pages import --file`,
  and `studio make-page <draft id>`; the refusals of a publication told plainly, their code kept
  (`PAGE_VERSION_CONFLICT`, `PAGE_NAME_TAKEN`, `PAGES_LIMIT` and `CANVAS_ITEMS_LIMIT` with
  `errorInfo.limit`…).
- The governance page: `governance proposals [--status] [--kind]`, `governance record`
  (`governanceRecord`), `governance duties [--universe]` (`myJuryDuties`), `governance pinned`,
  `governance pin <universe> <channel…> | --none` (`setPinnedChannels`), `governance layout`
  (`appliedLayout(page: GOVERNANCE)`).
- Each new command is an MCP tool, with what an agent needs in its description (when to read the
  territory, how to propose, the limits). No `--watch`: the real-time contract has no event of
  these.

### Changed

- `universes show` tells the universe territory, the pages (without their documents) and
  `proposalsWaitingSupport`.
- The contract regenerated; `governance territory` stays, with the
  arguments as built (`universes territory set` is the plain form).

## [0.8.2] - 2026-10-24

### Changed

- The license is MIT (`LICENSE`, carried by the npm package): the CLI goes public at the
  opening of production to the public.
- The job `npm` of `release.yml` publishes only with the secret `NPM_TOKEN` **and** the repository
  variable `NPM_PUBLISH` set to `true` (absent until the launch: nothing is published).
- README: § Licence. and § npm publication and going public.

## [0.8.1] - 2026-10-24

### Added

- `login --browser` in service: the code of the web app
  (`createCliSignInCode`, one use, 5 minutes, bound to the account and to the challenge) is exchanged
  with its verifier through the `CUSTOM_AUTH` flow of the user pool (`CUSTOM_CHALLENGE` of kind
  `CLI_SIGN_IN_CODE`, `ANSWER = "<code>.<verifier>"`); a refused code answers `NotAuthorizedException`
  (run `login --browser` again), a code without the username of the account `USERNAME_MISSING`. The
  session is the one of a password sign-in.

### Changed

- `--watch` tries the real time for a delegated agent and an agent operator too (`--realtime auto`):
  the Event API takes their Agent JWT ; a refusal is told once and the reading
  goes on.
- `capabilities` of a delegated agent reads its own restrictions (`me.delegatedAgent`).
- The contract regenerated.

## [0.8.0] - 2026-10-24

### Added

- `login`: the one sign-in of a profile. A human signs in with its email address
  and its password, with Cognito's SRP (`USER_SRP_AUTH`, the password never leaves the device;
  `src/srp.ts`, a copy of the back-office CLI's), and the code of its authenticator app when the account
  has one (`--code`, or asked); `--password-stdin` for scripts; the cell of the account from the
  directory (`POST /v1/cell`, as the apps on a new device) or `--cell`, the user pool from the cell
  map (`auth`). The profile becomes `kind: human` (its account id, handle and cell); the session
  (access, id and refresh tokens, 0600, never printed) lasts 7 days from the sign-in, its tokens
  renewed 5 minutes before they end or when the API refuses one; a refresh refused ends it
  (`SESSION_EXPIRED`, exit 3). The refusals keep the name of Cognito's exception
  (`NotAuthorizedException`, `UserNotConfirmedException`, `CodeMismatchException`…) with the reason
  of the contract; a first sign-in that must set a password or an authenticator app is made in the app
  (`FIRST_SIGN_IN_IN_APP`). On a profile of an agent operator or a delegated agent, `login` signs in
  with its key, as `operator login` and `agent login`.
- `login --browser`: the local server on 127.0.0.1, which takes the code of the page by fetch (CORS
  on `/callback` only, for the origin of the web app of the environment, the private network
  preflight) or by a navigation (`GET /callback?…`, answered by a 303 to `/cli/login?outcome=done`
  of the web app: Chromium and WebKit gate a fetch to the loopback behind a permission), the state
  compared in constant time, one code, 5 minutes; the page address with the S256 challenge of a
  verifier; the opening of the browser (`--no-open`). The exchange of the code stays behind
  `CodeExchange` and answers `NOT_AVAILABLE_YET` until the API has the operation (the proposal is in
  the README).
- `logout [--everywhere]`: a human's refresh token revoked (`RevokeToken`) and the session forgotten;
  `--everywhere` ends every session of the account (`signOutEverywhere`); an agent account forgets
  its session (the agents host has no sign-out).
- `update [--check] [--tag]`: the latest release on GitHub, the executable of the system and
  its `.sha256` downloaded and checked, the single executable replaced in place (on Windows the
  running one set aside as `.old`); installed by npm, it says `npm i -g breakrocks@latest`; `GH_TOKEN`
  reads the releases of the private repository.
- The installers in one line: `install.sh` (macOS, Linux: the system and the processor, the
  SHA-256 checked, `~/.local/bin`, never `sudo`, the PATH and the completion told) and `install.ps1`
  (Windows: `%LOCALAPPDATA%\breakrocks\bin`, the PATH of the user), joined to each release and to
  `SHA256SUMS` by `release.yml`, tested against a fake server of the releases.
- The npm publication, prepared: `package.json` public (`private: false`, `repository`,
  `homepage`, `bugs`, `keywords`, `publishConfig`), `npm pack --dry-run` checked by the CI; the job
  `npm` of `release.yml` publishes only when the secret `NPM_TOKEN` exists. `license` stays
  `UNLICENSED` until the user decides.

### Changed

- `whoami` of a human: its account (legal space, minimum age checked), its subscription
  (`mySubscription`) and its residences (`myPresences`); `usage`, `capabilities` (no operator, no
  delegated agent, no x402 wallet) and `session` (`signInAgainBy`) know a human; `--watch` connects in
  real time with the id token of a human, to `/users/<account id>`.
- The MCP server has no tool for `login`, `logout`, `update` nor `profile use` (the server
  acts with the profile it started with), besides `mcp` and `completion`.
- `npm run build` empties `dist/` first; `gen:completions` writes its paths to stderr (a clean
  `npm pack --json`).

## [0.7.0] - 2026-10-23

### Added

- Shell completion: `completion bash|zsh|fish|pwsh` writes the completion script of the shell,
  generated from the registry (groups, commands, subcommands, options and positionals; an
  enumeration completes its values, a file or a folder the paths, a boolean nothing);
  `completion --install` shows the line to add, writing nothing. The release attaches the static
  scripts (`breakrocks.bash`, `.zsh`, `.fish`, `.ps1`, in `SHA256SUMS`) and the npm package carries
  them in `completions/` (`npm run gen:completions`, run by `prepack`).
- `__complete <words…>` (hidden from the help): what to propose for the last word, the dynamic values
  for the scripts: the profiles, the universes and accounts used lately (`history.json` of the
  configuration folder, the last 100 addresses, never a text; `BREAKROCKS_NO_HISTORY=1` keeps none),
  the themes and layouts the profile published (`cache/published-<profile>.json`), the fields. No
  network during a completion.

### Changed

- A command that succeeded leaves the universes and accounts of its options in the history of the
  completion; `profile remove` also removes the cache of the themes the profile published.
- The MCP server is unchanged: `completion` is not a tool.

## [0.6.0] - 2026-10-23

### Added

- Messages: `inbox [--unread] [--watch]`, `dm <account> <text>|--file|-` with images
  or a clip (as a post's; its id a UUIDv7), `dm read [--since] [--all] [--watch]`,
  `dm delete [--for-me]`, `dm ephemeral 24h|7d|off`; `groups create` (the invitations refused told:
  `GROUP_INVITATIONS_REFUSED`), `groups list|show|send|read|invite|leave|members|admins|admin-add|
  admin-remove|ephemeral|invitations|accept|decline`; `connections request|accept|decline|remove|
  list|requests|state`; `messaging settings show|set`.
- Real time for `--watch`: the WebSocket of the AppSync Event API of
  the cell (Node's WebSocket, no dependency), `/users/<id>` or the channels of `watchLive` (its
  lease renewed), a read at each event that matters, reconnection then the reading again of 0.5.0,
  told once. `--realtime auto|on|off`: by default only when the contract lets the account connect
  (not yet delegated agents and operators: they read again).
- The single executables (prepared): `npm run build:sea` (esbuild bundle, Node SEA, postject;
  ad hoc signature on macOS) and `.github/workflows/release.yml` (five targets on a tag `v*`, with
  their SHA-256; by hand without a release). No tag yet.

### Changed

- A GraphQL answer with data and errors is kept where the contract says so (createGroupChat).
- The notice that the real time is not used is written to stderr with `--json` too.

## [0.5.0] - 2026-10-23

### Added

- Reading the platform: `posts list <address>` (any address of navigation; `--since`,
  `--until`, `--kind`, `--language`, `--filter`, `--all`, `--max`), `posts show [--thread] [--reposts]`,
  `feed [--new] [--clips]`, `universes show` (display, field, theme and its images, layout,
  governance, residents, pinned rules), `universes list`, `universes sub`, `universes members`,
  `explore`, `time-column`, `live`, `accounts show|followers|following`, `events|proposals|debates|
  polls|channels list`, `notifications [--unread] [--mark-read]`, `export --out posts.jsonl`, `render`.
- Publishing and interacting: `post`, `reply`, `quote` (text, `--file` or stdin; 4
  images with their `--alt` or a clip, checked as the app checks them, sent with the presigned POST,
  the post sent again while they are processed with the same `--request-id`; `--dry-run`), `repost`,
  `like|unlike|dislike|undislike|not-interested`, `posts edit|delete|pin|unpin`, `follow|unfollow`,
  `block|unblock|mute|unmute`, `report <target>`, the residence, favorites and private universes,
  proposals and votes, debates, polls, events, channels; `moderation …` and `governance …` in groups
  of their own, out of the basic help.
- Themes and layouts online: `themes list|show`, `theme publish` (the import of the studio
  in one gesture: theme check, the images sent and replaced by their upload ids, `publishTheme` or
  `publishThemeVersion`), `theme apply|try|undo-try|personal set|personal clear|export|shots|copy|delete`,
  `layouts list|show|check|publish|publish-version|apply|copy|retouch|reset-retouches|delete`,
  `studio drafts|show|save|delete|make-theme|make-layout`.
- `--watch` on `feed`, `posts list`, `live` and `notifications`: a read every `--interval`
  seconds (15 at least), each new item once, `--jsonl`, `--exec` (no shell), `--duration`; a
  refusal of the usage limits stops it with its code. In MCP, bounded and answered with its items.
- `batch --file actions.jsonl [--continue]`: one action per line, each with its requestId.
- `capabilities --universe %u`: the role of the reader, its residence, why a join is refused.
- The contract compact in `src/api/schema.generated.ts` (`npm run gen:schema`): the commands that are
  one operation take from it their options, their JSON Schemas and the selection of their answer;
  every document a command sends is validated against it in the tests (`graphql`, a dev dependency).

### Changed

- A positional can also be given as its flag (`batch --file actions.jsonl`).
- A session missing is told (`SIGN_IN_REQUIRED`) before any request.
- `theme check`: a banner that is not 3:1 or under 1500 × 500 is a warning (the platform serves and
  accepts others).

## [0.4.0] - 2026-10-23

### Added

- `breakrocks mcp`: an MCP server on stdio (`@modelcontextprotocol/sdk` 1.32.1). Every command of
  the registry is a tool `breakrocks_<group>_<action>` with the input schema of the registry, its
  answer the `--json` of the command (a refusal `{ "error" }` marked `isError`); the resources
  `breakrocks://whoami`, `breakrocks://capabilities` and `breakrocks://profiles`; the prompt
  `theme-prompt`. It uses the current profile (or `--profile` / `--env`), refuses a tool that asks
  a confirmation without `"yes": true`, never reads stdin for a question.
- README § MCP: Claude Code, Codex and `claude_desktop_config.json`, one line each;
  `test/smoke/mcp-stdio.mjs`, the server of the built executable driven by the SDK's client, in CI
  on Linux, macOS and Windows.

## [0.3.0] - 2026-10-23

### Added

- Agent operators (`agent-sign-in.md` § Agent operators): `operator keygen` (Ed25519, or ML-DSA-65
  where `node:crypto` has it; the recovery key ML-DSA-65 by default), `operator register` (the three
  steps with the country and the confirmation of full age, then the payment with x402; a signed
  registration is taken up again within its hour), `operator login`, `operator renew`,
  `operator recover`, `operator recovery-key set`, `operator delete` (confirmation).
- Sessions: kept per profile (0600), renewed 5 minutes before their end with the current
  token (same session); a token refused by the API signs in once more, which tells why; `session`
  (`--renew`).
- Delegated agents: `agents create` (the private key written to `--out` or the configuration folder,
  0600, never printed; `--save-profile`), `list`, `show`, `rename`, `suspend`, `reactivate`, `delete`,
  `restrict` (`--any-interaction`, `--any-universe`), `regenerate`, `activity`; refused before calling
  to a delegated agent.
- `agent login` with a key file or `BREAKROCKS_OPERATOR_ID`, `BREAKROCKS_AGENT_ID`,
  `BREAKROCKS_AGENT_KEY`; `agent attest` checks the domain of the external service and says
  `ATTESTATION_NOT_AVAILABLE` (the platform does not serve attestations yet).
- `whoami`, `usage`, `capabilities` (restrictions, limits left, state of the operator,
  payments).
- x402: `wallet set` (a key file copied 0600, or `--env`), `wallet show`,
  `wallet balance` (USDC on Base Sepolia or Base), `wallet faucet` (links); the 402 of the paid
  commands signed with `@x402/core` and `@x402/evm` 2.28.0 (viem 2.57.7) within `--max-usd` (1 US
  dollar by default) and the cap of the profile per UTC day (5 by default), after a confirmation,
  each payment written in the ledger of the profile.

## [0.2.0] - 2026-10-23

### Added

- The registry of the commands: each one declares its name, summary, description, examples, the
  JSON Schemas of its input (options and positionals) and of its output, and its run; the help,
  `--json` and `breakrocks schema <command>` derive from it.
- Global options: `--json`, `--quiet`, `--fields`, `--profile`, `--env dev|staging|prod` (default
  `prod`), `--yes`; no color ever; exit codes 0, 1 (refused, with the code of the contract or
  of the CLI), 2 (usage), 3 (network or session).
- Profiles: `profile add|use|list|show|remove`, `BREAKROCKS_PROFILE`, the configuration folder
  of the user (`$XDG_CONFIG_HOME/breakrocks`, `~/.config/breakrocks`, `%APPDATA%\breakrocks`), private
  files 0600 on POSIX; the addresses of the API from the cell map, as the apps.
- Transport on `fetch`: GraphQL (the token as is), the agents host (Bearer), a 429 tried again once
  after its Retry-After, a near RATE_LIMITED likewise.
- Offline themes: `theme prompt` (the theme prompt of the platform, in English or French),
  `theme check` (format 2, contrast AA as the platform raises it, at most 8 images of 5 MB, the
  banner 3:1, the wordmark, approved typefaces; a JSON report for hooks), `theme pack` and
  `theme unpack` (the ZIP of the import of the studio, `node:zlib`), `theme typefaces` (the shipped
  list; `--online` compares it with `approvedTypefaces`).

## [0.1.0] - 2026-10-23

### Added

- The repository: the executable `breakrocks` in TypeScript on Node 24, `help` and `version` (text,
  or JSON with `--json`), lint, types, unit tests and build in CI, Dependabot with a 7-day cooldown,
   the CI runs on Linux, macOS and Windows.
