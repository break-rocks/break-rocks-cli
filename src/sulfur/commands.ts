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
import { ensureSulfurSession, forgetSulfurSession, readSulfurSession, saveSulfurSession, sulfurActorOf, sulfurApi, type SulfurSession } from './session.js';
import { agentFromEnv } from '../session.js';
import type { Context } from '../context.js';
import { CONTRACT } from '../api/graphql.js';
import { VERSION } from '../version.js';
import { sulfurBase } from './http.js';
import { SERVER } from './schema.generated.js';
import { ADAPTERS } from './talc.js';


type SessionView = { kind: string; method: string; signedInAt: string; accessExpiresAt: string; storage: string; note: string };
const sessionView = (s: SulfurSession): SessionView => ({
  kind: s.kind, method: s.method, signedInAt: s.signedInAt, accessExpiresAt: s.accessExpiresAt, storage: s.storage,
  note: s.method === 'agent' ? 'an agent: its key signs a new assertion whenever its token ends' : s.kind === 'device' ? 'device code: content only, 7 days from the sign-in, never extended' : s.kind === 'untrusted' ? 'renewed on its own; sign in again after 24 hours unused, or 7 days' : 'renewed on its own',
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
    if ([i.email !== undefined, !!i.browser, !!i.device].filter(Boolean).length > 1) throw usageError('LOGIN_MODES_CONFLICT', 'Choose one: --email, --browser or --device');
    // Everything checked before a browser opens, a code is asked or an e-mail sent.
    if (i.handle !== undefined && i.email === undefined) throw usageError('INVALID_INPUT', '--handle goes with --email');
    // A person signs in here: never into the profile of an agent, never with an agent's credentials set (they would sign
    // the agent into the person's session file next).
    if (ctx.agentName || profile.kind === 'operator' || profile.kind === 'agent') throw usageError('PROFILE_HOLDS_AGENT_ACCOUNT', `The profile "${ctx.profileName}" holds ${profile.kind === 'operator' ? 'an agent operator' : 'a delegated agent'}: an agent signs in with its key (breakrocks --backend sulfur agents login); sign the person in another profile (--profile <name>)`, { profile: ctx.profileName });
    if (agentFromEnv(ctx.env)) throw usageError('PROFILE_HOLDS_HUMAN', `BREAKROCKS_OPERATOR_ID, BREAKROCKS_AGENT_ID and BREAKROCKS_AGENT_KEY are set: a person signs in without them, an agent with breakrocks --backend sulfur agents login`, { profile: ctx.profileName });
    // A profile saved with its environment, so that the next commands find it without --env.
    if (!ctx.store.profile(ctx.profileName)) ctx.saveProfile({ env });
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
    // The profile holds a person from now on: another environment asked with it is ENV_MISMATCH (src/context.ts).
    ctx.saveProfile({ ...ctx.store.profile(ctx.profileName), env, kind: 'human' });
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

type WhoamiResult = { backend: 'sulfur'; actor: 'human' | 'delegated-agent' | 'operator'; agentId?: string; profile: string; env: string; cell: string; account: { id: string; handle: string; name: string | null; tier: string }; session: SessionView };
export const sulfurWhoami: Command<Record<string, never>, WhoamiResult> = {
  name: 'whoami', summary: 'The account signed in on the new backend',
  examples: ['breakrocks --backend sulfur whoami', 'breakrocks --backend sulfur whoami --json'],
  input: object({}),
  output: openObject({ backend: str('sulfur'), actor: str('human'), profile: str('The profile'), env: str('Environment'), cell: str('Home cell'), account: openObject({ id: str('The account'), handle: str('Its handle'), name: { type: ['string', 'null'] }, tier: str('Its tier') }), session: sessionSchema }),
  run: async (ctx) => {
    const me = (await sulfurApi<{ me: { id: string; tier: string; card: Card } }>(ctx, '{ me { id tier card { handle name } } }')).me;
    const s = await ensureSulfurSession(ctx);
    // An agent's token acts for its owner (`act.sub`: the agent); an agent operator's is its own (no `act`).
    const { actor, agentId } = sulfurActorOf(s);
    return { backend: 'sulfur', actor, ...(agentId ? { agentId } : {}), profile: ctx.profileName, env: s.env, cell: s.cell, account: { id: me.id, handle: me.card.handle, name: me.card.name, tier: me.tier }, session: sessionView(s) };
  },
  text: (r) => [`${paint.address(`@${r.account.handle}`)} ${paint.dim(`(${r.account.id})`)}${r.account.name ? ` ${r.account.name}` : ''}`, paint.dim(`new backend, ${r.env}, cell ${r.cell}, profile ${r.profile}`), `tier ${r.account.tier}`, `session ${r.session.kind}: ${r.session.note}`].join('\n'),
  quiet: (r) => r.account.id,
};

// ---- operator login / agents login ----

type AgentLoginResult = { backend: 'sulfur'; actor: string; accountId: string; agentId?: string; session: SessionView };
const agentLogin = (name: 'operator login' | 'agents login'): Command<Record<string, never>, AgentLoginResult> => ({
  name, summary: name === 'operator login' ? 'Sign the agent operator in on the new backend with its key (RFC 7523)' : 'Sign a delegated agent in on the new backend with its key (RFC 7523)',
  description: 'The key of the profile (or of --agent, or BREAKROCKS_OPERATOR_ID, BREAKROCKS_AGENT_ID, BREAKROCKS_AGENT_KEY) signs an assertion exchanged at the cell\'s token endpoint for an access token; a new assertion renews it whenever it ends (no refresh token). Every command signs in this way by itself: this one only checks it.',
  examples: [`breakrocks --backend sulfur ${name}`, 'breakrocks --backend sulfur --agent herald whoami'],
  input: object({}), output: openObject({ backend: str('sulfur'), actor: str('delegated-agent or operator'), accountId: str('The account it acts as'), agentId: str('The delegated agent'), session: sessionSchema }),
  mcp: false,
  run: async (ctx) => {
    const { agentCredentials, agentSignIn } = await import('./agent.js');
    const creds = agentCredentials(ctx);
    if (!creds) throw usageError('AGENT_CREDENTIALS_REQUIRED', 'No key here: --agent <local agent>, a profile of an operator or of a delegated agent, or BREAKROCKS_OPERATOR_ID, BREAKROCKS_AGENT_ID and BREAKROCKS_AGENT_KEY');
    const s = await agentSignIn(ctx, creds);
    const { actor, agentId } = sulfurActorOf(s);
    return { backend: 'sulfur', actor, accountId: s.accountId, ...(agentId ? { agentId } : {}), session: sessionView(s) };
  },
  text: (r) => `${paint.ok('Signed in')} on the new backend as ${r.actor}${r.agentId ? ` ${r.agentId}` : ''} for ${r.accountId}`,
  quiet: (r) => r.accountId,
});

// ---- doctor ----

type Check = { name: string; status: 'ok' | 'warn' | 'fail' | 'skip'; detail: string; code?: string };
type DoctorResult = { ok: boolean; version: string; backend: 'sulfur'; serverSchema?: string; profile: string; env: string; checks: Check[]; missingFields: string[]; missingDeprecatedFields: string[]; missingOperations: string[] };

export const sulfurDoctor: Command<Record<string, never>, DoctorResult> = {
  name: 'doctor', summary: 'Check what keeps the CLI from working on the new backend: the profile, the session, the API, the operations it serves',
  examples: ['breakrocks --backend sulfur doctor', 'breakrocks --backend sulfur doctor --json'],
  input: object({}),
  output: openObject({ ok: bool('Nothing fails'), version: str('The CLI'), backend: str('sulfur'), serverSchema: str('The server commit of the schema the CLI fits its requests to'), profile: str('The profile'), env: str('Environment'), checks: { type: 'array', items: openObject({ name: str('What'), status: str('ok, warn, fail or skip'), detail: str('Why') }) }, missingOperations: { type: 'array', items: { type: 'string' }, description: 'Talc operations the new backend does not serve (NOT_ON_NEW_BACKEND)' } }),
  run: async (ctx) => {
    const checks: Check[] = [];
    const profile = ctx.profile();
    const env = profile.env as Environment;
    checks.push({ name: 'backend', status: 'ok', detail: `sulfur (${sulfurBase(ctx, env)})` });
    checks.push({ name: 'configuration', status: 'ok', detail: ctx.store.dir });
    // An agent (a local agent, a profile of an operator or a delegated agent, the BREAKROCKS_* variables) has no session
    // file before its first command: it signs in with its key here, as every command does.
    let session = readSulfurSession(ctx);
    const { agentCredentials, mayActAsAgent } = await import('./agent.js');
    if (mayActAsAgent(ctx, profile)) {
      try {
        if (!agentCredentials(ctx)) checks.push({ name: 'agent', status: 'fail', code: 'AGENT_CREDENTIALS_REQUIRED', detail: 'the key of the agent is not here' });
        else { session = await ensureSulfurSession(ctx); checks.push({ name: 'agent', status: 'ok', detail: `signed in with its key (RFC 7523): ${sulfurActorOf(session).actor}` }); }
      } catch (e) {
        checks.push({ name: 'agent', status: 'fail', code: (e as { code?: string }).code, detail: (e as Error).message });
      }
    }
    if (!session) checks.push({ name: 'session', status: 'fail', code: 'SIGN_IN_REQUIRED', detail: mayActAsAgent(ctx, profile) ? 'the agent could not sign in (above)' : 'not signed in: breakrocks --backend sulfur login' });
    else checks.push({ name: 'session', status: 'ok', detail: `@${session.handle ?? '?'} (${session.accountId}), ${session.method}, ${session.kind}, cell ${session.cell}, token until ${session.accessExpiresAt} (${session.storage})` });
    if (session) {
      try {
        const h = (await sulfurApi<{ health: { ok: boolean; cell: string } }>(ctx, '{ health { ok cell } }')).health;
        checks.push({ name: 'api', status: h.ok ? 'ok' : 'fail', detail: `health ${h.ok ? 'ok' : 'not ok'}, cell ${h.cell}` });
      } catch (e) {
        checks.push({ name: 'api', status: 'fail', code: (e as { code?: string }).code, detail: (e as Error).message });
      }
    } else checks.push({ name: 'api', status: 'skip', detail: 'no session' });
    const missing = [...Object.keys(CONTRACT.query).filter((q) => !SERVER.query[q] && !ADAPTERS[q]).map((q) => `Query.${q}`), ...Object.keys(CONTRACT.mutation).filter((m) => !SERVER.mutation[m] && !ADAPTERS[m]).map((m) => `Mutation.${m}`)];
    checks.push({ name: 'operations', status: missing.length ? 'warn' : 'ok', detail: `${missing.length} talc operations not served by the new backend (schema of ${SERVER.version ?? '?'}): their commands answer NOT_ON_NEW_BACKEND (docs/sulfur.md)` });
    return { ok: !checks.some((c) => c.status === 'fail'), version: VERSION, backend: 'sulfur', ...(SERVER.version ? { serverSchema: SERVER.version } : {}), profile: ctx.profileName, env, checks, missingFields: [], missingDeprecatedFields: [], missingOperations: missing };
  },
  text: (r) => [...r.checks.map((c) => `${c.status === 'ok' ? paint.ok('ok  ') : c.status === 'fail' ? paint.error('fail') : paint.dim(c.status.padEnd(4))} ${c.name}: ${c.detail}`), r.ok ? paint.ok('Nothing keeps the CLI from working on the new backend') : paint.error('Something keeps the CLI from working on the new backend')].join('\n'),
  quiet: (r) => (r.ok ? 'ok' : 'fail'),
};

/** The commands of the new backend, by the registry name they stand in for. */
export const SULFUR_COMMANDS: ReadonlyMap<string, AnyCommand> = new Map<string, AnyCommand>([sulfurLogin, sulfurLogout, sulfurWhoami, sulfurDoctor, agentLogin('operator login'), agentLogin('agents login')].map((c) => [c.name, c as AnyCommand]));

