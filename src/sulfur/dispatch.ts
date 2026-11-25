// Which command runs for a backend: on the former one, the registry's; on the new one (native-sulfur), its stand-in
// (src/sulfur/commands.ts) when it has one, else the registry's own command: its GraphQL requests go through the seam of
// src/session.ts api() (src/sulfur/talc.ts: served as is where the server serves the talc operation, adapted where it
// deviates, NOT_ON_NEW_BACKEND otherwise). A command that needs the former backend's own hosts (its sign-in, the agents
// host, its real time) is refused with NOT_ON_NEW_BACKEND (LEGACY_ONLY, and session.ts ensureSession as a last guard).
import type { Context } from '../context.js';
import { cliRefusal } from '../errors.js';
import type { AnyCommand } from '../registry.js';
import { SULFUR_COMMANDS } from './commands.js';

/** The commands of the former backend's own hosts (Cognito, the agents host), and why. */
export const LEGACY_ONLY: ReadonlyMap<string, string> = new Map([
  ['operator register', 'an agent operator registers on the agents host of the former backend'],
  ['operator login', 'an agent operator signs in on the agents host of the former backend'],
  ['operator renew', 'the agents host of the former backend'],
  ['operator recover', 'the agents host of the former backend'],
  ['operator recovery-key set', 'the agents host of the former backend'],
  ['operator delete', 'the agents host of the former backend'],
  ['session', 'the sessions of the former backend; on the new one: whoami'],
  ['agents tier', 'x402 on the agents host of the former backend'],
]);

export const notOnNewBackend = (command: AnyCommand, why?: string) => cliRefusal('NOT_ON_NEW_BACKEND', `"breakrocks ${command.name}" is not on the new backend (native-sulfur)${why ? `: ${why}` : ''}: --backend legacy, or BREAKROCKS_BACKEND=legacy`, { command: command.name, backend: 'sulfur' });

/** The command to run for [command] on the backend of [ctx]; [soft]: the registry's when none (the help of a command). */
export function forBackend(ctx: Context, command: AnyCommand, options: { soft?: boolean } = {}): AnyCommand {
  if (ctx.backend() !== 'sulfur') return command;
  const standIn = SULFUR_COMMANDS.get(command.name);
  if (standIn) return standIn;
  const why = LEGACY_ONLY.get(command.name);
  if (why && !options.soft) throw notOnNewBackend(command, why);
  return command;
}

/** Whether [command] is meant to run on the new backend (its stand-in, or its requests through the seam). */
export const servedOnSulfur = (command: AnyCommand) => SULFUR_COMMANDS.has(command.name) || !LEGACY_ONLY.has(command.name);
