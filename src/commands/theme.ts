// theme prompt, check, pack, unpack, typefaces: offline, but
// `theme typefaces --online` (approvedTypefaces).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { cliRefusal, usageError } from '../errors.js';
import type { Command } from '../registry.js';
import { bool, int, list, object, openObject, str } from '../schema.js';
import { api } from '../session.js';
import { FIELDS, checkTheme, fileFor, imageRefs, imagesBeside, isFileReference, type CheckReport } from '../theme/check.js';
import { LANGUAGES, themePrompt, type PromptResult } from '../theme/prompt.js';
import { APPROVED_TYPEFACES } from '../theme/typefaces.js';
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

export const themePromptCommand: Command<{ field: string; mood: string; name: string; universe: string; description?: string; fonts?: string[]; language?: 'en' | 'fr' }, PromptResult> = {
  name: 'theme prompt', summary: 'Write the prompt that asks an AI for a theme (theme.json and its images)',
  description: 'The prompt of the theme prompt of the platform filled: the field, the mood, the name, the universe, the approved typefaces and the sizes of the images. Give it to an AI that writes text and images; then theme check, theme pack, and the import of the studio.',
  examples: ['breakrocks theme prompt --field sport --mood "stadium at night under the floodlights" --name stade-nuit --universe %football', 'breakrocks theme prompt --field culture --mood "musée aux murs blancs" --name musee-blanc --universe %paris --fonts "Playfair Display,IBM Plex Mono" --language fr'],
  input: object({
    field: str(`The field: ${FIELDS.join(', ')} (or its word: sport, politique…)`),
    mood: str('The mood, in a few words', { minLength: 1, maxLength: 500 }),
    name: str('The name of the theme (2 to 64 letters, digits, "-", "_", "."; a letter first)'),
    universe: str('The universe it will be published in (%name)', { pattern: '^%\\S+$' }),
    description: str('Its description (160 characters at most)', { maxLength: 160 }),
    fonts: list('The title typeface, then the accent one, from the approved list', { type: 'string' }, { maxItems: 2 }),
    language: str('The language of the prompt', { enum: LANGUAGES, default: 'en' }),
  }, ['field', 'mood', 'name', 'universe']),
  output: openObject({ prompt: str('The prompt'), language: str('Its language'), field: str('The field'), name: str('The theme name'), universe: str('The universe'), fonts: list('The typefaces asked') }),
  offline: true,
  run: (_ctx, input) => themePrompt(input),
  text: (r) => r.prompt,
};

export const themeCheck: Command<{ file: string; images?: string[]; strict?: boolean }, CheckReport> = {
  name: 'theme check', summary: 'Check a theme and its images as the platform does at publication (offline)',
  description: 'Format 2 (or 1), size, name, palettes and theme surfaces, typefaces (approved list), gradient, shape, image slots, at most 8 images of at most 5 MB, the banner expected 3:1 and at least 1500 × 500 (a warning: the platform does not refuse it), the wordmark PNG/WebP at most 1 MB and 6:1; the contrast AA (4.5:1 text, 3:1 large text and controls) in the night, dim and day modes, each color the platform would raise told with the color it would keep. Without image files, the images beside the JSON. Exit 1 when it finds an error (warnings too with --strict): usable as a hook.',
  examples: ['breakrocks theme check theme.json', 'breakrocks theme check theme.json images/ --json', 'breakrocks theme check theme.json page-day.jpg page-night.jpg --strict'],
  input: object({ file: str('The theme document (JSON)'), images: list('Its image files, or folders of images'), strict: bool('Count the warnings (contrast raised, unusual sizes) as errors') }, ['file']),
  output: openObject({
    ok: bool('No error'), file: str('The document'), format: str('Its format'), errors: int('Errors'), warnings: int('Warnings'),
    problems: list('Each problem', openObject({ code: str('Its code (a platform code, or the CLI\'s)'), severity: str('error or warning', { enum: ['error', 'warning'] }), path: str('Where, in the document'), message: str('What'), suggested: str('The color the platform would keep') })),
    images: list('Each image named', openObject({ place: str('Its slot'), variant: str('day or night'), ref: str('Its reference'), file: str('Its file'), type: str('Its type'), width: int('Width'), height: int('Height'), bytes: int('Size') })),
    unusedFiles: list('Image files that no reference names'),
  }),
  args: { positionals: ['file', 'images'] }, offline: true,
  run: (ctx, { file, images, strict }) => {
    const path = at(ctx.io.cwd, file);
    return checkTheme(path, readText(path), imageFiles(ctx.io.cwd, images), !!strict);
  },
  exitCode: (r) => (r.ok ? 0 : 1),
  text: (r) => [
    `${r.file}: ${r.format}${r.name ? `, "${r.name}"` : ''}: ${r.ok ? 'OK' : 'refused'} (${r.errors} error(s), ${r.warnings} warning(s))`,
    ...r.problems.map((p) => `  ${p.severity === 'error' ? 'error  ' : 'warning'} ${p.code}  ${p.path}: ${p.message}`),
    ...r.images.filter((i) => i.file).map((i) => `  image   ${i.place}${i.variant ? `.${i.variant}` : ''}: ${basename(i.file!)} ${i.type ?? '?'} ${i.width ?? '?'}×${i.height ?? '?'} ${i.bytes} bytes`),
  ].join('\n'),
};

type PackResult = { out: string; bytes: number; entries: { path: string; bytes: number }[]; missing: string[] };

export const themePack: Command<{ file: string; images?: string[]; out?: string; force?: boolean; allowMissing?: boolean }, PackResult> = {
  name: 'theme pack', summary: 'Pack a theme and its images in a ZIP for the import of the studio',
  description: 'The archive holds theme.json and each image the JSON names (its file found among those given, else beside the JSON), named as referenced, so that the studio matches them (Appearance › Import). A reference without its file refuses the archive, unless --allow-missing.',
  examples: ['breakrocks theme pack theme.json --out stade-nuit.zip', 'breakrocks theme pack theme.json images/ --out stade-nuit.zip --force'],
  input: object({
    file: str('The theme document (JSON)'), images: list('Its image files, or folders of images'), out: str('The archive to write (default: <name>.zip)'),
    force: bool('Replace the archive if it exists'), allowMissing: bool('Pack even when an image named by the JSON has no file'),
  }, ['file']),
  output: openObject({ out: str('The archive'), bytes: int('Its size'), entries: list('Its files', openObject({ path: str('Name'), bytes: int('Size') })), missing: list('References without a file') }),
  args: { positionals: ['file', 'images'] }, offline: true,
  run: (ctx, { file, images, out, force, allowMissing }) => {
    const path = at(ctx.io.cwd, file);
    const text = readText(path);
    let doc: Record<string, unknown>;
    try { doc = JSON.parse(text); } catch { throw usageError('THEME_FORMAT_INVALID', `${file} is not JSON`); }
    const given = imageFiles(ctx.io.cwd, images);
    const files = given.length ? given : imagesBeside(path);
    const entries: { path: string; bytes: Uint8Array; deflate?: boolean }[] = [{ path: 'theme.json', bytes: new TextEncoder().encode(text), deflate: true }];
    const missing: string[] = [];
    for (const ref of imageRefs(doc).filter((r) => isFileReference(r.ref))) {
      const found = fileFor(ref.ref, files);
      if (!found) { missing.push(ref.ref); continue; }
      const name = basename(found);
      if (!entries.some((e) => e.path === name)) entries.push({ path: name, bytes: new Uint8Array(readFileSync(found)) });
    }
    if (missing.length && !allowMissing) throw cliRefusal('IMAGE_FILE_MISSING', `No file for ${missing.join(', ')}: give them, or --allow-missing`, { missing });
    const target = at(ctx.io.cwd, out ?? `${typeof doc.name === 'string' && doc.name ? doc.name : basename(file).replace(/\.json$/i, '')}.zip`);
    if (existsSync(target) && !force) throw usageError('FILE_EXISTS', `${target} exists: --force to replace it`, { path: target });
    const zip = writeZip(entries);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, zip);
    return { out: target, bytes: zip.length, entries: entries.map((e) => ({ path: e.path, bytes: e.bytes.length })), missing };
  },
  text: (r) => [`${r.out} (${r.bytes} bytes)`, ...r.entries.map((e) => `  ${e.path}  ${e.bytes} bytes`), ...(r.missing.length ? [`missing: ${r.missing.join(', ')}`] : [])].join('\n'),
  quiet: (r) => r.out,
};

/** A path of an archive made safe to write under a folder: relative, without "..", without a drive. */
export function safeEntryPath(path: string): string[] {
  const parts = path.replaceAll('\\', '/').split('/').filter((p) => p !== '' && p !== '.');
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || parts.some((p) => p === '..') || !parts.length) throw usageError('ZIP_PATH_UNSAFE', `The archive names a path outside its folder: ${path}`, { path });
  return parts;
}

type UnpackResult = { out: string; entries: { path: string; bytes: number }[] };

export const themeUnpack: Command<{ archive: string; out?: string; force?: boolean }, UnpackResult> = {
  name: 'theme unpack', summary: 'Unpack the ZIP of a theme (an export of the studio, or theme pack)',
  examples: ['breakrocks theme unpack stade-nuit.zip --out stade-nuit/'],
  input: object({ archive: str('The archive (.zip)'), out: str('The folder to write in (default: the name of the archive)'), force: bool('Replace files that exist') }, ['archive']),
  output: openObject({ out: str('The folder'), entries: list('The files written', openObject({ path: str('Path'), bytes: int('Size') })) }),
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
    return { out: folder, entries: written };
  },
  text: (r) => [r.out, ...r.entries.map((e) => `  ${e.path}  ${e.bytes} bytes`)].join('\n'),
  quiet: (r) => r.out,
};

type TypefacesResult = { source: 'shipped' | 'platform'; typefaces: { name: string; category: string; scripts: string[]; license: string }[]; onlyShipped?: string[]; onlyPlatform?: string[] };

export const themeTypefaces: Command<{ online?: boolean }, TypefacesResult> = {
  name: 'theme typefaces', summary: 'List the approved typefaces (shipped; --online: approvedTypefaces, compared)',
  examples: ['breakrocks theme typefaces', 'breakrocks theme typefaces --online --json'],
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
