// Themes, layouts and the studio, online: the catalog, a theme's page, the publication in one gesture as the studio imports
// (theme check, each image named by the JSON sent with requestMediaUpload and replaced by its upload
// id, then publishTheme: a theme of the same name gets its next version), applying, the personal theme, the export
// (the JSON and the images served, at their largest width), the screenshots, deletion,
// reports; the layouts likewise; the drafts of the studio.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { accountIdOf, apiCommand, refOf } from '../api/command.js';
import { outputSchema, selection } from '../api/graphql.js';
import type { Context } from '../context.js';
import { endpoints } from '../endpoints.js';
import { cliRefusal, usageError } from '../errors.js';
import { checkImage, uploadImage, whileProcessing } from '../media.js';
import type { Command } from '../registry.js';
import { bool, int, list, object, openObject, str } from '../schema.js';
import { uuidv7 } from '../ids.js';
import { api } from '../session.js';
import { checkTheme, fileFor, imageRefs, imagesBeside, isFileReference, withoutIgnoredImages, type ImageRef } from '../theme/check.js';
import { isZipName, openArchive } from '../theme/bundle.js';
import { isSystemFile, writeZip } from '../theme/zip.js';
import { WIDGET_REGISTRY, checkLayout, kindOfLayout } from '../theme/design.js';

const THEME = selection('Theme', 2);
/** A theme or a layout: %universe/name. */
const REF = '^%\\S+/[^/]+$';
type Ref = { universe: string; name: string };
const ref = (value: string, what = 'theme') => refOf(value, what) as Ref;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

type CatalogItem = { theme: { universe: string; name: string; version: number }; reason?: string; universeCount: number; accountCount: number; hasImage?: boolean | null; look?: { name?: string } | null };
export const themesList: Command<{ field?: string; creator?: string; order?: string; universe?: string; query?: string; variant?: string; use?: string; group?: string; withImage?: boolean; withoutImage?: boolean; after?: string }, unknown> = {
  name: 'themes list', summary: 'The theme catalog: by field, creator, order, universe, text; quick start and the country collection (themeCatalog)',
  description: 'Since specs v101.13.0 (D-314): --order QUICK_START lists every theme of %root that quick start offers for --universe (the 30 looks and the theme of its country first), filtered by --group LOOK|COUNTRY|OFFICIAL|UNIVERSAL, --field, --with-image or --without-image; --order COUNTRY the country collection only (v101.10.0). Each item tells its reason (LOOK, COUNTRY, OFFICIAL, COLLECTION_<field>, UNIVERSAL, MOST_USED…) and whether the theme has a background image.',
  examples: ['breakrocks look themes list --field SPORT', 'breakrocks look themes list --creator @gabriel --order NEWEST --json', 'breakrocks look themes list --order QUICK_START --universe %paris --group COUNTRY', 'breakrocks look themes list --order QUICK_START --universe %paris --with-image --query stade'],
  input: object({
    field: str('A field: its collection first', { enum: ['CULTURE', 'ENTERTAINMENT', 'EVERYDAY_LIFE', 'GAMES', 'PLACES', 'POLITICS', 'SCIENCE', 'SPORT', 'TECH', 'WORK'] }),
    creator: str('The themes published by an account (@handle or id)'), order: str('The order (QUICK_START and COUNTRY need --universe)', { enum: ['MOST_USED', 'NEWEST', 'IN_YOUR_UNIVERSES', 'COUNTRY', 'QUICK_START'] }),
    universe: str('The themes of a universe; with QUICK_START or COUNTRY, the universe customized'), query: str('A text in their names and descriptions (QUICK_START: any keyword, a country, a color, "with image")'), variant: str('NIGHT or DAY', { enum: ['NIGHT', 'DAY'] }),
    use: str('PERSONAL or UNIVERSE', { enum: ['PERSONAL', 'UNIVERSE'] }),
    group: str('With QUICK_START: one group of quick start', { enum: ['LOOK', 'COUNTRY', 'OFFICIAL', 'UNIVERSAL'] }),
    withImage: bool('With QUICK_START: the themes with a background image only'), withoutImage: bool('With QUICK_START: the themes without a background image only'),
    after: str('The cursor of the next page'),
  }),
  output: outputSchema('ThemeCatalogPage', 2),
  run: async (ctx, i) => {
    if (i.withImage && i.withoutImage) throw usageError('INVALID_INPUT', '--with-image or --without-image, not both');
    return (await api<{ themeCatalog: unknown }>(ctx, `query($c: UniverseField, $cr: ID, $o: ThemeCatalogOrder, $u: String, $q: String, $v: ThemeVariant, $use: ThemeUse, $g: ThemeCatalogGroup, $wi: Boolean, $after: String) { themeCatalog(collection: $c, creator: $cr, order: $o, universe: $u, query: $q, variant: $v, use: $use, group: $g, withImage: $wi, after: $after) ${selection('ThemeCatalogPage', 2)} }`,
      { c: i.field ?? null, cr: i.creator ? await accountIdOf(ctx, i.creator) : null, o: i.order ?? null, u: i.universe ?? null, q: i.query ?? null, v: i.variant ?? null, use: i.use ?? null, g: i.group ?? null, wi: i.withImage ? true : i.withoutImage ? false : null, after: i.after ?? null })).themeCatalog;
  },
  text: (r) => ((r as { items: CatalogItem[] }).items.map((x) => `${x.theme.universe}/${x.theme.name} v${x.theme.version}  ${x.reason ?? ''}${x.look?.name ? ` (look ${x.look.name})` : ''}  ${x.hasImage ? 'with image' : 'without image'}  ${x.universeCount} universes, ${x.accountCount} accounts`).join('\n') || '(none)'),
};

async function themeOf(ctx: Context, value: string, appliedIn?: string) {
  const r = ref(value);
  const t = (await api<{ theme: Record<string, unknown> | null }>(ctx, `query($u: String!, $n: String!, $in: String) { theme(universe: $u, name: $n, appliedIn: $in) ${THEME} }`, { u: r.universe, n: r.name, in: appliedIn ?? null })).theme;
  if (!t) throw usageError('THEME_NOT_FOUND', `No theme ${value}`, { theme: value });
  return t;
}

export const themesShow: Command<{ theme: string; appliedIn?: string }, unknown> = {
  name: 'themes show', summary: 'The page of a theme: screenshots, palette, typefaces, images, origin, use', examples: ['breakrocks look themes show %test-village-multisport/sport-gabriel-04'],
  input: object({ theme: str('The theme: %universe/name', { pattern: REF }), appliedIn: str('The universe it is applied in (a non-member reads it there)') }, ['theme']),
  output: outputSchema('Theme', 1), args: { positionals: ['theme'] },
  run: (ctx, { theme, appliedIn }) => themeOf(ctx, theme, appliedIn),
  text: (r) => themeText(r as ThemeServed),
};

type ServedImage = { url?: string | null; urlNight?: string | null; widths?: number[]; widthsNight?: number[]; removed?: boolean | null } | null;
type ThemeServed = {
  universe?: string | null; name: string; version?: number; description?: string | null; collection?: string | null; official?: boolean; format?: string; contrastLevel?: string;
  creator?: { handle?: string } | null; typography?: { title?: string | null } | null; corrected?: string[]; universeCount?: number; accountCount?: number; document?: unknown;
  imageSlots?: Record<string, ServedImage>; screenshots?: string[]; screenshotsDay?: string[]; pageScreenshots?: Record<string, { url?: string | null; urlNight?: string | null } | null> | null;
};
/** The page of a theme in text: what it is, its image slots served (their widths), its screenshots, how its image shows. */
export function themeText(t: ThemeServed): string {
  let doc: Record<string, unknown> = {};
  try { doc = (typeof t.document === 'string' ? JSON.parse(t.document) : t.document ?? {}) as Record<string, unknown>; } catch { /* kept empty */ }
  const appearance = isObject(doc.appearance) ? doc.appearance : undefined;
  const slots = Object.entries(t.imageSlots ?? {}).filter(([k, v]) => v && (k === 'page' || k === 'pageHeader' || v.url || v.urlNight));
  const shots = Object.entries(t.pageScreenshots ?? {}).filter(([, v]) => v);
  return [
    `${t.universe ?? ''}/${t.name} v${t.version ?? '?'}${t.official ? ' (official)' : ''}${t.collection ? `  ${t.collection}` : ''}${t.creator?.handle ? `  by @${t.creator.handle}` : ''}`,
    ...(t.description ? [`  ${t.description}`] : []),
    `  typeface ${t.typography?.title ?? '?'}  contrast ${t.contrastLevel ?? '?'}  ${t.universeCount ?? 0} universes, ${t.accountCount ?? 0} accounts`,
    `  image of the page shows ${appearance && typeof appearance.imageShows === 'string' ? appearance.imageShows : 'subtle'}${appearance?.sky ? `, sky ${String(appearance.sky)}` : ''}`,
    ...slots.map(([k, v]) => `  slot ${k}: ${v!.removed ? 'removed by the platform team' : `${v!.url ? `day ${v!.url} (${(v!.widths ?? []).join(', ') || 'no width yet'})` : 'no day image'}${v!.urlNight ? `, night ${v!.urlNight} (${(v!.widthsNight ?? []).join(', ') || 'no width yet'})` : ''}`}`),
    `  screenshots: ${t.screenshots?.length ?? 0} night, ${t.screenshotsDay?.length ?? 0} day; page of a universe: ${shots.length ? shots.map(([bp]) => bp).join(', ') : 'none yet'} (theme shots downloads them)`,
    ...((t.corrected ?? []).length ? [`  corrected at publication: ${t.corrected!.join(', ')}`] : []),
  ].join('\n');
}

/** [doc] with each reference of [values] (a place and a variant: "page.day", "wordmark") replaced. */
export function replaceRefs(doc: Record<string, unknown>, values: Map<string, string>): Record<string, unknown> {
  const next = structuredClone(doc);
  const key = (r: ImageRef) => (r.variant ? `${r.place}.${r.variant}` : r.place);
  for (const r of imageRefs(doc)) {
    const value = values.get(key(r));
    if (value === undefined) continue;
    const slots = isObject(next.imageSlots) && r.place in next.imageSlots ? next.imageSlots : (next.images as Record<string, unknown>);
    if (!r.variant) slots[r.place] = value;
    else if (typeof slots[r.place] === 'string') slots[r.place] = { day: value };
    else (slots[r.place] as Record<string, string>)[r.variant] = value;
  }
  return next;
}

type Corrected = { path: string; value: unknown };
type PublishResult = { theme: unknown; uploads: { ref: string; file: string; id: string }[]; corrected?: Corrected[]; removed?: string[]; dryRun?: boolean; warnings: number };

/**
 * What the platform corrected at publication ([corrected]: "night.text" a color of the palette,
 * "night.surfaces.badge.text" a color of a theme surface, "night.surfaces.postCard.opacity" a surface
 * opacity raised), each with the value kept, read in the document served.
 */
export function correctedValues(theme: unknown): Corrected[] {
  if (!isObject(theme) || !Array.isArray(theme.corrected)) return [];
  let doc: unknown = theme.document;
  if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch { doc = undefined; } }
  const variants = isObject(doc) && isObject(doc.variants) ? doc.variants : {};
  return (theme.corrected as string[]).map((path) => {
    const [variant, ...rest] = path.split('.');
    const v = isObject(variants[variant]) ? variants[variant] as Record<string, unknown> : {};
    const at = rest[0] === 'surfaces' ? rest : ['palette', ...rest];
    let value: unknown = v;
    for (const k of at) value = isObject(value) ? value[k] : undefined;
    return { path, value };
  });
}

export const themePublish: Command<{ file: string; images?: string[]; in: string; version?: boolean; dryRun?: boolean }, PublishResult> = {
  name: 'theme publish', summary: 'Publish a theme and its images (or its ZIP archive) in a universe, in one gesture (as the import of the apps)',
  description: 'A .zip in place of the JSON: the archive of a theme as the import of the apps reads it (theme pack, theme export --zip: theme.json, else its only JSON, and its images by their names). theme check first, on the model of specs v122 (the block appearance kept as the platform keeps it, pageImageOnPhone, the four families page, sky, block and control; an error refuses; the colors the platform raises and the keys it ignores are told); "scrims", "textScrims" and "screenshots" (computed by the platform, in a document exported elsewhere) are removed, told; the images of the slots the platform ignores since v99 (timeColumn, channelHeader, cardTexture, texture) are left out, told; the other keys ignored (radii, borders, opacities) are sent as they are. Each image the JSON names by a file is found among those given or beside the JSON (a file missing refuses, named), sent with requestMediaUpload and replaced by its upload id; then publishTheme, which makes the next version of a theme of the same name (--version, kept for the scripts, changes nothing). The answer tells each color and each surface opacity the platform corrected, with the value kept ("corrected"). The screenshots are generated by the platform.',
  examples: ['breakrocks look themes publish theme.json --in %test-village-sport', 'breakrocks look themes publish theme.json images/ --in %paris --version', 'breakrocks look themes publish theme.json --in %paris --dry-run', 'breakrocks look themes publish stade-nuit.zip --in %paris'],
  input: object({ file: str('The theme document (JSON), or its archive (.zip)'), images: list('Its image files, or folders of images'), in: str('The universe to publish it in (%name)'), version: bool('A new version of the theme of this name (kept for the scripts: publishTheme makes it anyway)'), dryRun: bool('Check and tell what would be sent') }, ['file', 'in']),
  output: openObject({
    theme: outputSchema('Theme', 1), uploads: list('The images sent', openObject({ ref: str('The reference'), file: str('The file'), id: str('The upload id') })), warnings: int('Warnings of theme check'),
    corrected: list('What the platform corrected, with the value kept', openObject({ path: str('night.text, night.surfaces.control.text…'), value: { description: 'The color (#RRGGBB) kept' } })),
    removed: list('The keys removed before sending: computed by the platform (scrims, textScrims, screenshots), image slots ignored since v99'),
  }),
  args: { positionals: ['file', 'images'] },
  run: async (ctx, input) => {
    const path = resolve(ctx.io.cwd, input.file);
    if (!existsSync(path)) throw usageError('FILE_NOT_FOUND', `No file ${input.file}`);
    if (!isZipName(path)) return publishThemeFile(ctx, path, input);
    // The archive of a theme (theme pack, theme export --zip, an export of the apps): its document and its images.
    const archive = openArchive(path);
    try { return await publishThemeFile(ctx, archive.document, { ...input, images: [...archive.images, ...(input.images ?? [])] }); } finally { archive.close(); }
  },
  text: (r) => {
    const t = r.theme as { universe?: string; name?: string; version?: number; operation?: string };
    if (r.dryRun) return [`${t.operation} ${t.universe}/${t.name} (dry run: nothing sent)`, ...r.uploads.map((u) => `  image   ${u.ref}: ${u.file}`)].join('\n');
    return [
      `${t.universe ?? ''}/${t.name} v${t.version ?? '?'} published (${r.warnings} warning(s) of theme check)`,
      ...r.uploads.map((u) => `  image   ${u.ref} → ${u.id}`),
      ...(r.corrected ?? []).map((c) => `  corrected ${c.path}: ${String(c.value)}`),
      ...(r.removed?.length ? [`  removed ${r.removed.join(', ')} (computed or ignored by the platform)`] : []),
      '  the screenshots are rendered within seconds: theme shots, themes show',
    ].join('\n');
  },
  quiet: (r) => (r.theme as { name?: string }).name,
};

async function publishThemeFile(ctx: Context, path: string, { images, in: universe, version, dryRun }: { images?: string[]; in: string; version?: boolean; dryRun?: boolean }): Promise<PublishResult> {
  let text = readFileSync(path, 'utf8');
  const given = (images ?? []).flatMap((p) => { const f = resolve(ctx.io.cwd, p); return statSync(f).isDirectory() ? readdirSync(f).filter((n) => !isSystemFile(n)).map((n) => join(f, n)) : [f]; });
  // The scrims, the text scrims and the screenshots are the platform's (THEME_SCRIMS_COMPUTED,
  // THEME_SCREENSHOTS_GENERATED), in a document exported elsewhere: removed, told.
  const removed: string[] = [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isObject(parsed)) {
      for (const key of ['scrims', 'textScrims', 'screenshots']) if (key in parsed) { delete parsed[key]; removed.push(key); }
      if (removed.length) { text = JSON.stringify(parsed); ctx.notice(`Removed ${removed.join(', ')}: computed by the platform at publication`); }
    }
  } catch { /* theme check tells it */ }
  const report = checkTheme(path, text, given);
  const missing = report.problems.filter((p) => p.code === 'IMAGE_FILE_MISSING');
  if (missing.length) throw cliRefusal('IMAGE_FILE_MISSING', missing.map((m) => m.message).join('; '), { missing: missing.map((m) => m.path) });
  if (!report.ok) throw cliRefusal('THEME_CHECK_FAILED', `${report.errors} error(s): ${report.problems.filter((p) => p.severity === 'error').map((p) => `${p.code} ${p.path}`).join(', ')}`, { report });
  const stripped = withoutIgnoredImages(JSON.parse(text) as Record<string, unknown>);
  const doc = stripped.doc;
  if (stripped.removed.length) { removed.push(...stripped.removed); ctx.notice(`Removed ${stripped.removed.join(', ')}: image slots the platform ignores since specs v99.0.0`); }
  const files = given.length ? given : imagesBeside(path);
  const toSend = imageRefs(doc).filter((r) => isFileReference(r.ref)).map((r) => {
    const found = fileFor(r.ref, files)!;
    return { r, file: found, image: checkImage(ctx, found, undefined, r.place === 'wordmark' ? 1024 * 1024 : 5 * 1024 * 1024, r.place === 'wordmark' ? ['image/png', 'image/webp'] : ['image/jpeg', 'image/png', 'image/webp']) };
  });
  if (dryRun) return { dryRun: true, theme: { universe, name: doc.name, operation: 'publishTheme', ...(version ? { version: 'next' } : {}) }, uploads: toSend.map((s) => ({ ref: s.r.ref, file: s.file, id: '(not sent)' })), warnings: report.warnings, removed };
  const ids = new Map<string, string>();
  const uploads: PublishResult['uploads'] = [];
  const byFile = new Map<string, string>();
  for (const s of toSend) {
    const id = byFile.get(s.file) ?? await uploadImage(ctx, s.image, { destination: 'THEME' });
    byFile.set(s.file, id);
    ids.set(s.r.variant ? `${s.r.place}.${s.r.variant}` : s.r.place, id);
    uploads.push({ ref: s.r.ref, file: basename(s.file), id });
  }
  const { universe: _u, ...rest } = replaceRefs(doc, ids);
  void _u;
  const themeText = JSON.stringify(rest);
  // One requestId for every try while the images are processed: the platform publishes once.
  const requestId = uuidv7(ctx.now());
  const theme = await whileProcessing(ctx, async () => (await api<{ publishTheme: unknown }>(ctx, `mutation($u: String!, $t: AWSJSON!, $r: ID!) { publishTheme(universe: $u, document: $t, requestId: $r) ${THEME} }`, { u: universe, t: themeText, r: requestId })).publishTheme, { stepMs: 3000, maxMs: 120_000 });
  return { theme, uploads, warnings: report.warnings, corrected: correctedValues(theme), removed };
}

const PROFILE_FIELDS = ['description', 'image', 'theme', 'universeStrip', 'firstFocus', 'layoutRef', 'switcherLayouts', 'readerRetouches', 'clear'];
const profileOnly = (kept: string) => PROFILE_FIELDS.filter((f) => f !== kept).map((f) => `input.${f}`);
export const themeApply = apiCommand({ name: 'theme apply', summary: 'Make a theme the theme of a universe (setUniverseProfile; the leadership, the owner, the admins)', kind: 'mutation', op: 'setUniverseProfile', positionals: ['input.theme'], rename: { universe: 'to' }, require: ['theme'],
  hide: profileOnly('theme'),
  descriptions: { to: 'The universe (%name)', theme: 'The theme: %universe/name' }, depth: 1,
  description: 'Without leadership, a public universe changes its theme by a proposal of the kind THEME: breakrocks proposals file %u --kind THEME --title … --theme %x/name.',
  examples: ['breakrocks look themes apply %paris/stade-nuit --to %paris'] });
export const themePersonalSet = apiCommand({ name: 'theme personal set', summary: 'Set the personal theme: the accent, the display mode, the text size, the density, the motion, the sounds, a readable typeface (setPersonalTheme)', kind: 'mutation', op: 'setPersonalTheme',
  description: 'Since specs v96.0.0 (D-289) the personal theme is Socle with an accent: "#RRGGBB" (the apps offer Slate #3F4752, Forest #1F6B45, Lagoon #11707A, Aubergine #5A2E5E, Brick #A8432C) or "universe", the accent of the universe visited.',
  hide: ['input.theme', 'input.myThemeEverywhere', 'input.postTransparency'],
  descriptions: { accent: 'The accent: "#RRGGBB", or "universe" (the accent of the universe visited)', clear: 'The settings removed (ACCENT, DEVICE_DISPLAY_MODE)' },
  examples: ['breakrocks look personal set --accent "#11707A"', 'breakrocks look personal set --accent universe --display-mode NIGHT --density DENSE'] });
export const themePersonalClear = apiCommand({ name: 'theme personal clear', summary: 'Back to the default personal theme: the accent of the universe visited, the display mode of the device (setPersonalTheme clear)', kind: 'mutation', op: 'setPersonalTheme', fixed: { 'input.clear': ['ACCENT', 'DEVICE_DISPLAY_MODE'] }, hide: ['theme', 'accent', 'density', 'device', 'deviceDisplayMode', 'displayMode', 'motion', 'myThemeEverywhere', 'postTransparency', 'readableTypeface', 'sounds', 'textScale'].map((f) => `input.${f}`), examples: ['breakrocks look personal clear'] });
/** The personal themes saved by the account (personalThemes, before specs v96.0.0: savePersonalTheme is deprecated). */
export const themePersonalSaved = apiCommand({
  name: 'theme personal saved', summary: 'The personal themes the account saved, the most recent first, 50 at most (personalThemes)', kind: 'query', op: 'personalThemes', depth: 1,
  description: 'Saved before specs v96.0.0 (savePersonalTheme is deprecated): the personal theme is now Socle with an accent (theme personal set). --json gives their documents.',
  text: (r) => (Array.isArray(r) && r.length ? (r as { name: string; updatedAt?: string; copiedFrom?: { universe?: string; name?: string } | null }[]).map((t) => `${t.name}  ${t.updatedAt ?? ''}${t.copiedFrom ? `  copied from ${t.copiedFrom.universe}/${t.copiedFrom.name}` : ''}`).join('\n') : '(none)'),
  examples: ['breakrocks look personal saved', 'breakrocks look personal saved --json'],
});
export const themeDelete = apiCommand({ name: 'theme delete', summary: 'Delete a theme one published (it stays applied where it is)', kind: 'mutation', op: 'deleteTheme', positionals: ['theme'],
  extra: { theme: { type: 'string', pattern: REF, description: 'The theme: %universe/name' } }, hide: ['universe', 'name'], require: ['theme'], prepare: (i) => { const r = ref(String(i.theme)); return { ...i, universe: r.universe, name: r.name }; }, confirm: (i) => `Delete the theme ${i.theme}?`,
  examples: ['breakrocks look themes delete %paris/stade-nuit --yes'] });

async function download(ctx: Context, url: string, tries = 1): Promise<Uint8Array | undefined> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await ctx.io.fetch(url);
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      if (res.status !== 403 && res.status !== 404) return undefined;
    } catch { return undefined; }
    if (i + 1 < tries) await ctx.io.sleep(3000);
  }
  return undefined;
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
export const EXPORT_WIDTHS = [2160, 1080, 480, 160];

type ExportResult = { out: string; files: { path: string; bytes: number }[]; missing: string[] };
export const themeExport: Command<{ theme: string; out: string; zip?: boolean; force?: boolean }, ExportResult> = {
  name: 'theme export', summary: 'Export a theme: its JSON and its images served (the largest width), or a ZIP (--zip)',
  description: 'The images are named <slot>-<variant>.webp and the JSON names them, so that the folder or the archive is imported again as it is (theme publish, the studio).',
  examples: ['breakrocks look themes export %test-village-multisport/sport-gabriel-04 --out sport/', 'breakrocks look themes export %paris/stade-nuit --out stade-nuit.zip --zip'],
  input: object({ theme: str('The theme: %universe/name', { pattern: REF }), out: str('The folder (or the .zip with --zip)'), zip: bool('One ZIP archive'), force: bool('Replace files that exist') }, ['theme', 'out']),
  output: openObject({ out: str('Where'), files: list('Files written', openObject({ path: str('Path'), bytes: int('Size') })), missing: list('Images not found on the CDN') }),
  args: { positionals: ['theme'] },
  run: async (ctx, { theme, out, zip, force }) => {
    const t = await themeOf(ctx, theme);
    const doc = (typeof t.document === 'string' ? JSON.parse(t.document) : t.document) as Record<string, unknown>;
    const slots = (t.imageSlots ?? {}) as Record<string, { url?: string | null; urlNight?: string | null } | null>;
    const at = await endpoints(ctx, ctx.profile()).catch(() => undefined);
    const files: { path: string; bytes: Uint8Array }[] = [];
    const names = new Map<string, string>();
    const missing: string[] = [];
    for (const r of imageRefs(doc)) {
      const name = `${kebab(r.place)}${r.variant ? `-${r.variant}` : ''}.webp`;
      const candidates = [...(at?.media ? EXPORT_WIDTHS.map((w) => `${at.media}/posts/${encodeURIComponent(r.ref)}/${w}.webp`) : []), ...((r.variant === 'night' ? slots[r.place]?.urlNight : slots[r.place]?.url) ? [(r.variant === 'night' ? slots[r.place]!.urlNight : slots[r.place]!.url)!] : [])];
      let bytes: Uint8Array | undefined;
      for (const url of candidates) { bytes = await download(ctx, url); if (bytes) break; }
      if (!bytes) { missing.push(r.variant ? `${r.place}.${r.variant}` : r.place); continue; }
      files.push({ path: name, bytes });
      names.set(r.variant ? `${r.place}.${r.variant}` : r.place, name);
    }
    const { scrims: _s, textScrims: _t, screenshots: _x, creator: _c, version: _v, ...clean } = replaceRefs(doc, names);
    void _s; void _t; void _x; void _c; void _v;
    files.unshift({ path: 'theme.json', bytes: new TextEncoder().encode(`${JSON.stringify(clean, null, 2)}\n`) });
    const target = resolve(ctx.io.cwd, out);
    if (zip) {
      if (existsSync(target) && !force) throw usageError('FILE_EXISTS', `${out} exists: --force to replace it`);
      const archive = writeZip(files.map((f) => ({ ...f, deflate: f.path.endsWith('.json') })));
      writeFileSync(target, archive);
      return { out: target, files: files.map((f) => ({ path: f.path, bytes: f.bytes.length })), missing };
    }
    mkdirSync(target, { recursive: true });
    for (const f of files) { const p = join(target, f.path); if (existsSync(p) && !force) throw usageError('FILE_EXISTS', `${p} exists: --force to replace it`); }
    for (const f of files) writeFileSync(join(target, f.path), f.bytes);
    return { out: target, files: files.map((f) => ({ path: join(target, f.path), bytes: f.bytes.length })), missing };
  },
  quiet: (r) => r.out,
};

export const themeShots: Command<{ theme: string; out: string; force?: boolean }, ExportResult> = {
  name: 'theme shots', summary: 'Download the screenshots of a theme (3 screens night and day, the page of a universe at 3 breakpoints)',
  description: 'The screenshots are rendered by the platform within seconds of a publication (403 until then: tried again a few times).',
  examples: ['breakrocks look themes shots %paris/stade-nuit --out shots/'],
  input: object({ theme: str('The theme: %universe/name', { pattern: REF }), out: str('The folder'), force: bool('Replace files that exist') }, ['theme', 'out']),
  output: openObject({ out: str('The folder'), files: list('Files', openObject({ path: str('Path'), bytes: int('Size') })), missing: list('Not rendered yet') }), args: { positionals: ['theme'] },
  run: async (ctx, { theme, out, force }) => {
    const t = await themeOf(ctx, theme) as { screenshots?: string[]; screenshotsDay?: string[]; pageScreenshots?: Record<string, { url?: string; urlNight?: string } | null> | null };
    const wanted: [string, string][] = [];
    (t.screenshots ?? []).forEach((u, i) => wanted.push([`night-${i + 1}`, u]));
    (t.screenshotsDay ?? []).forEach((u, i) => wanted.push([`day-${i + 1}`, u]));
    for (const [bp, v] of Object.entries(t.pageScreenshots ?? {})) { if (v?.url) wanted.push([`page-${bp}-day`, v.url]); if (v?.urlNight) wanted.push([`page-${bp}-night`, v.urlNight]); }
    const target = resolve(ctx.io.cwd, out);
    mkdirSync(target, { recursive: true });
    const files: ExportResult['files'] = [], missing: string[] = [];
    for (const [name, url] of wanted) {
      const ext = /\.(\w+)(?:\?|$)/.exec(url)?.[1] ?? 'webp';
      const p = join(target, `${name}.${ext}`);
      if (existsSync(p) && !force) throw usageError('FILE_EXISTS', `${p} exists: --force to replace it`);
      const bytes = await download(ctx, url, 5);
      if (!bytes) { missing.push(name); continue; }
      writeFileSync(p, bytes);
      files.push({ path: p, bytes: bytes.length });
    }
    return { out: target, files, missing };
  },
  quiet: (r) => r.out,
};

type LayoutCheckResult = { ok: boolean; source: 'offline' | 'platform'; kind?: string; refusals: { code: string; path: string; widget?: string }[]; document: unknown };
/** layouts check: offline by the shared library of the design system (design-lib/lib/layout checkLayout, its widget registry), as the backend checks at publication; --online asks the platform (checkLayout). */
export const layoutsCheck: Command<{ document: string; in?: string; online?: boolean }, LayoutCheckResult> = {
  name: 'layouts check', summary: 'Check a layout document as the platform does at publication: offline by the shared library of the design system (--online: checkLayout)',
  description: 'Offline (the default): design-lib/lib/layout checkLayout with the widget registry of the design system (design-lib/registry/widgets.json), for the kind of universe of --in (or of the universe of the document: a private universe ends with "."); the answer is the document with its derived canvases, or the refusals with their codes (LAYOUT_*) and where. --online: the query checkLayout of the API (--in required), for a universe whose registry the platform completed since. Exit 1 when it refuses.',
  examples: ['breakrocks look layouts check @layout.json', 'breakrocks look layouts check @layout.json --in %team-fra.', 'breakrocks look layouts check @layout.json --in %paris --online'],
  input: object({ document: str('The layout document: @file.json, or its JSON'), in: str('The universe (%name)', { pattern: '^%\\S+$' }), online: bool('Ask the platform (checkLayout) instead of the shared library') }, ['document']),
  output: openObject({ ok: bool('Not refused'), source: str('offline or platform'), kind: str('public or private (offline)'), refusals: list('The refusals', openObject({ code: str('LAYOUT_*'), path: str('Where'), widget: str('The widget') })), document: { description: 'The document with its derived canvases' } }),
  args: { positionals: ['document'] },
  run: async (ctx, { document, in: universe, online }) => {
    const text = document.startsWith('@') ? readFileSync(resolve(ctx.io.cwd, document.slice(1)), 'utf8') : document;
    let doc: unknown;
    try { doc = JSON.parse(text); } catch { throw usageError('LAYOUT_FORMAT_INVALID', 'The layout document is not JSON'); }
    if (online) {
      if (!universe) throw usageError('INVALID_INPUT', '--online needs --in %universe');
      const r = (await api<{ checkLayout: { document?: string | null; refusals: LayoutCheckResult['refusals'] } }>(ctx, 'query($d: AWSJSON!, $u: String!) { checkLayout(document: $d, universe: $u) { document refusals { code path widget } } }', { d: JSON.stringify(doc), u: universe })).checkLayout;
      return { ok: !r.refusals.length, source: 'platform', refusals: r.refusals, document: typeof r.document === 'string' ? JSON.parse(r.document) : r.document ?? null };
    }
    const d = isObject(doc) ? doc : {};
    const kind = kindOfLayout(universe ?? (typeof d.universe === 'string' ? d.universe : undefined), typeof d.name === 'string' ? d.name : undefined);
    const r = checkLayout(doc, { kind, registry: WIDGET_REGISTRY });
    return { ok: !r.refusals.length, source: 'offline', kind, refusals: r.refusals, document: r.document };
  },
  exitCode: (r) => (r.ok ? 0 : 1),
  text: (r) => (r.ok ? `OK (${r.source}${r.kind ? `, ${r.kind} universe` : ''})` : [`refused (${r.source})`, ...r.refusals.map((x) => `  ${x.code}  ${x.path}${x.widget ? ` (${x.widget})` : ''}`)].join('\n')),
};

const layoutRefInput = { layout: { type: 'string', pattern: REF, description: 'The layout: %universe/name' } } as const;
const fromLayout = (i: Record<string, unknown>) => { const r = ref(String(i.layout), 'layout'); return { ...i, universe: r.universe, name: r.name }; };
export const layoutCommands = [
  apiCommand({ name: 'layouts list', summary: 'The layout catalog (layoutCatalog)', kind: 'query', op: 'layoutCatalog', rename: { collection: 'field' }, examples: ['breakrocks look layouts list --field SPORT'] }),
  apiCommand({ name: 'layouts show', summary: 'A layout', kind: 'query', op: 'layout', positionals: ['layout'], extra: { ...layoutRefInput }, hide: ['universe', 'name'], require: ['layout'], prepare: fromLayout, examples: ['breakrocks look layouts show %root/feed-first'] }),
  layoutsCheck,
  apiCommand({ name: 'layouts publish', summary: 'Publish a layout in a universe: a layout of the same name gets its next version (publishLayout)', kind: 'mutation', op: 'publishLayout', positionals: ['document'], rename: { universe: 'in' }, descriptions: { document: 'The layout document: @file.json, or its JSON', in: 'The universe (%name)' }, examples: ['breakrocks look layouts publish @layout.json --in %paris'] }),
  apiCommand({ name: 'layouts publish-version', summary: 'Publish a new version of a layout (publishLayout, as layouts publish: kept for the scripts)', kind: 'mutation', op: 'publishLayout', positionals: ['document'], rename: { universe: 'in' }, descriptions: { document: 'The layout document: @file.json, or its JSON (its name names the layout)', in: 'The universe (%name)' }, examples: ['breakrocks look layouts publish-version @layout.json --in %paris'] }),
  apiCommand({ name: 'layouts apply', summary: 'Make a layout the default one of a universe (setUniverseProfile)', kind: 'mutation', op: 'setUniverseProfile', positionals: ['input.layoutRef'], rename: { universe: 'to', 'input.layoutRef': 'layout' }, require: ['layout'],
    hide: profileOnly('layoutRef'), descriptions: { to: 'The universe (%name)', layout: 'The layout: %universe/name' }, depth: 1, examples: ['breakrocks look layouts apply %root/agora --to %paris'] }),
  apiCommand({ name: 'layouts copy', summary: 'Copy a layout under a new name', kind: 'mutation', op: 'copyLayout', positionals: ['layout'], extra: { ...layoutRefInput }, hide: ['universe', 'name'], require: ['layout'], prepare: fromLayout, rename: { targetUniverse: 'target' }, descriptions: { as: 'The name of the copy', target: 'The universe to publish the copy in' }, examples: ['breakrocks look layouts copy %root/agora --as mon-agora --target %paris'] }),
  apiCommand({ name: 'layouts delete', summary: 'Delete a layout one published', kind: 'mutation', op: 'deleteLayout', positionals: ['layout'], extra: { ...layoutRefInput }, hide: ['universe', 'name'], require: ['layout'], prepare: fromLayout, confirm: (i) => `Delete the layout ${i.layout}?`, examples: ['breakrocks look layouts delete %paris/ma-page --yes'] }),
];

export const studioCommands = [
  apiCommand({ name: 'studio drafts', summary: 'The drafts of the studio', kind: 'query', op: 'studioDrafts', examples: ['breakrocks look studio drafts --json'] }),
  apiCommand({ name: 'studio show', summary: 'A draft of the studio', kind: 'query', op: 'studioDraft', positionals: ['id'], examples: ['breakrocks look studio show <id>'] }),
  apiCommand({ name: 'studio save', summary: 'Save a draft (a theme or a layout) in the studio', kind: 'mutation', op: 'saveStudioDraft', positionals: ['document'], rename: { draftId: 'id' }, descriptions: { document: 'The document: @file.json, or its JSON', id: 'The draft to replace', kind: 'THEME or LAYOUT', universe: 'The universe it is for' }, examples: ['breakrocks look studio save @theme.json --kind THEME --universe %paris'] }),
  apiCommand({ name: 'studio delete', summary: 'Delete a draft of the studio', kind: 'mutation', op: 'deleteStudioDraft', positionals: ['draftId'], rename: { draftId: 'id' }, descriptions: { id: 'The draft' }, confirm: (i) => `Delete the draft ${i.id}?`, examples: ['breakrocks look studio delete <id> --yes'] }),
  apiCommand({ name: 'studio use', summary: 'Use a draft of the studio: a theme or a layout made the one of its universe (or the proposal filed), a page published (useStudioDraft)', kind: 'mutation', op: 'useStudioDraft', positionals: ['draftId'], descriptions: { draftId: 'The id of the draft (studio drafts)' }, examples: ['breakrocks look studio use <draft id>'] }),
  apiCommand({ name: 'studio make-theme', summary: 'Publish a theme draft and make it the theme of its universe, or file the proposal (useStudioDraft)', kind: 'mutation', op: 'useStudioDraft', positionals: ['draftId'], descriptions: { draftId: 'The id of the theme draft' }, examples: ['breakrocks look studio make-theme <draft id>'] }),
  // Universe theme trials and draft previews.
  apiCommand({ name: 'studio try', summary: 'Try a theme draft as the theme of its universe for 24 hours, for every reader (startUniverseThemeTrial)', kind: 'mutation', op: 'startUniverseThemeTrial', positionals: ['draftId'],
    description: 'Who may make the draft the universe theme at once (the leadership of a public universe; the owner and the admins of a private one) starts a trial: every reader sees the draft, validated as at publication but not published, for 24 hours; a new trial ends the former one; studio end-try ends it, studio make-theme publishes it. A universe without leadership has no trial (THEME_TRIAL_WITHOUT_LEADERSHIP); a layout draft is refused (STUDIO_DRAFT_KIND_INVALID).',
    descriptions: { draftId: 'The id of the theme draft (studio drafts)' }, select: '{ universe draftId version startedAt endsAt startedBy { id handle displayName } }',
    text: (r) => { const t = r as { universe: string; draftId: string; version: number; endsAt: string }; return `${t.universe}: trial of the draft ${t.draftId} (v${t.version}) until ${t.endsAt}`; },
    examples: ['breakrocks look studio try <draft id>'] }),
  apiCommand({ name: 'studio end-try', summary: 'End the universe theme trial of a universe: its theme comes back (endUniverseThemeTrial)', kind: 'mutation', op: 'endUniverseThemeTrial', positionals: ['universe'],
    description: 'Any member of the leadership (the owner and the admins of a private universe) ends it, its author or not. THEME_TRIAL_NOT_FOUND when none is under way.', examples: ['breakrocks look studio end-try %paris'] }),
  apiCommand({ name: 'studio preview', summary: 'Preview a theme draft on its universe for oneself, for 24 hours (startDraftPreview)', kind: 'mutation', op: 'startDraftPreview', positionals: ['draftId'],
    description: 'Only its author sees it; the others keep the universe theme; for its author, a preview goes before a universe theme trial. A layout draft is refused (STUDIO_DRAFT_KIND_INVALID).',
    descriptions: { draftId: 'The id of the theme draft (studio drafts)' }, select: '{ universe draftId version endsAt }',
    text: (r) => { const t = r as { universe: string; draftId: string; version: number; endsAt: string }; return `${t.universe}: preview of the draft ${t.draftId} (v${t.version}) until ${t.endsAt}`; },
    examples: ['breakrocks look studio preview <draft id>'] }),
  apiCommand({ name: 'studio end-preview', summary: 'End one\'s draft preview on a universe (endDraftPreview)', kind: 'mutation', op: 'endDraftPreview', positionals: ['universe'],
    description: 'THEME_TRIAL_NOT_FOUND when none is under way.', examples: ['breakrocks look studio end-preview %paris'] }),
  apiCommand({ name: 'studio make-layout', summary: 'Publish a layout draft and make it the layout of its universe, or file the proposal (useStudioDraft)', kind: 'mutation', op: 'useStudioDraft', positionals: ['draftId'], descriptions: { draftId: 'The id of the layout draft' }, examples: ['breakrocks look studio make-layout <draft id>'] }),
];
