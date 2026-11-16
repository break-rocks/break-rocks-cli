// The theme catalog and the page of a theme in text (themes gallery, themes list, themes show): a header naming the
// columns, the rows grouped by section (the reason of the catalog), a theme of an earlier section told there once
// ("also in MOST_USED") instead of listed again, the next page as a command line, the palettes as swatches. The JSON
// is the answer of the API, untouched.
import { paint, swatch } from '../colour.js';
import { kebab } from '../schema.js';
import { PLACEMENTS } from '../tree.js';
import { imageLinks, openableLinks, SIGNED_LINKS, signedLinksLine, type SignedLinks } from './media-links.js';

type ThemeOfItem = { universe?: string | null; name: string; version?: number; collection?: string | null; document?: unknown };
export type CatalogItem = {
  theme: ThemeOfItem; reason?: string; starred?: boolean; variant?: string; palette?: string[]; screenshots?: string[];
  universeCount?: number; accountCount?: number; hasImage?: boolean | null; look?: { name?: string } | null;
};
export type CatalogPage = { items?: CatalogItem[]; next?: string | null } | null;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const PALETTE_KEYS = ['background', 'surface', 'text', 'primary', 'accent', 'link'] as const;
/** The image slots a theme document may fill: the two the platform shows, the two it ignores since v99. */
export const IMAGE_SLOTS = ['page', 'pageHeader', 'timeColumn', 'channelHeader'] as const;

/** The document of a theme (served as a JSON string), or {}. */
export function documentOf(t: { document?: unknown }): Record<string, unknown> {
  try {
    const doc = typeof t.document === 'string' ? JSON.parse(t.document) as unknown : t.document;
    return isObject(doc) ? doc : {};
  } catch { return {}; }
}

/** The image slots its document fills (page, pageHeader, timeColumn, channelHeader). */
export function filledSlots(doc: Record<string, unknown>): string[] {
  const slots = isObject(doc.imageSlots) ? doc.imageSlots : {};
  return IMAGE_SLOTS.filter((k) => { const v = slots[k]; return typeof v === 'string' ? v !== '' : isObject(v) && Object.values(v).some((x) => typeof x === 'string' && x !== ''); });
}

const ref = (t: ThemeOfItem) => `${t.universe ?? ''}/${t.name}`;
const quote = (v: string) => (/^[\w@./:,+=-]+$/u.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`);

/** "eyIwIjoiMDAw…": a cursor shortened for the text (the JSON holds it whole). */
export const shortCursor = (cursor: string) => (cursor.length > 13 ? `${cursor.slice(0, 12)}…` : cursor);

/** The command line that asked [input] of [command] (its place in the tree), without its paging. */
export function commandLine(command: string, input: Record<string, unknown>, positionals: string[]): string {
  const words = ['breakrocks', ...(PLACEMENTS.get(command)?.path ?? command).split(' ')];
  for (const p of positionals) if (input[p] !== undefined) words.push(quote(String(input[p])));
  for (const [k, v] of Object.entries(input)) {
    if (positionals.includes(k) || ['after', 'all', 'max'].includes(k) || v === undefined || v === false || v === null) continue;
    if (v === true) words.push(`--${kebab(k)}`);
    else for (const x of Array.isArray(v) ? v : [v]) words.push(`--${kebab(k)}`, quote(String(x)));
  }
  return words.join(' ');
}

/**
 * The line of the next page: the command again with --all (with --all already given and its --max reached, a larger
 * --max), the cursor shortened (the whole one in --json).
 */
export function nextLine(next: string, line: string, input: Record<string, unknown> = {}): string {
  const max = typeof input.max === 'number' ? input.max : 10;
  const all = input.all === true ? (max < 100 ? ` --all --max ${Math.min(100, max * 2)}` : '') : ' --all';
  return `more: ${line}${all}  (or --after ${shortCursor(next)}; --json holds the full cursor)`;
}

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].length));

/**
 * A page of the theme catalog in text: a header, then each section (its reason, in the order served) with its
 * rows; a theme already listed in an earlier section is not listed again, its first row says "also in <section>".
 */
export function catalogText(page: CatalogPage, line: string, input: Record<string, unknown> = {}): string {
  const items = page?.items ?? [];
  if (!items.length) return page?.next ? `(none)\n${nextLine(page.next, line, input)}` : '(none)';
  const sections = new Map<string, CatalogItem[]>();
  for (const x of items) { const r = x.reason ?? '-'; if (!sections.has(r)) sections.set(r, []); sections.get(r)!.push(x); }
  const first = new Map<string, { item: CatalogItem; also: string[] }>();
  const shown = new Map<string, CatalogItem[]>();
  const repeated = new Map<string, number>();
  for (const [reason, xs] of sections) {
    shown.set(reason, []);
    for (const x of xs) {
      const key = ref(x.theme);
      const seen = first.get(key);
      if (!seen) { first.set(key, { item: x, also: [] }); shown.get(reason)!.push(x); }
      else {
        if (seen.item.reason !== reason && !seen.also.includes(reason)) seen.also.push(reason);
        repeated.set(reason, (repeated.get(reason) ?? 0) + 1);
      }
    }
  }
  const cells = (x: CatalogItem) => {
    const doc = documentOf(x.theme);
    const typography = isObject(doc.typography) ? doc.typography : {};
    const slots = filledSlots(doc);
    return [
      `${x.starred ? '*' : ' '} ${ref(x.theme)}`, `v${x.theme.version ?? '?'}`, x.theme.collection ?? '-',
      typeof typography.title === 'string' ? typography.title : '?', slots.length ? `img ${slots.length}` : x.hasImage ? 'img' : 'no image',
      String(x.screenshots?.length ?? 0), String(x.universeCount ?? 0), String(x.accountCount ?? 0),
    ];
  };
  const header = ['  theme', 'ver', 'field', 'typeface', 'images', 'shots', 'univ', 'acct'];
  const rows = items.map(cells);
  const widths = header.map((h, i) => Math.max([...h].length, ...rows.map((r) => [...r[i]].length)));
  const variant = (items[0].variant ?? 'night').toLowerCase();
  const out = [paint.dim(`${header.map((h, i) => pad(h, widths[i])).join('  ')}  ${variant} palette: ${PALETTE_KEYS.join(' ')}`)];
  for (const [reason, xs] of shown) {
    const again = repeated.get(reason) ?? 0;
    out.push(paint.bold(`${reason} (${xs.length + again}${again ? `, ${again} listed above` : ''})`));
    for (const x of xs) {
      const c = cells(x);
      const also = first.get(ref(x.theme))!.also;
      const palette = (x.palette ?? []).map(swatch).join(' ');
      out.push(`${c.map((s, i) => pad(s, widths[i])).join('  ')}  ${palette}${x.look?.name ? `  look ${x.look.name}` : ''}${also.length ? paint.dim(`  also in ${also.join(', ')}`) : ''}`.trimEnd());
    }
  }
  if (page?.next) out.push(nextLine(page.next, line, input));
  return out.join('\n');
}

type ServedImage = { url?: string | null; urlNight?: string | null; widths?: number[]; widthsNight?: number[]; removed?: boolean | null } | null;
export type ThemeServed = {
  universe?: string | null; name: string; version?: number; description?: string | null; collection?: string | null; official?: boolean; format?: string; contrastLevel?: string;
  creator?: { handle?: string } | null; typography?: { title?: string | null; accent?: string | null } | null; corrected?: string[]; universeCount?: number; accountCount?: number; document?: unknown;
  createdAt?: string; updatedAt?: string; deleted?: boolean; copiedFrom?: { universe?: string | null; name?: string } | null;
  signedLinks?: SignedLinks; imageSlots?: Record<string, ServedImage>; screenshots?: string[]; screenshotsDay?: string[]; pageScreenshots?: Record<string, { url?: string | null; urlNight?: string | null } | null> | null;
};

const SLOT_LABELS: Record<string, string> = { page: 'page', pageHeader: 'pageHeader (banner)', timeColumn: 'timeColumn', channelHeader: 'channelHeader' };

/** [t] with the links that open on each image slot ("links", media-links.ts), and the answer to --signed-links. */
export function withLinks<T extends ThemeServed>(t: T, signed?: boolean): T & { signedLinks?: SignedLinks } {
  const slots = t.imageSlots ? Object.fromEntries(Object.entries(t.imageSlots).map(([k, v]) => [k, v && !v.removed ? { ...v, links: imageLinks(v) } : v])) : t.imageSlots;
  return { ...t, ...(t.imageSlots ? { imageSlots: slots } : {}), ...(signed ? { signedLinks: SIGNED_LINKS } : {}) };
}

/** The page of a theme in text: what it is, its palettes, its typefaces, its image slots, its screenshots, its use. */
export function themeText(t: ThemeServed): string {
  const doc = documentOf(t);
  const address = `${t.universe ?? ''}/${t.name}`;
  const appearance = isObject(doc.appearance) ? doc.appearance : undefined;
  const typography = isObject(doc.typography) ? doc.typography : {};
  const accent = t.typography?.accent ?? (typeof typography.accent === 'string' ? typography.accent : undefined);
  const variants = isObject(doc.variants) ? doc.variants : {};
  const docSlots = isObject(doc.imageSlots) ? doc.imageSlots : {};
  const filled = new Set(filledSlots(doc));
  const label = (k: string) => pad(k, 15);
  const out = [
    `${paint.bold(address)} v${t.version ?? '?'}${t.official ? '  official' : ''}${t.deleted ? '  deleted' : ''}`,
    ...(t.description ? [`  ${t.description}`] : []),
    `  ${label('universe')}${t.universe ?? 'none (a personal theme)'}`,
    `  ${label('collection')}${t.collection ?? '-'}`,
    `  ${label('creator')}${t.creator?.handle ? `@${t.creator.handle}` : '?'}${t.copiedFrom ? `  copied from ${t.copiedFrom.universe ?? ''}/${t.copiedFrom.name ?? '?'}` : ''}`,
    `  ${label('created')}${t.createdAt ?? '?'}  updated ${t.updatedAt ?? '?'}`,
    `  ${label('contrast')}${t.contrastLevel ?? '?'}`,
    `  ${label('typefaces')}title ${t.typography?.title ?? (typeof typography.title === 'string' ? typography.title : '?')}${accent ? `, accent ${accent}` : ''}`,
    `  ${label('used by')}${t.universeCount ?? 0} universes, ${t.accountCount ?? 0} accounts`,
  ];
  for (const v of ['night', 'day']) {
    const p = isObject(variants[v]) && isObject((variants[v] as Record<string, unknown>).palette) ? (variants[v] as Record<string, Record<string, unknown>>).palette : undefined;
    if (p) out.push(`  ${label(`${v} palette`)}${PALETTE_KEYS.filter((k) => typeof p[k] === 'string').map((k) => `${k} ${swatch(p[k] as string)}`).join('  ')}`);
  }
  out.push(`  ${label('page image')}shows ${appearance && typeof appearance.imageShows === 'string' ? appearance.imageShows : 'subtle'}${appearance?.sky ? `, sky ${String(appearance.sky)}` : ''}`);
  out.push('  images');
  const widths = (w?: number[]) => (w?.length ? ` (${w.join(', ')})` : '');
  for (const k of IMAGE_SLOTS) {
    const served = t.imageSlots?.[k];
    const name = `    ${pad(SLOT_LABELS[k], 20)}`;
    if (served?.removed) out.push(`${name}removed by the platform team`);
    else if (served && (served.url || served.urlNight)) {
      const lines = [...openableLinks(served.url, served.widths, 'day'), ...openableLinks(served.urlNight, served.widthsNight, 'night')].map((l, i, all) => {
        const largest = i > 0 && all[i - 1].variant === l.variant;
        const first = !largest ? widths(l.variant === 'day' ? served.widths : served.widthsNight) : '';
        return `${l.variant}${largest ? ' largest' : ''} ${l.url}${first}`;
      });
      lines.forEach((l, i) => out.push(`${i ? `    ${pad('', 20)}` : name}${l}`));
    } else if (filled.has(k)) out.push(`${name}${k === 'timeColumn' || k === 'channelHeader' ? 'in the document, ignored by the platform since specs v99' : 'in the document, not served'}`);
    else if (k in docSlots || k === 'page' || k === 'pageHeader') out.push(`${name}none`);
  }
  for (const [title, urls] of [['night', t.screenshots], ['day', t.screenshotsDay]] as const) {
    out.push(`  screenshots ${title} (${urls?.length ?? 0})`);
    for (const u of urls ?? []) out.push(`    ${u}`);
  }
  const shots = Object.entries(t.pageScreenshots ?? {}).filter(([, v]) => v && (v.url || v.urlNight));
  out.push(`  page of a universe${shots.length ? '' : ': none yet'}`);
  for (const [bp, v] of shots) out.push(`    ${pad(bp, 8)}${v!.url ? `day ${v!.url}` : ''}${v!.url && v!.urlNight ? '  ' : ''}${v!.urlNight ? `night ${v!.urlNight}` : ''}`);
  out.push(paint.dim(`  download them: breakrocks look themes shots ${quote(address)} --out <folder>`));
  if ((t.corrected ?? []).length) out.push(`  corrected at publication: ${t.corrected!.join(', ')}`);
  if (t.signedLinks) out.push(`  ${signedLinksLine(t.signedLinks)}`);
  return out.join('\n');
}
