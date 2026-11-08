// The contrast of a theme as the platform raises it at publication (specs contracts/themes.md § Validation at
// publication, § Since v99.0.0): WCAG 2.1, 4.5:1 for text and 3:1 for large text and controls; the palette, then
// the four families of theme surfaces (page, sky, block, control; design-lib/lib/theme readTheme reads them, the former
// theme surfaces included), in the night, dim and day display modes: the text and the secondary text of each
// family against its background, the background of a control 3:1 against each family that holds it. A theme sets
// no radius, no stroke and no opacity. So that `theme check` tells offline what the platform would change.
import type { SurfaceColors } from './design.js';

export type Variant = 'night' | 'day';
export const PALETTE_KEYS = ['background', 'surface', 'text', 'primary', 'accent', 'link'] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type Palette = Record<PaletteKey, string>;
export const FAMILIES = ['page', 'sky', 'block', 'control'] as const;
export type Family = (typeof FAMILIES)[number];
export type Families = Partial<Record<Family, SurfaceColors>>;
export type Resolved = Record<Family, Required<SurfaceColors>>;
/** The families that hold a control (contracts/themes.md § Since v99.0.0: a control lies on the page, the sky or a block). */
export const CONTROL_HOLDERS: readonly Family[] = ['page', 'sky', 'block'];
/** The image slots read since v99.0.0 (the others are ignored). */
export const IMAGE_SLOTS = ['page', 'pageHeader'] as const;

export const AA_TEXT = 4.5;
export const AA_LARGE = 3;

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
/** A background of the night variant in the dim display mode (the night with lighter backgrounds). */
export const dimOf = (hex: string) => mixHex(hex, '#FFFFFF', DIM_LIFT);

/** The four families of a variant with their three colors: the theme's, else from the palette (§ Since v99.0.0, Default). */
export function resolveFamilies(palette: Palette, families: Families = {}): Resolved {
  const pick = (bg: string, ...options: string[]) => options.find((c) => contrast(c, bg) >= AA_TEXT) ?? options[options.length - 1];
  const make = (own: SurfaceColors | undefined, background: string, text?: string) => {
    const bg = own?.background ?? background;
    const t = own?.text ?? text ?? palette.text;
    return { background: bg, text: t, secondaryText: own?.secondaryText ?? mixHex(t, bg, 0.3) };
  };
  const controlBg = families.control?.background ?? palette.primary;
  return {
    page: make(families.page, palette.background), sky: make(families.sky, palette.surface), block: make(families.block, palette.surface),
    control: make(families.control, palette.primary, pick(controlBg, palette.background, palette.text)),
  };
}

/** A color the platform would raise: where ("night.surfaces.control.text"), the color given, the one it would keep, the ratio reached and required. */
export type Correction = { path: string; given: string; raised: string; ratio: number; required: number };
const round = (n: number) => Math.round(n * 100) / 100;

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

/** The families of a variant with their contrast raised (night and dim for the night variant), and the corrections. */
export function raiseFamilies(palette: Palette, given: Families, variant: Variant): { families: Families; resolved: Resolved; corrections: Correction[] } {
  const families: Families = JSON.parse(JSON.stringify(given ?? {}));
  const corrections: Correction[] = [];
  const backgrounds = (bg: string) => (variant === 'night' ? [bg, dimOf(bg)] : [bg]);
  const set = (family: Family, part: keyof SurfaceColors, value: string, before: string, against: string[], required: number) => {
    if (value === before.toUpperCase()) return;
    (families[family] ??= {})[part] = value;
    corrections.push({ path: `${variant}.surfaces.${family}.${part}`, given: before.toUpperCase(), raised: value, ratio: round(Math.min(...against.map((bg) => contrast(before, bg)))), required });
  };
  let r = resolveFamilies(palette, families);
  const holders = CONTROL_HOLDERS.flatMap((h) => backgrounds(r[h].background));
  set('control', 'background', raisedOn(r.control.background, holders, AA_LARGE), r.control.background, holders, AA_LARGE);
  r = resolveFamilies(palette, families);
  for (const family of FAMILIES) {
    const bgs = backgrounds(r[family].background);
    set(family, 'text', raisedOn(r[family].text, bgs, AA_TEXT), r[family].text, bgs, AA_TEXT);
    set(family, 'secondaryText', raisedOn(r[family].secondaryText, bgs, AA_TEXT), r[family].secondaryText, bgs, AA_TEXT);
  }
  return { families, resolved: resolveFamilies(palette, families), corrections };
}
