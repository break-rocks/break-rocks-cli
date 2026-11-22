// Short links and pre-filled experience links (specs v156.0.0, D-510, D-512 (9), (10); contracts/urls.md § Pre-filled
// links, contracts/experiences.md § Pre-filled link keys, experiences/experience-sharing.feature).
// - links shorten / links resolve: /go/<code>, a record of the platform kept for ever (createShortLink, shortLink), 100 per
//   account and UTC day (SHORT_LINK_RATE_LIMITED, errorInfo.retryAt).
// - experiences prefill keys / build / open: the link /new/<template>/v/<key>=<value>;…?after=<address> of a creation
//   template, offline and from the catalogue the CLI carries; building or opening one creates nothing (the apps create at
//   the confirmation of their guided sheet, which asks the owner, the place of discussion and the name the link never
//   carries). A link grants no right: what the account may not create stays refused by the platform.
import type { Context } from '../context.js';
import { CliError, platformRefusal, usageError } from '../errors.js';
import { acceptsText, buildLink, CATALOGUE, keysOf, MAX_LINK, openLink, prefilledPath, SHORT_LINK_BEYOND, templateOf, type Built, type Opened } from '../experiences/prefill.js';
import { uuidv7 } from '../ids.js';
import type { Command } from '../registry.js';
import { bool, list, object, openObject, str } from '../schema.js';
import { api } from '../session.js';
import { webOrigin } from '../endpoints.js';
import { served } from './explore-map.js';

const SINCE = 'v156.0.0';
type ShortLink = { code: string; url: string };

/** The path and query of a URL of break.rocks (a full URL of any break.rocks host, or a path), as createShortLink takes it. */
export function pathOfUrl(given: string): string {
  const s = given.trim();
  if (s.startsWith('/')) return s;
  try {
    const u = new URL(s);
    if (/(^|\.)break\.rocks$/i.test(u.hostname)) return `${u.pathname}${u.search}${u.hash}`;
  } catch { /* not a URL */ }
  return s;
}
/** The code of a short link: its 10 letters and digits, or a URL or path ending in /go/<code>. */
export function codeOf(given: string): string {
  const s = given.trim();
  const m = /\/go\/([A-Za-z0-9]+)\/?(?:[?#].*)?$/.exec(s);
  return m ? m[1] : s;
}

/** SHORT_LINK_RATE_LIMITED said plainly, with the moment it is possible again. */
function rateLimited(error: unknown): unknown {
  if (!(error instanceof CliError) || error.code !== 'SHORT_LINK_RATE_LIMITED') return error;
  const retryAt = (error.details as { errorInfo?: { retryAt?: string } }).errorInfo?.retryAt;
  return platformRefusal(error.code, `100 short links at most per account and UTC day: this account reached them${retryAt ? `, possible again at ${retryAt}` : ' (possible again after 00:00 UTC)'}. The long link still works: it is only too long for the QR code of a poster.`, error.details);
}

async function createShortLink(ctx: Context, url: string): Promise<ShortLink> {
  try {
    const r = await served('the short links', async () => (await api<{ createShortLink: ShortLink | null }>(ctx, 'mutation($u: String!, $r: ID!) { createShortLink(url: $u, requestId: $r) { code url } }', { u: url, r: uuidv7(ctx.now()) })).createShortLink, SINCE);
    if (!r) throw platformRefusal('SHORT_LINK_TARGET_INVALID', `No short link for ${url}`);
    return r;
  } catch (error) { throw rateLimited(error); }
}
async function readShortLink(ctx: Context, code: string): Promise<ShortLink> {
  const r = await served('the short links', async () => (await api<{ shortLink: ShortLink | null }>(ctx, 'query($c: String!) { shortLink(code: $c) { code url } }', { c: code })).shortLink, SINCE);
  if (!r) throw platformRefusal('SHORT_LINK_NOT_FOUND', `No short link /go/${code}: the link is not found`, { shortCode: code });
  return r;
}

const shortOutput = openObject({ code: str('The 10 letters and digits after /go/'), url: str('The path and query of the URL it stands for'), link: str('The short link, on the web app of the environment') });
const withLink = (ctx: Context, r: ShortLink) => ({ ...r, link: `${webOrigin(ctx, ctx.profile().env)}/go/${r.code}` });
const shortText = (r: ShortLink & { link?: string }) => `${r.link ?? `/go/${r.code}`}  →  ${r.url}`;

export const linksShorten: Command<{ url: string }, ShortLink & { link: string }> = {
  name: 'links shorten', summary: 'Make the short link /go/<code> of a URL of break.rocks (createShortLink)', api: 'createShortLink',
  description: `The same code for the same URL; a record of the platform kept for ever, leading (302) to that URL only. Made for the QR code of a poster when the path and query of a link are longer than ${SHORT_LINK_BEYOND} characters. A full URL of break.rocks or its path; ${MAX_LINK} characters at most (SHORT_LINK_TARGET_INVALID otherwise). 100 short links at most per account and UTC day (SHORT_LINK_RATE_LIMITED, with the moment it is possible again).`,
  input: object({ url: str('The URL of break.rocks (https://break.rocks/new/…, or its path /new/…)') }, ['url']), output: shortOutput, args: { positionals: ['url'] },
  run: async (ctx, i) => withLink(ctx, await createShortLink(ctx, pathOfUrl(i.url))),
  text: shortText, quiet: (r) => r.code,
  examples: ['breakrocks links shorten "/new/tournament/v/entrants.max=24;format=POOLS_THEN_ELIMINATION"', 'breakrocks links shorten https://break.rocks/new/contest/v/forms=IMAGE --json'],
};

export const linksResolve: Command<{ code: string }, ShortLink & { link: string; prefilled?: Opened }> = {
  name: 'links resolve', summary: 'The URL a short link /go/<code> stands for (shortLink)', api: 'shortLink',
  description: 'Reads the URL without opening it; a pre-filled link is also told as experiences prefill open tells it (what it fills, what would be asked), creating nothing. An unknown code: SHORT_LINK_NOT_FOUND.',
  input: object({ code: str('The code (10 letters and digits), or the short link https://break.rocks/go/<code>') }, ['code']),
  output: openObject({ code: str('The code'), url: str('The URL it stands for'), link: str('The short link'), prefilled: { type: 'object', description: 'When the URL is a pre-filled link: what it fills' } }),
  args: { positionals: ['code'] },
  run: async (ctx, i) => {
    const r = withLink(ctx, await readShortLink(ctx, codeOf(i.code)));
    const path = prefilledPath(r.url);
    return path ? { ...r, prefilled: openLink(path) } : r;
  },
  text: (r) => [shortText(r), ...(r.prefilled ? ['', openedText(r.prefilled)] : [])].join('\n'),
  examples: ['breakrocks links resolve 7Hk2pQa9xT', 'breakrocks links resolve https://break.rocks/go/7Hk2pQa9xT --json'],
};

// ---- Pre-filled links ----

type KeysAnswer = { catalogueVersion: number; templates: { template: string; engine: string; version: number; keys: { key: string; pointer: string; accepts: string; default: string }[]; notCarried: string[] }[] };
export const prefillKeys: Command<{ template?: string }, KeysAnswer> = {
  name: 'experiences prefill keys', summary: 'The keys a pre-filled link carries, per creation template (offline)', offline: true,
  description: 'From the catalogue of the creation templates the CLI carries (contracts/experiences/creation-templates.json): each key is the pointer of a choice without its engine block, its values, and its default ("absent" for an optional choice, never written; "none" for a required one, always written or asked when the link is opened). The free parts of a creation template are never carried.',
  input: object({ template: str('One creation template (tournament, contest, challenge-count…); all by default') }), args: { positionals: ['template'] },
  output: openObject({ catalogueVersion: { type: 'integer', description: 'The version of the catalogue' }, templates: list('The creation templates and their keys', { type: 'object' }) }),
  run: (_ctx, i) => {
    const chosen = i.template ? [templateOf(i.template)].filter((t) => t !== undefined) : CATALOGUE.templates;
    if (i.template && !chosen.length) throw usageError('CREATION_TEMPLATE_UNKNOWN', `"${i.template}" is no creation template (${CATALOGUE.templates.map((t) => t.key).join(', ')})`, { template: i.template });
    return {
      catalogueVersion: CATALOGUE.catalogueVersion,
      templates: chosen.map((t) => ({ template: t.key, engine: `${t.engine.name}/${t.engine.version}`, version: t.version, keys: keysOf(t).map((k) => ({ key: k.key, pointer: k.pointer, accepts: acceptsText(k.choice), default: k.required ? 'none (always written)' : 'absent' })), notCarried: t.free ?? [] })),
    };
  },
  text: (r) => r.templates.map((t) => [`${t.template}  (${t.engine}, creation template version ${t.version})`, ...(t.keys.length ? t.keys.map((k) => `  ${k.key}  ${k.accepts}  default: ${k.default}`) : ['  (no key)']), ...(t.notCarried.length ? [`  not carried (asked when the link is opened): ${t.notCarried.join(', ')}`] : [])].join('\n')).join('\n\n'),
  examples: ['breakrocks experiences prefill keys', 'breakrocks experiences prefill keys tournament --json'],
};

type BuildInput = { template: string; values?: string[]; after?: string; short?: boolean };
type BuildAnswer = Built & { url: string; shortLink?: ShortLink & { link: string } };
export const prefillBuild: Command<BuildInput, BuildAnswer> = {
  name: 'experiences prefill build', summary: 'Build the pre-filled link of a creation template from key=value pairs (offline)',
  description: `Writes /new/<template>/v/<key>=<value>;… as the apps do: only the keys of the creation template (experiences prefill keys), each once, sorted in byte order, a value equal to its default (an optional choice left absent) not written, the values checked against the catalogue the CLI carries; --after names the experience it comes from (optional; it opens only for who can read that experience). Never an owner, a place of discussion, a name nor an edition: whoever opens the link is asked them. Beyond ${MAX_LINK} characters (path and query, percent-encoded), no link is made (PREFILLED_LINK_TOO_LONG). Beyond ${SHORT_LINK_BEYOND}, a poster needs a short link: --short makes it (createShortLink, 100 per account and UTC day). Nothing else is sent, nothing is created.`,
  input: object({
    template: str('The creation template (tournament, contest, challenge-count…)'),
    values: list('The values, key=value (entrants.max=24 format=POOLS_THEN_ELIMINATION warnings=PHYSICAL_EFFORT,RISKY_PLACE)', { type: 'string' }),
    after: str('The experience it comes from, by its address (@alice*open-des-sables)'),
    short: bool(`Also make its short link /go/<code> (createShortLink), for a poster when it is longer than ${SHORT_LINK_BEYOND} characters`),
  }, ['template']),
  output: openObject({ template: str('The creation template'), path: str('The path and query of the link'), url: str('The link on the web app of the environment'), length: { type: 'integer', description: 'Its length (path and query, percent-encoded)' }, values: { type: 'object', description: 'The values written, by key' }, asked: list('The required keys not given: asked when the link is opened', { type: 'string' }), after: { type: ['string', 'null'], description: 'The experience it comes from' }, shortLinkNeeded: bool(`Longer than ${SHORT_LINK_BEYOND} characters: a poster holds a short link to it`), shortLink: { type: 'object', description: 'Its short link, with --short' } }),
  args: { positionals: ['template', 'values'] },
  run: async (ctx, i) => {
    const t = templateOf(i.template);
    if (!t) throw usageError('CREATION_TEMPLATE_UNKNOWN', `"${i.template}" is no creation template (${CATALOGUE.templates.map((x) => x.key).join(', ')})`, { template: i.template });
    const given: Record<string, string> = {};
    for (const pair of i.values ?? []) {
      const at = pair.indexOf('=');
      if (at <= 0) throw usageError('INVALID_INPUT', `"${pair}": key=value expected`);
      const key = pair.slice(0, at).trim();
      if (key in given) throw usageError('PREFILLED_KEY_TWICE', `"${key}" given twice: each key once`, { key });
      given[key] = pair.slice(at + 1);
    }
    if (i.after !== undefined && !/^[@%*]\S*\*?\S+$/.test(i.after.trim())) throw usageError('INVALID_INPUT', `--after: an experience address expected (@alice*open-des-sables), not "${i.after}"`);
    const r = buildLink(t, given, i.after?.trim());
    if ('problems' in r) throw usageError('PREFILLED_VALUES_INVALID', `The values do not fit the creation template ${t.key}:\n${r.problems.map((p) => `  ${p.key}: ${p.problem}`).join('\n')}`, { problems: r.problems });
    const built = r.built;
    if (built.length > MAX_LINK) throw usageError('PREFILLED_LINK_TOO_LONG', `The values do not fit in a link: ${built.length} characters, ${MAX_LINK} at most (path and query, percent-encoded); no link is made`, { length: built.length });
    const answer: BuildAnswer = { ...built, url: `${webOrigin(ctx, ctx.profile().env)}${built.path}` };
    if (i.short) answer.shortLink = withLink(ctx, await createShortLink(ctx, built.path));
    return answer;
  },
  text: (r) => [
    r.url,
    `  ${r.length} characters${r.shortLinkNeeded ? `, beyond ${SHORT_LINK_BEYOND}: a poster holds a short link (--short)` : ''}`,
    ...(r.asked.length ? [`  asked when it is opened: ${r.asked.join(', ')}`] : []),
    ...(r.after ? [`  after ${r.after} (opens only for who can read it)`] : []),
    ...(r.shortLink ? [`  short link ${r.shortLink.link}`] : []),
  ].join('\n'),
  quiet: (r) => r.url,
  examples: ['breakrocks experiences prefill build tournament entrants.max=24 format=POOLS_THEN_ELIMINATION validation=REFEREED-false', 'breakrocks experiences prefill build challenge-count unit=push-ups target.at-least=100 --after "@alice*squats-100" --json'],
};

function openedText(o: Opened): string {
  if (!o.valid) return `${o.reason}${o.template ? `; start the command without values instead` : ''}`;
  return [
    `${o.template}  (${o.engine}, creation template version ${o.templateVersion}): opening it creates nothing; the guided sheet opens with:`,
    ...(o.filled.length ? o.filled.map((f) => `  ${f.key} = ${f.value}`) : ['  (no value)']),
    ...o.askedAgain.map((a) => `  ${a.key}: "${a.value}" left out and asked again (${a.problem})`),
    ...(o.asked.length ? [`  asked: ${o.asked.join(', ')}, and the owner, the place of discussion and the name`] : ['  asked: the owner, the place of discussion and the name']),
    ...(o.ignored.length ? [`  ignored (unknown keys): ${o.ignored.join(', ')}`] : []),
    ...(o.after ? [`  after ${o.after} (shown only to who can read it; others see "Private experience")`] : []),
    ...(o.tooLong ? [`  longer than ${MAX_LINK} characters: not a link the apps make`] : []),
  ].join('\n');
}

export const prefillOpen: Command<{ link: string }, Opened & { shortLink?: ShortLink }> = {
  name: 'experiences prefill open', summary: 'Tell what a pre-filled link fills, what it asks; creates nothing',
  description: 'Reads a pre-filled link (https://break.rocks/new/…, its path, or a short link /go/<code>, read with shortLink) as the apps open it, against the catalogue the CLI carries: an unknown key ignored, a value outside the choices or the bounds left out and asked again, the required keys missing asked, a creation template no longer in the catalogue telling that the link is no longer valid (exit 1). Offline but for a short link. Nothing is created: to create, the apps confirm their guided sheet; from the CLI, write the experience document (experiences prompt, check, import).',
  input: object({ link: str('The pre-filled link, its path, or a short link /go/<code>') }, ['link']), args: { positionals: ['link'] },
  output: { type: 'object', description: 'What it fills (valid, template, filled, askedAgain, asked, ignored, after), or why it is no longer valid' },
  run: async (ctx, i) => {
    let path = prefilledPath(i.link);
    let shortLink: ShortLink | undefined;
    if (!path && /\/go\/[A-Za-z0-9]+/.test(i.link)) {
      shortLink = await readShortLink(ctx, codeOf(i.link));
      path = prefilledPath(shortLink.url);
      if (!path) throw usageError('NOT_A_PREFILLED_LINK', `/go/${shortLink.code} stands for ${shortLink.url}, not a pre-filled link`, { url: shortLink.url });
    }
    if (!path) throw usageError('NOT_A_PREFILLED_LINK', `"${i.link}" is not a pre-filled link (/new/<template>/v/<key>=<value>;…, or a short link /go/<code>)`);
    return { ...openLink(path), ...(shortLink ? { shortLink } : {}) };
  },
  text: (r) => openedText(r), exitCode: (r) => (r.valid ? 0 : 1),
  examples: ['breakrocks experiences prefill open "https://break.rocks/new/tournament/v/entrants.max=24;format=POOLS_THEN_ELIMINATION?after=%40alice*open-des-sables"', 'breakrocks experiences prefill open https://break.rocks/go/7Hk2pQa9xT --json'],
};

export const linkCommands = [linksShorten, linksResolve, prefillKeys, prefillBuild, prefillOpen];
