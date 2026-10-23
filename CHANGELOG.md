# Changelog

All notable changes of break-rocks-cli. The format follows [Keep a Changelog](https://keepachangelog.com/);
the contract is the GraphQL schema of the platform (`schema/schema.graphql`). The scope is decided (2026-10-23).

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
