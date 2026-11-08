// The configuration of the user (README § Profiles and environments): one folder per user, never in the repository
// nor in the working directory. `config.json` holds the profiles (environment, cell, kind of
// account, where its keys are); `sessions/`, `keys/` and `payments/` hold what must stay private,
// each file written for the user alone (0600 on POSIX; on Windows the folder of the profile of the
// user, %APPDATA%, is readable by that user only, by its default ACL). No secret is ever written
// to config.json: a key is a path, a session a file of its own.
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { usageError } from './errors.js';

export const ENVIRONMENTS = ['dev', 'staging', 'prod'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export const isEnvironment = (value: unknown): value is Environment => (ENVIRONMENTS as readonly unknown[]).includes(value);

export type Algorithm = 'Ed25519' | 'ML-DSA-65';
export type ProfileKind = 'operator' | 'agent' | 'human';

/** A profile: an environment, and at most one account: a human (signed in with the user pool of its cell), an agent operator or one of its delegated agents (the agents host). */
export type Profile = {
  env: Environment;
  /** The home cell of the account, once known. */
  cell?: string;
  kind?: ProfileKind;
  /** The account id of a human. */
  accountId?: string;
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
  wallet?: { source: 'file' | 'env'; file?: string; address: string; maxUsdPerDay: number; extraUsage?: boolean };
  /** A local agent (--agent, BREAKROCKS_AGENT): its name; never saved in config.json. */
  localAgent?: string;
};

export type ConfigFile = { version: 1; current?: string; profiles: Record<string, Profile> };

export const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const DEFAULT_PROFILE = 'default';

/**
 * The configuration folder (D-235): BREAKROCKS_CONFIG_DIR or BREAKROCKS_HOME when set; on Windows
 * %APPDATA%\breakrocks; $XDG_CONFIG_HOME/breakrocks when XDG_CONFIG_HOME is set; else ~/.breakrocks.
 */
export function configDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  if (env.BREAKROCKS_CONFIG_DIR) return resolve(env.BREAKROCKS_CONFIG_DIR);
  if (env.BREAKROCKS_HOME) return resolve(env.BREAKROCKS_HOME);
  if (platform === 'win32') return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'breakrocks');
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'breakrocks');
  return join(env.HOME || homedir(), '.breakrocks');
}

/** The folder of the versions up to 0.13 (~/.config/breakrocks), where the default folder is now ~/.breakrocks. */
export const legacyConfigDir = (env: NodeJS.ProcessEnv) => join(env.HOME || homedir(), '.config', 'breakrocks');
export const MIGRATED_NOTE = 'MIGRATED';

/**
 * Copies the folder of the versions up to 0.13 into [dir] once: only for the default folder, when the
 * former one has no MIGRATED note and [dir] has no config.json. A new folder is made aside then renamed
 * (all or nothing); an existing one (news/ alone) receives the entries it lacks. The former folder is
 * kept, with the note. Answers whether it copied.
 */
export function migrateConfig(env: NodeJS.ProcessEnv, dir: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'win32' || env.BREAKROCKS_CONFIG_DIR || env.BREAKROCKS_HOME || env.XDG_CONFIG_HOME) return false;
  const legacy = legacyConfigDir(env);
  if (resolve(legacy) === resolve(dir) || !existsSync(legacy) || existsSync(join(legacy, MIGRATED_NOTE)) || existsSync(join(dir, 'config.json'))) return false;
  try {
    if (!existsSync(dir)) {
      const temporary = `${dir}.${process.pid}.migrating`;
      rmSync(temporary, { recursive: true, force: true });
      cpSync(legacy, temporary, { recursive: true, preserveTimestamps: true });
      renameSync(temporary, dir);
    } else {
      for (const entry of readdirSync(legacy)) if (!existsSync(join(dir, entry))) cpSync(join(legacy, entry), join(dir, entry), { recursive: true, preserveTimestamps: true });
    }
    if (POSIX) chmodSync(dir, 0o700);
    writeFileSync(join(legacy, MIGRATED_NOTE), `Copied to ${dir} on ${new Date().toISOString()} by breakrocks (D-235). This folder is no longer read; delete it when you wish.\n`);
    return true;
  } catch { return false; }
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
    rmSync(this.cacheFile(`published-${name}.json`), { force: true });
  }
  setCurrent(name: string): void { const config = this.read(); config.current = name; this.write(config); }

  sessionFile(profile: string) { return join(this.dir, 'sessions', `${profile}.json`); }
  keysDir(profile: string) { return join(this.dir, 'keys', profile); }
  paymentsFile(profile: string) { return join(this.dir, 'payments', `${profile}.json`); }
  cacheFile(name: string) { return join(this.dir, 'cache', name); }
  agentsDir() { return join(this.dir, 'agents'); }
  agentDir(name: string) { return join(this.dir, 'agents', name); }
}

/** A profile name checked (PROFILE_NAME_INVALID, exit 2). */
export function checkProfileName(name: string): string {
  if (!PROFILE_NAME.test(name)) throw usageError('PROFILE_NAME_INVALID', 'A profile name has 1 to 64 letters, digits, ".", "_" or "-", beginning with a letter or a digit');
  return name;
}
