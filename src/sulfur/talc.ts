// The CLI's GraphQL requests (API v2, the talc schema) on the new backend (native-sulfur), the seam of src/session.ts api():
// - a root field the server serves under its talc name (D-612): the document fitted to the server's schema (fit.ts) and
//   sent with the profile's session (session.ts sulfurApi), its answer completed (a field left out: null, a list: []);
// - a root field the server serves otherwise by design (server docs/talc-deviations.md): its adapter (ADAPTERS) asks the
//   server's operation and answers the talc shape;
// - neither: NOT_ON_NEW_BACKEND, the operation named.
// Image paths the server answers relative to the cell's media domain are left as they are (the CLI prints them).
import type { Context } from '../context.js';
import { CliError, platformRefusal, usageError } from '../errors.js';
import { uuidv7 } from '../ids.js';
import { notServed, fillLeftOut, fitDocument, parseOperations } from './fit.js';
import { readSulfurSession, sulfurApi } from './session.js';
import { SERVER } from './schema.generated.js';

type Json = Record<string, unknown>;

/** One root field of a talc document, as an adapter reads it. */
export type RootCall = {
  name: string; key: string; kind: 'query' | 'mutation' | 'subscription';
  /** Its arguments: the variables they name, read; a literal as written (true, false, numbers, strings, null). */
  args: Record<string, unknown>;
  /** Its selection as written ("{ id handle }"), or "" for a value. */
  selection: string;
};
export type Adapter = (ctx: Context, call: RootCall) => Promise<unknown>;

const literal = (text: string): unknown => {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  if (/^-?[0-9]/.test(text)) return Number(text);
  if (text.startsWith('"')) { try { return JSON.parse(text); } catch { return text.slice(1, -1); } }
  return text;
};

/**
 * What a command knows that its talc operation does not carry and the server needs (a message's discussion id: deviation
 * 1c, D-628), handed to the adapter of this run.
 */
const HINTS = new WeakMap<Context, Record<string, string>>();
export const sulfurHint = (ctx: Context, key: string, value: unknown) => { if (typeof value === 'string' && value) HINTS.set(ctx, { ...HINTS.get(ctx), [key]: value }); };
const hinted = (ctx: Context, key: string) => HINTS.get(ctx)?.[key];
const SERVER_ARGS = (field: string): Record<string, string> => (SERVER.mutation[field] ?? SERVER.query[field])?.[1] ?? {};

/** A message's operation sent with its discussion's id (and its thread root, when given), which the server requires (1c, D-628). */
const onMessage = (field: string): Adapter => async (ctx, call) => {
  const discussionId = hinted(ctx, 'discussionId');
  if (!discussionId) throw usageError('DISCUSSION_REQUIRED', `On the new backend a message is named with its discussion: --discussion <discussion id> (${field})`);
  const threadRoot = hinted(ctx, 'threadRoot');
  const vars: Json = { ...call.args, discussionId, ...(threadRoot ? { threadRoot } : {}) };
  const decl = Object.entries(SERVER_ARGS(field)).filter(([k]) => vars[k] !== undefined && vars[k] !== null);
  const doc = `${call.kind}(${decl.map(([k, t]) => `$${k}: ${t}`).join(', ')}) { ${field}(${decl.map(([k]) => `${k}: $${k}`).join(', ')}) ${call.selection} }`;
  return (await runServed(ctx, doc, Object.fromEntries(decl.map(([k]) => [k, vars[k]]))))[field];
};

/** The id of the account signed in on the new backend. */
export function myId(ctx: Context): string {
  const s = readSulfurSession(ctx);
  if (!s) throw platformRefusal('SIGN_IN_REQUIRED', 'Not signed in on the new backend');
  return s.accountId;
}

/** Asks [selection] of the talc Account of [id] (server `accounts(ids)`: the talc Account), fitted; null when none. */
export async function talcAccount(ctx: Context, id: string, selection: string): Promise<Json | null> {
  const doc = `query($ids: [ID!]!) { accounts(ids: $ids) ${selection || '{ id }'} }`;
  const data = await runServed(ctx, doc, { ids: [id] });
  return ((data.accounts as (Json | null)[] | undefined) ?? [])[0] ?? null;
}

/** The id of an account given as @handle or id. */
async function accountId(ctx: Context, value: unknown): Promise<string> {
  const v = String(value ?? '').trim();
  if (!v.startsWith('@')) return v;
  const found = (await sulfurApi<{ accountByHandle: { id: string } | null }>(ctx, 'query($h: String!) { accountByHandle(handle: $h) { id } }', { h: v.slice(1) })).accountByHandle;
  if (!found) throw usageError('ACCOUNT_NOT_FOUND', `No account ${v}`, { handle: v });
  return found.id;
}

/** A follow address as the server reads it (social-graph/following.feature): `@bob`, `@bob%paris/sport`, `%paris@bob`. */
export function splitFollowAddress(address: string): { handle: string; path: string | null } {
  const a = address.trim();
  const m = /^@([^%@]+)(?:%([^%@]+))?$/u.exec(a) ?? /^%([^%@]+)@([^%@]+)$/u.exec(a);
  if (!m) throw usageError('BAD_ADDRESS', `Not a follow address: "${address}" (@handle, @handle%universe)`);
  const [handle, path] = a.startsWith('@') ? [m[1], m[2]] : [m[2], m[1]];
  // "@bob%root" is "@bob".
  return { handle, path: path && pathKeyOf(path) !== 'root' ? path : null };
}

/**
 * The server's path key of a universe path (server src/core/graph/scopes.ts: each level canonical, NFC and case-folded,
 * mapped through the Unicode confusables, escaped for `%`, `#` and `~`). The CLI has the confusables of the characters a
 * universe name of ASCII letters and digits can hold (0 → o, 1 → l, m → rn); a level outside them is undefined (unknown).
 */
export function pathKeyOf(path: string): string | undefined {
  const canonical = (t: string) => t.normalize('NFC').toLowerCase().normalize('NFC');
  const levels = path.replace(/^%/, '').split('/');
  if (!levels.every((l) => /^[\x21-\x7e]+$/.test(l))) return undefined;
  const ascii: Record<string, string> = { '0': 'o', '1': 'l', m: 'rn', '|': 'l', '`': "'", '"': "''" };
  return levels.map((l) => canonical([...canonical(l)].map((c) => ascii[c] ?? c).join('')).replace(/[%#~]/g, (c) => (c === '%' ? '%25' : c === '#' ? '%23' : '%7E'))).join('/');
}

/**
 * Whether a relation (server `relations`: `follows` for any follow, `universes` the path keys of the scoped ones, never the
 * everywhere one) follows the account in [path] (null: everywhere). An everywhere follow covers every universe. When the
 * relation cannot tell (scoped follows only and the everywhere one asked, a universe not among them, a name the CLI
 * cannot key): null, never a guess.
 */
export function followScope(r: { follows: boolean; universes: string[] } | undefined, path: string | null): boolean | null {
  if (!r?.follows) return false;
  const scoped = r.universes ?? [];
  // No scope listed: the follow is the everywhere one.
  if (!scoped.length) return true;
  if (path === null) return null;
  const key = pathKeyOf(path);
  if (key !== undefined && scoped.includes(key)) return true;
  return null;
}

/** The discussion id of a talc DiscussionRefInput (a conversation, a group chat, a universe discussion). */
async function discussionIdOf(ctx: Context, ref: Json): Promise<string> {
  if (typeof ref.groupChatId === 'string' && ref.groupChatId) return ref.groupChatId;
  if (typeof ref.accountId === 'string' && ref.accountId) {
    const other = await accountId(ctx, ref.accountId);
    return ['dm', ...[myId(ctx), other].sort()].join('.');
  }
  if (typeof ref.channel === 'string' && ref.channel) {
    const d = (await sulfurApi<{ universeDiscussion: { id: string } | null }>(ctx, 'query($a: String) { universeDiscussion(address: $a) { id } }', { a: ref.channel })).universeDiscussion;
    if (!d) throw platformRefusal('CHANNEL_NOT_FOUND', `No universe discussion ${ref.channel}`);
    return d.id;
  }
  throw usageError('DISCUSSION_REQUIRED', 'Name the discussion: --with, --group or --channel');
}

const relation = async (ctx: Context, id: string) => (await sulfurApi<{ relations: { follows: boolean; blocked: boolean; blockedBy: boolean; muted: boolean; connected: boolean }[] }>(ctx, 'query($ids: [ID!]!) { relations(ids: $ids) { accountId follows blocked blockedBy muted connected } }', { ids: [id] })).relations[0];

/** The talc ConnectionState of a relation (setBlock, setMute answer it). */
const connectionState = (r: { blocked: boolean; blockedBy: boolean; muted: boolean; connected: boolean } | undefined, accountIdValue: string) => ({
  accountId: accountIdValue, state: r?.connected ? 'CONNECTED' : 'NONE', blocked: !!r?.blocked, blockedMe: !!r?.blockedBy, muted: !!r?.muted,
});

/**
 * The talc root fields the server serves otherwise (server docs/talc-deviations.md), by their talc name: each answers the
 * talc value of its field.
 */
export const ADAPTERS: Record<string, Adapter> = {
  // 1d: `me` is the new `Me`; the talc account under `accounts([my id])`.
  me: (ctx, call) => talcAccount(ctx, myId(ctx), call.selection),
  // 1d: `account(id)` is the new `Card`; the talc account under `accounts([id])`.
  account: async (ctx, call) => talcAccount(ctx, await accountId(ctx, call.args.id), call.selection),
  // 1d: `updateProfile(input: ProfileInput { name, bio, avatar })` (talc: ProfileUpdateInput, expected).
  updateProfile: async (ctx, call) => {
    const input = (call.args.input ?? {}) as Json;
    for (const k of ['links', 'aiDescription', 'organizationName']) if (input[k] !== undefined && input[k] !== null) throw notServed(`updateProfile(input.${k})`, 'the profile has a name, a bio and an avatar there');
    const clear = Array.isArray(input.clear) ? input.clear as string[] : [];
    const out: Json = {};
    if (input.displayName !== undefined) out.name = input.displayName;
    if (input.bio !== undefined) out.bio = input.bio;
    if (input.avatar !== undefined) out.avatar = input.avatar;
    for (const part of clear) {
      const k = String(part).toLowerCase();
      if (k === 'bio') out.bio = '';
      else if (k === 'avatar') out.avatar = null;
      else if (k === 'displayname' || k === 'display_name') out.name = '';
      else throw notServed(`updateProfile(clear ${part})`);
    }
    await sulfurApi(ctx, 'mutation($input: ProfileInput!) { updateProfile(input: $input) { id } }', { input: out });
    return talcAccount(ctx, myId(ctx), call.selection);
  },
  // 1d: `follow(address)` / `unfollow(address)` (talc: setFollow(following)); the talc Follow read from the answer. The
  // server's Following has no date: createdAt is null (never the time of this device).
  setFollow: async (ctx, call) => {
    const address = String(call.args.address ?? '');
    if (call.args.following === false) { await sulfurApi(ctx, 'mutation($a: String!) { unfollow(address: $a) }', { a: address }); return null; }
    const out = (await sulfurApi<{ follow: { account: { id: string }; universes: string[] } }>(ctx, 'mutation($a: String!) { follow(address: $a) { account { id } universes } }', { a: address })).follow;
    const universe = address.includes('%') ? address.slice(address.indexOf('%')) : null;
    return { address, universe, createdAt: null, account: await talcAccount(ctx, out.account.id, subSelection(call.selection, 'account')) };
  },
  // 1d: `relations(ids)` (talc: isFollowing(address)); an account's address only (@handle, @handle%universe), see followScope.
  isFollowing: async (ctx, call) => {
    const address = String(call.args.address ?? '');
    if (!address.startsWith('@') && !/^%[^@%]+@[^@%]+$/.test(address)) throw notServed('isFollowing(%universe)', 'a universe is followed by joining it there');
    const { handle, path } = splitFollowAddress(address);
    const r = (await sulfurApi<{ relations: { follows: boolean; universes: string[] }[] }>(ctx, 'query($ids: [ID!]!) { relations(ids: $ids) { follows universes } }', { ids: [await accountId(ctx, `@${handle}`)] })).relations[0];
    return followScope(r, path);
  },
  // 1d: `block` / `unblock` (talc: setBlock(blocked)).
  setBlock: async (ctx, call) => {
    const id = await accountId(ctx, call.args.accountId);
    await sulfurApi(ctx, `mutation($id: ID!) { ${call.args.blocked === false ? 'unblock' : 'block'}(accountId: $id) }`, { id });
    return connectionState(await relation(ctx, id), id);
  },
  // 1d: `mute` / `unmute` (talc: setMute(muted)).
  setMute: async (ctx, call) => {
    const id = await accountId(ctx, call.args.accountId);
    await sulfurApi(ctx, `mutation($id: ID!) { ${call.args.muted === false ? 'unmute' : 'mute'}(accountId: $id) }`, { id });
    return connectionState(await relation(ctx, id), id);
  },
  // 1c (D-628): a message is keyed by its discussion; a thread reply by its root too.
  reactToMessage: onMessage('reactToMessage'),
  unreactToMessage: onMessage('unreactToMessage'),
  threadMessages: onMessage('threadMessages'),
  replyInThread: onMessage('replyInThread'),
  // The contribution votes of a temporary universe discussion: named by its discussion too (`--discussion`).
  voteOnContribution: onMessage('voteOnContribution'),
  withdrawContributionVote: onMessage('withdrawContributionVote'),
  // A quick poll is sent to a discussion by its id (talc: a DiscussionRefInput): a group chat's id is its discussion's,
  // a conversation's is `dm.<the two account ids, sorted>`, a universe discussion's is read by its address.
  sendQuickPoll: async (ctx, call) => {
    const discussionId = await discussionIdOf(ctx, (call.args.discussion ?? {}) as Json);
    const doc = `mutation($d: ID!, $q: String!, $c: [String!]!, $r: ID!) { sendQuickPoll(discussionId: $d, question: $q, choices: $c, requestId: $r) ${call.selection || '{ id }'} }`;
    return (await runServed(ctx, doc, { d: discussionId, q: call.args.question, c: call.args.choices, r: call.args.requestId })).sendQuickPoll;
  },
  // A theme is deleted by its id there (talc: by its universe and name): read first (theme(universe, name)), its talc
  // answer the theme as it was, marked deleted.
  deleteTheme: async (ctx, call) => {
    const selection = call.selection || '{ id }';
    const withId = /\{\s*id\b|\sid\b/.test(selection) ? selection : selection.replace(/^\{/, '{ id ');
    const theme = (await runServed(ctx, `query($u: String!, $n: String!) { theme(universe: $u, name: $n) ${withId} }`, { u: call.args.universe, n: call.args.name })).theme as Json | null;
    if (!theme?.id) throw platformRefusal('THEME_NOT_FOUND', `No theme ${String(call.args.universe)}/${String(call.args.name)}`);
    await sulfurApi(ctx, 'mutation($id: ID!) { deleteTheme(id: $id) }', { id: theme.id });
    return 'deleted' in theme ? { ...theme, deleted: true } : theme;
  },
  // 6c-1: a place is saved with its name and point (talc: its id alone), read from its card (placeCard).
  saveToMyPlaces: async (ctx, call) => {
    const input = { ...((call.args.input ?? {}) as Json) };
    if (input.kind === 'PLACE' && (typeof input.name !== 'string' || !input.point)) {
      const card = (await sulfurApi<{ placeCard: { name: string; point: { lat: number; lon: number } } | null }>(ctx, 'query($id: String!) { placeCard(placeId: $id) { name point { lat lon } } }', { id: String(input.targetId ?? '') })).placeCard;
      if (!card) throw platformRefusal('MY_PLACES_TARGET_INVALID', 'No such place (placeCard)');
      input.name = card.name;
      input.point = { lat: card.point.lat, lon: card.point.lon };
    }
    const doc = `mutation($input: SaveToMyPlacesInput!, $requestId: ID!) { saveToMyPlaces(input: $input, requestId: $requestId) ${call.selection || '{ id }'} }`;
    return (await runServed(ctx, doc, { input, requestId: call.args.requestId })).saveToMyPlaces;
  },
};

/** The selection of the field [name] inside [selection] ("{ account { id } address }" → "{ id }"), or "". */
export function subSelection(selection: string, name: string): string {
  if (!selection) return '';
  try {
    const op = parseOperations(`query ${selection}`)[0];
    const f = op.selection.items.find((i) => i.kind === 'field' && i.key === name);
    return f && f.kind === 'field' && f.selection ? `query ${selection}`.slice(f.selection.start, f.selection.end) : '';
  } catch { return ''; }
}

/** A document whose root fields are all served as is: fitted, sent, completed ([partial]: refusals beside the data kept, `_errors`). */
async function runServed(ctx: Context, query: string, variables: Json, options: { partial?: boolean } = {}): Promise<Json> {
  const fitted = fitDocument(query, variables);
  const data = await sulfurApi<Json>(ctx, fitted.document, fitted.variables, options);
  return fillLeftOut(data, fitted.left);
}

/** The operations that send a message: their requestId is its id, a UUIDv7 the server dates (MESSAGE_ID_INVALID beyond a minute). */
const MESSAGE_SENDS = new Set(['sendMessage', 'requestConnection', 'replyInThread', 'sendQuickPoll']);

/**
 * A talc request (a document of the CLI and its variables) on the new backend: its talc data. A message refused
 * `MESSAGE_ID_INVALID` (its id, made before a long media upload or a slow turn, is dated more than a minute off) is sent
 * again once with an id of now: the server answers a message stored already whatever the age of its id, so a refused one
 * was never stored and nothing is made twice.
 */
export async function sulfurTalc<T>(ctx: Context, query: string, variables: Json = {}, options: { partial?: boolean } = {}): Promise<T> {
  try { return await sulfurTalcOnce<T>(ctx, query, variables, options); } catch (error) {
    if (!(error instanceof CliError) || error.code !== 'MESSAGE_ID_INVALID') throw error;
    const name = redatable(query);
    if (!name) throw error;
    ctx.progress('The identifier of the message is too old for the platform: sending it again with a new one');
    return sulfurTalcOnce<T>(ctx, query, { ...variables, [name]: uuidv7(ctx.now()) }, options);
  }
}

/** The variable that carries the requestId of the message send of [query] (one root field of MESSAGE_SENDS), else undefined. */
function redatable(query: string): string | undefined {
  try {
    const ops = parseOperations(query);
    const field = ops.length === 1 && ops[0].kind === 'mutation' ? ops[0].selection.items.find((i) => i.kind === 'field' && MESSAGE_SENDS.has(i.name)) : undefined;
    return field && field.kind === 'field' ? field.args.find((a) => a.name === 'requestId')?.variable : undefined;
  } catch { return undefined; }
}

async function sulfurTalcOnce<T>(ctx: Context, query: string, variables: Json = {}, options: { partial?: boolean } = {}): Promise<T> {
  const ops = parseOperations(query);
  if (ops.length !== 1) throw notServed('a document of several operations');
  const op = ops[0];
  const adapted = op.selection.items.filter((i) => i.kind === 'field' && ADAPTERS[i.name]);
  if (!adapted.length) return runServed(ctx, query, variables, options) as Promise<T>;
  const data: Json = {};
  // The served root fields, sent together without the adapted ones.
  const served = op.selection.items.filter((i) => i.kind === 'field' && !ADAPTERS[i.name] && i.name !== '__typename');
  if (served.length) {
    let doc = '';
    let from = 0;
    for (const item of adapted) { doc += query.slice(from, item.start); from = item.end; }
    doc += query.slice(from);
    Object.assign(data, await runServed(ctx, doc, variables));
  }
  for (const item of adapted) {
    if (item.kind !== 'field') continue;
    const args: Record<string, unknown> = {};
    for (const a of item.args) args[a.name] = a.variable !== undefined ? variables[a.variable] : literal(query.slice(query.indexOf(':', a.start) + 1, a.end).trim());
    data[item.key] = await ADAPTERS[item.name](ctx, { name: item.name, key: item.key, kind: op.kind, args, selection: item.selection ? query.slice(item.selection.start, item.selection.end) : '' });
  }
  return data as T;
}
