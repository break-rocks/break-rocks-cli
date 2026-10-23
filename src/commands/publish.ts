// Publishing and interacting: a post with its images or its
// clip (checked as the app checks them, sent, then the post sent again while the platform processes
// them, with the same requestId), replies, reposts, quotes, reactions, the posts of the author, the
// relations, the residence and the favorites, the private universes, the proposals and votes,
// debates, polls, events, channels, reports. Tags and mentions are in the text. No mass
// deletion. The refusals are the platform's.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { accountIdOf, apiCommand, refOf } from '../api/command.js';
import { outputSchema, selection } from '../api/graphql.js';
import type { Context } from '../context.js';
import { usageError } from '../errors.js';
import { MAX_POST_IMAGES, checkImage, checkText, checkVideo, uploadImage, uploadVideo, whileProcessing, type CheckedImage, type CheckedVideo } from '../media.js';
import type { Command } from '../registry.js';
import { bool, int, list, object, str } from '../schema.js';
import { api } from '../session.js';

const POST = selection('Post', 1);
const REPLY_POLICIES = ['everyone', 'following', 'mentioned', 'nobody'];

export type ComposeInput = { text?: string; file?: string; image?: string[]; alt?: string[]; video?: string; link?: string; requestId?: string; dryRun?: boolean };
export const composeProps = {
  text: str('The text (tags and mentions in it: #sport, @alice); "-" reads stdin'),
  file: str('Read the text from this file ("-": stdin)'),
  image: list('An image file (4 at most; repeat --image)', { type: 'string' }, { maxItems: MAX_POST_IMAGES }),
  alt: list('The alternative text of each image, in the order of --image (repeat --alt)', { type: 'string' }, { maxItems: MAX_POST_IMAGES }),
  video: str('A video file (the clip of the post: MP4, MOV or WebM, 512 MB at most)'),
  link: str('A link (https)'),
  requestId: str('An idempotency key (UUID): sent again, the post is made once (one is made when absent)', { pattern: '^[0-9a-fA-F-]{36}$' }),
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

export type Plan = { text: string; images: CheckedImage[]; video?: CheckedVideo; link?: string; requestId: string };

/** Everything checked before anything is sent (POST_EMPTY, POST_TOO_MANY_IMAGES, POST_IMAGES_AND_CLIP, the media). */
export async function plan(ctx: Context, input: ComposeInput, requireText = false): Promise<Plan> {
  const text = checkText(await textOf(ctx, input));
  const images = (input.image ?? []).map((path, i) => checkImage(ctx, path, input.alt?.[i]));
  if ((input.alt?.length ?? 0) > images.length) throw usageError('INVALID_INPUT', 'More --alt than --image');
  if (images.length > MAX_POST_IMAGES) throw usageError('POST_TOO_MANY_IMAGES', 'A post has at most 4 images');
  const video = input.video ? checkVideo(ctx, input.video) : undefined;
  if (video && images.length) throw usageError('POST_IMAGES_AND_CLIP', 'A post has images or a clip, not both');
  if (!text.trim() && !images.length && !video && (requireText || !input.link)) throw usageError('POST_EMPTY', 'A post has a text or media');
  return { text, images, ...(video ? { video } : {}), ...(input.link ? { link: input.link } : {}), requestId: input.requestId ?? randomUUID() };
}

export const dryRunOf = (p: Plan, extra: Record<string, unknown>) => ({
  dryRun: true, ...extra, text: p.text, requestId: p.requestId,
  images: p.images.map((i) => ({ file: i.name, type: i.type, bytes: i.bytes, width: i.width, height: i.height, alt: i.alt ?? null })),
  ...(p.video ? { video: { file: p.video.name, type: p.video.type, bytes: p.video.bytes } } : {}), ...(p.link ? { link: p.link } : {}),
});

/** The media of a plan sent: the arguments images and clip of the mutation. */
export async function sendMedia(ctx: Context, p: Plan): Promise<Record<string, unknown>> {
  const images = [];
  for (const image of p.images) images.push({ id: await uploadImage(ctx, image), ...(image.alt ? { alt: image.alt } : {}) });
  const clip = p.video ? await uploadVideo(ctx, p.video) : undefined;
  return { ...(images.length ? { images } : {}), ...(clip ? { clip } : {}) };
}

export const wait = (p: Plan) => (p.video ? { stepMs: 5000, maxMs: 10 * 60_000 } : { stepMs: 2000, maxMs: 2 * 60_000 });
const composeOutput = outputSchema('Post', 1);

export const post: Command<ComposeInput & { in?: string; replyPolicy?: string; announcement?: boolean }, unknown> = {
  name: 'post', summary: 'Publish a post: text, images (4) or a clip, a link, in an address (createPost)',
  description: 'The images and the clip are checked as the app checks them (an image JPEG, PNG, WebP or GIF of 10 MB at most; a clip MP4, MOV or WebM of 512 MB at most), sent, then the post waits for their processing. --in is the address of publication (%universe, %universe/sub, %universe#tag); the tags and mentions are those of the text. --dry-run checks and tells, without sending.',
  examples: ['breakrocks post "Match ce soir #foot" --in %test-village-sport', 'breakrocks post "Le stade" --in %paris --image stade.jpg --alt "Le stade la nuit"', 'echo "Bonjour" | breakrocks post - --in %paris', 'breakrocks post --file post.md --in %paris --dry-run'],
  input: object({ ...composeProps, in: str('The address of publication (%universe, %universe/sub, %universe#tag)'), replyPolicy: str('Who may reply', { enum: REPLY_POLICIES }), announcement: bool('An announcement of the universe (its leadership)') }),
  output: composeOutput, args: { positionals: ['text'] },
  run: async (ctx, input) => {
    const p = await plan(ctx, input);
    if (input.dryRun) return dryRunOf(p, { operation: 'createPost', universe: input.in ?? null, replyPolicy: input.replyPolicy ?? null, announcement: !!input.announcement });
    const media = await sendMedia(ctx, p);
    const vars = { text: p.text, universe: input.in ?? null, link: p.link ?? null, replyPolicy: input.replyPolicy ?? null, announcement: input.announcement ?? null, requestId: p.requestId, images: media.images ?? null, clip: media.clip ?? null };
    return whileProcessing(ctx, async () => (await api<{ createPost: unknown }>(ctx, `mutation($text: String!, $universe: String, $link: String, $replyPolicy: ReplyPolicy, $announcement: Boolean, $requestId: ID, $images: [ImageAttachmentInput], $clip: ID) { createPost(text: $text, universe: $universe, link: $link, replyPolicy: $replyPolicy, announcement: $announcement, requestId: $requestId, images: $images, clip: $clip) ${POST} }`, vars)).createPost, wait(p));
  },
  quiet: (r) => (r as { id?: string }).id,
};

export const reply: Command<ComposeInput & { id: string }, unknown> = {
  name: 'reply', summary: 'Reply to a post (replyTo), with images or a clip', examples: ['breakrocks reply 01a166cb-bfff-7237-81a6-fb564222fe97 "Bien vu !"', 'breakrocks reply <id> --file reply.txt --image a.png'],
  input: object({ id: str('The post replied to'), ...composeProps }, ['id']), output: composeOutput, args: { positionals: ['id', 'text'] },
  run: async (ctx, input) => {
    const p = await plan(ctx, input);
    if (input.dryRun) return dryRunOf(p, { operation: 'replyTo', id: input.id });
    const media = await sendMedia(ctx, p);
    const vars = { id: input.id, text: p.text, link: p.link ?? null, requestId: p.requestId, images: media.images ?? null, clip: media.clip ?? null };
    return whileProcessing(ctx, async () => (await api<{ replyTo: unknown }>(ctx, `mutation($id: ID!, $text: String!, $link: String, $requestId: ID, $images: [ImageAttachmentInput], $clip: ID) { replyTo(id: $id, text: $text, link: $link, requestId: $requestId, images: $images, clip: $clip) ${POST} }`, vars)).replyTo, wait(p));
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
    const media = await sendMedia(ctx, p);
    const vars = { id: input.id, text: p.text, universe: input.in ?? null, link: p.link ?? null, replyPolicy: input.replyPolicy ?? null, requestId: p.requestId, images: media.images ?? null, clip: media.clip ?? null };
    return whileProcessing(ctx, async () => (await api<{ quote: unknown }>(ctx, `mutation($id: ID!, $text: String!, $universe: String, $link: String, $replyPolicy: ReplyPolicy, $requestId: ID, $images: [ImageAttachmentInput], $clip: ID) { quote(id: $id, text: $text, universe: $universe, link: $link, replyPolicy: $replyPolicy, requestId: $requestId, images: $images, clip: $clip) ${POST} }`, vars)).quote, wait(p));
  },
  quiet: (r) => (r as { id?: string }).id,
};

const postId = { id: 'The id of the post' };
export const repost = apiCommand({ name: 'repost', summary: 'Repost a post (--universe: in another universe)', kind: 'mutation', op: 'repost', positionals: ['id'], descriptions: { ...postId, universe: 'Where to repost it (default: its universe)' }, examples: ['breakrocks repost <id>', 'breakrocks repost <id> --universe %lyon'], rename: {}, depth: 1 });
export const like = apiCommand({ name: 'like', summary: 'Like a post', kind: 'mutation', op: 'likePost', positionals: ['id'], descriptions: postId, examples: ['breakrocks like <id>'], depth: 1 });
export const unlike = apiCommand({ name: 'unlike', summary: 'Take back a like', kind: 'mutation', op: 'unlikePost', positionals: ['id'], descriptions: postId, examples: ['breakrocks unlike <id>'], depth: 1 });
export const dislike = apiCommand({ name: 'dislike', summary: 'Dislike a post', kind: 'mutation', op: 'dislikePost', positionals: ['id'], descriptions: postId, examples: ['breakrocks dislike <id>'], depth: 1 });
export const undislike = apiCommand({ name: 'undislike', summary: 'Take back a dislike', kind: 'mutation', op: 'undislikePost', positionals: ['id'], descriptions: postId, examples: ['breakrocks undislike <id>'], depth: 1 });
export const notInterested = apiCommand({ name: 'not-interested', summary: 'Not interested in a post, its author, a tag or its universe (notInterested)', kind: 'mutation', op: 'notInterested', positionals: ['postId'], descriptions: { scope: 'What is not interesting: POST, AUTHOR, TAG or UNIVERSE', tag: 'The tag, for the scope TAG' }, examples: ['breakrocks not-interested <id> --scope AUTHOR'] });

export const postsEdit = apiCommand({ name: 'posts edit', summary: 'Change the text of one\'s post (within 1 hour)', kind: 'mutation', op: 'changePost', positionals: ['id', 'text'], descriptions: postId, examples: ['breakrocks posts edit <id> "Le texte corrigé"'], depth: 1 });
export const postsDelete = apiCommand({ name: 'posts delete', summary: 'Delete one\'s post (one at a time)', kind: 'mutation', op: 'deletePost', positionals: ['id'], descriptions: postId, confirm: (i) => `Delete the post ${i.id}?`, examples: ['breakrocks posts delete <id> --yes'], depth: 1 });
export const postsPin = apiCommand({ name: 'posts pin', summary: 'Pin a post in a universe (pinPost)', kind: 'mutation', op: 'pinPost', positionals: ['postId'], rename: { universe: 'in' }, descriptions: { in: 'The universe (%name)' }, examples: ['breakrocks posts pin <id> --in %paris'], depth: 1 });
export const postsUnpin = apiCommand({ name: 'posts unpin', summary: 'Unpin a post', kind: 'mutation', op: 'unpinPost', positionals: ['postId'], rename: { universe: 'in' }, descriptions: { in: 'The universe (%name)' }, examples: ['breakrocks posts unpin <id> --in %paris'], depth: 1 });

export const follow = apiCommand({ name: 'follow', summary: 'Follow an address: an account, a universe, a tag (follow)', kind: 'mutation', op: 'follow', positionals: ['address'], examples: ['breakrocks follow @alice', 'breakrocks follow %paris#velo'] });
export const unfollow = apiCommand({ name: 'unfollow', summary: 'Stop following an address', kind: 'mutation', op: 'unfollow', positionals: ['address'], examples: ['breakrocks unfollow @alice'] });
const account = (verb: string, op: string, summary: string) => apiCommand({ name: verb, summary, kind: 'mutation', op, positionals: ['accountId'], rename: { accountId: 'account' }, descriptions: { account: 'The account: @handle or its id' }, examples: [`breakrocks ${verb} @alice`], depth: 1 });
export const block = account('block', 'block', 'Block an account');
export const unblock = account('unblock', 'unblock', 'Unblock an account');
export const mute = account('mute', 'mute', 'Mute an account');
export const unmute = account('unmute', 'unmute', 'Unmute an account');

const u = { universe: 'The universe (%name)' };
export const universesJoin = apiCommand({ name: 'universes join', summary: 'Become a resident of a universe (joinUniverse)', kind: 'mutation', op: 'joinUniverse', positionals: ['universe'], descriptions: u, examples: ['breakrocks universes join %paris'] });
export const universesLeave = apiCommand({ name: 'universes leave', summary: 'Stop being a resident (the residence time is lost)', kind: 'mutation', op: 'leaveUniverse', positionals: ['universe'], descriptions: u, confirm: (i) => `Leave ${i.universe}? The residence time is lost.`, examples: ['breakrocks universes leave %paris --yes'] });
export const universesAskToJoin = apiCommand({ name: 'universes ask-to-join', summary: 'Ask to join a private universe', kind: 'mutation', op: 'askToJoinUniverse', positionals: ['universe'], descriptions: { ...u, conditionsVersion: 'The version of its conditions accepted' }, examples: ['breakrocks universes ask-to-join %club --conditions-version 2'] });
export const favoriteAdd = apiCommand({ name: 'universes favorite add', summary: 'Add a favorite universe', kind: 'mutation', op: 'addFavoriteUniverse', positionals: ['universe'], descriptions: u, examples: ['breakrocks universes favorite add %paris'] });
export const favoriteRemove = apiCommand({ name: 'universes favorite remove', summary: 'Remove a favorite universe', kind: 'mutation', op: 'removeFavoriteUniverse', positionals: ['universe'], descriptions: u, examples: ['breakrocks universes favorite remove %paris'] });
export const favoriteMove = apiCommand({ name: 'universes favorite move', summary: 'Move a favorite universe (before another, or last)', kind: 'mutation', op: 'moveFavoriteUniverse', positionals: ['universe'], descriptions: { ...u, before: 'The favorite to put it before (absent: last)' }, examples: ['breakrocks universes favorite move %paris --before %lyon'] });
export const universesCreatePrivate = apiCommand({ name: 'universes create-private', summary: 'Create a private universe (hosted name or own domain)', kind: 'mutation', op: 'createPrivateUniverse', descriptions: { hostedName: 'Its name under the hosting of the platform', domain: 'Its own domain (DNS proof)', joinMode: 'How one joins', legalSpace: 'Its legal space (fra…)', memberTier: 'Its tier of members' }, examples: ['breakrocks universes create-private --hosted-name club-echecs --join-mode REQUEST --legal-space fra --member-tier 1'] });
export const universesInvite = apiCommand({ name: 'universes invite', summary: 'Invite an account (or an email) to a private universe', kind: 'mutation', op: 'inviteToUniverse', positionals: ['universe'], rename: { accountId: 'account' }, descriptions: { ...u, account: 'The account: @handle or its id', email: 'An email, to invite someone without an account' }, examples: ['breakrocks universes invite %club --account @alice'] });
export const conditionsSet = apiCommand({ name: 'universes conditions set', summary: 'Set the conditions of a private universe', kind: 'mutation', op: 'setUniverseConditions', positionals: ['universe', 'text'], descriptions: u, examples: ['breakrocks universes conditions set %club "Respect et bonne humeur"'] });
export const conditionsShow = apiCommand({ name: 'universes conditions show', summary: 'The conditions of a universe (a version)', kind: 'query', op: 'universeConditions', positionals: ['universe'], descriptions: u, examples: ['breakrocks universes conditions show %club'] });
export const conditionsAccept = apiCommand({ name: 'universes conditions accept', summary: 'Accept the conditions of a universe', kind: 'mutation', op: 'acceptUniverseConditions', positionals: ['universe'], descriptions: { ...u, conditionsVersion: 'The version accepted' }, examples: ['breakrocks universes conditions accept %club --conditions-version 2'] });
export const universesMembers = apiCommand({ name: 'universes members', summary: 'The members of a universe', kind: 'query', op: 'universeMembers', positionals: ['universe'], descriptions: u, examples: ['breakrocks universes members %club --all'] });

export const proposalsFile = apiCommand({ name: 'proposals file', summary: 'File a proposal in a universe (fileProposal)', kind: 'mutation', op: 'fileProposal', positionals: ['universe'], descriptions: { ...u, kind: 'The kind of proposal', title: 'Its title', text: 'Its text', accountId: 'The account it concerns: @handle or its id' }, examples: ['breakrocks proposals file %paris --kind ACTION --title "Un banc de plus" --text "Place du marché"', 'breakrocks proposals file %paris --kind THEME --title "Un thème" --theme %paris/stade-nuit'] });
export const proposalsShow = apiCommand({ name: 'proposals show', summary: 'A proposal', kind: 'query', op: 'proposal', positionals: ['id'], examples: ['breakrocks proposals show <id>'] });
export const proposalsSupport = apiCommand({ name: 'proposals support', summary: 'Support a proposal', kind: 'mutation', op: 'supportProposal', positionals: ['id'], examples: ['breakrocks proposals support <id>'] });
export const proposalsVote: Command<{ id: string; choice?: 'for' | 'against'; candidate?: string }, unknown> = {
  name: 'proposals vote', summary: 'Vote on a proposal: for, against, or a candidate (voteOnProposal)', examples: ['breakrocks proposals vote <id> for', 'breakrocks proposals vote <id> --candidate @alice'],
  input: object({ id: str('The proposal'), choice: str('for or against', { enum: ['for', 'against'] }), candidate: str('A candidate (an election): @handle or the id') }, ['id']),
  output: outputSchema('Proposal', 1), args: { positionals: ['id', 'choice'] },
  run: async (ctx, { id, choice, candidate }) => {
    if (!!choice === !!candidate) throw usageError('INVALID_INPUT', 'for, against, or --candidate');
    const vars = { id, yes: choice ? choice === 'for' : null, candidate: candidate ? await accountIdOf(ctx, candidate) : null };
    return (await api<{ voteOnProposal: unknown }>(ctx, `mutation($id: ID!, $yes: Boolean, $candidate: ID) { voteOnProposal(id: $id, yes: $yes, candidate: $candidate) ${selection('Proposal', 1)} }`, vars)).voteOnProposal;
  },
  quiet: (r) => (r as { id?: string }).id,
};
export const proposalsWithdraw = apiCommand({ name: 'proposals withdraw', summary: 'Withdraw one\'s proposal', kind: 'mutation', op: 'withdrawProposal', positionals: ['id'], confirm: (i) => `Withdraw the proposal ${i.id}?`, examples: ['breakrocks proposals withdraw <id> --yes'] });

export const debatesOpen = apiCommand({ name: 'debates open', summary: 'Open a debate in a universe', kind: 'mutation', op: 'openDebate', positionals: ['universe', 'name'], descriptions: { ...u, name: 'Its name (&name)' }, examples: ['breakrocks debates open %paris velo --subject "Des pistes cyclables ?" --hours 48'] });
export const debatesSupport = apiCommand({ name: 'debates support', summary: 'Support a debate', kind: 'mutation', op: 'supportDebate', positionals: ['universe', 'name'], descriptions: u, examples: ['breakrocks debates support %paris velo'] });
export const debatesClose = apiCommand({ name: 'debates close', summary: 'Close a debate', kind: 'mutation', op: 'closeDebate', positionals: ['universe', 'name'], descriptions: u, confirm: (i) => `Close the debate &${i.name} of ${i.universe}?`, examples: ['breakrocks debates close %paris velo --yes'] });
export const debatesShow = apiCommand({ name: 'debates show', summary: 'A debate', kind: 'query', op: 'debate', positionals: ['universe', 'name'], descriptions: u, examples: ['breakrocks debates show %paris velo'] });

export const pollsCreate = apiCommand({ name: 'polls create', summary: 'Create a poll in a universe', kind: 'mutation', op: 'createPoll', positionals: ['universe'], descriptions: { ...u, choices: 'The choices (repeat --choices, or commas)' }, examples: ['breakrocks polls create %paris --question "Quel jour ?" --choices samedi --choices dimanche'] });
export const pollsPick = apiCommand({ name: 'polls pick', summary: 'Pick a choice of a poll (its index, from 0)', kind: 'mutation', op: 'pickPollChoice', positionals: ['id', 'choice'], descriptions: { choice: 'The index of the choice, from 0' }, examples: ['breakrocks polls pick <id> 1'] });
export const pollsShow = apiCommand({ name: 'polls show', summary: 'A poll', kind: 'query', op: 'poll', positionals: ['id'], examples: ['breakrocks polls show <id>'] });

export const eventsCreate = apiCommand({ name: 'events create', summary: 'Create an event in a universe', kind: 'mutation', op: 'createUniverseEvent', positionals: ['universe'], descriptions: { ...u, place: 'Where, as text', point: 'Where: { "lat", "lon" }' }, examples: ['breakrocks events create %paris --title "Pique-nique" --starts-at 2026-11-01T12:00:00Z --minutes 120 --place "Buttes-Chaumont"'] });
export const eventsAttend: Command<{ id: string; no?: boolean }, unknown> = {
  name: 'events attend', summary: 'Attend an event (--no: no longer)', examples: ['breakrocks events attend <id>', 'breakrocks events attend <id> --no'],
  input: object({ id: str('The event'), no: bool('No longer attend') }, ['id']), output: outputSchema('UniverseEvent', 1), args: { positionals: ['id'] },
  run: async (ctx, { id, no }) => (await api<{ attendUniverseEvent: unknown }>(ctx, `mutation($id: ID!, $a: Boolean!) { attendUniverseEvent(id: $id, attending: $a) ${selection('UniverseEvent', 1)} }`, { id, a: !no })).attendUniverseEvent,
  quiet: (r) => (r as { id?: string }).id,
};

const ch = { channel: 'The channel (%universe~name)' };
export const channelsCreate = apiCommand({ name: 'channels create', summary: 'Create a channel in a universe', kind: 'mutation', op: 'createChannel', positionals: ['universe', 'name'], descriptions: u, examples: ['breakrocks channels create %paris velo'] });
export const channelsJoin = apiCommand({ name: 'channels join', summary: 'Join a channel', kind: 'mutation', op: 'joinChannel', positionals: ['channel'], descriptions: ch, examples: ['breakrocks channels join %paris~velo'] });
export const channelsLeave = apiCommand({ name: 'channels leave', summary: 'Leave a channel', kind: 'mutation', op: 'leaveChannel', positionals: ['channel'], descriptions: ch, examples: ['breakrocks channels leave %paris~velo'] });
export const channelsSend = apiCommand({ name: 'channels send', summary: 'Send a message in a channel', kind: 'mutation', op: 'sendChannelMessage', positionals: ['channel', 'text'], descriptions: { ...ch, messageId: 'An idempotency key of the message', respondsTo: 'The message answered' }, examples: ['breakrocks channels send %paris~velo "Rendez-vous à 18 h"'] });
export const channelsRead = apiCommand({ name: 'channels read', summary: 'The messages of a channel', kind: 'query', op: 'channelMessages', positionals: ['channel'], descriptions: ch, examples: ['breakrocks channels read %paris~velo --json'] });

const REPORT_TARGETS = ['post', 'channel-message', 'direct-message', 'group-message', 'group', 'theme', 'layout', 'banner'] as const;
type ReportInput = { target: (typeof REPORT_TARGETS)[number]; id: string; reason: string; article?: number; channel?: string; account?: string; message?: string; part?: string };
export const report: Command<ReportInput, unknown> = {
  name: 'report', summary: 'Report a post, a message, a group, a theme, a layout or a banner (report*)',
  description: 'report post <id>; report channel-message <message id> --channel %u~name; report direct-message <message id> --account @h; report group-message <group id> --message <message id>; report group <group id>; report theme %u/name [--part]; report layout %u/name; report banner %u. The reason is a ReportReason; --article names the article of the rules or the charter. The API takes no free text.',
  examples: ['breakrocks report post <id> --reason SPAM_OR_FLOOD', 'breakrocks report theme %paris/stade-nuit --reason ILLEGAL --part BANNER'],
  input: object({
    target: str('What is reported', { enum: REPORT_TARGETS }), id: str('Its id (a theme or a layout: %universe/name; a banner: %universe)'),
    reason: str('The reason', { enum: ['CHARTER_ARTICLE', 'ILLEGAL', 'OFF_TOPIC', 'PLATFORM_RULES', 'SPAM_OR_FLOOD'] }), article: int('The article of the rules or the charter'),
    channel: str('For a channel message: the channel'), account: str('For a direct message: the other account (@handle or id)'), message: str('For a group message: the message id'),
    part: str('For a theme: the part reported (ThemeReportPart)'),
  }, ['target', 'id', 'reason']),
  output: outputSchema('Report', 1), args: { positionals: ['target', 'id'] },
  run: async (ctx, i) => {
    const R = selection('Report', 1);
    const a = i.article ?? null;
    const call = async (field: string, decl: string, args: string, vars: Record<string, unknown>) => (await api<Record<string, unknown>>(ctx, `mutation(${decl}, $reason: ReportReason!, $article: Int) { ${field}(${args}, reason: $reason, article: $article) ${R} }`, { ...vars, reason: i.reason, article: a }))[field];
    switch (i.target) {
      case 'post': return call('reportPost', '$id: ID!', 'id: $id', { id: i.id });
      case 'channel-message': if (!i.channel) throw usageError('INVALID_INPUT', '--channel is needed'); return call('reportChannelMessage', '$channel: String!, $messageId: ID!', 'channel: $channel, messageId: $messageId', { channel: i.channel, messageId: i.id });
      case 'direct-message': if (!i.account) throw usageError('INVALID_INPUT', '--account is needed'); return call('reportDirectMessage', '$accountId: ID!, $id: ID!', 'accountId: $accountId, id: $id', { accountId: await accountIdOf(ctx, i.account), id: i.id });
      case 'group-message': if (!i.message) throw usageError('INVALID_INPUT', '--message is needed'); return call('reportGroupMessage', '$id: ID!, $messageId: ID!', 'id: $id, messageId: $messageId', { id: i.id, messageId: i.message });
      case 'group': return call('reportGroupChat', '$id: ID!', 'id: $id', { id: i.id });
      case 'theme': { const r = refOf(i.id, 'id') as { universe: string; name: string }; return call('reportTheme', '$universe: String!, $name: String!, $part: ThemeReportPart', 'universe: $universe, name: $name, part: $part', { universe: r.universe, name: r.name, part: i.part ?? null }); }
      case 'layout': { const r = refOf(i.id, 'id') as { universe: string; name: string }; return call('reportLayout', '$universe: String!, $name: String!', 'universe: $universe, name: $name', { universe: r.universe, name: r.name }); }
      case 'banner': return call('reportUniverseBanner', '$universe: String!', 'universe: $universe', { universe: i.id });
    }
  },
  quiet: (r) => (r as { id?: string }).id,
};
