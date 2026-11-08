// The MCP server of the CLI: every command of the registry as a tool (breakrocks_<group>_<action>,
// the input schema of the registry, the answer = the --json of the command), three resources
// (breakrocks://whoami, breakrocks://capabilities, breakrocks://profiles) and a prompt (theme-prompt).
// It uses the current profile (or the --profile / --env given to `breakrocks mcp`); a tool that asks a
// confirmation is refused unless its input carries "yes": true; nothing is ever asked on stdin
// (stdin and stdout are the protocol), progress goes to stderr.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { toolName } from '../commands/core.js';
import { Context, NO_FLAGS, type GlobalFlags, type Io } from '../context.js';
import { asCliError, usageError } from '../errors.js';
import { commands, execute, findCommand, toolInputSchema, type AnyCommand } from '../registry.js';
import { LANGUAGES, themePrompt, type Language } from '../theme/prompt.js';
import { VERSION } from '../version.js';

export const RESOURCES = [
  { uri: 'breakrocks://whoami', name: 'whoami', title: 'The account signed in', description: 'The answer of breakrocks whoami --json', command: 'whoami' },
  { uri: 'breakrocks://capabilities', name: 'capabilities', title: 'What the profile may do now', description: 'The answer of breakrocks capabilities --json', command: 'capabilities' },
  { uri: 'breakrocks://profiles', name: 'profiles', title: 'The profiles', description: 'The answer of breakrocks profile list --json', command: 'profile list' },
] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The tools: one per command of the registry (the server itself apart). */
export const tools = () => commands().filter((c) => c.mcp !== false).map((c) => ({
  name: toolName(c.name),
  title: `breakrocks ${c.name}`,
  description: [c.summary, c.description, c.interactive ? 'Irreversible or paid: refused unless "yes": true.' : '', c.offline ? 'Offline.' : ''].filter(Boolean).join(' '),
  inputSchema: toolInputSchema(c),
}));

export const commandOfTool = (name: string): AnyCommand | undefined => commands().find((c) => c.mcp !== false && toolName(c.name) === name);

/** Runs a command for an MCP client: its JSON answer, or its refusal ({ error }) marked isError. */
export async function callCommand(io: Io, base: Pick<GlobalFlags, 'profile' | 'env' | 'agent'>, command: AnyCommand, args: Record<string, unknown>) {
  const { yes, ...input } = args;
  if (yes !== undefined && !command.interactive) return failure(usageError('INVALID_INPUT', `input.yes: is not an option of ${command.name}`));
  const ctx = new Context({ ...io, interactive: false, readStdin: undefined, collectWatch: true }, { ...NO_FLAGS, ...base, json: true, yes: yes === true });
  try {
    const result = await execute(ctx, command, input);
    const exit = command.exitCode?.(result) ?? 0;
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? null, null, 2) }], ...(isObject(result) ? { structuredContent: result } : {}), ...(exit ? { isError: true } : {}) };
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown) {
  const refusal = asCliError(error).toJSON();
  return { content: [{ type: 'text' as const, text: JSON.stringify(refusal, null, 2) }], structuredContent: refusal, isError: true };
}

const answerOf = async (io: Io, base: Pick<GlobalFlags, 'profile' | 'env' | 'agent'>, command: string) => (await callCommand(io, base, findCommand(command.split(' '))!.command, {})).content[0].text;

/**
 * The account prompts (D-235): whoami (who acts), agents (the local agents) and login (how a person
 * signs in: never done in the MCP server, which opens no session for another account).
 */
export const ACCOUNT_PROMPTS = [
  { name: 'whoami', title: 'Who acts', description: 'The account and the delegated agent this MCP server acts as (breakrocks whoami --json)', text: async (io: Io, base: Pick<GlobalFlags, 'profile' | 'env' | 'agent'>) => `This break.rocks MCP server acts as:\n${await answerOf(io, base, 'whoami')}` },
  { name: 'agents', title: 'The local agents', description: 'The local agents of this device (breakrocks agents local --json): start the server with --agent <name> to act as one', text: async (io: Io, base: Pick<GlobalFlags, 'profile' | 'env' | 'agent'>) => `The local agents of this device (start \`breakrocks mcp --agent <name>\` to act as one; this server acts as ${base.agent ? `"${base.agent}"` : 'its profile'}):\n${await answerOf(io, base, 'agents local')}` },
  { name: 'login', title: 'How to sign in', description: 'How a person signs in from a terminal (no sign-in happens in the MCP server)', text: async () => [
    'The MCP server never signs anyone in: a person runs one of these in a terminal, then restarts the MCP server.',
    '- A human: `breakrocks login` (an email code), or `breakrocks login --browser`.',
    '- An agent operator: `breakrocks operator login`; then `breakrocks agents create <name>` keeps a delegated agent as a local agent.',
    '- A local agent: nothing to do. Start the server with `breakrocks mcp --agent <name>`: it signs in with the key of the system keychain and renews its session.',
    '- A key file: `breakrocks agents import <name> --operator <operator id> --agent <agent id> --key <file>`.',
    '- Then `breakrocks doctor` checks the version, the profile, the agent, its session and the API.',
  ].join('\n') },
] as const;

/** The MCP server of the CLI, on [io] (its out must be stderr-only: stdout is the protocol). */
export function createServer(io: Io, base: Pick<GlobalFlags, 'profile' | 'env' | 'agent'> = {}): Server {
  const server = new Server({ name: 'breakrocks', title: 'break.rocks', version: VERSION }, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions: 'The break.rocks CLI as tools, with the session of the profile the server started with (a human signed in with breakrocks login at the terminal, an agent operator, or a delegated agent: sign-in with keys; beyond its quota, a delegated agent pays its extra usage with x402 when its profile allows it, breakrocks wallet set --extra-usage, within the caps of the wallet, otherwise the tool is refused PAYMENT_REQUIRED with the conditions): reading, publishing, messages, themes, usage and capabilities, offline theme tools. Read breakrocks://capabilities before acting. Every refusal is { "error": { "code" } } with the code of the contract. Irreversible or paid tools need "yes": true.',
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const command = commandOfTool(request.params.name);
    if (!command) return failure(usageError('UNKNOWN_TOOL', `No tool ${request.params.name}`));
    return callCommand(io, base, command, (request.params.arguments ?? {}) as Record<string, unknown>);
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES.map(({ uri, name, title, description }) => ({ uri, name, title, description, mimeType: 'application/json' })) }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = RESOURCES.find((r) => r.uri === request.params.uri);
    if (!resource) throw usageError('UNKNOWN_RESOURCE', `No resource ${request.params.uri}`);
    const answer = await callCommand(io, base, findCommand(resource.command.split(' '))!.command, {});
    return { contents: [{ uri: resource.uri, mimeType: 'application/json', text: answer.content[0].text }] };
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [...ACCOUNT_PROMPTS.map(({ name, title, description }) => ({ name, title, description })), {
      name: 'theme-prompt', title: 'Ask an AI for a break.rocks theme', description: 'The prompt of breakrocks theme prompt, on the model of specs v99: a theme.json of the format 2 (the four families of theme surfaces page, sky, block and control, one title typeface, the image slots page and pageHeader; no radius, no border, no opacity, the readability mask computed by the platform) and its images, for a field (or a universal theme), a mood, a name and a universe.',
      arguments: [
        { name: 'field', description: 'The field: sport, culture, politics, entertainment, science, games, places, work, everyday life, tech (none for a universal theme)' },
        { name: 'mood', description: 'The mood, in a few words', required: true },
        { name: 'name', description: 'The name of the theme', required: true },
        { name: 'universe', description: 'The universe it will be published in (%name; %root by default for a universal theme)' },
        { name: 'universal', description: 'true: the prompt of a universal theme (no field, the palette and the typeface of Socle)' },
        { name: 'fonts', description: 'The title typeface (approved list; since specs v99 there is no accent typeface)' },
        { name: 'description', description: 'Its description (160 characters at most)' },
        { name: 'language', description: `The language of the prompt: ${LANGUAGES.join(' or ')} (default en)` },
      ],
    }],
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const account = ACCOUNT_PROMPTS.find((p) => p.name === request.params.name);
    if (account) return { description: account.description, messages: [{ role: 'user' as const, content: { type: 'text' as const, text: await account.text(io, base) } }] };
    if (request.params.name !== 'theme-prompt') throw usageError('UNKNOWN_PROMPT', `No prompt ${request.params.name}`);
    const a = request.params.arguments ?? {};
    const language = (a.language ?? 'en') as Language;
    if (!LANGUAGES.includes(language)) throw usageError('INVALID_INPUT', `language: ${LANGUAGES.join(' or ')}`);
    try {
      const { prompt } = themePrompt({ field: a.field || undefined, mood: a.mood ?? '', name: a.name ?? '', universe: a.universe || undefined, universal: a.universal === 'true', description: a.description, fonts: a.fonts ? a.fonts.split(',').map((f) => f.trim()).filter(Boolean) : undefined, language });
      return { description: `A break.rocks theme "${a.name}" for ${a.universe}`, messages: [{ role: 'user' as const, content: { type: 'text' as const, text: prompt } }] };
    } catch (error) {
      const e = asCliError(error);
      throw new Error(`${e.code}: ${e.message}`);
    }
  });
  return server;
}
