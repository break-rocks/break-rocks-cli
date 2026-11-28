// The appearance editor of a universe (specs v87.4.0, D-267, customize-universe.feature; v96.0.0 D-289; v99.1.0
// D-293): the looks of quick start, the palette of an image, an appearance built from its gestures (one image with
// its focal point and how it shows, one accent, one character, a layout) and applied, or proposed; and the tags of a
// universe (v101.1.0, universe-tags.feature): its tag conventions, its suggestions, the view of a universe and a tag.
// An image is sent first (requestMediaUpload IMAGE, destination THEME) and waited for. The writes offer --dry-run.
import { apiCommand } from '../api/command.js';
import { selection } from '../api/graphql.js';
import type { Context } from '../context.js';
import { usageError } from '../errors.js';
import { checkImage, uploadImage, whileProcessing } from '../media.js';
import type { Command } from '../registry.js';
import { bool, object, openObject, str } from '../schema.js';
import { api } from '../session.js';
import { appearanceText, resolveAppearance, type AppearanceReads, type ResolvedAppearance, type ServedTheme, type ServedUniverse } from '../theme/appearance.js';
import { SIGNED_LINKS, SIGNED_LINKS_HELP } from '../theme/media-links.js';
import { listText, pageText, universeAndTag } from './shared.js';

/** At most 5 MB for an image of a theme. */
const MAX_THEME_IMAGE_BYTES = 5 * 1024 * 1024;
type Palette = { colors: string[]; proposedAccent: string; names?: string[] };
const PALETTE = '{ colors proposedAccent names }';

/** Sends an image for an appearance and waits for its processing: its upload id and its palette. */
async function themeImage(ctx: Context, path: string): Promise<{ id: string; palette: Palette }> {
  const image = checkImage(ctx, path, undefined, MAX_THEME_IMAGE_BYTES);
  const id = await uploadImage(ctx, image, { destination: 'THEME' });
  const palette = await whileProcessing(ctx, async () => (await api<{ imagePalette: Palette }>(ctx, `query($id: ID!) { imagePalette(mediaId: $id) ${PALETTE} }`, { id })).imagePalette);
  return { id, palette };
}
const paletteText = (r: unknown) => { const p = r as Palette | null; return p ? [`proposed accent: ${p.proposedAccent}`, ...p.colors.map((c, i) => `${c}${p.names?.[i] ? `  ${p.names[i]}` : ''}`)].join('\n') : '(none)'; };

export const appearanceLooks = apiCommand({
  name: 'appearance looks', summary: 'The looks of quick start: the themes of the field collections, 3 by field, each with its character, its layout and its accent (appearanceLooks)', kind: 'query', op: 'appearanceLooks',
  descriptions: { collection: 'One field (UniverseField); none: the 10 fields' },
  text: listText((l: { name: string; collection: string; character: string; layout: string; accent: string; theme: { universe: string; name: string } }) => `${l.theme.universe}/${l.theme.name}  ${l.name}  ${l.collection}  ${l.character}  ${l.layout}  ${l.accent}`),
  examples: ['breakrocks look appearance looks', 'breakrocks look appearance looks --collection SPORT --json'],
});
export const appearancePalette = apiCommand({
  name: 'appearance palette', summary: 'The candidate colors of an image (5 at most) and the one proposed as the accent: an image file sent first, or an upload id (imagePalette)', kind: 'query', op: 'imagePalette', positionals: ['media'], hide: ['mediaId'], select: PALETTE,
  extra: { media: str('An image uploaded (destination THEME): its upload id'), image: str('An image file (JPEG, PNG or WebP, 1,500 × 500 pixels at least), sent first') },
  prepare: async (i, ctx) => {
    const { image, media, ...rest } = i;
    if ((image === undefined) === (media === undefined)) throw usageError('INVALID_INPUT', 'An upload id or --image <file>, one of them');
    return { ...rest, mediaId: image ? (await themeImage(ctx, String(image))).id : media };
  },
  text: paletteText, examples: ['breakrocks look appearance palette --image sky.jpg', 'breakrocks look appearance palette <upload id> --json'],
});

const gestures = {
  image: 'An image file (JPEG, PNG or WebP, 1,500 × 500 pixels at least, 5 MB at most), sent first; or --image-id', imageId: 'An image uploaded (destination THEME)',
  focal: 'Its focal point, <x>,<y> from 0 to 1 (0.5,0.5 by default)', imageShows: 'How the image shows: NONE, SUBTLE (the default) or THROUGH', accent: 'The accent, #RRGGBB (none: the proposed accent of the image)',
  character: 'The character: PLACE (Calm), AGORA (Editorial), GALLERY (Lively), STAGE (Playful), TERMINAL (Precise)', layout: 'The default layout: feed-first, village-square or hud',
  logo: 'The logo: { "id": <upload id>, "alt" } (JSON)', clear: 'What is removed (LOGO)', universe: 'The universe (%name, %name/sub)',
};
const gestureHide = ['input.ground', 'input.watermark', 'input.focalPoint'];
async function gesturesOf(i: Record<string, unknown>, ctx: Context): Promise<Record<string, unknown>> {
  const { image, focal, ...rest } = i;
  if (image !== undefined && rest.imageId !== undefined) throw usageError('INVALID_INPUT', '--image or --image-id, not both');
  const out: Record<string, unknown> = { ...rest };
  if (focal !== undefined) {
    const [x, y] = String(focal).split(',').map(Number);
    if (![x, y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) throw usageError('APPEARANCE_FOCAL_POINT_INVALID', '--focal: <x>,<y>, each from 0 to 1');
    out['input.focalPoint'] = { x, y };
  }
  if (image !== undefined) out.imageId = rest.dryRun ? `(${String(image)}: sent on the real run)` : (await themeImage(ctx, String(image))).id;
  return out;
}
type Contrast = { adjusted?: unknown[] } & Record<string, unknown>;
export const appearanceBuild = apiCommand({
  name: 'appearance build', summary: 'Build an appearance of a universe from its gestures: the theme document, its contrast report and the side of its name; nothing stored nor applied (buildUniverseAppearance)',
  description: 'By who may change the appearance of the universe (THEME_SET_NOT_ALLOWED otherwise). With an image, the platform computes the readability mask of the document. --json gives the whole document.',
  kind: 'query', op: 'buildUniverseAppearance', positionals: ['universe'], hide: [...gestureHide, 'input.logo', 'input.clear'], extra: { image: str(gestures.image), focal: str(gestures.focal) }, descriptions: gestures,
  prepare: gesturesOf,
  text: (r) => { const b = r as { imageShows?: string; nameSide?: string; contrast?: Contrast; document?: string } | null; return b ? [`image shows: ${b.imageShows ?? '-'}`, `name side: ${b.nameSide ?? '-'}`, `contrast: ${JSON.stringify(b.contrast ?? {})}`, `document: ${typeof b.document === 'string' ? `${b.document.length} characters (--json)` : '-'}`].join('\n') : '(none)'; },
  examples: ['breakrocks look appearance build %paris --image sky.jpg --image-shows THROUGH --character AGORA', 'breakrocks look appearance build %paris --image-id <upload id> --accent "#11707A" --json'],
});
export const appearanceApply = apiCommand({
  name: 'appearance apply', summary: 'Apply an appearance to a universe at once, or propose it (--propose, or a resident who can vote: a proposal APPEARANCE) (applyUniverseAppearance)',
  description: 'A private universe: by the owner and the admins, at once. A public universe: by its leadership at once, or with --propose a proposal of the kind APPEARANCE (--title required, --text its reason); a resident who can vote and is not in the leadership files a proposal waiting for support.',
  kind: 'mutation', op: 'applyUniverseAppearance', positionals: ['universe'], hide: gestureHide, extra: { image: str(gestures.image), focal: str(gestures.focal) }, dry: true,
  descriptions: { ...gestures, propose: 'File a proposal APPEARANCE instead of applying at once (a public universe)', title: 'The title of the proposal', text: 'The reason of the proposal' },
  prepare: gesturesOf, select: `{ theme { universe name version } proposal { id status } contrast ${selection('AppearanceContrastReport', 2)} }`,
  text: (r) => { const x = r as { theme?: { universe: string; name: string; version?: number } | null; proposal?: { id?: string; status?: string } | null } | null; return !x ? '(none)' : x.proposal ? `proposal ${x.proposal.id ?? '?'} filed (${x.proposal.status ?? '-'})` : x.theme ? `${x.theme.universe}/${x.theme.name} v${x.theme.version ?? '?'} applied` : '(none)'; },
  examples: ['breakrocks look appearance apply %team. --image sky.jpg --accent "#5A2E5E" --character GALLERY', 'breakrocks look appearance apply %paris --image-id <upload id> --propose --title "A new sky"'],
});

// ---- The appearance applied ----

const SERVED_THEME = '{ universe name version createdAt updatedAt official collection creator { id handle kind } contrastLevel typography { title } document imageSlots { page { url urlNight widths widthsNight removed } pageHeader { url urlNight widths widthsNight removed } } }';
const THEME_QUERY = `query($u: String!, $n: String!, $in: String) { theme(universe: $u, name: $n, appliedIn: $in) ${SERVED_THEME} }`;
/** A read that may be refused or not served (a field of a later contract, a reader without the right): null then. */
const maybe = async <T>(read: Promise<T>): Promise<T | null> => { try { return await read; } catch { return null; } };

export const appearanceShow: Command<{ universe: string; signedLinks?: boolean }, ResolvedAppearance> = {
  name: 'appearance show', summary: 'The appearance applied to a universe, as the apps draw it, each value with its origin (set, theme, trial, country, default)',
  description: [
    'Resolved as the apps draw the universe: its universe theme (Universe.themeRef, its own or of a universe above), a universe theme trial in progress',
    '(served to every reader for 24 hours), else what the platform gives: the country theme of a country universe (D-158), the universal or field theme',
    'given by default, Socle with the colors of its name (its monogram and address badges only); the default layout (layouts.md § Which layout applies), the sky column and the',
    'subtle background when the appearance says nothing. Each value is tagged with its origin: set (chosen in Customize), theme (from the theme applied),',
    'trial, country, default, or unknown when neither the API nor the contract says. Also: the proposals APPEARANCE and THEME pending (a public universe)',
    'who applied it and when (Universe.appearanceApplied), and the command of the appearance history. Also typed "breakrocks look appearance <universe>". --json: the resolved object, "origin" on each field.',
    'Images: the links that open (<url>/<width>.webp, the 1080 and the largest), under "links" in --json.',
  ].join(' '),
  api: 'universe, theme, appliedLayout, universeAppearanceHistory, proposals',
  examples: ["breakrocks look appearance show '%lyon'", "breakrocks look appearance '%lyon'", 'breakrocks look appearance show %paris --json'],
  input: object({ universe: str('The universe (%name, %name/sub)'), signedLinks: bool(SIGNED_LINKS_HELP) }, ['universe']),
  output: openObject({}, 'The appearance resolved: source, trial, accent, character, image, imageShows, layout, sky, logo, palettes, universeColors, typefaces, contrastLevel, proposalsPending, history, signedLinks; each value { value, origin, note? }; each image its links { variant, width, url, expiresAt }'),
  args: { positionals: ['universe'] },
  run: async (ctx, { universe, signedLinks }) => {
    const base = await api<{ universe: ServedUniverse | null }>(ctx, `query($n: String!) { universe(name: $n) { name exists private field themeRef { universe name version deleted } themeOf themeHeldVersion appearanceApplied { appliedAt appliedBy { handle deleted } proposalId } layoutRef { universe name version } layoutOf image { url widths } imageOf } }`, { n: universe });
    const u = base.universe;
    // A backend before v126.1.0 does not serve appearanceApplied: its null then says nothing (undefined: inferred below).
    if (!u || u.exists === false) throw usageError('UNIVERSE_NOT_FOUND', `No universe ${universe}`, { universe });
    const name = u.name;
    const ref = u.themeRef && !u.themeRef.deleted ? u.themeRef : null;
    const [trials, trialLayout, theme, socle, appliedLayout, history, proposals] = await Promise.all([
      maybe(api<{ universe: Pick<ServedUniverse, 'themeTrial' | 'myDraftPreview'> | null }>(ctx, `query($n: String!) { universe(name: $n) { themeTrial { draftId document version startedAt endsAt startedBy { handle } imageSlots { page { url urlNight widths widthsNight removed } pageHeader { url urlNight widths widthsNight removed } } } myDraftPreview { draftId version endsAt } } }`, { n: name })),
      maybe(api<{ universe: { themeTrial: { layout?: string | null } | null } | null }>(ctx, `query($n: String!) { universe(name: $n) { themeTrial { layout } } }`, { n: name })),
      ref ? maybe(api<{ theme: ServedTheme | null }>(ctx, THEME_QUERY, { u: ref.universe ?? '%root', n: ref.name, in: name })) : Promise.resolve(null),
      ref ? Promise.resolve(null) : maybe(api<{ theme: ServedTheme | null }>(ctx, THEME_QUERY, { u: '%root', n: 'socle', in: null })),
      maybe(api<{ appliedLayout: AppearanceReads['appliedLayout'] }>(ctx, `query($u: String!) { appliedLayout(universe: $u) { source of ref { universe name version } } }`, { u: name })),
      maybe(api<{ universeAppearanceHistory: AppearanceReads['history'] }>(ctx, `query($u: String!) { universeAppearanceHistory(universe: $u) { id setAt live trial accentName theme { universe name version } } }`, { u: name })),
      u.private ? Promise.resolve(null) : maybe(Promise.all(['APPEARANCE', 'THEME'].map(async (kind) => (await api<{ proposals: { items: NonNullable<AppearanceReads['proposals']> } | null }>(ctx,
        `query($u: String!, $k: ProposalKind) { proposals(universe: $u, kind: $k, limit: 50) { items { id title status kind endsAt createdAt author { handle } } } }`, { u: name, k: kind })).proposals?.items ?? []))),
    ]);
    const trial = trials?.universe?.themeTrial ?? null;
    const reads: AppearanceReads = {
      universe: { ...u, themeTrial: trial ? { ...trial, layout: trialLayout?.universe?.themeTrial?.layout ?? null } : null, myDraftPreview: trials?.universe?.myDraftPreview ?? null },
      theme: theme?.theme ?? null, socle: socle?.theme ?? null, appliedLayout: appliedLayout?.appliedLayout ?? null,
      history: history?.universeAppearanceHistory ?? null, proposals: proposals ? proposals.flat() : null,
    };
    // An appearance started from a theme: that theme too, to tell what was changed on top of it.
    const look = resolveAppearance(reads).source.look;
    if (look) reads.lookTheme = (await maybe(api<{ theme: ServedTheme | null }>(ctx, THEME_QUERY, { u: look.universe ?? '%root', n: look.name, in: null })))?.theme ?? null;
    const resolved = resolveAppearance(reads);
    return signedLinks ? { ...resolved, signedLinks: SIGNED_LINKS } : resolved;
  },
  text: appearanceText,
};

// ---- Tags of a universe ----

export const universesTagsConventions = apiCommand({
  name: 'universes tags conventions', summary: 'Set the tag conventions of the showcase of a public universe: the whole list, in order, 10 at most (--none clears it) (setUniverseTagConventions)',
  description: 'Its leadership (without leadership: a proposal of the kind SHOWCASE, proposals file --tag-conventions); a private universe has none (TAG_CONVENTIONS_PUBLIC_ONLY). TAG_CONVENTIONS_LIMIT, TAG_INVALID.',
  kind: 'mutation', op: 'setUniverseTagConventions', positionals: ['universe', 'tags'], hide: ['tags'], dry: true,
  extra: { tags: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'The free tags, in order (with or without #), 10 at most' }, none: { type: 'boolean', description: 'Clear the tag conventions' } },
  prepare: (i) => {
    const { none, ...rest } = i;
    const tags = (rest.tags as string[] | undefined) ?? [];
    if (!none === !tags.length) throw usageError('INVALID_INPUT', 'The tags, or --none, one of them');
    return { ...rest, tags: none ? [] : tags.map((t) => t.replace(/^#/, '')) };
  },
  select: '{ name tagConventions }', text: (r) => { const u = r as { name?: string; tagConventions?: string[] } | null; return u ? `${u.name}: ${u.tagConventions?.length ? u.tagConventions.map((t) => `#${t}`).join(' ') : '(no tag convention)'}` : '(none)'; },
  examples: ['breakrocks universes tags conventions %paris marche brocante velo', 'breakrocks universes tags conventions %paris --none'],
});
export const universesTagsSuggestions = apiCommand({
  name: 'universes tags suggestions', summary: 'The suggested free tags of a universe, 20 at most: its tag conventions first, then the most used of the last 30 days (universeTagSuggestions)', kind: 'query', op: 'universeTagSuggestions', positionals: ['universe'],
  text: (r) => (Array.isArray(r) && r.length ? r.map((t) => `#${String(t)}`).join(' ') : '(none)'), examples: ['breakrocks universes tags suggestions %paris'],
});
type TagObject = { createdAt: string; universeEvent?: { id: string; title?: string } | null; proposal?: { id: string; title?: string } | null; mapRoute?: { id: string; name?: string } | null };
export const universesTagsView = apiCommand({
  name: 'universes tags view', summary: 'The view of a universe and a tag (%paris#market): its events, proposals and universe routes with the tag, the newest first (universeTagView; its posts: posts list %paris#market)', kind: 'query', op: 'universeTagView', positionals: ['universe', 'tag'], hide: ['tag'],
  extra: { tag: str('The tag, when not in the universe') }, descriptions: { universe: 'The universe and the tag, %paris#market (or the universe, then the tag)' },
  prepare: (i) => ({ ...i, ...universeAndTag(String(i.universe), i.tag as string | undefined) }),
  select: '{ items { createdAt universeEvent { id title startsAt } proposal { id title status } mapRoute { id name } } next }',
  text: pageText((o: TagObject) => `${o.createdAt}  ${o.universeEvent ? `event ${o.universeEvent.id}  ${o.universeEvent.title ?? ''}` : o.proposal ? `proposal ${o.proposal.id}  ${o.proposal.title ?? ''}` : o.mapRoute ? `route ${o.mapRoute.id}  ${o.mapRoute.name ?? ''}` : '-'}`),
  examples: ['breakrocks universes tags view %paris#market', 'breakrocks universes tags view %paris market --all --json'],
});
