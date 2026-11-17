// The registry of the commands: each one declares its name, its summary and description, the JSON
// Schema of its input (options and positionals) and of its output, and its run. The help, --json,
// `breakrocks schema <command>` and the MCP server (one tool per command) derive from it.
import type { Context } from './context.js';
import { paintErr } from './colour.js';
import type { ExitCode } from './errors.js';
import { assertValid, type ArgSpec, type JsonSchema, type ObjectSchema } from './schema.js';
import { DEFAULT_ACTIONS, PLACEMENTS } from './tree.js';

export type Command<I = Record<string, unknown>, O = unknown> = {
  /** Its words, the group first: "agents create", "whoami" (its path in the tree, src/tree.ts). */
  name: string;
  /** Its line in the lists: one line, 60 characters at most, no API operation, no limit (src/tree.ts). */
  summary: string;
  /** What it does in detail, at the top of its own help (the detailed summary of its declaration). */
  details?: string;
  description?: string;
  /** The operation of the API it is ("API: <operation>" in its help). */
  api?: string;
  /** Its former names, still accepted (hidden, deprecated): src/tree.ts. */
  aliases?: string[];
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
  /** Its MCP tool when it is not breakrocks_<its words>: a tool name an earlier command held is never given to another one (0.34.0). */
  tool?: string;
  /** Tool names it still answers to and lists, deprecated (a name its command held before it moved). */
  formerTools?: string[];
  run: (ctx: Context, input: I) => Promise<O> | O;
  /** Its answer in plain text (default: the fields, one per line); [input] the input of the command line (the next page told). */
  text?: (result: O, input: I) => string;
  /** The exit code of an answer that is not a success (a report of problems): 0 by default. */
  exitCode?: (result: O) => ExitCode;
  /** What --quiet writes: the identifier created or read, nothing otherwise. */
  quiet?: (result: O) => string | undefined;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommand = Command<any, any>;

const COMMANDS: AnyCommand[] = [];
/** Former name → the command it now is. */
const ALIASES = new Map<string, AnyCommand>();
/** The most words a command name has. */
export const MAX_WORDS = 5;

/** Former names in a text: "breakrocks <former name>" becomes "breakrocks <path>" (examples, hints). */
const FORMER = [...PLACEMENTS].filter(([name, p]) => p.path !== name).sort(([a], [b]) => b.length - a.length);
const FORMER_RE = new RegExp(`breakrocks (${FORMER.map(([n]) => n.replace(/[-]/g, '\\-')).join('|')})(?![\\w-])`, 'g');
const FORMER_PATH = new Map(FORMER.map(([n, p]) => [n, p.path]));
export const modernize = (text: string) => text.replace(FORMER_RE, (_, name: string) => `breakrocks ${FORMER_PATH.get(name)}`);

/** [c] at its place in the tree: its path, its list summary, its detailed summary, its former name. */
function placed(c: AnyCommand): AnyCommand {
  const place = PLACEMENTS.get(c.name);
  const examples = c.examples.map(modernize);
  const description = c.description && modernize(c.description);
  if (!place) return { ...c, examples, ...(description ? { description } : {}) };
  let details = place.summary === c.summary ? undefined : c.summary;
  if (details && c.api) details = details.replace(new RegExp(`\\s*\\(${c.api}\\)`), '').replace(`(${c.api}; `, '(').replace(`; ${c.api})`, ')');
  return {
    ...c, name: place.path, summary: place.summary, examples, ...(description ? { description } : {}), ...(details ? { details } : {}),
    ...(place.path !== c.name ? { aliases: [...(c.aliases ?? []), c.name] } : {}),
  };
}

/** Adds commands to the registry, in the order of the help, each at its place in the tree. */
export function register(...commands: AnyCommand[]): void {
  for (const declared of commands) {
    const c = placed(declared);
    if (COMMANDS.some((x) => x.name === c.name)) throw new Error(`Command "${c.name}" registered twice`);
    if (c.name.split(' ').length > MAX_WORDS) throw new Error(`Command "${c.name}": ${MAX_WORDS} words at most`);
    COMMANDS.push(c);
    for (const alias of c.aliases ?? []) ALIASES.set(alias, c);
  }
}
export const commands = (): readonly AnyCommand[] => COMMANDS;
/** Every former name and the command it now is. */
export const aliases = (): ReadonlyMap<string, AnyCommand> => ALIASES;
export const groupOf = (c: AnyCommand) => c.name.split(' ')[0];
export const groups = () => [...new Set(COMMANDS.map(groupOf))];

/**
 * The command named by the first words of [words], the longest name first, with the words left; a
 * former name too (alias: that name).
 */
export function findCommand(words: readonly string[]): { command: AnyCommand; rest: string[]; alias?: string } | undefined {
  for (let n = Math.min(words.length, MAX_WORDS); n > 0; n--) {
    const name = words.slice(0, n).join(' ');
    const command = COMMANDS.find((c) => c.name === name);
    if (command) return { command, rest: words.slice(n) };
    const moved = ALIASES.get(name);
    if (moved) return { command: moved, rest: words.slice(n), alias: name };
  }
  return undefined;
}

/**
 * The words of a command line with the default action of a group put in (src/tree.ts DEFAULT_ACTIONS): "look appearance
 * %lyon" → "look appearance show %lyon", when the word after the group is not an option, a command or a subgroup.
 */
export function withDefaultAction(tokens: readonly string[]): string[] {
  for (const [group, action] of Object.entries(DEFAULT_ACTIONS)) {
    const words = group.split(' ');
    if (tokens.length <= words.length || words.some((w, i) => tokens[i] !== w)) continue;
    const next = tokens[words.length];
    if (next.startsWith('-') || COMMANDS.some((c) => c.name === `${group} ${next}` || c.name.startsWith(`${group} ${next} `))) continue;
    return [...words, action, ...tokens.slice(words.length)];
  }
  return [...tokens];
}

/** The commands under the path [prefix] (a group or a subgroup): "universes private" → its commands. */
export const commandsUnder = (prefix: string) => COMMANDS.filter((c) => c.name.startsWith(`${prefix} `));

/** The one-line notice of a former name, on stderr. */
export const deprecationNotice = (alias: string, command: AnyCommand) => paintErr.warn(`Warning: "breakrocks ${alias}" is deprecated, use "breakrocks ${command.name}".`);

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
