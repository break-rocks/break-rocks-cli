// Prints the table of docs/sulfur.md (§ Commands): each command of the registry on the new backend (native-sulfur), from
// what the code says, never from a request: its stand-in (src/sulfur/commands.ts), offline, refused (src/sulfur/dispatch.ts
// LEGACY_ONLY), or the talc operations it sends (an API command's own; for the others, the GraphQL documents of its source
// read by a pattern) checked against the server's schema (src/sulfur/schema.generated.ts) and the adapters
// (src/sulfur/talc.ts ADAPTERS). VERIFIED lists the commands run against dev (scripts/e2e-sulfur-dev.mjs and by hand).
// npx tsx scripts/sulfur-table.ts [--write: into docs/sulfur.md] [--check: docs/sulfur.md is current]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/commands/index.js';
import { commands, groupOf, type AnyCommand } from '../src/registry.js';
import { DOMAINS } from '../src/tree.js';
import { LEGACY_ONLY } from '../src/sulfur/dispatch.js';
import { SULFUR_COMMANDS } from '../src/sulfur/commands.js';
import { ADAPTERS } from '../src/sulfur/talc.js';
import { serverRequiresBeyondTalc } from '../src/sulfur/fit.js';
import { SERVER } from '../src/sulfur/schema.generated.js';
import { CONTRACT } from '../src/api/graphql.js';
import { VERIFIED } from './sulfur-verified.js';

const root = fileURLToPath(new URL('..', import.meta.url));

/** The root fields of the GraphQL documents in [text] (query/mutation documents and `{ field` shorthands). */
function rootsIn(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:query|mutation)\b[^{`'"]*\{\s*(?:\w+\s*:\s*)?(\w+)/g)) found.add(m[1]);
  for (const m of text.matchAll(/[`'"]\{\s*(\w+)\s*[({]/g)) found.add(m[1]);
  for (const m of text.matchAll(/\}\s*(\w+)\s*\((?:[^()]*)\)\s*(?:\$\{|\{)/g)) if (CONTRACT.query[m[1]] || CONTRACT.mutation[m[1]]) found.add(m[1]);
  // A field called with its arguments inside a document (`post(id: $id) ${POST}`).
  for (const m of text.matchAll(/[`'"{ ]\s*(\w+)\((\w+): \$/g)) found.add(m[1]);
  return [...found].filter((f) => CONTRACT.query[f] || CONTRACT.mutation[f]);
}

/** The talc operations each source name of a command sends, read from src/commands/*.ts by pattern. */
function scanned(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const dir = join(root, 'src', 'commands');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    const names = [...text.matchAll(/\bname: '([a-z][a-z0-9 -]*)'/g)].map((m) => ({ name: m[1], at: m.index! }));
    // The documents kept in constants: their operations go to the commands that name the constant.
    const constants = new Map<string, string[]>();
    for (const m of text.matchAll(/const (\w+) = [`'](?:query|mutation|\{)[^`']*[`']/g)) constants.set(m[1], rootsIn(m[0]));
    names.forEach((n, i) => {
      const region = text.slice(n.at, names[i + 1]?.at ?? text.length);
      const ops = new Set(rootsIn(region));
      for (const [k, v] of constants) if (new RegExp(`\\b${k}\\b`).test(region)) v.forEach((o) => ops.add(o));
      if (/\buploadImage|uploadVideo|sendMedia|uploadAvatar|uploadDocument|uploadLongVideo\b/.test(region)) ops.add('(media upload)');
      if (/\bagentsPost|ensureSession\(|paidPost\(|endpoints\(ctx|signIn\(ctx|watchAddress|\bwatch\(ctx/.test(region) && !/backend\(\) [!=]== 'sulfur'/.test(region)) ops.add('(former hosts)');
      out.set(n.name, [...new Set([...(out.get(n.name) ?? []), ...ops])]);
    });
  }
  return out;
}

type Row = { command: string; state: 'works' | 'adapted' | 'partly' | 'not available' | 'offline'; ops: string; note: string; verified: boolean };

function classify(c: AnyCommand, scan: Map<string, string[]>): Row {
  const verified = VERIFIED.has(c.name);
  if (SULFUR_COMMANDS.has(c.name)) return { command: c.name, state: 'works', ops: '(own: auth, me)', note: 'stand-in of the new backend', verified };
  if (LEGACY_ONLY.has(c.name)) return { command: c.name, state: 'not available', ops: '', note: LEGACY_ONLY.get(c.name)!, verified };
  if (c.offline || ['help', 'version', 'schema', 'completion', 'update', 'mcp'].includes(c.name) || c.name.startsWith('config ') || c.name.startsWith('profile ')) return { command: c.name, state: 'offline', ops: '', note: 'no platform request', verified };
  const sources = [c.name, ...(c.aliases ?? [])];
  const ops = new Set<string>(c.api ? c.api.split(/,\s*/) : []);
  for (const s of sources) for (const o of scan.get(s) ?? []) ops.add(o);
  if (!ops.size) return { command: c.name, state: 'works', ops: '', note: 'no talc operation found by the scan: not checked', verified };
  const missing: string[] = [], adapted: string[] = [], args: string[] = [];
  for (const op of ops) {
    if (op === '(media upload)') { adapted.push('media upload (requestUpload)'); continue; }
    if (op === '(former hosts)') { missing.push('the former backend\'s session or agents host'); continue; }
    if (ADAPTERS[op]) { adapted.push(op); continue; }
    const kind = CONTRACT.mutation[op] ? 'mutation' : 'query';
    const served = SERVER[kind][op];
    if (!served) { missing.push(op); continue; }
    const talcArgs = Object.keys(CONTRACT[kind][op]?.[1] ?? {}), serverArgs = served[1] ?? {};
    const lacking = talcArgs.filter((a) => !(a in serverArgs) && a !== 'requestId');
    if (lacking.length) args.push(`${op}(${lacking.join(', ')})`);
    // An argument the server requires and talc does not have: the document cannot be fitted (src/sulfur/fit.ts refuses
    // it, NOT_ON_NEW_BACKEND) without an adapter.
    const required = serverRequiresBeyondTalc(op, kind);
    if (required.length) missing.push(`${op} (the server requires ${required.join(', ')})`);
  }
  const list = [...ops].join(', ');
  if (missing.length && missing.length === ops.size) return { command: c.name, state: 'not available', ops: list, note: `not served: ${missing.join(', ')}`, verified };
  if (missing.length) return { command: c.name, state: 'partly', ops: list, note: `not served: ${missing.join(', ')}`, verified };
  const note = [adapted.length ? `adapted: ${adapted.join(', ')}` : '', args.length ? `arguments not taken (refused when given): ${args.join('; ')}` : ''].filter(Boolean).join('; ');
  return { command: c.name, state: adapted.length ? 'adapted' : 'works', ops: list, note, verified };
}

const scan = scanned();
const rows = commands().map((c) => classify(c, scan));
const esc = (s: string) => s.replace(/\|/g, '\\|');
const count = (state: Row['state']) => rows.filter((r) => r.state === state).length;
const out: string[] = [
  `${rows.length} commands: ${count('works')} work as they are, ${count('adapted')} through an adapter, ${count('partly')} partly, ${count('not available')} not available, ${count('offline')} offline; ${rows.filter((r) => r.verified).length} run against dev.`,
  '',
];
for (const d of DOMAINS) {
  const list = rows.filter((r) => d.groups.includes(groupOf(commands().find((c) => c.name === r.command)!)));
  if (!list.length) continue;
  out.push(`#### ${d.name}`, '', '| Command | On sulfur | Dev | Operations | Note |', '|---|---|---|---|---|');
  for (const r of list) out.push(`| \`${r.command}\` | ${r.state} | ${r.verified ? 'yes' : ''} | ${esc(r.ops)} | ${esc(r.note)} |`);
  out.push('');
}
const text = out.join('\n');
if (process.argv.includes('--check')) {
  // The table of docs/sulfur.md is the one the code gives (test/sulfur-table.test.ts).
  const current = readFileSync(join(root, 'docs', 'sulfur.md'), 'utf8').split('<!-- table -->')[1]?.split('<!-- /table -->')[0] ?? '';
  if (current.trim() !== text.trim()) { process.stderr.write('docs/sulfur.md: the table is not the one of the code: npx tsx scripts/sulfur-table.ts --write\n'); process.exit(1); }
  process.stdout.write('docs/sulfur.md: the table is current\n');
} else if (process.argv.includes('--write')) {
  // docs/sulfur.md: the table between its markers.
  const doc = join(root, 'docs', 'sulfur.md');
  const current = readFileSync(doc, 'utf8');
  const [head, rest] = current.split('<!-- table -->');
  const tail = rest.split('<!-- /table -->')[1];
  writeFileSync(doc, `${head}<!-- table -->\n${text}\n<!-- /table -->${tail}`);
} else process.stdout.write(text);
