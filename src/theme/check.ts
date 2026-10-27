// `theme check`: a theme document (format 2, or 1) and its image files checked offline as the
// platform checks them at publication, plus what the studio checks at the
// import (each image named by the JSON matched with a file). The contrast is raised by the platform,
// not refused: each color it would raise is a warning with the color it would keep (an error with
// --strict). The surface opacities, the default surface opacity and the text backdrop
// are checked, and the opacities and the text scrims the platform would compute are shown
// (opacity.ts); an opacity below 100 given to a button or the badge is a warning (raised to 100).
// The report is JSON for hooks.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { IMAGE_SLOTS, PALETTE_KEYS, SURFACE_KEYS, SURFACE_PARTS, raisePalette, raiseSurfaces, type Correction, type Palette, type Surfaces, type Variant } from './contrast.js';
import { imageInfo } from './images.js';
import { CONTROL_SURFACES, TEXT_BACKDROPS, planOpacities, slotsOf, type OpacityPlan } from './opacity.js';
import { approvedTypeface } from './typefaces.js';
import { isSystemFile } from './zip.js';

export const FORMAT_2 = 'break-rocks-theme/2';
export const FORMAT_1 = 'break-rocks-theme/1';
export const THEME_MAX_BYTES = 64 * 1024;
export const IMAGES_MAX = 8;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const WORDMARK_MAX_BYTES = 1024 * 1024;
export const WORDMARK_MAX_RATIO = 6;
export const BANNER_MIN = { width: 1500, height: 500 };
export const FIELDS = ['CULTURE', 'ENTERTAINMENT', 'EVERYDAY_LIFE', 'GAMES', 'PLACES', 'POLITICS', 'SCIENCE', 'SPORT', 'TECH', 'WORK'] as const;
const RADII = ['round', 'soft', 'sharp'];
const STROKES = ['thin', 'regular', 'bold'];
const TOP_KEYS = new Set(['format', 'universe', 'name', 'description', 'creator', 'copiedFrom', 'collection', 'version', 'variants', 'surfaceRadius', 'typography', 'gradient', 'motionAccents', 'shape', 'images', 'imageSlots', 'stickers', 'scrims', 'screenshots', 'density', 'motion', 'sounds', 'surfaceOpacity', 'textBackdrop', 'textScrims']);
const HEX = /^#[0-9a-fA-F]{6}$/;
const UPLOAD_ID = /^(?![A-Za-z][A-Za-z0-9+.-]*:)[^\s/\\]{1,128}$/;
/** The ratio and the size the prompt asks for each image slot (the theme prompt, `theme prompt`): a warning when far from it. */
export const SLOT_SIZES: Partial<Record<string, { ratio: number; label: string }>> = {
  page: { ratio: 4 / 3, label: '4:3, 2400 × 1800' }, pageHeader: { ratio: 3, label: '3:1, at least 1500 × 500' },
  timeColumn: { ratio: 3 / 4, label: '3:4, 1200 × 1600' }, channelHeader: { ratio: 3, label: '3:1, 2400 × 800' }, cardTexture: { ratio: 1, label: 'square, 1024 × 1024, seamless' },
};
/** The text of THEME_SCRIMS_COMPUTED. */
export const SCRIMS_COMPUTED = 'The scrims and the text scrims of a theme are computed by the social platform';
/** Whether a surface opacity is valid: an integer from 0 to 100 (THEME_OPACITY_INVALID). */
export const validOpacity = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;

export type Severity = 'error' | 'warning';
export type Problem = { code: string; severity: Severity; path: string; message: string; suggested?: string; ratio?: number; required?: number; opacity?: number };
export type ImageRef = { place: string; variant?: 'day' | 'night'; ref: string };
export type ImageReport = ImageRef & { file?: string; type?: string; width?: number; height?: number; bytes?: number };
export type CheckReport = {
  ok: boolean; file: string; format: string; name?: string; universe?: string;
  errors: number; warnings: number; problems: Problem[]; images: ImageReport[]; unusedFiles: string[]; strict: boolean;
  /** Every color the platform would raise, those the theme derives from its palette included (only the ones it gives are warnings). */
  raised: Correction[];
  /** The surface opacities, the text scrims and the opacities raised, as the platform would compute them (images read as black and white offline). */
  opacity?: OpacityPlan;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Whether a reference of an image names a file ("page-day.jpg"), not an upload id. */
export const isFileReference = (ref: string) => /\.[A-Za-z0-9]{2,5}$/.test(ref.trim());
const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length;

/** Whether a theme name follows the rule (2 to 64 letters, digits, "-", "_", "."; a letter first; no ".." nor a final "."). */
export function validThemeName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const n = name.trim().normalize('NFC');
  const length = [...n].length;
  return length >= 2 && length <= 64 && /^[\p{L}\p{M}\p{Nd}._-]+$/u.test(n) && /^\p{L}/u.test(n) && !n.includes('..') && !n.endsWith('.');
}

/** The image references of a document (format 2: the image slots, the wordmark, the pattern; format 1: banner, background, texture too). */
export function imageRefs(doc: Record<string, unknown>): ImageRef[] {
  const out: ImageRef[] = [];
  const slotRefs = (place: string, value: unknown) => {
    if (typeof value === 'string' && value) out.push({ place, variant: 'day', ref: value });
    else if (isObject(value)) for (const variant of ['day', 'night'] as const) if (typeof value[variant] === 'string' && value[variant]) out.push({ place, variant, ref: value[variant] as string });
  };
  const slots = isObject(doc.imageSlots) ? doc.imageSlots : {};
  for (const [place, value] of Object.entries(slots)) slotRefs(place, value);
  const images = isObject(doc.images) ? doc.images : {};
  for (const [place, value] of Object.entries(images)) {
    if (place === 'wordmark' || place === 'pattern') { if (typeof value === 'string' && value) out.push({ place, ref: value }); } else slotRefs(place, value);
  }
  return out;
}

/** The image files beside the document, when none are given: the images of its folder. */
export function imagesBeside(file: string): string[] {
  const dir = dirname(file);
  try { return readdirSync(dir).filter((n) => /\.(jpe?g|png|webp|gif|heic|avif)$/i.test(n) && !isSystemFile(n)).map((n) => join(dir, n)).filter((p) => statSync(p).isFile()); } catch { return []; }
}

/** The file of [ref] among [files]: the same name (case not counted), else the same name with another extension. */
export function fileFor(ref: string, files: readonly string[]): string | undefined {
  const name = basename(ref.replaceAll('\\', '/')).toLowerCase();
  const stem = (p: string) => basename(p).replace(/\.[^.]+$/, '').toLowerCase();
  return files.find((f) => basename(f).toLowerCase() === name) ?? files.find((f) => stem(f) === stem(name) && extname(f) !== '');
}

/**
 * Checks the theme of [file] (its text [text]) with the image files [given] (none: the images of its
 * folder). [strict]: the colors the platform would raise count as errors.
 */
export function checkTheme(file: string, text: string, given: readonly string[] = [], strict = false): CheckReport {
  const problems: Problem[] = [];
  const add = (severity: Severity, code: string, path: string, message: string, extra: Partial<Problem> = {}) => problems.push({ code, severity, path, message, ...extra });
  const error = (code: string, path: string, message: string, extra?: Partial<Problem>) => add('error', code, path, message, extra);
  const warn = (code: string, path: string, message: string, extra?: Partial<Problem>) => add('warning', code, path, message, extra);
  const raised: Correction[] = [];
  let opacity: OpacityPlan | undefined;
  const report = (format: string, doc?: Record<string, unknown>, images: ImageReport[] = [], unused: string[] = []): CheckReport => {
    const finalProblems = strict ? problems.map((p) => ({ ...p, severity: 'error' as const })) : problems;
    const errors = finalProblems.filter((p) => p.severity === 'error').length;
    return {
      ok: errors === 0, file, format, ...(typeof doc?.name === 'string' ? { name: doc.name } : {}), ...(typeof doc?.universe === 'string' ? { universe: doc.universe } : {}),
      errors, warnings: finalProblems.length - errors, problems: finalProblems, images, unusedFiles: unused, strict, raised, ...(opacity ? { opacity } : {}),
    };
  };

  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { error('THEME_FORMAT_INVALID', '$', `Not JSON: ${(e as Error).message}`); return report('unknown'); }
  if (!isObject(raw)) { error('THEME_FORMAT_INVALID', '$', 'A theme is a JSON object'); return report('unknown'); }
  const doc = raw;

  // 1. The format and the size.
  const format = doc.format ?? FORMAT_1;
  if (doc.format === undefined) warn('THEME_FORMAT_MISSING', 'format', `No "format": read as ${FORMAT_1}; write "${FORMAT_2}"`);
  if (format !== FORMAT_1 && format !== FORMAT_2) { error('THEME_FORMAT_INVALID', 'format', `The format is "${FORMAT_2}" (or "${FORMAT_1}")`); return report(String(format), doc); }
  const v2 = format === FORMAT_2;
  const bytes = new TextEncoder().encode(JSON.stringify(doc)).length;
  if (bytes > THEME_MAX_BYTES) error('THEME_TOO_LARGE', '$', `The document is ${bytes} bytes: at most 64 KB without its images`);
  for (const key of Object.keys(doc)) if (!TOP_KEYS.has(key)) error('THEME_FORMAT_INVALID', key, `"${key}" is not a key of a theme`);
  if (doc.scrims != null) error('THEME_SCRIMS_COMPUTED', 'scrims', `${SCRIMS_COMPUTED}: remove "scrims"`);
  if (doc.textScrims != null) error('THEME_SCRIMS_COMPUTED', 'textScrims', `${SCRIMS_COMPUTED}: remove "textScrims"`);
  // The default surface opacity and the text backdrop, of the format 2.
  if (doc.surfaceOpacity != null && !validOpacity(doc.surfaceOpacity)) error('THEME_OPACITY_INVALID', 'surfaceOpacity', 'The opacity of a theme surface is an integer from 0 to 100 percent');
  if (doc.textBackdrop != null && !(TEXT_BACKDROPS as readonly unknown[]).includes(doc.textBackdrop)) error('THEME_TEXT_BACKDROP_INVALID', 'textBackdrop', 'The text backdrop of a theme is block or surface');
  if (!v2) for (const key of ['surfaceOpacity', 'textBackdrop']) if (doc[key] != null) error('THEME_FORMAT_INVALID', key, `"${key}" is of the format "${FORMAT_2}"`);
  if (Array.isArray(doc.screenshots) && doc.screenshots.length) error('THEME_SCREENSHOTS_GENERATED', 'screenshots', 'The screenshots are generated by the platform: remove "screenshots"');
  for (const key of ['creator', 'version', 'copiedFrom']) if (doc[key] != null) warn('THEME_KEY_SET_BY_PLATFORM', key, `"${key}" is set by the platform: it is ignored or replaced at publication`);
  for (const key of ['density', 'motion', 'sounds']) if (doc[key] != null) warn('THEME_PERSONAL_SETTING', key, `"${key}" is a setting of a personal theme only`);

  // 2. Name, universe, description, field.
  if (!validThemeName(doc.name)) error('THEME_NAME_INVALID', 'name', 'A theme name has 2 to 64 letters, digits, "-", "_" or ".", beginning with a letter, without ".." nor a final "."');
  if (doc.universe !== undefined && (typeof doc.universe !== 'string' || !/^%\S+$/.test(doc.universe))) error('THEME_UNIVERSE_INVALID', 'universe', 'The universe is an address beginning with "%"');
  if (doc.description !== undefined && (typeof doc.description !== 'string' || graphemes(doc.description.trim()) > 160)) error('THEME_DESCRIPTION_TOO_LONG', 'description', 'The description has at most 160 visible characters');
  if (doc.collection != null && doc.collection !== '' && !(typeof doc.collection === 'string' && (FIELDS as readonly string[]).includes(doc.collection.trim().toUpperCase()))) {
    error('THEME_FIELD_INVALID', 'collection', `The field is one of ${FIELDS.join(', ')}, or none`);
  }

  // 3. The variants: palettes and theme surfaces.
  const variants = isObject(doc.variants) ? doc.variants : {};
  const palettes: Partial<Record<Variant, Palette>> = {};
  const surfaces: Partial<Record<Variant, Surfaces>> = {};
  for (const variant of ['night', 'day'] as const) {
    const v = variants[variant];
    if (!isObject(v)) { error('THEME_VARIANT_MISSING', `variants.${variant}`, `The ${variant} variant is required`); continue; }
    for (const key of Object.keys(v)) if (key !== 'palette' && key !== 'surfaces') error('THEME_FORMAT_INVALID', `variants.${variant}.${key}`, `"${key}" is not a key of a variant`);
    const p = isObject(v.palette) ? v.palette : {};
    let complete = true;
    for (const k of PALETTE_KEYS) if (typeof p[k] !== 'string' || !HEX.test(p[k] as string)) { complete = false; error('THEME_PALETTE_INVALID', `variants.${variant}.palette.${k}`, 'A color of the palette is #RRGGBB'); }
    for (const k of Object.keys(p)) if (!(PALETTE_KEYS as readonly string[]).includes(k)) error('THEME_FORMAT_INVALID', `variants.${variant}.palette.${k}`, `"${k}" is not a color of the palette`);
    if (complete) palettes[variant] = Object.fromEntries(PALETTE_KEYS.map((k) => [k, (p[k] as string).toUpperCase()])) as Palette;
    if (v.surfaces != null) {
      if (!v2) error('THEME_FORMAT_INVALID', `variants.${variant}.surfaces`, `The theme surfaces are of the format "${FORMAT_2}"`);
      if (!isObject(v.surfaces)) { error('THEME_FORMAT_INVALID', `variants.${variant}.surfaces`, 'The theme surfaces are an object'); continue; }
      const own: Surfaces = {};
      for (const [key, colors] of Object.entries(v.surfaces)) {
        const path = `variants.${variant}.surfaces.${key}`;
        if (!(SURFACE_KEYS as readonly string[]).includes(key)) { error('THEME_SURFACE_UNKNOWN', path, `"${key}" is not a theme surface`); continue; }
        if (colors == null) continue;
        if (!isObject(colors)) { error('THEME_FORMAT_INVALID', path, 'A theme surface has its colors as an object'); continue; }
        const part: Record<string, string | number> = {};
        for (const [name, value] of Object.entries(colors)) {
          // Its surface opacity: an integer percent; a button or the badge kept at 100.
          if (name === 'opacity') {
            if (value == null) continue;
            if (!validOpacity(value)) { error('THEME_OPACITY_INVALID', `${path}.opacity`, 'The opacity of a theme surface is an integer from 0 to 100 percent'); continue; }
            part.opacity = value as number;
            if ((value as number) < 100 && CONTROL_SURFACES.includes(key as never)) {
              warn('THEME_OPACITY_RAISED', `${path}.opacity`, `A ${key === 'badge' ? 'badge' : 'button'} is drawn at 100: the platform would raise ${value as number} to 100`, { opacity: 100 });
            }
            continue;
          }
          if (!(SURFACE_PARTS as readonly string[]).includes(name)) { error('THEME_FORMAT_INVALID', `${path}.${name}`, `A theme surface has ${SURFACE_PARTS.join(', ')}, opacity`); continue; }
          if (typeof value !== 'string' || !HEX.test(value)) { error('THEME_PALETTE_INVALID', `${path}.${name}`, 'A color of a theme surface is #RRGGBB'); continue; }
          part[name] = value.toUpperCase();
        }
        own[key as keyof Surfaces] = part as Surfaces[keyof Surfaces];
      }
      surfaces[variant] = own;
    }
  }
  if (doc.surfaceRadius != null) {
    if (!v2) error('THEME_FORMAT_INVALID', 'surfaceRadius', `The radius of the theme surfaces is of the format "${FORMAT_2}"`);
    else if (!isObject(doc.surfaceRadius)) error('THEME_RADIUS_INVALID', 'surfaceRadius', 'surfaceRadius is an object');
    else for (const [key, value] of Object.entries(doc.surfaceRadius)) {
      if (!(SURFACE_KEYS as readonly string[]).includes(key)) error('THEME_SURFACE_UNKNOWN', `surfaceRadius.${key}`, `"${key}" is not a theme surface`);
      else if (!RADII.includes(value as string)) error('THEME_RADIUS_INVALID', `surfaceRadius.${key}`, 'A radius is round, soft or sharp');
    }
  }

  // 4. Typography, gradient, shape.
  const typography = isObject(doc.typography) ? doc.typography : {};
  if (typography.body != null || typography.text != null) error('THEME_BODY_TYPEFACE', 'typography', 'No typeface for the body text: it stays the readable typeface of Socle');
  const face = (key: 'title' | 'accent', required: boolean) => {
    const value = typography[key];
    if (value == null) { if (required) error('THEME_TYPEFACE_NOT_APPROVED', `typography.${key}`, 'The title typeface is required, from the approved list (breakrocks theme typefaces)'); return; }
    if (typeof value === 'string' && /^[a-z][a-z0-9+.-]*:|\//i.test(value)) { error('THEME_EXTERNAL_RESOURCE', `typography.${key}`, 'A typeface comes from the approved list, never from elsewhere'); return; }
    if (!approvedTypeface(value)) error('THEME_TYPEFACE_NOT_APPROVED', `typography.${key}`, `"${String(value)}" is not an approved typeface (breakrocks theme typefaces)`);
  };
  face('title', true);
  if (typography.accent != null && !v2) error('THEME_FORMAT_INVALID', 'typography.accent', `The accent typeface is of the format "${FORMAT_2}"`);
  else face('accent', false);
  for (const key of Object.keys(typography)) if (!['title', 'accent', 'body', 'text'].includes(key)) error('THEME_FORMAT_INVALID', `typography.${key}`, `"${key}" is not a typeface of a theme`);
  if (doc.gradient != null) {
    const colors = new Set(Object.values(palettes).flatMap((p) => Object.values(p!)));
    if (!Array.isArray(doc.gradient) || doc.gradient.length < 2 || doc.gradient.length > 3 || doc.gradient.some((c) => typeof c !== 'string' || !colors.has(c.toUpperCase()))) {
      error('THEME_GRADIENT_INVALID', 'gradient', 'The accent gradient has 2 or 3 colors of the palette');
    }
  }
  if (doc.motionAccents != null && typeof doc.motionAccents !== 'boolean') error('THEME_FORMAT_INVALID', 'motionAccents', 'motionAccents is true or false');
  const shape = isObject(doc.shape) ? doc.shape : {};
  if (shape.radius != null && !RADII.includes(shape.radius as string)) error('THEME_RADIUS_INVALID', 'shape.radius', 'A radius is round, soft or sharp');
  if (shape.stroke != null && !STROKES.includes(shape.stroke as string) && typeof shape.stroke !== 'number') error('THEME_STROKE_INVALID', 'shape.stroke', 'The stroke is thin, regular or bold');

  // 5. The images: slots, references, files.
  if (doc.imageSlots != null) {
    if (!v2) error('THEME_FORMAT_INVALID', 'imageSlots', `The image slots are of the format "${FORMAT_2}"`);
    else if (!isObject(doc.imageSlots)) error('THEME_FORMAT_INVALID', 'imageSlots', 'imageSlots is an object');
    else for (const [slot, value] of Object.entries(doc.imageSlots)) {
      if (!(IMAGE_SLOTS as readonly string[]).includes(slot)) error('THEME_IMAGE_SLOT_UNKNOWN', `imageSlots.${slot}`, `"${slot}" is not an image slot`);
      else if (value != null && !(typeof value === 'string' || (isObject(value) && Object.keys(value).every((k) => k === 'day' || k === 'night')))) error('THEME_FORMAT_INVALID', `imageSlots.${slot}`, 'An image slot is null or { "day", "night" }');
    }
  }
  if (doc.images != null) {
    if (!isObject(doc.images)) error('THEME_FORMAT_INVALID', 'images', 'images is an object');
    else for (const key of Object.keys(doc.images)) {
      const allowed = v2 ? ['wordmark', 'pattern'] : ['wordmark', 'pattern', 'banner', 'background', 'texture'];
      if (!allowed.includes(key)) error('THEME_FORMAT_INVALID', `images.${key}`, v2 ? 'In the format 2, images holds the wordmark and the pattern: the banner, the background and the texture are the image slots pageHeader, page and cardTexture' : `"${key}" is not an image of a theme`);
    }
  }
  const refs = imageRefs(doc);
  if (refs.length > IMAGES_MAX) error('THEME_IMAGES_LIMIT', 'imageSlots', `${refs.length} images: at most ${IMAGES_MAX}, night variants, wordmark and pattern counted`);
  const files = given.length ? [...given] : imagesBeside(file);
  const used = new Set<string>();
  const images: ImageReport[] = [];
  for (const ref of refs) {
    const path = ref.variant ? `${ref.place in (isObject(doc.imageSlots) ? doc.imageSlots : {}) ? 'imageSlots' : 'images'}.${ref.place}.${ref.variant}` : `images.${ref.place}`;
    if (!UPLOAD_ID.test(ref.ref)) { error('THEME_EXTERNAL_RESOURCE', path, 'An image is a file name (to send) or an upload id of the platform, never a URL nor a path'); images.push(ref); continue; }
    if (!isFileReference(ref.ref)) { images.push(ref); continue; }
    const found = fileFor(ref.ref, files);
    if (!found || !existsSync(found)) { error('IMAGE_FILE_MISSING', path, `No file for "${ref.ref}": give it, or set the slot to null`); images.push(ref); continue; }
    used.add(found);
    const data = new Uint8Array(readFileSync(found));
    const info = imageInfo(data);
    images.push({ ...ref, file: found, bytes: data.length, ...(info ? { type: info.type, width: info.width, height: info.height } : {}) });
    const wordmark = ref.place === 'wordmark';
    const types = wordmark ? ['image/png', 'image/webp'] : ['image/jpeg', 'image/png', 'image/webp'];
    if (!info || !types.includes(info.type)) { error('THEME_IMAGE_TYPE', path, wordmark ? 'The wordmark is a PNG or a WebP image' : 'An image of a theme is a JPEG, PNG or WebP image'); continue; }
    const max = wordmark ? WORDMARK_MAX_BYTES : IMAGE_MAX_BYTES;
    if (data.length > max) error('THEME_IMAGE_TOO_LARGE', path, `${(data.length / 1048576).toFixed(1)} MB: at most ${max / 1048576} MB`);
    const ratio = info.height ? info.width / info.height : 0;
    if (wordmark && ratio > WORDMARK_MAX_RATIO) error('THEME_WORDMARK_RATIO', path, `The wordmark is ${ratio.toFixed(1)}:1: at most 6:1`);
    const isBanner = ref.place === 'pageHeader' || ref.place === 'banner';
    if (isBanner && (Math.abs(ratio - 3) > 0.06 || info.width < BANNER_MIN.width || info.height < BANNER_MIN.height)) {
      warn('THEME_BANNER_SIZE', path, `The banner is ${info.width} × ${info.height}: the slot expects 3:1, at least 1500 × 500`);
    }
    const expected = SLOT_SIZES[ref.place === 'background' ? 'page' : ref.place === 'texture' ? 'cardTexture' : ref.place];
    if (!isBanner && expected && ratio && Math.abs(ratio - expected.ratio) / expected.ratio > 0.1) warn('IMAGE_RATIO_UNUSUAL', path, `${info.width} × ${info.height}: this slot expects ${expected.label}`);
  }
  const unused = given.filter((f) => !used.has(f));
  for (const f of unused) warn('IMAGE_FILE_UNUSED', f, 'No reference of the theme names this file');

  // 6. The contrast, as the platform raises it: a warning for each color the theme gives (a palette
  // color, a part of a theme surface it sets); the colors it derives are raised silently (listed in "raised").
  if (palettes.night && palettes.day) {
    const kept = {} as Record<Variant, { palette: Palette; surfaces: Surfaces }>;
    for (const variant of ['night', 'day'] as const) {
      const palette = raisePalette(palettes[variant]!, variant);
      const raisedSurfaces = raiseSurfaces(palette.palette, surfaces[variant] ?? {}, variant);
      raised.push(...palette.corrections, ...raisedSurfaces.corrections);
      kept[variant] = { palette: palette.palette, surfaces: raisedSurfaces.surfaces };
    }
    const given = (path: string) => {
      const [variant, kind, key, part] = path.split('.');
      if (kind === 'palette') return true;
      return !!(surfaces[variant as Variant]?.[key as keyof Surfaces] as Record<string, string> | undefined)?.[part];
    };
    for (const c of raised.filter((r) => given(r.path))) {
      warn('THEME_CONTRAST', c.path.replace(/^(night|day)\./, 'variants.$1.'), `${c.given} reaches ${c.ratio}:1 where ${c.required}:1 is required: the platform would raise it to ${c.raised}`, { suggested: c.raised, ratio: c.ratio, required: c.required });
    }
    // 7. The opacities, on the colors kept: the text scrims, or with a whole-surface
    // backdrop the surface opacities raised (a warning for one the theme gives).
    if (!problems.some((p) => p.code === 'THEME_OPACITY_INVALID' || p.code === 'THEME_TEXT_BACKDROP_INVALID')) {
      const images = isObject(doc.images) ? doc.images : {};
      const imageSlots = v2 ? slotsOf(doc.imageSlots) : slotsOf({ page: images.background, pageHeader: images.banner, cardTexture: images.texture });
      opacity = planOpacities({ variants: kept, surfaceOpacity: doc.surfaceOpacity as number | undefined, textBackdrop: doc.textBackdrop as string | undefined, imageSlots });
      for (const r of opacity.raised.filter((x) => x.told)) {
        warn('THEME_OPACITY_RAISED', `variants.${r.variant}.surfaces.${r.surface}.opacity`, `With a whole-surface backdrop, ${r.from} is too transparent for the text over what lies under it: the platform would raise it to ${r.to}`, { opacity: r.to });
      }
    }
  }
  return report(String(format), doc, images, unused);
}
