// What a command runs with: the terminal (or the MCP server), the environment, the network, the
// configuration of the user and the global options. Tests give fakes for each.
import { ConfigStore, DEFAULT_PROFILE, configDir, type Environment, type Profile } from './config.js';
import { CliError, EXIT, usageError } from './errors.js';
import type { Output } from './output.js';
import type { CodeExchange } from './browser-login.js';
import type { Payer } from './payment-types.js';

export type Io = {
  out: Output;
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  cwd: string;
  /** Whether a person can answer a question (stdin and stderr are terminals); never in the MCP server. */
  interactive: boolean;
  ask: (question: string) => Promise<string>;
  /** Asks a secret (a password) without echoing it; absent where nobody can answer. */
  secret?: (question: string) => Promise<string>;
  /** Opens a web address in the browser of the person (login --browser); false when it could not. */
  openUrl?: (url: string) => Promise<boolean>;
  /** How login --browser exchanges the code of the web app for a session (tests give a fake; by default the CUSTOM_AUTH flow of the user pool). */
  codeExchange?: CodeExchange;
  /** The executable that runs (update: tests give a file; by default the single executable, or the npm package). */
  executable?: { path: string; kind: 'binary' | 'npm' | 'source' };
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** The text piped on stdin ("-" as a text or a file); absent in the MCP server, whose stdin is the protocol. */
  readStdin?: () => Promise<string>;
  /** The WebSocket of the real-time updates (tests give a fake; by default the WebSocket of Node). */
  WebSocket?: typeof globalThis.WebSocket;
  /** --watch gives back the new items in its answer instead of writing them (the MCP server). */
  collectWatch?: boolean;
  /** The x402 payer (tests give a fake; by default the wallet of the profile signs with @x402/evm). */
  payer?: Payer;
};

export type GlobalFlags = {
  json: boolean; quiet: boolean; fields?: string[]; profile?: string; env?: Environment; yes: boolean; help: boolean; version: boolean;
};
export const NO_FLAGS: GlobalFlags = { json: false, quiet: false, yes: false, help: false, version: false };

export class Context {
  readonly io: Io;
  readonly flags: GlobalFlags;
  readonly store: ConfigStore;
  readonly profileName: string;
  constructor(io: Io, flags: GlobalFlags) {
    this.io = io;
    this.flags = flags;
    this.store = new ConfigStore(configDir(io.env));
    this.profileName = flags.profile ?? io.env.BREAKROCKS_PROFILE ?? this.store.read().current ?? DEFAULT_PROFILE;
  }
  get env() { return this.io.env; }
  get out() { return this.io.out; }
  now() { return this.io.now(); }

  /** The profile in use: the one saved, else a new one in production (or the environment of --env). */
  profile(): Profile {
    const saved = this.store.profile(this.profileName);
    const wanted = this.flags.env;
    if (!saved) return { env: wanted ?? 'prod' };
    if (wanted && wanted !== saved.env) {
      if (saved.kind) {
        throw usageError('ENV_MISMATCH', `The profile "${this.profileName}" holds an account of ${saved.env}: use another profile for ${wanted} (breakrocks profile add <name> --env ${wanted})`, { profile: this.profileName, env: saved.env });
      }
      return { ...saved, env: wanted };
    }
    return saved;
  }
  saveProfile(profile: Profile): void { this.store.saveProfile(this.profileName, profile); }

  /** Writes a notice to stderr that a script should see too (with --json; never with --quiet). */
  notice(text: string): void { if (!this.flags.quiet) this.io.out.error(text); }

  /** Writes a line of progress to stderr (never with --quiet or --json, never on stdout). */
  progress(text: string): void { if (!this.flags.quiet && !this.flags.json) this.io.out.error(text); }

  /**
   * Asks a person to confirm [question] (an irreversible action, a payment): done with --yes (or
   * "yes": true from an MCP client), asked when a person can answer, else refused with
   * CONFIRMATION_REQUIRED (exit 2): a script or an agent passes --yes.
   */
  async confirm(question: string, details: Record<string, unknown> = {}): Promise<void> {
    if (this.flags.yes) return;
    if (!this.io.interactive) throw usageError('CONFIRMATION_REQUIRED', `${question} Pass --yes to confirm.`, { question, ...details });
    const answer = (await this.io.ask(`${question} [y/N] `)).trim();
    if (!/^(y|yes|o|oui)$/i.test(answer)) throw new CliError('CANCELLED', 'Cancelled: nothing was done.', EXIT.REFUSED);
  }
}
