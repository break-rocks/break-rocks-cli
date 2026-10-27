// Opacity and text backdrops, as the platform computes them at publication: a port of the backend
// (planOpacities) and of the floors of the controls
// (atPublication), so that `theme check` shows offline the surface opacity of each theme surface, the
// text scrims (text backdrops, the default) or the surface opacities raised (a whole-surface
// backdrop), and the buttons and the badge raised to 100. Offline, the tones of the images are
// unknown: they are read as black and white, as the platform reads an image whose tones it did not
// analyze (UNKNOWN_TONES); the platform reads the tones of the images sent.
import { AA_LARGE, AA_TEXT, HOLDERS, IMAGE_SLOTS, SURFACE_KEYS, dimOf, resolveSurfaces, type ImageSlot, type Mode, type Palette, type SurfaceKey, type Surfaces, type Variant } from './contrast.js';

export const TEXT_BACKDROPS = ['block', 'surface'] as const;
export type TextBackdrop = (typeof TEXT_BACKDROPS)[number];
/** The text styles of the text scrims: body text and secondary text (4.5:1), large text and controls (3:1). */
export const TEXT_STYLES = ['body', 'secondary', 'large', 'control'] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];
/** The text scrims of a theme: by theme surface below 100, by text style and display mode, from 0 to 1. */
export type TextScrims = Partial<Record<SurfaceKey, Record<TextStyle, Record<Mode, number>>>>;
/** The tones of an image whose luminance was not analyzed: the worst case the platform takes. */
export const UNKNOWN_TONES = ['#000000', '#FFFFFF'];

/** The theme surfaces as transparent as readability allows when an image lies under them and no opacity is given. */
export const SEE_THROUGH: readonly SurfaceKey[] = ['page', 'pageHeader', 'focusBar', 'rail', 'timeColumnCard', 'channelHeader', 'postCard', 'repostCard', 'quoteCard', 'replyCard', 'headRow'];
/** The image of its own slot under a theme surface (the page under the page). */
export const OWN_SLOT: Partial<Record<SurfaceKey, ImageSlot>> = {
  page: 'page', pageHeader: 'pageHeader', timeColumnCard: 'timeColumn', channelHeader: 'channelHeader',
  postCard: 'cardTexture', repostCard: 'cardTexture', quoteCard: 'cardTexture', replyCard: 'cardTexture', headRow: 'cardTexture',
};
/** The controls (since the trials of themes): drawn at 100; an opacity below 100 given to one is raised to 100 at publication. */
export const CONTROL_SURFACES: readonly SurfaceKey[] = ['primaryButton', 'secondaryButton', 'badge'];
/** The theme surfaces without a text run of their own: the link and the divider. */
const NO_TEXT_RUN = new Set<SurfaceKey>(['link', 'divider']);

/** The theme surfaces that may hold [key]; none under the page. */
export const holdersOf = (key: SurfaceKey): SurfaceKey[] => (key === 'page' ? [] : HOLDERS[key] ?? ['page']);
/** The theme surfaces from the page outward: each after every one that may hold it. */
export const SURFACE_ORDER: readonly SurfaceKey[] = (() => {
  const out: SurfaceKey[] = [];
  const visit = (key: SurfaceKey) => { if (out.includes(key)) return; holdersOf(key).forEach(visit); out.push(key); };
  SURFACE_KEYS.forEach(visit);
  return out;
})();

/** What the opacities of a theme are computed from: its palettes and surfaces (their contrast raised), its default surface opacity, its text backdrop, its image slots. */
export type OpacityTheme = {
  variants: Record<Variant, { palette: Palette; surfaces?: Surfaces }>;
  surfaceOpacity?: number; textBackdrop?: string;
  imageSlots?: Partial<Record<ImageSlot, { day?: string | null; night?: string | null } | null>>;
};
type Tones = (id: string) => string[] | undefined;

const hasImage = (t: OpacityTheme, slot: ImageSlot) => !!t.imageSlots?.[slot]?.day;
/** Whether an image lies under [key]: the image of its own slot or the image of the page. */
export const imageUnder = (t: OpacityTheme, key: SurfaceKey) => { const own = OWN_SLOT[key]; return (!!own && hasImage(t, own)) || hasImage(t, 'page'); };
/** The surface opacity a theme gives [key] in [variant]: its own, else the default surface opacity. */
export const givenOpacity = (t: OpacityTheme, variant: Variant, key: SurfaceKey): number | undefined => t.variants[variant].surfaces?.[key]?.opacity ?? t.surfaceOpacity;

/** The surface opacity of each theme surface of [variant] before readability (percent). */
export function baseOpacities(t: OpacityTheme, variant: Variant): Record<SurfaceKey, number> {
  const out = {} as Record<SurfaceKey, number>;
  for (const key of SURFACE_KEYS) {
    if ((key === 'page' && !hasImage(t, 'page')) || CONTROL_SURFACES.includes(key)) { out[key] = 100; continue; }
    out[key] = givenOpacity(t, variant, key) ?? (SEE_THROUGH.includes(key) && imageUnder(t, key) ? 0 : 100);
  }
  return out;
}

type RGB = [number, number, number];
const rgbOf = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const linear = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (c: RGB) => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const over = (under: RGB, top: RGB, a: number): RGB => [0, 1, 2].map((i) => Math.round(under[i] + (top[i] - under[i]) * a)) as RGB;
const hexOf = (c: RGB) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** The lowest step (0.01) from [from] at which every color of [fgs] reaches [min] over [top] drawn at [effective](step) over each of [unders]. */
function lowest(fgs: string[], min: number, top: string, unders: string[], effective: (a: number) => number, from = 0): number {
  if (!unders.length) return from;
  const t = rgbOf(top);
  const us = unders.map(rgbOf);
  const fl = fgs.map((f) => lum(rgbOf(f)));
  for (let step = Math.round(from * 100); step <= 100; step++) {
    const e = effective(step / 100);
    if (us.every((u) => { const l = lum(over(u, t, e)); return fl.every((f) => ratio(f, l) >= min); })) return step / 100;
  }
  return 1;
}

const STYLES: Record<TextStyle, { parts: ('text' | 'secondaryText')[]; min: number }> = {
  body: { parts: ['text'], min: AA_TEXT }, secondary: { parts: ['secondaryText'], min: AA_TEXT },
  large: { parts: ['text'], min: AA_LARGE }, control: { parts: ['text', 'secondaryText'], min: AA_LARGE },
};

/** What lies under each theme surface in [mode] with the surface opacities [ops]. */
function underOf(t: OpacityTheme, mode: Mode, ops: Record<SurfaceKey, number>, tonesOf: Tones) {
  const variant: Variant = mode === 'day' ? 'day' : 'night';
  const sf = resolveSurfaces(t.variants[variant].palette, t.variants[variant].surfaces);
  const bg = (key: SurfaceKey) => (mode === 'dim' ? dimOf(sf[key].background) : sf[key].background);
  const tones = (slot: ImageSlot) => {
    const image = t.imageSlots?.[slot];
    if (!image?.day) return [];
    const found = tonesOf(mode === 'day' ? image.day : image.night ?? image.day);
    return found?.length ? found : UNKNOWN_TONES;
  };
  const unders = new Map<SurfaceKey, string[]>();
  const drawn = new Map<SurfaceKey, string[]>();
  const composite = (key: SurfaceKey): string[] => {
    if (!drawn.has(key)) {
      const o = ops[key] / 100;
      const u = under(key);
      drawn.set(key, o >= 1 || !u.length ? [bg(key)] : [...new Set(u.map((c) => hexOf(over(rgbOf(c), rgbOf(bg(key)), o))))]);
    }
    return drawn.get(key)!;
  };
  const under = (key: SurfaceKey): string[] => {
    if (!unders.has(key)) {
      const own = OWN_SLOT[key];
      unders.set(key, [...new Set([...(own ? tones(own) : []), ...holdersOf(key).flatMap(composite)])]);
    }
    return unders.get(key)!;
  };
  return { under, bg, colors: sf };
}

export type OpacityPlan = {
  textBackdrop: TextBackdrop;
  /** The surface opacity of each theme surface by variant (percent), as published: raised with a whole-surface backdrop, the controls at 100. */
  opacities: Record<Variant, Record<SurfaceKey, number>>;
  /** The text scrims (text backdrops; none with a whole-surface backdrop). */
  textScrims: TextScrims;
  /** The surface opacities raised by readability (whole-surface backdrop); "told": an opacity the theme gives (its own or the default). */
  raised: { variant: Variant; surface: SurfaceKey; from: number; to: number; told: boolean }[];
  /** The opacities below 100 given to a button or the badge, raised to 100. */
  floors: { variant: Variant; surface: SurfaceKey; from: number }[];
};

/** The surface opacities and the text scrims of a theme, as planOpacities and atPublication compute them ([tonesOf]: unknown offline). */
export function planOpacities(t: OpacityTheme, tonesOf: Tones = () => undefined): OpacityPlan {
  const textBackdrop: TextBackdrop = t.textBackdrop === 'surface' ? 'surface' : 'block';
  const opacities = { night: baseOpacities(t, 'night'), day: baseOpacities(t, 'day') };
  const raised: OpacityPlan['raised'] = [];
  const floors: OpacityPlan['floors'] = [];
  for (const variant of ['night', 'day'] as const) for (const key of CONTROL_SURFACES) {
    const own = t.variants[variant].surfaces?.[key]?.opacity;
    if (own != null && own < 100) floors.push({ variant, surface: key, from: own });
  }
  if (textBackdrop === 'surface') {
    const modes: Record<Variant, Mode[]> = { night: ['night', 'dim'], day: ['day'] };
    for (const variant of ['night', 'day'] as const) {
      const ops = opacities[variant];
      const readers = modes[variant].map((mode) => underOf(t, mode, ops, tonesOf));
      for (const key of SURFACE_ORDER) {
        const from = ops[key];
        if (from >= 100 || NO_TEXT_RUN.has(key)) continue;
        const to = Math.max(...readers.flatMap((r) => Object.values(STYLES).map((s) => lowest(s.parts.map((p) => r.colors[key][p]), s.min, r.bg(key), r.under(key), (a) => a, from / 100))));
        const percent = Math.min(100, Math.round(to * 100));
        if (percent > from) {
          ops[key] = percent;
          raised.push({ variant, surface: key, from, to: percent, told: givenOpacity(t, variant, key) !== undefined });
        }
      }
    }
    return { textBackdrop, opacities, textScrims: {}, raised, floors };
  }
  const textScrims: TextScrims = {};
  const readers = { night: underOf(t, 'night', opacities.night, tonesOf), dim: underOf(t, 'dim', opacities.night, tonesOf), day: underOf(t, 'day', opacities.day, tonesOf) };
  for (const key of SURFACE_ORDER) {
    if (NO_TEXT_RUN.has(key) || (opacities.night[key] >= 100 && opacities.day[key] >= 100)) continue;
    const scrims = {} as Record<TextStyle, Record<Mode, number>>;
    for (const [style, s] of Object.entries(STYLES) as [TextStyle, (typeof STYLES)[TextStyle]][]) {
      scrims[style] = {} as Record<Mode, number>;
      for (const mode of ['night', 'dim', 'day'] as const) {
        const o = opacities[mode === 'day' ? 'day' : 'night'][key] / 100;
        const r = readers[mode];
        // The text backdrop at a over the theme surface at o: 1 - (1 - o)(1 - a) of its background.
        scrims[style][mode] = o >= 1 ? 0 : lowest(s.parts.map((p) => r.colors[key][p]), s.min, r.bg(key), r.under(key), (a) => 1 - (1 - o) * (1 - a));
      }
    }
    textScrims[key] = scrims;
  }
  return { textBackdrop, opacities, textScrims, raised, floors };
}

/** The image slots of a document as the plan reads them ({ day, night } or a file name for the day). */
export function slotsOf(value: unknown): OpacityTheme['imageSlots'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: NonNullable<OpacityTheme['imageSlots']> = {};
  for (const slot of IMAGE_SLOTS) {
    const v = (value as Record<string, unknown>)[slot];
    if (typeof v === 'string' && v) out[slot] = { day: v };
    else if (typeof v === 'object' && v !== null) out[slot] = v as { day?: string; night?: string };
  }
  return out;
}
