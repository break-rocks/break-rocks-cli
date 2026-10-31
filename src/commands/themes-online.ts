// Themes, layouts and the studio, online: the catalog, a theme's page, the publication in one gesture as the studio imports
// (theme check, each image named by the JSON sent with requestMediaUpload and replaced by its upload
// id, then publishTheme: a theme of the same name gets its next version), applying, trying, the personal theme, the export
// (the JSON and the images served, at their largest width), the screenshots, copies, deletion,
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
import { checkTheme, fileFor, imageRefs, imagesBeside, isFileReference, type ImageRef } from '../theme/check.js';
import { isSystemFile, writeZip } from '../theme/zip.js';

const THEME = selection('Theme', 2);
/** A theme or a layout: %universe/name. */
const REF = '^%\\S+/[^/]+$';
type Ref = { universe: string; name: string };
const ref = (value: string, what = 'theme') => refOf(value, what) as Ref;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const themesList: Command<{ field?: string; creator?: string; order?: string; universe?: string; query?: string; variant?: string; use?: string; after?: string }, unknown> = {
  name: 'themes list', summary: 'The theme catalog: by field, creator, order, universe, text (themeCatalog)',
  examples: ['breakrocks themes list --field SPORT', 'breakrocks themes list --creator @gabriel --order NEWEST --json'],
  input: object({
    field: str('A field: its collection first', { enum: ['CULTURE', 'ENTERTAINMENT', 'EVERYDAY_LIFE', 'GAMES', 'PLACES', 'POLITICS', 'SCIENCE', 'SPORT', 'TECH', 'WORK'] }),
    creator: str('The themes published by an account (@handle or id)'), order: str('The order', { enum: ['MOST_USED', 'NEWEST', 'IN_YOUR_UNIVERSES'] }),
    universe: str('The themes of a universe'), query: str('A text in their names and descriptions'), variant: str('NIGHT or DAY', { enum: ['NIGHT', 'DAY'] }),
    use: str('PERSONAL or UNIVERSE', { enum: ['PERSONAL', 'UNIVERSE'] }), after: str('The cursor of the next page'),
  }),
  output: outputSchema('ThemeCatalogPage', 2),
  run: async (ctx, i) => (await api<{ themeCatalog: unknown }>(ctx, `query($c: UniverseField, $cr: ID, $o: ThemeCatalogOrder, $u: String, $q: String, $v: ThemeVariant, $use: ThemeUse, $after: String) { themeCatalog(collection: $c, creator: $cr, order: $o, universe: $u, query: $q, variant: $v, use: $use, after: $after) ${selection('ThemeCatalogPage', 2)} }`,
    { c: i.field ?? null, cr: i.creator ? await accountIdOf(ctx, i.creator) : null, o: i.order ?? null, u: i.universe ?? null, q: i.query ?? null, v: i.variant ?? null, use: i.use ?? null, after: i.after ?? null })).themeCatalog,
  text: (r) => ((r as { items: { theme: { universe: string; name: string; version: number }; universeCount: number; accountCount: number }[] }).items.map((x) => `${x.theme.universe}/${x.theme.name} v${x.theme.version}  ${x.universeCount} universes, ${x.accountCount} accounts`).join('\n') || '(none)'),
};

async function themeOf(ctx: Context, value: string, appliedIn?: string) {
  const r = ref(value);
  const t = (await api<{ theme: Record<string, unknown> | null }>(ctx, `query($u: String!, $n: String!, $in: String) { theme(universe: $u, name: $n, appliedIn: $in) ${THEME} }`, { u: r.universe, n: r.name, in: appliedIn ?? null })).theme;
  if (!t) throw usageError('THEME_NOT_FOUND', `No theme ${value}`, { theme: value });
  return t;
}

export const themesShow: Command<{ theme: string; appliedIn?: string }, unknown> = {
  name: 'themes show', summary: 'The page of a theme: screenshots, palette, typefaces, images, origin, use', examples: ['breakrocks themes show %test-village-multisport/sport-gabriel-04'],
  input: object({ theme: str('The theme: %universe/name', { pattern: REF }), appliedIn: str('The universe it is applied in (a non-member reads it there)') }, ['theme']),
  output: outputSchema('Theme', 1), args: { positionals: ['theme'] },
  run: (ctx, { theme, appliedIn }) => themeOf(ctx, theme, appliedIn),
};

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
  name: 'theme publish', summary: 'Publish a theme and its images in a universe, in one gesture (as the studio imports)',
  description: 'theme check first (an error refuses; the colors the platform raises are told); "scrims" and "textScrims" (computed by the platform, in a document exported elsewhere) are removed, told; the surface opacities, "surfaceOpacity" and "textBackdrop" are sent as they are. Each image the JSON names by a file is found among those given or beside the JSON (a file missing refuses, named), sent with requestMediaUpload and replaced by its upload id; then publishTheme, which makes the next version of a theme of the same name (--version, kept for the scripts, changes nothing). The answer tells each color and each surface opacity the platform corrected, with the value kept ("corrected"). The screenshots are generated by the platform.',
  examples: ['breakrocks theme publish theme.json --in %test-village-sport', 'breakrocks theme publish theme.json images/ --in %paris --version', 'breakrocks theme publish theme.json --in %paris --dry-run'],
  input: object({ file: str('The theme document (JSON)'), images: list('Its image files, or folders of images'), in: str('The universe to publish it in (%name)'), version: bool('A new version of the theme of this name (kept for the scripts: publishTheme makes it anyway)'), dryRun: bool('Check and tell what would be sent') }, ['file', 'in']),
  output: openObject({
    theme: outputSchema('Theme', 1), uploads: list('The images sent', openObject({ ref: str('The reference'), file: str('The file'), id: str('The upload id') })), warnings: int('Warnings of theme check'),
    corrected: list('What the platform corrected, with the value kept', openObject({ path: str('night.text, night.surfaces.badge.text, night.surfaces.postCard.opacity…'), value: { description: 'The color (#RRGGBB) or the surface opacity (0 to 100) kept' } })),
    removed: list('The keys computed by the platform removed before sending (scrims, textScrims)'),
  }),
  args: { positionals: ['file', 'images'] },
  run: async (ctx, { file, images, in: universe, version, dryRun }) => {
    const path = resolve(ctx.io.cwd, file);
    if (!existsSync(path)) throw usageError('FILE_NOT_FOUND', `No file ${file}`);
    let text = readFileSync(path, 'utf8');
    const given = (images ?? []).flatMap((p) => { const f = resolve(ctx.io.cwd, p); return statSync(f).isDirectory() ? readdirSync(f).filter((n) => !isSystemFile(n)).map((n) => join(f, n)) : [f]; });
    // The scrims and the text scrims are computed by the platform (THEME_SCRIMS_COMPUTED): removed, told.
    const removed: string[] = [];
    try {
      const parsed = JSON.parse(text) as unknown;
      if (isObject(parsed)) {
        for (const key of ['scrims', 'textScrims']) if (key in parsed) { delete parsed[key]; removed.push(key); }
        if (removed.length) { text = JSON.stringify(parsed); ctx.notice(`Removed ${removed.join(' and ')}: computed by the platform at publication`); }
      }
    } catch { /* theme check tells it */ }
    const report = checkTheme(path, text, given);
    const missing = report.problems.filter((p) => p.code === 'IMAGE_FILE_MISSING');
    if (missing.length) throw cliRefusal('IMAGE_FILE_MISSING', missing.map((m) => m.message).join('; '), { missing: missing.map((m) => m.path) });
    if (!report.ok) throw cliRefusal('THEME_CHECK_FAILED', `${report.errors} error(s): ${report.problems.filter((p) => p.severity === 'error').map((p) => `${p.code} ${p.path}`).join(', ')}`, { report });
    const doc = JSON.parse(text) as Record<string, unknown>;
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
  },
  text: (r) => {
    const t = r.theme as { universe?: string; name?: string; version?: number; operation?: string };
    if (r.dryRun) return [`${t.operation} ${t.universe}/${t.name} (dry run: nothing sent)`, ...r.uploads.map((u) => `  image   ${u.ref}: ${u.file}`)].join('\n');
    return [
      `${t.universe ?? ''}/${t.name} v${t.version ?? '?'} published (${r.warnings} warning(s) of theme check)`,
      ...r.uploads.map((u) => `  image   ${u.ref} → ${u.id}`),
      ...(r.corrected ?? []).map((c) => `  corrected ${c.path}: ${String(c.value)}`),
      ...(r.removed?.length ? [`  removed ${r.removed.join(', ')} (computed by the platform)`] : []),
    ].join('\n');
  },
  quiet: (r) => (r.theme as { name?: string }).name,
};

const PROFILE_FIELDS = ['description', 'image', 'theme', 'universeStrip', 'firstFocus', 'layoutRef', 'switcherLayouts', 'readerRetouches', 'clear'];
const profileOnly = (kept: string) => PROFILE_FIELDS.filter((f) => f !== kept).map((f) => `input.${f}`);
export const themeApply = apiCommand({ name: 'theme apply', summary: 'Make a theme the theme of a universe (setUniverseProfile; the leadership, the owner, the admins)', kind: 'mutation', op: 'setUniverseProfile', positionals: ['input.theme'], rename: { universe: 'to' }, require: ['theme'],
  hide: profileOnly('theme'),
  descriptions: { to: 'The universe (%name)', theme: 'The theme: %universe/name' }, depth: 1,
  description: 'Without leadership, a public universe changes its theme by a proposal of the kind THEME: breakrocks proposals file %u --kind THEME --title … --theme %x/name.',
  examples: ['breakrocks theme apply %paris/stade-nuit --to %paris'] });
export const themeTry = apiCommand({ name: 'theme try', summary: 'Try a theme as the personal theme for 24 hours (setTriedTheme)', kind: 'mutation', op: 'setTriedTheme', positionals: ['theme'], require: ['theme'],
  descriptions: { theme: 'The theme: %universe/name' }, examples: ['breakrocks theme try %paris/stade-nuit'] });
export const themeUndoTry = apiCommand({ name: 'theme undo-try', summary: 'Stop trying a theme: the former one comes back (setTriedTheme)', kind: 'mutation', op: 'setTriedTheme', fixed: { theme: null }, examples: ['breakrocks theme undo-try'] });
export const themePersonalSet = apiCommand({ name: 'theme personal set', summary: 'Set the personal theme (and its settings: accent, density, motion, post transparency…)', kind: 'mutation', op: 'setPersonalTheme', positionals: ['input.theme'],
  descriptions: { clear: 'The settings removed (ACCENT, DEVICE_DISPLAY_MODE)', postTransparency: 'The post transparency: OPAQUE (100), THEME (the surface opacity of the theme, the default), MORE (20 points less) or LIQUID (40 points less), at least 0; the post, repost, reply and quote cards and the frame of the composer, on every universe and on the home feed' },
  examples: ['breakrocks theme personal set %paris/stade-nuit', 'breakrocks theme personal set --display-mode NIGHT --density DENSE', 'breakrocks theme personal set --post-transparency LIQUID'] });
export const themePersonalClear = apiCommand({ name: 'theme personal clear', summary: 'Back to Socle as the personal theme', kind: 'mutation', op: 'setPersonalTheme', fixed: { 'input.theme': { universe: '%root', name: 'socle' } }, hide: ['accent', 'density', 'device', 'deviceDisplayMode', 'displayMode', 'motion', 'myThemeEverywhere', 'postTransparency', 'readableTypeface', 'sounds', 'textScale', 'clear'].map((f) => `input.${f}`), examples: ['breakrocks theme personal clear'] });
export const themeCopy = apiCommand({ name: 'theme copy', summary: 'Copy a theme under a new name (a personal theme, or published in --target)', kind: 'mutation', op: 'copyTheme', positionals: ['theme'],
  extra: { theme: { type: 'string', pattern: REF, description: 'The theme copied: %universe/name' } }, hide: ['universe', 'name'], require: ['theme'], prepare: (i) => { const r = ref(String(i.theme)); return { ...i, universe: r.universe, name: r.name }; }, rename: { targetUniverse: 'target' }, descriptions: { as: 'The name of the copy', target: 'The universe to publish the copy in' }, depth: 1,
  examples: ['breakrocks theme copy %root/arena --as mon-arena', 'breakrocks theme copy %root/arena --as arena-paris --target %paris'] });
export const themeDelete = apiCommand({ name: 'theme delete', summary: 'Delete a theme one published (it stays applied where it is)', kind: 'mutation', op: 'deleteTheme', positionals: ['theme'],
  extra: { theme: { type: 'string', pattern: REF, description: 'The theme: %universe/name' } }, hide: ['universe', 'name'], require: ['theme'], prepare: (i) => { const r = ref(String(i.theme)); return { ...i, universe: r.universe, name: r.name }; }, confirm: (i) => `Delete the theme ${i.theme}?`,
  examples: ['breakrocks theme delete %paris/stade-nuit --yes'] });

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
  examples: ['breakrocks theme export %test-village-multisport/sport-gabriel-04 --out sport/', 'breakrocks theme export %paris/stade-nuit --out stade-nuit.zip --zip'],
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
  examples: ['breakrocks theme shots %paris/stade-nuit --out shots/'],
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

const layoutRefInput = { layout: { type: 'string', pattern: REF, description: 'The layout: %universe/name' } } as const;
const fromLayout = (i: Record<string, unknown>) => { const r = ref(String(i.layout), 'layout'); return { ...i, universe: r.universe, name: r.name }; };
export const layoutCommands = [
  apiCommand({ name: 'layouts list', summary: 'The layout catalog (layoutCatalog)', kind: 'query', op: 'layoutCatalog', rename: { collection: 'field' }, examples: ['breakrocks layouts list --field SPORT'] }),
  apiCommand({ name: 'layouts show', summary: 'A layout', kind: 'query', op: 'layout', positionals: ['layout'], extra: { ...layoutRefInput }, hide: ['universe', 'name'], require: ['layout'], prepare: fromLayout, examples: ['breakrocks layouts show %root/feed-first'] }),
  apiCommand({ name: 'layouts check', summary: 'Check a layout document against the registry of the universe (checkLayout)', kind: 'query', op: 'checkLayout', positionals: ['document'], rename: { universe: 'in' }, descriptions: { document: 'The layout document: @file.json, or its JSON', in: 'The universe (%name)' }, examples: ['breakrocks layouts check @layout.json --in %paris'] }),
  apiCommand({ name: 'layouts publish', summary: 'Publish a layout in a universe: a layout of the same name gets its next version (publishLayout)', kind: 'mutation', op: 'publishLayout', positionals: ['document'], rename: { universe: 'in' }, descriptions: { document: 'The layout document: @file.json, or its JSON', in: 'The universe (%name)' }, examples: ['breakrocks layouts publish @layout.json --in %paris'] }),
  apiCommand({ name: 'layouts publish-version', summary: 'Publish a new version of a layout (publishLayout, as layouts publish: kept for the scripts)', kind: 'mutation', op: 'publishLayout', positionals: ['document'], rename: { universe: 'in' }, descriptions: { document: 'The layout document: @file.json, or its JSON (its name names the layout)', in: 'The universe (%name)' }, examples: ['breakrocks layouts publish-version @layout.json --in %paris'] }),
  apiCommand({ name: 'layouts apply', summary: 'Make a layout the default one of a universe (setUniverseProfile)', kind: 'mutation', op: 'setUniverseProfile', positionals: ['input.layoutRef'], rename: { universe: 'to', 'input.layoutRef': 'layout' }, require: ['layout'],
    hide: profileOnly('layoutRef'), descriptions: { to: 'The universe (%name)', layout: 'The layout: %universe/name' }, depth: 1, examples: ['breakrocks layouts apply %root/agora --to %paris'] }),
  apiCommand({ name: 'layouts copy', summary: 'Copy a layout under a new name', kind: 'mutation', op: 'copyLayout', positionals: ['layout'], extra: { ...layoutRefInput }, hide: ['universe', 'name'], require: ['layout'], prepare: fromLayout, rename: { targetUniverse: 'target' }, descriptions: { as: 'The name of the copy', target: 'The universe to publish the copy in' }, examples: ['breakrocks layouts copy %root/agora --as mon-agora --target %paris'] }),
  apiCommand({ name: 'layouts retouch', summary: 'Retouch a layout for oneself in a universe (setLayoutRetouches)', kind: 'mutation', op: 'setLayoutRetouches', positionals: ['universe'], descriptions: { retouches: 'The retouches: a JSON array of { "widget", "canvas", "state", "variant" }', layout: 'The layout: %universe/name' }, examples: ['breakrocks layouts retouch %paris --layout %root/feed-first --retouches \'[{"widget":"agenda","canvas":"MAIN","state":"HIDDEN"}]\''] }),
  apiCommand({ name: 'layouts reset-retouches', summary: 'Remove one\'s retouches in a universe', kind: 'mutation', op: 'resetLayoutRetouches', positionals: ['universe'], examples: ['breakrocks layouts reset-retouches %paris'] }),
  apiCommand({ name: 'layouts delete', summary: 'Delete a layout one published', kind: 'mutation', op: 'deleteLayout', positionals: ['layout'], extra: { ...layoutRefInput }, hide: ['universe', 'name'], require: ['layout'], prepare: fromLayout, confirm: (i) => `Delete the layout ${i.layout}?`, examples: ['breakrocks layouts delete %paris/ma-page --yes'] }),
];

export const studioCommands = [
  apiCommand({ name: 'studio drafts', summary: 'The drafts of the studio', kind: 'query', op: 'studioDrafts', examples: ['breakrocks studio drafts --json'] }),
  apiCommand({ name: 'studio show', summary: 'A draft of the studio', kind: 'query', op: 'studioDraft', positionals: ['id'], examples: ['breakrocks studio show <id>'] }),
  apiCommand({ name: 'studio save', summary: 'Save a draft (a theme or a layout) in the studio', kind: 'mutation', op: 'saveStudioDraft', positionals: ['document'], rename: { draftId: 'id' }, descriptions: { document: 'The document: @file.json, or its JSON', id: 'The draft to replace', kind: 'THEME or LAYOUT', universe: 'The universe it is for' }, examples: ['breakrocks studio save @theme.json --kind THEME --universe %paris'] }),
  apiCommand({ name: 'studio delete', summary: 'Delete a draft of the studio', kind: 'mutation', op: 'deleteStudioDraft', positionals: ['draftId'], rename: { draftId: 'id' }, descriptions: { id: 'The draft' }, confirm: (i) => `Delete the draft ${i.id}?`, examples: ['breakrocks studio delete <id> --yes'] }),
  apiCommand({ name: 'studio use', summary: 'Use a draft of the studio: a theme or a layout made the one of its universe (or the proposal filed), a page published (useStudioDraft)', kind: 'mutation', op: 'useStudioDraft', positionals: ['draftId'], descriptions: { draftId: 'The id of the draft (studio drafts)' }, examples: ['breakrocks studio use <draft id>'] }),
  apiCommand({ name: 'studio make-theme', summary: 'Publish a theme draft and make it the theme of its universe, or file the proposal (useStudioDraft)', kind: 'mutation', op: 'useStudioDraft', positionals: ['draftId'], descriptions: { draftId: 'The id of the theme draft' }, examples: ['breakrocks studio make-theme <draft id>'] }),
  // Universe theme trials and draft previews.
  apiCommand({ name: 'studio try', summary: 'Try a theme draft as the theme of its universe for 24 hours, for every reader (startUniverseThemeTrial)', kind: 'mutation', op: 'startUniverseThemeTrial', positionals: ['draftId'],
    description: 'Who may make the draft the universe theme at once (the leadership of a public universe; the owner and the admins of a private one) starts a trial: every reader sees the draft, validated as at publication but not published, for 24 hours; a new trial ends the former one; studio end-try ends it, studio make-theme publishes it. A universe without leadership has no trial (THEME_TRIAL_WITHOUT_LEADERSHIP); a layout draft is refused (STUDIO_DRAFT_KIND_INVALID).',
    descriptions: { draftId: 'The id of the theme draft (studio drafts)' }, select: '{ universe draftId version startedAt endsAt startedBy { id handle displayName } }',
    text: (r) => { const t = r as { universe: string; draftId: string; version: number; endsAt: string }; return `${t.universe}: trial of the draft ${t.draftId} (v${t.version}) until ${t.endsAt}`; },
    examples: ['breakrocks studio try <draft id>'] }),
  apiCommand({ name: 'studio end-try', summary: 'End the universe theme trial of a universe: its theme comes back (endUniverseThemeTrial)', kind: 'mutation', op: 'endUniverseThemeTrial', positionals: ['universe'],
    description: 'Any member of the leadership (the owner and the admins of a private universe) ends it, its author or not. THEME_TRIAL_NOT_FOUND when none is under way.', examples: ['breakrocks studio end-try %paris'] }),
  apiCommand({ name: 'studio preview', summary: 'Preview a theme draft on its universe for oneself, for 24 hours (startDraftPreview)', kind: 'mutation', op: 'startDraftPreview', positionals: ['draftId'],
    description: 'Only its author sees it; the others keep the universe theme; for its author, a preview goes before a universe theme trial. A layout draft is refused (STUDIO_DRAFT_KIND_INVALID).',
    descriptions: { draftId: 'The id of the theme draft (studio drafts)' }, select: '{ universe draftId version endsAt }',
    text: (r) => { const t = r as { universe: string; draftId: string; version: number; endsAt: string }; return `${t.universe}: preview of the draft ${t.draftId} (v${t.version}) until ${t.endsAt}`; },
    examples: ['breakrocks studio preview <draft id>'] }),
  apiCommand({ name: 'studio end-preview', summary: 'End one\'s draft preview on a universe (endDraftPreview)', kind: 'mutation', op: 'endDraftPreview', positionals: ['universe'],
    description: 'THEME_TRIAL_NOT_FOUND when none is under way.', examples: ['breakrocks studio end-preview %paris'] }),
  apiCommand({ name: 'studio make-layout', summary: 'Publish a layout draft and make it the layout of its universe, or file the proposal (useStudioDraft)', kind: 'mutation', op: 'useStudioDraft', positionals: ['draftId'], descriptions: { draftId: 'The id of the layout draft' }, examples: ['breakrocks studio make-layout <draft id>'] }),
];
