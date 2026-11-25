// The commands of the new backend (native-sulfur) itself, under the names of the registry they stand in for: login, logout,
// whoami (its own sign-in and sessions). Every other command runs the registry's own, its requests through the seam of
// src/sulfur/talc.ts (src/sulfur/dispatch.ts).
import { paint } from '../colour.js';
import type { Environment } from '../config.js';
import { usageError } from '../errors.js';
import type { AnyCommand, Command } from '../registry.js';
import { bool, int, object, openObject, str } from '../schema.js';
import { browserSignIn, canOpenBrowser } from './browser.js';
import { codeMissing, deviceSignIn, emailFinish, emailStart, forgetPendingEmail, pendingEmail, revoke } from './auth.js';
import { ensureSulfurSession, forgetSulfurSession, readSulfurSession, saveSulfurSession, sulfurApi, type SulfurSession } from './session.js';
import type { Context } from '../context.js';


type SessionView = { kind: string; method: string; signedInAt: string; accessExpiresAt: string; storage: string; note: string };
const sessionView = (s: SulfurSession): SessionView => ({
  kind: s.kind, method: s.method, signedInAt: s.signedInAt, accessExpiresAt: s.accessExpiresAt, storage: s.storage,
  note: s.kind === 'device' ? 'device code: content only, 7 days from the sign-in, never extended' : s.kind === 'untrusted' ? 'renewed on its own; sign in again after 24 hours unused, or 7 days' : 'renewed on its own',
});
const sessionSchema = openObject({ kind: str('The session kind: untrusted (e-mail code), device (device code)'), method: str('email or device'), signedInAt: str('When'), accessExpiresAt: str('When the access token ends (renewed on its own)'), storage: str('Where its tokens are: keychain or file (0600)'), note: str('How long it lasts') });

// ---- login / logout ----

type LoginInput = { email?: string; code?: string; handle?: string; cell?: string; signUp?: boolean; browser?: boolean; device?: boolean; open?: boolean; timeout?: number; passwordStdin?: boolean; label?: string };
type LoginResult = { backend: 'sulfur'; env: string; cell: string; accountId?: string; handle?: string; codeSent?: boolean; email?: string; session?: SessionView };

export const sulfurLogin: Command<LoginInput, LoginResult> = {
  name: 'login', summary: 'Sign in on the new backend: the browser, a device code, or an e-mail code in the terminal',
  description: 'Without --email, in a terminal with a browser to open (not over SSH, a display on Linux): the browser (--browser): the CLI listens on 127.0.0.1, opens the page /cli/login of the web app, you confirm your e-mail address there with a code, and the browser gives the CLI a code for one use only (PKCE), never a token; the session is renewed on its own and ends after 24 hours unused or 7 days. Without a browser (SSH, no display, no terminal, or --device): a device code (RFC 8628): the CLI writes an address and a code; open the address on a device already signed in, type the code and approve; the session reaches content only and lasts 7 days; a refusal on the other device is DEVICE_CODE_DENIED. --email: a code is sent to the address and typed here (asked in a terminal; else run again with --code: the code lasts 5 minutes). BREAKROCKS_NO_BROWSER=1 chooses the device code, BREAKROCKS_BROWSER=1 the browser. The tokens are kept in the system keychain, else in a file for the user alone (0600), never printed. Not an MCP tool.',
  examples: ['breakrocks --backend sulfur --env dev login', 'breakrocks --backend sulfur --env dev login --browser --no-open', 'breakrocks --backend sulfur --env dev login --device', 'breakrocks --backend sulfur --env dev login --email me@example.com', 'breakrocks --backend sulfur --env dev login --email me@example.com --code 123456', 'breakrocks --backend sulfur --env dev login --email bot@example.com --sign-up --handle my_bot', 'echo 12345678 | breakrocks --backend sulfur --env dev login --email bot@example.com --handle my_bot --code -'],
  input: object({
    email: str('Sign in with a code sent to this e-mail address'),
    code: str('The 8-digit code received by e-mail (a second run, without a terminal); spaces allowed; "-": read from the standard input. BREAKROCKS_EMAIL_CODE gives it too, used only when a code was asked by this profile', { pattern: '^(-|[0-9][0-9 -]{6,12}[0-9])$' }),
    handle: str('With --email: the handle to take once signed in (a sign-up gets a handle of its own first; changeHandle)', { pattern: '^@?[A-Za-z0-9_.]{1,40}$' }),
    cell: str('The cell to start from (default eu)', { pattern: '^[a-z]{2}$' }),
    signUp: bool('With --email: create the account (the address has none yet)'),
    label: str('With the device code: the name of this device shown on the approval screen'),
    browser: bool('Sign in through the web app (the default in a terminal with a browser)'),
    device: bool('Sign in with a device code (the default without a browser: SSH, no display)'),
    open: bool('With the browser: open it (--no-open: write the address only)', { default: true }),
    timeout: int('With the browser: seconds to wait for the confirmation (default 300)', { minimum: 30, maximum: 900 }),
    passwordStdin: bool('A password (none on the new backend)'),
  }),
  output: openObject({ backend: str('sulfur'), env: str('Environment'), cell: str('Home cell'), accountId: str('The account'), handle: str('Its handle'), codeSent: bool('The e-mail code was sent: run again with --code'), session: sessionSchema }),
  mcp: false,
  run: async (ctx, i) => {
    const profile = ctx.profile();
    const env = profile.env as Environment;
    if (i.passwordStdin) throw usageError('NO_PASSWORD', 'The new backend has no password: login (device code) or login --email');
    // A profile saved with its environment, so that the next commands find it without --env.
    if (!ctx.store.profile(ctx.profileName) && !ctx.agentName) ctx.saveProfile({ env });
    if ([i.email !== undefined, !!i.browser, !!i.device].filter(Boolean).length > 1) throw usageError('LOGIN_MODES_CONFLICT', 'Choose one: --email, --browser or --device');
    const device = () => deviceSignIn(ctx, env, {
      cell: i.cell, label: i.label,
      onCode: (s) => ctx.notice(`To sign in, open ${s.verification_uri} on a device already signed in and type the code ${paint.bold(s.user_code)} (valid ${Math.round(s.expires_in / 60)} minutes)`),
    });
    let session: SulfurSession;
    // The default: the browser when one can be opened here, else the device code.
    const mode: 'email' | 'browser' | 'device' = i.email !== undefined ? 'email' : i.browser ? 'browser' : i.device ? 'device' : canOpenBrowser(ctx) ? 'browser' : 'device';
    const explicit = i.email !== undefined || i.browser || i.device;
    if (mode === 'browser') {
      try { session = await browserSignIn(ctx, env, { cell: i.cell, open: i.open, timeoutSeconds: i.timeout }); }
      catch (e) {
        if (explicit || (e as { code?: string }).code !== 'PORT_UNAVAILABLE') throw e;
        ctx.notice('The browser sign-in could not listen on this computer: using a device code');
        session = await device();
      }
    } else if (mode === 'device') session = await device();
    else {
      const email = (i.email as string).trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw usageError('EMAIL_INVALID', `Not an e-mail address: "${i.email}"`);
      let given = i.code;
      if (given === '-') {
        if (!ctx.io.readStdin) throw usageError('CODE_REQUIRED', '"--code -" needs a standard input');
        given = (await ctx.io.readStdin()).trim();
      }
      let pending = pendingEmail(ctx, email, env);
      // BREAKROCKS_EMAIL_CODE: the code of the flow this profile started (never sent to a flow it did not start).
      if (!given && pending && ctx.env.BREAKROCKS_EMAIL_CODE?.trim()) given = ctx.env.BREAKROCKS_EMAIL_CODE.trim();
      if (!given || !pending) {
        if (given) throw usageError('NO_CODE_PENDING', 'No code was asked for this address from this profile in the last 15 minutes: run login --email first');
        pending = await emailStart(ctx, env, email, { cell: i.cell, signUp: i.signUp });
        ctx.progress(`A code was sent to ${email} (if the address has an account${i.signUp ? '' : '; --sign-up creates one'})`);
      }
      let code = given;
      if (!code) {
        if (!ctx.io.interactive) return { backend: 'sulfur', env, cell: pending.cell, email, codeSent: true };
        code = (await ctx.io.ask('Code received by e-mail: ')).trim();
        if (!code) { forgetPendingEmail(ctx); throw codeMissing(); }
      }
      session = await emailFinish(ctx, pending, code);
      if (i.handle) session = await takeHandle(ctx, session, i.handle.replace(/^@/, ''));
    }
    if (i.handle && mode !== 'email') throw usageError('INVALID_INPUT', '--handle goes with --email');
    return { backend: 'sulfur', env, cell: session.cell, accountId: session.accountId, handle: session.handle, session: sessionView(session) };
  },
  text: (r) => (r.codeSent ? `Code sent: run the same command with --code <code> within 5 minutes ${paint.dim(`(${r.env}, cell ${r.cell})`)}` : `${paint.ok('Signed in')} on the new backend: @${r.handle} ${paint.dim(`(${r.accountId})`)}\n${paint.dim(`${r.env}, cell ${r.cell}`)}\n${r.session?.note}`),
  quiet: (r) => r.accountId,
};

/** The handle [handle] taken by the account just signed in (changeHandle), the session's handle updated; kept when it is already its. */
async function takeHandle(ctx: Context, session: SulfurSession, handle: string): Promise<SulfurSession> {
  if (session.handle?.toLowerCase() === handle.toLowerCase()) return session;
  const card = (await sulfurApi<{ changeHandle: { handle: string } }>(ctx, 'mutation($h: String!) { changeHandle(handle: $h) { handle } }', { h: handle })).changeHandle;
  return saveSulfurSession(ctx, { ...session, handle: card.handle });
}

type LogoutResult = { backend: 'sulfur'; profile: string; signedOut: boolean; everywhere: boolean; revoked: boolean; note?: string };
export const sulfurLogout: Command<{ everywhere?: boolean }, LogoutResult> = {
  name: 'logout', summary: 'Sign out of the new backend on this device, or everywhere',
  examples: ['breakrocks --backend sulfur logout', 'breakrocks --backend sulfur logout --everywhere'],
  input: object({ everywhere: bool('End every session of the account (endAllSessions)') }),
  output: openObject({ backend: str('sulfur'), profile: str('The profile'), signedOut: bool('A session was closed here'), everywhere: bool('Every session ended'), revoked: bool('The platform ended the session'), note: str('What to know') }),
  mcp: false,
  run: async (ctx, { everywhere = false }) => {
    const session = readSulfurSession(ctx);
    if (!session) return { backend: 'sulfur', profile: ctx.profileName, signedOut: false, everywhere: false, revoked: false, note: 'No session on this device' };
    if (everywhere) {
      await sulfurApi<{ endAllSessions: boolean }>(ctx, 'mutation { endAllSessions }');
      forgetSulfurSession(ctx);
      return { backend: 'sulfur', profile: ctx.profileName, signedOut: true, everywhere: true, revoked: true };
    }
    let revoked = false, note: string | undefined;
    try { await revoke(ctx, session); revoked = !!session.refresh; } catch (e) {
      note = `The session could not be ended on the platform (${(e as { code?: string }).code ?? 'error'}): it ends by itself`;
      ctx.notice(note);
    }
    forgetSulfurSession(ctx);
    return { backend: 'sulfur', profile: ctx.profileName, signedOut: true, everywhere: false, revoked, ...(note ? { note } : {}) };
  },
  text: (r) => (r.signedOut ? `${paint.ok(`Signed out${r.everywhere ? ' everywhere' : ''}`)} ${paint.dim(`(new backend, profile ${r.profile})`)}${r.note ? `\n${r.note}` : ''}` : `${r.note} (profile ${r.profile})`),
};

// ---- whoami / profile ----

type Card = { handle: string; name: string | null };

type WhoamiResult = { backend: 'sulfur'; actor: 'human'; profile: string; env: string; cell: string; account: { id: string; handle: string; name: string | null; tier: string }; session: SessionView };
export const sulfurWhoami: Command<Record<string, never>, WhoamiResult> = {
  name: 'whoami', summary: 'The account signed in on the new backend',
  examples: ['breakrocks --backend sulfur whoami', 'breakrocks --backend sulfur whoami --json'],
  input: object({}),
  output: openObject({ backend: str('sulfur'), actor: str('human'), profile: str('The profile'), env: str('Environment'), cell: str('Home cell'), account: openObject({ id: str('The account'), handle: str('Its handle'), name: { type: ['string', 'null'] }, tier: str('Its tier') }), session: sessionSchema }),
  run: async (ctx) => {
    const me = (await sulfurApi<{ me: { id: string; tier: string; card: Card } }>(ctx, '{ me { id tier card { handle name } } }')).me;
    const s = await ensureSulfurSession(ctx);
    return { backend: 'sulfur', actor: 'human', profile: ctx.profileName, env: s.env, cell: s.cell, account: { id: me.id, handle: me.card.handle, name: me.card.name, tier: me.tier }, session: sessionView(s) };
  },
  text: (r) => [`${paint.address(`@${r.account.handle}`)} ${paint.dim(`(${r.account.id})`)}${r.account.name ? ` ${r.account.name}` : ''}`, paint.dim(`new backend, ${r.env}, cell ${r.cell}, profile ${r.profile}`), `tier ${r.account.tier}`, `session ${r.session.kind}: ${r.session.note}`].join('\n'),
  quiet: (r) => r.account.id,
};

/** The commands of the new backend, by the registry name they stand in for. */
export const SULFUR_COMMANDS: ReadonlyMap<string, AnyCommand> = new Map<string, AnyCommand>([sulfurLogin, sulfurLogout, sulfurWhoami].map((c) => [c.name, c as AnyCommand]));

