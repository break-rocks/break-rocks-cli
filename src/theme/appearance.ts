// The effective appearance of a universe (look appearance show), resolved as the apps draw it, each value with its
// origin: "set" (chosen by the universe in Customize), "theme" (the universe theme applied, its own or of a universe
// above), "trial" (a universe theme trial of 24 hours), "country" (the country theme of a country universe, D-158),
// "default" (what the platform gives when nothing is set: Socle, a universal or field theme given by default,
// the default layout, the sky column, the subtle background), "unknown" (neither the API nor the contract says).
// Sources: contracts/themes.md (§ Customize, § The universal collection, § The country collection, § Universe theme
// trials, § Default colors of a universe, § Client rules), contracts/layouts.md (§ Which layout applies) and the web
// (UniverseThemed.tsx, themeObject.ts, themeOpacity.ts imageShowsOf, universeSky.ts skyOfDocument, Customize.tsx).
// Pure: the command (src/commands/appearance.ts) reads the API, this module resolves and writes the text.
import { paint, swatch } from '../colour.js';

export type Origin = 'set' | 'theme' | 'trial' | 'country' | 'default' | 'unknown';
type Ref = { universe?: string | null; name: string; version?: number | null; deleted?: boolean };
type Slot = { url?: string | null; urlNight?: string | null; removed?: boolean } | null;
export type ServedTheme = {
  universe?: string | null; name: string; version?: number; createdAt?: string; updatedAt?: string; official?: boolean; collection?: string | null;
  creator?: { id?: string; handle?: string; kind?: string } | null; contrastLevel?: string; typography?: { title?: string | null } | null;
  document?: unknown; imageSlots?: { page?: Slot; pageHeader?: Slot } | null;
};
export type ServedUniverse = {
  name: string; exists?: boolean; private?: boolean; field?: string | null;
  themeRef?: Ref | null; themeOf?: string | null; themeHeldVersion?: number | null;
  /** Who applied its universe theme and when (v126.1.0): null without a universe theme of its own; undefined when not served (inferred). */
  appearanceApplied?: AppliedAppearance | null;
  themeTrial?: { draftId: string; document?: unknown; version?: number; startedAt?: string; endsAt?: string; startedBy?: { handle?: string } | null; layout?: string | null; imageSlots?: { page?: Slot; pageHeader?: Slot } | null } | null;
  myDraftPreview?: { draftId: string; version?: number; endsAt?: string; layout?: string | null } | null;
  layoutRef?: Ref | null; layoutOf?: string | null; image?: { url?: string | null } | null; imageOf?: string | null;
};
export type AppliedAppearance = { appliedAt: string; appliedBy?: { handle?: string; deleted?: boolean } | null; proposalId?: string | null };
export type AppliedLayout = { source?: string; of?: string | null; ref?: Ref | null } | null;
export type HistoryEntry = { id: string; setAt: string; live?: boolean; trial?: boolean; theme?: Ref | null; accentName?: string | null };
export type Proposal = { id: string; title?: string; status: string; kind?: string; author?: { handle?: string } | null; endsAt?: string | null; createdAt?: string };

/** What the command read: the universe, its theme as applied, the theme an appearance started from, Socle, the layout, the history, the proposals. */
export type AppearanceReads = {
  universe: ServedUniverse;
  theme?: ServedTheme | null;
  /** The theme its block "appearance" names in "look" (a look or a theme of quick start), to tell what was changed on top of it. */
  lookTheme?: ServedTheme | null;
  /** Socle as served (its palette when the universe has no theme). */
  socle?: ServedTheme | null;
  appliedLayout?: AppliedLayout;
  /** The appearance history, null when the caller may not read it. */
  history?: HistoryEntry[] | null;
  /** The proposals APPEARANCE and THEME of a public universe (first page), null when not read. */
  proposals?: Proposal[] | null;
};

export type Valued<T> = { value: T; origin: Origin; note?: string };
type Palette = Record<string, string>;
export type ResolvedAppearance = {
  universe: string;
  source: {
    kind: 'built' | 'started-from-theme' | 'theme' | 'trial' | 'country' | 'universal' | 'field' | 'socle';
    origin: Origin; theme: Ref | null; inheritedFrom: string | null; look: Ref | null; frozenAt: number | null;
    /** "api": read from Universe.appearanceApplied (null: no universe theme of its own); "inferred": from the history and the proposals (a backend before v126.1.0). */
    appliedAt: string | null; appliedBy: string | null; appliedFrom: 'api' | 'inferred'; proposal: { id: string; title?: string; author?: string; endsAt?: string | null } | null;
  };
  trial: { draftId: string; version?: number; startedAt?: string; endsAt?: string; startedBy?: string; layout?: string | null; base: Ref | null } | null;
  myDraftPreview: { draftId: string; version?: number; endsAt?: string } | null;
  accent: Valued<{ day: string | null; night: string | null; name: string | null }>;
  character: Valued<string | null>;
  image: Valued<{ page: { url: string | null; urlNight: string | null } | null; pageHeader: { url: string | null; urlNight: string | null } | null; focalPoint: { x: number; y: number } | null; uploadId: string | null }>;
  imageShows: Valued<'NONE' | 'SUBTLE' | 'THROUGH'>;
  layout: Valued<string | null> & { of?: string | null };
  sky: Valued<'COLUMN' | 'BAND'>;
  logo: Valued<{ url: string | null; of: string | null; monogram: { initial: string; on: string | null } | null }>;
  palettes: Valued<{ day: Palette | null; night: Palette | null }>;
  universeColors: Valued<{ primary: string; accent: string; tintDay: string; tintNight: string }> | null;
  typefaces: { title: Valued<string | null>; body: Valued<string> };
  contrastLevel: Valued<string | null>;
  proposalsPending: number | null;
  history: string;
};

// ---- The contract's constants (contracts/themes.md) ----

/** The universal themes (§ The universal collection, D-153): chosen by the platform for a universe without theme nor field. */
export const UNIVERSAL_THEMES = ['universel-ciel', 'universel-eau', 'universel-terre', 'universel-vivant', 'universel-cosmos', 'universel-matiere'];
/** The title typeface of each appearance character (§ Customize, The appearance characters). */
export const CHARACTER_TYPEFACES: Record<string, string> = { PLACE: 'Sora', AGORA: 'Fraunces', GALLERY: 'Figtree', STAGE: 'Bebas Neue', TERMINAL: 'JetBrains Mono' };
const CHARACTER_SHOWN: Record<string, string> = { PLACE: 'Calm', AGORA: 'Editorial', GALLERY: 'Lively', STAGE: 'Playful', TERMINAL: 'Precise' };
/** The title typeface of Socle (§ The universal collection) and the readable typeface of the body text (§ Client rules). */
export const SOCLE_TITLE = 'Montserrat';
export const BODY_TYPEFACE = 'Atkinson Hyperlegible';
/** The name of the theme Customize publishes in a universe (§ Customize, Apply: appearance, appearance-2…). */
const APPEARANCE_THEME = /^appearance(-\d+)?$/;
const SOCLE: Ref = { universe: '%root', name: 'socle' };

// ---- The default colors of a universe (§ Default colors of a universe; the web's universeColors.ts) ----

/** The key of a universe: its first level, lowercase, without "%". */
export const universeKey = (universe: string) => (universe.replace(/[°^]/gu, '').replace(/^%/u, '').split('/')[0] ?? '').trim().normalize('NFC').toLowerCase();
/** FNV-1a 32 bits over the UTF-8 bytes. */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) { hash ^= byte; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash;
}
const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
function oklchToSrgb(l: number, c: number, h: number): number[] {
  const a = c * Math.cos((h * Math.PI) / 180), b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3, m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3, s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [encode(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_), encode(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_), encode(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_)];
}
/** OKLCH as #RRGGBB: out of gamut, the chroma lowered by 0.01 until in gamut; each channel rounded to 8 bits. */
export function oklchToHex(l: number, c: number, h: number): string {
  let steps = Math.round(c * 100);
  let rgb = oklchToSrgb(l, steps / 100, h);
  while (steps > 0 && rgb.some((v) => v < -1e-6 || v > 1 + 1e-6)) rgb = oklchToSrgb(l, --steps / 100, h);
  return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
/** The default colors of a universe (any level: from its first level). */
export function defaultColors(universe: string) {
  const h = fnv1a32(universeKey(universe)) % 360;
  return { primary: oklchToHex(0.55, 0.14, h), accent: oklchToHex(0.55, 0.14, (h + 40) % 360), tintDay: oklchToHex(0.95, 0.03, h), tintNight: oklchToHex(0.22, 0.03, h) };
}

// ---- Reading a theme document ----

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function parse(document: unknown): Record<string, unknown> {
  try { const d = typeof document === 'string' ? JSON.parse(document) as unknown : document; return isObject(d) ? d : {}; } catch { return {}; }
}
const HEX = /^#[0-9a-f]{6}$/i;
function paletteOf(doc: Record<string, unknown>, variant: 'day' | 'night'): Palette | null {
  const v = isObject(doc.variants) ? doc.variants[variant] : null;
  const p = isObject(v) ? (isObject(v.palette) ? v.palette : v) : null;
  if (!p) return null;
  const out: Palette = {};
  for (const k of ['background', 'surface', 'text', 'primary', 'accent', 'link']) if (typeof p[k] === 'string' && HEX.test(p[k])) out[k] = (p[k] as string).toUpperCase();
  return Object.keys(out).length ? out : null;
}
const titleOf = (doc: Record<string, unknown>, served?: ServedTheme | null) => (isObject(doc.typography) && typeof doc.typography.title === 'string' ? doc.typography.title : served?.typography?.title ?? null);
/** The block "appearance" of a document (what Customize built it from), or null. */
const blockOf = (doc: Record<string, unknown>) => (isObject(doc.appearance) ? doc.appearance : null);
function lookOf(block: Record<string, unknown> | null): Ref | null {
  const l = block && isObject(block.look) ? block.look : null;
  return l && typeof l.name === 'string' ? { universe: typeof l.universe === 'string' ? l.universe : '%root', name: l.name } : null;
}
/** How the image shows (imageShowsOf of the web): the block's imageShows, else ground false → NONE, else SUBTLE (the default). */
function imageShowsOf(block: Record<string, unknown> | null): { value: 'NONE' | 'SUBTLE' | 'THROUGH'; given: boolean } {
  const shows = block && typeof block.imageShows === 'string' ? block.imageShows.toUpperCase() : null;
  if (shows === 'NONE' || shows === 'SUBTLE' || shows === 'THROUGH') return { value: shows, given: true };
  if (block && block.ground === false) return { value: 'NONE', given: true };
  if (block && block.ground === true) return { value: 'SUBTLE', given: true };
  return { value: 'SUBTLE', given: false };
}
/** The sky (skyOfDocument of the web): "band" or "column" in the block, else the sky column (the default). */
function skyOf(block: Record<string, unknown> | null): { value: 'COLUMN' | 'BAND'; given: boolean } {
  const sky = block && typeof block.sky === 'string' ? block.sky.toLowerCase() : null;
  return sky === 'band' ? { value: 'BAND', given: true } : sky === 'column' ? { value: 'COLUMN', given: true } : { value: 'COLUMN', given: false };
}
const characterOfTypeface = (typeface: string | null) => Object.entries(CHARACTER_TYPEFACES).find(([, t]) => t === typeface)?.[0] ?? null;
const sameRef = (a: Ref | null | undefined, b: Ref | null | undefined) => !!a && !!b && (a.universe ?? '').toLowerCase() === (b.universe ?? '').toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase();
const slotOf = (s: Slot | undefined) => (s && !s.removed && (s.url || s.urlNight) ? { url: s.url ?? null, urlNight: s.urlNight ?? null } : null);
const draftSlot = (doc: Record<string, unknown>, key: string): string | null => {
  const s = isObject(doc.imageSlots) ? doc.imageSlots[key] : null;
  if (typeof s === 'string') return s || null;
  return isObject(s) ? ((typeof s.day === 'string' && s.day) || (typeof s.night === 'string' && s.night) || null) : null;
};

/** The kind of the theme a universe shows, and the origin of what it gives (§ The universal collection, § The country collection, § Customize). */
function classify(u: ServedUniverse, ref: Ref | null, theme: ServedTheme | null, live: HistoryEntry | null): { kind: ResolvedAppearance['source']['kind']; origin: Origin } {
  if (!ref || ref.deleted || sameRef(ref, SOCLE)) return { kind: 'socle', origin: 'default' };
  const system = theme?.creator?.kind === 'system' || theme?.creator?.handle === 'system';
  const doc = parse(theme?.document);
  const owner = (u.themeOf ?? u.name).toLowerCase();
  if (APPEARANCE_THEME.test(ref.name) && (ref.universe ?? '').toLowerCase() === owner) {
    return { kind: lookOf(blockOf(doc)) ? 'started-from-theme' : 'built', origin: 'set' };
  }
  const atRoot = (ref.universe ?? '%root') === '%root';
  // Served (v126.1.0): appearanceApplied tells a universe theme of its own (chosen, or a country theme set by the platform) from a default one.
  if (u.appearanceApplied !== undefined) {
    const applied = u.appearanceApplied;
    if (applied) return system && !atRoot && !applied.appliedBy && !applied.proposalId ? { kind: 'country', origin: 'country' } : { kind: 'theme', origin: 'theme' };
    if (u.themeOf) return { kind: 'theme', origin: 'theme' };
    if (atRoot && UNIVERSAL_THEMES.includes(ref.name.toLowerCase())) return { kind: 'universal', origin: 'default' };
    if (atRoot) return { kind: 'field', origin: 'default' };
    return { kind: 'theme', origin: 'theme' };
  }
  // The universe chose it (an appearance history entry in use names it): its own choice, whatever the theme.
  if (live && sameRef(live.theme, ref)) return { kind: 'theme', origin: 'theme' };
  if (system && (ref.universe ?? '%root') !== '%root') return { kind: 'country', origin: 'country' };
  if (!u.themeOf && atRoot && UNIVERSAL_THEMES.includes(ref.name.toLowerCase())) return { kind: 'universal', origin: 'default' };
  // A theme of the field collection of the universe (Theme.official since v126.1.0): given by default unless chosen, which only appearanceApplied tells.
  if (!u.themeOf && atRoot && theme?.collection && theme.collection === u.field && theme.official !== false) return { kind: 'field', origin: 'default' };
  return { kind: 'theme', origin: 'theme' };
}

/** The appearance of a universe as the apps draw it, each value with its origin. */
export function resolveAppearance(r: AppearanceReads): ResolvedAppearance {
  // themeOf: null for its own theme or a default one, else the universe above (v126.1.0). Tolerated: the universe itself, as a backend before it answered.
  const own = r.universe.themeOf?.toLowerCase() === r.universe.name.toLowerCase();
  const u = own ? { ...r.universe, themeOf: null } : r.universe;
  const live = r.history?.find((e) => e.live) ?? null;
  const ref = u.themeRef && !u.themeRef.deleted ? u.themeRef : null;
  const served = ref ? r.theme ?? null : r.socle ?? null;
  const base = classify(u, ref, r.theme ?? null, live);
  const trial = u.themeTrial ?? null;
  // During a trial, the studio draft is served to every reader in place of the universe theme (§ Universe theme trials).
  const doc = trial ? parse(trial.document) : parse(served?.document);
  const block = blockOf(doc);
  const look = trial ? lookOf(block) : base.kind === 'started-from-theme' ? lookOf(block) : null;
  const lookDoc = look && r.lookTheme && sameRef(r.lookTheme, look) ? parse(r.lookTheme.document) : null;
  const o: Origin = trial ? 'trial' : base.origin;

  const day = paletteOf(doc, 'day'), night = paletteOf(doc, 'night');
  // On a theme started from (v101.13.0, D-314; kept since v126.0.0, D-401): what equals the theme's is the theme's, the rest was changed on top of it.
  const fromLook = (mine: unknown, theirs: unknown): Origin => (trial ? 'trial' : lookDoc && JSON.stringify(mine) === JSON.stringify(theirs) ? 'theme' : 'set');
  const lookDay = lookDoc ? paletteOf(lookDoc, 'day') : null;

  // The palettes: the theme's, or Socle's when there is none (and then the default colors of the universe, D: § Default colors).
  const palettes: ResolvedAppearance['palettes'] = served || trial
    ? { value: { day, night }, origin: base.kind === 'started-from-theme' && !trial ? fromLook(day, lookDay) : o }
    : { value: { day: null, night: null }, origin: 'unknown', note: 'Socle not read' };
  const socle = base.kind === 'socle' && !trial;
  // The default colors of the universe: on Socle (the apps); with a universal theme the contract keeps them too (§ The universal collection).
  const colors = socle || (base.kind === 'universal' && !trial) ? defaultColors(u.name) : null;

  // The accent: the block's (Customize), else the primary of the palette; on Socle the primary of the default colors.
  const blockAccent = block && typeof block.accent === 'string' && HEX.test(block.accent) ? block.accent.toUpperCase() : null;
  const accentValue = socle && colors ? { day: colors.primary, night: colors.primary } : { day: blockAccent ?? day?.primary ?? null, night: night?.primary ?? blockAccent ?? null };
  const accentName = (block && typeof block.accentName === 'string' ? block.accentName : null) ?? live?.accentName ?? null;
  const accent: ResolvedAppearance['accent'] = {
    value: { ...accentValue, name: accentName },
    origin: socle ? 'default' : base.kind === 'started-from-theme' && !trial ? fromLook(day?.primary, lookDay?.primary) : (served || trial) ? o : 'unknown',
    ...(socle ? { note: 'the default colors of the universe, from its name' } : {}),
  };

  // The character: the block's, else the one of the title typeface; Socle's typeface has none.
  const title = trial ? titleOf(doc) : served ? titleOf(doc, served) : socle ? SOCLE_TITLE : null;
  const blockCharacter = block && typeof block.character === 'string' && CHARACTER_TYPEFACES[block.character] ? block.character : null;
  const characterValue = blockCharacter && CHARACTER_TYPEFACES[blockCharacter] === title ? blockCharacter : characterOfTypeface(title) ?? blockCharacter;
  const character: ResolvedAppearance['character'] = {
    value: characterValue,
    origin: base.kind === 'started-from-theme' && !trial ? fromLook(title, lookDoc ? titleOf(lookDoc) : null) : socle ? 'default' : (served || trial) ? o : 'unknown',
    ...(characterValue ? {} : { note: `no appearance character for ${title ?? 'its typeface'}` }),
  };

  // The image: the slots page and pageHeader as served (a trial: its imageSlots since v126.1.0, else the upload ids of its document), the focal point of the block.
  const uploadId = block && typeof block.image === 'string' ? block.image : null;
  const focal = block && isObject(block.focalPoint) && typeof block.focalPoint.x === 'number' && typeof block.focalPoint.y === 'number' ? { x: block.focalPoint.x, y: block.focalPoint.y } : uploadId ? { x: 0.5, y: 0.5 } : null;
  const trialSlots = trial?.imageSlots ?? null;
  const fromDraft = (key: string) => (draftSlot(doc, key) ? { url: null, urlNight: null } : null);
  const page = trial ? (trialSlots ? slotOf(trialSlots.page) : fromDraft('page')) : slotOf(served?.imageSlots?.page);
  const pageHeader = trial ? (trialSlots ? slotOf(trialSlots.pageHeader) : fromDraft('pageHeader')) : slotOf(served?.imageSlots?.pageHeader);
  const imageOrigin: Origin = trial ? 'trial' : socle ? 'default' : base.kind === 'started-from-theme' ? (uploadId ? 'set' : 'theme') : base.origin;
  const image: ResolvedAppearance['image'] = {
    value: { page, pageHeader, focalPoint: focal, uploadId: uploadId ?? (trial && !trialSlots ? draftSlot(doc, 'pageHeader') ?? draftSlot(doc, 'page') : null) },
    origin: imageOrigin, ...(page || pageHeader ? {} : { note: 'no image' }),
  };

  const shows = imageShowsOf(block);
  const imageShows: ResolvedAppearance['imageShows'] = { value: shows.value, origin: shows.given ? o : 'default', ...(page ? {} : { note: 'no image of the page to show' }) };
  const sk = skyOf(block);
  const sky: ResolvedAppearance['sky'] = { value: sk.value, origin: sk.given ? o : 'default' };

  // The layout (layouts.md § Which layout applies): the trial's, Universe.layoutRef, else the field layout, else hud (public) or feed-first (private).
  let layout: ResolvedAppearance['layout'];
  const al = r.appliedLayout;
  if (trial?.layout) layout = { value: trial.layout, origin: 'trial' };
  else if (al?.ref?.name) {
    const src = al.source ?? 'UNIVERSE';
    layout = { value: al.ref.name, origin: src === 'GALLERY_TRIAL' ? 'trial' : src === 'FIELD' || src === 'PLATFORM' ? 'default' : 'set', of: al.of ?? null, ...(src === 'FIELD' ? { note: `the field layout${al.of ? ` of ${al.of}` : ''}` } : src === 'PLATFORM' ? { note: 'the platform layout' } : {}) };
  } else if (u.layoutRef?.name) layout = { value: u.layoutRef.name, origin: 'set', of: u.layoutOf ?? null };
  else if (u.field) layout = { value: null, origin: 'default', note: `the field layout of ${u.field} (its name is in the client configuration)` };
  else layout = { value: u.private ? 'feed-first' : 'hud', origin: 'default' };

  // The logo: the universe image (its own or of a universe above), else the monogram: its initial on the accent.
  const logoUrl = u.image?.url ?? null;
  const initial = [...universeKey(u.name)][0]?.toUpperCase() ?? '?';
  const logo: ResolvedAppearance['logo'] = logoUrl
    ? { value: { url: logoUrl, of: u.imageOf ?? null, monogram: null }, origin: 'set', ...(u.imageOf ? { note: `from ${u.imageOf}` } : {}) }
    : { value: { url: null, of: null, monogram: { initial, on: accent.value.day } }, origin: 'default', note: 'no universe image: the monogram' };

  const contrast = trial ? { value: 'AA', origin: 'trial' as Origin, note: 'validated as at publication' } : served?.contrastLevel ? { value: served.contrastLevel, origin: o } : { value: null, origin: 'unknown' as Origin };

  // When and by whom: Universe.appearanceApplied (v126.1.0); not served, inferred from the history entry in use, the theme version, an adopted proposal near that time.
  const served126 = u.appearanceApplied !== undefined;
  const applied = u.appearanceApplied ?? null;
  const inferredAt = live && (!ref || sameRef(live.theme, ref)) ? live.setAt : base.kind === 'built' || base.kind === 'started-from-theme' ? served?.updatedAt ?? null : null;
  const appliedAt = served126 ? applied?.appliedAt ?? null : inferredAt;
  const adopted = (r.proposals ?? []).filter((p) => p.status === 'ADOPTED' && p.endsAt).sort((a, b) => String(b.endsAt).localeCompare(String(a.endsAt)));
  const near = served126
    ? (applied?.proposalId ? (r.proposals ?? []).find((p) => p.id === applied.proposalId) ?? { id: applied.proposalId, status: 'ADOPTED' } : null)
    : appliedAt ? adopted.find((p) => Math.abs(Date.parse(p.endsAt!) - Date.parse(appliedAt)) <= 15 * 60_000) ?? null : null;
  const by = applied?.appliedBy ? (applied.appliedBy.deleted || !applied.appliedBy.handle ? 'a deleted account' : `@${applied.appliedBy.handle}`) : null;
  const pendingStatuses = ['OPEN', 'WAITING_SUPPORT', 'COUNTING'];

  return {
    universe: u.name,
    source: {
      kind: trial ? 'trial' : base.kind, origin: o, theme: ref ? { universe: ref.universe ?? null, name: ref.name, version: ref.version ?? null } : socle ? SOCLE : null,
      inheritedFrom: u.themeOf ?? null, look, frozenAt: u.themeHeldVersion ?? null, appliedAt,
      appliedBy: served126 ? by : near?.author?.handle ? `@${near.author.handle}` : null, appliedFrom: served126 ? 'api' : 'inferred',
      proposal: near ? { id: near.id, title: near.title, author: near.author?.handle, endsAt: near.endsAt } : null,
    },
    trial: trial ? { draftId: trial.draftId, version: trial.version, startedAt: trial.startedAt, endsAt: trial.endsAt, startedBy: trial.startedBy?.handle, layout: trial.layout ?? null, base: ref } : null,
    myDraftPreview: u.myDraftPreview ? { draftId: u.myDraftPreview.draftId, version: u.myDraftPreview.version, endsAt: u.myDraftPreview.endsAt } : null,
    accent, character, image, imageShows, layout, sky, logo, palettes,
    universeColors: colors ? { value: colors, origin: 'default', note: socle ? 'from its name' : 'from its name; kept with a universal theme (contract), the web draws the palette of the theme' } : null,
    typefaces: { title: { value: title, origin: socle ? 'default' : character.origin === 'unknown' ? 'unknown' : character.origin }, body: { value: BODY_TYPEFACE, origin: 'default', note: 'the readable typeface of Socle, in every theme' } },
    contrastLevel: contrast,
    proposalsPending: r.proposals ? r.proposals.filter((p) => pendingStatuses.includes(p.status)).length : null,
    history: `breakrocks look appearance history ${quote(u.name)}`,
  };
}

// ---- Text ----

const quote = (v: string) => (/^[\w@./:,+=-]+$/u.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`);
const refText = (t: Ref | null | undefined) => (t ? `${t.universe ?? ''}/${t.name}${t.version ? ` v${t.version}` : ''}` : '-');
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : '?');
const tag = (o: Origin) => paint.dim(`[${o}]`);
const SOURCE_TEXT: Record<ResolvedAppearance['source']['kind'], string> = {
  built: 'an appearance built in Customize', 'started-from-theme': 'an appearance started from a theme in Customize', theme: 'a theme applied by the universe',
  trial: 'a theme trial of 24 hours', country: 'the country theme (D-158)', universal: 'the universal theme, chosen by the platform', field: 'the official theme of its field, given by default', socle: 'Socle, the platform default',
};

/** The effective appearance in text: labelled lines, each value with its origin. */
export function appearanceText(a: ResolvedAppearance): string {
  const s = a.source;
  const pal = (p: Palette | null) => (p ? ['background', 'surface', 'text', 'primary', 'accent', 'link'].filter((k) => p[k]).map((k) => `${k} ${swatch(p[k])}`).join('  ') : 'unknown');
  const lines = [paint.bold(`${a.universe}: the appearance applied`)];
  lines.push(`source: ${SOURCE_TEXT[s.kind]}  ${tag(s.origin)}`);
  if (s.kind === 'field' && s.appliedFrom === 'inferred') lines.push(`  ${paint.dim('unless the universe chose it: this backend does not tell (before specs v126.1.0)')}`);
  if (a.trial) {
    lines.push(`  trial: the draft ${a.trial.draftId}${a.trial.version ? ` v${a.trial.version}` : ''}, for every reader, until ${day(a.trial.endsAt)}${a.trial.startedBy ? `, started by @${a.trial.startedBy}` : ''}`);
    lines.push(`  after it: ${refText(a.trial.base)}`);
  } else {
    lines.push(`  theme: ${refText(s.theme)}${s.inheritedFrom ? ` (inherited from ${s.inheritedFrom})` : ''}${s.frozenAt ? ` (frozen at version ${s.frozenAt})` : ''}`);
  }
  if (s.look) lines.push(`  started from: ${refText(s.look)}`);
  const proposal = s.proposal ? ` (proposal ${s.proposal.id}${s.proposal.title ? ` "${s.proposal.title}"` : ''}, adopted)` : '';
  if (s.appliedFrom === 'api' && s.appliedAt && !a.trial) lines.push(`  applied: on ${day(s.appliedAt)} by ${s.appliedBy ?? 'the platform'}${proposal}`);
  else if (s.appliedFrom !== 'api' && s.kind !== 'socle' && s.kind !== 'universal' && s.kind !== 'field' && s.kind !== 'country' && !a.trial) {
    const when = s.appliedAt ? `on ${day(s.appliedAt)}` : null, who = s.appliedBy ? `by ${s.appliedBy}` : null;
    lines.push(`  applied: ${when && who ? `${when} ${who}` : when ? `${when}, by whom not given by this backend` : who ? `${who}, when not given by this backend` : 'when and by whom not given by this backend'}${proposal}`);
  }
  if (a.myDraftPreview) lines.push(`  your draft preview (you alone see it): the draft ${a.myDraftPreview.draftId} until ${day(a.myDraftPreview.endsAt)}`);
  const ac = a.accent.value;
  lines.push(`accent: ${ac.day ? swatch(ac.day) : 'unknown'}${ac.night && ac.night !== ac.day ? ` (night ${swatch(ac.night)})` : ''}${ac.name ? `  ${ac.name}` : ''}  ${tag(a.accent.origin)}${a.accent.note ? `  ${a.accent.note}` : ''}`);
  lines.push(`character: ${a.character.value ? `${CHARACTER_SHOWN[a.character.value] ?? ''} (${a.character.value})` : 'none'}  ${tag(a.character.origin)}${a.character.note ? `  ${a.character.note}` : ''}`);
  const im = a.image.value;
  if (!im.page && !im.pageHeader) lines.push(`image: no image  ${tag(a.image.origin)}`);
  else {
    lines.push(`image:  ${tag(a.image.origin)}${im.uploadId ? `  upload ${im.uploadId}` : ''}${im.focalPoint ? `  focal point ${im.focalPoint.x},${im.focalPoint.y}` : ''}`);
    for (const [k, v] of [['banner (pageHeader)', im.pageHeader], ['page', im.page]] as const) {
      if (v) lines.push(`  ${k}: ${v.url ?? '(in the draft)'}${v.urlNight && v.urlNight !== v.url ? `  night ${v.urlNight}` : ''}`);
      else lines.push(`  ${k}: none`);
    }
  }
  lines.push(`image display: ${a.imageShows.value.toLowerCase()}${a.imageShows.origin === 'default' ? ' (default)' : ''}  ${tag(a.imageShows.origin)}${a.imageShows.note ? `  ${a.imageShows.note}` : ''}`);
  lines.push(`layout: ${a.layout.value ?? 'unknown'}${a.layout.origin === 'default' ? ' (default)' : ''}${a.layout.of && a.layout.origin !== 'default' ? ` (from ${a.layout.of})` : ''}  ${tag(a.layout.origin)}${a.layout.note ? `  ${a.layout.note}` : ''}`);
  lines.push(`sky: ${a.sky.value.toLowerCase()}${a.sky.origin === 'default' ? ' (default)' : ''}  ${tag(a.sky.origin)}`);
  const lg = a.logo.value;
  lines.push(lg.url ? `logo: ${lg.url}  ${tag(a.logo.origin)}${a.logo.note ? `  ${a.logo.note}` : ''}` : `logo: none, the monogram "${lg.monogram?.initial ?? '?'}" on ${lg.monogram?.on ? swatch(lg.monogram.on) : 'the accent'}  ${tag(a.logo.origin)}`);
  lines.push(`day palette: ${pal(a.palettes.value.day)}  ${tag(a.palettes.origin)}`);
  lines.push(`night palette: ${pal(a.palettes.value.night)}  ${tag(a.palettes.origin)}`);
  if (a.universeColors) {
    const c = a.universeColors.value;
    lines.push(`universe colors: primary ${swatch(c.primary)}  accent ${swatch(c.accent)}  tint day ${swatch(c.tintDay)}  tint night ${swatch(c.tintNight)}  ${tag('default')}  ${a.universeColors.note ?? ''}`.trimEnd());
  }
  lines.push(`typefaces: title ${a.typefaces.title.value ?? 'unknown'} ${tag(a.typefaces.title.origin)}, body ${a.typefaces.body.value} ${tag('default')}`);
  lines.push(`contrast: ${a.contrastLevel.value ?? 'unknown'}  ${tag(a.contrastLevel.origin)}${a.contrastLevel.note ? `  ${a.contrastLevel.note}` : ''}`);
  lines.push(`proposals pending: ${a.proposalsPending ?? '-'}`);
  lines.push(`history: ${a.history}`);
  return lines.join('\n');
}
