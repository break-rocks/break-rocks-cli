// The pages of a universe: the menu (Universe.pages, pagesVersion), a page and its document, the publication of a
// custom page from a JSON file (an entry of pages[], or a document break-rocks-layout/3), its check
// (checkLayout with { format: "break-rocks-layout/3", pages: [page] }: the backend has no
// checkUniversePage), hiding, order, deletion, the export and the import of the pages, the report of
// a page or of one of its free blocks. The check is online: the shared library of the design
// (design/lib/layout) is not shipped in the CLI.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { apiCommand } from '../api/command.js';
import { outputSchema } from '../api/graphql.js';
import type { Context } from '../context.js';
import { CliError, usageError } from '../errors.js';
import type { Command } from '../registry.js';
import { bool, list, object, openObject, str } from '../schema.js';
import { uuidv7 } from '../ids.js';
import { api } from '../session.js';

export const PAGES_FORMAT = 'break-rocks-layout/3';
/** A page without its document (the menu). */
const PAGE = '{ universe kind name icon order hidden removed version modifiedAt url }';
const u = { universe: 'The universe (%name)', name: 'The name of the page (a custom page, or the keyword of a base page)' };

type Page = { universe: string; kind: string; name: string; icon?: string | null; order?: number | null; hidden: boolean; removed: boolean; version?: number | null; modifiedAt?: string | null; url: string; document?: unknown };
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const parsed = (v: unknown) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return v; } };

/** The JSON of a file (INVALID_INPUT when it is none). */
function readJsonFile(ctx: Context, file: string): unknown {
  const path = resolve(ctx.io.cwd, file);
  if (!existsSync(path)) throw usageError('FILE_NOT_FOUND', `No file ${file}`, { file });
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { throw usageError('INVALID_INPUT', `${file}: not JSON`, { file }); }
}

/** The page of a file: the file itself (an entry of pages[]), or the page of a document /3 (the one named, or its only one). */
export function pageOfDocument(doc: unknown, name?: string): Record<string, unknown> {
  if (!isObject(doc)) throw usageError('INVALID_INPUT', 'A page is a JSON object');
  if (!Array.isArray(doc.pages)) {
    if (name && doc.name !== name) throw usageError('INVALID_INPUT', `The page of the file is "${String(doc.name)}", not "${name}"`);
    return doc;
  }
  if (doc.format !== PAGES_FORMAT) throw usageError('LAYOUT_FORMAT_INVALID', `A document of pages has the format ${PAGES_FORMAT}, not ${JSON.stringify(doc.format)}`);
  const pages = doc.pages.filter(isObject);
  const page = name ? pages.find((p) => p.name === name) : pages.length === 1 ? pages[0] : undefined;
  if (!page) throw usageError('INVALID_INPUT', name ? `No page "${name}" in the document` : `The document has ${pages.length} pages: --name tells which one`, { pages: pages.map((p) => p.name) });
  return page;
}

const limitOf = (e: CliError) => (e.details.errorInfo as { limit?: number } | undefined)?.limit;
/** The refusals of a publication, told plainly (the code of the contract kept). */
export function explainPageRefusal(error: unknown): unknown {
  if (!(error instanceof CliError) || error.source !== 'platform') return error;
  const limit = limitOf(error);
  const said: Record<string, string> = {
    PAGE_VERSION_CONFLICT: 'The page was published again since the version this one starts from: read it again (universes page get --document), make the change on it, publish again',
    PAGE_NAME_TAKEN: 'Another page of the universe has this name (case and lookalikes ignored): choose another name',
    PAGE_NAME_RESERVED: 'home, governance, agenda, members and about are the base pages: choose another name',
    PAGES_LIMIT: `A universe has at most ${limit ?? 10} custom pages, the hidden ones counted`,
    CANVAS_ITEMS_LIMIT: `A canvas holds at most ${limit ?? 40} widgets and free blocks, those of its rails included`,
    PAGE_EDIT_NOT_ALLOWED: 'Only the leadership edits the pages of a universe (the owner and the admins of a private universe)',
    PAGE_HEADING_REQUIRED: 'A custom page has a heading of level 2 (## …) in one of its text blocks',
    BLOCK_IMAGE_ALT_REQUIRED: 'Every image block has its alternative text (content.alt)',
  };
  return said[error.code] ? new CliError(error.code, said[error.code], error.exit, error.details, error.source) : error;
}

const pageText = (p: Page) => `${p.order ? `${p.order}. ` : ''}${p.name} (${p.kind}${p.version ? ` v${p.version}` : ''})${p.hidden ? ' [hidden]' : ''}${p.removed ? ' [removed]' : ''}  ${p.url}`;

type PagesAnswer = { universe: string; pagesVersion: number; pages: Page[] };
export const universePages: Command<{ universe: string }, PagesAnswer> = {
  name: 'universes pages', summary: 'The pages of a universe, in the order of its main menu (Universe.pages, pagesVersion)',
  description: 'The base pages (home, governance, agenda, members, about) and the custom pages; the hidden ones are listed for the governance of the universe only. pagesVersion grows at each change: read again when it changed.',
  examples: ['breakrocks universes pages %paris', 'breakrocks universes pages %paris --json'],
  input: object({ universe: str(u.universe) }, ['universe']),
  output: openObject({ universe: str('The universe'), pagesVersion: { type: 'integer', description: 'Grows at each change of a page, its order or its hiding' }, pages: list('The pages', outputSchema('PageOfUniverse', 0)) }),
  args: { positionals: ['universe'] },
  run: async (ctx, { universe }) => {
    const r = (await api<{ universe: { name: string; pagesVersion: number; pages: Page[] } | null }>(ctx, `query($n: String!) { universe(name: $n) { name pagesVersion pages ${PAGE} } }`, { n: universe })).universe;
    if (!r) throw usageError('UNIVERSE_NOT_FOUND', `No universe ${universe}`, { universe });
    return { universe: r.name, pagesVersion: r.pagesVersion, pages: r.pages };
  },
  text: (r) => [`${r.universe}: pages version ${r.pagesVersion}`, ...r.pages.map(pageText)].join('\n'),
};

export const pageGet: Command<{ universe: string; name: string; document?: boolean }, Page> = {
  name: 'universes page get', summary: 'A page of a universe; --document its document as served (pageOfUniverse)',
  description: 'The document of a custom page is its three canvases, derived ones included, and its blocks with their served fields; publish a change from it (its version is the one a new publication starts from). PAGE_NOT_FOUND when there is no such page.',
  examples: ['breakrocks universes page get %paris market', 'breakrocks universes page get %paris market --document --json > market.json'],
  input: object({ universe: str(u.universe), name: str(u.name), document: bool('With its document') }, ['universe', 'name']),
  output: outputSchema('PageOfUniverse', 0), args: { positionals: ['universe', 'name'] },
  run: async (ctx, { universe, name, document }) => {
    const sel = document ? PAGE.replace(' }', ' document }') : PAGE;
    const p = (await api<{ pageOfUniverse: Page | null }>(ctx, `query($u: String!, $n: String!) { pageOfUniverse(universe: $u, name: $n) ${sel} }`, { u: universe, n: name })).pageOfUniverse;
    if (!p) throw usageError('PAGE_NOT_FOUND', `No page ${name} in ${universe}`, { universe, name });
    return document ? { ...p, document: parsed(p.document) } : p;
  },
  text: (p) => [pageText(p), ...(p.modifiedAt ? [`modified ${p.modifiedAt}`] : []), ...(p.document !== undefined ? [JSON.stringify(p.document, null, 2)] : [])].join('\n'),
  quiet: (p) => p.name,
};

type FileInput = { universe: string; file: string; name?: string };
const fileProps = { universe: str(u.universe), file: str(`The page: a JSON file, one entry of pages[] or a document ${PAGES_FORMAT}`), name: str('The page of a document of several pages') };

export const pagePublish: Command<FileInput, Page> = {
  name: 'universes page publish', summary: 'Publish a custom page from a JSON file: a new page, or the next version of one (publishUniversePage)',
  description: 'The leadership (the owner and the admins of a private universe). The same name as written makes the next version (from the version the file holds: PAGE_VERSION_CONFLICT when it is no longer the last); the limits come from the back office (PAGES_LIMIT, CANVAS_ITEMS_LIMIT with errorInfo.limit). Check first with universes page check.',
  examples: ['breakrocks universes page publish %paris --file market.json', 'breakrocks universes page publish %paris --file pages.json --name market'],
  input: object(fileProps, ['universe', 'file']), output: outputSchema('PageOfUniverse', 0), args: { positionals: ['universe'] },
  run: async (ctx, i) => {
    const page = pageOfDocument(readJsonFile(ctx, i.file), i.name);
    try {
      return (await api<{ publishUniversePage: Page }>(ctx, `mutation($u: String!, $p: AWSJSON!, $r: ID!) { publishUniversePage(universe: $u, page: $p, requestId: $r) ${PAGE} }`, { u: i.universe, p: JSON.stringify(page), r: uuidv7(ctx.now()) })).publishUniversePage;
    } catch (error) { throw explainPageRefusal(error); }
  },
  text: pageText, quiet: (p) => p.name,
};

type Check = { ok: boolean; refusals: { code: string; path?: string | null; widget?: string | null; limit?: number | null }[]; document?: unknown };
export const pageCheck: Command<FileInput, Check> = {
  name: 'universes page check', summary: 'Check a custom page against the registry of a universe, without publishing it (checkLayout)',
  description: `Sent as { format: "${PAGES_FORMAT}", pages: [page] } to checkLayout (online: the shared library of the design is not shipped in the CLI); each refusal with its code, path, widget and limit; exit 1 when there is one.`,
  examples: ['breakrocks universes page check %paris --file market.json'],
  input: object(fileProps, ['universe', 'file']),
  output: openObject({ ok: { type: 'boolean', description: 'No refusal' }, refusals: list('The refusals', outputSchema('LayoutRefusal', 0)), document: { description: 'The document as the platform reads it (derived canvases)' } }),
  args: { positionals: ['universe'] },
  run: async (ctx, i) => {
    const page = pageOfDocument(readJsonFile(ctx, i.file), i.name);
    const r = (await api<{ checkLayout: { document?: unknown; refusals: Check['refusals'] } }>(ctx, `query($d: AWSJSON!, $u: String!) { checkLayout(document: $d, universe: $u) { document refusals { code path widget limit } } }`, { d: JSON.stringify({ format: PAGES_FORMAT, pages: [page] }), u: i.universe })).checkLayout;
    return { ok: !r.refusals.length, refusals: r.refusals, ...(r.document != null ? { document: parsed(r.document) } : {}) };
  },
  text: (r) => (r.ok ? 'ok: no refusal' : r.refusals.map((x) => `${x.code}${x.path ? ` at ${x.path}` : ''}${x.widget ? ` (${x.widget})` : ''}${x.limit != null ? `, limit ${x.limit}` : ''}`).join('\n')),
  exitCode: (r) => (r.ok ? 0 : 1),
};

const hidden = (verb: 'hide' | 'show') => apiCommand({
  name: `universes page ${verb}`, summary: verb === 'hide' ? 'Hide a page from the main menu (agenda, members, a custom page; setUniversePageHidden)' : 'Show a hidden page in the main menu again', kind: 'mutation', op: 'setUniversePageHidden',
  positionals: ['universe', 'name'], fixed: { hidden: verb === 'hide' }, descriptions: u, select: PAGE, text: (p) => pageText(p as Page),
  description: 'The page of a universe, the governance page and the about page are never hidden (PAGE_NOT_HIDEABLE).',
  examples: [`breakrocks universes page ${verb} %paris agenda`],
});
export const pageHide = hidden('hide');
export const pageShow = hidden('show');
export const pageMove = apiCommand({
  name: 'universes page move', summary: 'Move a custom page in the main menu (before another, or last; moveUniversePage)', kind: 'mutation', op: 'moveUniversePage', positionals: ['universe', 'name'],
  descriptions: { ...u, before: 'The page to put it before (absent: last)' }, select: PAGE, text: (r) => (r as Page[]).map(pageText).join('\n'), examples: ['breakrocks universes page move %paris market --before quiz'],
});
export const pageDelete = apiCommand({
  name: 'universes page delete', summary: 'Delete a custom page, its versions and its free blocks (deleteUniversePage)', kind: 'mutation', op: 'deleteUniversePage', positionals: ['universe', 'name'],
  descriptions: u, confirm: (i) => `Delete the page ${i.name} of ${i.universe}, its versions and the images of its blocks?`, examples: ['breakrocks universes page delete %paris market --yes'],
});
const TARGET_FIELDS = ['agentText', 'proposalId', 'postId', 'imageId', 'messageId', 'discussion', 'universe', 'name', 'themePart', 'block', 'accountId', 'word'];
export const pageReport = apiCommand({
  name: 'universes page report', summary: 'Report a custom page or one of its free blocks (report UNIVERSE_PAGE)', kind: 'mutation', op: 'report', flatten: ['target'], positionals: ['target.universe', 'target.name'],
  fixed: { 'target.kind': 'UNIVERSE_PAGE' }, hide: TARGET_FIELDS.filter((f) => !['universe', 'name', 'block'].includes(f)).map((f) => `target.${f}`), rename: { 'target.name': 'page' }, require: ['universe', 'page'],
  description: 'In a public universe OFF_TOPIC, SPAM_OR_FLOOD and CHARTER_ARTICLE go to its moderation, ILLEGAL and PLATFORM_RULES to the platform team; in a private universe ILLEGAL and PLATFORM_RULES only. A base page is not reported (REPORT_TARGET_INVALID).',
  descriptions: { universe: u.universe, page: 'The name of the page', block: 'The id of a free block of the page (absent: the page)' }, depth: 1,
  examples: ['breakrocks universes page report %paris market --block b2 --reason PLATFORM_RULES'],
});
pageReport.input.properties.reason = { type: 'string', enum: ['OFF_TOPIC', 'SPAM_OR_FLOOD', 'CHARTER_ARTICLE', 'ILLEGAL', 'PLATFORM_RULES'], description: 'The reason (ReportReason)' };

type ExportAnswer = { universe: string; out?: string; pages: number; document?: unknown };
export const pagesExport: Command<{ universe: string; out?: string; force?: boolean }, ExportAnswer> = {
  name: 'universes pages export', summary: `Export the pages of a universe: the document ${PAGES_FORMAT} (exportUniversePages)`,
  description: 'Its images as upload ids. --out writes it to a file (--force replaces one); without it, the document is the answer.',
  examples: ['breakrocks universes pages export %paris --out paris-pages.json', 'breakrocks universes pages export %paris --json'],
  input: object({ universe: str(u.universe), out: str('The file to write'), force: bool('Replace the file') }, ['universe']),
  output: openObject({ universe: str('The universe'), out: str('The file written'), pages: { type: 'integer', description: 'Its custom pages' }, document: { description: `The document ${PAGES_FORMAT} (without --out)` } }),
  args: { positionals: ['universe'] },
  run: async (ctx, { universe, out, force }) => {
    const target = out ? resolve(ctx.io.cwd, out) : undefined;
    if (target && existsSync(target) && !force) throw usageError('FILE_EXISTS', `${out} exists: --force to replace it`);
    const doc = parsed((await api<{ exportUniversePages: unknown }>(ctx, 'query($u: String!) { exportUniversePages(universe: $u) }', { u: universe })).exportUniversePages);
    const pages = isObject(doc) && Array.isArray(doc.pages) ? doc.pages.length : 0;
    if (!target) return { universe, pages, document: doc };
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(doc, null, 2)}\n`);
    return { universe, out: target, pages };
  },
  text: (r) => (r.out ? `${r.pages} page(s) of ${r.universe} written to ${r.out}` : JSON.stringify(r.document, null, 2)),
  quiet: (r) => r.out,
};

type Draft = { id: string; kind: string; universe?: string | null; savedAt: string };
export const pagesImport: Command<{ universe: string; file: string }, Draft[]> = {
  name: 'universes pages import', summary: `Import a document ${PAGES_FORMAT}: one studio draft per page (importUniversePages)`,
  description: 'Nothing is published: each draft is checked like a studio draft, then published by breakrocks studio make-page <draft id> (STUDIO_DRAFTS_LIMIT: 50 drafts per account).',
  examples: ['breakrocks universes pages import %paris --file paris-pages.json'],
  input: object({ universe: str(u.universe), file: str(`The document ${PAGES_FORMAT} (a JSON file)`) }, ['universe', 'file']),
  output: list('The drafts made', outputSchema('StudioDraft', 0)), args: { positionals: ['universe'] },
  run: async (ctx, { universe, file }) => {
    const doc = readJsonFile(ctx, file);
    try {
      return (await api<{ importUniversePages: Draft[] }>(ctx, 'mutation($u: String!, $f: AWSJSON!, $r: ID!) { importUniversePages(universe: $u, file: $f, requestId: $r) { id kind universe savedAt } }', { u: universe, f: JSON.stringify(doc), r: uuidv7(ctx.now()) })).importUniversePages;
    } catch (error) { throw explainPageRefusal(error); }
  },
  text: (r) => (r.length ? [...r.map((d) => `${d.id}  ${d.kind} ${d.universe ?? ''}  ${d.savedAt}`), '', 'Publish one: breakrocks studio make-page <draft id>'].join('\n') : '(no draft)'),
};

export const studioMakePage = apiCommand({
  name: 'studio make-page', summary: 'Publish a page draft as the custom page of its universe (useStudioDraft)', kind: 'mutation', op: 'useStudioDraft', positionals: ['draftId'],
  descriptions: { draftId: 'The id of the draft (of kind PAGE)' }, select: `{ page ${PAGE} }`, map: (d) => (d as { page?: unknown } | null)?.page ?? null, examples: ['breakrocks studio make-page <draft id>'],
});

