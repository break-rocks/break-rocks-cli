// Publishing and interacting: a post with its images or its
// clip (checked as the app checks them, sent, then the post sent again while the platform processes
// them, with the same requestId), replies, reposts, quotes, reactions, the posts of the author, the
// relations, the residence and the favorites, the private universes, the proposals and votes,
// debates, polls, events, channels, reports. Tags and mentions are in the text. No mass
// deletion. The refusals are the platform's.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { accountIdOf, apiCommand, refOf } from '../api/command.js';
import { enumValues, outputSchema, selection } from '../api/graphql.js';
import type { Context } from '../context.js';
import { uuidv7 } from '../ids.js';
import { usageError } from '../errors.js';
import { MAX_POST_IMAGES, checkImage, checkText, checkVideo, uploadImage, uploadVideo, whileProcessing, type CheckedImage, type CheckedVideo, type MediaTarget } from '../media.js';
import type { Command } from '../registry.js';
import { bool, int, list, object, str } from '../schema.js';
import { api } from '../session.js';
import { discussionAddress, discussionIdOf } from './discussions.js';
import { BOUNDARY_ID, territoryChoice } from './geo.js';

const POST = selection('Post', 1);
const REPLY_POLICIES = ['everyone', 'following', 'mentioned', 'nobody'];

export type ComposeInput = { text?: string; file?: string; image?: string[]; alt?: string[]; video?: string; link?: string; source?: string[]; requestId?: string; dryRun?: boolean };

/** At most 10 post sources (specs v81.8.0, D-230), each a title of at most 200 characters. */
export const MAX_POST_SOURCES = 10;
const MAX_SOURCE_TITLE = 200;
export type PostSourceInput = { url: string; title?: string };

/**
 * A --source "<url>[=title]": the title after the first "=" that is not part of the query of the link (in
 * "https://a.example/x?k=v=Title", the second "=" of its last parameter). Checked as the platform checks it:
 * an https link (POST_SOURCE_INVALID), a title of at most 200 characters (POST_SOURCE_TITLE_TOO_LONG); the
 * public internet is the platform's to check.
 */
export function parseSource(raw: string): PostSourceInput {
  const value = raw.trim();
  const query = value.indexOf('?');
  let at: number;
  if (query < 0) at = value.indexOf('=');
  else {
    const last = Math.max(value.lastIndexOf('&'), query);
    const pair = value.indexOf('=', last + 1);
    at = pair < 0 ? -1 : value.indexOf('=', pair + 1);
  }
  const url = (at < 0 ? value : value.slice(0, at)).trim();
  const title = at < 0 ? '' : value.slice(at + 1).trim();
  let ok = false;
  try { ok = new URL(url).protocol === 'https:'; } catch { ok = false; }
  if (!ok) throw usageError('POST_SOURCE_INVALID', `A post source is an https link: ${url || raw}`);
  if ([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(title)].length > MAX_SOURCE_TITLE) throw usageError('POST_SOURCE_TITLE_TOO_LONG', `The title of a post source has at most ${MAX_SOURCE_TITLE} characters`);
  return { url, ...(title ? { title } : {}) };
}

/** The post sources of --source (none given: undefined). */
export function sourcesOf(given: string[] | undefined): PostSourceInput[] | undefined {
  if (!given?.length) return undefined;
  if (given.length > MAX_POST_SOURCES) throw usageError('POST_SOURCES_LIMIT', `A post has at most ${MAX_POST_SOURCES} post sources`);
  return given.map(parseSource);
}

const sourceProp = list('A post source, "<url>" or "<url>=<title>" (an https link, a title of 200 characters at most; 10 at most; repeat --source). Not counted in the 1,000 characters', { type: 'string' }, { maxItems: MAX_POST_SOURCES });
export const composeProps = {
  text: str('The text (tags and mentions in it: #sport, @alice); "-" reads stdin'),
  file: str('Read the text from this file ("-": stdin)'),
  image: list('An image file (4 at most; repeat --image)', { type: 'string' }, { maxItems: MAX_POST_IMAGES }),
  alt: list('The alternative text of each image, in the order of --image (repeat --alt)', { type: 'string' }, { maxItems: MAX_POST_IMAGES }),
  video: str('A video file (the clip of the post: MP4, MOV or WebM, 512 MB at most)'),
  link: str('A link (https)'),
  source: sourceProp,
  requestId: str('An idempotency key (a UUIDv7): sent again, it is made once (one is made when absent)', { pattern: '^[0-9a-fA-F-]{36}$' }),
  dryRun: bool('Check everything and tell what would be sent, without sending'),
};

/** The text of a post: the positional, --file, or stdin ("-"). */
async function textOf(ctx: Context, input: ComposeInput): Promise<string> {
  if (input.text !== undefined && input.file !== undefined) throw usageError('INVALID_INPUT', 'A text or --file, not both');
  const fromStdin = input.text === '-' || input.file === '-';
  if (fromStdin) {
    if (!ctx.io.readStdin) throw usageError('INVALID_INPUT', 'No stdin to read here: give the text');
    return (await ctx.io.readStdin()).replace(/\r?\n$/, '');
  }
  if (input.file !== undefined) return readFileSync(resolve(ctx.io.cwd, input.file), 'utf8').replace(/\r?\n$/, '');
  return input.text ?? '';
}

export type Plan = { text: string; images: CheckedImage[]; video?: CheckedVideo; link?: string; sources?: PostSourceInput[]; requestId: string };

/** Everything checked before anything is sent (POST_EMPTY, POST_TOO_MANY_IMAGES, POST_IMAGES_AND_CLIP, the media). */
export async function plan(ctx: Context, input: ComposeInput, requireText = false): Promise<Plan> {
  const text = checkText(await textOf(ctx, input));
  const images = (input.image ?? []).map((path, i) => checkImage(ctx, path, input.alt?.[i]));
  if ((input.alt?.length ?? 0) > images.length) throw usageError('INVALID_INPUT', 'More --alt than --image');
  if (images.length > MAX_POST_IMAGES) throw usageError('POST_TOO_MANY_IMAGES', 'A post has at most 4 images');
  const video = input.video ? checkVideo(ctx, input.video) : undefined;
  if (video && images.length) throw usageError('POST_IMAGES_AND_CLIP', 'A post has images or a clip, not both');
  if (!text.trim() && !images.length && !video && (requireText || !input.link)) throw usageError('POST_EMPTY', 'A post has a text or media');
  const sources = sourcesOf(input.source);
  return { text, images, ...(video ? { video } : {}), ...(input.link ? { link: input.link } : {}), ...(sources ? { sources } : {}), requestId: input.requestId ?? uuidv7(ctx.now()) };
}

export const dryRunOf = (p: Plan, extra: Record<string, unknown>) => ({
  dryRun: true, ...extra, text: p.text, requestId: p.requestId,
  images: p.images.map((i) => ({ file: i.name, type: i.type, bytes: i.bytes, width: i.width, height: i.height, alt: i.alt ?? null })),
  ...(p.video ? { video: { file: p.video.name, type: p.video.type, bytes: p.video.bytes } } : {}), ...(p.link ? { link: p.link } : {}), ...(p.sources ? { sources: p.sources } : {}),
});

/** The media of a plan sent for [target]: the arguments images and clip of the mutation. */
export async function sendMedia(ctx: Context, p: Plan, target: MediaTarget): Promise<Record<string, unknown>> {
  const images = [];
  for (const image of p.images) images.push({ id: await uploadImage(ctx, image, target), ...(image.alt ? { alt: image.alt } : {}) });
  const clip = p.video ? await uploadVideo(ctx, p.video, target) : undefined;
  return { ...(images.length ? { images } : {}), ...(clip ? { clip } : {}) };
}

/** The universe of a post (its media go there: a reply, a quote without --in). */
async function universeOfPost(ctx: Context, p: Plan, postId: string): Promise<string | null> {
  if (!p.images.length && !p.video) return null;
  return (await api<{ post: { universe: string } | null }>(ctx, 'query($id: ID!) { post(id: $id) { universe } }', { id: postId })).post?.universe ?? null;
}

export const wait = (p: Plan) => (p.video ? { stepMs: 5000, maxMs: 10 * 60_000 } : { stepMs: 2000, maxMs: 2 * 60_000 });
const composeOutput = outputSchema('Post', 1);

export const post: Command<ComposeInput & { in?: string; replyPolicy?: string; announcement?: boolean }, unknown> = {
  name: 'post', summary: 'Publish a post: text, images (4) or a clip, a link, in an address (createPost)',
  description: 'The images and the clip are checked as the app checks them (an image JPEG, PNG, WebP or GIF of 10 MB at most; a clip MP4, MOV or WebM of 512 MB at most), sent, then the post waits for their processing. --in is the address of publication (%universe, %universe/sub, %universe#tag); the tags and mentions are those of the text. --dry-run checks and tells, without sending.',
  examples: ['breakrocks post "Match tonight #football" --in %test-village-sport', 'breakrocks post "The stadium" --in %paris --image stadium.jpg --alt "The stadium at night"', 'echo "Hello" | breakrocks post - --in %paris', 'breakrocks post --file post.md --in %paris --dry-run'],
  input: object({ ...composeProps, in: str('The address of publication (%universe, %universe/sub, %universe#tag)'), replyPolicy: str('Who may reply', { enum: REPLY_POLICIES }), announcement: bool('An announcement of the universe (its leadership)') }),
  output: composeOutput, args: { positionals: ['text'] },
  run: async (ctx, input) => {
    const p = await plan(ctx, input);
    if (input.dryRun) return dryRunOf(p, { operation: 'createPost', universe: input.in ?? null, replyPolicy: input.replyPolicy ?? null, announcement: !!input.announcement });
    const media = await sendMedia(ctx, p, { destination: 'POST', address: input.in ?? null });
    const vars = { text: p.text, universe: input.in ?? null, link: p.link ?? null, replyPolicy: input.replyPolicy ?? null, announcement: input.announcement ?? null, requestId: p.requestId, images: media.images ?? null, clip: media.clip ?? null, sources: p.sources ?? null };
    return whileProcessing(ctx, async () => (await api<{ createPost: unknown }>(ctx, `mutation($text: String!, $universe: String, $link: String, $replyPolicy: ReplyPolicy, $announcement: Boolean, $requestId: ID!, $images: [ImageAttachmentInput!], $clip: ID, $sources: [PostSourceInput!]) { createPost(text: $text, universe: $universe, link: $link, replyPolicy: $replyPolicy, announcement: $announcement, requestId: $requestId, images: $images, clip: $clip, sources: $sources) ${POST} }`, vars)).createPost, wait(p));
  },
  quiet: (r) => (r as { id?: string }).id,
};

export const reply: Command<ComposeInput & { id: string }, unknown> = {
  name: 'reply', summary: 'Reply to a post (replyTo), with images or a clip', examples: ['breakrocks reply 01a166cb-bfff-7237-81a6-fb564222fe97 "Bien vu !"', 'breakrocks reply <id> --file reply.txt --image a.png'],
  input: object({ id: str('The post replied to'), ...composeProps }, ['id']), output: composeOutput, args: { positionals: ['id', 'text'] },
  run: async (ctx, input) => {
    const p = await plan(ctx, input);
    if (input.dryRun) return dryRunOf(p, { operation: 'replyTo', id: input.id });
    const media = await sendMedia(ctx, p, { destination: 'POST', address: await universeOfPost(ctx, p, input.id) });
    const vars = { postId: input.id, text: p.text, link: p.link ?? null, requestId: p.requestId, images: media.images ?? null, clip: media.clip ?? null, sources: p.sources ?? null };
    return whileProcessing(ctx, async () => (await api<{ replyTo: unknown }>(ctx, `mutation($postId: ID!, $text: String!, $link: String, $requestId: ID!, $images: [ImageAttachmentInput!], $clip: ID, $sources: [PostSourceInput!]) { replyTo(postId: $postId, text: $text, link: $link, requestId: $requestId, images: $images, clip: $clip, sources: $sources) ${POST} }`, vars)).replyTo, wait(p));
  },
  quiet: (r) => (r as { id?: string }).id,
};

export const quote: Command<ComposeInput & { id: string; in?: string; replyPolicy?: string }, unknown> = {
  name: 'quote', summary: 'Quote a post with a text of one\'s own (quote)', examples: ['breakrocks quote <id> "À lire" --in %paris'],
  input: object({ id: str('The post quoted'), ...composeProps, in: str('Where to publish the quote (default: the address of the post)'), replyPolicy: str('Who may reply', { enum: REPLY_POLICIES }) }, ['id']),
  output: composeOutput, args: { positionals: ['id', 'text'] },
  run: async (ctx, input) => {
    const p = await plan(ctx, input, true);
    if (input.dryRun) return dryRunOf(p, { operation: 'quote', id: input.id, universe: input.in ?? null });
    const media = await sendMedia(ctx, p, { destination: 'POST', address: input.in ?? await universeOfPost(ctx, p, input.id) });
    const vars = { postId: input.id, text: p.text, universe: input.in ?? null, link: p.link ?? null, replyPolicy: input.replyPolicy ?? null, requestId: p.requestId, images: media.images ?? null, clip: media.clip ?? null, sources: p.sources ?? null };
    return whileProcessing(ctx, async () => (await api<{ quote: unknown }>(ctx, `mutation($postId: ID!, $text: String!, $universe: String, $link: String, $replyPolicy: ReplyPolicy, $requestId: ID!, $images: [ImageAttachmentInput!], $clip: ID, $sources: [PostSourceInput!]) { quote(postId: $postId, text: $text, universe: $universe, link: $link, replyPolicy: $replyPolicy, requestId: $requestId, images: $images, clip: $clip, sources: $sources) ${POST} }`, vars)).quote, wait(p));
  },
  quiet: (r) => (r as { id?: string }).id,
};

const postId = { id: 'The id of the post' };
const onPost = { positionals: ['postId'], rename: { postId: 'id' }, descriptions: postId };
export const repost = apiCommand({ name: 'repost', summary: 'Repost a post (--universe: in another universe)', kind: 'mutation', op: 'repost', ...onPost, descriptions: { ...postId, universe: 'Where to repost it (default: its universe)' }, examples: ['breakrocks repost <id>', 'breakrocks repost <id> --universe %lyon'], depth: 1 });
export const like = apiCommand({ name: 'like', summary: 'Like a post (setLike)', kind: 'mutation', op: 'setLike', fixed: { liked: true }, ...onPost, examples: ['breakrocks like <id>'], depth: 1 });
export const unlike = apiCommand({ name: 'unlike', summary: 'Take back a like (setLike)', kind: 'mutation', op: 'setLike', fixed: { liked: false }, ...onPost, examples: ['breakrocks unlike <id>'], depth: 1 });
export const dislike = apiCommand({ name: 'dislike', summary: 'Dislike a post (setDislike)', kind: 'mutation', op: 'setDislike', fixed: { disliked: true }, ...onPost, examples: ['breakrocks dislike <id>'], depth: 1 });
export const undislike = apiCommand({ name: 'undislike', summary: 'Take back a dislike (setDislike)', kind: 'mutation', op: 'setDislike', fixed: { disliked: false }, ...onPost, examples: ['breakrocks undislike <id>'], depth: 1 });
export const notInterested = apiCommand({ name: 'not-interested', summary: 'Not interested in a post, its author, a tag or its universe (setNotInterested)', kind: 'mutation', op: 'setNotInterested', fixed: { notInterested: true }, positionals: ['input.postId'], rename: { 'input.accountId': 'account' }, descriptions: { scope: 'What is not interesting: POST, AUTHOR, TAG or UNIVERSE', postId: 'The post', account: 'The account (scope AUTHOR, without a post): @handle or its id', universe: 'The universe (scope UNIVERSE, without a post)', tag: 'The tag, for the scope TAG' }, examples: ['breakrocks not-interested <id> --scope AUTHOR'] });

export const postsEdit = apiCommand({
  name: 'posts edit', summary: 'Change the text of one\'s post and its post sources (within 1 hour)', kind: 'mutation', op: 'changePost', ...onPost, positionals: ['postId', 'text'],
  description: 'The text replaces the former one. --source replaces the post sources (repeat it; the whole list wanted); --no-sources removes them; neither keeps them.',
  extra: { source: sourceProp, noSources: bool('Remove the post sources') },
  prepare: (i) => {
    const { source, noSources, ...rest } = i as Record<string, unknown> & { source?: string[]; noSources?: boolean };
    if (noSources && source?.length) throw usageError('INVALID_INPUT', '--source or --no-sources, not both');
    if (noSources) rest.sources = [];
    else if (source?.length) rest.sources = sourcesOf(source);
    return rest;
  },
  examples: ['breakrocks posts edit <id> "The corrected text"', 'breakrocks posts edit <id> "The bridge reopens" --source "https://example.com/pont=Notice from the town hall"'], depth: 1,
});
export const postsDelete = apiCommand({ name: 'posts delete', summary: 'Delete one\'s post (one at a time)', kind: 'mutation', op: 'deletePost', ...onPost, confirm: (i) => `Delete the post ${i.id}?`, examples: ['breakrocks posts delete <id> --yes'], depth: 1 });
export const postsPin = apiCommand({ name: 'posts pin', summary: 'Pin a post in a universe (setPinnedPost)', kind: 'mutation', op: 'setPinnedPost', fixed: { pinned: true }, positionals: ['postId'], rename: { universe: 'in' }, descriptions: { in: 'The universe (%name)' }, examples: ['breakrocks posts pin <id> --in %paris'], depth: 1 });
export const postsUnpin = apiCommand({ name: 'posts unpin', summary: 'Unpin a post (setPinnedPost)', kind: 'mutation', op: 'setPinnedPost', fixed: { pinned: false }, positionals: ['postId'], rename: { universe: 'in' }, descriptions: { in: 'The universe (%name)' }, examples: ['breakrocks posts unpin <id> --in %paris'], depth: 1 });

export const follow = apiCommand({ name: 'follow', summary: 'Follow an address: an account, a universe, a tag (setFollow)', kind: 'mutation', op: 'setFollow', fixed: { following: true }, positionals: ['address'], examples: ['breakrocks follow @alice', 'breakrocks follow %paris#velo'] });
export const unfollow = apiCommand({ name: 'unfollow', summary: 'Stop following an address (setFollow; null once stopped)', kind: 'mutation', op: 'setFollow', fixed: { following: false }, positionals: ['address'], examples: ['breakrocks unfollow @alice'] });
const account = (verb: string, op: string, fixed: Record<string, boolean>, summary: string) => apiCommand({ name: verb, summary, kind: 'mutation', op, fixed, positionals: ['accountId'], rename: { accountId: 'account' }, descriptions: { account: 'The account: @handle or its id' }, examples: [`breakrocks ${verb} @alice`], depth: 1 });
export const block = account('block', 'setBlock', { blocked: true }, 'Block an account (setBlock)');
export const unblock = account('unblock', 'setBlock', { blocked: false }, 'Unblock an account (setBlock)');
export const mute = account('mute', 'setMute', { muted: true }, 'Mute an account (setMute)');
export const unmute = account('unmute', 'setMute', { muted: false }, 'Unmute an account (setMute)');

const u = { universe: 'The universe (%name)' };
export const universesJoin = apiCommand({ name: 'universes join', summary: 'Become a resident of a universe (joinUniverse)', kind: 'mutation', op: 'joinUniverse', positionals: ['universe'], descriptions: u, examples: ['breakrocks universes join %paris'] });
export const universesLeave = apiCommand({ name: 'universes leave', summary: 'Stop being a resident (the residence time is lost)', kind: 'mutation', op: 'leaveUniverse', positionals: ['universe'], descriptions: u, confirm: (i) => `Leave ${i.universe}? The residence time is lost.`, examples: ['breakrocks universes leave %paris --yes'] });
export const universesAskToJoin = apiCommand({ name: 'universes ask-to-join', summary: 'Ask to join a private universe', kind: 'mutation', op: 'askToJoinUniverse', positionals: ['universe'], descriptions: { ...u, conditionsVersion: 'The version of its conditions accepted' }, examples: ['breakrocks universes ask-to-join %club --conditions-version 2'] });
export const favoriteAdd = apiCommand({ name: 'universes favorite add', summary: 'Add a favorite universe', kind: 'mutation', op: 'addFavoriteUniverse', positionals: ['universe'], descriptions: u, examples: ['breakrocks universes favorite add %paris'] });
export const favoriteRemove = apiCommand({ name: 'universes favorite remove', summary: 'Remove a favorite universe', kind: 'mutation', op: 'removeFavoriteUniverse', positionals: ['universe'], descriptions: u, examples: ['breakrocks universes favorite remove %paris'] });
export const favoriteMove = apiCommand({ name: 'universes favorite move', summary: 'Move a favorite universe (before another, or last)', kind: 'mutation', op: 'moveFavoriteUniverse', positionals: ['universe'], descriptions: { ...u, before: 'The favorite to put it before (absent: last)' }, examples: ['breakrocks universes favorite move %paris --before %lyon'] });
export const universesCreatePrivate = apiCommand({ name: 'universes create-private', summary: 'Create a private universe (hosted name or own domain)', kind: 'mutation', op: 'createPrivateUniverse', descriptions: { hostedName: 'Its name under the hosting of the platform', domain: 'Its own domain (DNS proof)', joinMode: 'How one joins', legalSpace: 'Its legal space (fra…)', memberTier: 'Its tier of members' }, examples: ['breakrocks universes create-private --hosted-name club-echecs --join-mode REQUEST --legal-space fra --member-tier 1'] });
export const universesInvite = apiCommand({ name: 'universes invite', summary: 'Invite an account (or an email) to a private universe', kind: 'mutation', op: 'inviteToUniverse', positionals: ['universe'], rename: { accountId: 'account' }, descriptions: { ...u, account: 'The account: @handle or its id', email: 'An email, to invite someone without an account' }, examples: ['breakrocks universes invite %club --account @alice'] });
export const conditionsSet = apiCommand({ name: 'universes conditions set', summary: 'Set the conditions of a private universe', kind: 'mutation', op: 'setUniverseConditions', positionals: ['universe', 'text'], descriptions: u, examples: ['breakrocks universes conditions set %club "Respect and good humour"'] });
export const conditionsShow = apiCommand({ name: 'universes conditions show', summary: 'The conditions of a universe (a version)', kind: 'query', op: 'universeConditions', positionals: ['universe'], descriptions: u, examples: ['breakrocks universes conditions show %club'] });
export const conditionsAccept = apiCommand({ name: 'universes conditions accept', summary: 'Accept the conditions of a universe', kind: 'mutation', op: 'acceptUniverseConditions', positionals: ['universe'], descriptions: { ...u, conditionsVersion: 'The version accepted' }, examples: ['breakrocks universes conditions accept %club --conditions-version 2'] });
export const universesAgentPosts = apiCommand({
  name: 'universes agent-posts', summary: 'Forbid or allow the delegated agents to post in a universe and its sub-universes (setUniverseAgentPosts)', kind: 'mutation', op: 'setUniverseAgentPosts', positionals: ['universe'],
  description: 'Set on the universe of the first level of a public universe by its leadership, on a private universe by its owner or an admin; never by a delegated agent. Read it with breakrocks universes show (agentPostsForbidden) before acting as an agent.',
  descriptions: { ...u, forbidden: 'true: delegated agents cannot post, reply, quote nor repost there (UNIVERSE_AGENTS_FORBIDDEN); false: allowed' },
  examples: ['breakrocks universes agent-posts %paris --forbidden', 'breakrocks universes agent-posts %paris --no-forbidden'], depth: 1,
});
export const universesMembers = apiCommand({ name: 'universes members', summary: 'The members of a universe', kind: 'query', op: 'universeMembers', positionals: ['universe'], descriptions: u, examples: ['breakrocks universes members %club --all'] });

/** At most 5 free tags (specs v101.0.0, D-300: universe-tags.feature), in their canonical form (a leading # dropped). */
export const MAX_FREE_TAGS = 5;
/** The free tags given, checked as the platform counts them: [min] to 5 (FREE_TAGS_REQUIRED, FREE_TAGS_TOO_MANY). */
export function freeTags(tags: unknown, min: number, what: string): string[] | undefined {
  const given = ((tags as string[] | undefined) ?? []).flatMap((t) => String(t).split(',')).map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
  if (given.length < min) throw usageError('FREE_TAGS_REQUIRED', `${what}: --tags is required, 1 to ${MAX_FREE_TAGS} free tags (--tags velo --tags paris, or --tags velo,paris)`);
  if (given.length > MAX_FREE_TAGS) throw usageError('FREE_TAGS_TOO_MANY', `${what}: at most ${MAX_FREE_TAGS} free tags`, { max: MAX_FREE_TAGS });
  return tags === undefined ? undefined : given;
}
/** "lat,lon" → { lat, lon }. */
function pointOf(value: string, flag: string): { lat: number; lon: number } {
  const [lat, lon] = value.split(',').map((x) => Number(x.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw usageError('INVALID_INPUT', `${flag}: <lat>,<lon>, for example 48.8566,2.3522`);
  return { lat, lon };
}
/** The proposal kinds whose free tags are required (1 to 5); 0 to 5 for the others. */
const TAGGED_KINDS = ['ACTION', 'OTHER'];

export const proposalsFile = apiCommand({
  name: 'proposals file', summary: 'File a proposal in a universe (fileProposal)', kind: 'mutation', op: 'fileProposal', positionals: ['input.universe'], flatten: ['input', 'input.change'],
  description: [
    'Free tags (--tags, since specs v101.0.0): 1 to 5 for the kinds ACTION and OTHER (FREE_TAGS_REQUIRED), 0 to 5 for the others; its base tag follows from its kind and is never given.',
    '--from-discussion <id>: the temporary universe discussion it comes from ("Propose a decision"), open or closed in the last 24 hours.',
    'Kind APPEARANCE: --appearance, the appearance built (UniverseAppearanceInput JSON: imageId, imageShows NONE|SUBTLE|THROUGH, accent, character, logo, watermark, clear; see breakrocks universes show).',
    'Kind SHOWCASE: --tag-conventions, the tag conventions of the universe (at most 10).',
    'Kind CHANNEL: --channel-action as ChannelActionInput JSON ({"action":"OPEN","universe":"%paris","name":"velo"}); the action PLACE sets the place of the channel: --place-point <lat>,<lon> (or --place-zone as ZoneInput JSON) with --place-name, or neither to remove it.',
    'Kind TERRITORY sets a universe territory: --boundary <id> (its name read from its shape), or --circle <lat>,<lon> --radius <m> --territory-name <place>, or --no-territory to propose none; at any governance level, with or without leadership (the support, then the majority of the votes cast). Read the current one first: breakrocks universes territory get.',
  ].join(' '),
  descriptions: {
    ...u, kind: 'The kind of proposal', title: 'Its title (1 to 140 characters)', text: 'Its text', accountId: 'The account it concerns: @handle or its id', territory: 'A universe territory as TerritoryChoiceInput JSON (or --boundary, --circle)',
    clear: 'The parts removed (TERRITORY: no universe territory, as --no-territory; LOGO, WATERMARK)', channelAction: 'Kind CHANNEL: the action on a channel (ChannelActionInput JSON: action OPEN, ARCHIVE, UNARCHIVE, DELETE or PLACE, universe, name)',
    tags: 'Its free tags (repeat --tags, or commas): 1 to 5 for ACTION and OTHER, at most 5 otherwise', fromDiscussion: 'The id of the temporary universe discussion it comes from',
    appearance: 'Kind APPEARANCE: the appearance (UniverseAppearanceInput JSON)', tagConventions: 'Kind SHOWCASE: the tag conventions of the universe (at most 10)',
    playlistAction: 'Kind PLAYLIST: the action on a universe playlist (PlaylistActionInput JSON)', restoreLayoutVersion: 'Kind LAYOUT: the version of the layout of the universe to restore',
  },
  extra: {
    boundary: str('Kind TERRITORY: a boundary, the id of its place (R7444)', { pattern: BOUNDARY_ID }), circle: str('Kind TERRITORY: a circle, its center <lat>,<lon>'),
    radius: str('Kind TERRITORY: the radius of the circle (150 to 25000 metres, 2.5km…)'), territoryName: str('Kind TERRITORY: the place at the center of the circle (made public), or the name of the boundary', { maxLength: 100 }),
    noTerritory: bool('Kind TERRITORY: propose no universe territory'),
    placePoint: str('Kind CHANNEL, action PLACE: the point of the place of the channel, <lat>,<lon>'), placeZone: str('Kind CHANNEL, action PLACE: the zone of the place (ZoneInput JSON), in place of --place-point'),
    placeName: str('Kind CHANNEL, action PLACE: the name of the place (1 to 100 characters), required with a point or a zone', { maxLength: 100 }),
  },
  prepare: async (i, ctx) => {
    const { boundary, circle, radius, territoryName, noTerritory, placePoint, placeZone, placeName, ...rest } = i as Record<string, unknown> & { boundary?: string; circle?: string; radius?: string; territoryName?: string; noTerritory?: boolean; placePoint?: string; placeZone?: string; placeName?: string };
    rest.tags = freeTags(rest.tags, TAGGED_KINDS.includes(String(rest.kind)) ? 1 : 0, `A proposal ${String(rest.kind)}`);
    if (rest.tags === undefined) delete rest.tags;
    if ((boundary || circle) && (noTerritory || rest.territory !== undefined)) throw usageError('INVALID_INPUT', '--boundary or --circle, --territory, or --no-territory: one of them');
    if (boundary || circle) rest.territory = await territoryChoice(ctx, { boundary, circle, radius, name: territoryName });
    if (noTerritory) rest.clear = [...new Set([...((rest.clear as string[] | undefined) ?? []), 'TERRITORY'])];
    if (placePoint || placeZone || placeName) {
      if (placePoint && placeZone) throw usageError('INVALID_INPUT', '--place-point or --place-zone, not both');
      if ((placePoint || placeZone) && !placeName) throw usageError('CHANNEL_PLACE_NAME_REQUIRED', '--place-name is required with --place-point or --place-zone');
      const action = typeof rest.channelAction === 'string' ? JSON.parse(rest.channelAction) as Record<string, unknown> : (rest.channelAction as Record<string, unknown> | undefined);
      if (action?.action !== 'PLACE') throw usageError('INVALID_INPUT', '--place-point, --place-zone and --place-name go with --channel-action \'{"action":"PLACE","universe":"%u","name":"<channel>"}\'');
      rest.channelAction = { ...action, ...(placePoint ? { point: pointOf(placePoint, '--place-point') } : {}), ...(placeZone ? { zone: JSON.parse(placeZone) } : {}), ...(placeName ? { placeName } : {}) };
    }
    return rest;
  },
  examples: [
    'breakrocks proposals file %paris --kind ACTION --title "One more bench" --text "Market square" --tags bancs --tags place-du-marche',
    'breakrocks proposals file %paris --kind OTHER --title "Close the street on Sundays?" --tags rue --from-discussion <discussion id>',
    'breakrocks proposals file %paris --kind CHANNEL --title "A place for &velo" --channel-action \'{"action":"PLACE","universe":"%paris","name":"velo"}\' --place-point 48.853,2.369 --place-name Bastille',
    'breakrocks proposals file %paris --kind SHOWCASE --title "Our tags" --tag-conventions velo --tag-conventions marche',
    'breakrocks proposals file %paris --kind APPEARANCE --title "A new look" --appearance \'{"imageId":"<upload id>","imageShows":"SUBTLE"}\'',
    'breakrocks proposals file %paris --kind TERRITORY --title "The city of Paris" --boundary R7444',
    'breakrocks proposals file %marche --kind TERRITORY --title "The neighbourhood" --circle 48.8566,2.3522 --radius 1km --territory-name "Market square"',
  ],
});
export const proposalsShow = apiCommand({ name: 'proposals show', summary: 'A proposal', kind: 'query', op: 'proposal', positionals: ['id'], examples: ['breakrocks proposals show <id>'] });
const onProposal = { positionals: ['proposalId'], rename: { proposalId: 'id' }, descriptions: { id: 'The proposal' } };
export const proposalsSupport = apiCommand({ name: 'proposals support', summary: 'Support a proposal', kind: 'mutation', op: 'supportProposal', ...onProposal, examples: ['breakrocks proposals support <id>'] });
export const proposalsVote: Command<{ id: string; choice?: 'for' | 'against'; candidate?: string }, unknown> = {
  name: 'proposals vote', summary: 'Vote on a proposal: for, against, or a candidate (voteOnProposal)', examples: ['breakrocks proposals vote <id> for', 'breakrocks proposals vote <id> --candidate @alice'],
  input: object({ id: str('The proposal'), choice: str('for or against', { enum: ['for', 'against'] }), candidate: str('A candidate (an election): @handle or the id') }, ['id']),
  output: outputSchema('Proposal', 1), args: { positionals: ['id', 'choice'] },
  run: async (ctx, { id, choice, candidate }) => {
    if (!!choice === !!candidate) throw usageError('INVALID_INPUT', 'for, against, or --candidate');
    const vars = { proposalId: id, yes: choice ? choice === 'for' : null, candidate: candidate ? await accountIdOf(ctx, candidate) : null, requestId: uuidv7(ctx.now()) };
    return (await api<{ voteOnProposal: unknown }>(ctx, `mutation($proposalId: ID!, $yes: Boolean, $candidate: ID, $requestId: ID!) { voteOnProposal(proposalId: $proposalId, yes: $yes, candidate: $candidate, requestId: $requestId) ${selection('Proposal', 1)} }`, vars)).voteOnProposal;
  },
  quiet: (r) => (r as { id?: string }).id,
};
export const proposalsWithdraw = apiCommand({ name: 'proposals withdraw', summary: 'Withdraw one\'s proposal', kind: 'mutation', op: 'withdrawProposal', ...onProposal, confirm: (i) => `Withdraw the proposal ${i.id}?`, examples: ['breakrocks proposals withdraw <id> --yes'] });

const onDiscussion = (what: string) => ({ positionals: ['universe', 'name'], extra: { universe: str('The universe (%name)'), name: str(`The name of the ${what} (without &)`) }, hide: ['id'], require: ['universe', 'name'] });
const byAddress = async (i: Record<string, unknown>, ctx: Context) => { const { universe, name, ...rest } = i; return { ...rest, id: await discussionIdOf(ctx, discussionAddress(String(universe), String(name))) }; };
export const debatesOpen = apiCommand({
  name: 'debates open', summary: 'Open a temporary universe discussion, a debate (openUniverseDiscussion TEMPORARY: the governance)', kind: 'mutation', op: 'openUniverseDiscussion', positionals: ['universe', 'name'], fixed: { lifetime: 'TEMPORARY' },
  description: '1 to 168 hours (--hours, 24 by default); --message-ttl-seconds from 3600 to its duration. The governance only (LEADERSHIP_ONLY): a resident proposes one with debates propose.',
  descriptions: { ...u, name: 'Its name (without &)', subject: 'Its subject' }, examples: ['breakrocks debates open %paris velo --subject "More bike lanes?" --hours 48'],
});
export const debatesPropose = apiCommand({
  name: 'debates propose', summary: 'Propose a debate, a temporary universe discussion waiting for the support of the residents (proposeUniverseDiscussion)', kind: 'mutation', op: 'proposeUniverseDiscussion', positionals: ['universe', 'name'],
  description: 'A resident who can vote; it waits for the support of 5 residents who can vote (or 1 percent of the active residents, at most 50) and expires after 24 hours; one waiting per resident.',
  descriptions: { ...u, name: 'Its name (without &)', subject: 'Its subject' }, examples: ['breakrocks debates propose %paris velo --subject "More bike lanes?"'],
});
export const debatesSupport = apiCommand({ name: 'debates support', summary: 'Support a proposed debate (supportUniverseDiscussion)', kind: 'mutation', op: 'supportUniverseDiscussion', ...onDiscussion('debate'), prepare: byAddress, examples: ['breakrocks debates support %paris velo'] });
export const debatesClose = apiCommand({ name: 'debates close', summary: 'Close a debate early (closeUniverseDiscussion)', kind: 'mutation', op: 'closeUniverseDiscussion', ...onDiscussion('debate'), prepare: byAddress, confirm: (i) => `Close the debate ${discussionAddress(String(i.universe), String(i.name))}?`, examples: ['breakrocks debates close %paris velo --yes'] });
export const debatesShow = apiCommand({
  name: 'debates show', summary: 'A debate (universeDiscussion)', kind: 'query', op: 'universeDiscussion', positionals: ['universe', 'name'], extra: { universe: str('The universe (%name)'), name: str('The name of the debate (without &)') }, hide: ['address'], require: ['universe', 'name'],
  prepare: (i) => ({ address: discussionAddress(String(i.universe), String(i.name)) }), examples: ['breakrocks debates show %paris velo'],
});

export const pollsCreate = apiCommand({ name: 'polls create', summary: 'Create a poll in a universe', kind: 'mutation', op: 'createPoll', positionals: ['universe'], descriptions: { ...u, choices: 'The choices (repeat --choices, or commas)' }, examples: ['breakrocks polls create %paris --question "Quel jour ?" --choices samedi --choices dimanche'] });
export const pollsPick = apiCommand({ name: 'polls pick', summary: 'Pick a choice of a poll (its index, from 0)', kind: 'mutation', op: 'pickPollChoice', positionals: ['pollId', 'choice'], rename: { pollId: 'id' }, descriptions: { id: 'The poll', choice: 'The index of the choice, from 0' }, examples: ['breakrocks polls pick <id> 1'] });
export const pollsShow = apiCommand({ name: 'polls show', summary: 'A poll', kind: 'query', op: 'poll', positionals: ['id'], examples: ['breakrocks polls show <id>'] });

export const eventsCreate = apiCommand({
  name: 'events create', summary: 'Propose an event in a universe (createUniverseEvent): 1 to 5 free tags', kind: 'mutation', op: 'createUniverseEvent', positionals: ['input.universe'],
  description: 'Since specs v101.0.0 (D-300) a universe event carries 1 to 5 free tags (--tags, required: FREE_TAGS_REQUIRED); a resident proposes it, the leadership of the universe creates it. --route-id: a route of the universe or one\'s own; --no-discussion turns its event discussion off; --from-discussion: the universe discussion it is proposed from (/event).',
  descriptions: { ...u, place: 'Where, as text', point: 'Where: { "lat", "lon" }', tags: 'Its free tags (repeat --tags, or commas): 1 to 5, required', routeId: 'The id of a route of the universe or of one\'s own', discussion: 'Its event discussion (on unless --no-discussion)', fromDiscussion: 'The id of the universe discussion it is proposed from' },
  require: ['tags'],
  prepare: (i) => ({ ...i, tags: freeTags(i.tags, 1, 'A universe event') }),
  examples: ['breakrocks events create %paris --title "Pique-nique" --starts-at 2026-11-01T12:00:00Z --minutes 120 --place "Buttes-Chaumont" --tags pique-nique --tags parc'],
});
export const eventsAttend: Command<{ id: string; no?: boolean }, unknown> = {
  name: 'events attend', summary: 'Attend an event (--no: no longer)', examples: ['breakrocks events attend <id>', 'breakrocks events attend <id> --no'],
  input: object({ id: str('The event'), no: bool('No longer attend') }, ['id']), output: outputSchema('UniverseEvent', 1), args: { positionals: ['id'] },
  run: async (ctx, { id, no }) => (await api<{ attendUniverseEvent: unknown }>(ctx, `mutation($id: ID!, $a: Boolean!, $r: ID!) { attendUniverseEvent(eventId: $id, attending: $a, requestId: $r) ${selection('UniverseEvent', 1)} }`, { id, a: !no, r: uuidv7(ctx.now()) })).attendUniverseEvent,
  quiet: (r) => (r as { id?: string }).id,
};

const ch = { channel: 'The channel: %universe&name, or its id' };
export const channelsCreate = apiCommand({ name: 'channels create', summary: 'Open a channel, a permanent universe discussion (openUniverseDiscussion PERMANENT)', kind: 'mutation', op: 'openUniverseDiscussion', positionals: ['universe', 'name'], fixed: { lifetime: 'PERMANENT' }, hide: ['hours', 'subject', 'messageTtlSeconds'], descriptions: { ...u, name: 'Its name (without &)' }, examples: ['breakrocks channels create %paris velo'] });
const onChannel = { positionals: ['channel'], extra: { channel: str(ch.channel) }, hide: ['id'], require: ['channel'], prepare: async (i: Record<string, unknown>, ctx: Context) => { const { channel, ...rest } = i; return { ...rest, id: await discussionIdOf(ctx, String(channel)) }; } };
export const channelsJoin = apiCommand({ name: 'channels join', summary: 'Join a channel (joinUniverseDiscussion)', kind: 'mutation', op: 'joinUniverseDiscussion', ...onChannel, examples: ['breakrocks channels join %paris&velo'] });
export const channelsLeave = apiCommand({ name: 'channels leave', summary: 'Leave a channel (leaveUniverseDiscussion)', kind: 'mutation', op: 'leaveUniverseDiscussion', ...onChannel, examples: ['breakrocks channels leave %paris&velo'] });

const REPORT_TARGETS = ['post', 'channel-message', 'direct-message', 'group-message', 'group', 'theme', 'layout', 'banner', 'page', 'territory', 'playlist', 'playlist-item', 'route', 'post-place', 'place-message', 'map-presence'] as const;
/** The reasons of a report, read from the contract (ReportReason). */
export const REPORT_REASONS: readonly string[] = enumValues('ReportReason') ?? [];
/** At most 1,000 characters of details (specs v99.1.0, M-09: REPORT_DETAILS_TOO_LONG). */
export const REPORT_DETAILS_MAX = 1000;
type ReportInput = { target: (typeof REPORT_TARGETS)[number]; id: string; reason: string; article?: number; channel?: string; account?: string; group?: string; message?: string; part?: string; block?: string; item?: string; post?: string; details?: string; goodFaith?: boolean };
export const report: Command<ReportInput, unknown> = {
  name: 'report', summary: 'Report a post, a message, a group, a theme, a layout, a banner, a page, a territory, a playlist, a route, a place or a map presence (report)',
  description: [
    'report post <id>; report channel-message <message id> --channel %u&name; report direct-message <message id> --account @h; report group-message <group id> --message <message id>; report group <group id>;',
    'report theme %u/name [--part]; report layout %u/name; report banner %u; report page %u/name [--block]; report territory %u; report playlist <playlist id>; report playlist-item <playlist id> --item <item id> | --post <post id>;',
    'report route <route id>; report post-place <post id>; report place-message <message id> --channel %u&name | --account @h | --group <group id>; report map-presence @handle.',
    `The reason is a ReportReason (${REPORT_REASONS.join(', ')}); --article names the article of the rules or the charter; --details adds a free text (at most ${REPORT_DETAILS_MAX} characters).`,
    'ILLEGAL needs --good-faith: the reporter declares in good faith that the content is illegal (DSA art. 16(2), REPORT_GOOD_FAITH_REQUIRED).',
  ].join(' '),
  examples: ['breakrocks report post <id> --reason SPAM_OR_FLOOD', 'breakrocks report theme %paris/stade-nuit --reason ILLEGAL --part BANNER --details "A logo that is not theirs" --good-faith', 'breakrocks report channel-message <message id> --channel %paris&velo --reason OFF_TOPIC', 'breakrocks report route <route id> --reason MISLEADING'],
  input: object({
    target: str('What is reported', { enum: REPORT_TARGETS }), id: str('Its id (a theme, a layout or a page: %universe/name; a banner or a territory: %universe; a map presence: @handle or the account id)'),
    reason: str('The reason (ReportReason)', { enum: REPORT_REASONS }), article: int('The article of the rules or the charter'),
    details: str(`Details, a free text (at most ${REPORT_DETAILS_MAX} characters)`, { maxLength: REPORT_DETAILS_MAX }), goodFaith: bool('Declare in good faith that the content is illegal (required with ILLEGAL)'),
    channel: str('For a channel message or a place sent in a channel: the channel (%universe&name)'), account: str('For a direct message or a place sent in one: the other account (@handle or id)'), group: str('For a place sent in a group chat: the group id'), message: str('For a group message: the message id'),
    part: str('For a theme: the part reported (ThemeReportPart)'), block: str('For a page: the block reported'), item: str('For a playlist item: the id of a course link or document'), post: str('For a playlist item: the id of its post'),
  }, ['target', 'id', 'reason']),
  output: outputSchema('Report', 1), args: { positionals: ['target', 'id'] },
  run: async (ctx, i) => {
    if (i.reason === 'ILLEGAL' && !i.goodFaith) throw usageError('REPORT_GOOD_FAITH_REQUIRED', 'ILLEGAL: --good-faith is required (you declare in good faith that the content is illegal)');
    const named = () => refOf(i.id, 'id') as { universe: string; name: string };
    const discussion = async () => {
      if ([i.channel, i.account, i.group].filter(Boolean).length !== 1) throw usageError('INVALID_INPUT', 'One of --channel, --account or --group is needed');
      return i.channel ? { channel: i.channel } : i.account ? { accountId: await accountIdOf(ctx, i.account) } : { groupChatId: i.group };
    };
    let target: Record<string, unknown>;
    switch (i.target) {
      case 'post': target = { kind: 'POST', postId: i.id }; break;
      case 'channel-message': if (!i.channel) throw usageError('INVALID_INPUT', '--channel is needed'); target = { kind: 'CHANNEL_MESSAGE', discussion: { channel: i.channel }, messageId: i.id }; break;
      case 'direct-message': if (!i.account) throw usageError('INVALID_INPUT', '--account is needed'); target = { kind: 'DIRECT_MESSAGE', discussion: { accountId: await accountIdOf(ctx, i.account) }, messageId: i.id }; break;
      case 'group-message': if (!i.message) throw usageError('INVALID_INPUT', '--message is needed'); target = { kind: 'GROUP_MESSAGE', discussion: { groupChatId: i.id }, messageId: i.message }; break;
      case 'group': target = { kind: 'GROUP_CHAT', discussion: { groupChatId: i.id } }; break;
      case 'theme': { const r = named(); target = { kind: 'THEME', universe: r.universe, name: r.name, ...(i.part ? { themePart: i.part } : {}) }; break; }
      case 'layout': { const r = named(); target = { kind: 'LAYOUT', universe: r.universe, name: r.name }; break; }
      case 'page': { const r = named(); target = { kind: 'UNIVERSE_PAGE', universe: r.universe, name: r.name, ...(i.block ? { block: i.block } : {}) }; break; }
      case 'banner': target = { kind: 'UNIVERSE_BANNER', universe: i.id }; break;
      case 'territory': target = { kind: 'UNIVERSE_TERRITORY', universe: i.id }; break;
      case 'playlist': target = { kind: 'PLAYLIST', playlistId: i.id }; break;
      case 'playlist-item': if (!!i.item === !!i.post) throw usageError('INVALID_INPUT', '--item or --post is needed (one of them)'); target = { kind: 'PLAYLIST_ITEM', playlistId: i.id, ...(i.item ? { itemId: i.item } : { postId: i.post }) }; break;
      case 'route': target = { kind: 'ROUTE', routeId: i.id }; break;
      case 'post-place': target = { kind: 'POST_PLACE', postId: i.id }; break;
      case 'place-message': target = { kind: 'PLACE_MESSAGE', discussion: await discussion(), messageId: i.id }; break;
      case 'map-presence': target = { kind: 'MAP_PRESENCE', accountId: await accountIdOf(ctx, i.id) }; break;
    }
    const vars = { t: target, reason: i.reason, article: i.article ?? null, details: i.details ?? null, goodFaith: i.goodFaith ?? null, r: uuidv7(ctx.now()) };
    return (await api<{ report: unknown }>(ctx, `mutation($t: ReportTargetInput!, $reason: ReportReason!, $article: Int, $details: String, $goodFaith: Boolean, $r: ID!) { report(target: $t, reason: $reason, article: $article, details: $details, goodFaith: $goodFaith, requestId: $r) ${selection('Report', 1)} }`, vars)).report;
  },
  quiet: (r) => (r as { id?: string }).id,
};
