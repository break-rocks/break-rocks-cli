// Signing in on the new backend (server src/core/auth; contracts/auth.md), as the client `cli`, without a browser on this
// device:
// - the device code (RFC 8628, H-9): the CLI asks a code, writes the address and the code (never a prefilled link), the
//   person types the code on a device already signed in, the CLI polls every 5 s (slower when told); the session is fixed
//   7 days and reaches content only;
// - the e-mail code, in the terminal: `/auth/email/start` (the code sent, the answer the same whether the address has an
//   account or not), `/auth/email/verify` (the 8 digits → a proof ticket naming the home cell), `/auth/complete` at that cell
//   (→ an authorization code for `cli`, PKCE S256), `/oauth/token`. No device key in Node (Q-6): the session is untrusted,
//   24 h idle and 7 days at most. Without a terminal, `login --email` starts and keeps the flow (0600, 15 minutes; the code itself lasts 5), and
//   `login --email --code` finishes it.
// - the browser (src/sulfur/browser.ts): the web page `/cli/login`, a loopback redirect `/cb`, PKCE S256.
import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { Context } from '../context.js';
import type { Environment } from '../config.js';
import { readJson, writePrivate } from '../config.js';
import { CliError, EXIT, cliRefusal, networkError, platformRefusal } from '../errors.js';
import { authRefusal, expectAuthOk, SULFUR_DEFAULT_CELL, sulfurBase, sulfurGraphql, sulfurPost } from './http.js';
import { CLIENT_ID, readSulfurSession, saveSulfurSession, sessionFromTokens, type SulfurSession } from './session.js';

export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
export const PENDING_EMAIL_MS = 15 * 60_000;

const b64url = (b: Buffer) => b.toString('base64url');
export const newVerifier = () => b64url(randomBytes(32));
export const s256 = (verifier: string) => b64url(createHash('sha256').update(verifier, 'ascii').digest());

/** The claims of a JWT, unverified (the CLI only reads its own token's account and cell; the API verifies it). */
export function claimsOf(token: string): Record<string, unknown> {
  try { return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>; } catch { return {}; }
}

export type SignedIn = { session: SulfurSession; created?: boolean };

/** The account behind fresh tokens (me), the session saved. */
export async function finish(ctx: Context, env: Environment, cell: string, tokens: Record<string, unknown>, method: 'email' | 'device' | 'browser'): Promise<SulfurSession> {
  const claims = claimsOf(String(tokens.access_token ?? ''));
  const home = typeof claims.cel === 'string' && /^[a-z]{2}$/.test(claims.cel) ? claims.cel : cell;
  const me = (await sulfurGraphql<{ me: { id: string; card: { handle: string } } }>(ctx, sulfurBase(ctx, env, home), String(tokens.access_token), '{ me { id card { handle } } }')).me;
  const before = readSulfurSession(ctx);
  // A session of this profile signed in before: ended first (its refresh token revoked), never two on one profile.
  if (before?.refresh) await revoke(ctx, before).catch(() => undefined);
  const session = sessionFromTokens(ctx, tokens, { backend: 'sulfur', env, cell: home, accountId: me.id, handle: me.card.handle, method, signedInAt: new Date(ctx.now()).toISOString() });
  return saveSulfurSession(ctx, session);
}

/** Ends [session] on the platform (`/oauth/revoke`: 200 even for a token it does not know). */
export async function revoke(ctx: Context, session: SulfurSession): Promise<void> {
  if (!session.refresh) return;
  const answer = await sulfurPost(ctx, sulfurBase(ctx, session.env as Environment, session.cell), '/oauth/revoke', { token: session.refresh, client_id: CLIENT_ID }, { form: true });
  expectAuthOk(answer, 'Sign-out');
}

// ---- Device code ----

export type DeviceStart = { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number };

/** RFC 8628: the code asked, the address and the code written (stderr), the poll until approved, denied or expired. */
export async function deviceSignIn(ctx: Context, env: Environment, options: { cell?: string; label?: string; onCode?: (start: Omit<DeviceStart, 'device_code'>) => void } = {}): Promise<SulfurSession> {
  const cell = options.cell ?? SULFUR_DEFAULT_CELL;
  const base = sulfurBase(ctx, env, cell);
  const label = (options.label ?? `breakrocks on ${safeHostname()}`).slice(0, 64);
  const start = expectAuthOk(await sulfurPost(ctx, base, '/oauth/device_authorization', { client_id: CLIENT_ID, device_name: label }, { form: true }), 'The device code') as unknown as DeviceStart;
  const { device_code: deviceCode, ...shown } = start;
  options.onCode?.(shown);
  let interval = Math.max(1, Number(start.interval) || 5);
  const deadline = ctx.now() + (Number(start.expires_in) || 600) * 1000;
  for (;;) {
    await ctx.io.sleep(interval * 1000);
    if (ctx.now() > deadline) throw cliRefusal('DEVICE_CODE_EXPIRED', 'The code expired before it was approved: run login again');
    const answer = await sulfurPost(ctx, base, '/oauth/token', { grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: CLIENT_ID }, { form: true });
    if (answer.status === 200) return finish(ctx, env, cell, answer.json, 'device');
    const error = String((answer.json as { error?: unknown }).error ?? '');
    if (error === 'authorization_pending') continue;
    if (error === 'slow_down' || answer.status === 429) { interval += 5; continue; }
    if (error === 'expired_token') throw cliRefusal('DEVICE_CODE_EXPIRED', 'The code expired before it was approved: run login again');
    if (error === 'access_denied') throw platformRefusal('DEVICE_CODE_DENIED', 'The sign-in was refused on the other device: nothing was connected, run login again if it was a mistake');
    throw authRefusal(answer, 'The device code');
  }
}

const safeHostname = () => { try { return hostname().replace(/[^\w.-]/g, '').slice(0, 40) || 'this device'; } catch { return 'this device'; } };

// ---- E-mail code ----

type PendingEmail = { email: string; cell: string; env: Environment; flowId: string; verifier: string; startedAt: number };
const pendingFile = (ctx: Context) => join(ctx.store.dir, 'sessions', `${ctx.profileName}.sulfur-pending.json`);

/** `/auth/email/start`, followed to the address's OTP cell when the first cell names another one. */
export async function emailStart(ctx: Context, env: Environment, email: string, options: { cell?: string; signUp?: boolean } = {}): Promise<PendingEmail> {
  const verifier = newVerifier();
  let cell = options.cell ?? SULFUR_DEFAULT_CELL;
  const body = { email, intent: options.signUp ? 'sign-up' : 'sign-in', challenge: s256(verifier) };
  let out = expectAuthOk(await sulfurPost(ctx, sulfurBase(ctx, env, cell), '/auth/email/start', body), 'Sending the code') as { otpCell?: string; flowId?: string };
  if (!out.flowId && out.otpCell && out.otpCell !== cell) {
    cell = out.otpCell;
    out = expectAuthOk(await sulfurPost(ctx, sulfurBase(ctx, env, cell), '/auth/email/start', body), 'Sending the code') as { otpCell?: string; flowId?: string };
  }
  if (!out.flowId) throw networkError('EMAIL_START_FAILED', 'The new backend did not start the e-mail code', {}, 'platform');
  const pending: PendingEmail = { email, cell, env, flowId: out.flowId, verifier, startedAt: ctx.now() };
  writePrivate(pendingFile(ctx), JSON.stringify(pending));
  return pending;
}

/** The e-mail flow started by this profile (≤ 15 minutes ago, for [email]), if any. */
export function pendingEmail(ctx: Context, email: string, env: Environment): PendingEmail | undefined {
  const p = readJson<PendingEmail>(pendingFile(ctx));
  if (!p || p.email.toLowerCase() !== email.toLowerCase() || p.env !== env || ctx.now() - p.startedAt > PENDING_EMAIL_MS) return undefined;
  return p;
}
export const forgetPendingEmail = (ctx: Context) => rmSync(pendingFile(ctx), { force: true });

/** The code checked, the flow completed for `cli` at the home cell, the tokens, the session saved. */
export async function emailFinish(ctx: Context, pending: PendingEmail, typed: string): Promise<SulfurSession> {
  // The e-mail shows the code in two groups ("4321 8765"); the server takes its 8 digits.
  const code = typed.replace(/[\s-]/g, '');
  if (!/^[0-9]{8}$/.test(code)) throw new CliError('CODE_INVALID', 'The code has 8 digits', EXIT.USAGE);
  const verified = expectAuthOk(await sulfurPost(ctx, sulfurBase(ctx, pending.env, pending.cell), '/auth/email/verify', { email: pending.email, flowId: pending.flowId, code, verifier: pending.verifier }), 'The code') as { ticket?: string; cell?: string; otpCell?: string };
  if (!verified.ticket) throw networkError('EMAIL_VERIFY_FAILED', `The code was not checked by the address's cell${verified.otpCell ? ` (${verified.otpCell})` : ''}`, {}, 'platform');
  const home = verified.cell ?? pending.cell;
  const codeVerifier = newVerifier();
  const completed = expectAuthOk(await sulfurPost(ctx, sulfurBase(ctx, pending.env, home), '/auth/complete', { ticket: verified.ticket, verifier: pending.verifier, clientId: CLIENT_ID, codeChallenge: s256(codeVerifier), locale: 'en' }), 'The sign-in') as { code?: string; status?: string };
  forgetPendingEmail(ctx);
  if (completed.status === 'GRANT_REQUIRED') throw platformRefusal('GRANT_REQUIRED', 'The sign-up waits on the waiting list: it goes on once admitted (in the app)');
  if (!completed.code) throw networkError('SIGN_IN_FAILED', 'The new backend gave no authorization code', {}, 'platform');
  const tokens = await sulfurPost(ctx, sulfurBase(ctx, pending.env, home), '/oauth/token', { grant_type: 'authorization_code', client_id: CLIENT_ID, code: completed.code, code_verifier: codeVerifier }, { form: true });
  if (tokens.status !== 200) throw authRefusal(tokens, 'The token');
  return finish(ctx, pending.env, home, tokens.json, 'email');
}

export const codeMissing = () => new CliError('CODE_REQUIRED', 'The code was sent by e-mail: run the same command with --code <code> within 5 minutes', EXIT.USAGE);
