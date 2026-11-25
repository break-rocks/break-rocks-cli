// The CLI's GraphQL requests (API v2, the talc schema) on the new backend (native-sulfur), the seam of src/session.ts api():
// - a root field the server serves under its talc name (D-612): the document fitted to the server's schema (fit.ts) and
//   sent with the profile's session (session.ts sulfurApi), its answer completed (a field left out: null, a list: []);
// - a root field the server serves otherwise by design (server docs/talc-deviations.md): its adapter (ADAPTERS) asks the
//   server's operation and answers the talc shape;
// - neither: NOT_ON_NEW_BACKEND, the operation named.
// Image paths the server answers relative to the cell's media domain are left as they are (the CLI prints them).
import type { Context } from '../context.js';
import { platformRefusal, usageError } from '../errors.js';
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
  // 1d: `follow(address)` / `unfollow(address)` (talc: setFollow(following)); the talc Follow read from the answer.
  setFollow: async (ctx, call) => {
    const address = String(call.args.address ?? '');
    if (call.args.following === false) { await sulfurApi(ctx, 'mutation($a: String!) { unfollow(address: $a) }', { a: address }); return null; }
    const out = (await sulfurApi<{ follow: { account: { id: string }; universes: string[] } }>(ctx, 'mutation($a: String!) { follow(address: $a) { account { id } universes } }', { a: address })).follow;
    const universe = address.includes('%') ? address.slice(address.indexOf('%')) : null;
    return { address, universe, createdAt: new Date(ctx.now()).toISOString(), account: await talcAccount(ctx, out.account.id, subSelection(call.selection, 'account')) };
  },
  // 1d: `relations(ids)` (talc: isFollowing(address)); an account's address only (@handle, @handle%universe).
  isFollowing: async (ctx, call) => {
    const address = String(call.args.address ?? '');
    if (!address.startsWith('@')) throw notServed('isFollowing(%universe)', 'a universe is followed by joining it there');
    const at = address.indexOf('%');
    const r = (await sulfurApi<{ relations: { follows: boolean; universes: string[] }[] }>(ctx, 'query($ids: [ID!]!) { relations(ids: $ids) { follows universes } }', { ids: [await accountId(ctx, at < 0 ? address : address.slice(0, at))] })).relations[0];
    return at < 0 ? !!r?.follows : !!r?.follows || !!r?.universes.includes(address.slice(at));
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

/** A document whose root fields are all served as is: fitted, sent, completed. */
async function runServed(ctx: Context, query: string, variables: Json): Promise<Json> {
  const fitted = fitDocument(query, variables);
  const data = await sulfurApi<Json>(ctx, fitted.document, fitted.variables);
  return fillLeftOut(data, fitted.left);
}

/** A talc request (a document of the CLI and its variables) on the new backend: its talc data. */
export async function sulfurTalc<T>(ctx: Context, query: string, variables: Json = {}): Promise<T> {
  const ops = parseOperations(query);
  if (ops.length !== 1) throw notServed('a document of several operations');
  const op = ops[0];
  const adapted = op.selection.items.filter((i) => i.kind === 'field' && ADAPTERS[i.name]);
  if (!adapted.length) return runServed(ctx, query, variables) as Promise<T>;
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
