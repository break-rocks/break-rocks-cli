// The registry of the commands: each one declares its name, its summary and description, the JSON
// Schema of its input (options and positionals) and of its output, and its run. The help, --json,
// `breakrocks schema <command>` (C-30) and the MCP server (one tool per command) derive from it.
import type { Context } from './context.js';
import type { ExitCode } from './errors.js';
import { assertValid, type ArgSpec, type JsonSchema, type ObjectSchema } from './schema.js';

export type Command<I = Record<string, unknown>, O = unknown> = {
  /** Its words, the group first: "agents create", "whoami". */
  name: string;
  summary: string;
  description?: string;
  /** One example per line, as typed in a terminal. */
  examples: string[];
  input: ObjectSchema;
  output: JsonSchema;
  args?: ArgSpec;
  /** It may ask a confirmation (an irreversible action, a payment): --yes, or "yes": true from MCP. */
  interactive?: boolean;
  /** It never uses the network. */
  offline?: boolean;
  /** Left out of the MCP server (the server itself). */
  mcp?: false;
  run: (ctx: Context, input: I) => Promise<O> | O;
  /** Its answer in plain text (default: the fields, one per line). */
  text?: (result: O) => string;
  /** The exit code of an answer that is not a success (a report of problems): 0 by default. */
  exitCode?: (result: O) => ExitCode;
  /** What --quiet writes: the identifier created or read, nothing otherwise. */
  quiet?: (result: O) => string | undefined;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommand = Command<any, any>;

const COMMANDS: AnyCommand[] = [];

/** Adds commands to the registry, in the order of the help. */
export function register(...commands: AnyCommand[]): void {
  for (const c of commands) {
    if (COMMANDS.some((x) => x.name === c.name)) throw new Error(`Command "${c.name}" registered twice`);
    COMMANDS.push(c);
  }
}
export const commands = (): readonly AnyCommand[] => COMMANDS;
export const groupOf = (c: AnyCommand) => c.name.split(' ')[0];
export const groups = () => [...new Set(COMMANDS.map(groupOf))];

/** The command named by the first words of [words], the longest name first, with the words left. */
export function findCommand(words: readonly string[]): { command: AnyCommand; rest: string[] } | undefined {
  for (let n = Math.min(words.length, 4); n > 0; n--) {
    const name = words.slice(0, n).join(' ');
    const command = COMMANDS.find((c) => c.name === name);
    if (command) return { command, rest: words.slice(n) };
  }
  return undefined;
}

/** The input schema of a command as an MCP client sees it: its own, with "yes" when it may ask a confirmation. */
export function toolInputSchema(c: AnyCommand): ObjectSchema {
  if (!c.interactive) return c.input;
  return { ...c.input, properties: { ...c.input.properties, yes: { type: 'boolean', description: 'Confirms the irreversible action or the payment (as --yes); refused without it' } } };
}

/** Runs [command] with [input], checked against its schema first (INVALID_INPUT, exit 2). */
export async function execute(ctx: Context, command: AnyCommand, input: Record<string, unknown>): Promise<unknown> {
  assertValid(command.input, input);
  return command.run(ctx, input);
}
