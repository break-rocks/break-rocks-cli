// help, version and schema: what the CLI says about itself, offline.
import { usageError } from '../errors.js';
import { allHelp, commandHelp, domainHelp, domainOf, groupHelp, isGroup, movedHelp, optionsHelp, overviewHelp, searchCommands, searchHelp, suggestions } from '../help.js';
import { commands, commandsUnder, findCommand, toolInputSchema, type AnyCommand, type Command } from '../registry.js';
import { DOMAINS } from '../tree.js';
import { bool, list, object, openObject, str } from '../schema.js';
import { VERSION } from '../version.js';

type HelpResult = { text: string; commands: { name: string; summary: string }[] };

/** The refusal of an unknown command, with the commands closest to it. */
export function unknownCommand(words: readonly string[]) {
  const typed = words.join(' ');
  const close = suggestions(words);
  return usageError('UNKNOWN_COMMAND', `Unknown command "${typed}".${close.length ? ` Did you mean ${close.map((c) => `"${c}"`).join(', ')}?` : ''} breakrocks help <word> searches the commands.`, { command: typed, suggestions: close });
}

export const help: Command<{ command?: string[]; all?: boolean }, HelpResult> = {
  name: 'help', summary: 'Show the help of the CLI, of a domain, of a group or of a command, or search the commands',
  description: `The overview shows the domains (${DOMAINS.map((d) => d.name).join(', ')}); breakrocks help <domain> their commands; breakrocks help <word> searches the names and the descriptions of the commands; breakrocks help options the options of every command; --all every command.`,
  examples: ['breakrocks help', 'breakrocks help talk', 'breakrocks help invite', 'breakrocks help agents create', 'breakrocks help --all', 'breakrocks help --json'],
  input: object({ command: list('The domain, the group, the command or the words to search'), all: bool('Every command') }),
  output: openObject({ text: str('The help as text'), commands: list('The commands it is about', openObject({ name: str('Its name'), summary: str('What it does') })) }),
  args: { positionals: ['command'] }, offline: true,
  run: (_ctx, { command = [], all: every }) => {
    const row = ({ name, summary }: AnyCommand) => ({ name, summary });
    const all = commands().map(row);
    if (every) return { text: allHelp(), commands: all };
    if (!command.length) return { text: overviewHelp(), commands: all };
    const path = command.join(' ');
    if (path === 'options') return { text: optionsHelp(), commands: [] };
    if (command.length === 1 && domainOf(path)) {
      const groups = domainOf(path)!.groups;
      return { text: domainHelp(path), commands: commands().filter((c) => groups.includes(c.name.split(' ')[0])).map(row) };
    }
    const found = findCommand(command);
    if (found && !found.rest.length) return { text: commandHelp(found.command), commands: [row(found.command)] };
    if (isGroup(path)) return { text: groupHelp(path), commands: commandsUnder(path).map(row) };
    const moved = movedHelp(path);
    if (moved) return { text: moved, commands: [] };
    const hits = searchCommands(command);
    if (hits.length) return { text: searchHelp(command, hits), commands: hits.map(row) };
    throw unknownCommand(command);
  },
  text: (r) => r.text,
};

export const version: Command<Record<string, never>, { version: string }> = {
  name: 'version', summary: 'Show the version of the CLI', examples: ['breakrocks version', 'breakrocks --version'],
  input: object({}), output: openObject({ version: str('The version of the CLI (semantic)') }), offline: true,
  run: () => ({ version: VERSION }), text: (r) => r.version, quiet: (r) => r.version,
};

type SchemaResult = { command: string; summary: string; formerNames?: string[]; interactive: boolean; offline: boolean; input: unknown; output: unknown; mcpTool: string };

export const schema: Command<{ command: string[] }, SchemaResult | SchemaResult[]> = {
  name: 'schema', summary: 'Show the JSON Schemas of the input and the output of a command (all of them with "all")',
  description: 'The input schema is the one an MCP client receives for the tool of the command (with "yes" when the command asks a confirmation); the output is what --json writes.',
  examples: ['breakrocks schema agents create', 'breakrocks schema all --json'],
  input: object({ command: list('The command, or "all"', { type: 'string' }, { minItems: 1 }) }, ['command']),
  output: openObject({ command: str('The command'), input: openObject({}, 'JSON Schema of its input'), output: openObject({}, 'JSON Schema of its output'), mcpTool: str('The name of its MCP tool') }),
  args: { positionals: ['command'] }, offline: true,
  run: (_ctx, { command }) => {
    const describe = (c: AnyCommand): SchemaResult => ({
      command: c.name, summary: c.summary, ...(c.aliases?.length ? { formerNames: c.aliases } : {}), interactive: !!c.interactive, offline: !!c.offline, input: toolInputSchema(c), output: c.output, mcpTool: toolName(c.name),
    });
    if (command.length === 1 && command[0] === 'all') return commands().map(describe);
    const found = findCommand(command);
    if (!found || found.rest.length) throw unknownCommand(command);
    return describe(found.command);
  },
  text: (r) => JSON.stringify(r, null, 2),
};

/** The MCP tool of a command: breakrocks_<group>_<action>, words joined by "_" ("operator recovery-key set": breakrocks_operator_recovery_key_set). */
export const toolName = (name: string) => `breakrocks_${name.replace(/[ -]/g, '_')}`;
