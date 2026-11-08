// `theme check`: a theme document (format 2, or 1) and its image files checked offline as the platform checks
// them at publication (specs v99.0.0, D-293: contracts/themes.md § Since v99.0.0, § Validation at publication;
// features/cli/offline-theme-tools.feature), plus what the studio checks at the import (each image named by
// the JSON matched with a file). The structure is the JSON Schema of the design system
// (design/schemas/theme-v2.schema.json) and the theme is read as the apps draw it by its shared library
// (design/lib/theme readTheme): four families of theme surfaces (page, sky, block, control), the former theme
// surfaces read into their family, deprecated and told; the radii fixed by the platform (surfaceRadius, shape,
// border ignored, never refused); typography.accent ignored; the image slots page and pageHeader only; the
// readability mask computed (images read as black and white offline). The contrast is raised by the platform,
// not refused: each color it would raise is a warning with the color it would keep (an error with --strict).
// The report is JSON for hooks.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { AA_LARGE, AA_TEXT, PALETTE_KEYS, dimOf, raiseFamilies, raisePalette, type Correction, type Family, type Palette, type Resolved, type Variant } from './contrast.js';
import { MASK, THEME_SCHEMA, maskOpacity, readTheme } from './design.js';
import { imageInfo } from './images.js';
import { validateJsonSchema } from './json-schema.js';
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
/** How the image of the slot page shows (the block appearance, contracts/themes.md § Since v99.0.0): subtle without it. */
export const IMAGE_SHOWS = ['none', 'subtle', 'through'] as const;
export type ImageShows = (typeof IMAGE_SHOWS)[number];
/** The keys withdrawn from the apps since v96.0.0 that the schema of the design system no longer names: still published, ignored. */
const WITHDRAWN_TOP = ['surfaceOpacity', 'textBackdrop'];
/** The ratio and the size the prompt asks for each image slot read (the theme prompt): a warning when far from it. */
export const SLOT_SIZES: Partial<Record<string, { ratio: number; label: string }>> = {
  page: { ratio: 4 / 3, label: '4:3, 2400 × 1800' }, pageHeader: { ratio: 3, label: '3:1, at least 1500 × 500' },
};
/** The text of THEME_SCRIMS_COMPUTED. */
export const SCRIMS_COMPUTED = 'The scrims and the text scrims of a theme are computed by the social platform';

export type Severity = 'error' | 'warning';
export type Problem = { code: string; severity: Severity; path: string; message: string; suggested?: string; ratio?: number; required?: number };
/** An image named by a document; [read]: in a slot the platform reads (page, pageHeader; format 1: background, banner; the wordmark and the pattern), false in a slot ignored since v99.0.0. */
export type ImageRef = { place: string; variant?: 'day' | 'night'; ref: string; read: boolean };
export type ImageReport = ImageRef & { file?: string; type?: string; width?: number; height?: number; bytes?: number };
/** The readability mask as the platform would compute it per display mode (scrims.mask), with how the image shows. */
export type MaskReport = { imageShows: ImageShows; night: number; dim: number; day: number; offline: true };
export type CheckReport = {
  ok: boolean; file: string; format: string; name?: string; universe?: string;
  errors: number; warnings: number; problems: Problem[]; images: ImageReport[]; unusedFiles: string[]; strict: boolean;
  /** Every color the platform would raise, those the theme derives from its palette included (only the ones it gives are warnings). */
  raised: Correction[];
  /** The four families per variant as the platform would draw them (the colors kept), and the key each was read from. */
  families?: Record<Variant, Resolved>;
  readFrom?: Record<Variant, Partial<Record<Family, string>>>;
  /** What the platform ignores (design/lib/theme readTheme), as paths. */
  ignored: string[];
  mask?: MaskReport;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Whether a reference of an image names a file ("page-day.jpg"), not an upload id. */
export const isFileReference = (ref: string) => /\.[A-Za-z0-9]{2,5}$/.test(ref.trim());

/** Whether a theme name follows the rule (2 to 64 letters, digits, "-", "_", "."; a letter first; no ".." nor a final "."). */
export function validThemeName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const n = name.trim().normalize('NFC');
  const length = [...n].length;
  return length >= 2 && length <= 64 && /^[\p{L}\p{M}\p{Nd}._-]+$/u.test(n) && /^\p{L}/u.test(n) && !n.includes('..') && !n.endsWith('.');
}

const READ_PLACES = new Set(['page', 'pageHeader', 'background', 'banner', 'wordmark', 'pattern']);
/** The image references of a document (format 2: the image slots, the wordmark, the pattern; format 1: banner, background, texture too). */
export function imageRefs(doc: Record<string, unknown>): ImageRef[] {
  const out: ImageRef[] = [];
  const slotRefs = (place: string, value: unknown) => {
    const read = READ_PLACES.has(place);
    if (typeof value === 'string' && value) out.push({ place, variant: 'day', ref: value, read });
    else if (isObject(value)) for (const variant of ['day', 'night'] as const) if (typeof value[variant] === 'string' && value[variant]) out.push({ place, variant, ref: value[variant] as string, read });
  };
  const slots = isObject(doc.imageSlots) ? doc.imageSlots : {};
  for (const [place, value] of Object.entries(slots)) slotRefs(place, value);
  const images = isObject(doc.images) ? doc.images : {};
  for (const [place, value] of Object.entries(images)) {
    if (place === 'wordmark' || place === 'pattern') { if (typeof value === 'string' && value) out.push({ place, ref: value, read: true }); } else slotRefs(place, value);
  }
  return out;
}
/** The path of an image reference in its document. */
export const refPath = (doc: Record<string, unknown>, ref: ImageRef) => (ref.variant ? `${isObject(doc.imageSlots) && ref.place in doc.imageSlots ? 'imageSlots' : 'images'}.${ref.place}.${ref.variant}` : `images.${ref.place}`);
/** [doc] without the images of the slots the platform ignores (what theme publish sends): the paths removed. */
export function withoutIgnoredImages(doc: Record<string, unknown>): { doc: Record<string, unknown>; removed: string[] } {
  const next = structuredClone(doc);
  const removed: string[] = [];
  for (const key of ['imageSlots', 'images'] as const) {
    const slots = next[key];
    if (!isObject(slots)) continue;
    for (const place of Object.keys(slots)) if (!READ_PLACES.has(place) && slots[place] != null) { delete slots[place]; removed.push(`${key}.${place}`); }
  }
  return { doc: next, removed };
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

/** The error code of the publication for a problem of the JSON Schema of the design system. */
function codeOf(path: string, keyword: string, value: unknown): string {
  if (/^variants\.(night|day)\.surfaces\.[^.]+$/.test(path) && keyword === 'additionalProperties') return 'THEME_SURFACE_UNKNOWN';
  if (/^imageSlots\.[^.]+$/.test(path) && keyword === 'additionalProperties') return 'THEME_IMAGE_SLOT_UNKNOWN';
  if (/^typography\.(body|text)$/.test(path)) return 'THEME_BODY_TYPEFACE';
  if (/^(imageSlots|images)\./.test(path) && keyword !== 'additionalProperties' && /[A-Za-z][A-Za-z0-9+.-]*:|[/\\]/.test(typeof value === 'string' ? value : JSON.stringify(Object.values(value ?? {})))) return 'THEME_EXTERNAL_RESOURCE';
  if (/^variants\.(night|day)$/.test(path) && keyword === 'required') return 'THEME_VARIANT_MISSING';
  if (/\.(background|text|secondaryText|border|surface|primary|accent|link)$/.test(path) && keyword === 'pattern') return 'THEME_PALETTE_INVALID';
  if (path === 'name') return 'THEME_NAME_INVALID';
  if (path === 'universe') return 'THEME_UNIVERSE_INVALID';
  if (path === 'description') return 'THEME_DESCRIPTION_TOO_LONG';
  if (path.startsWith('gradient')) return 'THEME_GRADIENT_INVALID';
  return 'THEME_FORMAT_INVALID';
}
const valueAt = (doc: unknown, path: string) => path.split('.').reduce<unknown>((o, k) => (isObject(o) ? o[k] : undefined), doc);

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
  let ignored: string[] = [];
  let families: CheckReport['families'];
  let readFrom: CheckReport['readFrom'];
  let mask: MaskReport | undefined;
  const report = (format: string, doc?: Record<string, unknown>, images: ImageReport[] = [], unused: string[] = []): CheckReport => {
    const finalProblems = strict ? problems.map((p) => ({ ...p, severity: 'error' as const })) : problems;
    const errors = finalProblems.filter((p) => p.severity === 'error').length;
    return {
      ok: errors === 0, file, format, ...(typeof doc?.name === 'string' ? { name: doc.name } : {}), ...(typeof doc?.universe === 'string' ? { universe: doc.universe } : {}),
      errors, warnings: finalProblems.length - errors, problems: finalProblems, images, unusedFiles: unused, strict, raised, ignored,
      ...(families ? { families, readFrom } : {}), ...(mask ? { mask } : {}),
    };
  };

  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { error('THEME_FORMAT_INVALID', '$', `Not JSON: ${(e as Error).message}`); return report('unknown'); }
  if (!isObject(raw)) { error('THEME_FORMAT_INVALID', '$', 'A theme is a JSON object'); return report('unknown'); }
  const doc = raw;

  // 1. The format, the size, what the platform computes.
  if (doc.format === undefined) { warn('THEME_FORMAT_MISSING', 'format', `No "format": read as ${FORMAT_1}; write "${FORMAT_2}"`); doc.format = FORMAT_1; }
  const format = String(doc.format);
  const bytes = new TextEncoder().encode(JSON.stringify(doc)).length;
  if (bytes > THEME_MAX_BYTES) error('THEME_TOO_LARGE', '$', `The document is ${bytes} bytes: at most 64 KB without its images`);
  if (doc.scrims != null) error('THEME_SCRIMS_COMPUTED', 'scrims', `${SCRIMS_COMPUTED} (the readability mask among them): remove "scrims"`);
  if (doc.textScrims != null) error('THEME_SCRIMS_COMPUTED', 'textScrims', `${SCRIMS_COMPUTED}: remove "textScrims"`);
  if (Array.isArray(doc.screenshots) && doc.screenshots.length) error('THEME_SCREENSHOTS_GENERATED', 'screenshots', 'The screenshots are generated by the platform: remove "screenshots"');
  for (const key of ['creator', 'version', 'copiedFrom']) if (doc[key] != null) warn('THEME_KEY_SET_BY_PLATFORM', key, `"${key}" is set by the platform: it is ignored or replaced at publication`);
  for (const key of ['density', 'motion', 'sounds']) if (doc[key] != null) warn('THEME_PERSONAL_SETTING', key, `"${key}" is a setting of a personal theme only`);

  // 2. What the schema of the design system no longer names but the platform still publishes (expand then contract, D-203):
  // the opacities and the text backdrop (withdrawn since v96.0.0), told and left aside; the block appearance and its imageShows.
  const structural = structuredClone(doc);
  delete structural.scrims; delete structural.textScrims; delete structural.screenshots;
  for (const key of WITHDRAWN_TOP) if (key in structural) { warn('THEME_KEY_IGNORED', key, `"${key}" is withdrawn since specs v96.0.0: the platform draws every theme surface opaque and ignores it`); delete structural[key]; }
  for (const variant of ['night', 'day']) {
    const surfaces = valueAt(structural, `variants.${variant}.surfaces`);
    if (isObject(surfaces)) for (const [key, colors] of Object.entries(surfaces)) if (isObject(colors) && 'opacity' in colors) { warn('THEME_KEY_IGNORED', `variants.${variant}.surfaces.${key}.opacity`, 'A theme sets no opacity since specs v96.0.0: ignored'); delete colors.opacity; }
  }
  let imageShows: ImageShows = 'subtle';
  if (structural.appearance !== undefined) {
    const appearance = structural.appearance;
    delete structural.appearance;
    if (!isObject(appearance)) error('THEME_FORMAT_INVALID', 'appearance', 'The block appearance is an object');
    else if (appearance.imageShows !== undefined) {
      if ((IMAGE_SHOWS as readonly unknown[]).includes(appearance.imageShows)) imageShows = appearance.imageShows as ImageShows;
      else error('THEME_FORMAT_INVALID', 'appearance.imageShows', `How the image of the page shows: ${IMAGE_SHOWS.join(', ')}`);
    } else if (appearance.ground === false) imageShows = 'none';
  }

  // 3. The structure: the JSON Schema of the design system, its problems with the codes of the publication.
  const checked = validateJsonSchema(THEME_SCHEMA, structural);
  const MESSAGES: Record<string, string> = { THEME_SURFACE_UNKNOWN: 'is not a theme surface (page, sky, block, control)', THEME_IMAGE_SLOT_UNKNOWN: 'is not an image slot (page, pageHeader)', THEME_BODY_TYPEFACE: 'No typeface for the body text: it stays the readable typeface of Socle' };
  for (const p of checked.problems) {
    const code = codeOf(p.path, p.keyword, valueAt(structural, p.path));
    const key = p.path.split('.').pop();
    error(code, p.path || '$', code === 'THEME_EXTERNAL_RESOURCE' ? 'An image is a file name (to send) or an upload id of the platform, never a URL nor a path' : code in MESSAGES ? (code === 'THEME_BODY_TYPEFACE' ? MESSAGES[code] : `"${key}" ${MESSAGES[code]}`) : `${p.path || 'the document'} ${p.message}`);
  }
  if (doc.format !== FORMAT_1 && doc.format !== FORMAT_2) return report(format, doc);

  // 4. The theme read as the apps draw it (design/lib/theme): the families, what is ignored.
  const read = readTheme(structural);
  ignored = read.ignored;
  for (const path of read.ignored) warn('THEME_KEY_IGNORED', path.replace(/ \(.*\)$/, ''), `Ignored since specs v99.0.0 (the platform no longer draws it)${/\((.*)\)$/.exec(path)?.[1] ? `: ${/\((.*)\)$/.exec(path)![1]}` : ''}`);
  for (const variant of ['night', 'day'] as const) {
    for (const [family, key] of Object.entries(read.variants[variant].readFrom)) {
      if (key !== family) warn('THEME_SURFACE_DEPRECATED', `variants.${variant}.surfaces.${key}`, `"${key}" is deprecated since specs v99.0.0: read as the family "${family}"; write "${family}"`);
    }
  }

  // 5. The palettes (a universe theme gives all six colors), the field, the typefaces, the gradient.
  const palettes: Partial<Record<Variant, Palette>> = {};
  for (const variant of ['night', 'day'] as const) {
    const p = read.variants[variant].palette;
    const missing = PALETTE_KEYS.filter((k) => typeof p[k] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(p[k]));
    for (const k of missing) if (!problems.some((x) => x.path === `variants.${variant}.palette.${k}`)) error('THEME_PALETTE_INVALID', `variants.${variant}.palette.${k}`, 'A color of the palette is #RRGGBB (a universe theme gives the six)');
    if (!missing.length) palettes[variant] = Object.fromEntries(PALETTE_KEYS.map((k) => [k, p[k].toUpperCase()])) as Palette;
  }
  if (doc.collection != null && doc.collection !== '' && !(typeof doc.collection === 'string' && (FIELDS as readonly string[]).includes(doc.collection.trim().toUpperCase()))) {
    error('THEME_FIELD_INVALID', 'collection', `The field is one of ${FIELDS.join(', ')}, or none`);
  }
  const title = isObject(doc.typography) ? doc.typography.title : undefined;
  if (title == null) error('THEME_TYPEFACE_NOT_APPROVED', 'typography.title', 'The title typeface is required, from the approved list (breakrocks theme typefaces)');
  else if (typeof title === 'string' && /^[a-z][a-z0-9+.-]*:|\//i.test(title)) error('THEME_EXTERNAL_RESOURCE', 'typography.title', 'A typeface comes from the approved list, never from elsewhere');
  else if (!approvedTypeface(title)) error('THEME_TYPEFACE_NOT_APPROVED', 'typography.title', `"${String(title)}" is not an approved typeface (breakrocks theme typefaces)`);
  if (Array.isArray(doc.gradient) && palettes.night && palettes.day) {
    const colors = new Set(Object.values(palettes).flatMap((p) => Object.values(p!)));
    if (doc.gradient.some((c) => typeof c !== 'string' || !colors.has(c.toUpperCase()))) error('THEME_GRADIENT_INVALID', 'gradient', 'The accent gradient has 2 or 3 colors of the palette');
  }

  // 6. The images: references, files; the slots ignored since v99.0.0 are told (and left out by theme publish).
  const refs = imageRefs(doc);
  const kept = refs.filter((r) => r.read);
  if (kept.length > IMAGES_MAX) error('THEME_IMAGES_LIMIT', 'imageSlots', `${kept.length} images: at most ${IMAGES_MAX}, night variants, wordmark and pattern counted`);
  const files = given.length ? [...given] : imagesBeside(file);
  const used = new Set<string>();
  const images: ImageReport[] = [];
  for (const ref of refs) {
    const path = refPath(doc, ref);
    if (!ref.read || !isFileReference(ref.ref) || problems.some((p) => p.code === 'THEME_EXTERNAL_RESOURCE' && path.startsWith(p.path))) { images.push(ref); continue; }
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
    const expected = SLOT_SIZES[ref.place === 'background' ? 'page' : ref.place];
    if (!isBanner && expected && ratio && Math.abs(ratio - expected.ratio) / expected.ratio > 0.1) warn('IMAGE_RATIO_UNUSUAL', path, `${info.width} × ${info.height}: this slot expects ${expected.label}`);
  }
  const unused = given.filter((f) => !used.has(f));
  for (const f of unused) warn('IMAGE_FILE_UNUSED', f, 'No reference of the theme read by the platform names this file');

  // 7. The contrast, as the platform raises it: a warning for each color the theme gives (a palette color, a color of
  // a family it sets, or of the former theme surface it was read from); the colors it derives are raised silently.
  if (palettes.night && palettes.day) {
    families = {} as Record<Variant, Resolved>;
    readFrom = {} as NonNullable<CheckReport['readFrom']>;
    for (const variant of ['night', 'day'] as const) {
      const palette = raisePalette(palettes[variant]!, variant);
      const fam = raiseFamilies(palette.palette, read.variants[variant].families, variant);
      raised.push(...palette.corrections, ...fam.corrections);
      families[variant] = fam.resolved;
      readFrom[variant] = read.variants[variant].readFrom;
    }
    for (const c of raised) {
      const [variant, kind, key, part] = c.path.split('.');
      if (kind === 'palette') { warn('THEME_CONTRAST', `variants.${variant}.palette.${key}`, contrastMessage(c), contrastExtra(c)); continue; }
      const from = read.variants[variant as Variant].readFrom[key as Family];
      if (from && (read.variants[variant as Variant].families[key as Family] as Record<string, string> | undefined)?.[part]) warn('THEME_CONTRAST', `variants.${variant}.surfaces.${from}.${part}`, contrastMessage(c), contrastExtra(c));
    }
    // 8. The readability mask over the image of the page (scrims.mask), as the platform would compute it: the image read
    // as black and white offline (its tones are unknown), never under the floor of the design tokens.
    const page = refs.find((r) => r.read && (r.place === 'page' || r.place === 'background'));
    if (page && imageShows !== 'none') {
      const of = (mode: 'night' | 'dim' | 'day') => {
        const f = families![mode === 'day' ? 'day' : 'night'];
        const lift = (hex: string) => (mode === 'dim' ? dimOf(hex) : hex);
        return maskOpacity({ page: lift(f.page.background), texts: [{ color: f.page.text, min: AA_TEXT }, { color: f.page.secondaryText, min: AA_TEXT }, { color: f.control.background, min: AA_LARGE }], pixels: [[0, 0, 0], [255, 255, 255]], floor: MASK[mode].floor });
      };
      mask = { imageShows, night: of('night'), dim: of('dim'), day: of('day'), offline: true };
    }
  }
  return report(format, doc, images, unused);
}

const contrastMessage = (c: Correction) => `${c.given} reaches ${c.ratio}:1 where ${c.required}:1 is required: the platform would raise it to ${c.raised}`;
const contrastExtra = (c: Correction) => ({ suggested: c.raised, ratio: c.ratio, required: c.required });
