// The help, derived from the registry: the overview (the groups and their commands), the help of a
// group, the help of a command (its usage line, its options from its input schema, its examples).
import { commands, groupOf, groups, type AnyCommand } from './registry.js';
import { kebab, mainType, type JsonSchema } from './schema.js';

export const GLOBAL_OPTIONS: [string, string][] = [
  ['--json', 'Answer in JSON (for scripts and AI agents); a refusal is { "error": { "code", … } }'],
  ['--quiet', 'Write only the identifier created or read'],
  ['--fields <a,b.c>', 'Keep these fields of the answer (of each item of a list)'],
  ['--profile <name>', 'Use this profile (else BREAKROCKS_PROFILE, else the current one)'],
  ['--env <dev|staging|prod>', 'The environment of a profile without an account (default: prod)'],
  ['--yes', 'Confirm an irreversible action or a payment without asking'],
  ['--help', 'Show the help (of a command: breakrocks <command> --help)'],
  ['--version', 'Show the version of the CLI'],
];

const GROUP_SUMMARIES: Record<string, string> = {
  help: 'This help', version: 'The version of the CLI', schema: 'The JSON Schemas of a command',
  profile: 'Profiles: an environment and an account each', operator: 'Agent operators: keys, registration paid with x402, sessions, recovery',
  agents: 'Delegated agents of the operator', agent: 'Signing in as a delegated agent, attestations',
  wallet: 'The x402 wallet: key, balance, caps', whoami: 'The account signed in', session: 'The session of the profile',
  usage: 'Usage and limits', capabilities: 'What the profile may do now', theme: 'Themes, offline: prompt, check, pack, unpack',
  mcp: 'The MCP server on stdio',
};

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

/** The help of a command. */
export function commandHelp(c: AnyCommand): string {
  const positionals = c.args?.positionals ?? [];
  const rows = Object.entries(c.input.properties).map(([name, s]) => {
    const label = positionals.includes(name) ? `<${kebab(name)}>` : mainType(s) === 'boolean' ? `--${kebab(name)}` : `--${kebab(name)} <${placeholder(name, s)}>`;
    const values = s.items?.enum;
    const extra = [(c.input.required ?? []).includes(name) ? 'required' : '', values ? `among ${values.join(', ')}` : '', s.default !== undefined ? `default ${JSON.stringify(s.default)}` : ''].filter(Boolean).join('; ');
    return [label, `${s.description ?? ''}${extra ? ` (${extra})` : ''}`];
  });
  const width = Math.max(0, ...rows.map(([l]) => l.length));
  return [
    `${c.summary}`,
    '',
    `Usage: ${usageLine(c)}`,
    ...(c.description ? ['', c.description] : []),
    ...(rows.length ? ['', 'Options:', ...rows.map(([l, d]) => `  ${l.padEnd(width)}  ${d}`)] : []),
    ...(c.interactive ? ['', 'Asks a confirmation: --yes for scripts and agents (exit 2 without it when nobody can answer).'] : []),
    ...(c.offline ? ['', 'Works offline.'] : []),
    '',
    'Examples:',
    ...c.examples.map((e) => `  ${e}`),
    '',
    `JSON Schemas of its input and output: breakrocks schema ${c.name}`,
  ].join('\n');
}

/** The help of a group of commands. */
export function groupHelp(group: string): string {
  const list = commands().filter((c) => groupOf(c) === group);
  const width = Math.max(...list.map((c) => c.name.length));
  return [`${GROUP_SUMMARIES[group] ?? group}`, '', 'Commands:', ...list.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`), '', `Help of a command: breakrocks ${group} <action> --help`].join('\n');
}

/** The overview: every group and its commands, the global options, the exit codes. */
export function overviewHelp(): string {
  const all = commands();
  const width = Math.max(...all.map((c) => c.name.length));
  const optionWidth = Math.max(...GLOBAL_OPTIONS.map(([o]) => o.length));
  return [
    'Usage: breakrocks <command> [options]',
    '',
    'Commands:',
    ...groups().flatMap((g) => all.filter((c) => groupOf(c) === g).map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`)),
    '',
    'Options:',
    ...GLOBAL_OPTIONS.map(([o, d]) => `  ${o.padEnd(optionWidth)}  ${d}`),
    '',
    'Exit codes: 0 done, 1 refused (the code of the contract), 2 usage, 3 network or session.',
    'Help of a command: breakrocks <command> --help',
  ].join('\n');
}
