// theme prompt, check, pack, unpack, typefaces: offline, but
// `theme typefaces --online` (approvedTypefaces).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { cliRefusal, usageError } from '../errors.js';
import type { Command } from '../registry.js';
import { bool, int, list, object, openObject, str } from '../schema.js';
import { api } from '../session.js';
import { FIELDS, IMAGE_SHOWS, SKIES, checkTheme, fileFor, imageRefs, imagesBeside, isFileReference, type CheckReport } from '../theme/check.js';
import { LANGUAGES, themePrompt, type PromptResult } from '../theme/prompt.js';
import { APPROVED_TYPEFACES } from '../theme/typefaces.js';
import { documentOf, isZipName, openArchive } from '../theme/bundle.js';
import { isSystemFile, readZip, writeZip, zipEntryBytes } from '../theme/zip.js';

const at = (cwd: string, path: string) => resolve(cwd, path);
function readText(path: string): string {
  if (!existsSync(path) || !statSync(path).isFile()) throw usageError('FILE_NOT_FOUND', `No file ${path}`, { path });
  return readFileSync(path, 'utf8');
}
/** The image files of [paths]: files as they are, folders by their images (not recursive). */
function imageFiles(cwd: string, paths: readonly string[] = []): string[] {
  return paths.flatMap((p) => {
    const full = at(cwd, p);
    if (!existsSync(full)) throw usageError('FILE_NOT_FOUND', `No file or folder ${p}`, { path: p });
    if (statSync(full).isDirectory()) return readdirSync(full).filter((n) => /\.(jpe?g|png|webp|gif|heic|avif)$/i.test(n) && !isSystemFile(n)).map((n) => join(full, n));
    return [full];
  });
}

export const themePromptCommand: Command<{ field?: string; mood?: string; name?: string; universe?: string; description?: string; fonts?: string[]; language?: 'en' | 'fr'; universal?: boolean; template?: boolean; imageShows?: string; sky?: string }, PromptResult> = {
  name: 'theme prompt', summary: 'Write the prompt that asks an AI for a theme (theme.json and the list of its images), in the format the platform accepts today (specs v122)',
  description: 'The theme prompt of the platform filled: the field, the mood, the name, the universe, the approved typefaces, the four families of theme surfaces (page, sky, block, control: background, text, secondaryText), the contrast AA, one title typeface, the image slots page and pageHeader with their day and night variants (4 images: the size of each, what it shows, what lies over it), the block appearance (its accent, how the image of the page shows: none, subtle or through, the sky column or band), pageImageOnPhone, the scrims and the readability mask the platform computes; no radius, no border, no opacity, no accent typeface, no text backdrop. --universal: the prompt of a universal theme (no field, the palette and the typeface of Socle, its own rules; the universe %root by default). --template: the fields to fill left as <…>. Give it to an AI that writes text and images; then theme check, theme pack and theme publish.',
  examples: ['breakrocks look themes prompt --field sport --mood "stadium at night under the floodlights" --name stade-nuit --universe %football', 'breakrocks look themes prompt --field culture --mood "a museum with white walls" --name musee-blanc --universe %paris --fonts "Playfair Display" --language fr', 'breakrocks look themes prompt --field games --mood "neon arcade" --name arcade --universe %gaming --image-shows through --sky band', 'breakrocks look themes prompt --universal --mood "an open sky above a low horizon" --name universel-ciel --language fr', 'breakrocks look themes prompt --template --language fr'],
  input: object({
    field: str(`The field: ${FIELDS.join(', ')} (or its word: sport, politique…); none with --universal`),
    mood: str('The mood, in a few words (with --universal: the scene and the identity)', { minLength: 1, maxLength: 500 }),
    name: str('The name of the theme (2 to 64 letters, digits, "-", "_", "."; a letter first)'),
    universe: str('The universe it will be published in (%name; %root by default with --universal)', { pattern: '^%\\S+$' }),
    description: str('Its description (160 characters at most)', { maxLength: 160 }),
    fonts: list('The title typeface, from the approved list (Montserrat with --universal)', { type: 'string' }, { maxItems: 1 }),
    language: str('The language of the prompt', { enum: LANGUAGES, default: 'en' }),
    universal: bool('The prompt of a universal theme: no field, the palette and the typeface of Socle'),
    template: bool('Leave the fields not given as <…> to fill (field, mood, name, universe, description, typeface)'),
    imageShows: str('How the image of the page shows (appearance.imageShows)', { enum: IMAGE_SHOWS, default: 'subtle' }),
    sky: str('The sky of the universe (appearance.sky): the sky column or the sky band', { enum: SKIES, default: 'column' }),
  }),
  output: openObject({ prompt: str('The prompt'), language: str('Its language'), field: str('The field (null with --universal or a template)'), name: str('The theme name'), universe: str('The universe'), fonts: list('The typeface asked'), universal: bool('A universal theme'), template: bool('Fields left to fill'), imageShows: str('How the image of the page shows'), sky: str('The sky') }),
  offline: true,
  run: (_ctx, input) => themePrompt(input),
  text: (r) => r.prompt,
};

export const themeCheck: Command<{ file: string; images?: string[]; strict?: boolean }, CheckReport> = {
  name: 'theme check', summary: 'Check a theme and its images (or its ZIP archive) as the platform does at publication (offline; specs v122)',
  description: 'The structure by the JSON Schema of the design system (design-lib/schemas/theme-v2.schema.json) and the theme read as the apps draw it by its shared library (design-lib/lib/theme): format 2 (or 1), size (64 KB), name, the four families of theme surfaces page, sky, block and control (a former theme surface is read into its family and told deprecated, THEME_SURFACE_DEPRECATED; any other key THEME_SURFACE_UNKNOWN), the palettes, the title typeface (approved list; typography.accent ignored), gradient, the image slots page and pageHeader (timeColumn, channelHeader, cardTexture ignored), at most 8 images of at most 5 MB, the banner expected 3:1 and at least 1500 × 500 (a warning), the wordmark PNG/WebP at most 1 MB and 6:1. Never refused, ignored and told (THEME_KEY_IGNORED): the radii (surfaceRadius, shape), the border of a theme surface, the opacities and the text backdrop. "scrims" (the readability mask among them), "textScrims" and "screenshots" are refused (computed by the platform). The contrast AA (4.5:1 text, 3:1 large text and controls) in the night, dim and day modes, each color the platform would raise told with the color it would keep; the readability mask over the image of the page (appearance.imageShows none, subtle or through; subtle without it) computed as the platform does, the image read as black and white offline. The block appearance read as the platform keeps it: without "accent" (#RRGGBB) the whole block is left out (THEME_APPEARANCE_IGNORED); imageShows none, subtle or through, else read from "ground" (THEME_IMAGE_SHOWS_READ); sky column or band; pageImageOnPhone true or false; a key unknown at the top of the document is left out at publication (THEME_KEY_IGNORED), not refused. An image of the page under 2160 × 1620 is told (IMAGE_SMALL). Without image files, the images beside the JSON. A .zip in place of the JSON: the archive of a theme as the import of the apps reads it (theme.json, else its only JSON; its images by their names). Exit 1 when it finds an error (warnings too with --strict): usable as a hook.',
  examples: ['breakrocks look themes check theme.json', 'breakrocks look themes check theme.json images/ --json', 'breakrocks look themes check theme.json page-day.jpg page-night.jpg --strict', 'breakrocks look themes check stade-nuit.zip'],
  input: object({ file: str('The theme document (JSON), or its archive (.zip)'), images: list('Its image files, or folders of images'), strict: bool('Count the warnings (contrast raised, unusual sizes, keys ignored) as errors') }, ['file']),
  output: openObject({
    ok: bool('No error'), file: str('The document'), format: str('Its format'), errors: int('Errors'), warnings: int('Warnings'),
    problems: list('Each problem', openObject({ code: str('Its code (a platform code, or the CLI\'s)'), severity: str('error or warning', { enum: ['error', 'warning'] }), path: str('Where, in the document'), message: str('What'), suggested: str('The color the platform would keep') })),
    images: list('Each image named', openObject({ place: str('Its slot'), variant: str('day or night'), ref: str('Its reference'), read: bool('In a slot the platform reads'), file: str('Its file'), type: str('Its type'), width: int('Width'), height: int('Height'), bytes: int('Size') })),
    unusedFiles: list('Image files that no reference names'),
    raised: list('Every color the platform would raise', openObject({ path: str('Where'), given: str('The color given'), raised: str('The color kept') })),
    families: openObject({}, 'The four families (page, sky, block, control) per variant, with the colors kept'), readFrom: openObject({}, 'The key each family was read from, per variant'),
    ignored: list('What the platform ignores, as paths'),
    mask: openObject({ imageShows: str('none, subtle or through'), night: { type: 'number' }, dim: { type: 'number' }, day: { type: 'number' } }, 'The readability mask (scrims.mask) as the platform would compute it, the image read as black and white'),
    appearance: openObject({ kept: bool('False when the platform leaves the block out (no accent)'), imageShows: str('none, subtle or through, as read'), sky: str('column or band'), layout: str('feed-first, village-square or hud'), character: str('The appearance character') }, 'The block appearance as the platform keeps it'),
  }),
  args: { positionals: ['file', 'images'] }, offline: true,
  run: (ctx, { file, images, strict }) => {
    const path = at(ctx.io.cwd, file);
    if (!isZipName(path)) return checkTheme(path, readText(path), imageFiles(ctx.io.cwd, images), !!strict);
    // The archive of a theme, as the import of the apps reads it: its theme document and its images.
    if (!existsSync(path)) throw usageError('FILE_NOT_FOUND', `No file ${file}`, { path: file });
    const archive = openArchive(path);
    try {
      const report = checkTheme(archive.document, readText(archive.document), [...archive.images, ...imageFiles(ctx.io.cwd, images)], !!strict);
      return { ...report, file: path, images: report.images.map((i) => (i.file ? { ...i, file: basename(i.file) } : i)), unusedFiles: report.unusedFiles.map((f) => basename(f)) };
    } finally { archive.close(); }
  },
  exitCode: (r) => (r.ok ? 0 : 1),
  text: (r) => [
    `${r.file}: ${r.format}${r.name ? `, "${r.name}"` : ''}: ${r.ok ? 'OK' : 'refused'} (${r.errors} error(s), ${r.warnings} warning(s))`,
    ...r.problems.map((p) => `  ${p.severity === 'error' ? 'error  ' : 'warning'} ${p.code}  ${p.path}: ${p.message}`),
    ...r.images.filter((i) => i.file).map((i) => `  image   ${i.place}${i.variant ? `.${i.variant}` : ''}: ${basename(i.file!)} ${i.type ?? '?'} ${i.width ?? '?'}×${i.height ?? '?'} ${i.bytes} bytes`),
    ...(r.families ? (['night', 'day'] as const).map((v) => `  ${v.padEnd(7)} ${(['page', 'sky', 'block', 'control'] as const).map((f) => `${f} ${r.families![v][f].background}/${r.families![v][f].text}`).join(', ')}`) : []),
    ...(r.appearance ? [`  appearance ${r.appearance.kept ? `imageShows ${r.appearance.imageShows}, sky ${r.appearance.sky}${r.appearance.layout ? `, layout ${r.appearance.layout}` : ''}` : 'left out by the platform'}`] : []),
    ...(r.mask ? [`  mask    ${r.mask.imageShows}: night ${r.mask.night}, dim ${r.mask.dim}, day ${r.mask.day} (the image read as black and white)`] : []),
  ].join('\n'),
};

type PackResult = { out: string; bytes: number; entries: { path: string; bytes: number }[]; missing: string[]; check: { ok: boolean; errors: number; warnings: number } };

export const themePack: Command<{ file: string; images?: string[]; out?: string; force?: boolean; allowMissing?: boolean; allowInvalid?: boolean }, PackResult> = {
  name: 'theme pack', summary: 'Pack a theme and its images in a ZIP: the archive the import of the apps and theme publish read',
  description: 'theme check first: a theme the platform would refuse is not packed (THEME_CHECK_FAILED), unless --allow-invalid. The archive holds theme.json (the document as it is, byte for byte, deflated) and each image the JSON names (its file found among those given, else beside the JSON), stored under the name the JSON gives it, so that the import matches them; at most 50 MB (ZIP_TOO_LARGE). A reference without its file refuses the archive, unless --allow-missing. theme publish <archive>.zip and theme check <archive>.zip read it.',
  examples: ['breakrocks look themes pack theme.json --out stade-nuit.zip', 'breakrocks look themes pack theme.json images/ --out stade-nuit.zip --force'],
  input: object({
    file: str('The theme document (JSON)'), images: list('Its image files, or folders of images'), out: str('The archive to write (default: <name>.zip)'),
    force: bool('Replace the archive if it exists'), allowMissing: bool('Pack even when an image named by the JSON has no file'), allowInvalid: bool('Pack even when theme check finds an error'),
  }, ['file']),
  output: openObject({ out: str('The archive'), bytes: int('Its size'), entries: list('Its files', openObject({ path: str('Name'), bytes: int('Size') })), missing: list('References without a file'), check: openObject({ ok: bool('No error'), errors: int('Errors'), warnings: int('Warnings') }, 'The result of theme check') }),
  args: { positionals: ['file', 'images'] }, offline: true,
  run: (ctx, { file, images, out, force, allowMissing, allowInvalid }) => {
    const path = at(ctx.io.cwd, file);
    const text = readText(path);
    let doc: Record<string, unknown>;
    try { doc = JSON.parse(text); } catch { throw usageError('THEME_FORMAT_INVALID', `${file} is not JSON`); }
    const given = imageFiles(ctx.io.cwd, images);
    const files = given.length ? given : imagesBeside(path);
    const report = checkTheme(path, text, given);
    const refused = report.problems.filter((p) => p.severity === 'error' && p.code !== 'IMAGE_FILE_MISSING');
    if (refused.length && !allowInvalid) throw cliRefusal('THEME_CHECK_FAILED', `${refused.length} error(s): ${refused.map((p) => `${p.code} ${p.path}`).join(', ')} (theme check; --allow-invalid to pack it anyway)`, { problems: refused });
    const entries: { path: string; bytes: Uint8Array; deflate?: boolean }[] = [{ path: 'theme.json', bytes: new TextEncoder().encode(text), deflate: true }];
    const missing: string[] = [];
    for (const ref of imageRefs(doc).filter((r) => isFileReference(r.ref))) {
      const found = fileFor(ref.ref, files);
      if (!found) { missing.push(ref.ref); continue; }
      const name = basename(found);
      if (!entries.some((e) => e.path.toLowerCase() === name.toLowerCase())) entries.push({ path: name, bytes: new Uint8Array(readFileSync(found)) });
    }
    if (missing.length && !allowMissing) throw cliRefusal('IMAGE_FILE_MISSING', `No file for ${missing.join(', ')}: give them, or --allow-missing`, { missing });
    const target = at(ctx.io.cwd, out ?? `${typeof doc.name === 'string' && doc.name ? doc.name : basename(file).replace(/\.json$/i, '')}.zip`);
    if (existsSync(target) && !force) throw usageError('FILE_EXISTS', `${target} exists: --force to replace it`, { path: target });
    const zip = writeZip(entries);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, zip);
    return { out: target, bytes: zip.length, entries: entries.map((e) => ({ path: e.path, bytes: e.bytes.length })), missing, check: { ok: report.ok, errors: report.errors, warnings: report.warnings } };
  },
  text: (r) => [`${r.out} (${r.bytes} bytes; theme check: ${r.check.errors} error(s), ${r.check.warnings} warning(s))`, ...r.entries.map((e) => `  ${e.path}  ${e.bytes} bytes`), ...(r.missing.length ? [`missing: ${r.missing.join(', ')}`] : [])].join('\n'),
  quiet: (r) => r.out,
};

/** A path of an archive made safe to write under a folder: relative, without "..", without a drive. */
export function safeEntryPath(path: string): string[] {
  const parts = path.replaceAll('\\', '/').split('/').filter((p) => p !== '' && p !== '.');
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || parts.some((p) => p === '..') || !parts.length) throw usageError('ZIP_PATH_UNSAFE', `The archive names a path outside its folder: ${path}`, { path });
  return parts;
}

type UnpackResult = { out: string; entries: { path: string; bytes: number }[]; document?: string };

export const themeUnpack: Command<{ archive: string; out?: string; force?: boolean }, UnpackResult> = {
  name: 'theme unpack', summary: 'Unpack the ZIP of a theme (theme export --zip, an export of the apps, or theme pack)',
  examples: ['breakrocks look themes unpack stade-nuit.zip --out stade-nuit/'],
  input: object({ archive: str('The archive (.zip)'), out: str('The folder to write in (default: the name of the archive)'), force: bool('Replace files that exist') }, ['archive']),
  output: openObject({ out: str('The folder'), entries: list('The files written', openObject({ path: str('Path'), bytes: int('Size') })), document: str('The theme document, as the import of the apps chooses it (theme.json, else the only JSON)') }),
  args: { positionals: ['archive'] }, offline: true,
  run: (ctx, { archive, out, force }) => {
    const path = at(ctx.io.cwd, archive);
    if (!existsSync(path)) throw usageError('FILE_NOT_FOUND', `No file ${archive}`, { path: archive });
    const bytes = new Uint8Array(readFileSync(path));
    const entries = readZip(bytes);
    const folder = at(ctx.io.cwd, out ?? basename(archive).replace(/\.zip$/i, ''));
    const plan = entries.map((e) => ({ entry: e, target: join(folder, ...safeEntryPath(e.path)) }));
    if (!force) for (const p of plan) if (existsSync(p.target)) throw usageError('FILE_EXISTS', `${p.target} exists: --force to replace it`, { path: p.target });
    const written: { path: string; bytes: number }[] = [];
    for (const { entry, target } of plan) {
      const data = zipEntryBytes(bytes, entry);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
      written.push({ path: target, bytes: data.length });
    }
    let document: string | undefined;
    try { document = plan.find((p) => p.entry.path === documentOf(entries.map((e) => e.path)))?.target; } catch { /* no theme document: told by its absence */ }
    return { out: folder, entries: written, ...(document ? { document } : {}) };
  },
  text: (r) => [r.out, ...r.entries.map((e) => `  ${e.path}  ${e.bytes} bytes`), ...(r.document ? [`theme document: ${r.document}`] : ['no theme document (theme.json)'])].join('\n'),
  quiet: (r) => r.out,
};

type TypefacesResult = { source: 'shipped' | 'platform'; typefaces: { name: string; category: string; scripts: string[]; license: string }[]; onlyShipped?: string[]; onlyPlatform?: string[] };

export const themeTypefaces: Command<{ online?: boolean }, TypefacesResult> = {
  name: 'theme typefaces', summary: 'List the approved typefaces (shipped; --online: approvedTypefaces, compared)',
  examples: ['breakrocks look themes typefaces', 'breakrocks look themes typefaces --online --json'],
  input: object({ online: bool('Read approvedTypefaces from the API (a session) and compare it with the shipped list') }),
  output: openObject({ source: str('shipped or platform'), typefaces: list('The typefaces', openObject({ name: str('Name'), category: str('Category'), scripts: list('Scripts'), license: str('License') })), onlyShipped: list('Shipped, not approved by the platform'), onlyPlatform: list('Approved by the platform, not shipped: update the CLI') }),
  run: async (ctx, { online }) => {
    if (!online) return { source: 'shipped', typefaces: APPROVED_TYPEFACES.map((f) => ({ ...f })) };
    const data = await api<{ approvedTypefaces: { name: string; category: string; scripts: string[]; license: string }[] }>(ctx, '{ approvedTypefaces { name category scripts license } }');
    const platform = new Set(data.approvedTypefaces.map((f) => f.name));
    const shipped = new Set(APPROVED_TYPEFACES.map((f) => f.name));
    return { source: 'platform', typefaces: data.approvedTypefaces, onlyShipped: [...shipped].filter((n) => !platform.has(n)), onlyPlatform: [...platform].filter((n) => !shipped.has(n)) };
  },
  text: (r) => [...r.typefaces.map((f) => `${f.name.padEnd(20)} ${f.category.padEnd(8)} ${f.scripts.join(', ')}`), ...(r.onlyShipped ? [`only shipped: ${r.onlyShipped.join(', ') || '-'}`, `only on the platform: ${r.onlyPlatform!.join(', ') || '-'}`] : [])].join('\n'),
};
