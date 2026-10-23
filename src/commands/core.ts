// help, version and schema (C-30): what the CLI says about itself, offline.
import { usageError } from '../errors.js';
import { commandHelp, groupHelp, overviewHelp } from '../help.js';
import { commands, findCommand, groups, toolInputSchema, type AnyCommand, type Command } from '../registry.js';
import { list, object, openObject, str } from '../schema.js';
import { VERSION } from '../version.js';

type HelpResult = { text: string; commands: { name: string; summary: string }[] };

export const help: Command<{ command?: string[] }, HelpResult> = {
  name: 'help', summary: 'Show the help of the CLI, of a group or of a command',
  examples: ['breakrocks help', 'breakrocks help agents create', 'breakrocks help --json'],
  input: object({ command: list('The command (or the group) to explain') }),
  output: openObject({ text: str('The help as text'), commands: list('Every command', openObject({ name: str('Its name'), summary: str('What it does') })) }),
  args: { positionals: ['command'] }, offline: true,
  run: (_ctx, { command = [] }) => {
    const all = commands().map(({ name, summary }) => ({ name, summary }));
    if (!command.length) return { text: overviewHelp(), commands: all };
    const found = findCommand(command);
    if (found && !found.rest.length) return { text: commandHelp(found.command), commands: all.filter((c) => c.name === found.command.name) };
    if (command.length === 1 && groups().includes(command[0])) return { text: groupHelp(command[0]), commands: all.filter((c) => c.name.split(' ')[0] === command[0]) };
    throw usageError('UNKNOWN_COMMAND', `Unknown command "${command.join(' ')}"`, { command: command.join(' ') });
  },
  text: (r) => r.text,
};

export const version: Command<Record<string, never>, { version: string }> = {
  name: 'version', summary: 'Show the version of the CLI', examples: ['breakrocks version', 'breakrocks --version'],
  input: object({}), output: openObject({ version: str('The version of the CLI (semantic)') }), offline: true,
  run: () => ({ version: VERSION }), text: (r) => r.version, quiet: (r) => r.version,
};

type SchemaResult = { command: string; summary: string; interactive: boolean; offline: boolean; input: unknown; output: unknown; mcpTool: string };

export const schema: Command<{ command: string[] }, SchemaResult | SchemaResult[]> = {
  name: 'schema', summary: 'Show the JSON Schemas of the input and the output of a command (all of them with "all")',
  description: 'The input schema is the one an MCP client receives for the tool of the command (with "yes" when the command asks a confirmation); the output is what --json writes.',
  examples: ['breakrocks schema agents create', 'breakrocks schema all --json'],
  input: object({ command: list('The command, or "all"', { type: 'string' }, { minItems: 1 }) }, ['command']),
  output: openObject({ command: str('The command'), input: openObject({}, 'JSON Schema of its input'), output: openObject({}, 'JSON Schema of its output'), mcpTool: str('The name of its MCP tool') }),
  args: { positionals: ['command'] }, offline: true,
  run: (_ctx, { command }) => {
    const describe = (c: AnyCommand): SchemaResult => ({
      command: c.name, summary: c.summary, interactive: !!c.interactive, offline: !!c.offline, input: toolInputSchema(c), output: c.output, mcpTool: toolName(c.name),
    });
    if (command.length === 1 && command[0] === 'all') return commands().map(describe);
    const found = findCommand(command);
    if (!found || found.rest.length) throw usageError('UNKNOWN_COMMAND', `Unknown command "${command.join(' ')}"`, { command: command.join(' ') });
    return describe(found.command);
  },
  text: (r) => JSON.stringify(r, null, 2),
};

/** The MCP tool of a command: breakrocks_<group>_<action>, words joined by "_" ("operator recovery-key set": breakrocks_operator_recovery_key_set). */
export const toolName = (name: string) => `breakrocks_${name.replace(/[ -]/g, '_')}`;
