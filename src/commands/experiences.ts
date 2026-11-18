// The experience definitions as portable documents (specs v136.3.0, D-423, D-424, contracts/experiences.md): list and
// show the experiences of route/1 and challenge/1, export the experience template of one as a JSON document, check a
// document (offline by the JSON Schema of the specs, then checkExperience), import documents (createExperience, or
// updateExperience with --update; private unless asked, PUBLIC through publishExperience and its experience check),
// one file or a folder, and the prompt kit that asks an external LLM for a document (offline: the CLI never calls an
// LLM and sends nothing). Every operation answers EXPERIENCES_NOT_OPEN while the switch experiences.open is off; a
// backend before v136.2.0 answers OPERATION_NOT_SERVED. A delegated agent creates and sets up an experience for its
// human (the Automated mark), never makes it public (EXPERIENCE_VISIBILITY_NOT_ALLOWED, refused before anything is sent).
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Context } from '../context.js';
import { CliError, EXIT, cliRefusal, platformRefusal, usageError, type ExitCode } from '../errors.js';
import { engineOf, keyOf, loadContract, platformFields, templateFormat, type Contract, type Json } from '../experiences/contract.js';
import { addressOf, checkLocally, documentText, onePerPath, parseDocument, portable, problemLines, sentBytes, type DocumentProblem } from '../experiences/document.js';
import { experiencePrompt, placesOf, type Place, type PromptResult } from '../experiences/prompt.js';
import { uuidv7 } from '../ids.js';
import { actsAsDelegatedAgent } from '../media.js';
import type { Command } from '../registry.js';
import { bool, int, list, object, openObject, str } from '../schema.js';
import { api } from '../session.js';
import { pages } from '../api/command.js';
import { served } from './explore-map.js';

const SINCE = 'v136.2.0';
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const servedExperiences = <T>(run: () => Promise<T>) => served('the experiences of route/1 and challenge/1', run, SINCE);

// ---- Reading an experience ----

type AccountRef = { id: string; handle: string };
type Experience = {
  id: string; address: string; url?: string; name: string; ownerAccount?: AccountRef | null; ownerUniverse?: string | null; title: string; instruction?: string; version: string;
  engine: { name: string; version: number }; visibility: string; check?: { status: string; explanation?: string | null; reviewPending: boolean; version: string } | null;
  warnings?: string[]; rankingMeasure?: string | null; rankingOrder?: string | null; copiedFrom?: string | null; adoptedBy?: string[]; automated?: boolean; via?: string | null; document?: unknown;
};
const FIELDS = 'id address url name ownerAccount { id handle } ownerUniverse title instruction version engine { name version } visibility check { status explanation reviewPending version } warnings rankingMeasure rankingOrder copiedFrom adoptedBy automated via';
const EXPERIENCE = `{ ${FIELDS} }`;
const WITH_DOCUMENT = `{ ${FIELDS} document }`;
const LIST_ITEM = '{ id address name ownerAccount { id handle } ownerUniverse title version engine { name version } visibility check { status reviewPending version } automated via }';

/** The engine of an experience as the registry writes it: "challenge/1" (the API names it CHALLENGE). */
const engineName = (e: { name: string; version: number }) => `${e.name.toLowerCase()}/${e.version}`;
/** Its owner, an account by its id beside its handle: "@alice (eu-123)", or a universe. */
const ownerText = (x: Experience) => (x.ownerAccount ? `@${x.ownerAccount.handle} (${x.ownerAccount.id})` : x.ownerUniverse ?? '?');
const checkText = (c: Experience['check']) => (c ? `${c.status.toLowerCase()}${c.reviewPending ? ', flagged to the platform team' : ''} (version ${c.version})${c.explanation ? `: ${c.explanation}` : ''}` : undefined);
const listLine = (x: Experience) => `${x.address}  ${engineName(x.engine)} v${x.version}  ${x.visibility}${x.check?.status === 'CHECKING' ? ' (being checked)' : ''}  ${x.title}  owner ${ownerText(x)}${x.automated ? `  Automated${x.via ? ` (${x.via})` : ''}` : ''}  [${x.id}]`;
function showText(x: Experience): string {
  return [
    `${x.address}  [${x.id}]`,
    `  ${x.title}`,
    ...(x.instruction ? [`  ${x.instruction}`] : []),
    `  engine ${engineName(x.engine)}, version ${x.version}, ${x.visibility}`,
    `  owner ${ownerText(x)}`,
    ...(checkText(x.check) ? [`  check ${checkText(x.check)}`] : []),
    ...(x.warnings?.length ? [`  warnings ${x.warnings.join(', ')}`] : []),
    ...(x.rankingMeasure ? [`  ranking ${x.rankingMeasure} ${x.rankingOrder ?? ''}`.trimEnd()] : []),
    ...(x.copiedFrom ? [`  copied from ${x.copiedFrom}`] : []),
    ...(x.adoptedBy?.length ? [`  adopted by ${x.adoptedBy.join(', ')}`] : []),
    ...(x.automated ? [`  Automated${x.via ? `, by the delegated agent ${x.via}` : ''}`] : []),
    ...(x.url ? [`  ${x.url}`] : []),
  ].join('\n');
}

const isAddress = (given: string) => /^[@%*]/.test(given.trim());
/** An experience by its address (@alice*squats-100, %paris*plank, *five-k; resolveAddress) or its id (experience). */
async function readExperience(ctx: Context, given: string, selection = EXPERIENCE): Promise<Experience> {
  const value = given.trim();
  if (isAddress(value)) {
    const r = (await api<{ resolveAddress: { experience: Experience | null } | null }>(ctx, `query($a: String!) { resolveAddress(address: $a) { experience ${selection} } }`, { a: value })).resolveAddress;
    if (!r?.experience) throw platformRefusal('EXPERIENCE_NOT_FOUND', `No experience at ${value} that you may read (an address of a place feat is read with map place-feats)`, { address: value });
    return r.experience;
  }
  const x = (await api<{ experience: Experience | null }>(ctx, `query($id: ID!) { experience(id: $id) ${selection} }`, { id: value })).experience;
  if (!x) throw platformRefusal('EXPERIENCE_NOT_FOUND', `No experience ${value} that you may read`, { id: value });
  return x;
}
const EXPERIENCE_ARG = str('The experience: its address (@alice*squats-100, %paris*plank-2-minutes, *five-k-under-30) or its id');

/** The handle of the caller (of its operator for a delegated agent): "@alice". */
async function myHandle(ctx: Context): Promise<string> {
  const me = (await api<{ me: { handle: string } | null }>(ctx, '{ me { handle } }')).me;
  if (!me) throw cliRefusal('ACCOUNT_NOT_FOUND', 'The account of the profile could not be read');
  return `@${me.handle}`;
}

// ---- list, show ----

type ListInput = { owner?: string; mine?: boolean; after?: string; limit?: number; all?: boolean; max?: number };
export const experiencesList: Command<ListInput, { items: Experience[]; next: string | null }> = {
  name: 'experiences list', summary: 'The experiences of an owner, yours by default (experiences)', api: 'experiences',
  description: 'The experiences of route/1 and challenge/1 of an owner, the most recently changed first: an account (@alice), a universe (%paris: its own and those it adopted) or the social platform (%root, or *). Yours (those of the account of your operator for a delegated agent) without --owner, or with --mine. For anyone but the owner, the PUBLIC ones only. The place feats are listed by map place-feats. EXPERIENCES_NOT_OPEN while the platform keeps experiences.open off.',
  examples: ['breakrocks experiences list', 'breakrocks experiences list --owner %paris --all', 'breakrocks experiences list --owner %root --json'],
  input: object({
    owner: str('The owner: @handle, %universe, or %root (or *) for the social platform'), mine: bool('Your experiences (the default without --owner)'),
    after: str('The cursor of the next page (the "next" of an answer)'), limit: int('How many per page, 1 to 50 (20 by default)', { minimum: 1, maximum: 50 }),
    all: bool('Follow the pages to the end (bounded by --max)'), max: int('Pages at most with --all', { minimum: 1, maximum: 100, default: 10 }),
  }),
  output: openObject({ items: list('The experiences', openObject({ id: str('Its id'), address: str('Its address'), title: str('Its title'), visibility: str('PRIVATE, UNLISTED or PUBLIC'), ownerAccount: openObject({ id: str('The account id'), handle: str('Its handle') }) })), next: str('The cursor of the next page') }, 'A page of experiences (ExperiencePage)'),
  run: (ctx, i) => servedExperiences(async () => {
    if (i.mine && i.owner) throw usageError('INVALID_INPUT', '--mine and --owner together');
    const owner = i.owner ? (i.owner.trim() === '*' ? '%root' : i.owner.trim()) : await myHandle(ctx);
    const doc = `query($o: String!, $after: String, $l: Int) { experiences(owner: $o, after: $after, limit: $l) { items ${LIST_ITEM} next } }`;
    const vars = { o: owner, after: i.after ?? null, l: i.limit ?? null };
    if (i.all) return await pages(ctx, doc, 'experiences', vars, i.max ?? 10) as { items: Experience[]; next: string | null };
    return (await api<{ experiences: { items: Experience[]; next: string | null } | null }>(ctx, doc, vars)).experiences ?? { items: [], next: null };
  }),
  text: (r) => (r.items.length ? [...r.items.map(listLine), ...(r.next ? [`next: ${r.next}`] : [])].join('\n') : '(no experience)'),
};

export const experiencesShow: Command<{ experience: string; document?: boolean }, Experience> = {
  name: 'experiences show', summary: 'Show an experience, by its address or its id (resolveAddress, experience)', api: 'experience',
  description: 'As you may read it (its visibility). Its owner is an account (by its id beside its handle) or a universe; its check (being checked, passed, refused with its explanation) and its experience template are read by its owner only (the leadership for a universe experience). --document adds the template (Experience.document) as the platform holds it; experiences export writes it as a portable document.',
  examples: ['breakrocks experiences show @alice*squats-100', 'breakrocks experiences show *five-k-under-30 --json', 'breakrocks experiences show <experience id> --document --json'],
  input: object({ experience: EXPERIENCE_ARG, document: bool('Add its experience template (its owner only)') }, ['experience']),
  output: openObject({ id: str('Its id'), address: str('Its address'), title: str('Its title'), version: str('The version of its template'), visibility: str('PRIVATE, UNLISTED or PUBLIC'), ownerAccount: openObject({ id: str('The account id'), handle: str('Its handle') }), ownerUniverse: str('The owner universe'), check: openObject({ status: str('CHECKING, PASSED or REFUSED') }), document: openObject({}, 'Its template, for its owner') }, 'The experience (Experience)'),
  args: { positionals: ['experience'] },
  run: (ctx, i) => servedExperiences(async () => {
    const x = await readExperience(ctx, i.experience, i.document ? WITH_DOCUMENT : EXPERIENCE);
    return typeof x.document === 'string' ? { ...x, document: JSON.parse(x.document) as unknown } : x;
  }),
  text: (x) => [showText(x), ...(x.document ? [JSON.stringify(x.document, null, 2)] : [])].join('\n'),
  quiet: (x) => x.id,
};

// ---- export ----

function writeOut(ctx: Context, out: string, text: string, force?: boolean): { out: string; bytes: number } {
  const path = resolve(ctx.io.cwd, out);
  if (!force && existsSync(path)) throw usageError('FILE_EXISTS', `${out} exists (--force replaces it)`, { path: out });
  writeFileSync(path, text);
  return { out, bytes: Buffer.byteLength(text) };
}

type ExportResult = Json | { out: string; bytes: number; address: string; id: string };
export const experiencesExport: Command<{ experience: string; out?: string; force?: boolean }, ExportResult> = {
  name: 'experiences export', summary: 'Export an experience template as a portable JSON document (experience)', api: 'experience',
  description: `Writes the experience template (${'breakrocks.experience/4'}) of one of your experiences (the leadership's for a universe experience: only its owner reads it) as the portable document of contracts/experiences.md: the fields the platform sets (id, version, copiedFrom) left out, as createExperience refuses them; the keys in the order of the JSON Schema (the others sorted), 2 spaces, a final new line, so that export, import and export again give the same bytes. No "$schema" key: the template is closed and "format" names it. --out writes a file (--force replaces it; - or no --out: the standard output). Someone else's PUBLIC simple challenge is not exported: copy it in the app (copyExperience).`,
  examples: ['breakrocks experiences export @alice*squats-100 --out squats-100.json', 'breakrocks experiences export <experience id> > squats.json'],
  input: object({ experience: EXPERIENCE_ARG, out: str('The file written (- or none: the standard output)'), force: bool('Replace the file when it exists') }, ['experience']),
  output: { anyOf: [openObject({ format: str('breakrocks.experience/4'), engine: openObject({}), owner: str('Its owner'), name: str('Its name') }, 'The portable document'), object({ out: str('The file written'), bytes: int('Its size'), address: str('The experience'), id: str('Its id') })] },
  args: { positionals: ['experience'] },
  run: (ctx, i) => servedExperiences(async () => {
    const x = await readExperience(ctx, i.experience, WITH_DOCUMENT);
    if (x.document === null || x.document === undefined) throw cliRefusal('EXPERIENCE_DOCUMENT_NOT_READABLE', `Only the owner of ${x.address} reads its experience template (the leadership for a universe experience): it is not yours to export${x.visibility === 'PUBLIC' && x.engine.name.toLowerCase() === 'challenge' ? '; a PUBLIC simple challenge can be copied into your experiences from the app' : ''}`, { address: x.address, id: x.id });
    const raw = typeof x.document === 'string' ? JSON.parse(x.document) as unknown : x.document;
    if (!isObject(raw)) throw cliRefusal('EXPERIENCE_DOCUMENT_INVALID', `The template of ${x.address} is not a JSON object`, { address: x.address });
    const document = portable(raw, loadContract(ctx));
    if (!i.out || i.out === '-') return document;
    return { ...writeOut(ctx, i.out, documentText(document), i.force), address: x.address, id: x.id };
  }),
  text: (r) => ('out' in r && typeof r.bytes === 'number' ? `${String(r.out)} written (${r.bytes} bytes): ${String(r.address)} [${String(r.id)}]` : documentText(r as Json).trimEnd()),
  quiet: (r) => ('out' in r && typeof r.id === 'string' ? r.id : undefined),
};

// ---- check ----

async function readSource(ctx: Context, file: string): Promise<{ name: string; text: string }> {
  if (file === '-') {
    if (!ctx.io.readStdin) throw usageError('INVALID_INPUT', 'No standard input to read here: give a file');
    return { name: '-', text: await ctx.io.readStdin() };
  }
  const path = resolve(ctx.io.cwd, file);
  if (!existsSync(path) || !statSync(path).isFile()) throw usageError('FILE_NOT_FOUND', `No file ${file}`, { path: file });
  return { name: file, text: readFileSync(path, 'utf8') };
}

/** What the platform answered: done, or why its check was not made. */
type PlatformCheck = 'done' | 'offline' | 'not signed in' | 'not open' | 'not served';
/** The problems of the platform (checkExperience), or why there are none: not signed in, experiences not open, an older backend. */
async function platformProblems(ctx: Context, document: unknown): Promise<{ problems: DocumentProblem[]; platform: PlatformCheck }> {
  try {
    const answer = await servedExperiences(async () => (await api<{ checkExperience: DocumentProblem[] | null }>(ctx, 'query($d: AWSJSON!) { checkExperience(document: $d) { code path message } }', { d: JSON.stringify(document) })).checkExperience ?? []);
    return { problems: answer.map((p) => ({ ...p, source: 'platform' as const })), platform: 'done' };
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    if (error.code === 'SIGN_IN_REQUIRED') return { problems: [], platform: 'not signed in' };
    if (error.code === 'EXPERIENCES_NOT_OPEN') return { problems: [], platform: 'not open' };
    if (error.code === 'OPERATION_NOT_SERVED') return { problems: [], platform: 'not served' };
    throw error;
  }
}
const PLATFORM_NOTES: Record<PlatformCheck, string> = {
  done: 'checked by the platform too (checkExperience)',
  offline: 'checked offline only (--offline)',
  'not signed in': 'checked offline only: the profile is not signed in, the platform did not check it',
  'not open': 'checked offline only: the platform does not open the experiences yet (EXPERIENCES_NOT_OPEN)',
  'not served': 'checked offline only: this backend does not serve checkExperience yet',
};
/** The platform's problems first (the authority), then the local ones at another path. */
const merged = (platform: DocumentProblem[], local: DocumentProblem[]) => onePerPath([...platform, ...local.filter((l) => !platform.some((p) => p.path === l.path))]);

type CheckResult = { ok: boolean; file: string; engine: string | null; address: string | null; problems: DocumentProblem[]; platform: PlatformCheck; specs: string };
export const experiencesCheck: Command<{ file: string; offline?: boolean; contract?: string }, CheckResult> = {
  name: 'experiences check', summary: 'Check an experience document: offline by the JSON Schema of the specs, then by the platform (checkExperience)', api: 'checkExperience',
  description: 'Reads a document (a file, or - for the standard input) and checks it as createExperience would: first without the platform, by the files the backend validates with (contracts/experiences/definition.schema.json and engines.json of the specs the CLI carries, or of --contract): SCHEMA, DOCUMENT_TOO_LARGE (16 KB), TEXT_TOO_LONG (visible characters), FIELD_SET_BY_PLATFORM (id, version, copiedFrom), ENGINE_NOT_AVAILABLE, the ranking and the parameters as the registry tells; then, when the profile is signed in and without --offline, by checkExperience, which writes nothing and adds what needs the platform (NAME_TAKEN, OWNER_NOT_ALLOWED, ROUTE_NOT_AVAILABLE, PARAMETER_OUT_OF_BOUNDS, TARGET_BEYOND_DURATION…). Every problem with its code and its JSON pointer, one per path, the platform\'s first. Not signed in, experiences not open (EXPERIENCES_NOT_OPEN) or an older backend: the offline check alone, and it says so. Exit 1 when there is a problem: usable as a hook.',
  examples: ['breakrocks experiences check squats-100.json', 'cat squats.json | breakrocks experiences check - --offline --json', 'breakrocks experiences check visit.json --contract ../specs --offline'],
  input: object({ file: str('The document (JSON), or - for the standard input'), offline: bool('Do not ask the platform (checkExperience)'), contract: str('Another copy of the contract: a checkout of the specs, its contracts/experiences, or a copy of schema/experiences') }, ['file']),
  output: openObject({ ok: bool('No problem'), file: str('The document'), engine: str('Its engine (challenge/1)'), address: str('Its address'), problems: list('Each problem', openObject({ code: str('Its code (DocumentProblem)'), path: str('Its JSON pointer ("" for the whole)'), message: str('What is wrong'), source: str('cli (offline) or platform') })), platform: str('done, offline, not signed in, not open or not served'), specs: str('The version of the specs of the contract') }),
  args: { positionals: ['file'] },
  run: async (ctx, i) => {
    const contract = loadContract(ctx, i.contract);
    const { name, text } = await readSource(ctx, i.file);
    const parsed = parseDocument(text);
    const doc = isObject(parsed.document) ? parsed.document : undefined;
    const engine = doc && isObject(doc.engine) ? `${String(doc.engine.name)}/${String(doc.engine.version)}` : null;
    const address = doc && typeof doc.owner === 'string' && typeof doc.name === 'string' ? addressOf(doc.owner, doc.name) : null;
    if (parsed.problem) return { ok: false, file: name, engine, address, problems: [parsed.problem], platform: 'offline', specs: contract.version };
    const local = checkLocally(parsed.document, sentBytes(parsed.document), contract);
    const remote = i.offline ? { problems: [], platform: 'offline' as const } : await platformProblems(ctx, parsed.document);
    const problems = merged(remote.problems, local);
    return { ok: !problems.length, file: name, engine, address, problems, platform: remote.platform, specs: contract.version };
  },
  exitCode: (r) => (r.ok ? EXIT.OK : EXIT.REFUSED),
  text: (r) => [
    `${r.file}: ${[r.engine, r.address].filter(Boolean).join(', ') || 'no engine'}: ${r.ok ? 'OK' : `${r.problems.length} problem${r.problems.length === 1 ? '' : 's'}`} (${PLATFORM_NOTES[r.platform]}; specs ${r.specs})`,
    ...problemLines(r.problems),
  ].join('\n'),
};

// ---- import ----

const VISIBILITIES = ['private', 'unlisted', 'public'] as const;
type Visibility = (typeof VISIBILITIES)[number];
type ImportOptions = { owner?: string; name?: string; visibility?: string; update?: boolean; dryRun?: boolean; requestId?: string; contract?: string };
type ImportOne = {
  file: string; result: 'created' | 'updated' | 'checked' | 'failed' | 'not tried'; address?: string; id?: string; version?: string; visibility?: string;
  check?: Experience['check']; automated?: boolean; via?: string | null; would?: 'create' | 'update'; left?: string[]; problems?: DocumentProblem[]; code?: string; message?: string; retryAt?: string;
};

const documentInvalid = (problems: DocumentProblem[], source: 'cli' | 'platform', details: Record<string, unknown> = {}) =>
  new CliError('EXPERIENCE_DOCUMENT_INVALID', [`The document has ${problems.length} problem${problems.length === 1 ? '' : 's'}${source === 'cli' ? ' (found before sending it)' : ''}:`, ...problemLines(problems)].join('\n'), EXIT.REFUSED, { ...details, problems }, source);

const NOT_PUBLIC = 'A delegated agent creates and sets up an experience for its human, never makes it public: import it private (the default) or unlisted; its human makes it public from the app, or from a sign-in of their own.';
const retryAtOf = (e: CliError) => (e.details as { errorInfo?: { retryAt?: string } }).errorInfo?.retryAt;
/** The refusals of the platform said plainly, their code kept. */
function plain(error: unknown, address?: string): unknown {
  if (!(error instanceof CliError) || error.source !== 'platform') return error;
  const info = (error.details as { errorInfo?: { problems?: DocumentProblem[]; retryAt?: string } }).errorInfo;
  switch (error.code) {
    case 'EXPERIENCE_DOCUMENT_INVALID': return documentInvalid((info?.problems ?? []).map((p) => ({ ...p, source: 'platform' as const })), 'platform', error.details);
    case 'EXPERIENCE_RATE_LIMITED': return platformRefusal(error.code, `The daily limits of the experiences are reached (20 created or copied, 50 changes or publications a day per account)${info?.retryAt ? `: again from ${info.retryAt}` : ''}`, error.details);
    case 'EXPERIENCE_NAME_TAKEN': return platformRefusal(error.code, `${address ?? 'The name'} is held by an experience, a place feat or a route of the same owner${address ? ': --update replaces it when it is yours, --name gives another name' : ''}`, error.details);
    case 'EXPERIENCE_VISIBILITY_NOT_ALLOWED': return platformRefusal(error.code, actsAsDelegatedAgentHint(error.message), error.details);
    default: return error;
  }
}
const actsAsDelegatedAgentHint = (message: string) => `${message || 'This visibility is not allowed'} (a route experience is never more visible than its route; a delegated agent never makes an experience public)`;

/** One document imported: checked, then created or updated, then published when asked; a refusal is thrown. */
async function importOne(ctx: Context, contract: Contract, source: { name: string; text: string }, o: ImportOptions, me: () => Promise<string>): Promise<ImportOne> {
  const parsed = parseDocument(source.text);
  if (parsed.problem) throw documentInvalid([parsed.problem], 'cli');
  if (!isObject(parsed.document)) throw documentInvalid([{ code: 'SCHEMA', path: '', message: 'must be object', source: 'cli' }], 'cli');
  const given: Json = { ...parsed.document, ...(o.owner ? { owner: o.owner.trim() } : {}), ...(o.name ? { name: o.name.trim() } : {}) };
  if (given.owner === '@me') given.owner = await me();
  const left = platformFields(contract).filter((f) => given[f] !== undefined);
  const document = portable(given, contract);
  const local = checkLocally(document, sentBytes(document), contract);
  if (local.length) throw documentInvalid(local, 'cli');
  const address = addressOf(String(document.owner), String(document.name));
  let existing: Experience | undefined;
  if (o.update) {
    try { existing = await readExperience(ctx, address, `{ id visibility document }`); } catch (error) {
      if (!(error instanceof CliError) || !['EXPERIENCE_NOT_FOUND', 'SIGN_RESERVED'].includes(error.code)) throw error;
    }
    if (existing && (existing.document === null || existing.document === undefined)) throw cliRefusal('EXPERIENCE_NOT_YOURS', `${address} exists and is not yours to change (only its owner, the leadership for a universe experience, updates it)`, { address, id: existing.id });
  }
  const visibility = o.visibility?.toLowerCase() as Visibility | undefined;
  if (o.dryRun) {
    const remote = await platformProblems(ctx, document);
    if (remote.platform === 'not open') throw platformRefusal('EXPERIENCES_NOT_OPEN', 'Experiences are not open on this platform yet (the switch experiences.open is off): nothing can be imported', {});
    if (remote.platform !== 'done') ctx.notice(`${source.name}: ${PLATFORM_NOTES[remote.platform]}`);
    return { file: source.name, result: remote.problems.length ? 'failed' : 'checked', address, would: existing ? 'update' : 'create', visibility: (visibility ?? (existing ? existing.visibility : 'private')).toUpperCase(), ...(left.length ? { left } : {}), ...(remote.problems.length ? { problems: remote.problems, code: 'EXPERIENCE_DOCUMENT_INVALID' } : {}), ...(existing ? { id: existing.id } : {}) };
  }
  const requestId = o.requestId ?? uuidv7(ctx.now());
  let x: Experience;
  try {
    x = existing
      ? (await api<{ updateExperience: Experience }>(ctx, `mutation($id: ID!, $d: AWSJSON!, $r: ID!) { updateExperience(experienceId: $id, document: $d, requestId: $r) ${EXPERIENCE} }`, { id: existing.id, d: JSON.stringify(document), r: requestId })).updateExperience
      : (await api<{ createExperience: Experience }>(ctx, `mutation($d: AWSJSON!, $r: ID!) { createExperience(document: $d, requestId: $r) ${EXPERIENCE} }`, { d: JSON.stringify(document), r: requestId })).createExperience;
  } catch (error) { throw plain(error, address); }
  if (visibility && visibility.toUpperCase() !== x.visibility) {
    try {
      x = (await api<{ publishExperience: Experience }>(ctx, `mutation($id: ID!, $v: ExperienceVisibility!, $r: ID!) { publishExperience(experienceId: $id, visibility: $v, requestId: $r) ${EXPERIENCE} }`, { id: x.id, v: visibility.toUpperCase(), r: uuidv7(ctx.now()) })).publishExperience;
    } catch (error) {
      const e = plain(error, address);
      if (e instanceof CliError) throw new CliError(e.code, `${existing ? 'Updated' : 'Created'} ${x.address} [${x.id}], ${x.visibility}, but not made ${visibility}: ${e.message}`, e.exit, { ...e.details, id: x.id, address: x.address }, e.source);
      throw e;
    }
  }
  return { file: source.name, result: existing ? 'updated' : 'created', address: x.address, id: x.id, version: x.version, visibility: x.visibility, check: x.check ?? null, ...(x.automated ? { automated: true, via: x.via ?? null } : {}), ...(left.length ? { left } : {}) };
}

type BatchResult = { dir: string; total: number; created: number; updated: number; checked: number; failed: number; notTried: number; stopped?: { code: string; message: string; retryAt?: string; exit: ExitCode }; results: ImportOne[] };
type ImportInput = ImportOptions & { file?: string; dir?: string; rate?: number };
type ImportResult = ImportOne | BatchResult;
const isBatch = (r: ImportResult): r is BatchResult => 'results' in r;

function oneText(r: ImportOne): string {
  if (r.result === 'checked' || (r.would && r.result === 'failed')) {
    return [`${r.file}: ${r.result === 'checked' ? 'OK' : 'refused'}, would ${r.would} ${r.address} as ${r.visibility} (dry run: nothing written)`, ...problemLines(r.problems ?? [])].join('\n');
  }
  const checking = r.check?.status === 'CHECKING' ? `; being checked before it is PUBLIC (experiences show ${r.address} tells the outcome)` : '';
  return `${r.result} ${r.address} [${r.id}], version ${r.version}, ${r.visibility}${checking}${r.automated ? `; Automated mark${r.via ? ` (${r.via})` : ''}` : ''}${r.left?.length ? ` (left out, set by the platform: ${r.left.join(', ')})` : ''}`;
}
function batchText(r: BatchResult): string {
  const rows = r.results.map((x) => [x.file, x.result, x.address ?? '', x.id ?? (x.code ? `${x.code}${x.message ? `: ${x.message.split('\n')[0]}` : ''}` : '')]);
  const widths = [0, 1, 2].map((c) => Math.min(40, Math.max(['FILE', 'RESULT', 'ADDRESS'][c].length, ...rows.map((row) => row[c].length))));
  const line = (cells: string[]) => cells.map((cell, c) => (c < 3 ? cell.padEnd(widths[c]) : cell)).join('  ').trimEnd();
  const out = [line(['FILE', 'RESULT', 'ADDRESS', 'ID OR CODE'])];
  for (const [n, x] of r.results.entries()) {
    out.push(line(rows[n]));
    out.push(...problemLines(x.problems ?? [], '    '));
  }
  const counts = [`${r.created} created`, `${r.updated} updated`, ...(r.checked ? [`${r.checked} checked`] : []), `${r.failed} failed`, ...(r.notTried ? [`${r.notTried} not tried`] : [])].join(', ');
  out.push(`${r.total} file${r.total === 1 ? '' : 's'}: ${counts}.${r.stopped ? ` Stopped: ${r.stopped.code}${r.stopped.retryAt ? `, again from ${r.stopped.retryAt}` : ''}.` : ''}`);
  return out.join('\n');
}

/** Each *.json of [dir], in the order of their names. */
function jsonFiles(ctx: Context, dir: string): string[] {
  const path = resolve(ctx.io.cwd, dir);
  if (!existsSync(path) || !statSync(path).isDirectory()) throw usageError('FILE_NOT_FOUND', `No folder ${dir}`, { path: dir });
  return readdirSync(path).filter((f) => f.toLowerCase().endsWith('.json') && statSync(join(path, f)).isFile()).sort().map((f) => join(path, f));
}

export const experiencesImport: Command<ImportInput, ImportResult> = {
  name: 'experiences import', summary: 'Import experience documents: check, then create or update them, private unless asked (createExperience)', api: 'createExperience',
  description: 'Each document is checked first as experiences check does offline (nothing is sent when it has a problem), then created (createExperience) PRIVATE, at the version 1.0, for its owner: your account (@<handle>; "@me" is replaced by yours, or your operator\'s for a delegated agent) or a public universe whose leadership you are a member of. --owner and --name replace those of the document; the fields the platform sets (id, version, copiedFrom) are left out and said. --update: when the address <owner>*<name> holds an experience of yours, its next version (updateExperience: owner, name and engine unchanged; every new version of a public experience is checked again); else it is created. --visibility unlisted or public then publishes it (publishExperience): PUBLIC only after its experience check, the experience keeping its former visibility meanwhile (experiences show tells the outcome); never public unless asked. A delegated agent never makes an experience public (EXPERIENCE_VISIBILITY_NOT_ALLOWED, refused before anything is sent); what it creates shows the Automated mark. --request-id (a UUIDv7, made when absent) makes the creation once even when sent again. --dir <folder>: every *.json of the folder, in the order of their names, a table at the end, going on after a failure, exit 1 if any failed; --rate <n> spaces the files to n a minute. The platform creates 20 experiences a day per account (copies included) and makes 50 changes or publications: at the limit (EXPERIENCE_RATE_LIMITED) the folder stops cleanly, the rest not tried, with the time it opens again (retryAt). --dry-run checks with the platform (checkExperience) and writes nothing. EXPERIENCES_NOT_OPEN while the platform keeps experiences.open off.',
  examples: ['breakrocks experiences import squats-100.json', 'breakrocks experiences import squats-100.json --update --visibility unlisted', 'breakrocks experiences import --dir experiences/ --rate 10', 'cat plank.json | breakrocks experiences import - --owner %paris --dry-run'],
  input: object({
    file: str('The document (JSON), or - for the standard input'), dir: str('A folder: every *.json in it'),
    owner: str('The owner, in place of the document\'s: @handle (@me: yours) or %universe'), name: str('The name, in place of the document\'s'),
    visibility: str('private (the default), unlisted, or public (after its experience check)', { enum: [...VISIBILITIES, ...VISIBILITIES.map((v) => v.toUpperCase())] }),
    update: bool('Make the next version of your experience at that address, when there is one'), dryRun: bool('Check with the platform and tell what would be done, writing nothing'),
    rate: int('With --dir: n files a minute at most', { minimum: 1, maximum: 60 }),
    requestId: str('An idempotency key for one document (a UUIDv7 of the last 24 hours; one is made when absent): sent again, the experience is created once', { pattern: '^[0-9a-fA-F-]{36}$' }),
    contract: str('Another copy of the contract for the offline check (as experiences check --contract)'),
  }),
  output: { anyOf: [
    openObject({ file: str('The document'), result: str('created, updated, checked or failed'), address: str('Its address'), id: str('Its id'), version: str('Its version'), visibility: str('Its visibility'), check: openObject({ status: str('CHECKING when made public') }), left: list('Fields left out: set by the platform'), problems: list('With --dry-run: the problems of the platform', { type: 'object' }) }),
    openObject({ dir: str('The folder'), total: int('Files'), created: int('Created'), updated: int('Updated'), checked: int('Checked (--dry-run)'), failed: int('Failed'), notTried: int('Not tried (stopped)'), stopped: openObject({ code: str('Why'), retryAt: str('When it opens again') }), results: list('Each file', { type: 'object' }) }),
  ] },
  args: { positionals: ['file'] },
  run: async (ctx, i) => {
    if (!!i.file === !!i.dir) throw usageError('INVALID_INPUT', 'Give one document (a file, or -) or --dir <folder>');
    if (i.rate && !i.dir) throw usageError('INVALID_INPUT', '--rate goes with --dir');
    if (i.requestId && i.dir) throw usageError('INVALID_INPUT', '--request-id is for one document: each file of --dir has its own');
    if (i.visibility?.toLowerCase() === 'public' && actsAsDelegatedAgent(ctx)) throw cliRefusal('EXPERIENCE_VISIBILITY_NOT_ALLOWED', NOT_PUBLIC, { visibility: 'PUBLIC' });
    const contract = loadContract(ctx, i.contract);
    let handle: string | undefined;
    const me = async () => (handle ??= await myHandle(ctx));
    if (i.file) return servedExperiences(async () => importOne(ctx, contract, await readSource(ctx, i.file!), i, me));
    const files = jsonFiles(ctx, i.dir!);
    if (files.length > 20 && !i.dryRun) ctx.notice(`${files.length} files: the platform creates 20 experiences a day per account; the import stops cleanly at that limit.`);
    const result: BatchResult = { dir: i.dir!, total: files.length, created: 0, updated: 0, checked: 0, failed: 0, notTried: 0, results: [] };
    for (const [n, path] of files.entries()) {
      const file = basename(path);
      if (result.stopped) { result.results.push({ file, result: 'not tried' }); result.notTried++; continue; }
      if (n > 0 && i.rate && !i.dryRun) await ctx.io.sleep(Math.ceil(60_000 / i.rate));
      ctx.progress(`${file}…`);
      try {
        const one = await servedExperiences(async () => importOne(ctx, contract, { name: file, text: readFileSync(path, 'utf8') }, i, me));
        result.results.push(one);
        if (one.result === 'created') result.created++; else if (one.result === 'updated') result.updated++; else if (one.result === 'checked') result.checked++; else result.failed++;
      } catch (error) {
        if (!(error instanceof CliError)) throw error;
        const problems = (error.details as { problems?: DocumentProblem[] }).problems;
        result.results.push({ file, result: 'failed', code: error.code, message: problems ? undefined : error.message, ...(problems ? { problems } : {}), ...(retryAtOf(error) ? { retryAt: retryAtOf(error) } : {}) });
        result.failed++;
        // At the daily limit, after a network or session failure, and when the platform keeps experiences closed, the rest would fail the same: stop.
        if (error.code === 'EXPERIENCE_RATE_LIMITED' || error.code === 'EXPERIENCES_NOT_OPEN' || error.code === 'OPERATION_NOT_SERVED' || error.exit === EXIT.NETWORK) {
          result.stopped = { code: error.code, message: error.message, ...(retryAtOf(error) ? { retryAt: retryAtOf(error) } : {}), exit: error.exit === EXIT.NETWORK ? EXIT.NETWORK : EXIT.REFUSED };
        }
      }
    }
    return result;
  },
  exitCode: (r) => (isBatch(r) ? (r.stopped?.exit === EXIT.NETWORK ? EXIT.NETWORK : r.failed || r.notTried ? EXIT.REFUSED : EXIT.OK) : r.result === 'failed' ? EXIT.REFUSED : EXIT.OK),
  text: (r) => (isBatch(r) ? batchText(r) : oneText(r)),
  quiet: (r) => (isBatch(r) ? undefined : r.id),
};

// ---- prompt ----

type PromptInput = { engine: string; theme?: string; area?: string; language?: string; stages?: number; placesFile?: string; owner?: string; out?: string; force?: boolean; contract?: string };
type PromptAnswer = PromptResult & { out?: string; bytes?: number };
export const experiencesPrompt: Command<PromptInput, PromptAnswer> = {
  name: 'experiences prompt', summary: 'Write the prompt that asks an external AI for an experience document (offline)',
  description: 'A self-contained prompt for an LLM of your choice: the task, the JSON Schema of the documents of the engine taken from the contract the CLI carries (definition.schema.json narrowed to that engine, never written in the code: an engine the specs add, visit/1 tomorrow, works once the CLI carries them, or now with --contract <checkout of the specs>), the hard rules (JSON only; no field the platform sets; the limits in visible characters and the 16 KB; no invented place, ids and coordinates copied exactly from the candidates; no reward, no money, nothing dangerous, honest warnings; the language and English), an example from the test vectors of the specs, and the candidate places of --places-file: a JSON list (or { "places": [...] } or { "items": [...] }) of { "id"?, "name", "lat"?, "lon"? } or { "id"?, "name", "point": { "lat", "lon" } }, each with an id or a point, 200 at most; what map places search --json answers fits as it is. --area is put in the prompt as text (a box <south>,<west>,<north>,<east> is written out): the CLI reads no place for it; make the candidates with map places search "<what>" --bounds <box> --json > places.json. --stages: for an engine whose template has stages (none of route/1 and challenge/1: the steps go into the instruction). The CLI calls no LLM and sends nothing. Then: experiences check <file>, experiences import <file>.',
  examples: ['breakrocks experiences prompt --engine challenge/1 --theme "a morning workout in a park" --language fr', 'breakrocks experiences prompt --engine challenge/1 --theme "street art walk" --area 48.81,2.22,48.90,2.47 --places-file places.json --out prompt.md', 'breakrocks experiences prompt --engine route/1 --theme "canal run" --owner @alice --places-file routes.json'],
  input: object({
    engine: str('The engine and its version, as the registry names them: challenge/1, route/1 (or the name alone: its latest version)'),
    theme: str('What the experience is about, in a few words', { maxLength: 500 }), area: str('Where: a text, or a box <south>,<west>,<north>,<east> (only written in the prompt)', { maxLength: 300 }),
    language: str('The language of its texts besides English (BCP 47: fr, de, pt-BR…)', { default: 'en' }), stages: int('About how many stages (an engine with stages)', { minimum: 1, maximum: 60 }),
    placesFile: str('The candidate places: a JSON file (or - for the standard input)'), owner: str('The owner the document names: @handle or %universe'),
    out: str('The file written (none: the standard output)'), force: bool('Replace the file when it exists'),
    contract: str('Another copy of the contract: a checkout of the specs, its contracts/experiences, or a copy of schema/experiences'),
  }, ['engine']),
  output: openObject({ prompt: str('The prompt'), engine: str('The engine (challenge/1)'), format: str('The format of the template'), specs: str('The version of the specs'), contract: str('Where the contract was read'), language: str('The language'), places: int('The candidate places given'), example: str('The example used: <vectors file>#<definition>'), out: str('The file written') }),
  offline: true,
  run: async (ctx, i) => {
    const contract = loadContract(ctx, i.contract);
    const engine = engineOf(contract, i.engine);
    const language = (i.language ?? 'en').trim();
    const pattern = ((contract.definition.$defs as Json | undefined)?.language as Json | undefined)?.pattern;
    if (typeof pattern === 'string' && !new RegExp(pattern, 'u').test(language)) throw usageError('INVALID_INPUT', `--language: a language code as the template writes it (${pattern}): fr, en, pt-BR`, { language });
    let places: Place[] | undefined;
    if (i.placesFile) {
      const { name, text } = await readSource(ctx, i.placesFile);
      let value: unknown;
      try { value = JSON.parse(text.replace(/^﻿/, '')); } catch { throw usageError('PLACES_FILE_INVALID', `${name}: not JSON`, { path: name }); }
      places = placesOf(value, name);
    }
    const result = experiencePrompt(contract, { engine, theme: i.theme, area: i.area, language, stages: i.stages, places, owner: i.owner });
    ctx.progress(`Prompt for ${keyOf(engine)} (${templateFormat(contract)}, specs ${contract.version}${places ? `, ${places.length} candidate places` : ''}). Give it to an AI, save its answer as a .json file, then: breakrocks experiences check <file>, breakrocks experiences import <file>.`);
    if (!i.out || i.out === '-') return result;
    return { ...result, ...writeOut(ctx, i.out, `${result.prompt}\n`, i.force) };
  },
  text: (r) => (r.out ? `${r.out} written (${r.bytes} bytes): the prompt for ${r.engine}` : r.prompt),
};

export const experiencesCommands = [experiencesList, experiencesShow, experiencesExport, experiencesCheck, experiencesImport, experiencesPrompt];
