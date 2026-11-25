// Which command runs for a backend: on the former one, the registry's; on the new one (native-sulfur), its stand-in
// (src/sulfur/commands.ts), the commands that never use the network or the platform (help, config, themes checked
// offline, completion, update, the MCP server itself), or NOT_ON_NEW_BACKEND.
import type { Context } from '../context.js';
import { cliRefusal } from '../errors.js';
import type { AnyCommand } from '../registry.js';
import { SULFUR_COMMANDS } from './commands.js';

/** Commands that use the network but not the platform's API. */
const PLATFORM_FREE = new Set(['update', 'mcp', 'help', 'version', 'schema', 'completion']);

export const notOnNewBackend = (command: AnyCommand) => cliRefusal('NOT_ON_NEW_BACKEND', `"breakrocks ${command.name}" is not yet on the new backend (native-sulfur): --backend legacy, or BREAKROCKS_BACKEND=legacy`, { command: command.name, backend: 'sulfur' });

/** The command to run for [command] on the backend of [ctx]; [soft]: the registry's when none (the help of a command). */
export function forBackend(ctx: Context, command: AnyCommand, options: { soft?: boolean } = {}): AnyCommand {
  if (ctx.backend() !== 'sulfur') return command;
  const standIn = SULFUR_COMMANDS.get(command.name);
  if (standIn) return standIn;
  if (command.offline || PLATFORM_FREE.has(command.name) || options.soft) return command;
  throw notOnNewBackend(command);
}

/** Whether [command] has a stand-in on the new backend. */
export const servedOnSulfur = (command: AnyCommand) => SULFUR_COMMANDS.has(command.name) || !!command.offline || PLATFORM_FREE.has(command.name);
