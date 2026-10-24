# Changelog

All notable changes of break-rocks-cli. The format follows [Keep a Changelog](https://keepachangelog.com/);
the contract is the GraphQL schema of the platform (`schema/schema.graphql`). The scope is decided (2026-10-23).

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
- README: § Licence. and § Publication npm et mise en public.

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
