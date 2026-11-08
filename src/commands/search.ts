// Search, clips and what the recommendations know (D-92, D-303: the operations of before specs v83.1.0 still without a
// command): the search, the clip feed and its tabs, the interest profile (shown, added to, fields chosen, forgotten),
// the tags engaged with, what one is not interested in; and the reading left: a thread, the reposts of a post, the
// replies of an account, a link preview, whether one follows an address, who may reply to a post, one's map avatar.
import { apiCommand } from '../api/command.js';
import { usageError } from '../errors.js';
import type { JsonSchema } from '../schema.js';
import { listText, pageText } from './shared.js';

type PostLine = { id: string; createdAt?: string; author?: { handle?: string } | null; text?: string | null; universe?: string | null };
const postLine = (p: PostLine) => `${p.id}  ${p.createdAt ?? ''}  @${p.author?.handle ?? '?'}${p.universe ? `  ${p.universe}` : ''}  ${(p.text ?? '').replace(/\s+/g, ' ').slice(0, 80)}`;

type Results = { text?: string | null; postsStatus?: string; addresses?: string[]; tags?: string[]; accounts?: { handle?: string }[]; universeResults?: { universes?: { name?: string }[] }[]; posts?: PostLine[]; next?: string | null };
export const search = apiCommand({
  name: 'search', summary: 'Search posts, accounts, universes, pages, discussions, playlists and tags (search: 2 to 200 characters, words and addresses)',
  description: '--order RELEVANCE (by default) or DATE; --hidden-replies: the hidden replies too; --after: the next of the same search (within an hour). 500 posts at most. The cell called only.',
  kind: 'query', op: 'search', positionals: ['query'], descriptions: { query: 'The words and addresses (2 to 200 characters)', hiddenReplies: 'The hidden replies too' }, depth: 1,
  text: (r) => {
    const s = r as Results | null;
    if (!s) return '(none)';
    return [
      ...(s.addresses?.length ? [`addresses: ${s.addresses.join(' ')}`] : []), ...(s.tags?.length ? [`tags: ${s.tags.map((t) => `#${t}`).join(' ')}`] : []),
      ...(s.accounts?.length ? [`accounts: ${s.accounts.map((a) => `@${a.handle}`).join(' ')}`] : []), ...(s.universeResults?.length ? [`universes: ${s.universeResults.flatMap((x) => (x.universes ?? []).map((v) => v.name)).join(' ')}`] : []),
      ...(s.posts ?? []).map(postLine), ...(s.postsStatus && s.postsStatus !== 'OK' ? [`posts: ${s.postsStatus}`] : []), ...(s.next ? [`next: ${s.next}`] : []),
    ].join('\n') || '(nothing found)';
  },
  examples: ['breakrocks search "velo paris"', 'breakrocks search "#football %paris" --order DATE --json'],
});

type ClipItem = { stage?: string; post?: PostLine | null; recommendation?: { reason?: string } | string | null };
const clipLine = (c: ClipItem) => `${c.post ? postLine(c.post) : '-'}  ${c.stage ?? ''}${c.recommendation ? `  (${typeof c.recommendation === 'string' ? c.recommendation : c.recommendation.reason ?? 'recommended'})` : ''}`;
export const clipsFeed = apiCommand({
  name: 'clips feed', summary: 'The clip feed that never ends: of an address, or of the follows (clipFeedSequence)', kind: 'query', op: 'clipFeedSequence', positionals: ['address'],
  descriptions: { address: 'The address (%universe, #tag, @handle; none: the follows)', language: 'The language of the app (BCP 47)' }, depth: 2, text: pageText(clipLine),
  examples: ['breakrocks clips feed', 'breakrocks clips feed %paris --json'],
});
export const clipsPlatform = apiCommand({
  name: 'clips platform', summary: 'The platform clips: every vertical and square clip of the public universes ranked by its quality, the reader\'s languages first (platformClips)', kind: 'query', op: 'platformClips',
  descriptions: { language: 'The language of the app (BCP 47)' }, depth: 2, text: pageText(clipLine), examples: ['breakrocks clips platform --language fr'],
});
export const clipsPopular = apiCommand({
  name: 'clips popular', summary: 'The popular clips of the last 7 days in the reader\'s languages (popularClips)', kind: 'query', op: 'popularClips', descriptions: { language: 'The language of the app (BCP 47)' }, depth: 1,
  text: pageText(postLine), examples: ['breakrocks clips popular --language fr'],
});

// ---- The interest profile ----

type Profile = { chosenFields?: string[]; fieldChoiceOffered?: boolean; consents?: { field?: string }[]; inferred?: { kind?: string; tag?: string | null; universe?: string | null; field?: string | null }[] };
const profileText = (r: unknown) => {
  const p = r as Profile | null;
  if (!p) return '(none)';
  return [`chosen fields: ${(p.chosenFields ?? []).join(', ') || '-'}${p.fieldChoiceOffered ? '  (the choice is offered: interests fields)' : ''}`, ...(p.inferred ?? []).map((i) => `inferred ${i.kind ?? ''}: ${i.tag ? `#${i.tag}` : i.universe ?? i.field ?? '-'}`)].join('\n');
};
const interestFlags = {
  tags: { type: 'array', items: { type: 'string' }, description: 'Tags (without #)' }, universes: { type: 'array', items: { type: 'string' }, description: 'Universes (%name)' },
  universeFields: { type: 'array', items: { type: 'string' }, description: 'Fields (UniverseField; --fields is the global option)' }, consent: { type: 'boolean', description: 'The consent for a field of a special category' },
} satisfies Record<string, JsonSchema>;
const INTERESTS: JsonSchema = { type: 'array', items: { type: 'object' }, description: 'The interests: [{ "tag" | "universe" | "field", "consent" }] (JSON)' };
/** --tags, --universes, --universe-fields (and --consent) turned into the interests (InterestInput), or --interests as given. */
function interestsOf(i: Record<string, unknown>): { rest: Record<string, unknown>; interests?: Record<string, unknown>[] } {
  const { tags, universes, universeFields: fields, consent, ...rest } = i as { tags?: string[]; universes?: string[]; universeFields?: string[]; consent?: boolean } & Record<string, unknown>;
  const made = [...(tags ?? []).map((tag) => ({ tag: tag.replace(/^#/, '') })), ...(universes ?? []).map((universe) => ({ universe })), ...(fields ?? []).map((field) => ({ field, ...(consent ? { consent: true } : {}) }))];
  if (made.length && rest.interests !== undefined) throw usageError('INVALID_INPUT', '--interests, or --tags, --universes and --universe-fields');
  return { rest, interests: made.length ? made : (rest.interests as Record<string, unknown>[] | undefined) };
}
export const interestsShow = apiCommand({ name: 'interests show', summary: 'The interest profile of the account: the fields chosen, the interests inferred, the consents (myInterestProfile)', kind: 'query', op: 'myInterestProfile', text: profileText, examples: ['breakrocks interests show'] });
export const interestsAdd = apiCommand({
  name: 'interests add', summary: 'Add interests to the profile: tags, universes, fields (addInterests; 100 at most)', description: 'A field of a special category needs --consent. Or --interests [{ "tag" | "universe" | "field", "consent" }] (JSON).',
  kind: 'mutation', op: 'addInterests', hide: ['interests'], extra: { ...interestFlags, interests: INTERESTS },
  prepare: (i) => { const { rest, interests } = interestsOf(i); if (!interests?.length) throw usageError('INVALID_INPUT', 'Interests: --tags, --universes, --universe-fields or --interests'); return { ...rest, interests }; },
  text: profileText, examples: ['breakrocks interests add --tags football,velo --universes %paris', 'breakrocks interests add --universe-fields POLITICS --consent'],
});
export const interestsFields = apiCommand({
  name: 'interests fields', summary: 'Choose 1 to 3 fields, once, while the choice is offered (--choices []: skip it) (chooseFields)', kind: 'mutation', op: 'chooseFields', positionals: ['fields'], rename: { fields: 'choices' },
  descriptions: { choices: 'The fields (UniverseField), 1 to 3; [] skips the choice', consented: 'The fields of a special category whose consent is given' }, text: profileText,
  examples: ['breakrocks interests fields SPORT PLACES', 'breakrocks interests fields --choices []'],
});
export const interestsForget = apiCommand({
  name: 'interests forget', summary: 'Forget interests (not inferred again for 90 days), or --all: the whole profile and its consents (forgetInterests)', kind: 'mutation', op: 'forgetInterests', hide: ['interests'],
  extra: { ...interestFlags, interests: INTERESTS, all: { type: 'boolean', description: 'The whole profile' } },
  prepare: (i) => {
    const { all, ...given } = i;
    const { rest, interests } = interestsOf(given);
    if (!all === !interests?.length) throw usageError('INVALID_INPUT', 'Interests (--tags, --universes, --universe-fields, --interests), or --all');
    return all ? { ...rest, interests: null } : { ...rest, interests };
  },
  confirm: (i) => (i.all ? 'Forget the whole interest profile and its consents?' : 'Forget these interests for 90 days?'), text: profileText,
  examples: ['breakrocks interests forget --tags football --yes', 'breakrocks interests forget --all --yes'],
});
export const interestsTags = apiCommand({ name: 'interests tags', summary: 'The tags the account engaged with (myEngagedTags)', kind: 'query', op: 'myEngagedTags', text: listText((t: string) => `#${t}`), examples: ['breakrocks interests tags'] });
export const interestsNotInterested = apiCommand({
  name: 'interests not-interested', summary: 'What the account said it is not interested in: posts, accounts, tags, universes, until when (myNotInterested)', kind: 'query', op: 'myNotInterested', depth: 1,
  text: listText((n: { scope?: string; tag?: string | null; universe?: string | null; account?: { handle?: string } | null; post?: { id?: string } | null; until?: string | null }) => `${n.scope ?? ''}  ${n.tag ? `#${n.tag}` : n.universe ?? (n.account?.handle ? `@${n.account.handle}` : n.post?.id ?? '')}${n.until ? `  until ${n.until}` : ''}`),
  examples: ['breakrocks interests not-interested'],
});

// ---- Reading left ----

export const postsThread = apiCommand({
  name: 'posts thread', summary: 'A post and its replies, in the order of the thread (thread; --hidden: the hidden replies of its root)', kind: 'query', op: 'thread', positionals: ['postId'], descriptions: { postId: 'The post', hidden: 'The hidden replies of its root' }, depth: 1,
  text: (r) => { const t = r as { root?: PostLine; items?: PostLine[]; next?: string | null } | null; return t ? [...(t.root ? [postLine(t.root)] : []), ...(t.items ?? []).map((p) => `  ${postLine(p)}`), ...(t.next ? [`next: ${t.next}`] : [])].join('\n') : '(none)'; },
  examples: ['breakrocks posts thread <post id>', 'breakrocks posts thread <post id> --hidden'],
});
export const postsReposts = apiCommand({ name: 'posts reposts', summary: 'The reposts of a post, the most recent first (reposts)', kind: 'query', op: 'reposts', positionals: ['postId'], descriptions: { postId: 'The post' }, depth: 1, text: pageText(postLine), examples: ['breakrocks posts reposts <post id>'] });
export const postsLinkPreview = apiCommand({
  name: 'posts link-preview', summary: 'The preview of a link before it is posted: title, description, image (linkPreview; none: no preview)', kind: 'query', op: 'linkPreview', positionals: ['url'], descriptions: { url: 'The link (https)' },
  text: (r) => { const l = r as { title?: string; siteName?: string | null; description?: string | null; url?: string } | null; return l ? [`${l.title}${l.siteName ? `  (${l.siteName})` : ''}`, ...(l.description ? [l.description] : []), l.url ?? ''].join('\n') : '(no preview)'; },
  examples: ['breakrocks posts link-preview https://example.com/article'],
});
export const postsReplyPolicy = apiCommand({
  name: 'posts reply-policy', summary: 'Set who can reply to one of your posts: everyone, following, mentioned or nobody (setReplyPolicy)', kind: 'mutation', op: 'setReplyPolicy', positionals: ['postId', 'policy'], descriptions: { postId: 'The post', policy: 'everyone, following, mentioned or nobody' }, depth: 1,
  text: (r) => (r ? postLine(r as PostLine) : '(none)'), examples: ['breakrocks posts reply-policy <post id> mentioned'],
});
export const accountsReplies = apiCommand({ name: 'accounts replies', summary: 'The replies of an account, the newest first, those you may read (replies)', kind: 'query', op: 'replies', positionals: ['accountId'], rename: { accountId: 'account' }, descriptions: { account: 'The account: @handle or its id' }, depth: 1, text: pageText(postLine), examples: ['breakrocks accounts replies @alice'] });
export const accountsIsFollowing = apiCommand({
  name: 'accounts is-following', summary: 'Whether you follow an address: an account, an account in a universe, a universe (isFollowing)', kind: 'query', op: 'isFollowing', positionals: ['address'], descriptions: { address: 'The address (@bob, @bob%paris, %paris)' },
  text: (r) => (r === true ? 'following' : r === false ? 'not following' : '(none)'), examples: ['breakrocks accounts is-following @alice', 'breakrocks accounts is-following %paris'],
});
export const mapAvatar = apiCommand({ name: 'map avatar', summary: 'Your map avatar: its parts (myMapAvatar; choosing and buying parts are not served yet)', kind: 'query', op: 'myMapAvatar', examples: ['breakrocks map avatar --json'] });

export const searchCommands = [search, clipsFeed, clipsPlatform, clipsPopular, interestsShow, interestsAdd, interestsFields, interestsForget, interestsTags, interestsNotInterested];
export const readingCommands = [postsThread, postsReposts, postsLinkPreview, postsReplyPolicy, accountsReplies, accountsIsFollowing, mapAvatar];
