// Reading the platform: posts, feeds, universes, Explore, the
// time column, the live line, accounts, the life of a universe, notifications, the export of a
// universe, a post rendered as plain text. Never more than the reader may read: the refusals are the
// app's (PRIVATE_UNIVERSE_NOT_FOUND, AGENT_OPERATOR_NO_SOCIAL_INTERACTIONS…). No search: the API has none.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { apiCommand } from '../api/command.js';
import { outputSchema, selection } from '../api/graphql.js';
import type { Context } from '../context.js';
import { usageError } from '../errors.js';
import type { Command } from '../registry.js';
import { bool, int, list, object, openObject, str } from '../schema.js';
import { api } from '../session.js';
import { describeTerritory } from './geo.js';
import { WATCH_PROPERTIES, watchItems, type LiveSource, type WatchInput } from '../watch.js';

/** The Event API channels of a reading, from watchLive (its lease: 10 minutes, renewed by --watch). */
export const liveOf = (ctx: Context, address: string | null, types: string[]): LiveSource => ({
  channels: async () => ((await api<{ watchLive: { channels: { channel: string }[] } | null }>(ctx, 'mutation($a: String) { watchLive(address: $a) { channels { channel shard } until } }', { a: address })).watchLive?.channels ?? []).map((c) => c.channel),
  matches: (e) => types.includes(e.type),
});
/** The channel of the account: /users/<account id>. */
export const accountChannel = (types: string[], match: (e: Record<string, unknown>) => boolean = () => true): LiveSource => ({ channels: async (id) => [`/users/${id}`], matches: (e) => types.includes(e.type) && match(e) });

type Post = { id: string; createdAt: string; kind: string; language?: string | null; clip?: unknown; display: string; author: { handle: string; id: string }; universe: string; url: string; images: { url: string; alt?: string | null }[]; link?: { url: string; title?: string | null } | null; replyCount: number; likeCount: number; repostCount: number; tags: string[] };
type Page<T> = { items: T[]; next: string | null; [k: string]: unknown };

const POST = selection('Post', 1);
const PAGE_OF_POSTS = `{ items ${POST} next reason }`;
const postsOutput = outputSchema('PostPage', 2);

/** "2h", "30m", "7d", "45s", or a date (ISO 8601): the instant it names (INVALID_INPUT otherwise). */
export function instantOf(value: string, now: number): number {
  const m = /^(\d+)\s*(s|m|h|d|w)$/.exec(value.trim());
  if (m) return now - Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[m[2] as 's']! * 1000;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) throw usageError('INVALID_INPUT', `"${value}" is neither a duration (2h, 30m, 7d) nor a date`);
  return at;
}

type ListInput = { address: string; filter?: string; limit?: number; after?: string; all?: boolean; max?: number; since?: string; until?: string; kind?: 'post' | 'clip'; language?: string } & WatchInput;
const filterProps = {
  since: str('Only the posts after this: a duration (2h, 30m, 7d) or a date'),
  until: str('Only the posts before this: a duration or a date'),
  kind: str('Only posts without a clip (post), or with a clip (clip)', { enum: ['post', 'clip'] }),
  language: str('Only the posts in this language (fr, en…)'),
};

/** Reads pages of posts, the filters of the command applied (the API gives the newest first). */
async function readPosts(ctx: Context, read: (after: string | null) => Promise<Page<Post>>, input: { after?: string; all?: boolean; max?: number; since?: string; until?: string; kind?: string; language?: string }): Promise<Page<Post>> {
  const since = input.since ? instantOf(input.since, ctx.now()) : undefined;
  const until = input.until ? instantOf(input.until, ctx.now()) : undefined;
  const keep = (p: Post) => {
    const at = Date.parse(p.createdAt);
    return (since === undefined || at >= since) && (until === undefined || at <= until)
      && (!input.kind || (input.kind === 'clip') === !!p.clip) && (!input.language || p.language === input.language);
  };
  const items: Post[] = [];
  let next: string | null = input.after ?? null;
  let extra: Record<string, unknown> = {};
  for (let page = 0; page < (input.all ? input.max ?? 10 : 1); page++) {
    const answer = await read(next);
    const { items: got, next: after, ...rest } = answer;
    extra = rest;
    items.push(...got.filter(keep));
    next = after;
    if (!next || (since !== undefined && got.some((p) => Date.parse(p.createdAt) < since))) break;
  }
  return { ...extra, items, next };
}

export const postsList: Command<ListInput, unknown> = {
  name: 'posts list', summary: 'The posts of an address: a universe, a sub-universe, a tag, an account (posts)',
  description: 'Any address of navigation: %universe, %universe/sub, %universe#tag, #tag, @handle. --since, --until, --kind and --language filter the pages read. --watch reads again and writes each new post.',
  examples: ['breakrocks posts list %france/paris#sport --limit 20', 'breakrocks posts list @alice --since 2h --json', 'breakrocks posts list %test-village-sport --watch --jsonl --interval 15'],
  input: object({
    address: str('The address: %universe, %universe/sub, %universe#tag, #tag, @handle'),
    filter: str('The feed filter of a universe', { enum: ['ALL', 'DISCUSSED', 'LEADERSHIP', 'PROJECTS', 'SUB_UNIVERSES'] }),
    limit: int('Posts per page', { minimum: 1, maximum: 100 }), after: str('The cursor of the next page'),
    all: bool('Follow the pages (bounded by --max)'), max: int('Pages at most with --all', { minimum: 1, maximum: 100, default: 10 }),
    ...filterProps, ...WATCH_PROPERTIES,
  }, ['address']),
  output: postsOutput, args: { positionals: ['address'] },
  run: async (ctx, input) => {
    const read = async (after: string | null) => (await api<{ posts: Page<Post> }>(ctx, `query($a: String!, $after: String, $f: PostsFilter, $l: Int) { posts(address: $a, after: $after, filter: $f, limit: $l) ${PAGE_OF_POSTS} }`, { a: input.address, after, f: input.filter ?? null, l: input.limit ?? null })).posts;
    if (input.watch) return watchItems(ctx, input, async () => (await readPosts(ctx, read, { ...input, after: undefined, all: false })).items, (p) => p.id, liveOf(ctx, input.address, ['posts.new']));
    return readPosts(ctx, read, input);
  },
  text: (r) => renderPosts(r),
};

/** Posts as plain text: author, place, date, text. */
export function renderPosts(r: unknown): string {
  const page = r as Page<Post> & { watched?: boolean };
  if (page.watched) return `Watched: ${JSON.stringify(r)}`;
  if (!page.items?.length) return '(no post)';
  return [...page.items.map((p) => `@${p.author?.handle} in ${p.universe}, ${p.createdAt}  [${p.id}]\n${p.display}${p.images?.length ? `\n${p.images.map((i) => `[image] ${i.url}`).join('\n')}` : ''}`), ...(page.next ? [`next: ${page.next}`] : [])].join('\n\n');
}

export const postsShow: Command<{ id: string; thread?: boolean; reposts?: boolean; replies?: boolean }, unknown> = {
  name: 'posts show', summary: 'A post; with --thread its thread, --reposts its reposts', examples: ['breakrocks posts show 01a166cb-bfff-7237-81a6-fb564222fe97 --thread'],
  input: object({ id: str('The id of the post'), thread: bool('Its thread (the root and the replies)'), replies: bool('Its replies (same as --thread)'), reposts: bool('Its reposts') }, ['id']),
  output: openObject({ post: outputSchema('Post', 1), thread: outputSchema('Thread', 2), reposts: postsOutput }), args: { positionals: ['id'] },
  run: async (ctx, { id, thread, replies, reposts }) => {
    const parts = [`post(id: $id) ${POST}`];
    if (thread || replies) parts.push(`thread(id: $id) { root { id } items ${POST} next }`);
    if (reposts) parts.push(`reposts(id: $id) ${PAGE_OF_POSTS}`);
    return api(ctx, `query($id: ID!) { ${parts.join(' ')} }`, { id });
  },
  quiet: () => undefined,
};

type FeedInput = { new?: boolean; clips?: boolean; address?: string; since?: string; after?: string; all?: boolean; max?: number; limit?: number } & WatchInput;

export const feed: Command<FeedInput, unknown> = {
  name: 'feed', summary: 'The feed of the account (timeline); --clips its clips, --new what is new since --since',
  description: '--new answers newPosts (how many posts are new, by whom) since --since (default 1h), in an --address or the timeline. --watch reads the feed again and writes each new post.',
  examples: ['breakrocks feed', 'breakrocks feed --clips --address %gaming', 'breakrocks feed --new --since 30m', 'breakrocks feed --watch --jsonl'],
  input: object({
    new: bool('How many posts are new (newPosts)'), clips: bool('The clips (clipFeed)'), address: str('An address, for --clips and --new'), since: str('Since when, for --new (2h, 30m, a date)', { default: '1h' }),
    after: str('The cursor of the next page'), all: bool('Follow the pages'), max: int('Pages at most with --all', { minimum: 1, maximum: 100, default: 10 }), limit: int('Clips per page', { minimum: 1, maximum: 100 }),
    ...WATCH_PROPERTIES,
  }),
  output: openObject({ items: list('Posts', outputSchema('Post', 1)), next: { type: ['string', 'null'] }, count: int('With --new: posts new'), authors: list('With --new: their authors') }),
  run: async (ctx, input) => {
    if (input.new) {
      const since = new Date(instantOf(input.since ?? '1h', ctx.now())).toISOString();
      return (await api<{ newPosts: unknown }>(ctx, 'query($a: String, $s: AWSDateTime) { newPosts(address: $a, since: $s) { count authors { id handle displayName kind } } }', { a: input.address ?? null, s: since })).newPosts;
    }
    const read = input.clips
      ? async (after: string | null) => (await api<{ clipFeed: Page<Post> }>(ctx, `query($a: String, $after: String, $l: Int) { clipFeed(address: $a, after: $after, limit: $l) ${PAGE_OF_POSTS} }`, { a: input.address ?? null, after, l: input.limit ?? null })).clipFeed
      : async (after: string | null) => (await api<{ timeline: Page<Post> }>(ctx, `query($after: String) { timeline(after: $after) ${PAGE_OF_POSTS} }`, { after })).timeline;
    if (input.watch) return watchItems(ctx, input, async () => (await read(null)).items, (p) => p.id, input.clips ? liveOf(ctx, input.address ?? null, ['posts.new']) : liveOf(ctx, null, ['timeline.new']));
    return readPosts(ctx, read, input);
  },
  text: (r) => ((r as { count?: number }).count !== undefined ? `${(r as { count: number }).count} new post(s)` : renderPosts(r)),
};

/** The page of a universe: its fields down to 2, its pages without their documents (universes page get --document reads one). */
const UNIVERSE = selection('Universe', 2).replace(`pages ${selection('PageOfUniverse', 1)}`, 'pages { kind name order hidden removed version url }');

type UniverseShow = { universe: Record<string, unknown>; theme?: unknown; governance?: unknown; members?: unknown };

export const universesShow: Command<{ universe: string; members?: boolean }, UniverseShow> = {
  name: 'universes show', summary: 'The page of a universe: display, field, theme and its origin, layout, governance, residents, pinned rules, territory, pages, proposals waiting for support',
  examples: ['breakrocks universes show %test-village-multisport', 'breakrocks universes show %france --members --json'],
  input: object({ universe: str('The universe (%name)'), members: bool('Its members (universeMembers, first page)') }, ['universe']),
  output: openObject({ universe: outputSchema('Universe', 2), theme: outputSchema('Theme', 2), governance: outputSchema('UniverseGovernance', 1), members: outputSchema('UniverseMemberPage', 1) }),
  args: { positionals: ['universe'] },
  run: async (ctx, { universe, members }) => {
    const data = await api<{ universe: Record<string, unknown> & { themeRef?: { universe: string; name: string } } }>(ctx, `query($n: String!) { universe(name: $n) ${UNIVERSE} }`, { n: universe });
    if (!data.universe) throw usageError('UNIVERSE_NOT_FOUND', `No universe ${universe}`, { universe });
    const out: UniverseShow = { universe: data.universe };
    const ref = data.universe.themeRef;
    const tasks: Promise<void>[] = [];
    if (ref) tasks.push(api<{ theme: unknown }>(ctx, `query($u: String!, $n: String!, $in: String) { theme(universe: $u, name: $n, appliedIn: $in) ${selection('Theme', 2)} }`, { u: ref.universe, n: ref.name, in: universe }).then((r) => { out.theme = r.theme; }).catch((e) => { out.theme = { error: (e as { code?: string }).code }; }));
    tasks.push(api<{ universeGovernance: unknown }>(ctx, `query($u: String!) { universeGovernance(universe: $u) ${selection('UniverseGovernance', 1)} }`, { u: universe }).then((r) => { out.governance = r.universeGovernance; }).catch((e) => { out.governance = { error: (e as { code?: string }).code }; }));
    if (members) tasks.push(api<{ universeMembers: unknown }>(ctx, `query($u: String!) { universeMembers(universe: $u) ${selection('UniverseMemberPage', 1)} }`, { u: universe }).then((r) => { out.members = r.universeMembers; }));
    await Promise.all(tasks);
    return out;
  },
  text: (r) => {
    const u = r.universe as Record<string, unknown> & { themeRef?: { universe: string; name: string; version?: number }; layoutRef?: { name: string } };
    const t = r.theme as { name?: string; version?: number; creator?: { handle: string }; imageSlots?: Record<string, { url?: string | null } | null> } | undefined;
    const slots = t?.imageSlots ? Object.entries(t.imageSlots).filter(([, v]) => v?.url).map(([k, v]) => `  ${k}: ${v!.url}`) : [];
    return [`${u.name}${u.private ? ' (private)' : ''}`, `field: ${u.field ?? '-'}   residents: ${u.residentCount ?? '-'}   members: ${u.memberCount ?? '-'}`,
      `theme: ${u.themeRef ? `${u.themeRef.universe}/${u.themeRef.name} v${u.themeRef.version ?? '?'}` : u.theme}${u.themeOf ? ` (from ${u.themeOf})` : ''}${t?.creator ? ` by @${t.creator.handle}` : ''}`,
      ...slots, `layout: ${u.layoutRef?.name ?? u.defaultLayout ?? '-'}${u.layoutOf ? ` (from ${u.layoutOf})` : ''}`, `my role: ${u.myRole ?? '-'}`,
      `territory: ${describeTerritory((u.territory ?? null) as Parameters<typeof describeTerritory>[0])}`,
      `proposals waiting for support: ${u.proposalsWaitingSupport ?? '-'}`,
      `pages: ${((u.pages ?? []) as { name: string; hidden?: boolean }[]).map((p) => `${p.name}${p.hidden ? ' (hidden)' : ''}`).join(', ') || '-'}`,
      `governance: ${JSON.stringify(r.governance)}`].join('\n');
  },
};

const EXPLORE_PAGE = selection('ExploreUniversePage', 2);
export const universesList: Command<{ field?: string; language?: string; recent?: boolean; active?: boolean; new?: boolean; closeToLevel?: boolean; whereFollowed?: boolean; mine?: boolean }, unknown> = {
  name: 'universes list', summary: 'Explore the universes: by field, by language, recent, active, new, close to a level, mine',
  description: 'One list at a time: --field, --language, --recent, --new, --close-to-level, --where-followed, --mine; --active by default.',
  examples: ['breakrocks universes list --field SPORT', 'breakrocks universes list --language fr --json', 'breakrocks universes list --mine'],
  input: object({
    field: str('A field', { enum: ['CULTURE', 'ENTERTAINMENT', 'EVERYDAY_LIFE', 'GAMES', 'PLACES', 'POLITICS', 'SCIENCE', 'SPORT', 'TECH', 'WORK'] }), language: str('A language (fr, en…)'),
    recent: bool('The universes visited lately'), active: bool('The active universes (default)'), new: bool('The new universes'), closeToLevel: bool('Those close to their next level'),
    whereFollowed: bool('Where the accounts followed post'), mine: bool('My universes (myUniverses)'),
  }),
  output: { description: 'The list asked: an Explore page (items, next), or the recent universes' },
  run: async (ctx, i) => {
    if ([i.field, i.language, i.recent, i.active, i.new, i.closeToLevel, i.whereFollowed, i.mine].filter(Boolean).length > 1) throw usageError('INVALID_INPUT', 'One list at a time');
    if (i.field) return (await api<Record<string, unknown>>(ctx, `query($f: UniverseField!) { universesByField(field: $f) ${EXPLORE_PAGE} }`, { f: i.field })).universesByField;
    if (i.language) return (await api<Record<string, unknown>>(ctx, `query($l: String!) { universesInLanguage(language: $l) ${EXPLORE_PAGE} }`, { l: i.language })).universesInLanguage;
    if (i.recent) return (await api<Record<string, unknown>>(ctx, `{ recentUniverses ${selection('SubUniverse', 1)} }`)).recentUniverses;
    if (i.new) return (await api<Record<string, unknown>>(ctx, `{ newUniverses ${EXPLORE_PAGE} }`)).newUniverses;
    if (i.closeToLevel) return (await api<Record<string, unknown>>(ctx, `{ universesCloseToLevel ${EXPLORE_PAGE} }`)).universesCloseToLevel;
    if (i.whereFollowed) return (await api<Record<string, unknown>>(ctx, `{ whereFollowedAccountsPost ${EXPLORE_PAGE} }`)).whereFollowedAccountsPost;
    if (i.mine) return (await api<Record<string, unknown>>(ctx, `{ myUniverses ${selection('MyUniversePage', 2)} }`)).myUniverses;
    return (await api<Record<string, unknown>>(ctx, `{ activeUniverses ${selection('ActiveUniversePage', 2)} }`)).activeUniverses;
  },
};

export const universesSub = apiCommand({
  name: 'universes sub', summary: 'The sub-universes of a universe (--map: their map)', kind: 'query', op: 'subUniverses',
  examples: ['breakrocks universes sub %france', 'breakrocks universes sub %france --starts-with pa --order RECENT'],
  rename: { name: 'universe' }, positionals: ['universe'], descriptions: { universe: 'The universe (%name)', startsWith: 'The beginning of their names' },
});

export const explore: Command<{ trending?: boolean; forYou?: boolean; happening?: string; accounts?: boolean; suggestions?: string; language?: string; kind?: 'POSTS' | 'CLIPS' }, unknown> = {
  name: 'explore', summary: 'Explore: suggested posts, trending tags, recommendations, what happens now in a universe, accounts to follow',
  description: 'One at a time: --trending (trendingTags), --for-you (recommendations, --language, --kind), --happening %u (happeningNow), --accounts (accountsToFollow), --suggestions <text> (suggestions); suggestedPosts by default.',
  examples: ['breakrocks explore', 'breakrocks explore --trending', 'breakrocks explore --for-you --language fr', 'breakrocks explore --happening %france'],
  input: object({
    trending: bool('Trending tags'), forYou: bool('Recommendations (For you)'), happening: str('What happens now in this universe'), accounts: bool('Accounts to follow'),
    suggestions: str('Suggestions of addresses for a text (%par, @al, #sp)'), language: str('Language of the recommendations', { default: 'en' }), kind: str('Recommendations of posts or clips', { enum: ['POSTS', 'CLIPS'], default: 'POSTS' }),
  }),
  output: { description: 'The answer asked (an Explore page)' },
  run: async (ctx, i) => {
    if (i.trending) return (await api<Record<string, unknown>>(ctx, `{ trendingTags ${selection('TrendingTagPage', 2)} }`)).trendingTags;
    if (i.forYou) return (await api<Record<string, unknown>>(ctx, `query($k: RecommendationKind!, $l: String!) { recommendations(kind: $k, language: $l) ${selection('RecommendationPage', 2)} }`, { k: i.kind ?? 'POSTS', l: i.language ?? 'en' })).recommendations;
    if (i.happening) return (await api<Record<string, unknown>>(ctx, `query($u: String!) { happeningNow(universe: $u) ${selection('HappeningNow', 1)} }`, { u: i.happening })).happeningNow;
    if (i.accounts) return (await api<Record<string, unknown>>(ctx, `{ accountsToFollow ${selection('AccountToFollowPage', 2)} }`)).accountsToFollow;
    if (i.suggestions !== undefined) return (await api<Record<string, unknown>>(ctx, `query($t: String!) { suggestions(text: $t) ${selection('Suggestion', 1)} }`, { t: i.suggestions })).suggestions;
    return (await api<Record<string, unknown>>(ctx, `{ suggestedPosts ${PAGE_OF_POSTS} }`)).suggestedPosts;
  },
};

export const timeColumn: Command<{ universe: string; day?: string }, unknown> = {
  name: 'time-column', summary: 'The time column of a universe: events, polls, debates, votes, projects',
  description: '--day keeps the events of that day (YYYY-MM-DD).',
  examples: ['breakrocks time-column %france', 'breakrocks time-column %france --day 2026-10-23 --json'],
  input: object({ universe: str('The universe (%name)'), day: str('Only the events of this day', { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) }, ['universe']),
  output: outputSchema('TimeColumn', 2), args: { positionals: ['universe'] },
  run: async (ctx, { universe, day }) => {
    const r = (await api<{ timeColumn: Record<string, unknown> & { events?: { startsAt?: string }[] } }>(ctx, `query($u: String!) { timeColumn(universe: $u) ${selection('TimeColumn', 2)} }`, { u: universe })).timeColumn;
    if (day && r?.events) r.events = r.events.filter((e) => (e.startsAt ?? '').slice(0, 10) === day);
    return r;
  },
};

export const live: Command<{ universe: string } & WatchInput, unknown> = {
  name: 'live', summary: 'The live line of a universe (--watch: each change as it comes)',
  examples: ['breakrocks live %france', 'breakrocks live %france --watch --jsonl --interval 20'],
  input: object({ universe: str('The universe (%name)'), ...WATCH_PROPERTIES }, ['universe']), output: outputSchema('LiveLine', 2), args: { positionals: ['universe'] },
  run: async (ctx, input) => {
    const read = async () => (await api<{ liveLine: unknown }>(ctx, `query($u: String!) { liveLine(universe: $u) ${selection('LiveLine', 2)} }`, { u: input.universe })).liveLine;
    if (input.watch) return watchItems(ctx, input, async () => [await read()], (l) => JSON.stringify(l));
    return read();
  },
};

const ACCOUNT = selection('Account', 1);
export const accountsShow: Command<{ account: string }, unknown> = {
  name: 'accounts show', summary: 'The profile of an account (by @handle or id)', examples: ['breakrocks accounts show @alice', 'breakrocks accounts show eu-32757404-… --json'],
  input: object({ account: str('The account: @handle or its id') }, ['account']), output: outputSchema('Account', 1), args: { positionals: ['account'] },
  run: async (ctx, { account }) => {
    const r = account.startsWith('@')
      ? (await api<{ accountByHandle: unknown }>(ctx, `query($h: String!) { accountByHandle(handle: $h) ${ACCOUNT} }`, { h: account.slice(1) })).accountByHandle
      : (await api<{ accountById: unknown }>(ctx, `query($id: ID!) { accountById(id: $id) ${ACCOUNT} }`, { id: account })).accountById;
    if (!r) throw usageError('ACCOUNT_NOT_FOUND', `No account ${account}`);
    return r;
  },
};
export const accountsFollowers = apiCommand({ name: 'accounts followers', summary: 'The followers of an account', kind: 'query', op: 'followers', positionals: ['accountId'], rename: {}, examples: ['breakrocks accounts followers @alice --all'] });
export const accountsFollowing = apiCommand({ name: 'accounts following', summary: 'What an account follows', kind: 'query', op: 'following', positionals: ['accountId'], examples: ['breakrocks accounts following @alice'] });

export const eventsList = apiCommand({ name: 'events list', summary: 'The events of a universe (--from, --to)', kind: 'query', op: 'universeEvents', positionals: ['universe'], examples: ['breakrocks events list %france --from 2026-10-23T00:00:00Z'] });
export const proposalsList = apiCommand({ name: 'proposals list', summary: 'The proposals of a universe', kind: 'query', op: 'proposals', positionals: ['universe'], examples: ['breakrocks proposals list %france --all'] });
export const debatesList = apiCommand({ name: 'debates list', summary: 'The debates of a universe', kind: 'query', op: 'debates', positionals: ['universe'], examples: ['breakrocks debates list %france'] });
export const pollsList = apiCommand({ name: 'polls list', summary: 'The polls of a universe', kind: 'query', op: 'polls', positionals: ['universe'], examples: ['breakrocks polls list %france'] });
export const channelsList = apiCommand({ name: 'channels list', summary: 'The channels of a universe (--all-levels: of its sub-universes too)', kind: 'query', op: 'channels', positionals: ['universe'], examples: ['breakrocks channels list %france --all-levels'] });

type Notification = { id: string; read: boolean; updatedAt: string; [k: string]: unknown };
export const notifications: Command<{ unread?: boolean; markRead?: boolean; after?: string; all?: boolean; max?: number } & WatchInput, unknown> = {
  name: 'notifications', summary: 'The notifications (--unread; --mark-read marks those listed as read; --watch)',
  examples: ['breakrocks notifications --unread', 'breakrocks notifications --mark-read --json', 'breakrocks notifications --watch --jsonl'],
  input: object({ unread: bool('Only the unread ones'), markRead: bool('Mark the ones listed as read'), after: str('The cursor of the next page'), all: bool('Follow the pages'), max: int('Pages at most with --all', { minimum: 1, maximum: 100, default: 10 }), ...WATCH_PROPERTIES }),
  output: openObject({ items: list('Notifications', outputSchema('Notification', 1)), next: { type: ['string', 'null'] }, unread: int('Unread'), marked: int('Marked as read') }),
  run: async (ctx, input) => {
    const read = async (after: string | null) => (await api<{ notifications: Page<Notification> & { unread: number } }>(ctx, `query($after: String) { notifications(after: $after) ${selection('NotificationPage', 2)} }`, { after })).notifications;
    if (input.watch) return watchItems(ctx, input, async () => (await read(null)).items.filter((n) => !input.unread || !n.read), (n) => `${n.id}@${n.updatedAt}`, accountChannel(['notification']));
    const items: Notification[] = [];
    let next: string | null = input.after ?? null, unread = 0;
    for (let page = 0; page < (input.all ? input.max ?? 10 : 1); page++) {
      const r = await read(next);
      unread = r.unread; items.push(...r.items); next = r.next;
      if (!next) break;
    }
    const shown = input.unread ? items.filter((n) => !n.read) : items;
    let marked: number | undefined;
    if (input.markRead && shown.some((n) => !n.read)) marked = (await api<{ markNotificationsRead: number }>(ctx, 'mutation($ids: [ID!]) { markNotificationsRead(ids: $ids) }', { ids: shown.filter((n) => !n.read).map((n) => n.id) })).markNotificationsRead;
    return { items: shown, next, unread, ...(marked !== undefined ? { marked } : {}) };
  },
};

export const exportPosts: Command<{ universe: string; out: string; max?: number; force?: boolean }, { out: string; posts: number; pages: number; next: string | null }> = {
  name: 'export', summary: 'Export the posts of a universe to a JSON lines file (when the reader may)', examples: ['breakrocks export %france --out posts.jsonl'],
  input: object({ universe: str('The universe (%name)'), out: str('The file to write (JSON lines)'), max: int('Pages at most', { minimum: 1, maximum: 10000, default: 1000 }), force: bool('Replace the file') }, ['universe', 'out']),
  output: openObject({ out: str('The file'), posts: int('Posts written'), pages: int('Pages read'), next: { type: ['string', 'null'], description: 'The cursor where it stopped (more beyond --max)' } }),
  args: { positionals: ['universe'] },
  run: async (ctx, { universe, out, max = 1000, force }) => {
    const target = resolve(ctx.io.cwd, out);
    const { existsSync } = await import('node:fs');
    if (existsSync(target) && !force) throw usageError('FILE_EXISTS', `${out} exists: --force to replace it`);
    const lines: string[] = [];
    let next: string | null = null, pages = 0;
    do {
      const r: Page<Post> = (await api<{ exportUniversePosts: Page<Post> }>(ctx, `query($u: String!, $after: String) { exportUniversePosts(universe: $u, after: $after) ${PAGE_OF_POSTS} }`, { u: universe, after: next })).exportUniversePosts;
      pages++;
      for (const p of r.items) lines.push(JSON.stringify(p));
      next = r.next;
      if (pages % 10 === 0) ctx.progress(`${lines.length} posts…`);
    } while (next && pages < max);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, lines.length ? `${lines.join('\n')}\n` : '');
    return { out: target, posts: lines.length, pages, next };
  },
  quiet: (r) => r.out,
};

type Rendered = { id: string; author: string; universe: string; createdAt: string; text: string; images: { url: string; alt: string | null }[]; clip: string | null; link: string | null; url: string; replies: number; likes: number; reposts: number };
export const render: Command<{ id: string }, Rendered> = {
  name: 'render', summary: 'A post as plain text, its media as links (reading without HTML)', examples: ['breakrocks render 01a166cb-bfff-7237-81a6-fb564222fe97'],
  input: object({ id: str('The id of the post') }, ['id']),
  output: openObject({ id: str('Post'), author: str('@handle'), universe: str('Where'), createdAt: str('When'), text: str('Its text (display)'), images: list('Images', openObject({ url: str('URL'), alt: { type: ['string', 'null'] } })), clip: { type: ['string', 'null'] }, link: { type: ['string', 'null'] }, url: str('Its web address') }),
  args: { positionals: ['id'] },
  run: async (ctx, { id }) => {
    const p = (await api<{ post: Post & { clip?: { url?: string } | null } | null }>(ctx, `query($id: ID!) { post(id: $id) ${POST} }`, { id })).post;
    if (!p) throw usageError('POST_NOT_FOUND', `No post ${id}`);
    return { id: p.id, author: `@${p.author.handle}`, universe: p.universe, createdAt: p.createdAt, text: p.display, images: p.images.map((i) => ({ url: i.url, alt: i.alt ?? null })), clip: (p.clip as { url?: string } | null)?.url ?? null, link: p.link?.url ?? null, url: p.url, replies: p.replyCount, likes: p.likeCount, reposts: p.repostCount };
  },
  text: (r) => [`${r.author} in ${r.universe}, ${r.createdAt}`, '', r.text, ...(r.images.length || r.clip || r.link ? [''] : []), ...r.images.map((i, n) => `[image ${n + 1}] ${i.url}${i.alt ? ` (${i.alt})` : ''}`), ...(r.clip ? [`[clip] ${r.clip}`] : []), ...(r.link ? [`[link] ${r.link}`] : []), '', `${r.replies} replies, ${r.likes} likes, ${r.reposts} reposts   ${r.url}`].join('\n'),
  quiet: (r) => r.id,
};


