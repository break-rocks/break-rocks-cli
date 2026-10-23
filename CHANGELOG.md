# Changelog

All notable changes of break-rocks-cli. The format follows [Keep a Changelog](https://keepachangelog.com/);
the contract is the GraphQL schema of the platform (`schema/schema.graphql`).

## Unreleased

### Added

- The repository: the executable `breakrocks` in TypeScript on Node 24 (no runtime dependency),
  `help` and `version` (text, or JSON with `--json`), lint, types, unit tests and build in CI,
  Dependabot with a 7-day cooldown; the CI runs on Linux, macOS and
  Windows (the CLI is portable: README § Systèmes). The scope of the first commands
  is to be decided (README § Scope).
