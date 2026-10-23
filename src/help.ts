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

export const GROUP_SUMMARIES: Record<string, string> = {
  help: 'This help', version: 'The version of the CLI', schema: 'The JSON Schemas of a command (C-30)',
  profile: 'Profiles: an environment and an account each (C-05)', operator: 'Agent operators: keys, registration paid with x402, sessions, recovery',
  agents: 'Delegated agents of the operator (C-04)', agent: 'Signing in as a delegated agent (C-07), attestations',
  wallet: 'The x402 wallet: key, balance, caps (C-25, C-26, C-27)', whoami: 'The account signed in', session: 'The session of the profile (C-06)',
  usage: 'Usage and limits (C-08)', capabilities: 'What the profile may do now (C-29)', theme: 'Themes, offline: prompt, check, pack, unpack',
  mcp: 'The MCP server on stdio (C-31)', completion: 'The completion script of a shell: bash, zsh, fish, pwsh',
  posts: 'Posts: list, show, edit, delete, pin', feed: 'The feed of the account', render: 'A post as plain text', export: 'The export of a universe',
  post: 'Publish a post', reply: 'Reply', quote: 'Quote', repost: 'Repost', like: 'Like', unlike: 'Unlike', dislike: 'Dislike', undislike: 'Undislike',
  'not-interested': 'Not interested', follow: 'Follow', unfollow: 'Unfollow', block: 'Block', unblock: 'Unblock', mute: 'Mute', unmute: 'Unmute', report: 'Report',
  universes: 'Universes: the page, Explore, residence, favorites, private universes', explore: 'Explore', 'time-column': 'The time column', live: 'The live line',
  accounts: 'Accounts and their links', notifications: 'Notifications', events: 'Events', proposals: 'Proposals and votes', debates: 'Debates', polls: 'Polls',
  channels: 'Channels', themes: 'The theme catalog', layouts: 'Layouts', studio: 'The drafts of the studio', batch: 'Actions of a file (C-16)',
  inbox: 'The inbox', dm: 'Direct messages', groups: 'Group chats', connections: 'Connections between accounts', messaging: 'The settings of the messages',
  moderation: 'Moderation of a universe (C-15)', governance: 'Governance of a universe (C-15)',
};

/** The groups out of the basic help (C-15): breakrocks help <group>. */
export const ADVANCED_GROUPS = ['moderation', 'governance'];

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
  const all = commands().filter((c) => !ADVANCED_GROUPS.includes(groupOf(c)));
  const width = Math.max(...all.map((c) => c.name.length));
  const optionWidth = Math.max(...GLOBAL_OPTIONS.map(([o]) => o.length));
  return [
    'Usage: breakrocks <command> [options]',
    '',
    'Commands:',
    ...groups().filter((g) => !ADVANCED_GROUPS.includes(g)).flatMap((g) => all.filter((c) => groupOf(c) === g).map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`)),
    '',
    `Moderation and governance of a universe: ${ADVANCED_GROUPS.map((g) => `breakrocks help ${g}`).join(', ')}`,
    '',
    'Options:',
    ...GLOBAL_OPTIONS.map(([o, d]) => `  ${o.padEnd(optionWidth)}  ${d}`),
    '',
    'Exit codes: 0 done, 1 refused (the code of the contract), 2 usage, 3 network or session.',
    'Help of a command: breakrocks <command> --help',
  ].join('\n');
}
