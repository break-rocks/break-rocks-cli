// The configuration of the user (README § Profils): one folder per user, never in the repository
// nor in the working directory. `config.json` holds the profiles (environment, cell, kind of
// account, where its keys are); `sessions/`, `keys/` and `payments/` hold what must stay private,
// each file written for the user alone (0600 on POSIX; on Windows the folder of the profile of the
// user, %APPDATA%, is readable by that user only, by its default ACL). No secret is ever written
// to config.json: a key is a path, a session a file of its own.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { usageError } from './errors.js';

export const ENVIRONMENTS = ['dev', 'staging', 'prod'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export const isEnvironment = (value: unknown): value is Environment => (ENVIRONMENTS as readonly unknown[]).includes(value);

export type Algorithm = 'Ed25519' | 'ML-DSA-65';
export type ProfileKind = 'operator' | 'agent';

/** A profile: an environment, and at most one account of the agents host (an agent operator, or one of its delegated agents). */
export type Profile = {
  env: Environment;
  /** The home cell of the account (contracts/cells.md), once known. */
  cell?: string;
  kind?: ProfileKind;
  operatorId?: string;
  agentId?: string;
  handle?: string;
  /** Paths of the private keys (PEM, PKCS #8): never their content. */
  keys?: { operator?: string; recovery?: string; agent?: string };
  algorithm?: Algorithm;
  recoveryAlgorithm?: Algorithm;
  /** A registration signed and not paid yet: its id (the future account id) and when it is abandoned. */
  registration?: { id: string; expiresAt: string; country: string };
  /** The x402 wallet: a key file of the configuration folder, or the variable BREAKROCKS_WALLET_KEY. */
  wallet?: { source: 'file' | 'env'; file?: string; address: string; maxUsdPerDay: number };
};

export type ConfigFile = { version: 1; current?: string; profiles: Record<string, Profile> };

export const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const DEFAULT_PROFILE = 'default';

/**
 * The configuration folder: BREAKROCKS_CONFIG_DIR when set; on Windows %APPDATA%\breakrocks; elsewhere
 * $XDG_CONFIG_HOME/breakrocks, else ~/.config/breakrocks.
 */
export function configDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  if (env.BREAKROCKS_CONFIG_DIR) return resolve(env.BREAKROCKS_CONFIG_DIR);
  if (platform === 'win32') return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'breakrocks');
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'breakrocks');
}

const POSIX = process.platform !== 'win32';

/** Writes [data] to [path] for the user alone: the folders 0700 and the file 0600 on POSIX, through a temporary file renamed (never half written). */
export function writePrivate(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, data, { mode: 0o600 });
  if (POSIX) chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

/** Whether a private file is readable by others than the user (POSIX only; always false on Windows, where the ACL decide). */
export function exposedFile(path: string): boolean {
  if (!POSIX) return false;
  try { return (statSync(path).mode & 0o077) !== 0; } catch { return false; }
}

export function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return undefined; }
}

/** The configuration of a folder: its profiles, its sessions, its keys, its payments. */
export class ConfigStore {
  readonly dir: string;
  constructor(dir: string) { this.dir = dir; }

  get file() { return join(this.dir, 'config.json'); }
  read(): ConfigFile {
    const file = readJson<ConfigFile>(this.file);
    return file && typeof file === 'object' && file.profiles ? file : { version: 1, profiles: {} };
  }
  write(config: ConfigFile): void { writePrivate(this.file, `${JSON.stringify(config, null, 2)}\n`); }

  profile(name: string): Profile | undefined { return this.read().profiles[name]; }
  saveProfile(name: string, profile: Profile): void {
    const config = this.read();
    config.profiles[name] = profile;
    if (!config.current) config.current = name;
    this.write(config);
  }
  removeProfile(name: string): void {
    const config = this.read();
    delete config.profiles[name];
    if (config.current === name) delete config.current;
    this.write(config);
    rmSync(this.sessionFile(name), { force: true });
  }
  setCurrent(name: string): void { const config = this.read(); config.current = name; this.write(config); }

  sessionFile(profile: string) { return join(this.dir, 'sessions', `${profile}.json`); }
  keysDir(profile: string) { return join(this.dir, 'keys', profile); }
  paymentsFile(profile: string) { return join(this.dir, 'payments', `${profile}.json`); }
  cacheFile(name: string) { return join(this.dir, 'cache', name); }
}

/** A profile name checked (PROFILE_NAME_INVALID, exit 2). */
export function checkProfileName(name: string): string {
  if (!PROFILE_NAME.test(name)) throw usageError('PROFILE_NAME_INVALID', 'A profile name has 1 to 64 letters, digits, ".", "_" or "-", beginning with a letter or a digit');
  return name;
}
