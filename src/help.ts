// The help, derived from the registry and the tree (src/tree.ts): the overview (the domains and their
// groups), the help of a domain, of a group or a subgroup (its commands, the subgroups folded), of a
// command (its usage line, its details, its API operation, its options, its examples), the search of
// the commands by a word, and the commands close to a mistyped one.
import { aliases, commands, commandsUnder, groupOf, type AnyCommand } from './registry.js';
import { kebab, mainType, type JsonSchema } from './schema.js';
import { ALIASES_REMOVED_IN, DOMAINS, GROUP_SUMMARIES } from './tree.js';

export { GROUP_SUMMARIES };

export const GLOBAL_OPTIONS: [string, string][] = [
  ['--json', 'Answer in JSON (for scripts and AI agents); a refusal is { "error": { "code", … } }'],
  ['--quiet', 'Write only the identifier created or read'],
  ['--fields <a,b.c>', 'Keep these fields of the answer (of each item of a list)'],
  ['--profile <name>', 'Use this CLI profile (else BREAKROCKS_PROFILE, else the current one)'],
  ['--env <dev|staging|prod>', 'The environment of a profile without an account (default: prod)'],
  ['--yes', 'Confirm an irreversible action or a payment without asking'],
  ['--help', 'Show the help (of a command: breakrocks <command> --help)'],
  ['--version', 'Show the version of the CLI'],
];

const EXIT_CODES = 'Exit codes: 0 done, 1 refused (the code of the contract), 2 usage, 3 network or session.';

function placeholder(name: string, schema: JsonSchema): string {
  const type = mainType(schema);
  if (schema.enum) return schema.enum.join('|');
  if (type === 'array') return `${kebab(name)},…`;
  if (type === 'integer' || type === 'number') return 'n';
  return kebab(name);
}

/** The usage line of a command. */
export function usageLine(c: AnyCommand): string {
  const positionals = c.args?.positionals ?? [];
  const required = new Set(c.input.required ?? []);
  const parts = [`breakrocks ${c.name}`];
  for (const p of positionals) {
    const s = c.input.properties[p];
    const label = mainType(s) === 'array' ? `<${kebab(p)}…>` : `<${kebab(p)}>`;
    parts.push(required.has(p) ? label : `[${label}]`);
  }
  for (const [name, s] of Object.entries(c.input.properties)) {
    if (positionals.includes(name)) continue;
    const flag = mainType(s) === 'boolean' ? `--${kebab(name)}` : `--${kebab(name)} <${placeholder(name, s)}>`;
    parts.push(required.has(name) ? flag : `[${flag}]`);
  }
  return parts.join(' ');
}

const table = (rows: [string, string][]) => {
  const width = Math.max(0, ...rows.map(([l]) => l.length));
  return rows.map(([l, d]) => `  ${l.padEnd(width)}  ${d}`.trimEnd());
};

/** The help of a command. */
export function commandHelp(c: AnyCommand): string {
  const positionals = c.args?.positionals ?? [];
  const rows = Object.entries(c.input.properties).map(([name, s]): [string, string] => {
    const label = positionals.includes(name) ? `<${kebab(name)}>` : mainType(s) === 'boolean' ? `--${kebab(name)}` : `--${kebab(name)} <${placeholder(name, s)}>`;
    const values = s.items?.enum;
    const extra = [(c.input.required ?? []).includes(name) ? 'required' : '', values ? `among ${values.join(', ')}` : '', s.default !== undefined ? `default ${JSON.stringify(s.default)}` : ''].filter(Boolean).join('; ');
    return [label, `${s.description ?? ''}${extra ? ` (${extra})` : ''}`];
  });
  const under = commandsUnder(c.name);
  return [
    `${c.summary}`,
    '',
    `Usage: ${usageLine(c)}`,
    ...(c.details ? ['', c.details] : []),
    ...(c.description ? ['', c.description] : []),
    ...(c.api ? ['', `API: ${c.api}`] : []),
    ...(rows.length ? ['', 'Options:', ...table(rows)] : []),
    ...(c.interactive ? ['', 'Asks a confirmation: --yes for scripts and agents (exit 2 without it when nobody can answer).'] : []),
    ...(c.offline ? ['', 'Works offline.'] : []),
    '',
    'Examples:',
    ...c.examples.map((e) => `  ${e}`),
    ...(under.length ? ['', 'Subcommands:', ...childRows(c.name)] : []),
    ...(c.aliases?.length ? ['', `Former name (deprecated, removed in ${ALIASES_REMOVED_IN}): ${c.aliases.map((a) => `breakrocks ${a}`).join(', ')}`] : []),
    '',
    `JSON Schemas of its input and output: breakrocks schema ${c.name}`,
  ].join('\n');
}

/** The lines of what lies one word below [prefix]: its commands, its subgroups folded ("…"). */
function childRows(prefix: string): string[] {
  const depth = prefix ? prefix.split(' ').length : 0;
  const children: string[] = [];
  for (const c of prefix ? commandsUnder(prefix) : commands()) {
    const child = c.name.split(' ').slice(0, depth + 1).join(' ');
    if (!children.includes(child)) children.push(child);
  }
  return table(children.map((child): [string, string] => {
    const command = commands().find((c) => c.name === child);
    const under = commandsUnder(child).length;
    if (!under) return [child, command!.summary];
    return [`${child} …`, GROUP_SUMMARIES[child] ?? `${under + (command ? 1 : 0)} commands`];
  }));
}

/** Whether [path] is a group or a subgroup (commands lie under it). */
export const isGroup = (path: string) => commandsUnder(path).length > 0;

/** The help of a group or a subgroup: its own command, its commands, its subgroups folded. */
export function groupHelp(path: string): string {
  const own = commands().find((c) => c.name === path);
  return [
    `${GROUP_SUMMARIES[path] ?? path}`,
    '',
    'Commands:',
    ...(own ? table([[own.name, own.summary]]) : []),
    ...childRows(path),
    '',
    `Help of a command: breakrocks ${path} <action> --help`,
  ].join('\n');
}

/** The domain named [word] ("talk", "Map"), if any. */
export const domainOf = (word: string) => DOMAINS.find((d) => d.name === word.toLowerCase());

/** The help of a domain: the help of each of its groups. */
export function domainHelp(name: string): string {
  const domain = domainOf(name)!;
  const sections = domain.groups.filter((g) => commands().some((c) => groupOf(c) === g)).map((g) => {
    const own = commands().find((c) => c.name === g);
    const rows = [...(own ? table([[own.name, own.summary]]) : []), ...childRows(g)];
    return [`${g}: ${GROUP_SUMMARIES[g] ?? ''}`.trimEnd(), ...rows].join('\n');
  });
  return [`${domain.title}`, '', sections.join('\n\n'), '', 'Help of a group: breakrocks help <group>; of a command: breakrocks <command> --help'].join('\n');
}

/** The overview: the domains and their groups, then how to go further. About 30 lines. */
export function overviewHelp(): string {
  const width = Math.max(...DOMAINS.map((d) => d.title.length));
  return [
    'Usage: breakrocks <command> [options]',
    '',
    ...DOMAINS.map((d) => `  ${d.title.padEnd(width)}  ${d.line}`),
    '',
    ...table([
      ['breakrocks help <domain>', 'The commands of a domain (breakrocks help talk)'],
      ['breakrocks help <word>', 'Search the commands (breakrocks help invite)'],
      ['breakrocks help --all', 'Every command'],
      ['breakrocks <command> --help', 'The help of a command'],
    ]),
    '',
    `Options: ${GLOBAL_OPTIONS.map(([o]) => o.split(' ')[0]).join(' ')} (breakrocks help options)`,
    EXIT_CODES,
  ].join('\n');
}

/** The global options and the exit codes (breakrocks help options). */
export function optionsHelp(): string {
  return ['Options of every command:', ...table(GLOBAL_OPTIONS), '', EXIT_CODES].join('\n');
}

/** Every command, by group (breakrocks help --all). */
export function allHelp(): string {
  const rows = commands().map((c): [string, string] => [c.name, c.summary]);
  return ['Usage: breakrocks <command> [options]', '', 'Commands:', ...table(rows), '', optionsHelp(), 'Help of a command: breakrocks <command> --help'].join('\n');
}

/** The commands whose name, summary, details or former name hold every word of [words], the names first. */
export function searchCommands(words: readonly string[]): AnyCommand[] {
  const terms = words.map((w) => w.toLowerCase());
  const has = (text: string | undefined) => terms.every((t) => (text ?? '').toLowerCase().includes(t));
  const byName = commands().filter((c) => has(c.name) || c.aliases?.some(has));
  const byText = commands().filter((c) => !byName.includes(c) && has([c.summary, c.details, c.description].join(' ')));
  return [...byName, ...byText];
}

/** The help of a search: the commands found. */
export function searchHelp(words: readonly string[], found: readonly AnyCommand[]): string {
  const shown = found.slice(0, 40);
  return [`Commands matching "${words.join(' ')}":`, ...table(shown.map((c) => [c.name, c.summary])), ...(found.length > shown.length ? [`  … ${found.length - shown.length} more: narrow the search`] : []), '', 'Help of a command: breakrocks <command> --help'].join('\n');
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** The commands (or groups) closest to the mistyped [words], 3 at most ("did you mean …?"). */
export function suggestions(words: readonly string[]): string[] {
  const typed = words.join(' ');
  if (!typed) return [];
  const scored = new Map<string, number>();
  const limit = Math.max(2, Math.floor(typed.length / 3));
  const consider = (head: string, shown: string) => {
    const d = distance(typed, head);
    if (d <= limit && (scored.get(shown) ?? Infinity) > d) scored.set(shown, d);
  };
  // A command or a group, by as many words as typed; a former name, whole only (shown as its new path).
  for (const c of commands()) { const head = c.name.split(' ').slice(0, words.length).join(' '); consider(head, head); }
  for (const [alias, c] of aliases()) if (alias.split(' ').length === words.length) consider(alias, c.name);
  for (const c of searchCommands(words).slice(0, 3)) if (!scored.has(c.name)) scored.set(c.name, 99);
  return [...scored].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([name]) => name);
}

/** The help of a former group ("theme", "dm"): where each of its commands went. */
export function movedHelp(prefix: string): string | undefined {
  const moved = [...aliases()].filter(([alias]) => alias === prefix || alias.startsWith(`${prefix} `));
  if (!moved.length) return undefined;
  return [`"${prefix}" moved (its former names work until ${ALIASES_REMOVED_IN}):`, ...table(moved.map(([alias, c]) => [alias, `→ ${c.name}`]))].join('\n');
}
