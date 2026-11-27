// The session of a person on the new backend (Q-6 of the client port plan): no device key in Node, so the session is
// untrusted (24 hours idle, 7 days at most: sign in again then) or, signed in by a device code, fixed 7 days and content
// only. Its two tokens are secrets: kept in the system keychain when there is one (account `sulfur:<profile>`), else in a
// file of the configuration folder for the user alone (0600); what is not secret (the account, the cell, the dates) in
// `sessions/<profile>.sulfur.json` either way. Never printed.
// The refresh token rotates at each renewal and a token presented twice ends the session (server: refresh reuse): so the
// renewal is single-flight, within the process (one promise per profile) and across processes (a lock file created
// exclusively; whoever waited reads the renewed tokens instead of renewing again).
import { closeSync, existsSync, mkdirSync, openSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { Context } from '../context.js';
import { configDir, readJson, writePrivate } from '../config.js';
import { systemKeychain } from '../keychain.js';
import { CliError, EXIT, networkError, usageError } from '../errors.js';
import { expectAuthOk, isTokenRefused, sulfurBase, sulfurGraphql, sulfurPost } from './http.js';

export const CLIENT_ID = 'cli';
/** An access token is renewed when it ends within this. */
export const RENEW_BEFORE_MS = 60_000;
/** A lock older than this was left by a process that died. */
export const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 15_000;
const LOCK_STEP_MS = 100;

export type SessionKind = 'untrusted' | 'device' | 'cli' | 'trusted' | string;

/** What is kept of a session, the secrets apart. */
export type SulfurMeta = {
  backend: 'sulfur';
  env: string;
  cell: string;
  accountId: string;
  handle?: string;
  /** The session kind the token endpoint gave (untrusted: e-mail code; device: device code). */
  kind: SessionKind;
  /** How it was signed in: email, device, browser, or agent (RFC 7523: renewed by a new assertion, no refresh token). */
  method: 'email' | 'device' | 'browser' | 'agent';
  /** An agent's session: the id that signed it in (the delegated agent, or the operator itself), compared with the credentials of each run. */
  agentId?: string;
  signedInAt: string;
  /** When the access token ends. */
  accessExpiresAt: string;
  /** Where the secrets are. */
  storage: 'keychain' | 'file';
  /** The secrets, only when storage is "file". */
  secrets?: SulfurSecrets;
};
export type SulfurSecrets = { access: string; refresh?: string };
export type SulfurSession = Omit<SulfurMeta, 'secrets'> & SulfurSecrets;

const metaFile = (ctx: Context) => join(ctx.store.dir, 'sessions', `${ctx.profileName}.sulfur.json`);
const lockFile = (ctx: Context) => join(ctx.store.dir, 'sessions', `${ctx.profileName}.sulfur.lock`);
/**
 * The keychain entry of the profile's tokens: `sulfur:<profile>` for the default configuration folder, followed by a hash
 * of the folder for any other (BREAKROCKS_CONFIG_DIR, BREAKROCKS_CLI_DIR: personas side by side never share an entry).
 */
const keychainAccount = (ctx: Context) => {
  const dir = resolve(ctx.store.dir);
  return dir === resolve(configDir({ HOME: ctx.env.HOME, APPDATA: ctx.env.APPDATA, XDG_CONFIG_HOME: ctx.env.XDG_CONFIG_HOME })) ? `sulfur:${ctx.profileName}` : `sulfur:${ctx.profileName}@${createHash('sha256').update(dir).digest('hex').slice(0, 12)}`;
};
const keychainOf = (ctx: Context) => ctx.io.keychain ?? systemKeychain(ctx.env);

/** The session of the profile on the new backend, or none. */
export function readSulfurSession(ctx: Context): SulfurSession | undefined {
  const meta = readJson<SulfurMeta>(metaFile(ctx));
  if (!meta || meta.backend !== 'sulfur' || !meta.accountId) return undefined;
  let secrets: SulfurSecrets | undefined = meta.secrets;
  if (meta.storage === 'keychain') {
    const raw = keychainOf(ctx).get(keychainAccount(ctx));
    try { secrets = raw ? JSON.parse(raw) as SulfurSecrets : undefined; } catch { secrets = undefined; }
  }
  if (!secrets?.access) return undefined;
  const { secrets: _s, ...rest } = meta;
  return { ...rest, ...secrets };
}

/** Saves [session]: its secrets in the keychain when one takes them, else in its private file. */
export function saveSulfurSession(ctx: Context, session: SulfurSession): SulfurSession {
  const { access, refresh, ...meta } = session;
  const secrets: SulfurSecrets = { access, ...(refresh ? { refresh } : {}) };
  const keychain = keychainOf(ctx);
  const inKeychain = keychain.available() && keychain.set(keychainAccount(ctx), JSON.stringify(secrets));
  const saved: SulfurMeta = { ...meta, storage: inKeychain ? 'keychain' : 'file', ...(inKeychain ? {} : { secrets }) };
  writePrivate(metaFile(ctx), `${JSON.stringify(saved, null, 2)}\n`);
  return { ...meta, storage: saved.storage, ...secrets };
}

/** Forgets the session on this device (its file and its keychain entry). */
export function forgetSulfurSession(ctx: Context): void {
  const meta = readJson<SulfurMeta>(metaFile(ctx));
  if (meta?.storage === 'keychain') keychainOf(ctx).delete(keychainAccount(ctx));
  rmSync(metaFile(ctx), { force: true });
}

/** A session from a token endpoint answer ([previous]: a renewal, its account and dates kept). */
export function sessionFromTokens(ctx: Context, tokens: Record<string, unknown>, base: Omit<SulfurSession, 'access' | 'refresh' | 'accessExpiresAt' | 'kind' | 'storage'> & { kind?: SessionKind }, previous?: SulfurSession): SulfurSession {
  const access = String(tokens.access_token ?? '');
  if (!access) throw networkError('TOKEN_MISSING', 'The token endpoint gave no access token', {}, 'platform');
  const expiresIn = Number(tokens.expires_in ?? 900);
  const refresh = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : previous?.refresh;
  return {
    ...base, kind: String(tokens.session_kind ?? base.kind ?? previous?.kind ?? 'untrusted'), storage: previous?.storage ?? 'file',
    access, ...(refresh ? { refresh } : {}), accessExpiresAt: new Date(ctx.now() + expiresIn * 1000).toISOString(),
  };
}

const sessionEnded = (ctx: Context, why: string) => {
  forgetSulfurSession(ctx);
  return new CliError('SESSION_EXPIRED', `The session on the new backend ended (${why}): sign in again (breakrocks --backend sulfur login)`, EXIT.NETWORK, {}, 'platform');
};

/** The renewals in flight in this process, by profile (single-flight). */
const RENEWING = new Map<string, Promise<SulfurSession>>();

/** Takes the cross-process lock of the profile's renewal; answers its release. Waits for another holder (≤ 15 s). */
async function lock(ctx: Context): Promise<() => void> {
  const file = lockFile(ctx);
  mkdirSync(join(ctx.store.dir, 'sessions'), { recursive: true, mode: 0o700 });
  for (let waited = 0; ; waited += LOCK_STEP_MS) {
    try {
      closeSync(openSync(file, 'wx', 0o600));
      return () => rmSync(file, { force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let age = 0;
      try { age = Date.now() - statSync(file).mtimeMs; } catch { continue; }
      if (age > LOCK_STALE_MS) { rmSync(file, { force: true }); continue; }
      if (waited >= LOCK_WAIT_MS) throw networkError('SESSION_BUSY', 'Another breakrocks process is renewing the session: try again in a moment');
      await ctx.io.sleep(LOCK_STEP_MS);
    }
  }
}

/** Renews [current] once for every caller of this process and every process of this profile. */
export function renewSulfurSession(ctx: Context, current: SulfurSession): Promise<SulfurSession> {
  const key = `${ctx.store.dir}|${ctx.profileName}`;
  const running = RENEWING.get(key);
  if (running) return running;
  const p = (async () => {
    const release = await lock(ctx);
    try {
      // Another process may have renewed it while this one waited: its tokens are the ones to use.
      const now = readSulfurSession(ctx);
      if (!now) throw sessionEnded(ctx, 'signed out meanwhile');
      if (now.access !== current.access && Date.parse(now.accessExpiresAt) - ctx.now() > RENEW_BEFORE_MS) return now;
      if (!now.refresh) throw sessionEnded(ctx, 'a device-code session is not renewed: 7 days, or its access token, at most');
      const base = sulfurBase(ctx, now.env as never, now.cell);
      const answer = await sulfurPost(ctx, base, '/oauth/token', { grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: now.refresh }, { form: true });
      if (answer.status === 400 || answer.status === 401) throw sessionEnded(ctx, String((answer.json as { error_description?: string; error?: string }).error_description ?? (answer.json as { error?: string }).error ?? 'refused'));
      if (answer.status !== 200) throw networkError('SESSION_RENEWAL_FAILED', `The token endpoint answered ${answer.status}: try again`, { status: answer.status }, 'platform');
      const { access: _a, refresh: _r, accessExpiresAt: _e, storage: _st, ...keep } = now;
      return saveSulfurSession(ctx, sessionFromTokens(ctx, answer.json, keep, now));
    } finally { release(); }
  })();
  RENEWING.set(key, p);
  return p.finally(() => RENEWING.delete(key));
}

/**
 * The session of the profile, its access token renewed when it ends within a minute; SIGN_IN_REQUIRED without one.
 * Refused: a session of another environment than the one asked (ENV_MISMATCH: a dev command never reaches prod), and the
 * agent credentials of this run (the BREAKROCKS_* variables, a key of the profile) beside a human's session or profile
 * (PROFILE_HOLDS_HUMAN: an agent is never signed into a human's session file). An agent's session signed by another agent
 * than the one of this run is replaced by a new sign-in.
 */
export async function ensureSulfurSession(ctx: Context, options: { renew?: boolean } = {}): Promise<SulfurSession> {
  const profile = ctx.profile();
  const current = readSulfurSession(ctx);
  if (current && current.env !== profile.env) {
    throw usageError('ENV_MISMATCH', `The session of the profile "${ctx.profileName}" on the new backend is of ${current.env}, not ${profile.env}: use another profile for ${profile.env} (breakrocks config add <name> --env ${profile.env}), or sign out first`, { profile: ctx.profileName, env: current.env, requested: profile.env });
  }
  const { agentCredentials, agentSignIn, mayActAsAgent, refuseAgentIntoHuman } = await import('./agent.js');
  if (mayActAsAgent(ctx, profile)) {
    refuseAgentIntoHuman(ctx, profile, current);
    // A delegated agent (or an agent operator) with its own credentials: an assertion signed with its key
    // (src/sulfur/agent.ts), again whenever its token ends; never a refresh token.
    const creds = agentCredentials(ctx);
    if (creds) {
      const same = current?.method === 'agent' && current.agentId === creds.agentId && current.accountId !== '';
      if (!same || !current || options.renew || Date.parse(current.accessExpiresAt) - ctx.now() <= RENEW_BEFORE_MS) return agentSignIn(ctx, creds);
      return current;
    }
  }
  if (!current) throw networkError('SIGN_IN_REQUIRED', `The profile "${ctx.profileName}" is not signed in on the new backend: breakrocks --backend sulfur login`, { profile: ctx.profileName });
  if (!options.renew && Date.parse(current.accessExpiresAt) - ctx.now() > RENEW_BEFORE_MS) return current;
  // An agent's session without its key here: used until its token ends, never renewed (no refresh token).
  if (current.method === 'agent') throw networkError('SIGN_IN_REQUIRED', `The agent session of the profile "${ctx.profileName}" ended and its key is not here: --agent <name>, or the BREAKROCKS_* variables`, { profile: ctx.profileName });
  return renewSulfurSession(ctx, current);
}

/** Who acts in [session]: a human, a delegated agent (its token's `act.sub`), or an agent operator (an agent session without `act`). */
export function sulfurActorOf(session: SulfurSession): { actor: 'human' | 'delegated-agent' | 'operator'; agentId?: string } {
  if (session.method !== 'agent') return { actor: 'human' };
  let act: string | undefined;
  try { act = (JSON.parse(Buffer.from(session.access.split('.')[1] ?? '', 'base64url').toString('utf8')) as { act?: { sub?: string } }).act?.sub; } catch { act = undefined; }
  return act ? { actor: 'delegated-agent', agentId: act } : { actor: 'operator' };
}

/**
 * A GraphQL request with the profile's session; a token refused renews the session once and tries again. [partial]: an
 * answer with its data and refusals beside it (`extensions.partial`: createGroupChat's GROUP_INVITATIONS_REFUSED) gives
 * the data, the refusals under `_errors` (talc's shape: errorType, errorInfo, path).
 */
export async function sulfurApi<T>(ctx: Context, query: string, variables: Record<string, unknown> = {}, options: { partial?: boolean } = {}): Promise<T> {
  const session = await ensureSulfurSession(ctx);
  const base = sulfurBase(ctx, session.env as never, session.cell);
  try {
    return await sulfurGraphql<T>(ctx, base, session.access, query, variables, options);
  } catch (e) {
    if (!isTokenRefused(e)) throw e;
    const renewed = await ensureSulfurSession(ctx, { renew: true });
    try { return await sulfurGraphql<T>(ctx, base, renewed.access, query, variables, options); } catch (again) {
      if (isTokenRefused(again)) throw sessionEnded(ctx, 'the token was refused again');
      throw again;
    }
  }
}

/**
 * A POST to an auth route of the profile's cell with its session (`/auth/email/change/*`): its body, or the refusal it
 * answered; a token refused (401) renews the session once and tries again. [what] names the act in a refusal.
 */
export async function sulfurAuthPost(ctx: Context, path: string, body: Record<string, unknown>, what: string): Promise<Record<string, unknown>> {
  const session = await ensureSulfurSession(ctx);
  const base = sulfurBase(ctx, session.env as never, session.cell);
  let answer = await sulfurPost(ctx, base, path, body, { token: session.access });
  if (answer.status === 401) answer = await sulfurPost(ctx, base, path, body, { token: (await ensureSulfurSession(ctx, { renew: true })).access });
  if (answer.status === 401) throw sessionEnded(ctx, 'the token was refused again');
  return expectAuthOk(answer, what);
}

/** Whether a session file exists (for doctor-like checks). */
export const hasSulfurSession = (ctx: Context) => existsSync(metaFile(ctx));
