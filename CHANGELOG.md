# Changelog

All notable changes of break-rocks-cli. The format follows [Keep a Changelog](https://keepachangelog.com/);
the contract is break-rocks-specs (`specs/common`: `contracts/agent-sign-in.md`, `contracts/payments.md`,
`contracts/schema.graphql`, `contracts/themes.md`). The scope is decided (D-91, 2026-10-23).

## [0.2.0] - 2026-10-23

### Added

- The registry of the commands: each one declares its name, summary, description, examples, the
  JSON Schemas of its input (options and positionals) and of its output, and its run; the help,
  `--json` and `breakrocks schema <command>` (C-30) derive from it.
- Global options: `--json`, `--quiet`, `--fields`, `--profile`, `--env dev|staging|prod` (default
  `prod`), `--yes`; no color ever (C-33); exit codes 0, 1 (refused, with the code of the contract or
  of the CLI), 2 (usage), 3 (network or session).
- Profiles (C-05): `profile add|use|list|show|remove`, `BREAKROCKS_PROFILE`, the configuration folder
  of the user (`$XDG_CONFIG_HOME/breakrocks`, `~/.config/breakrocks`, `%APPDATA%\breakrocks`), private
  files 0600 on POSIX; the addresses of the API from the cell map, as the apps.
- Transport on `fetch`: GraphQL (the token as is), the agents host (Bearer), a 429 tried again once
  after its Retry-After, a near RATE_LIMITED likewise.
- Offline themes: `theme prompt` (the prompt of THEME-IA-PROMPT.md, in English or French),
  `theme check` (format 2, contrast AA as the platform raises it, at most 8 images of 5 MB, the
  banner 3:1, the wordmark, approved typefaces; a JSON report for hooks, C-23), `theme pack` and
  `theme unpack` (the ZIP of the import of the studio, `node:zlib`), `theme typefaces` (the shipped
  list; `--online` compares it with `approvedTypefaces`).

## [0.1.0] - 2026-10-23

### Added

- The repository: the executable `breakrocks` in TypeScript on Node 24, `help` and `version` (text,
  or JSON with `--json`), lint, types, unit tests and build in CI, Dependabot with a 7-day cooldown,
  the common specs at v48.3.5; the CI runs on Linux, macOS and Windows.
