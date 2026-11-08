# break-rocks-cli

The break.rocks command-line client: `breakrocks`. A Node 24 executable written in TypeScript,
built for a terminal **and** for an AI agent: every command answers in text, or in JSON with
`--json`, and all of them are also MCP tools (`breakrocks mcp`); shell completion covers bash, zsh,
fish and PowerShell (`breakrocks completion`). Scope decided on 2026-10-23; this repository covers
today the base commands (v0.8.1), the MCP server and shell completion: reading the
platform, publishing and
interacting, online themes and layouts, messaging and connections, `--watch` in real time or by
re-reading, `batch`, human sign-in (`login`, `logout`), the binaries, the one-line installer,
`update` and the prepared npm publication; `login --browser` is in service since 0.8.1
(the `/cli/login` page of the web app); since 0.9.0, the universe territory, the map
(places, universes of an area, boundary shapes), the pages of a universe and the Governance page;
since 0.10.0, theme transparency (opacities, text backdrops), the prompt
of a universal theme, post transparency, theme trials and previews; since 0.11.0, the
delegated-agent plans paid by card; since 0.12.0, the platform's **API v2**, in full
(§ API v2); since 0.15.0, universe discussions (unread, reactions, threads), the theme gallery
and the universe visit history (§ Discussions, gallery and history).

## Installation

Three ways, the same CLI:

- **npm**: `npx breakrocks …` with nothing to install, or `npm i -g breakrocks` (Node 24). The
  package is ready (`private: false`, `files`, `bin`, `engines`, `repository`; `npm pack --dry-run`
  checked in CI: `bin/`, `dist/`, `completions/`, README, CHANGELOG, about 210 kB); the name
  `breakrocks` was free on npm on 2026-10-24. Publishing is a gesture of the user (§
  npm publication); until then, `npx breakrocks` finds nothing.
- **Standalone executable and one-line installer**, with neither Node nor `sudo`:

  | System | From the GitHub release | From break.rocks (later, served by the static site) |
  |---|---|---|
  | macOS, Linux | `curl -fsSL https://github.com/break-rocks/break-rocks-cli/releases/latest/download/install.sh \| sh` | `curl -fsSL https://break.rocks/cli/install.sh \| sh` |
  | Windows | `irm https://github.com/break-rocks/break-rocks-cli/releases/latest/download/install.ps1 \| iex` | `irm https://break.rocks/cli/install.ps1 \| iex` |

  `install.sh` finds the system (`uname`) and the processor (x64, arm64; a shell under Rosetta
  takes the arm64 executable), downloads `breakrocks-<system>-<arch>` from the release and its `.sha256`
  (curl or wget), checks the checksum (`sha256sum`, `shasum` or `openssl`), installs into
  `~/.local/bin/breakrocks` and says how to add the folder to the PATH and how to install completion;
  it touches no shell file. `install.ps1` does the same in
  `%LOCALAPPDATA%\breakrocks\bin\breakrocks.exe` (Windows x64, which also runs on Windows Arm) and
  adds that folder to the **user's** PATH; compatible with Windows PowerShell 5.1 and PowerShell 7.
  Variables: `BREAKROCKS_VERSION` (a release, `0.8.0`), `BREAKROCKS_INSTALL_DIR` (another
  folder), `BREAKROCKS_DOWNLOAD_URL` (a mirror of the releases), `BREAKROCKS_NO_MODIFY_PATH=1`
  (Windows: the PATH left as it is). Both scripts are attached to each release (and to
  `SHA256SUMS`); `https://break.rocks/cli/…` will serve them once the static site copies them.
  **While the repository is private**, the GitHub addresses answer 404 without authentication:
  `gh release download v0.8.0 --repo break-rocks/break-rocks-cli --pattern 'breakrocks-darwin-arm64*'`,
  then `shasum -a 256 -c breakrocks-darwin-arm64.sha256`.
- **From the repository**:

  ```sh
  npm ci
  npm run build
  node bin/breakrocks.js --help        # or: npm link, then breakrocks --help
  ```

  In development: `npm start -- help`. Checks: `npm run check` (lint, types, tests, build).

**Update**: `breakrocks update` reads the latest release (`api.github.com/repos/break-rocks/
break-rocks-cli/releases/latest`), downloads the system's executable and its `.sha256`, checks
the checksum (nothing is replaced otherwise: `CHECKSUM_MISMATCH`) and replaces the executable in place (a
file written next to it, then renamed over it; on Windows, the running one is first set aside
as `.old`). `--check` only says whether something newer exists; `--tag v0.8.0` installs a given release.
Installed by npm, it says `npm i -g breakrocks@latest`; from the repository, `git pull`. Private repository:
`GH_TOKEN` (or `GITHUB_TOKEN`) reads the releases, the files then going through the assets API.
Checked on 2026-10-24: the macOS arm64 0.8.0 executable replaced itself with the one of release
v0.6.0 (`--tag v0.6.0`, checksum verified, `--version` → 0.6.0).

## Systems

macOS, Linux and Windows (a requirement of the user, 2026-10-23): the CLI runs wherever Node 24
runs, with no native module and no call to a shell; the CI runs it on the three systems at each push
(tests, executable, MCP server on stdio). Paths through `node:path` and `os.homedir()`, private files
in 0600 on POSIX; on Windows, the user's `%APPDATA%` folder is protected by its ACLs by
default (the POSIX mode makes no sense there). ML-DSA-65 depends on the system's `node:crypto` (Node 24.7 and
later): without it, the CLI says so (`ALGORITHM_NOT_SUPPORTED`) and Ed25519 remains available.
**The only exception** to "no system binary": `login --browser` and paying for a plan
(`operator plan start`, `operator register --plan`) open the browser with `open` (macOS),
`xdg-open` (Linux) or `rundll32 url.dll,FileProtocolHandler` (Windows), without a shell; this is optional
(`--no-open`), a failure stops nothing and the address is always written (stderr, and in the answer
of a plan).

## Output and exit codes

- Readable text by default; `--json` gives the answer (the API's fields and names);
  `--quiet` writes only the id created or read; `--fields a,b.c` keeps those fields (of each
  item of a list). Never colour or animation: the output is the same in a
  terminal, a pipe or an agent. Progress and questions go to stderr.
- Codes: **0** done; **1** refusal, by the platform (the contract's code, `errors.md` or
  `agent-sign-in.md`, `source: "platform"`) or by a CLI guard (payment ceiling, an agent that
  wants to manage agents; `source: "cli"`); **2** usage (command, option or value outside the schema,
  missing confirmation); **3** network or session (no answer, session to reopen).
- A refusal in JSON: `{ "error": { "code": "…", "message": "…", "source": "platform", … } }`; programs
  read the code, never the message.
- Confirmations: irreversible actions and payments ask for a confirmation when a
  person can answer; otherwise (script, agent, MCP) they require `--yes`, failing which
  `CONFIRMATION_REQUIRED` (exit 2).

## Profiles and environments

- `--env dev|staging|prod` (default `prod`) chooses the environment of a profile with no account; a profile
  then keeps the environment of its account (`ENV_MISMATCH` otherwise).
- A profile = one environment, one cell, at most one account: a human (`login`), an
  operator or one of its delegated agents (the agents host), and the location of its keys. `--profile <name>`, else
  `BREAKROCKS_PROFILE`, else the current profile (`profile use`), else `default`.
- Configuration folder (D-235, 0.14.0), in order of precedence: `BREAKROCKS_CONFIG_DIR` or `BREAKROCKS_HOME`,
  then `$XDG_CONFIG_HOME/breakrocks` when `XDG_CONFIG_HOME` is set, then the default: `~/.breakrocks` (macOS, Linux),
  `%APPDATA%\breakrocks` (Windows). The old `~/.config/breakrocks` is copied once (a
  new folder renamed, all or nothing), then kept with a `MIGRATED` note. Contents: `agents/<name>/agent.json` (local
  agents), `news/` (the news kit), `config.json` (profiles, key paths,
  never a secret), `sessions/<profile>.json`, `keys/<profile>/` (private keys, wallet
  key), `payments/<profile>.json` (log of signed payments), `cache/` (map of the
  cells, themes and layouts published by the profile), `history.json` (universes and accounts
  recently used, for completion): all in 0600.
- API addresses, like the apps: the cell map
  `https://apps[.<env>].break.rocks/config/cells.json` (kept 5 minutes), then the account's cell
  (the profile's, else the prefix of its id, `eu-…`), else the cell of the country at registration
  (`byCountry`), else the default cell. The GraphQL API is the cell's API v2, its `graphql` key
  (`https://api.<cell>.<env>.break.rocks/graphql`, `https://api.dev.break.rocks/graphql` in
  dev); a cell without `graphql` does not serve API v2 yet: `API_V2_UNAVAILABLE` (code 3), and
  `BREAKROCKS_API_URL` names it in the meantime. `agents` = `https://agents.dev.break.rocks` in dev.

| Variable | Role |
|---|---|
| `BREAKROCKS_PROFILE` | the profile, without `--profile` |
| `BREAKROCKS_CONFIG_DIR` | another configuration folder (tests, CI) |
| `BREAKROCKS_OPERATOR_ID`, `BREAKROCKS_AGENT_ID`, `BREAKROCKS_AGENT_KEY` | a delegated agent without a file: the PEM key itself; take precedence over the profile, never written nor displayed |
| `BREAKROCKS_WALLET_KEY` | the x402 wallet key with `wallet set --env` |
| `BREAKROCKS_API_URL`, `BREAKROCKS_AGENTS_URL` | replace the addresses of the map (API v2; a sandbox: `BREAKROCKS_AGENTS_URL` ends with `/v1`); `BREAKROCKS_API_URL` alone replaces API v2 and keeps the rest of the map |
| `BREAKROCKS_RPC_URL` | the network RPC for `wallet balance` |
| `BREAKROCKS_REALTIME_URL`, `BREAKROCKS_EVENTS_URL` | replace the addresses of the Event API (WebSocket, HTTP) |
| `BREAKROCKS_NO_HISTORY` | `1`: no universe nor account kept for completion |
| `BREAKROCKS_DIRECTORY_URL` | replaces the environment's directory (`https://directory[.<env>].break.rocks`, the cell of an email address) |
| `BREAKROCKS_WEB_URL` | replaces the environment's web app (`login --browser`) |
| `BREAKROCKS_MAP_URL` | replaces the environment's mapping service (`https://map[.<env>].break.rocks`: `catalog.json`, the boundary shapes) |
| `BREAKROCKS_RELEASES_URL`, `GH_TOKEN` / `GITHUB_TOKEN` | `update`: the releases API (a mirror, a test), a token that reads the repository while it is private |

## Commands

Each command has its help (`breakrocks <command> --help`) and its JSON schemas
(`breakrocks schema <command>`, `breakrocks schema all`), derived from a single registry.

The table comes from the registry (`npx tsx scripts/commands-table.ts`); a test checks that every command appears in it.

| Command | Does | Example |
|---|---|---|
| `help` | Show the help of the CLI, of a group or of a command (offline) | `breakrocks help` |
| `version` | Show the version of the CLI (offline) | `breakrocks version` |
| `schema` | Show the JSON Schemas of the input and the output of a command (all of them with "all") (offline) | `breakrocks schema agents create` |
| `completion` | Write the completion script of a shell: bash, zsh, fish or pwsh (offline) | `breakrocks completion zsh` |
| `update` | Update the CLI to its latest release (--check: only tell whether there is one) | `breakrocks update --check` |
| `profile add` | Add a profile: an environment, for one account (offline) | `breakrocks profile add atlas-dev --env dev --use` |
| `profile use` | Make a profile the current one (offline) | `breakrocks profile use atlas-dev` |
| `profile list` | List the profiles (offline) | `breakrocks profile list` |
| `profile show` | Show a profile (the one in use by default) (offline) | `breakrocks profile show` |
| `profile remove` | Remove a profile and its session (its key files are kept) (confirmation: `--yes`) (offline) | `breakrocks profile remove old-dev --yes` |
| `login` | Sign in: a human with its email address and password (or --browser); an operator or a delegated agent with its key | `breakrocks --env dev login` |
| `logout` | Sign out this device (a human's refresh token revoked), or every session of a human (--everywhere) | `breakrocks logout` |
| `operator keygen` | Make the keys of an agent operator: its private key and its recovery key (offline) | `breakrocks operator keygen` |
| `operator register` | Register the agent operator: its keys, the signed challenge, the payment with x402 or a plan paid by card (confirmation: `--yes`) | `breakrocks --profile atlas-dev --env dev operator register --country FR --full-age --months 1 --agents 1 --yes` |
| `operator login` | Sign in the agent operator: a challenge signed with its private key | `breakrocks operator login` |
| `operator renew` | Renew the paid period of the agent operator, paid with x402 (confirmation: `--yes`) | `breakrocks operator renew --months 1 --yes` |
| `operator recover` | Recover the account with the recovery key: a new private key (confirmation: `--yes`) | `breakrocks operator recover --yes` |
| `operator recovery-key set` | Declare a new recovery key, signed with the private key | `breakrocks operator recovery-key set` |
| `operator delete` | Delete the agent operator, its delegated agents and their interactions (irreversible) (confirmation: `--yes`) | `breakrocks operator delete` |
| `operator plan offer` | The plans of delegated agents paid by card and their prices (operatorPlanOffer) | `breakrocks operator plan offer` |
| `operator plan show` | The plan of delegated agents paid by card of the agent operator (myOperatorPlan) | `breakrocks operator plan show` |
| `operator plan start` | Buy a plan of delegated agents by card: the payment opens in the browser (startOperatorPlan) | `breakrocks operator plan start 10` |
| `operator plan change` | Change the number of delegated agents of the plan paid by card (changeOperatorPlan) (confirmation: `--yes`) | `breakrocks operator plan change 100 --yes` |
| `operator plan stop` | Stop the plan paid by card: no renewal, it ends with its paid period, without refund (setOperatorPlanRenewal) | `breakrocks operator plan stop` |
| `operator plan resume` | Renew the plan paid by card again at the end of its paid period (setOperatorPlanRenewal) | `breakrocks operator plan resume` |
| `agents create` | Create a delegated agent and keep it as a local agent; its private key goes to the system keychain, never printed | `breakrocks agents create herald` |
| `agents list` | List the delegated agents of the operator | `breakrocks agents list` |
| `agents show` | Show a delegated agent | `breakrocks agents show herald` |
| `agents rename` | Rename a delegated agent | `breakrocks agents rename herald courier` |
| `agents suspend` | Suspend a delegated agent (its sessions refused within 5 seconds; changeDelegatedAgent) | `breakrocks agents suspend herald` |
| `agents reactivate` | Reactivate a suspended delegated agent (changeDelegatedAgent) | `breakrocks agents reactivate herald` |
| `agents delete` | Delete a delegated agent (irreversible) (confirmation: `--yes`) | `breakrocks agents delete herald --yes` |
| `agents restrict` | Restrict a delegated agent to kinds of interaction and to universes | `breakrocks agents restrict herald --interactions post,reply --universes %paris` |
| `agents regenerate` | Make new credentials for a delegated agent; the former key stops at once (confirmation: `--yes`) | `breakrocks agents regenerate herald --yes` |
| `agents tier` | Buy the paid tier X10 or X100 of a delegated agent, paid with x402 (X1: read its tier) (confirmation: `--yes`) | `breakrocks agents tier herald --tier X10 --months 1 --yes` |
| `agents activity` | The activity of a delegated agent (its interactions of the last 30 days) | `breakrocks agents activity herald` |
| `agents local` | List the local agents of this device: name, ids, environment, where the key is (never the key) (offline) | `breakrocks agents local` |
| `agents import` | Keep a delegated agent of a private key file as a local agent: the key moves to the system keychain (offline) | `breakrocks --env dev agents import herald --operator <operator id> --agent <agent id> --key herald.pem` |
| `agents forget` | Remove a local agent from this device (its key too); the delegated agent stays (confirmation: `--yes`) (offline) | `breakrocks agents forget herald --yes` |
| `agent login` | Sign in a delegated agent: its auth challenge signed with its private key | `breakrocks --profile herald --env dev agent login --operator <operator id> --agent <agent id> --key herald.pem` |
| `agent attest` | Obtain an agent attestation for an external service (not served by the platform yet) | `breakrocks agent attest tools.example.com` |
| `wallet set` | Set the x402 wallet of the profile (a key file, or --env) and its cap per day (offline) | `breakrocks wallet set --key wallet.pem --max-usd-per-day 2` |
| `wallet show` | Show the wallet of the profile: its address, its cap, what it signed today (offline) | `breakrocks wallet show` |
| `wallet balance` | The USDC balance of the wallet on the network of the environment | `breakrocks wallet balance` |
| `wallet faucet` | Where to get test USDC on Base Sepolia (dev and staging; links, no call) (offline) | `breakrocks --env dev wallet faucet` |
| `whoami` | The account signed in (me): handle, kind, paid period; the delegated agent acting; a human's subscription and residences | `breakrocks whoami` |
| `session` | Show the session of the profile and when it ends (--renew: renew it now) | `breakrocks session` |
| `usage` | Usage and the limits left: the minute, the hour, the quota of 24 hours (myUsage) | `breakrocks usage` |
| `capabilities` | What the profile may do now: its restrictions, its limits left, the state of its operator | `breakrocks capabilities --json` |
| `doctor` | Check what keeps the CLI from working: version, profile, agent, session, API, contract behind the API, schema drift | `breakrocks doctor` |
| `me measures` | The platform measures the account received in the last 2 years, each with its statement of reasons and its appeal (myPlatformMeasures) | `breakrocks me measures` |
| `me measures appeal` | Appeal a platform measure, once, free, within 6 months, with a text of 2,000 characters at most (appealPlatformMeasure; DSA art. 20) (confirmation: `--yes`) | `breakrocks me measures appeal <measure id> --text "The post quoted a news article" --yes` |
| `me terms` | The versions of the terms of use and of the platform rules the account accepted, and the latest published (myTermsAcceptance) | `breakrocks me terms` |
| `me terms accept` | Accept the latest published versions of the terms of use and of the platform rules (acceptTerms; the latest read first when not given) (confirmation: `--yes`) | `breakrocks me terms accept --yes` |
| `me profile set` | Change the profile: display name, bio, links, avatar, AI description, organization name (updateProfile; --avatar-file: an image sent first) | `breakrocks me profile set --display-name "Alice" --bio "Cyclist in Paris"` |
| `me handle check` | Whether a handle is free to take (handleAvailability) | `breakrocks me handle check alice` |
| `me handle change` | Change the handle of the account (changeHandle) (confirmation: `--yes`) | `breakrocks me handle change alice2 --yes` |
| `me password` | Change the password (changePassword): asked without echo, or two lines on the standard input | `breakrocks me password` |
| `me email change` | Ask to change the email address: a code is sent to the new one (requestEmailChange) | `breakrocks me email change new@example.com` |
| `me email confirm` | Confirm the change of the email address with the code received (confirmEmailChange) | `breakrocks me email confirm 123456` |
| `me delete` | Ask to delete the account: a confirmation link is sent by email (requestAccountDeletion; --handle: the handle typed again) (confirmation: `--yes`) | `breakrocks me delete alice --yes` |
| `me delete confirm` | Delete the account with the token of the confirmation email (confirmAccountDeletion) (confirmation: `--yes`) | `breakrocks me delete confirm <token> --yes` |
| `me data requests` | The data requests of the account: copies, bulk erasures, rectifications (myDataRequests) | `breakrocks me data requests` |
| `me data copy` | Ask for a copy of the data of the account, prepared apart and announced by email (requestDataCopy) | `breakrocks me data copy --locale fr` |
| `me data download` | The download address of a part of a data copy (dataCopyDownload) | `breakrocks me data download <data request id> 1` |
| `me data erase` | Ask for the bulk erasure of a scope: hidden at once, cancellable 24 hours, then erased for good (requestBulkErasure) (confirmation: `--yes`) | `breakrocks me data erase LIKES_AND_REPOSTS --yes` |
| `me data erase-cancel` | Cancel a bulk erasure within its 24 hours (cancelBulkErasure) | `breakrocks me data erase-cancel <data request id>` |
| `me data rectify` | Ask for the rectification of data of the account, in a text (requestRectification) | `breakrocks me data rectify "My birth year is 1990, not 1909"` |
| `me onboarding` | The onboarding of the account: its status and its steps (onboarding) | `breakrocks me onboarding` |
| `me onboarding start` | Start the onboarding (startOnboarding) | `breakrocks me onboarding start` |
| `me onboarding skip` | Skip the onboarding (skipOnboarding) | `breakrocks me onboarding skip` |
| `me onboarding record` | Record an activity of the onboarding: an address visited, the help opened (recordOnboardingActivity) | `breakrocks me onboarding record ADDRESS_VISITED %paris` |
| `me invitation-link` | The personal invitation link of the account and who joined through it (personalInvitationLink) | `breakrocks me invitation-link` |
| `me invitation-link renew` | Renew the personal invitation link: the old one stops working (renewPersonalInvitationLink) (confirmation: `--yes`) | `breakrocks me invitation-link renew --yes` |
| `me invitation-link read` | What an invitation link of someone shows: whether it works, and who invites (publicInvitationLink) | `breakrocks me invitation-link read <code>` |
| `me interactions` | What the account did, counted: posts, replies, likes, reposts, follows, residences, votes, reports… (myInteractions) | `breakrocks me interactions` |
| `me posts` | The posts the account liked or reposted (myPosts LIKED or REPOSTED) | `breakrocks me posts LIKED` |
| `me reports` | The reports the account sent, and what became of them (myReports) | `breakrocks me reports` |
| `me invite-exceptions add` | Add an account to the exceptions of who may invite the account to a universe (setInviteException; invite policy "except", 1,000 at most) | `breakrocks me invite-exceptions add @alice` |
| `me invite-exceptions remove` | Remove an account from the exceptions of who may invite the account (setInviteException) | `breakrocks me invite-exceptions remove @alice` |
| `subscription show` | The paid tier subscription of the account (mySubscription; none: no subscription) | `breakrocks subscription show` |
| `subscription offer` | The prices of the paid tiers in a currency, and the payment providers (subscriptionOffer) | `breakrocks subscription offer` |
| `subscription start` | Subscribe to a paid tier: the address of the payment page, the subscription starts once the provider confirms (startSubscription) (confirmation: `--yes`) | `breakrocks subscription start X2 --interval MONTH --automatic-renewal --yes` |
| `subscription renewal on` | Turn the automatic renewal back on (setAutomaticRenewal) | `breakrocks subscription renewal on` |
| `subscription renewal off` | Turn the automatic renewal off: the subscription ends at its paid date, without refund (setAutomaticRenewal) | `breakrocks subscription renewal off` |
| `subscription billing-day offer` | What a billing day would cost, changing nothing (billingDayOffer) | `breakrocks subscription billing-day offer 15 --kind PAID_TIER` |
| `subscription billing-day set` | Choose the billing day of a subscription paid by card, once per paid period (setBillingDay) (confirmation: `--yes`) | `breakrocks subscription billing-day set 15 --kind PAID_TIER --yes` |
| `subscription portal` | The billing portal of the payment provider: payment methods and invoices (openBillingPortal) | `breakrocks subscription portal` |
| `subscription seller-verify` | The page of the payment provider that verifies you as a seller, valid 5 minutes (verifySellerIdentity) | `breakrocks subscription seller-verify` |
| `gift-codes offer` | The gift codes offered in a currency: one per paid tier and number of months (giftCodeOffer) | `breakrocks gift-codes offer --currency EUR` |
| `gift-codes list` | The gift codes the account bought (myGiftCodes) | `breakrocks gift-codes list` |
| `gift-codes buy` | Buy a gift code of a paid tier for 1, 3 or 12 months: the address of the payment page; the code is made once paid (buyGiftCode) (confirmation: `--yes`) | `breakrocks gift-codes buy X2 3 --yes` |
| `gift-codes redeem` | Use a gift code: its tier for its months (redeemGiftCode) (confirmation: `--yes`) | `breakrocks gift-codes redeem ABCD-EFGH --yes` |
| `gift-codes refund` | Ask the refund of an unused gift code within 14 days of its purchase (refundGiftCode) (confirmation: `--yes`) | `breakrocks gift-codes refund ABCD-EFGH --yes` |
| `posts list` | The posts of an address: a universe, a sub-universe, a tag, an account (posts) | `breakrocks posts list %france/paris#sport --limit 20` |
| `posts show` | A post; with --thread its thread, --reposts its reposts | `breakrocks posts show 01a166cb-bfff-7237-81a6-fb564222fe97 --thread` |
| `posts edit` | Change the text of one's post and its post sources (within 1 hour) | `breakrocks posts edit <id> "The corrected text"` |
| `posts delete` | Delete one's post (one at a time) (confirmation: `--yes`) | `breakrocks posts delete <id> --yes` |
| `posts pin` | Pin a post in a universe (setPinnedPost) | `breakrocks posts pin <id> --in %paris` |
| `posts unpin` | Unpin a post (setPinnedPost) | `breakrocks posts unpin <id> --in %paris` |
| `feed` | The feed of the account (timeline); --clips its clips, --new what is new since --since | `breakrocks feed` |
| `render` | A post as plain text, its media as links (reading without HTML) | `breakrocks render 01a166cb-bfff-7237-81a6-fb564222fe97` |
| `export` | Export the posts of a universe to a JSON lines file (when the reader may) | `breakrocks export %france --out posts.jsonl` |
| `drafts list` | The post drafts and the scheduled posts of the account (postDrafts; --scheduled: the scheduled posts only, the earliest first) | `breakrocks drafts list` |
| `drafts show` | A post draft or a scheduled post of the account (postDraft) | `breakrocks drafts show <draft id>` |
| `drafts save` | Save a post draft: a new one, or the whole content of one (--draft-id) (savePostDraft) | `breakrocks drafts save "Match tonight #football" --in %test-village-sport` |
| `drafts schedule` | Schedule a post draft: published at --at, 5 minutes to 30 days from now (--cancel: back to a draft) (schedulePostDraft) | `breakrocks drafts schedule <draft id> --at 2026-11-10T08:00:00Z` |
| `drafts publish` | Publish a post draft now, as a post (publishPostDraft): the draft is deleted once posted | `breakrocks drafts publish <draft id>` |
| `drafts delete` | Delete a post draft or a scheduled post, with the media it alone holds (deletePostDraft) (confirmation: `--yes`) | `breakrocks drafts delete <draft id> --yes` |
| `reposts request` | Ask to repost a post of a private universe one is a member of into another universe (requestRepost; --text: as a quote) | `breakrocks reposts request <post id> --to %paris` |
| `reposts requests` | The requests to repost a post of a private universe into a universe, waiting for its moderation (repostRequests) | `breakrocks reposts requests %paris` |
| `reposts accept` | Accept a request to repost a post of a private universe into a universe one moderates (answerRepostRequest): the post is reposted | `breakrocks reposts accept <request id> --in %paris` |
| `reposts decline` | Decline a request to repost a post of a private universe into a universe one moderates (answerRepostRequest) | `breakrocks reposts decline <request id> --in %paris` |
| `playlists hub` | The playlists of the account: its own, those it follows, and "Watch later" (playlistsHub) | `breakrocks playlists hub` |
| `playlists followed` | The playlists the account follows, the most recently changed first (followedPlaylists) | `breakrocks playlists followed` |
| `playlists show` | A playlist and its items (50 at most), as the account reads it: its form, its route and the stage of each item, the progress (playlist) | `breakrocks playlists show @erin>journey` |
| `playlists create` | Create a playlist: an account playlist, a series, or a universe playlist; its form, a route for the form ROUTE (createPlaylist) | `breakrocks playlists create journey --kind ACCOUNT --visibility PUBLIC` |
| `playlists edit` | Change a playlist: its name, description, form, route, visibility, sections or course (updatePlaylist; a field not given stays) | `breakrocks playlists edit @erin>journey --visibility UNLISTED` |
| `playlists delete` | Delete a playlist (never "Watch later"); its videos stay (deletePlaylist) (confirmation: `--yes`) | `breakrocks playlists delete @erin>journey --yes` |
| `playlists add` | Add a post with a video (a post without one to a course) to a playlist, at a position, in a section, tied to a stage of its route (addToPlaylist) | `breakrocks playlists add @erin>journey <post id>` |
| `playlists remove` | Remove a video from a playlist (removeFromPlaylist) | `breakrocks playlists remove @erin>journey <post id>` |
| `playlists move` | Move a video of a playlist to a position (from 1) and, in a course, a section (movePlaylistItem) | `breakrocks playlists move @erin>journey <post id> 1` |
| `playlists follow` | Follow a playlist (setPlaylistFollow) | `breakrocks playlists follow @erin>journey` |
| `playlists unfollow` | Stop following a playlist (setPlaylistFollow) | `breakrocks playlists unfollow @erin>journey` |
| `playlists pin` | Pin a universe playlist on the page of its universe, by its leadership (pinPlaylist; 3 at most) | `breakrocks playlists pin %paris>walks` |
| `playlists unpin` | Unpin a universe playlist on the page of its universe, by its leadership (pinPlaylist) | `breakrocks playlists unpin %paris>walks` |
| `playlists add-link` | Add a course link to a course (form CHAPTERS): its title and its https destination, reviewed as the destination of an ad (addLinkToPlaylist) | `breakrocks playlists add-link @erin>course --title "The reference" --url https://example.org/ref` |
| `playlists add-doc` | Add a course document to a course (or a new version of one, --item-id): a PDF of 20 MB or a markdown text of 200 KB, sent then checked (requestDocumentUpload, addDocumentToPlaylist) | `breakrocks playlists add-doc @erin>course notes.pdf --title "The notes" --rights-confirmed` |
| `playlists item-edit` | Change a course link or a course document: its title, the URL of a link, its place, its tags (updatePlaylistCourseItem) | `breakrocks playlists item-edit @erin>course <item id> --title "The reference, 2nd edition"` |
| `playlists item-remove` | Remove a course link or a course document from a course (its file deleted) (removePlaylistCourseItem) (confirmation: `--yes`) | `breakrocks playlists item-remove @erin>course <item id> --yes` |
| `playlists check` | Check a post of a course for oneself, once opened from it (checkPlaylistItem; a video is checked by videos playback) | `breakrocks playlists check @erin>course <post id>` |
| `playlists check-item` | Check a course link or a course document for oneself, once opened (checkPlaylistCourseItem) | `breakrocks playlists check-item @erin>course <item id>` |
| `playlists reset-progress` | Clear every checkmark of one's own in a playlist, every track together; the resume point stays (resetPlaylistProgress) (confirmation: `--yes`) | `breakrocks playlists reset-progress @erin>course --yes` |
| `playlists checkmarks` | Show (--shown) or hide (--no-shown) the checkmarks of a SIMPLE playlist for oneself (setPlaylistCheckmarks) | `breakrocks playlists checkmarks @erin>journey --no-shown` |
| `playlists tags` | Set the playlist tags of an item, all at once (none: --tags ""; 8 per playlist) (setPlaylistItemTags) | `breakrocks playlists tags @erin>course <post id> basics video` |
| `playlists track` | Pick one's playlist track (none: back to the track by default) (setPlaylistTrack) | `breakrocks playlists track @erin>course quick` |
| `playlists tracks` | Set the playlist tracks of a playlist, all at once, in order (10 at most; [] none) (setPlaylistTracks) | `breakrocks playlists tracks @erin>course --tracks '[{"name":"quick","title":"The quick way","tags":["basics"]}]'` |
| `videos list` | The long videos of an address (a universe, an account, a tag), or of what the account follows; --query searches their posts (longVideos) | `breakrocks videos list %paris` |
| `videos chapters propose` | The chapters the platform proposes from the subtitles of one's long video, shown to nobody until set (proposedChapters) | `breakrocks videos chapters propose <post id>` |
| `videos chapters set` | Set the chapters of one's long video, all at once ("" removes them) (setChapters) | `breakrocks videos chapters set <post id> --chapters "0=Intro;1:30=The match"` |
| `videos playback` | Record where one is in a long video (the second; --watched once at 90 %), from a playlist or not (recordPlayback) | `breakrocks videos playback <post id> 120` |
| `videos quota` | The video quota of the account: its minutes, those left, when minutes come back (myVideoQuota) | `breakrocks videos quota` |
| `posts alt` | Write the alternative text of an image of one's post in place of its automatic one, once per image (setImageAlt) | `breakrocks posts alt <post id> <image id> "The stadium at night"` |
| `posts suggested-alt` | The alternative text a platform AI agent suggests for an image uploaded for a post (suggestedAlt) | `breakrocks posts suggested-alt <upload id> --language en` |
| `posts subtitles on` | Turn the automatic subtitles of the clip of one's post back on (setAutomaticSubtitles) | `breakrocks posts subtitles on <post id>` |
| `posts subtitles off` | Turn the automatic subtitles of the clip of one's post off (setAutomaticSubtitles) | `breakrocks posts subtitles off <post id>` |
| `posts subtitles correct` | Correct the subtitles of the clip of one's post: every cue, in order, from a WebVTT or SRT file (correctSubtitles) | `breakrocks posts subtitles correct <post id> --file @clip.vtt` |
| `post` | Publish a post: text, images (4), a clip or a long video, a link, in an address (createPost) | `breakrocks post "Match tonight #football" --in %test-village-sport` |
| `reply` | Reply to a post (replyTo), with images or a clip | `breakrocks reply 01a166cb-bfff-7237-81a6-fb564222fe97 "Bien vu !"` |
| `quote` | Quote a post with a text of one's own (quote) | `breakrocks quote <id> "À lire" --in %paris` |
| `repost` | Repost a post (--universe: in another universe) | `breakrocks repost <id>` |
| `like` | Like a post (setLike) | `breakrocks like <id>` |
| `unlike` | Take back a like (setLike) | `breakrocks unlike <id>` |
| `dislike` | Dislike a post (setDislike) | `breakrocks dislike <id>` |
| `undislike` | Take back a dislike (setDislike) | `breakrocks undislike <id>` |
| `not-interested` | Not interested in a post, its author, a tag or its universe (setNotInterested) | `breakrocks not-interested <id> --scope AUTHOR` |
| `follow` | Follow an address: an account, a universe, a tag (setFollow) | `breakrocks follow @alice` |
| `unfollow` | Stop following an address (setFollow; null once stopped) | `breakrocks unfollow @alice` |
| `block` | Block an account (setBlock) | `breakrocks block @alice` |
| `unblock` | Unblock an account (setBlock) | `breakrocks unblock @alice` |
| `mute` | Mute an account (setMute) | `breakrocks mute @alice` |
| `unmute` | Unmute an account (setMute) | `breakrocks unmute @alice` |
| `report` | Report a post, a message, a group, a theme, a layout, a banner, a page, a territory, a playlist, a route, a place or a map presence (report) | `breakrocks report post <id> --reason SPAM_OR_FLOOD` |
| `universes show` | The page of a universe: display, field, theme and its origin, theme trial, layout, governance, residents, pinned rules, territory, pages, proposals waiting for support | `breakrocks universes show %test-village-multisport` |
| `universes list` | Explore the universes: by field, by language, recent, active, new, close to a level, mine | `breakrocks universes list --field SPORT` |
| `universes sub` | The sub-universes of a universe (--map: their map) | `breakrocks universes sub %france` |
| `universes members` | The members of a universe | `breakrocks universes members %club --all` |
| `universes agent-posts` | Forbid or allow the delegated agents to post in a universe and its sub-universes (setUniverseAgentPosts) | `breakrocks universes agent-posts %paris --forbidden` |
| `universes join` | Become a resident of a universe (joinUniverse) | `breakrocks universes join %paris` |
| `universes leave` | Stop being a resident (the residence time is lost) (confirmation: `--yes`) | `breakrocks universes leave %paris --yes` |
| `universes ask-to-join` | Ask to join a private universe | `breakrocks universes ask-to-join %club --conditions-version 2` |
| `universes favorite add` | Add a favorite universe | `breakrocks universes favorite add %paris` |
| `universes favorite remove` | Remove a favorite universe | `breakrocks universes favorite remove %paris` |
| `universes favorite move` | Move a favorite universe (before another, or last) | `breakrocks universes favorite move %paris --before %lyon` |
| `universes favorite list` | The favorite universes, in their order, with their alerts (favoriteUniverses) | `breakrocks universes favorite list` |
| `universes favorite alerts-on` | Turn the alerts of a favorite universe on (setUniverseAlerts) | `breakrocks universes favorite alerts-on %paris` |
| `universes favorite alerts-off` | Turn the alerts of a favorite universe off (setUniverseAlerts) | `breakrocks universes favorite alerts-off %paris` |
| `universes favorite skip` | No longer offer the pick of favorite universes, on any device (skipFavoriteUniverses) | `breakrocks universes favorite skip` |
| `universes create-private` | Create a private universe (hosted name or own domain) | `breakrocks universes create-private --hosted-name club-echecs --join-mode REQUEST --legal-space fra --member-tier 1` |
| `universes invite` | Invite an account (or an email) to a private universe | `breakrocks universes invite %club --account @alice` |
| `universes conditions show` | The conditions of a universe (a version) | `breakrocks universes conditions show %club` |
| `universes conditions set` | Set the conditions of a private universe | `breakrocks universes conditions set %club "Respect and good humour"` |
| `universes conditions accept` | Accept the conditions of a universe | `breakrocks universes conditions accept %club --conditions-version 2` |
| `universes join-requests` | The join requests waiting in a private universe joined by request, the oldest first (joinRequests; its owner and admins) | `breakrocks universes join-requests %club.` |
| `universes join-requests accept` | Accept the join request of an account (answerJoinRequest) | `breakrocks universes join-requests accept %club. @alice` |
| `universes join-requests decline` | Decline the join request of an account (answerJoinRequest) | `breakrocks universes join-requests decline %club. @alice` |
| `universes join-requests accept-all` | Accept every waiting join request, up to the member tier (answerAllJoinRequests) | `breakrocks universes join-requests accept-all %club.` |
| `universes join-requests decline-all` | Decline every waiting join request (answerAllJoinRequests) (confirmation: `--yes`) | `breakrocks universes join-requests decline-all %club. --yes` |
| `universes invitations` | The invitations to private universes received, the most recent first (universeInvitations) | `breakrocks universes invitations` |
| `universes invitations accept` | Accept an invitation to a private universe: join it, with the version of its conditions accepted (answerUniverseInvitation) | `breakrocks universes invitations accept %club. --conditions-version 2` |
| `universes invitations decline` | Decline an invitation to a private universe (answerUniverseInvitation) | `breakrocks universes invitations decline %club.` |
| `universes admins add` | Name a member admin of a private universe (setUniverseAdmin; its owner) | `breakrocks universes admins add %club. @alice` |
| `universes admins remove` | Remove the admin role of a member (setUniverseAdmin) | `breakrocks universes admins remove %club. @alice` |
| `universes transfer accept` | Accept the transfer of a private universe: become its owner (answerUniverseTransfer) (confirmation: `--yes`) | `breakrocks universes transfer accept %club. --yes` |
| `universes transfer decline` | Decline the transfer of a private universe (answerUniverseTransfer) | `breakrocks universes transfer decline %club.` |
| `universes delete` | Delete a private universe: hidden at once, deleted for good 30 days later unless cancelled (deletePrivateUniverse; its owner) (confirmation: `--yes`) | `breakrocks universes delete %club. --yes` |
| `universes delete-cancel` | Cancel the deletion of a private universe before it is deleted for good (cancelUniverseDeletion) | `breakrocks universes delete-cancel %club.` |
| `universes private set` | Change the settings of a private universe: display case, join mode, automatic alternative texts and subtitles (changePrivateUniverse; its owner) | `breakrocks universes private set %club. --join-mode REQUEST` |
| `universes domains` | The own domains waiting for their DNS proof: the TXT record to publish (pendingDomains) | `breakrocks universes domains` |
| `universes domains check` | Look for the DNS TXT record of an own domain: found, the private universe is created (checkDnsProof) | `breakrocks universes domains check example.com` |
| `universes team-tier` | After a declaration found false: choose the free member tier of a team, 10 members (chooseTeamMemberTier; its owner) (confirmation: `--yes`) | `breakrocks universes team-tier %club. --yes` |
| `universes declare` | Declare an association (its registration number) or an open-source project (its public repository): the member tier goes to 1,000, free (declareUniverse) | `breakrocks universes declare %club. OPEN_SOURCE https://github.com/example/club` |
| `universes expose` | Expose a sub-universe of a private universe and everything below it: read, reply or participate (exposeUniverse) | `breakrocks universes expose %club./news --access REPLY` |
| `universes hide` | Hide the exposed parts of a private universe again (hideUniverse) | `breakrocks universes hide %club./news` |
| `universes reactivate` | Reactivate an archived universe: its 12 months start again (reactivateUniverse; its owner) | `breakrocks universes reactivate %club.` |
| `universes reputation` | The reputation of a private universe, for its members (privateUniverseReputation) | `breakrocks universes reputation %club.` |
| `universes reputation set` | Turn the reputation of a private universe on (from the next midnight UTC) or off (at once), and set its folding coefficient (setUniverseReputation; its owner) | `breakrocks universes reputation set %club. --turned-on --folding-coefficient 1.5` |
| `universes search-words` | Set the universe search words of a universe: the whole list, 10 at most ([] or none: cleared) (setUniverseSearchWords) | `breakrocks universes search-words %paris velo bike cycling` |
| `universes identity` | Set the banner, its night variant, the logo and the watermark of a universe (setUniverseIdentity; --clear: remove parts) | `breakrocks universes identity %club. --banner-file ./banner.jpg` |
| `universes tiers offer` | Offer a subscription tier in a private universe joined by subscription, 3 at most (offerSubscriptionTier; its owner) | `breakrocks universes tiers offer %club. --name Supporter --currency EUR --monthly-amount 300 --perks TIER_BADGE,RESERVED_POSTS` |
| `universes tiers change` | Change a subscription tier: a rise applies 30 days later, a decrease at once (changeSubscriptionTier) | `breakrocks universes tiers change %club. <tier id> --name Supporter --currency EUR --monthly-amount 400 --perks TIER_BADGE` |
| `universes tiers withdraw` | Withdraw a subscription tier: its paying members keep it until the end of their paid period (withdrawSubscriptionTier) (confirmation: `--yes`) | `breakrocks universes tiers withdraw %club. <tier id> --yes` |
| `universes tiers subscribe` | Subscribe to a tier of a private universe: the address of the payment page, the membership starts once paid (startTierSubscription) | `breakrocks universes tiers subscribe %club. <tier id> --interval MONTH --automatic-renewal --no-immediate-access-consent --conditions-version 1` |
| `universes tiers renewal on` | Turn the renewal of a tier subscription back on (setTierSubscriptionRenewal) | `breakrocks universes tiers renewal on %club.` |
| `universes tiers renewal off` | Turn the renewal of a tier subscription off: it ends at its paid date, without refund (setTierSubscriptionRenewal) | `breakrocks universes tiers renewal off %club.` |
| `universes residences` | The residences of the account in public universes, the most recent first (myPresences) | `breakrocks universes residences` |
| `universes sub-map` | The sub-universe map of a universe (subUniverseMap; null when not offered) | `breakrocks universes sub-map %paris --json` |
| `universes landing` | The landing page of a universe as shown without an account: its name, its theme, its governance level, never its content (universeLanding) | `breakrocks universes landing %paris --json` |
| `universes land` | Mark a landing in a universe, as the apps do: whether it landed before; recorded in the visit history unless paused (markLanding) | `breakrocks universes land %paris` |
| `universes listed` | Be listed on the members page of a public universe (setListedOnMembersPage; by default) | `breakrocks universes listed %paris` |
| `universes unlisted` | Not be listed on the members page of a public universe (setListedOnMembersPage) | `breakrocks universes unlisted %paris` |
| `universes territory get` | The universe territory of a universe: a boundary or a circle (Universe.territory) | `breakrocks universes territory get %paris` |
| `universes territory set` | Set the universe territory of a universe: a boundary, or a circle around a place (setUniverseTerritory) | `breakrocks universes territory set %paris --boundary R7444` |
| `universes territory remove` | Remove the universe territory of a universe (setUniverseTerritory clear; the leadership) | `breakrocks universes territory remove %paris` |
| `universes territory report` | Report the universe territory of a universe to the platform team (report UNIVERSE_TERRITORY) | `breakrocks universes territory report %paris --reason MISLEADING` |
| `universes pages` | The pages of a universe, in the order of its main menu (Universe.pages, pagesVersion) | `breakrocks universes pages %paris` |
| `universes page get` | A page of a universe; --document its document as served (pageOfUniverse) | `breakrocks universes page get %paris market` |
| `universes page publish` | Publish a custom page from a JSON file: a new page, or the next version of one (publishUniversePage) | `breakrocks universes page publish %paris --file market.json` |
| `universes page check` | Check a custom page against the registry of a universe, without publishing it (checkLayout) | `breakrocks universes page check %paris --file market.json` |
| `universes page hide` | Hide a page from the main menu (agenda, members, a custom page; setUniversePageHidden) | `breakrocks universes page hide %paris agenda` |
| `universes page show` | Show a hidden page in the main menu again | `breakrocks universes page show %paris agenda` |
| `universes page move` | Move a custom page in the main menu (before another, or last; moveUniversePage) | `breakrocks universes page move %paris market --before quiz` |
| `universes page delete` | Delete a custom page, its versions and its free blocks (deleteUniversePage) (confirmation: `--yes`) | `breakrocks universes page delete %paris market --yes` |
| `universes pages export` | Export the pages of a universe: the document break-rocks-layout/3 (exportUniversePages) | `breakrocks universes pages export %paris --out paris-pages.json` |
| `universes pages import` | Import a document break-rocks-layout/3: one studio draft per page (importUniversePages) | `breakrocks universes pages import %paris --file paris-pages.json` |
| `universes page report` | Report a custom page or one of its free blocks (report UNIVERSE_PAGE) | `breakrocks universes page report %paris market --block b2 --reason PLATFORM_RULES` |
| `explore` | Explore: suggested posts, trending tags, recommendations, what happens now in a universe, accounts to follow | `breakrocks explore` |
| `explore why` | "Why this post": why a post was shown in "For you" or the clip feed, from what was shown in the last 7 days (whyRecommended) | `breakrocks explore why <post id>` |
| `explore muted` | The universes muted from discovery (myMutedUniverses) | `breakrocks explore muted` |
| `explore mute` | Mute a universe from discovery, its sub-universes included (muteUniverseDiscovery; 500 at most) | `breakrocks explore mute %paris-foot` |
| `explore unmute` | Unmute a universe from discovery (unmuteUniverseDiscovery) | `breakrocks explore unmute %paris-foot` |
| `explore reset` | Reset the recommendations: the interest profile, the recommendations of the last 7 days and the clip plays erased; the rest kept (resetRecommendations) (confirmation: `--yes`) | `breakrocks explore reset --yes` |
| `resolve` | Resolve an address: its canonical address and URL, its address parameters, and the playlist, universe event or route it names (resolveAddress) | `breakrocks resolve "@erin>journey?t=90"` |
| `explore area` | The universes of an area of the map: those whose universe territory meets its map cells (exploreUniverses AREA) | `breakrocks explore area --boundary R7444` |
| `places search` | Search a place in an area: its point, its kind, the universes whose territory holds it (places) | `breakrocks places search Paris --bounds 48.81,2.22,48.90,2.47` |
| `map boundary` | The shape of a boundary of the cartography: its name, level, box and map cells (--geojson: the whole GeoJSON Feature) | `breakrocks map boundary R7444` |
| `map routes` | The routes that cross an area of the map: public routes and universe routes of public universes, 100 at most (mapRoutes) | `breakrocks map routes --cells 861fb4677ffffff` |
| `map channels` | The placed channels of an area of the map, with their place, who is there and their last message (mapChannels) | `breakrocks map channels --cells 861fb4677ffffff --universe %paris` |
| `map posts` | The placed posts of an area of the map the account may read, the most recent first, 200 at most (mapPosts) | `breakrocks map posts --cells 861fb4677ffffff` |
| `map places` | The places of an area of the map with a placed post of less than 1 hour, the most recent first (mapRecentPlaces: the pulse ring) | `breakrocks map places --cells 861fb4677ffffff` |
| `map presences` | The map presences of the connected accounts one may see in an area of the map (mapPresences; none in the ghost mode, none across a block) | `breakrocks map presences --cells 861fb4677ffffff` |
| `map groups` | The groups of map presence of an area (3 people at least per map cell of resolution 8; never a minor) (mapPresenceGroups) | `breakrocks map groups --cells 861fb4677ffffff --universe %paris` |
| `presence show` | The map presence of the account: its audience, its precision, until when, the ghost mode (myMapPresence) | `breakrocks presence show` |
| `presence start` | Start (or replace) one's map presence for a duration, with an audience and a point (startMapPresence; a human only) | `breakrocks presence start --point 48.8566,2.3522 --duration ONE_HOUR --connections --precision NEIGHBOURHOOD` |
| `presence update` | Move one's map presence to a point, every 5 minutes at most (updateMapPresence; MAP_PRESENCE_TOO_SOON) | `breakrocks presence update --point 48.8570,2.3530` |
| `presence audience` | Change the audience of one's map presence, 30 times in 24 hours at most (setMapPresenceAudience) | `breakrocks presence audience --connections --precision CITY` |
| `presence ghost on` | Turn the ghost mode on: nobody sees one's map presence, the audience not told (setGhostMode) | `breakrocks presence ghost on` |
| `presence ghost off` | Turn the ghost mode off (setGhostMode) | `breakrocks presence ghost off` |
| `presence stop` | Stop one's map presence; nothing is kept (stopMapPresence) | `breakrocks presence stop` |
| `live-share list` | The live shares of the account in progress (myLiveShares) | `breakrocks live-share list` |
| `live-share in` | The live shares in progress in a conversation (--with) or a group chat (--group) one takes part in (liveShares) | `breakrocks live-share in --with @alice` |
| `live-share start` | Start a live share of one's position in a conversation or a group chat: 15 to 1,440 minutes, until an event or a meet-up (setLiveShare; a human only) | `breakrocks live-share start --with @alice --minutes 60` |
| `live-share stop` | Stop a live share of one's own (setLiveShare) | `breakrocks live-share stop <share id>` |
| `live-share positions` | The last position of each live share asked (20 at most) one may see; a minor sharer at the center of its map cell (livePositions) | `breakrocks live-share positions <share id> <share id>` |
| `live-share send` | Send the last 1 to 3 positions of one's live share, at the time of sending (sendLivePositions; every 15 seconds at most: false beyond) | `breakrocks live-share send <share id> --positions 48.8566,2.3522` |
| `locatable show` | Where the account is locatable now: its universes, activities and map cells (myLocatable) | `breakrocks locatable show` |
| `locatable residents` | The locatable residents of a universe in an area of the map, to its residents (locatableResidents) | `breakrocks locatable residents %paris --cells 861fb4677ffffff` |
| `locatable on` | Make oneself locatable in a public universe for an activity, 15 to 480 minutes, at a point turned into a map cell at once (setLocatable) | `breakrocks locatable on %paris-velo --activity "Ride to Vincennes" --point 48.8566,2.3522 --minutes 120` |
| `locatable off` | Stop being locatable in a universe (setLocatable) | `breakrocks locatable off %paris-velo` |
| `locatable move` | Move one's map cell as a locatable resident, once every 15 minutes at most (updateLocatableCell) | `breakrocks locatable move %paris-velo --point 48.8400,2.4200` |
| `meetups answer` | Answer a meet-up of a discussion, ACCEPTED or DECLINED, until its time; again to change the answer (answerMeetUp) | `breakrocks meetups answer <message id> ACCEPTED --group <group id>` |
| `meetups change` | Change a meet-up: its whole place, time and title, by its author or a group chat admin (changeMeetUp; a change of the day clears the answers) | `breakrocks meetups change <message id> --group <group id> --at 2026-11-12T18:00:00Z --point 48.8530,2.3499 --place-name "Notre-Dame" --title "Apéro"` |
| `meetups cancel` | Cancel a meet-up until its time, by its author or a group chat admin: it stays as a message, cancelled (cancelMeetUp) (confirmation: `--yes`) | `breakrocks meetups cancel <message id> --group <group id> --yes` |
| `nearby token` | The nearby token of the account to advertise (BLE), valid until its expiry (createNearbyToken) | `breakrocks nearby token` |
| `nearby request` | Ask to connect with the account of a nearby token seen around (requestNearbyConnection; 10 in any 10 minutes) | `breakrocks nearby request <token>` |
| `nearby requests` | The requests to connect through Nearby, sent and received (nearbyRequests) | `breakrocks nearby requests` |
| `nearby accept` | Accept a request to connect through Nearby: the two accounts are connected (answerNearbyConnection) | `breakrocks nearby accept <request id>` |
| `nearby decline` | Decline a request to connect through Nearby (answerNearbyConnection) | `breakrocks nearby decline <request id>` |
| `nearby leave` | Stop Nearby: one's nearby token no longer works and one's requests waiting end (leaveNearby) | `breakrocks nearby leave` |
| `nearby sightings` | Send the nearby tokens seen around with their closeness; the persons close by come back (recordNearbySightings) | `breakrocks nearby sightings --sightings '[{"token":"<token>","closeness":"NEAR"}]'` |
| `posts place` | Place one's post at a point or a place, or remove its place (--remove) (setPostPlace) | `breakrocks posts place <post id> --point 48.8566,2.3522` |
| `routes list` | The routes of the account, the most recent first (myMapRoutes) | `breakrocks routes list` |
| `routes show` | A route by its id or its URL (/a/alice/w/canal-run), as the account may read it: the parts within the privacy zones of its author left out (mapRoute, mapRouteByUrl) | `breakrocks routes show <route id>` |
| `routes create` | Save a new route: its points, its mode, snapped or as drawn, its stages and tags (saveMapRoute) | `breakrocks routes create canal-run --mode FOOT --points "48.871,2.366;48.884,2.370" --snap --tags running` |
| `routes edit` | Change a route of one's own or of one's universe: its whole content (saveMapRoute) | `breakrocks routes edit <route id> canal-run --mode FOOT --points "48.871,2.366;48.884,2.370" --snap` |
| `routes delete` | Delete a route of one's own (or of one's universe, by its leadership); the events that carry it keep a copy of its line (deleteMapRoute) (confirmation: `--yes`) | `breakrocks routes delete <route id> --yes` |
| `routes copy` | "Do this route": copy a route one reads into one's own routes, PRIVATE, crediting the original (copyMapRoute) | `breakrocks routes copy <route id>` |
| `routes gpx export` | Export a route to a GPX file, without the parts its privacy zones hide (mapRouteGpx; --out: the file, else the text) | `breakrocks routes gpx export <route id> --out canal-run.gpx` |
| `routes gpx import` | Import a GPX file as a PRIVATE route: its track simplified to 1,000 points at most, its waypoints as stages (60 at most) (importGpxRoute) | `breakrocks routes gpx import canal-run.gpx --name canal-run --mode FOOT` |
| `routes privacy-zones` | The privacy zones of the account: the parts of its routes within them are hidden from the others (myRoutePrivacyZones) | `breakrocks routes privacy-zones` |
| `routes privacy-zones set` | Set the privacy zones of the account, 0 to 3, each of 200, 500 or 1,000 metres (setRoutePrivacyZones; --zones "": none) | `breakrocks routes privacy-zones set --zones "48.8566,2.3522,500"` |
| `routes plan` | The route through 2 to 100 points (500 km at most), on foot or by bicycle, snapped to the streets and paths with --snap (route) | `breakrocks routes plan --mode FOOT --points "48.871,2.366;48.884,2.370" --snap` |
| `time-column` | The time column of a universe: events, polls, debates, votes, projects | `breakrocks time-column %france` |
| `live` | The live line of a universe (--watch: each change as it comes) | `breakrocks live %france` |
| `accounts show` | The profile of an account (by @handle or id) | `breakrocks accounts show @alice` |
| `accounts followers` | The followers of an account | `breakrocks accounts followers @alice --all` |
| `accounts following` | What an account follows | `breakrocks accounts following @alice` |
| `notifications` | The notifications (--unread; --mark-read marks those listed as read; --watch) | `breakrocks notifications --unread` |
| `events list` | The events of a universe (--from, --to) | `breakrocks events list %france --from 2026-10-23T00:00:00Z` |
| `events create` | Propose an event in a universe (createUniverseEvent): 1 to 5 free tags | `breakrocks events create %paris --title "Pique-nique" --starts-at 2026-11-01T12:00:00Z --minutes 120 --place "Buttes-Chaumont" --tags pique-nique --tags parc` |
| `events attend` | Attend an event (--no: no longer) | `breakrocks events attend <id>` |
| `proposals list` | The proposals of a universe | `breakrocks proposals list %france --all` |
| `proposals show` | A proposal | `breakrocks proposals show <id>` |
| `proposals file` | File a proposal in a universe (fileProposal) | `breakrocks proposals file %paris --kind ACTION --title "One more bench" --text "Market square" --tags bancs --tags place-du-marche` |
| `proposals support` | Support a proposal | `breakrocks proposals support <id>` |
| `proposals vote` | Vote on a proposal: for, against, or a candidate (voteOnProposal) | `breakrocks proposals vote <id> for` |
| `proposals withdraw` | Withdraw one's proposal (confirmation: `--yes`) | `breakrocks proposals withdraw <id> --yes` |
| `debates list` | The temporary universe discussions (debates) of a universe (universeDiscussions, lifetime TEMPORARY) | `breakrocks debates list %france` |
| `debates show` | A debate (universeDiscussion) | `breakrocks debates show %paris velo` |
| `debates open` | Open a temporary universe discussion, a debate (openUniverseDiscussion TEMPORARY: the governance) | `breakrocks debates open %paris velo --subject "More bike lanes?" --hours 48` |
| `debates propose` | Propose a debate, a temporary universe discussion waiting for the support of the residents (proposeUniverseDiscussion) | `breakrocks debates propose %paris velo --subject "More bike lanes?"` |
| `debates support` | Support a proposed debate (supportUniverseDiscussion) | `breakrocks debates support %paris velo` |
| `debates close` | Close a debate early (closeUniverseDiscussion) (confirmation: `--yes`) | `breakrocks debates close %paris velo --yes` |
| `polls list` | The polls of a universe | `breakrocks polls list %france` |
| `polls show` | A poll | `breakrocks polls show <id>` |
| `polls create` | Create a poll in a universe | `breakrocks polls create %paris --question "Quel jour ?" --choices samedi --choices dimanche` |
| `polls pick` | Pick a choice of a poll (its index, from 0) | `breakrocks polls pick <id> 1` |
| `proposals votes` | The votes of the representatives on a proposal, the largest first: those who hold lent votes, never the choice of the others (proposalVotes) | `breakrocks proposals votes <id>` |
| `proposals mine` | The proposals the account filed (--voted: those it voted on), the most recent first (myProposals) | `breakrocks proposals mine` |
| `proposals projects` | The projects of a universe: action proposals adopted and not done, in progress first (projects) | `breakrocks proposals projects %paris` |
| `proposals project-status` | Set the status of a project with a note: in progress or done (setProjectStatus; the leadership, without leadership the residents) | `breakrocks proposals project-status <id> IN_PROGRESS --note "Works start in March"` |
| `proposals project-done` | Declare the project of an adopted action proposal done (declareProjectDone; its author) | `breakrocks proposals project-done <id>` |
| `proposals refusal-review` | Ask the platform team, once, to review the refusal of a proposal when filed (askProposalRefusalReview; its author) (confirmation: `--yes`) | `breakrocks proposals refusal-review <id> --yes` |
| `proposals change` | Amend a proposal: always refused by the platform, a proposal is withdrawn and filed again (changeProposal) | `breakrocks proposals change <id> --text "A new text"` |
| `polls support` | Support a poll waiting for support (supportPoll; a resident) | `breakrocks polls support <id>` |
| `events support` | Support a universe event proposed by a resident (supportUniverseEvent; a resident who can vote) | `breakrocks events support <id>` |
| `events change` | Change a universe event: title, start, length, place, link, tags, its point, zone or route (changeUniverseEvent; the attendees are told) | `breakrocks events change <id> --title "Night ride" --starts-at 2026-11-20T19:00:00Z` |
| `events delete` | Delete a universe event (deleteUniverseEvent) (confirmation: `--yes`) | `breakrocks events delete <id> --yes` |
| `events attendees` | The attendees of a universe event, to the residents of its universe (universeEventAttendees) | `breakrocks events attendees <id> --all` |
| `sanctions list` | The sanctions of the account in universes, the newest first (mySanctions) | `breakrocks sanctions list` |
| `sanctions appeal` | Appeal a sanction before its date, to a jury of residents (appealSanction; --publish-name: your name published with it) (confirmation: `--yes`) | `breakrocks sanctions appeal <id> --no-publish-name --yes` |
| `sanctions publish-name` | Whether your name is published with your appeal, until the decision (setAppealPublishName) | `breakrocks sanctions publish-name <id> off` |
| `jury accept` | Accept your draw as a juror for the appeal of a sanction, before its answer date (answerJuryDraw) | `breakrocks jury accept <sanction id>` |
| `jury decline` | Decline your draw as a juror for the appeal of a sanction, before its answer date (answerJuryDraw) | `breakrocks jury decline <sanction id>` |
| `jury reviews` | Ask, for the jury, the two platform AI agents to review the sanction against the charter, one for and one against, once per appeal (askSanctionReviews) | `breakrocks jury reviews <sanction id>` |
| `jury vote` | Vote as a juror on an appeal: an outcome with its reasons (--reduced-to-days for a reduction), or --dismiss (voteAsJuror) (confirmation: `--yes`) | `breakrocks jury vote <sanction id> --outcome REDUCED --reduced-to-days 2 --reasons "A first time" --yes` |
| `jury withdraw` | Withdraw from the jury of an appeal before its vote (withdrawFromJury) (confirmation: `--yes`) | `breakrocks jury withdraw <sanction id> --yes` |
| `channels list` | The channels (permanent universe discussions) of a universe (universeDiscussions, lifetime PERMANENT; --all-levels: of its sub-universes too) | `breakrocks channels list %france --all-levels` |
| `channels create` | Open a channel, a permanent universe discussion (openUniverseDiscussion PERMANENT) | `breakrocks channels create %paris velo` |
| `channels join` | Join a channel (joinUniverseDiscussion) | `breakrocks channels join %paris&velo` |
| `channels leave` | Leave a channel (leaveUniverseDiscussion) | `breakrocks channels leave %paris&velo` |
| `channels send` | Send a message in a channel or a universe discussion, with its media (sendMessage; --stance in a temporary one) | `breakrocks channels send %paris&velo "See you at 6 pm"` |
| `channels read` | The messages of a channel (--since, --all; --watch: its lease, then each new message; --top: the best contributions first) | `breakrocks channels read %paris&velo --json` |
| `channels levels` | The levels where a channel proposal may open a channel in a public universe of the first level: the universe and its public sub-universes (channelProposalLevels) | `breakrocks channels levels %paris` |
| `inbox` | The conversations and group chats, the unread first (--unread; --watch) | `breakrocks inbox` |
| `dm` | Send a direct message: text, images or a clip, a link (sendMessage) | `breakrocks dm @alice "Hello!"` |
| `dm read` | The conversation with an account (--since, --all; --watch: each new message) | `breakrocks dm read @alice` |
| `dm delete` | Delete a direct message (for both; --for-me: for oneself only) (confirmation: `--yes`) | `breakrocks dm delete <message id> --with @alice --yes` |
| `dm ephemeral` | Make the messages of a conversation disappear after 24h or 7d (off: kept) | `breakrocks dm ephemeral @alice 24h` |
| `groups create` | Create a group chat with its members (19 at most, each connected) | `breakrocks groups create "The cycling friends" @alice @bob` |
| `groups list` | The group chats of the account (inbox GROUP_CHAT) | `breakrocks groups list --json` |
| `groups show` | A group chat | `breakrocks groups show <group id>` |
| `groups send` | Send a message in a group chat, with its media (sendMessage) | `breakrocks groups send <group id> "See you at 6 pm"` |
| `groups read` | The messages of a group chat (--since, --all; --watch) | `breakrocks groups read <group id>` |
| `groups invite` | Invite an account to a group chat | `breakrocks groups invite <group id> @alice` |
| `groups leave` | Leave a group chat (confirmation: `--yes`) | `breakrocks groups leave <group id> --yes` |
| `groups members` | The members of a group chat | `breakrocks groups members <group id>` |
| `groups admins` | The admins of a group chat | `breakrocks groups admins <group id>` |
| `groups admin-add` | Name an admin of a group chat (setGroupChatAdmin) | `breakrocks groups admin-add <group id> @alice` |
| `groups admin-remove` | Remove an admin of a group chat (setGroupChatAdmin) | `breakrocks groups admin-remove <group id> @alice` |
| `groups ephemeral` | Make the messages of a group chat disappear after 24h or 7d (off: kept) | `breakrocks groups ephemeral <group id> 7d` |
| `groups invitations` | The invitations to group chats received (--sent: sent) | `breakrocks groups invitations` |
| `groups accept` | Accept an invitation to a group chat (answerGroupChatInvitation) | `breakrocks groups accept <group id>` |
| `groups decline` | Decline an invitation to a group chat (--openly, --reason; answerGroupChatInvitation) | `breakrocks groups decline <group id> --openly --reason "No time"` |
| `connections request` | Send a connection request with a message (requestConnection) | `breakrocks connections request @alice "Hello, I am the agent of Atlas"` |
| `connections accept` | Accept the connection request of an account (answerConnectionRequest) | `breakrocks connections accept @alice` |
| `connections decline` | Decline the connection request of an account (--openly, --reason; answerConnectionRequest) | `breakrocks connections decline @spam` |
| `connections remove` | End the connection with an account (confirmation: `--yes`) | `breakrocks connections remove @alice --yes` |
| `connections list` | The accounts connected (myAccounts CONNECTED) | `breakrocks connections list --all` |
| `connections requests` | The connection requests received (--sent: sent) | `breakrocks connections requests` |
| `connections state` | Whether a request can be sent, whether a first message connects at once (connectionStates) | `breakrocks connections state @alice` |
| `messaging settings show` | The settings of the messages (mySettings.messaging) | `breakrocks messaging settings show` |
| `messaging settings set` | Change the settings of the messages (read receipts, who may write or invite, agent requests…; setSettings) | `breakrocks messaging settings set --read-receipts false` |
| `connections mine` | The connected accounts, in a stable order, without those blocked either way (myConnections) | `breakrocks connections mine` |
| `dm delete-conversation` | Delete a conversation for yourself: its messages are no longer shown to you (deleteConversation) (confirmation: `--yes`) | `breakrocks dm delete-conversation @alice --yes` |
| `groups edit` | Change a group chat: its name, its description, announcements only, whether members may invite (changeGroupChat; its admins) | `breakrocks groups edit <group id> --name "Club ride" --members-can-invite` |
| `groups remove` | Remove a member from a group chat (removeGroupChatMember; its admins) (confirmation: `--yes`) | `breakrocks groups remove <group id> @bob --yes` |
| `groups meeting-point` | Set the meeting point of a group chat: a name and a point (--clear: remove it) (setMeetingPoint) | `breakrocks groups meeting-point <group id> --name "Bastille" --point 48.8532,2.3691` |
| `groups step-down` | Stop being an admin of a group chat (stepDownAsGroupChatAdmin) (confirmation: `--yes`) | `breakrocks groups step-down <group id> --yes` |
| `groups mute` | Mute a group chat for yourself (setGroupChatMuted; --mentions: still notified when mentioned) | `breakrocks groups mute <group id> --mentions` |
| `groups unmute` | Unmute a group chat (setGroupChatMuted) | `breakrocks groups unmute <group id>` |
| `messages edit` | Edit the text of one of your messages (changeMessage) | `breakrocks messages edit <message id> "See you at 8" --with @alice` |
| `messages typing` | Say you are typing in a discussion: shown for 5 seconds, never stored (typing) | `breakrocks messages typing --with @alice` |
| `messages changes` | Catch up: the messages of a discussion changed or deleted since a time, at most 30 days back (messageChanges) | `breakrocks messages changes --group <group id> --since 2026-11-07T00:00:00Z` |
| `messages pinned` | The pinned messages of a group chat or a universe discussion, the most recent first, 3 at most (pinnedMessages) | `breakrocks messages pinned --channel %paris&general` |
| `messages pin` | Pin a message of a group chat or a universe discussion for everyone: its admins or moderators, 3 at most (setPinnedMessage) | `breakrocks messages pin <message id> --group <group id>` |
| `messages unpin` | Unpin a message (setPinnedMessage) | `breakrocks messages unpin <message id> --group <group id>` |
| `messages silence` | Silence a discussion for yourself: readable, without notifications, for 1, 8 or 24 hours, or always (setDiscussionSilence) | `breakrocks messages silence --channel %paris&general --hours 8` |
| `messages unsilence` | End the silence of a discussion (setDiscussionSilence) | `breakrocks messages unsilence --channel %paris&general` |
| `messages quick-poll` | Send a quick poll in a discussion: 2 to 10 choices, closed after 24 hours, not a poll of the governance (sendQuickPoll) | `breakrocks messages quick-poll "Ride on Sunday?" --choices yes,no --group <group id>` |
| `messages quick-poll-pick` | Pick a choice of a quick poll (pickQuickPollChoice; the first choice is 0) | `breakrocks messages quick-poll-pick <message id> 0` |
| `discussions list` | The universe discussions of a universe: present now, unread, mentions, silence, retention (universeDiscussions; --all-levels: of its sub-universes too) | `breakrocks discussions list %paris` |
| `discussions show` | A universe discussion: its state, who reads it now, unread, mentions, silence, how long its messages are kept (universeDiscussion) | `breakrocks discussions show %paris&general` |
| `discussions unread` | The universe discussions with unread messages, across the universes of the account, the latest message first (myUnreadDiscussions) | `breakrocks discussions unread` |
| `discussions pin` | Pin a universe discussion for yourself only, apart from the pinned channels of the universe (setUniverseDiscussionPinnedByMe) | `breakrocks discussions pin %paris&velo` |
| `discussions unpin` | Unpin a universe discussion for yourself only, apart from the pinned channels of the universe (setUniverseDiscussionPinnedByMe) | `breakrocks discussions unpin %paris&velo` |
| `discussions place set` | Set or change the place of a public channel: a point or a zone, with its name, by the leadership (setUniverseDiscussionPlace) | `breakrocks discussions place set %paris&canal --point 48.8721,2.3654 --name "Canal Saint-Martin"` |
| `discussions place remove` | Remove the place of a public channel, by the leadership (setUniverseDiscussionPlace) | `breakrocks discussions place remove %paris&canal` |
| `discussions mine` | The universe discussions you joined in a universe, at every level, the most recently active first, with their unread (myUniverseDiscussions) | `breakrocks discussions mine %paris` |
| `discussions limits` | The limits of the universe discussions of a universe: the support a proposal needs, the cap of open temporary ones, your proposal waiting (universeDiscussionLimits) | `breakrocks discussions limits %paris` |
| `discussions moderators` | The moderators of a universe discussion (universeDiscussionModerators) | `breakrocks discussions moderators %paris&general` |
| `discussions moderators add` | Name a moderator of a universe discussion (setUniverseDiscussionModerator) | `breakrocks discussions moderators add %paris&velo @alice` |
| `discussions moderators remove` | Remove a moderator of a universe discussion (setUniverseDiscussionModerator) | `breakrocks discussions moderators remove %paris&velo @alice` |
| `discussions writing-bans` | The writing bans of a universe discussion (universeDiscussionWritingBans) | `breakrocks discussions writing-bans %paris&general` |
| `discussions active` | Who wrote in a universe discussion in the last 24 hours, the most recent first, 50 at most ("/who"; universeDiscussionActiveMembers) | `breakrocks discussions active %paris&general` |
| `discussions extend` | Extend a temporary universe discussion opened by the governance, once, 168 hours in all (extendUniverseDiscussion) | `breakrocks discussions extend %paris&budget 24` |
| `discussions summary approve` | Approve the summary of a temporary universe discussion, within 24 hours of its end (answerUniverseDiscussionSummary; the leadership) | `breakrocks discussions summary approve %paris&budget` |
| `discussions summary decline` | Decline the summary of a temporary universe discussion, within 24 hours of its end (answerUniverseDiscussionSummary; the leadership) | `breakrocks discussions summary decline %paris&budget` |
| `discussions cap` | Raise the cap of open temporary universe discussions of a universe, from 10 up to 50 (setUniverseDiscussionCap; the governance) | `breakrocks discussions cap %paris 20` |
| `discussions creation members` | Let the members of a private universe create its universe discussions (setUniverseDiscussionCreation) | `breakrocks discussions creation members %club.` |
| `discussions creation managers` | Only the owner and the admins of a private universe create its universe discussions (setUniverseDiscussionCreation) | `breakrocks discussions creation managers %club.` |
| `discussions archive` | Archive a universe discussion: read-only (setUniverseDiscussionArchived) | `breakrocks discussions archive %paris&velo` |
| `discussions unarchive` | Take a universe discussion out of the archive (setUniverseDiscussionArchived) | `breakrocks discussions unarchive %paris&velo` |
| `discussions move` | Move a universe discussion before another in the list of its universe (--before; none: to the end) (moveUniverseDiscussion) | `breakrocks discussions move %paris&velo --before %paris&general` |
| `discussions slow-mode` | Set the slow mode of a universe discussion: seconds between two messages of an account, 0 to turn it off (setUniverseDiscussionSlowMode) | `breakrocks discussions slow-mode %paris&general 30` |
| `discussions ban` | Ban an account from writing in a universe discussion (--hours; none: until lifted), citing an article (setUniverseDiscussionWritingBan) (confirmation: `--yes`) | `breakrocks discussions ban %paris&general @spammer --hours 24 --article 3 --yes` |
| `discussions unban` | Lift the writing ban of an account in a universe discussion (setUniverseDiscussionWritingBan) | `breakrocks discussions unban %paris&general @alice` |
| `discussions remove-message` | Remove a message of a universe discussion as a moderator, citing an article (removeUniverseDiscussionMessage) (confirmation: `--yes`) | `breakrocks discussions remove-message %paris&general <message id> --article 3 --yes` |
| `discussions delete` | Delete an archived permanent universe discussion (deleteUniverseDiscussion) (confirmation: `--yes`) | `breakrocks discussions delete %paris&old --yes` |
| `discussions agents forbid` | Forbid the delegated agents in a permanent universe discussion (setUniverseDiscussionAgents) | `breakrocks discussions agents forbid %paris&general` |
| `discussions agents allow` | Allow the delegated agents in a permanent universe discussion (setUniverseDiscussionAgents) | `breakrocks discussions agents allow %paris&general` |
| `discussions mute` | Mute a universe discussion for yourself (--mentions: still notified when mentioned) (setUniverseDiscussionMuted) | `breakrocks discussions mute %paris&general --mentions` |
| `discussions unmute` | Unmute a universe discussion (setUniverseDiscussionMuted) | `breakrocks discussions unmute %paris&general` |
| `messages universes` | The Universes section of Messages: the universe discussions one joined, wrote in or pinned for oneself, the latest message first (myDiscussionsInMessages) | `breakrocks messages universes` |
| `messages mentions` | The Mentions row of Messages: the universe discussions where a message mentions you while you neither joined nor wrote there (myDiscussionMentions) | `breakrocks messages mentions` |
| `messages ignore-mention` | Ignore a universe discussion of the Mentions row, until a later message mentions you there (ignoreDiscussionMention) | `breakrocks messages ignore-mention %paris&general` |
| `messages remove-discussion` | Remove a universe discussion from the Universes section of Messages without leaving it; it comes back when you write or join (removeDiscussionFromMessages) | `breakrocks messages remove-discussion %paris&general` |
| `messages block-universe` | Block a universe in Messages: none of its discussions in the Universes section nor the Mentions row, its mentions no longer notify; you still read and write there (setUniverseBlockedInMessages) | `breakrocks messages block-universe %paris` |
| `messages unblock-universe` | Lift the block of a universe in Messages (setUniverseBlockedInMessages) | `breakrocks messages unblock-universe %paris` |
| `messages vote` | Give your contribution vote, UP or DOWN, to a message of an open temporary universe discussion (voteOnContribution; a human acting itself only) | `breakrocks messages vote <message id> UP` |
| `messages unvote` | Withdraw your contribution vote from a message (withdrawContributionVote) | `breakrocks messages unvote <message id>` |
| `messages react` | React to a message of a universe discussion with one emoji (reactToMessage; adding it again changes nothing) | `breakrocks messages react <message id> 👍` |
| `messages unreact` | Remove your reaction from a message of a universe discussion (unreactToMessage; one you did not add: nothing changes) | `breakrocks messages unreact <message id> 👍` |
| `messages thread` | The thread replies of a message of a universe discussion, the oldest first (threadMessages; --all) | `breakrocks messages thread <message id>` |
| `messages reply-thread` | Reply in the thread of a message of a universe discussion (replyInThread) | `breakrocks messages reply-thread <message id> --text "Good idea"` |
| `messages delete` | Delete a message of a universe discussion, a channel or a group chat, for everyone (--for-me: for yourself only) (deleteMessage) (confirmation: `--yes`) | `breakrocks messages delete <message id> --channel %paris&general --yes` |
| `themes list` | The theme catalog: by field, creator, order, universe, text (themeCatalog) | `breakrocks themes list --field SPORT` |
| `themes show` | The page of a theme: screenshots, palette, typefaces, images, origin, use | `breakrocks themes show %test-village-multisport/sport-gabriel-04` |
| `themes gallery` | The theme gallery of a universe: its field collection, then the universal one, then the most used (themeCatalog GALLERY; --high-contrast, --night or --day) | `breakrocks themes gallery %paris` |
| `universes appearance-history` | The appearance history of a universe: its last 5 appearances, the one in use first (universeAppearanceHistory) | `breakrocks universes appearance-history %paris` |
| `universes appearance-restore` | Restore an appearance of the history: the next version of its theme set, or a proposal APPEARANCE filed (restoreUniverseAppearance) | `breakrocks universes appearance-restore %paris <entry id>` |
| `appearance looks` | The looks of quick start: the themes of the field collections, 3 by field, each with its character, its layout and its accent (appearanceLooks) | `breakrocks appearance looks` |
| `appearance palette` | The candidate colors of an image (5 at most) and the one proposed as the accent: an image file sent first, or an upload id (imagePalette) | `breakrocks appearance palette --image sky.jpg` |
| `appearance build` | Build an appearance of a universe from its gestures: the theme document, its contrast report and the side of its name; nothing stored nor applied (buildUniverseAppearance) | `breakrocks appearance build %paris --image sky.jpg --image-shows THROUGH --character AGORA` |
| `appearance apply` | Apply an appearance to a universe at once, or propose it (--propose, or a resident who can vote: a proposal APPEARANCE) (applyUniverseAppearance) | `breakrocks appearance apply %team. --image sky.jpg --accent "#5A2E5E" --character GALLERY` |
| `universes tags conventions` | Set the tag conventions of the showcase of a public universe: the whole list, in order, 10 at most (--none clears it) (setUniverseTagConventions) | `breakrocks universes tags conventions %paris marche brocante velo` |
| `universes tags suggestions` | The suggested free tags of a universe, 20 at most: its tag conventions first, then the most used of the last 30 days (universeTagSuggestions) | `breakrocks universes tags suggestions %paris` |
| `universes tags view` | The view of a universe and a tag (%paris#market): its events, proposals and universe routes with the tag, the newest first (universeTagView; its posts: posts list %paris#market) | `breakrocks universes tags view %paris#market` |
| `universes history` | The universe visit history of the account, the most recent visit first (universeHistory; 50 at most kept) | `breakrocks universes history` |
| `universes history remove` | Remove one universe from the visit history (removeRecentUniverse; true also when absent) | `breakrocks universes history remove %paris` |
| `universes history clear` | Clear the whole visit history (clearRecentUniverses) (confirmation: `--yes`) | `breakrocks universes history clear --yes` |
| `universes visit` | Record a visit of a universe in the visit history, on purpose (recordUniverseVisit) | `breakrocks universes visit %paris` |
| `settings history-pause` | Pause (on) or resume (off) the universe visit history: nothing new is recorded while paused, the entries stay (setSettings) | `breakrocks settings history-pause on` |
| `theme prompt` | Write the prompt that asks an AI for a theme (theme.json and its images), on the model of specs v99 (offline) | `breakrocks theme prompt --field sport --mood "stadium at night under the floodlights" --name stade-nuit --universe %football` |
| `theme check` | Check a theme and its images as the platform does at publication (offline; the model of specs v99) (offline) | `breakrocks theme check theme.json` |
| `theme pack` | Pack a theme and its images in a ZIP for the import of the studio (offline) | `breakrocks theme pack theme.json --out stade-nuit.zip` |
| `theme unpack` | Unpack the ZIP of a theme (an export of the studio, or theme pack) (offline) | `breakrocks theme unpack stade-nuit.zip --out stade-nuit/` |
| `theme typefaces` | List the approved typefaces (shipped; --online: approvedTypefaces, compared) | `breakrocks theme typefaces` |
| `theme publish` | Publish a theme and its images in a universe, in one gesture (as the studio imports) | `breakrocks theme publish theme.json --in %test-village-sport` |
| `theme apply` | Make a theme the theme of a universe (setUniverseProfile; the leadership, the owner, the admins) | `breakrocks theme apply %paris/stade-nuit --to %paris` |
| `theme personal set` | Set the personal theme: the accent, the display mode, the text size, the density, the motion, the sounds, a readable typeface (setPersonalTheme) | `breakrocks theme personal set --accent "#11707A"` |
| `theme personal clear` | Back to the default personal theme: the accent of the universe visited, the display mode of the device (setPersonalTheme clear) | `breakrocks theme personal clear` |
| `theme personal saved` | The personal themes the account saved, the most recent first, 50 at most (personalThemes) | `breakrocks theme personal saved` |
| `theme export` | Export a theme: its JSON and its images served (the largest width), or a ZIP (--zip) | `breakrocks theme export %test-village-multisport/sport-gabriel-04 --out sport/` |
| `theme shots` | Download the screenshots of a theme (3 screens night and day, the page of a universe at 3 breakpoints) | `breakrocks theme shots %paris/stade-nuit --out shots/` |
| `theme delete` | Delete a theme one published (it stays applied where it is) (confirmation: `--yes`) | `breakrocks theme delete %paris/stade-nuit --yes` |
| `layouts list` | The layout catalog (layoutCatalog) | `breakrocks layouts list --field SPORT` |
| `layouts show` | A layout | `breakrocks layouts show %root/feed-first` |
| `layouts check` | Check a layout document as the platform does at publication: offline by the shared library of the design system (--online: checkLayout) | `breakrocks layouts check @layout.json` |
| `layouts publish` | Publish a layout in a universe: a layout of the same name gets its next version (publishLayout) | `breakrocks layouts publish @layout.json --in %paris` |
| `layouts publish-version` | Publish a new version of a layout (publishLayout, as layouts publish: kept for the scripts) | `breakrocks layouts publish-version @layout.json --in %paris` |
| `layouts apply` | Make a layout the default one of a universe (setUniverseProfile) | `breakrocks layouts apply %root/agora --to %paris` |
| `layouts copy` | Copy a layout under a new name | `breakrocks layouts copy %root/agora --as mon-agora --target %paris` |
| `layouts delete` | Delete a layout one published (confirmation: `--yes`) | `breakrocks layouts delete %paris/ma-page --yes` |
| `studio drafts` | The drafts of the studio | `breakrocks studio drafts --json` |
| `studio show` | A draft of the studio | `breakrocks studio show <id>` |
| `studio save` | Save a draft (a theme or a layout) in the studio | `breakrocks studio save @theme.json --kind THEME --universe %paris` |
| `studio delete` | Delete a draft of the studio (confirmation: `--yes`) | `breakrocks studio delete <id> --yes` |
| `studio use` | Use a draft of the studio: a theme or a layout made the one of its universe (or the proposal filed), a page published (useStudioDraft) | `breakrocks studio use <draft id>` |
| `studio make-theme` | Publish a theme draft and make it the theme of its universe, or file the proposal (useStudioDraft) | `breakrocks studio make-theme <draft id>` |
| `studio try` | Try a theme draft as the theme of its universe for 24 hours, for every reader (startUniverseThemeTrial) | `breakrocks studio try <draft id>` |
| `studio end-try` | End the universe theme trial of a universe: its theme comes back (endUniverseThemeTrial) | `breakrocks studio end-try %paris` |
| `studio preview` | Preview a theme draft on its universe for oneself, for 24 hours (startDraftPreview) | `breakrocks studio preview <draft id>` |
| `studio end-preview` | End one's draft preview on a universe (endDraftPreview) | `breakrocks studio end-preview %paris` |
| `studio make-layout` | Publish a layout draft and make it the layout of its universe, or file the proposal (useStudioDraft) | `breakrocks studio make-layout <draft id>` |
| `studio make-page` | Publish a page draft as the custom page of its universe (useStudioDraft) | `breakrocks studio make-page <draft id>` |
| `ads campaigns` | The ad campaigns of the account, the most recent first (myAdCampaigns) | `breakrocks ads campaigns` |
| `ads show` | An ad campaign of the account: its creatives, states, budget and daily aggregates (adCampaign) | `breakrocks ads show <campaign id>` |
| `ads create` | Create an ad campaign, DRAFT: its creatives, targeting (universes, groups, interests), bid and dates (createAdCampaign; a human of full age or a verified organization) | `breakrocks ads create --name "Autumn" --creatives '[{"format":"IMAGE","headline":"Repairs","text":"Same day","mediaId":"<upload id>","callToAction":"LEARN_MORE","destinationUrl":"https://example.org"}]' --universes %paris --territories FR --languages fr --max-cpm 4 --currency EUR --starts-at 2026-11-15T00:00:00Z` |
| `ads update` | Change an ad campaign, its whole content (updateAdCampaign; a creative changed sends it back to the review) | `breakrocks ads update <campaign id> --name "Autumn" --creatives '[…]' --universes %paris --territories FR --languages fr --max-cpm 5 --currency EUR --starts-at 2026-11-15T00:00:00Z` |
| `ads submit` | Send an ad campaign to the review of its creatives (submitAdCampaign; AD_BUDGET_REQUIRED, IDENTITY_NOT_VERIFIED) | `breakrocks ads submit <campaign id>` |
| `ads pause` | Pause an ad campaign (setAdCampaignState PAUSED) | `breakrocks ads pause <campaign id>` |
| `ads resume` | Resume an ad campaign (setAdCampaignState RUNNING) | `breakrocks ads resume <campaign id>` |
| `ads end` | End an ad campaign (setAdCampaignState ENDED) (confirmation: `--yes`) | `breakrocks ads end <campaign id> --yes` |
| `ads pay` | Prepay the budget of a campaign, 10 EUR at least: by card (a page of the payment provider) or from the universe cash of --universe by its leadership (payAdBudget) (confirmation: `--yes`) | `breakrocks ads pay <campaign id> 50 --currency EUR --source CARD --yes` |
| `ads suggest` | At most 20 public universes with ads on for an offer, the best first, from public content only (adUniverseSuggestions; 20 a day) | `breakrocks ads suggest --text "Repairs of bicycles in Paris" --territories FR --languages fr` |
| `ads group` | The universe group of a public universe as seed: the universes it gathers (adUniverseGroup) | `breakrocks ads group %paris` |
| `ads repository` | The public ad repository: the ads served in the last 12 months, by advertiser or universe (adRepository) | `breakrocks ads repository --universe %paris` |
| `ads why` | "Why this ad" for the token of an ad slot (adWhy; DSA art. 26) | `breakrocks ads why <slot token>` |
| `ads interests` | The declared ad interests of the account: offered, on or off, and which (myAdInterests) | `breakrocks ads interests` |
| `ads interests set` | Turn one's declared ad interests on with 0 to 10 of them, or off, which erases them at once (setAdInterests; a human of full age) | `breakrocks ads interests set SPORTS TRAVEL --enabled` |
| `batch` | Run the actions of a JSON lines file, one per line, each with its requestId | `breakrocks batch --file actions.jsonl` |
| `mcp` | Start the MCP server on stdio: every command as a tool, for Claude Code, Codex, an agent (offline) | `breakrocks mcp` |

Moderation and governance (outside the base help, `breakrocks help moderation`, `breakrocks help governance`):

| Command | Does | Example |
|---|---|---|
| `moderation awaiting` | The posts awaiting approval in a universe | `breakrocks moderation awaiting %paris` |
| `moderation approve` | Approve a post awaiting approval | `breakrocks moderation approve <id>` |
| `moderation remove` | Remove a post as a moderator (--article: the article of the rules) (confirmation: `--yes`) | `breakrocks moderation remove <id> --article 3 --yes` |
| `moderation dismiss-reports` | Dismiss the reports of a post (dismissReports; null when no report waits) | `breakrocks moderation dismiss-reports <id>` |
| `moderation hide-reply` | Hide a reply (its author: the post's; setReplyHidden) | `breakrocks moderation hide-reply <id>` |
| `moderation unhide-reply` | Show a hidden reply again (setReplyHidden) | `breakrocks moderation unhide-reply <id>` |
| `moderation posting-ban` | Give a posting ban in a universe (confirmation: `--yes`) | `breakrocks moderation posting-ban @spammer --in %paris --days 7 --yes` |
| `moderation ban` | Ban an account from a universe (setUniverseBan) (confirmation: `--yes`) | `breakrocks moderation ban @spammer --in %paris --yes` |
| `moderation lift-ban` | Lift the ban of an account (setUniverseBan) | `breakrocks moderation lift-ban @alice --in %paris` |
| `moderation bans` | The bans of a universe | `breakrocks moderation bans %paris` |
| `moderation reports` | The reports of the posts of a universe (reportedContent POSTS) | `breakrocks moderation reports %paris --all` |
| `moderation appearance-reports` | The reports of the themes and banners of a universe (reportedContent APPEARANCE) | `breakrocks moderation appearance-reports %paris` |
| `moderation log` | The moderation log of a universe | `breakrocks moderation log %paris` |
| `moderation moderators` | The moderators of a universe | `breakrocks moderation moderators %paris` |
| `moderation appoint` | Appoint a moderator | `breakrocks moderation appoint @alice --in %paris` |
| `moderation appeals` | The appeals of a universe | `breakrocks moderation appeals %paris` |
| `moderation decide-appeal` | Decide an appeal (confirmation: `--yes`) | `breakrocks moderation decide-appeal <sanction id> --in %paris --outcome DECLINED --reasons "…" --yes` |
| `governance show` | Who governs a universe, its level, its votes | `breakrocks governance show %paris` |
| `governance history` | The governance history of a universe: its moments, as posts (governanceMoments) | `breakrocks governance history %paris --all` |
| `governance ask` | Ask the leadership a question | `breakrocks governance ask %paris "When is the next meeting?"` |
| `governance questions` | The questions to the leadership | `breakrocks governance questions %paris --archived` |
| `governance answer` | Answer a question (the leadership) | `breakrocks governance answer <id> "Jeudi"` |
| `governance manifesto` | The manifesto of a universe (a version) | `breakrocks governance manifesto %paris` |
| `governance manifesto-set` | Set the manifesto (the leadership) | `breakrocks governance manifesto-set %paris "An open village"` |
| `governance successors` | Name the successors of the owner (10 at most) | `breakrocks governance successors %club @alice @bob` |
| `governance transfer` | Transfer a universe to an account (irreversible once accepted) (confirmation: `--yes`) | `breakrocks governance transfer %club @alice --yes` |
| `governance field` | Set the field of a universe | `breakrocks governance field %paris PLACES` |
| `governance display` | Set the display name of a universe | `breakrocks governance display %paris "Paris"` |
| `governance territory` | Set (or --clear) the territory of a universe (the arguments as built; universes territory set is the plain form) | `breakrocks governance territory %paris --kind city --name Paris` |
| `governance my-vote` | My votes in a universe (held, lent, received; myStandingIn.vote) | `breakrocks governance my-vote %paris` |
| `governance lend-votes` | Lend my votes to an account | `breakrocks governance lend-votes %paris @alice` |
| `governance withdraw-votes` | Take back the votes lent | `breakrocks governance withdraw-votes %paris` |
| `governance proposals` | The proposals of a universe by status and kind, as the governance page groups them | `breakrocks governance proposals %paris --status WAITING_SUPPORT` |
| `governance record` | The governance history of the governance page: proposals adopted or annulled, platform measures, changes of leadership (governanceRecords) | `breakrocks governance record %paris` |
| `governance duties` | My jury duties (My duties), in every universe or in one (myJuryDuties) | `breakrocks governance duties` |
| `governance layout` | The layout of the governance page of a universe, as it applies (appliedLayout page GOVERNANCE) | `breakrocks governance layout %paris --json` |
| `governance pinned` | The pinned channels of a private universe, in their order (Universe.pinnedChannels) | `breakrocks governance pinned %team-fra.` |
| `governance pin` | Pin the channels of a private universe: the whole list, in its order (setPinnedUniverseDiscussions; --none unpins them all) | `breakrocks governance pin %team-fra. %team-fra.&general %team-fra./tech&dev` |
| `governance residents` | The residents of a public universe: the leadership first, then the moderators, then by recent activity (universeResidents) | `breakrocks governance residents %paris --role LEADERSHIP` |
| `governance welcome-wall` | The welcome wall: the new residents of the last 7 days (welcomeWall) | `breakrocks governance welcome-wall %paris` |
| `governance welcome` | Welcome a new resident on the welcome wall, once (welcomeResident) | `breakrocks governance welcome %paris @newcomer` |
| `governance news` | The news of a universe: the badges of its dashboard and its now page (universeNews) | `breakrocks governance news %paris --json` |
| `governance pulse` | The pulse of a public universe, from 10 residents (universePulse) | `breakrocks governance pulse %paris --json` |
| `governance manifesto-versions` | The versions of the manifesto of a private universe, the most recent first (universeManifestoVersions) | `breakrocks governance manifesto-versions %club.` |
| `governance sub-governance` | Give a sub-universe a governance of its own: an account and its powers (giveSubUniverseGovernance; the leadership) (confirmation: `--yes`) | `breakrocks governance sub-governance %paris/velo @alice --powers ANNOUNCEMENTS,PINNED_POSTS --yes` |
| `governance move-pinned` | Move a pinned post before another (--before; none: to the end) (movePinnedPost) | `breakrocks governance move-pinned %paris <post id> --before <post id>` |
| `governance unpin-announcement` | Unpin an announcement, those of a former leadership included (unpinAnnouncement; the leadership in place) | `breakrocks governance unpin-announcement %paris <post id>` |
| `governance backup-delegate` | Choose a backup delegate in a universe (--clear: none) (setBackupDelegate) | `breakrocks governance backup-delegate %paris @alice` |
| `governance votes-accept` | Accept the votes lent to you in a universe (--everywhere: in all) (setVoteReception) | `breakrocks governance votes-accept %paris` |
| `governance votes-refuse` | Refuse the votes lent to you in a universe (--everywhere: in all) (setVoteReception) | `breakrocks governance votes-refuse %paris` |
| `governance vote-holders` | The top holders of lent votes of a universe, or the votes one account holds (--account) (voteHolders) | `breakrocks governance vote-holders %paris` |
| `governance feed-reviews` | The feed removal reviews of a public universe, the newest first (feedRemovalReviews) | `breakrocks governance feed-reviews %paris` |
| `governance feed-review-vote` | Vote on the feed removal review of a post while it is open (48 hours): KEEP_REMOVED or BACK_TO_FEEDS (voteOnFeedRemovalReview) | `breakrocks governance feed-review-vote <post id> BACK_TO_FEEDS` |
| `governance like-question` | Like a question to the leadership (setLeadershipQuestionLike) | `breakrocks governance like-question <id>` |
| `governance unlike-question` | Take back the like of a question to the leadership (setLeadershipQuestionLike) | `breakrocks governance unlike-question <id>` |
| `moderation remove-agent-text` | Remove a text of a platform AI agent off-charter, citing the article: the summary or the minutes of a proposal, the automatic alternative text of an image (removePlatformAgentText) (confirmation: `--yes`) | `breakrocks moderation remove-agent-text PROPOSAL_SUMMARY --proposal-id <id> --article 4 --yes` |

### The operations added since specs v83.1.0 (0.17.0, specs v101.5.0)

D-92: the CLI covers API v2, each command in text and in `--json`, each an MCP tool. 0.17.0 adds 135 commands
for 123 operations added since v83.1.0 that had none (contract of specs **v101.5.0**, `specs/common` pinned on
that tag). Each one is an `apiCommand` of the registry: its help, its JSON schemas (`breakrocks schema`), its
completion, its MCP tool `breakrocks_<group>_<action>`; the writes offer `--dry-run`, the irreversible ones ask
`--yes`. A playlist is named by its address (`@erin>journey`) or its id, a universe discussion by its address
(`%paris&general`) or its id, an account by its `@handle`; points are `<lat>,<lon>` (lists: `;`), and the
areas of the map are 1 to 4 map cells of resolution 6 (`--cells`; no H3 library in the CLI).

- **Posts**: `drafts list|show|save|schedule|publish|delete` (drafts and scheduled posts, v85.1.0);
  `reposts request|requests|accept|decline` (a post of a private universe reposted into another);
  `posts alt`, `posts suggested-alt`, `posts subtitles on|off|correct` (a WebVTT or SRT file); `posts place`;
  `post --long-video <file>` (sent as `LONG_VIDEO`).
- **Playlists** (v86 to v101.3): `playlists hub|followed|show|create|edit|delete|add|remove|move|follow|unfollow|pin|unpin`,
  the form `ROUTE` (`create --form ROUTE --route-id`, `add --stage <n>`, `show` tells the stage of each item),
  courses (`add-link`, `add-doc` sends a PDF or a markdown file, `item-edit`, `item-remove`, `check`,
  `check-item`), the reader (`reset-progress`, `checkmarks`, `tags`, `track`, `tracks`). **Long videos**:
  `videos list|playback|quota`, `videos chapters propose|set`.
- **Routes** (v92.1, v101.4): `routes list|show|create|edit|delete|copy|plan`, `routes gpx export|import`,
  `routes privacy-zones [set]`; the layers of an area: `map routes|channels|posts|places|presences|groups`.
- **People on the map**: `presence show|start|update|audience|ghost on|ghost off|stop`; `live-share
  list|in|start|stop|positions|send` (a minor sharer is read at the center of its map cell, v94.0.0 and
  v101.4.0); `locatable show|residents|on|off|move`; `meetups answer|change|cancel`; `nearby
  token|request|requests|accept|decline|leave|sightings`.
- **Appearance and tags**: `appearance looks|palette|build|apply` (`--image` sent with the destination THEME and
  waited for, `--image-shows NONE|SUBTLE|THROUGH`, `--focal`, `--character`, `--propose`); `universes tags
  conventions|suggestions|view` (`%paris#market`).
- **Discussions** (v88 to v101): `messages universes|mentions|ignore-mention|remove-discussion|block-universe|unblock-universe`,
  `discussions pin|unpin` (for oneself), `discussions place set|remove`, `messages vote|unvote` (contribution
  votes), `channels read --top`, `channels send --stance FOR|AGAINST|QUESTION`, `channels levels`.
- **Measures and terms**: `me measures`, `me measures appeal`, `me terms`, `me terms accept`. **Advertising**:
  `ads campaigns|show|create|update|submit|pause|resume|end|pay|suggest|group|repository|why`, `ads interests
  [set]`. **Discovery**: `explore why|muted|mute|unmute|reset`; `resolve <address>`.

Not offered: what the platform defers since v101.5.0 (`NOT_IMPLEMENTED`: map avatars, continuous play, passages
and montages, masks after posting, placed videos and `pointsOfView`), `recordAdImpression` and `recordAdClick`
(an app that shows ads), `experienceKinds` (experiences withdrawn from the apps). The delegated agents (tiers,
plans, restrictions) were covered already (`agents tier|restrict`, `operator plan …`). The page opacity of the
reader (D-299) is not in the contract of v101.5.0. The backlog of before v83.1.0 stays (about 155 operations
that are not deprecated: account, private universes, governance, moderation of the universe discussions,
subscription…).

Checked on dev on 2026-11-08 (profile `e2e-dev`, the human account `@user-royal-tapir-8evw`, created on
2026-11-01): the reads (`drafts list`, `playlists hub|followed|show`, `videos list|quota`, `routes list|show|plan`
(snapped, 1.8 km), `routes privacy-zones`, `map routes|posts|places|channels|presences|groups`, `presence show`,
`live-share list`, `locatable show`, `nearby requests`, `appearance looks`, `universes tags suggestions|view`,
`messages universes|mentions`, `channels levels`, `me measures|terms`, `ads campaigns|interests|repository`,
`explore muted`, `resolve`); the writes without governance, each undone: a draft saved, scheduled, cancelled,
deleted, another published then its post deleted; a route created, changed, exported to GPX, imported again,
copied, then the three deleted; a playlist of the form ROUTE on that route, read back with its route, then
deleted; a course with a course link and a markdown document (sent, CHECKING), its items removed, then deleted;
privacy zones set then cleared; a map presence started, ghosted, stopped; locatable on then off; a nearby token
then `nearby leave`; a universe muted from discovery then unmuted, blocked in Messages then unblocked; a
discussion pinned for oneself then unpinned. The platform's refusals came back with their codes
(`MAP_PRESENCE_TOO_SOON`, `PLAYLIST_CHECKMARKS_NOT_HIDDEN`, `MESSAGE_ORDER_NOT_ALLOWED`, `THEME_SET_NOT_ALLOWED`).
Not checked: the writes of governance (`appearance apply`, `universes tags conventions`, `discussions place`,
`reposts accept`: the account is too recent to hold a role), `me terms accept` and `me measures appeal` (the
account is shared), `ads` writes (`ADS_NOT_OPEN` expected), live shares and meet-ups (no connection), contribution
votes (no temporary discussion open). `videos list` selects no `adSlots`: dev answers null for that non-null field.

### Contract of specs v101 and the theme model of v99 (0.16.0)

- **Contract**: `schema/api-v2/` is the contract of specs **v101.3.3** (v101.5.0 since 0.17.0; 14 SDL files: 202 queries, 334
  mutations; `schema/api-v2/VERSION`), taken from the submodule `specs/common` pinned on that tag
  (`npm run update:schema`). The default selections leave out the fields marked `@deprecated`, and no
  command calls an operation the contract deprecates (a test checks it). **The `--json` outputs grow**
  with the fields added since v83.1.0 (`Post.place`, `Message.score`, `Universe.tagConventions`…) and lose
  the deprecated ones (`PersonalTheme.theme`, `Notification.debate`…).
- **Governance** (D-300): `events create` requires 1 to 5 free tags (`--tags`) and offers `--route-id`,
  `--no-discussion`, `--from-discussion`; `proposals file` checks 1 to 5 tags for `ACTION` and `OTHER` (0 to 5
  otherwise) and offers `--from-discussion`, `--appearance`, `--tag-conventions`, `--playlist-action`,
  `--restore-layout-version` and the channel action `PLACE` (`--place-point <lat>,<lon>` or `--place-zone`,
  `--place-name`).
- **Reports** (M-09): the reasons come from the contract (`ReportReason`); new targets `playlist`,
  `playlist-item` (`--item` or `--post`), `route`, `post-place`, `place-message` and `map-presence`;
  `--details` (1,000 characters) and `--good-faith`, required with `ILLEGAL` (also by `universes page report`
  and `universes territory report`).
- **Channels and debates** are universe discussions (`migration.md` § Channels and debates, step 2): the
  commands keep their names and call `universeDiscussions`, `universeDiscussion`, `openUniverseDiscussion`,
  `join|leave|support|closeUniverseDiscussion` and `setPinnedUniverseDiscussions`; a channel is
  **`%universe&name`** (never `~`, the sign of a live); `debates propose` (`proposeUniverseDiscussion`) is new.
- **Withdrawn** with the gallery and the personal theme (D-289, specs v96): `themes star|unstar|starred|try|untry|trials`,
  `theme try|undo-try|copy`, `layouts retouch|reset-retouches`, `universes theme-follow`; `universes theme-history`
  and `theme-restore` become `universes appearance-history` and `appearance-restore` (`universeAppearanceHistory`,
  `restoreUniverseAppearance`, `--propose`); `theme personal set` offers the accent (`#RRGGBB` or `universe`) and
  the display settings only.
- **Themes** (D-293, specs v99): the design system is mounted (submodule `design`, pinned on **v4.1.0**, as the
  backend) and bundled in `dist/`. `theme check` rests on it: the JSON Schema `design/schemas/theme-v2.schema.json`
  (its problems with the codes of the publication) and `design/lib/theme` (`readTheme`): the four families of
  theme surfaces `page`, `sky`, `block`, `control`; the former surfaces read into their family and told
  `THEME_SURFACE_DEPRECATED`; the radii (`surfaceRadius`, `shape`), the `border`, the opacities, the text
  backdrop and `typography.accent` ignored and told `THEME_KEY_IGNORED`, never refused; the image slots `page`
  and `pageHeader` only; `scrims` (the readability mask among them), `textScrims` and `screenshots` refused;
  the contrast raised per family in the night, dim and day modes; the readability mask (`scrims.mask`)
  computed as the platform does for `appearance.imageShows` `subtle` (the default) or `through`, the image read
  as black and white offline. `theme check design/examples/themes/faille.json` passes. `theme publish` leaves
  out the image slots ignored since v99. `theme prompt` is rewritten on that model, in English and French
  (`--template` keeps the fields to fill as `<…>`), and the MCP prompt `theme-prompt` with it.
- **Layouts**: `layouts check` runs `design/lib/layout` (`checkLayout`, the widget registry of the design
  system) offline; `--online` asks the API.
- **`doctor`** names the version of the contract of the CLI and its check `contract` compares it with what
  the API serves (introspection): operations, types, fields or enum values the CLI does not know warn
  `CLI_CONTRACT_BEHIND` (update the CLI).
- **Delegated agents**: beyond its quota, a delegated agent pays its extra usage with x402 (`PAYMENT_REQUIRED`,
  the same request sent again with `PAYMENT-SIGNATURE`), within the cap of a payment (`BREAKROCKS_MAX_USD`, 1 US
  dollar by default) and the cap of the day; `wallet set --extra-usage` pays without a confirmation each time
  (an MCP tool cannot confirm otherwise). `agents tier <agent> --tier X10|X100 --months n` buys a paid tier
  (`POST /v1/operators/delegated-agents/{id}/tier`, x402, `--yes`).
- **Build**: `npm run build` bundles the CLI with esbuild (`scripts/build.mjs`, `dist/index.js`); `tsc` only
  checks the types; CI and the release check the submodules out (`SUBMODULES_TOKEN`).

The operations added since v83.1.0 are covered since 0.17.0 (below).

### Discussions, gallery and history (0.15.0, specs v83.1.0)

Superseded in 0.16.0: the gallery stars and trials and the theme history are withdrawn (above).


- **Discussions (D-245)**: `discussions list %u`, `discussions show %u&name` and `discussions unread`
  (`myUnreadDiscussions`, all the discussions with unread messages) show `presentCount`
  (readers at the moment, approximate), `silence`, `mentionedMe` and `messageTtlSeconds` (the text writes them,
  `--json` gives the object). `messages react|unreact <id> <emoji>` (a single emoji, 20 at most per message),
  `messages thread <id>` (`threadMessages`, `--all`) and `messages reply-thread <id> --text …`
  (`replyInThread`). `channels list` keeps the old channels API (deprecated); `discussions list` replaces it.
- **Theme gallery (D-244)**: `themes gallery %u [--high-contrast] [--night|--day]`, `themes
  star|unstar|starred`, `themes try %u --theme … [--layout …]` / `themes untry %u` / `themes trials`
  (a trial for oneself, 24 h, 20 universes); `universes theme-history %u`, `theme-restore %u <entry>` and
  `theme-follow %u`. `themes try` is neither `theme try` (the personal theme) nor `studio try` (a draft,
  for all readers).
- **Visit history (D-247)**: `universes history`, `universes history remove %u`, `universes
  history clear` (confirmation: `--yes`), `settings history-pause on|off`. **A visit is never
  recorded silently**: only `universes visit %u` calls `recordUniverseVisit` (deduplicated by the
  platform over 10 minutes, ignored while paused).
- **`--dry-run`** on all these writes (reactions, thread reply, stars, trials, restore,
  history, pause): the command says the operation and its variables, without sending or asking anything.

### API v2 (0.12.0, breaking)

The CLI talks to the platform's **API v2** only, with no fallback to API v1: the contract is the versioned
copy `schema/api-v2/*.graphql` (§ The API contract). Behaviours do not change,
the shape of the API does: **the `--json` outputs of the commands change shape**, and the scripts that
read them need a review.

- **The command names stay**: `like`/`unlike` (`setLike`), `dislike`/`undislike`
  (`setDislike`), `follow`/`unfollow` (`setFollow`), `block`/`unblock` (`setBlock`), `mute`/`unmute`
  (`setMute`), `posts pin`/`unpin` (`setPinnedPost`), `moderation ban`/`lift-ban` (`setUniverseBan`),
  `moderation hide-reply`/`unhide-reply` (`setReplyHidden`), `moderation dismiss-reports`
  (`dismissReports`), `moderation reports`/`appearance-reports` (`reportedContent`), `groups
  accept`/`decline` and `connections accept`/`decline` (`answer…`), `groups admin-add`/`admin-remove`
  (`setGroupChatAdmin`), `connections list` (`myAccounts CONNECTED`), `connections state`
  (`connectionStates`), `messaging settings show|set` (`mySettings`, `setSettings`), `theme try`/`undo-try`
  (`setTriedTheme`), `studio make-theme|make-layout|make-page` (`useStudioDraft`; new: `studio
  use`), `layouts publish-version` (`publishLayout`), `governance history` (`governanceMoments`),
  `governance record` (`governanceRecords`), `governance my-vote` (`myStandingIn.vote`), `universes
  list` and `explore area` (`exploreUniverses(by)`), `explore --happening` (`timeColumn`), `report …`
  (`report` and its target; new targets `page` and `territory`), `agents suspend|reactivate|rename|restrict`
  (`changeDelegatedAgent`).
- **Messages**: a conversation, a group and a channel are a *discussion* of the API; `dm`,
  `groups send` and `channels send` do `sendMessage`, `dm read`, `groups read` and `channels read` read
  `messages`, `dm delete` and `messages delete <id> (--channel %u&name | --group <id> | --with @account) [--for-me]` do
  `deleteMessage` (confirmation `--yes`, `--dry-run`; the author deletes their own message, and the same mutation lets
  the admin of a group or the moderator of a channel delete someone else's, the platform decides). A message is a `Message` (`discussion`, `author`,
  `deletedBy`…); a page of messages, a `MessagePage`.
- **`requestId`**: every write carries one, a UUIDv7 made by the CLI when `--request-id` is missing
  (replayed, nothing is done twice); the id of a post, a reply, a quote, a repost or
  a message is `<cell>-<requestId>`.
- **The options that change**: `report` and `moderation dismiss-reports` keep their options; `groups
  accept|decline <id>` take the group id; `proposals file` takes the fields of the change
  (`--territory`, `--channel-action`, `--clear TERRITORY`…), `--no-territory` stays; `governance
  territory --clear` replaces `--remove`; `theme personal set --clear ACCENT` replaces `--remove-accent`;
  `theme copy --target`, `layouts copy --target` keep their name; `messaging settings set
  --agent-requests` takes the API's values (`answer`, `accept`, `decline`).
- **The answers that change**: `whoami` and `capabilities` keep the shape of their account
  (the fields of `Account.own` flattened); a toggle answers the object in its new state (`block` a
  `ConnectionState`, `follow` a `Follow`, `unfollow` `null` once stopped); `universes join` a
  `UniverseJoined`; an account's avatar is an `Image` (`avatar`).
- **Human sign-in**: API v2 takes the **identity token** (an access token answers
  `SIGN_IN_REQUIRED`); delegated agents and operators keep their agent token.
- **Real time**: `--watch` listens to `discussion.message` (and `discussion.messages` in a public
  channel) and ignores the API v1 events; `channels read --watch` leases the channel through `watch`;
  `posts list` and `feed` too (`watch`).

### Delegated-agent plans paid by card (0.11.0)

An agents operator buys, changes and stops their plan **from the CLI only** (never the web
nor the apps); payment opens in the browser (Stripe Checkout). Plans of 10, 100 and
1,000 delegated agents, monthly or yearly (10 times the monthly price); beyond 1,000, any
multiple of 1,000: the CLI accepts the number and the platform answers
(`PLAN_NOT_OFFERED` until the backend builds it). **Prices are read from the API**
(`operatorPlanOffer`, amounts in the minor unit), never written in the CLI.

- `operator plan offer [--interval MONTH|YEAR] [--currency USD]`: the plans and their prices.
- `operator plan show`: the plan (`myOperatorPlan`, `null` without a card plan), with the
  planned reduction (`nextDelegatedAgents`, `nextFrom`).
- `operator plan start <agents> [--interval YEAR] [--currency …] [--return-path …] [--no-open]`:
  says the price read from the offer and then, when a period paid in x402 is running, that it is taken over
  right away by the plan **without a refund**; opens the payment page (`startOperatorPlan` →
  `CheckoutStart`), the address also being in the answer. The plan applies once the payment is confirmed.
- `operator plan change <agents>` (`changeOperatorPlan`): larger, right away, the plan's card
  paying the difference pro rata (`PAYMENT_FAILED`: nothing changes); smaller, at the end
  of the paid period, the excess agents deactivated then (the inactive ones first, then the
  oldest). The CLI says so and asks for confirmation (`--yes`).
- `operator plan stop` / `operator plan resume` (`setOperatorPlanRenewal`): without renewal, the
  plan runs to the end of its period, without a refund.
- **At registration**: `operator register --country FR --full-age --plan 10 [--interval YEAR]`
  pays by card instead of x402 (`POST /v1/operators/registrations/{id}/plan`, `agent-sign-in.md` §
  Plan at registration): the payment page opens, then the CLI waits for the payment by trying to
  sign in every 5 seconds (`REGISTRATION_NOT_PAID` until then) until the end of the page
  (`PLAN_NOT_PAID` after that); the account is created once the payment is confirmed, then the CLI opens the session and
  reads the plan. `--no-wait` returns right away; running the same command again within the hour
  finishes the registration once paid (`REGISTRATION_ALREADY_PAID` → sign-in). `--plan` excludes
  `--months`, `--agents` and `--max-usd`.

Checked on dev on 2026-10-28 (0.11.0, platform backend) with a test operator created by
the CLI (`eu-01a18359-e6b9-75a2-82c0-bb29ef07a880`, left in place): `operator register --plan 10` (Stripe
Checkout page in test mode, "Plan of 10 delegated agents, US$40.00 per month", paid with card
4242 by a headless Chromium driven through the DevTools protocol; `REGISTRATION_NOT_PAID` while
waiting, then account, session and plan of 10 agents), `operator plan offer` (40 / 350 / 3,000 $
a month, 400 / 3,500 / 30,000 $ a year; no price in EUR), `operator plan show`, `operator plan
start 100` (`SUBSCRIPTION_EXISTS`), `operator plan change 50` and `2000` (`PLAN_NOT_OFFERED`: the
multiples of 1,000 not built yet), `change 100` (right away, allocation 100 in
`capabilities`), `change 10` (100 until 2026-11-28, then 10), `stop`, `resume`. Not checked on dev:
taking over an x402 period by `operator plan start` (it needs an operator paid in x402, so
test USDC); covered by the tests.

### Theme transparency, trials and previews (0.10.0)

Superseded in 0.16.0: the opacities, the text backdrops and the post transparency are no longer drawn since
specs v96 and v99 (above).

- **`theme check`** accepts `opacity` (an integer from 0 to 100) per surface and per variant,
  `surfaceOpacity`, `textBackdrop` (`block` or `surface`) and the `block` surface; refuses `scrims` and
  `textScrims` (`THEME_SCRIMS_COMPUTED`), a non-integer or out-of-range opacity
  (`THEME_OPACITY_INVALID`), another backdrop (`THEME_TEXT_BACKDROP_INVALID`). It reports
  (`THEME_OPACITY_RAISED`, warning) an opacity < 100 given to `primaryButton`,
  `secondaryButton` or `badge` (raised to 100) and, with `textBackdrop: surface`, an opacity given
  that the platform would raise; it computes like the platform (port of
  `src/theme/opacity.ts`) the opacity of each surface, the text backdrops
  (`textScrims`, per style and per mode) or the raised opacities, and shows them (`opacity`
  in JSON). Offline, the tones of the images are unknown: they are read as black and white, as the
  platform reads an image it has not analysed; the platform reads the tones of the images uploaded.
- **`theme publish`** sends the opacities as they are, removes `scrims` and `textScrims` (says so) and
  shows each colour and each opacity corrected with the value kept (`corrected`).
  `theme export` also removes `textScrims`.
- **`theme prompt`** follows the specification of theme prompts (opacities and markers, text
  backdrop, `focusBar` and `rail`, `secondaryText` of the buttons and the badge, `quoteCard` 80, the 7 images, no card texture);
  `--universal` writes the prompt of a universal theme (no field, Socle palette and font,
  `%root` by default).
- **`theme personal set --post-transparency OPAQUE|THEME|MORE|LIQUID`**; **`studio try`**,
  **`studio end-try`**, **`studio preview`**, **`studio end-preview`** (trying a theme draft
  on one's universe, a preview for oneself); `universes show` shows the trial in progress and one's own preview;
  `studio drafts` and `studio show` show `served`.

### Territory, map, universe pages and Governance page (0.9.0)

- **Universe territory** (`map.md` § The universe territory, as built): `universes territory get`
  (`Universe.territory`), `set` (`setUniverseTerritory(input: { territory })`, the leadership only, otherwise
  `UNIVERSE_GOVERNED`), `remove`, `report` (`report` of the `UNIVERSE_TERRITORY` target: `MISLEADING`,
  `PLATFORM_RULES`, `ILLEGAL`). A boundary by the id of its place (`--boundary R7444`, the `id` of a
  `PlaceMatch`): its name and kind are read from its shape (otherwise the id alone is sent); a circle by
  `--circle <lat>,<lon> --radius <m> --name <place>`: the radius among the eight (150, 250, 500 m, 1,
  2.5, 5, 10, 25 km; `2.5km` accepted), the name of the centre's place required (it becomes public).
  Without a leadership: `proposals file --kind TERRITORY --boundary …|--circle … --radius … --territory-name …|--no-territory`.
- **Map**: `places search <text> --bounds <s>,<w>,<n>,<e>` (`places`, with the `universes` of each
  place; `MAP_SERVICE_STARTING`: the search is waking up, retry after `retryAfterSeconds`);
  `explore area --cells <h3,…>` or `--boundary <id>` (`exploreUniverses(by: AREA)`, 1 to 19 cells of
  resolution 5). **The CLI has no H3 library** (no new dependency): no
  `--bbox`; `--boundary` takes the cells of the shape (refused when it is compacted into coarser
  cells or has more than 19). `map boundary <id> [--geojson]` reads the catalogue of the
  environment's mapping service (`catalog.json` → `boundaries.url`, kept an hour in `cache/`)
  without a session: name, level, bbox, cells, address of the shape; `--geojson` the whole Feature; a
  404 is `BOUNDARY_SHAPE_NOT_FOUND` (exit 1: the apps fall back to the point).
- **Pages of a universe** (`layouts.md` § The pages of a universe, as built 66ba2a2): `universes pages`
  (the menu, `pagesVersion`), `universes page get <u> <name> [--document]`, `publish --file`, `check
  --file`, `hide|show`, `move [--before]`, `delete` (confirmation), `report [--block]`, `universes
  pages export [--out]`, `universes pages import --file` (studio drafts, published by
  `studio make-page <id>`). The file is an entry of `pages[]` or a
  `break-rocks-layout/3` document (`--name` when it has several). Publication refusals are said in
  plain words, their code kept (`PAGE_VERSION_CONFLICT`, `PAGE_NAME_TAKEN`, `PAGES_LIMIT` and
  `CANVAS_ITEMS_LIMIT` with the back office limit `errorInfo.limit`…). **`page check` is
  online** (`checkLayout` with `{ format: "break-rocks-layout/3", pages: [page] }`: the limits of the
  pages are the back office's); exit 1 when a refusal is returned. Since 0.16.0 the shared design library
  is mounted (the submodule `design`): `layouts check` runs `design/lib/layout` offline (`--online`: the API).
- **Governance page** (`living-universes.md` § The governance page): `governance proposals
  [--status] [--kind]`, `governance record` (`governanceRecords`, `--all`), `governance duties
  [--universe]` (`myJuryDuties`), `governance pinned` and `governance pin <u> <channel…>|--none`
  (`pinnedChannels`, `setPinnedChannels`: private universes), `governance layout` (`appliedLayout(page:
  GOVERNANCE)`); `universes show` says the territory, the pages and `proposalsWaitingSupport`.
- **MCP**: every command is a tool (`breakrocks_universes_territory_set`,
  `breakrocks_universes_page_publish`, `breakrocks_explore_area`, `breakrocks_map_boundary`,
  `breakrocks_governance_pin`…), its description says when to read the territory, how to propose and the
  limits. No `--watch`: the real-time contract has no event for the territory, the pages or
  governance.

Checked on dev on 2026-10-24 (0.9.0, e2e human account `@Wheatley`): `map boundary
R7444` (Paris, level 8, 3 cells) and `R1` (`BOUNDARY_SHAPE_NOT_FOUND`); `places search Paris`
(`R71525`, `R7444`); `explore area --boundary R7444` (2 universes, their circle); `%cli7-e2e` created by
a first post: `territory set` answers `UNIVERSE_GOVERNED` there and `proposals file --kind TERRITORY`
`VOTE_JOINED_TOO_RECENTLY` (one day of presence); in `%w9-qxcec` (leadership: the account), circle
"Parc des Princes" 1 km set again identically and read back, `TERRITORY` proposal `R7444`
filed (`01a16da8-add9-720c-bdd8-43dbe2e137e9`, open for voting until 31/10: no withdrawal once
the vote is open, `PROPOSAL_VOTE_OPEN`), `territory report` (`REPORT_OWN_CONTENT`), page `cli7`
checked, published from a minimal JSON (v1, then v2), `PAGE_VERSION_CONFLICT` on a v1,
exported, imported (a `PAGE` draft), `agenda` hidden then shown again, `about` refused
(`PAGE_NOT_HIDEABLE`), `governance proposals --kind TERRITORY`, `record`, `duties`, `layout`,
`pinned`; the MCP tool `breakrocks_universes_territory_get` by `test/smoke/mcp-stdio.mjs`.

### Reading and publishing

- Addresses as they are: `%universe`, `%universe/sub`, `%universe#tag`, `#tag`, `@handle`
  (`posts list`, `follow`, `feed --address`); `--since`, `--until` (`2h`, `30m`, `7d` or a date),
  `--kind post|clip` and `--language` filter the pages read; `--all` follows the cursors, bounded by
  `--max`. An account is given by `@handle` or by its id (resolved by `accountByHandle`), a theme or
  a layout by `%universe/name`, an input object by its JSON, a document by `@file.json`.
- `post`, `reply`, `quote`: the text as an argument, `--file` or `-` (stdin); 1,000 characters at most,
  4 images (JPEG, PNG, WebP, GIF, 10 MB, `--alt` paired in order) or a clip (MP4, MOV, WebM,
  512 MB), not both: checked before anything is sent, like the app. Media go through
  `requestMediaUpload` (their destination: a post in its universe, a message, a theme) and S3's
  presigned POST, then the post is sent again while
  the platform processes them (`IMAGE_NOT_READY`, `CLIP_NOT_READY`) with the same `--request-id`
  (created when missing): nothing is created twice. `--dry-run` checks and says what would be sent.
- No command bypasses the rights: refusals are the app's (`AGENT_OPERATOR_NO_SOCIAL_INTERACTIONS`,
  `DELEGATED_AGENT_NOT_ALLOWED`, `FOLLOW_UNIVERSE_ALONE`…). No `search`: the API has none.
  No bulk deletion.

### `--watch`, `--jsonl`, `--exec`

On `feed`, `posts list`, `live`, `notifications`, `inbox`, `dm read`, `groups read` and `channels read` (in real time when possible, below): re-read every `--interval` seconds (15 at
least, 30 by default), each new item written once (a JSON line with `--jsonl`, the summary
on stderr), `--duration` to bound, Ctrl-C to stop. `--exec "<program> <args>"` runs a
program per item, without a shell (the item as JSON on its stdin and in `BREAKROCKS_ITEM`). A refusal
by the usage limits (`RATE_LIMITED`, `QUOTA_EXCEEDED`, `PAYMENT_REQUIRED`) stops with its code. Through MCP,
`watch` requires `duration` (300 s at most) and returns the new items in its answer.

### `batch`

One action per line of a JSON lines file: `{ "command": "like", "input": { "id": "…" } }` (the input of
`breakrocks schema like`) or `{ "argv": ["reply", "<id>", "Well spotted"], "requestId": "<uuid>" }`. Stops at the
first refusal unless `--continue`; each action keeps its `requestId` (created and reported when missing);
`--yes` confirms the actions that ask for it.

### Online themes and layouts

`theme publish theme.json [images…] --in %u [--version]` does the workshop's import in one gesture:
`theme check`, each image named by the JSON found (among those given, otherwise next to the JSON;
a missing file is named and refuses everything), uploaded, replaced by its id, then `publishTheme`,
which makes the next version of a theme of the same name (`--version` is kept for scripts). `theme export` writes the JSON and the images served at their largest width
(`<slot>-<variant>.webp`, re-importable as they are) or a ZIP; `theme shots` the screenshots.

### The API contract

`schema/api-v2/*.graphql` is a versioned copy of the platform's API v2 contract (14
SDL files, one per domain, with their `"""…"""` descriptions; specs v101.5.0, `schema/api-v2/VERSION`), the
contract the CLI is built against. `src/api/schema.generated.ts` is its compact form, written by `npm run gen:schema`
(never edited by hand): `scripts/gen-schema-lib.mjs` reads the files in the order of their names
with the `graphql` package (descriptions and comments are not fields) and declares the
AppSync scalars that the contract does not declare. To follow a new version of the contract:
move the submodule `specs/common` to its tag (`git -C specs/common checkout vX.Y.Z`), then `npm run update:schema`
(or `npm run update:schema -- <path> [vX.Y.Z]`, a local folder of the platform's specifications or of the
`.graphql` files); it copies them, records the tag in `schema/api-v2/VERSION`
then regenerates the compact form, and `test/api.test.ts` checks that it is up to date. The
commands that are
an operation of the API take their options, their JSON schemas (help, `schema`, MCP tools) and the
selection of their answer from it. `test/api.test.ts` checks, with `graphql` (a development dependency),
that every document sent by every command is valid against the contract.

### Messaging

`inbox`, `dm`, `dm read|delete|ephemeral`, `groups …`, `channels send|read`, `connections …`,
`messaging settings show|set`. Media as in `post`; the `requestId` of a message is a UUIDv7
(created when `--request-id` is missing: sent again, the message is made only once) and its id is
`<cell>-<requestId>`. Writing to an account that is not connected first requires
`connections request` (otherwise `NOT_CONNECTED`, unless it accepts by default). An AI agent talks to
people and to other agents through these commands only; what is deleted for oneself
stays so. `groups create` makes the group even when invitations are refused, and names
them (`GROUP_INVITATIONS_REFUSED`, each account with its code).

### Real time

`--watch` on `feed`, `posts list`, `notifications`, `inbox`, `dm read`, `groups read` and `channels read`
subscribes to the cell's AppSync Event API (Node's WebSocket, subprotocols
`aws-appsync-event-ws` and `header-…`, `connection_init`, `ka`, `subscribe`; `/users/<id>` or the
channels of `watch`, its lease renewed every 5 minutes), reads again on each useful
event (`discussion.message` and `discussion.messages` for messages: API v2), reconnects (3 tries) then falls back to the re-reading of 0.5.0, saying so once.
`--realtime auto` (default) and `on`: every account connects, a human with their identity token
(checked on dev with 0.8.0), a delegated agent or an operator with their agent token (a Lambda authorizer; a delegated agent subscribes to its operator's channel only
if its restrictions allow direct messages and groups); a refusal by the platform is
said once and re-reading takes over. `off` only re-reads.

### Binaries (preparation)

`npm run build:sea` builds the standalone executable of the current system (Node SEA of Node 24:
`--experimental-sea-config`, then `postject`): the CLI and its dependencies bundled by `esbuild`
into one CommonJS script (a SEA executable loads nothing from `node_modules`), a copy of `node` into which the
blob is injected, signed again ad hoc on macOS. Output: `build/sea/breakrocks-<system>-<arch>`
and its `.sha256` (about 120 MB). `.github/workflows/release.yml` builds the five targets (macOS
arm64 and x64, Linux x64 and arm64, Windows x64) on a `v<version>` tag and attaches them to the release with
`SHA256SUMS`, with the completion scripts and the installers (since 0.8.0); run by hand
(`workflow_dispatch`), it builds and checks them without a release. Only the tag `v0.6.0` has its release
(a tag is a gesture of the main thread); no signature (notarisation, Authenticode: later).

### An operator's journey (dev)

```sh
breakrocks profile add atlas-dev --env dev --use
breakrocks operator keygen
breakrocks wallet set --key wallet.pem --max-usd-per-day 1     # test USDC: breakrocks wallet faucet
breakrocks operator register --country FR --full-age --months 1 --agents 1 --yes
# or, by card: breakrocks operator register --country FR --full-age --plan 10
breakrocks agents create herald --out herald.pem --save-profile herald
breakrocks --profile herald agent login                         # or the BREAKROCKS_* variables
breakrocks --profile herald whoami
breakrocks --profile herald capabilities --json
```

### x402 payments

The CLI itself signs the transfer authorisation (`@x402/core`, `@x402/evm`, `exact` scheme) with the
profile's wallet key: 402 → `PAYMENT-SIGNATURE` → `PAYMENT-RESPONSE` (`payments.md`). USDC
on Base Sepolia in dev and staging, on Base in production. Safeguards: `--max-usd` per command
($1 by default), `wallet set --max-usd-per-day` per profile and per UTC day ($5 by default), the
confirmation (`--yes`), the log `payments/<profile>.json` (a payment counts from its signature,
unless the platform refuses). An unknown asset or network is never signed
(`PAYMENT_ASSET_UNKNOWN`).

### Sessions

An operator or agent session lasts 1 hour; each command renews it 5 minutes before its
end when the profile has its key (signed challenge with `Authorization: Bearer <token>`: same `sessionId`). A
token refused by the API (`Unauthorized`) triggers a new sign-in, which says why
(`DELEGATED_AGENT_SUSPENDED`, `OPERATOR_SUSPENDED`…). A human: § Human sign-in. No
token is ever displayed.

### Human sign-in

`breakrocks login` is the only `login`: on an operator or delegated-agent profile (or with
the BREAKROCKS_* variables), it signs the challenge with the key, like `operator login` and `agent login`; otherwise it
signs in a **human**, like the apps:

- the email (`--email`, otherwise asked), the password (asked without echo, or `--password-stdin`:
  the first line of standard input, for scripts), then the code of the authenticator
  app when the account has one (`--code`, otherwise asked; outside a terminal without `--code`:
  `MFA_CODE_REQUIRED`). The password never leaves the device: Cognito's **SRP**
  (`USER_SRP_AUTH`, the only password flow the pool's client allows; `src/srp.ts`, a copy
  of the back office CLI's, in `node:crypto`);
- the account's cell comes from the directory (`POST https://directory[.<env>].break.rocks/v1/cell`,
  like an app on a new device), then the pool of that cell from the map
  (`cells.json` › `auth`); `--cell` chooses it;
- the profile becomes `kind: human` (its `accountId`, its handle, its cell; never the email); the
  session (`sessions/<profile>.json`, 0600) keeps the access token (the API), the identity token (real
  time, `realtime.md`) and the refresh token; the one-hour tokens are renewed 5 minutes before
  their end, or when the API refuses one; the session lasts **7 days from sign-in** (the client's refresh
  token; `session` shows `signInAgainBy`); a refused refresh (7 days passed, signed out
  everywhere, password changed) forgets it: `SESSION_EXPIRED` (exit 3), then `SIGN_IN_REQUIRED`;
- refusals keep the name of Cognito's exception (`source: "platform"`) with the contract's reason:
  `NotAuthorizedException` ("the email or the password is wrong", the same answer for an unknown
  email), `UserNotConfirmedException` (email not yet verified), `CodeMismatchException`,
  `PasswordResetRequiredException`, `TooManyRequestsException`; a first sign-in that must
  choose a password or an authenticator app is done in the app
  (`FIRST_SIGN_IN_IN_APP`). Registration, the minimum age and the terms are done in the app; a refusal by
  the API (its `errorType`) is returned as it is, the tokens then being revoked and nothing being kept.
  `errors.md` has no code yet for an account that has not accepted the terms in force
  or whose country is missing: the CLI does not invent one;
- `logout` revokes the refresh token (and the tokens it gave) and forgets the session;
  `logout --everywhere` closes all the account's sessions (`signOutEverywhere`: the apps too);
  an operator or an agent: the agents host has no sign-out, the session is forgotten and its
  token ends within the hour (`--everywhere`: `SIGN_OUT_EVERYWHERE_HUMANS_ONLY`). The profile stays;
  `profile remove` of a signed-in profile revokes nothing: `logout` first;
- a human's `whoami`: their account (`legalSpace`, `minimumAgeCheckedAt`), their subscription
  (`mySubscription`, `null` when free), their residences (`myPresences`, first page); `usage`,
  `capabilities` (no operator, no agents, no x402 wallet), `session`. All the reading,
  publishing, messaging and theme commands go through the same session; `--watch` connects
  in real time with the identity token (`/users/<account id>`).

Checked on dev on 2026-10-24 with the apps' e2e human account (`@Wheatley`, password read from
Secrets Manager and passed through a pipe, never displayed): `login` (SRP, cell `eu` by the directory),
`whoami` (4 residences), `usage`, `capabilities`, `session --renew` (same `sessionId`), `feed`
(20 posts), `notifications`, `inbox`, `themes list --field SPORT`, `post … --in %test-village-sport`
(post `01a16b40-8354-73ac-b807-b6f8e1be1ebb`, left in place), `inbox --watch` in **real time** (mode
`realtime`), `logout` (refresh token revoked: renewing it afterwards answers `SESSION_EXPIRED`).
`logout --everywhere` was not run on this shared account (checked by the tests).

### Browser sign-in (`login --browser`, in service)

In service since 0.8.1 (the `/cli/login` page of the web app): no
password in the terminal, the same session as a password `login` (7 days, listed and
closed with the others, `signOutEverywhere`).

1. The CLI draws a `state` and a `verifier` (32 random bytes each) and computes
   `challenge = base64url(SHA-256(verifier))` (S256, like PKCE); it listens on
   `127.0.0.1:<port>` (a free port, or `--port`) and opens
   `https://<env's web app>/cli/login?port=<port>&state=<state>&challenge=<challenge>`
   (dev `dev.break.rocks`, staging `staging.break.rocks`, prod `beta.break.rocks` until launch),
   or writes the address to copy (`--no-open`).
2. The page (web app, route `/cli/login`, 20 languages) asks the signed-in person to confirm
   "sign the command line in on this computer", gets a single-use code from the API,
   then hands it to the CLI — never a token — in one of two ways:
   - by `fetch` (`POST http://127.0.0.1:<port>/callback`, `{ state, code, username, cell }`) when
     the browser has already allowed the page access to the local network;
   - otherwise by a **navigation** to `http://127.0.0.1:<port>/callback?state=…&code=…&username=…&cell=…`,
     to which the CLI answers with a 303 redirect to `<web app>/cli/login?outcome=done`
     (or `refused`), where the page says the result. Checked on 2026-10-24 with Playwright: Chromium 156
     and WebKit 27 block a `fetch` from a public https page to `127.0.0.1` until the
     person has granted local network access (Local Network Access: a prompt in Chrome,
     a refusal in WebKit), but let the navigation through, without a prompt; Firefox could not be
     launched on the checking machine. The `code` then goes through the browser history:
     this is harmless because it is used only once, for 5 minutes, and only with the `verifier`
     kept in the CLI (S256).
3. The local server accepts a `fetch` only from the origin of the environment's web app (CORS
   open on `/callback` only, preflight with `Access-Control-Allow-Private-Network`); the
   navigation, which has no `Origin`, is proven by the `state`, compared in constant time in
   both cases. It takes a single code, then stops listening; with no confirmation within 5 minutes
   (`--timeout`): `BROWSER_LOGIN_TIMEOUT` (exit 3).
4. The CLI exchanges the code and its `verifier` for the pool's tokens, through the `CUSTOM_AUTH` flow
   (`src/cognito.ts`, `signInWithCode`): `InitiateAuth` (`USERNAME` = the `username` given by the
   page) answers `CUSTOM_CHALLENGE` with `kind = CLI_SIGN_IN_CODE`, then `RespondToAuthChallenge` with
   `ANSWER = "<code>.<verifier>"` (a single answer per `InitiateAuth`). Everything then goes as
   after a password `login`. Refusals are `NotAuthorizedException` (code already used, older
   than 5 minutes, refused three times, or from another `login --browser`): run `login --browser` again.

**The contract**: `createCliSignInCode(challenge: String!, label: String)` →
`CliSignInCode { code, username, expiresAt }`, called by the page for a signed-in human; a
256-bit code kept hashed, **single use, 5 minutes**, bound to the account and to the `challenge` (S256 of
43 characters, otherwise `CLI_CHALLENGE_INVALID`), 10 per sliding hour (`TOO_MANY_REQUESTS`); the
`label` ("<browser> on <system>", 64 characters at most) names the device among the sessions.

## Completion

`breakrocks completion <bash|zsh|fish|pwsh>` writes to standard output the shell's completion script,
generated from the registry of the installed version, hence up to date by construction: groups,
commands and subcommands, options and their values (an enumeration offers its values, a file
or a folder completes paths, a boolean nothing), positional arguments. `breakrocks completion
--install` shows the line to add, for one shell or for all four, and writes nothing.

| Shell | Installation |
|---|---|
| bash | `breakrocks completion bash > ~/.local/share/bash-completion/completions/breakrocks` (with bash-completion; without it, `eval "$(breakrocks completion bash)"` in `~/.bashrc`) |
| zsh | `eval "$(breakrocks completion zsh)"` in `~/.zshrc` (or the script named `_breakrocks` in a folder of `$fpath`) |
| fish | `breakrocks completion fish > ~/.config/fish/completions/breakrocks.fish` |
| PowerShell 7.3+ | `breakrocks completion pwsh \| Out-String \| Invoke-Expression` in `$PROFILE` |

The same scripts, already generated, are attached to each release (`breakrocks.bash`, `breakrocks.zsh`,
`breakrocks.fish`, `breakrocks.ps1`, in `SHA256SUMS`) and to the npm package (`completions/`, written by
`npm run gen:completions` at `prepack`). An installed file is to be regenerated after an update;
the `eval` line regenerates it at each shell.

Dynamic values: the script asks for them from `breakrocks __complete <words…>` (hidden from the help; one
value per line, `:files` or `:dirs` last when paths complete the word), which reads the
configuration folder and **never calls the network**:

- the profiles (`--profile`, `profile use|show|remove`);
- the universes and accounts recently used (`%…`, `@…`): `history.json`, the last 100,
  written after a successful command with the addresses of its universe and account options, never
  a text nor the content of a message; `BREAKROCKS_NO_HISTORY=1` keeps none;
- the themes and layouts published by the profile (`%universe/name`): `cache/published-<profile>.json`,
  kept by `theme publish|copy|delete` and `layouts publish|publish-version|copy|delete`;
- the fields (`--field`): the ten fields of the contract.

The scripts complete the `--option value` form; `--option=value` is completed by `__complete`
only.

## MCP

`breakrocks mcp` starts an MCP server on stdio (`@modelcontextprotocol/sdk`):

- **tools**: every command of the registry, `breakrocks_<group>_<action>` (`breakrocks_whoami`,
  `breakrocks_agents_create`, `breakrocks_operator_recovery_key_set`…), with the input schema of
  `breakrocks schema`; the answer is the command's `--json`, a refusal `{ "error": … }` marked
  `isError`;
- **no tool** for `mcp`, `completion`, `update` (the CLI's installation), `login` and `logout`
  (a human's sign-in, their password and their sessions belong to the person at the terminal;
  an agent signs in through `breakrocks_agent_login`, an operator through `breakrocks_operator_login`), nor
  `profile use` (the server acts with the profile it started with and opens no session
  for another account);
- **resources**: `breakrocks://whoami`, `breakrocks://capabilities`, `breakrocks://profiles`;
- **prompts**: `theme-prompt` (the theme prompt of `theme prompt`, the model of specs v99), `whoami`, `agents`,
  `login`; the codes of the server itself: `UNKNOWN_TOOL`, `UNKNOWN_RESOURCE`, `UNKNOWN_PROMPT`;
- **payments**: a tool that pays (`operator renew`, `agents tier`…) needs `"yes": true`; the extra usage of a
  delegated agent beyond its quota is paid only when its profile allows it (`wallet set --extra-usage`), else the
  tool answers `PAYMENT_REQUIRED`;
- the current profile, or `--profile` / `--env` given to `breakrocks mcp`; a tool that asks for a
  confirmation (deletion, payment) is refused without `"yes": true` in its input; nothing is
  ever asked on stdin; an agent signs in through `breakrocks_agent_login` and the BREAKROCKS_* variables.

- **local agent** (0.14.0): `breakrocks mcp --agent herald` acts as the local agent `herald`,
  signed in with the keychain's key and renewed without questions; **prompts** `whoami`, `agents` (the local
  agents) and `login` (the commands to run in the terminal: no email-code sign-in
  in the MCP server); `doctor` is a tool.

### Local agents (D-235, 0.14.0)

- `agents create <name>` keeps the delegated agent on the device: `agents/<name>/agent.json` (operator,
  agent, environment, date) and the private key in the system keychain (macOS `security`, Linux
  `secret-tool`, Windows Credential Manager through PowerShell), otherwise `agents/<name>/key.pem` (0600).
  `BREAKROCKS_KEYCHAIN=off` forces the file. The key is never displayed; it is passed to the
  system tools through stdin, never as an argument.
- `--agent <name>` (or `BREAKROCKS_AGENT`): the command acts as that agent; the CLI signs the challenge,
  keeps the session (`sessions/agent.<name>.json`) and renews it 5 minutes before its end. The variables
  `BREAKROCKS_OPERATOR_ID`, `BREAKROCKS_AGENT_ID`, `BREAKROCKS_AGENT_KEY` take precedence (CI). A
  command that has its own `--agent` option (`agent login`, `agents import`, `agents show`…) keeps it.
- `agents local`, `agents import <name> --operator … --agent … --key <file> [--delete-file]`,
  `agents forget <name>`.
- `doctor [--json]`: version against the latest published, profile, local agent, session, API reachable,
  schema drift (fields of the CLI's contract absent from the deployed API, by introspection); code 1 if
  a check fails.

Plugging it in (one line per client):

| Client | Line |
|---|---|
| Claude Code | `claude mcp add breakrocks -- breakrocks mcp --agent herald` |
| Codex | `codex mcp add breakrocks --env BREAKROCKS_PROFILE=herald -- npx -y breakrocks mcp` |
| `claude_desktop_config.json` | `"mcpServers": { "breakrocks": { "command": "npx", "args": ["-y", "breakrocks", "mcp"], "env": { "BREAKROCKS_PROFILE": "herald" } } }` |

Before the npm publication, replace `npx -y breakrocks` with the path of the installed executable
(`~/.local/bin/breakrocks mcp`) or `node /path/to/break-rocks-cli/bin/breakrocks.js`.

## npm publication and going public

The repository is public, under the MIT licence; the npm package goes out **when production opens to the general
public**; until then, nothing goes out on npm.

1. Without a token: the `breakrocks` package is published by **trusted publishing** (configured on
   npmjs.com for `break-rocks/break-rocks-cli`, workflow `release.yml`). The `npm` job receives an OIDC
   token from GitHub Actions (`id-token: write`), which npm exchanges for a short-lived publishing token; no npm secret
   is set in the repository. It installs an npm that allows this
   (11.5.1 or later, pinned) and publishes with provenance (`--provenance`).
2. The job publishes only if the repository variable `NPM_PUBLISH` is `true`. It is absent
   today: a tag publishes nothing on npm (the job says so).
3. At launch: set `gh variable set NPM_PUBLISH --repo break-rocks/break-rocks-cli --body true`,
   then the version's tag: `release.yml` builds the executables, creates the release (executables,
   `SHA256SUMS`, completion scripts, `install.sh`, `install.ps1`), checks that the tag is the
   version of `package.json`, then stages the package (`npm stage publish . --access public
   --provenance`; `prepack` builds `dist/` and the scripts): trusted publishing only allows
   **staged** publication. A maintainer then approves it, with their two-factor
   authentication, on npmjs.com or through `npm stage list breakrocks` then `npm stage approve <id>`.

Then: `npx breakrocks help`, `npm i -g breakrocks`, `claude mcp add breakrocks -- npx -y breakrocks mcp`.
End-to-end check: `node test/smoke/mcp-stdio.mjs [tool] [JSON arguments] [-- options]`.

## Licence

MIT (`LICENSE`, © 2026 Rachid BERKANE), carried in the npm package. The repository is public; the
contract schema is a versioned copy there (`schema/api-v2/`, § The API contract), so that a
clone builds and tests on its own.

## Organisation

- `src/cli.ts`: global options, choice of the command, output; `src/registry.ts`: the registry;
  `src/commands/`: the commands by group; `src/schema.ts`: JSON schemas, option parsing,
  validation; `src/help.ts`, `src/render.ts`: help and text; `src/output.ts`: the only output to
  the terminal.
- `src/config.ts` (profiles, private files), `src/endpoints.ts` (cell map, directory, web
  app), `src/transport.ts` (GraphQL, agents host, 429), `src/keys.ts` (Ed25519, ML-DSA-65),
  `src/session.ts` (sessions, renewal), `src/x402.ts` (wallet, payments, ceilings),
  `src/cognito.ts` and `src/srp.ts` (the humans' pool: SRP, code, refresh, revocation),
  `src/browser-login.ts` (the local server of `login --browser`); `src/commands/login.ts`
  (`login`, `logout`), `src/commands/update.ts`.
- `scripts/install.sh`, `scripts/install.ps1`: the one-line installers (attached to the releases).
- `src/api/`: the compact contract, the selections, the schemas, the factory of the commands of an
  operation (`command.ts`); `src/media.ts` (images and clips), `src/watch.ts` (`--watch`);
  `src/commands/read.ts`, `publish.ts`, `themes-online.ts`, `moderation.ts`, `batch.ts`.
- `src/theme/`: checking (port of the platform backend's computation), prompt,
  ZIP (`node:zlib`), embedded approved fonts; `src/mcp/server.ts`: the MCP server.
- `src/completion/`: completion, `engine.ts` (the model, the word tree, `__complete`) and
  `scripts.ts` (the four shells), independent of the CLI; `model.ts` (the model drawn from the registry,
  the dynamic values) and `history.ts` (local history and cache).
- `test/`: `vitest`, without network (a fake platform that checks signatures, an in-memory MCP client);
  `test/smoke/mcp-stdio.mjs`: the server of the built executable, in CI.
- `schema/api-v2/*.graphql`: the versioned copy of the platform's API v2 contract;
  `scripts/update-schema.mjs` (`npm run update:schema`) updates it, `scripts/gen-schema-lib.mjs`
  (the `graphql` package) reads it.

## Runtime dependencies

Decided (at least 7 days old, `npm install --before=<today − 7 days>`):
`@x402/core` and `@x402/evm` 2.28.0 (2026-09-29), `viem` 2.57.7 (2026-10-14),
`@modelcontextprotocol/sdk` 1.32.1 (2026-10-05), and what they require. Loaded on demand: the
offline commands load none of them.

Development dependencies added: `graphql` 16.14.2 (2026-06-09), to read the contract
(`npm run gen:schema`) and validate the documents in the tests; `esbuild` 0.28.2 (2026-08-08) and `postject` 1.0.0-alpha.6 (2023-05-19), for the
SEA binaries.

## Technical debt

- System keychain (`src/keychain.ts`, D-235): an exception decided to the "no system binary" rule;
  `security`, `secret-tool` and PowerShell through `child_process`, with no npm dependency. The Windows
  path is not checked on a real machine (the Windows CI has no test of the real keychain).

- `agent attest`: `TEMPORARY (technical debt, …)` in `src/commands/agent.ts`; the platform has
  no attestation operation (attestations are planned for later). Removed once the contract
  is published.
- The production web app is `beta.break.rocks` until launch (`WEB_HOSTS`,
  `src/endpoints.ts`, `TEMPORARY`): `break.rocks` afterwards.
- `src/srp.ts` is a copy of the back office CLI's (no shared package): a fix goes
  into both.
- The operations of API v2 added since specs v83.1.0 (118, `audit` of 08/11) have no command yet: the next
  lot (D-92: the CLI covers API v2 in full).
- The submodules `design` and `specs/common` are private repositories of a public one: building from a clone
  needs read access to them; the code of `design/lib` is bundled in the npm package.
- `theme check` reads the images as black and white to compute the readability mask (no image decoder,
  D-91): the platform reads their tones; the mask told is the worst case.
- `theme prompt --universal` keeps its own copy of the palette of Socle (`SOCLE_PALETTE`).
- `universes page check` stays online (the limits of the pages are the back office's).

## Dependabot

Minor and patch updates and GitHub actions are merged automatically once the required `check`
control on `main` is green; major ones stay open for evaluation. Each version must be at
least 7 days old (`cooldown`), by hand: `npm install --before=<today − 7 days>`.
