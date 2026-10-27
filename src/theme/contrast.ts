// The contrast of a theme as the platform raises it at publication:
// WCAG 2.1, 4.5:1 for text and 3:1 for large text and controls, the
// palette then each theme surface, in the night, dim and day display modes, each control against
// each theme surface that may hold it. A port of the computation of the platform
// backend (raisePalette), so that `theme check` tells offline what the platform would change; the
// surface "block" included. The opacities: opacity.ts.

export type Variant = 'night' | 'day';
export const PALETTE_KEYS = ['background', 'surface', 'text', 'primary', 'accent', 'link'] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type Palette = Record<PaletteKey, string>;
export const SURFACE_KEYS = [
  'page', 'pageHeader', 'widget', 'postCard', 'repostCard', 'quoteCard', 'replyCard', 'timeColumnCard', 'headRow', 'liveLine',
  'channelHeader', 'channelBubble', 'rail', 'focusBar', 'primaryButton', 'secondaryButton', 'link', 'badge', 'divider', 'block',
] as const;
export type SurfaceKey = (typeof SURFACE_KEYS)[number];
export const SURFACE_PARTS = ['background', 'text', 'secondaryText', 'border'] as const;
export type SurfacePart = (typeof SURFACE_PARTS)[number];
/** A theme surface as a theme gives it: its colors and its surface opacity (an integer from 0 to 100, opacity.ts). */
export type SurfaceStyle = Partial<Record<SurfacePart, string>> & { opacity?: number };
export type Surfaces = Partial<Record<SurfaceKey, SurfaceStyle>>;
export const IMAGE_SLOTS = ['page', 'pageHeader', 'timeColumn', 'channelHeader', 'cardTexture'] as const;
export type ImageSlot = (typeof IMAGE_SLOTS)[number];

export const AA_TEXT = 4.5;
export const AA_LARGE = 3;

const CARRIERS: SurfaceKey[] = ['widget', 'postCard', 'repostCard', 'quoteCard', 'replyCard', 'timeColumnCard', 'headRow', 'liveLine', 'channelHeader', 'channelBubble', 'pageHeader', 'block'];
export const HOLDERS: Partial<Record<SurfaceKey, SurfaceKey[]>> = {
  primaryButton: CARRIERS, secondaryButton: CARRIERS, link: CARRIERS, badge: CARRIERS, divider: CARRIERS,
  quoteCard: ['postCard', 'replyCard', 'channelBubble'],
  postCard: ['widget', 'page'], repostCard: ['widget', 'page'], replyCard: ['widget', 'page'], timeColumnCard: ['widget', 'page'],
  headRow: ['page'], liveLine: ['page'], pageHeader: ['page'], widget: ['page'], rail: ['page'], focusBar: ['page'], block: ['page'],
};

const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const luminance = (hex: string) => { const [r, g, b] = rgb(hex).map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
export const mixHex = (a: string, b: string, t: number) => { const [x, y] = [rgb(a), rgb(b)]; return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
const toward = (hex: string, target: number, t: number) => toHex(rgb(hex).map((v) => v + (target - v) * t));

/** [fg] readable on every background of [bgs] at [ratio]: mixed toward white or black by steps of 2 %, the smaller change. */
export function raisedOn(fg: string, bgs: string[], ratio: number): string {
  const ok = (c: string) => bgs.every((bg) => contrast(c, bg) >= ratio);
  if (ok(fg)) return fg.toUpperCase();
  const tries = [255, 0].map((target) => {
    for (let t = 0.02; t <= 1.0001; t += 0.02) { const c = toward(fg, target, t); if (ok(c)) return { c, t }; }
    return undefined;
  }).filter((x): x is { c: string; t: number } => !!x).sort((a, b) => a.t - b.t);
  if (tries[0]) return tries[0].c;
  const worst = (c: string) => Math.min(...bgs.map((bg) => contrast(c, bg)));
  return worst('#FFFFFF') >= worst('#000000') ? '#FFFFFF' : '#000000';
}

export const DIM_LIFT = 0.04;
export const dimOf = (hex: string) => mixHex(hex, '#FFFFFF', DIM_LIFT);

export type Resolved = Record<SurfaceKey, Required<Record<SurfacePart, string>>>;
export type Mode = 'night' | 'dim' | 'day';

/** Every theme surface of a variant with its four colors: the theme's, else from the palette. */
export function resolveSurfaces(palette: Palette, surfaces: Surfaces = {}): Resolved {
  const out = {} as Resolved;
  const pick = (bg: string, ...options: string[]) => options.find((c) => contrast(c, bg) >= AA_TEXT) ?? options[options.length - 1];
  const make = (key: SurfaceKey, base: { background: string; text?: string; border?: string }) => {
    const own = surfaces[key] ?? {};
    const background = own.background ?? base.background;
    const text = own.text ?? base.text ?? palette.text;
    out[key] = { background, text, secondaryText: own.secondaryText ?? mixHex(text, background, 0.3), border: own.border ?? base.border ?? mixHex(background, palette.text, 0.12) };
  };
  make('page', { background: palette.background });
  for (const key of ['pageHeader', 'widget', 'postCard', 'timeColumnCard', 'liveLine', 'channelHeader', 'channelBubble', 'rail', 'focusBar', 'block'] as const) make(key, { background: palette.surface });
  for (const key of ['repostCard', 'quoteCard', 'replyCard', 'headRow'] as const) make(key, { background: out.postCard.background, text: out.postCard.text, border: out.postCard.border });
  make('primaryButton', { background: palette.primary, text: pick(surfaces.primaryButton?.background ?? palette.primary, palette.background, palette.text) });
  make('secondaryButton', { background: palette.surface, border: palette.primary });
  make('link', { background: palette.surface, text: palette.link });
  make('badge', { background: palette.accent, text: pick(surfaces.badge?.background ?? palette.accent, palette.background, palette.text) });
  make('divider', { background: palette.surface, border: mixHex(palette.surface, palette.text, 0.12) });
  return out;
}

/** A color the platform would raise: where ("night.palette.text"), the color given, the one it would keep, the ratio reached and required. */
export type Correction = { path: string; given: string; raised: string; ratio: number; required: number };

const PAIRS: [PaletteKey, PaletteKey, number][] = [
  ['text', 'background', AA_TEXT], ['text', 'surface', AA_TEXT], ['link', 'background', AA_TEXT], ['link', 'surface', AA_TEXT],
  ['primary', 'background', AA_LARGE], ['accent', 'background', AA_LARGE],
];

/** The palette of a variant with its contrast raised, and the corrections. */
export function raisePalette(palette: Palette, variant: Variant): { palette: Palette; corrections: Correction[] } {
  const out = { ...palette };
  const corrections: Correction[] = [];
  for (const [fg, bg, ratio] of PAIRS) {
    const next = raisedOn(out[fg], [out[bg]], ratio);
    if (next !== out[fg].toUpperCase()) {
      corrections.push({ path: `${variant}.palette.${fg}`, given: out[fg].toUpperCase(), raised: next, ratio: round(contrast(out[fg], out[bg])), required: ratio });
      out[fg] = next;
    }
  }
  return { palette: out, corrections };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The theme surfaces of a variant with their contrast raised (night and dim for the night variant), and the corrections. */
export function raiseSurfaces(palette: Palette, given: Surfaces, variant: Variant): { surfaces: Surfaces; corrections: Correction[] } {
  const surfaces: Surfaces = JSON.parse(JSON.stringify(given ?? {}));
  const corrections: Correction[] = [];
  const backgrounds = (bg: string) => (variant === 'night' ? [bg, dimOf(bg)] : [bg]);
  const set = (key: SurfaceKey, part: SurfacePart, value: string, before: string, against: string[], required: number) => {
    if (value === before.toUpperCase()) return;
    (surfaces[key] ??= {})[part] = value;
    corrections.push({ path: `${variant}.surfaces.${key}.${part}`, given: before.toUpperCase(), raised: value, ratio: round(Math.min(...against.map((bg) => contrast(before, bg)))), required });
  };
  let r = resolveSurfaces(palette, surfaces);
  const holders = (key: SurfaceKey) => (HOLDERS[key] ?? []).flatMap((h) => backgrounds(r[h].background));
  const primaryHolders = holders('primaryButton');
  set('primaryButton', 'background', raisedOn(r.primaryButton.background, primaryHolders, AA_LARGE), r.primaryButton.background, primaryHolders, AA_LARGE);
  r = resolveSurfaces(palette, surfaces);
  for (const key of SURFACE_KEYS) {
    if (key === 'link' || key === 'divider') continue;
    const s = r[key];
    const bgs = backgrounds(s.background);
    set(key, 'text', raisedOn(s.text, bgs, AA_TEXT), s.text, bgs, AA_TEXT);
    set(key, 'secondaryText', raisedOn(s.secondaryText, bgs, AA_TEXT), s.secondaryText, bgs, AA_TEXT);
  }
  r = resolveSurfaces(palette, surfaces);
  const linkHolders = holders('link');
  set('link', 'text', raisedOn(r.link.text, linkHolders, AA_TEXT), r.link.text, linkHolders, AA_TEXT);
  const secondaryHolders = holders('secondaryButton');
  set('secondaryButton', 'border', raisedOn(r.secondaryButton.border, secondaryHolders, AA_LARGE), r.secondaryButton.border, secondaryHolders, AA_LARGE);
  return { surfaces, corrections };
}
