// The commands served on the new backend (native-sulfur), under the names of the registry they stand in for: login,
// logout, whoami, me profile show, me profile set (name, bio), posts feed (the home timeline) and posts create (a text in a
// universe). Every other command that uses the network answers NOT_ON_NEW_BACKEND there (src/sulfur/dispatch.ts).
import { paint } from '../colour.js';
import type { Environment } from '../config.js';
import { cliRefusal, usageError } from '../errors.js';
import { uuidv7 } from '../ids.js';
import type { AnyCommand, Command } from '../registry.js';
import { bool, int, list, object, openObject, str } from '../schema.js';
import { codeMissing, deviceSignIn, emailFinish, emailStart, forgetPendingEmail, pendingEmail, revoke } from './auth.js';
import { ensureSulfurSession, forgetSulfurSession, readSulfurSession, sulfurApi, type SulfurSession } from './session.js';

const notYet = (what: string) => cliRefusal('NOT_ON_NEW_BACKEND', `${what} is not yet on the new backend (native-sulfur): --backend legacy for now`, { backend: 'sulfur' });

type SessionView = { kind: string; method: string; signedInAt: string; accessExpiresAt: string; storage: string; note: string };
const sessionView = (s: SulfurSession): SessionView => ({
  kind: s.kind, method: s.method, signedInAt: s.signedInAt, accessExpiresAt: s.accessExpiresAt, storage: s.storage,
  note: s.kind === 'device' ? 'device code: content only, 7 days from the sign-in, never extended' : s.kind === 'untrusted' ? 'renewed on its own; sign in again after 24 hours unused, or 7 days' : 'renewed on its own',
});
const sessionSchema = openObject({ kind: str('The session kind: untrusted (e-mail code), device (device code)'), method: str('email or device'), signedInAt: str('When'), accessExpiresAt: str('When the access token ends (renewed on its own)'), storage: str('Where its tokens are: keychain or file (0600)'), note: str('How long it lasts') });

// ---- login / logout ----

type LoginInput = { email?: string; code?: string; cell?: string; signUp?: boolean; browser?: boolean; passwordStdin?: boolean; label?: string };
type LoginResult = { backend: 'sulfur'; env: string; cell: string; accountId?: string; handle?: string; codeSent?: boolean; session?: SessionView };

export const sulfurLogin: Command<LoginInput, LoginResult> = {
  name: 'login', summary: 'Sign in on the new backend: a device code, or an e-mail code in the terminal',
  description: 'Without --email: a device code (RFC 8628). The CLI writes an address and a code; open the address on a device already signed in, type the code and approve; the session reaches content only and lasts 7 days. --email: a code is sent to the address and typed here (asked in a terminal; else run again with --code: the code lasts 5 minutes); the session is renewed on its own and ends after 24 hours unused or 7 days. The tokens are kept in the system keychain, else in a file for the user alone (0600), never printed. Not an MCP tool.',
  examples: ['breakrocks --backend sulfur --env dev login', 'breakrocks --backend sulfur --env dev login --email me@example.com', 'breakrocks --backend sulfur --env dev login --email me@example.com --code 123456'],
  input: object({
    email: str('Sign in with a code sent to this e-mail address'),
    code: str('The 8-digit code received by e-mail (a second run, without a terminal); spaces allowed', { pattern: '^[0-9][0-9 -]{6,12}[0-9]$' }),
    cell: str('The cell to start from (default eu)', { pattern: '^[a-z]{2}$' }),
    signUp: bool('With --email: create the account (the address has none yet)'),
    label: str('With the device code: the name of this device shown on the approval screen'),
    browser: bool('The browser sign-in (not yet on the new backend)'),
    passwordStdin: bool('A password (none on the new backend)'),
  }),
  output: openObject({ backend: str('sulfur'), env: str('Environment'), cell: str('Home cell'), accountId: str('The account'), handle: str('Its handle'), codeSent: bool('The e-mail code was sent: run again with --code'), session: sessionSchema }),
  mcp: false,
  run: async (ctx, i) => {
    const profile = ctx.profile();
    const env = profile.env as Environment;
    if (i.browser) throw notYet('login --browser (the web page /cli/login of the new backend)');
    if (i.passwordStdin) throw usageError('NO_PASSWORD', 'The new backend has no password: login (device code) or login --email');
    // A profile saved with its environment, so that the next commands find it without --env.
    if (!ctx.store.profile(ctx.profileName) && !ctx.agentName) ctx.saveProfile({ env });
    let session: SulfurSession;
    if (i.email !== undefined) {
      const email = i.email.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw usageError('EMAIL_INVALID', `Not an e-mail address: "${i.email}"`);
      let pending = i.code ? pendingEmail(ctx, email, env) : undefined;
      if (!pending) {
        if (i.code) throw usageError('NO_CODE_PENDING', 'No code was asked for this address from this profile in the last 15 minutes: run login --email first');
        pending = await emailStart(ctx, env, email, { cell: i.cell, signUp: i.signUp });
        ctx.progress(`A code was sent to ${email} (if the address has an account${i.signUp ? '' : '; --sign-up creates one'})`);
      }
      let code = i.code;
      if (!code) {
        if (!ctx.io.interactive) return { backend: 'sulfur', env, cell: pending.cell, codeSent: true };
        code = (await ctx.io.ask('Code received by e-mail: ')).trim();
        if (!code) { forgetPendingEmail(ctx); throw codeMissing(); }
      }
      session = await emailFinish(ctx, pending, code);
    } else {
      session = await deviceSignIn(ctx, env, {
        cell: i.cell, label: i.label,
        onCode: (s) => ctx.notice(`To sign in, open ${s.verification_uri} on a device already signed in and type the code ${paint.bold(s.user_code)} (valid ${Math.round(s.expires_in / 60)} minutes)`),
      });
    }
    return { backend: 'sulfur', env, cell: session.cell, accountId: session.accountId, handle: session.handle, session: sessionView(session) };
  },
  text: (r) => (r.codeSent ? `Code sent: run the same command with --code <code> within 5 minutes ${paint.dim(`(${r.env}, cell ${r.cell})`)}` : `${paint.ok('Signed in')} on the new backend: @${r.handle} ${paint.dim(`(${r.accountId})`)}\n${paint.dim(`${r.env}, cell ${r.cell}`)}\n${r.session?.note}`),
  quiet: (r) => r.accountId,
};

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

type Card = { id: string; handle: string; handleSince?: string; name: string | null; bio: string | null; avatar: string | null; accountAt?: string; agent?: boolean; state?: string };
const CARD = 'id handle handleSince name bio avatar accountAt agent state';
const cardSchema = openObject({ id: str('The account'), handle: str('Its handle'), name: { type: ['string', 'null'], description: 'Its display name' }, bio: { type: ['string', 'null'], description: 'Its bio' } });

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

const cardText = (c: Card) => [`${paint.address(`@${c.handle}`)} ${paint.dim(`(${c.id})`)}`, `name ${c.name ?? '—'}`, `bio ${c.bio ?? '—'}`, ...(c.avatar ? [`avatar ${c.avatar}`] : [])].join('\n');

export const sulfurProfileShow: Command<Record<string, never>, Card> = {
  name: 'me profile show', summary: 'Show the account profile: handle, name, bio',
  examples: ['breakrocks --backend sulfur me profile show'],
  input: object({}), output: cardSchema,
  run: async (ctx) => (await sulfurApi<{ me: { card: Card } }>(ctx, `{ me { card { ${CARD} } } }`)).me.card,
  text: cardText, quiet: (c) => c.id,
};

type ProfileSetInput = { name?: string; displayName?: string; bio?: string; avatar?: string; avatarFile?: string; links?: unknown; aiDescription?: string; organizationName?: string; clear?: unknown };
export const sulfurProfileSet: Command<ProfileSetInput, Card> = {
  name: 'me profile set', summary: 'Change the account profile: name, bio',
  examples: ['breakrocks --backend sulfur me profile set --name "Ada L."', 'breakrocks --backend sulfur me profile set --bio "Hello"'],
  input: object({
    name: str('The display name'), displayName: str('The display name (as --name)'), bio: str('The bio'),
    avatar: str('Not yet on the new backend'), avatarFile: str('Not yet on the new backend'), links: str('Not yet on the new backend'), aiDescription: str('Not yet on the new backend'), organizationName: str('Not yet on the new backend'), clear: list('Not yet on the new backend'),
  }),
  output: cardSchema,
  run: async (ctx, i) => {
    for (const k of ['avatar', 'avatarFile', 'links', 'aiDescription', 'organizationName', 'clear'] as const) if (i[k] !== undefined) throw notYet(`me profile set --${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
    const name = i.name ?? i.displayName;
    if (name === undefined && i.bio === undefined) throw usageError('NOTHING_TO_CHANGE', 'Nothing to change: --name and/or --bio');
    const input = { ...(name !== undefined ? { name } : {}), ...(i.bio !== undefined ? { bio: i.bio } : {}) };
    return (await sulfurApi<{ updateProfile: Card }>(ctx, `mutation($input: ProfileInput!) { updateProfile(input: $input) { ${CARD} } }`, { input })).updateProfile;
  },
  text: cardText, quiet: (c) => c.id,
};

// ---- timeline / post ----

type Post = { id: string; kind: string; author: { id: string; handle: string; name: string; agent: boolean }; text: string | null; address: string | null; state: string; counts: { likes: number; replies: number; reposts: number } | null };
const POST = 'id kind author { id handle name agent } text address state counts { likes replies reposts }';
type FeedResult = { items: Post[]; next: string | null };

export const sulfurFeed: Command<{ clips?: boolean; after?: string; limit?: number; all?: boolean; max?: number; new?: boolean; address?: string; watch?: boolean }, FeedResult> = {
  name: 'posts feed', summary: 'The home timeline of the account, newest first',
  examples: ['breakrocks --backend sulfur posts feed', 'breakrocks --backend sulfur posts feed --clips --limit 10'],
  input: object({ clips: bool('The clips only'), after: str('The cursor of the next page'), limit: int('Posts per page', { minimum: 1, maximum: 100 }), all: bool('Follow the pages'), max: int('Pages at most with --all', { minimum: 1, maximum: 100, default: 10 }), new: bool('Not yet on the new backend'), address: str('Not yet on the new backend'), watch: bool('Not yet on the new backend') }),
  output: openObject({ items: list('Posts', openObject({ id: str('The post'), text: { type: ['string', 'null'] } })), next: { type: ['string', 'null'], description: 'The cursor of the next page' } }),
  run: async (ctx, i) => {
    if (i.new) throw notYet('posts feed --new');
    if (i.address) throw notYet('posts feed --address');
    if (i.watch) throw notYet('posts feed --watch');
    const items: Post[] = [];
    let after = i.after ?? null;
    for (let page = 0; page < (i.all ? i.max ?? 10 : 1); page++) {
      const out = (await sulfurApi<{ homeTimeline: FeedResult }>(ctx, `query($v: String, $a: String, $l: Int) { homeTimeline(variant: $v, after: $a, limit: $l) { items { ${POST} } next } }`, { v: i.clips ? 'clips' : 'all', a: after, l: i.limit ?? null })).homeTimeline;
      items.push(...out.items);
      after = out.next ?? null;
      if (!after) break;
    }
    return { items, next: after };
  },
  text: (r) => [...(r.items.length ? r.items.map((p) => `${paint.address(`@${p.author.handle}`)}${p.address ? ` ${paint.address(p.address)}` : ''} ${paint.dim(p.id)}\n  ${(p.text ?? '').replace(/\n/g, '\n  ')}${p.counts ? `\n  ${paint.dim(`${p.counts.likes} likes, ${p.counts.replies} replies, ${p.counts.reposts} reposts`)}` : ''}`) : ['Nothing in the timeline yet']), ...(r.next ? [paint.dim(`next page: --after ${r.next}`)] : [])].join('\n'),
};

const MEDIA_OPTIONS = ['image', 'alt', 'video', 'longVideo', 'link', 'source', 'license', 'attribution', 'announcement', 'dryRun'] as const;
type PostInput = { text?: string; in?: string; replyPolicy?: string; file?: string; requestId?: string } & Partial<Record<(typeof MEDIA_OPTIONS)[number], unknown>>;

export const sulfurPost: Command<PostInput, { id: string; state: string; universe: string }> = {
  name: 'posts create', summary: 'Publish a text post in a universe',
  details: 'The text is published at --in (%universe, %universe/sub; the missing levels are created as the app does). Images, clips, links and sources are not yet on the new backend.',
  examples: ['breakrocks --backend sulfur posts create "Hello" --in %paris', 'echo "Hello" | breakrocks --backend sulfur posts create - --in %paris'],
  input: object({
    text: str('The text ("-": the standard input)'), in: str('The address of publication (%universe, %universe/sub)'), replyPolicy: str('Who may reply', { enum: ['everyone', 'followed', 'mentioned', 'nobody'] }),
    requestId: str('The id of the post (a UUIDv7; a repeat after a lost answer is created once)'),
    image: list('Not yet on the new backend'), alt: list('Not yet on the new backend'), video: str('Not yet on the new backend'), longVideo: str('Not yet on the new backend'), link: str('Not yet on the new backend'), source: list('Not yet on the new backend'), license: str('Not yet on the new backend'), attribution: str('Not yet on the new backend'), announcement: bool('Not yet on the new backend'), dryRun: bool('Not yet on the new backend'), file: str('Not yet on the new backend'),
  }),
  output: openObject({ id: str('The post'), state: str('Its state'), universe: str('Where') }),
  args: { positionals: ['text'] },
  run: async (ctx, i) => {
    for (const k of [...MEDIA_OPTIONS, 'file'] as const) if (i[k] !== undefined && !(Array.isArray(i[k]) && !(i[k] as unknown[]).length)) throw notYet(`posts create --${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
    let text = i.text;
    if (text === '-') {
      if (!ctx.io.readStdin) throw usageError('TEXT_REQUIRED', '"-" needs a standard input');
      text = (await ctx.io.readStdin()).replace(/\r?\n$/, '');
    }
    if (!text?.trim()) throw usageError('POST_EMPTY', 'A post has a text: breakrocks posts create "…" --in %universe');
    if (!i.in) throw usageError('ADDRESS_REQUIRED', 'On the new backend a post names its universe: --in %universe');
    const universe = i.in.startsWith('%') ? i.in : `%${i.in}`;
    const id = i.requestId ?? uuidv7(ctx.now());
    const out = (await sulfurApi<{ publish: { id: string; state: string } }>(ctx, 'mutation($input: PublishInput!) { publish(input: $input) { id state } }', { input: { id, universe, text, ...(i.replyPolicy ? { replyPolicy: i.replyPolicy } : {}) } })).publish;
    return { ...out, universe };
  },
  text: (r) => `${paint.ok('Published')} in ${paint.address(r.universe)} ${paint.dim(`${r.id} (${r.state})`)}`,
  quiet: (r) => r.id,
};

/** The commands of the new backend, by the registry name they stand in for. */
export const SULFUR_COMMANDS: ReadonlyMap<string, AnyCommand> = new Map<string, AnyCommand>([sulfurLogin, sulfurLogout, sulfurWhoami, sulfurProfileShow, sulfurProfileSet, sulfurFeed, sulfurPost].map((c) => [c.name, c as AnyCommand]));

