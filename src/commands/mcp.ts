// breakrocks mcp: the MCP server on stdio, until the client closes it.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../mcp/server.js';
import { stderrOnly } from '../output.js';
import type { Command } from '../registry.js';
import { object } from '../schema.js';

export const mcpCommand: Command<Record<string, never>, undefined> = {
  name: 'mcp', summary: 'Start the MCP server on stdio: every command as a tool, for Claude Code, Codex, an agent',
  description: 'Tools breakrocks_<group>_<action> (the input schemas of `breakrocks schema all`), resources breakrocks://whoami, breakrocks://capabilities and breakrocks://profiles, the prompt theme-prompt. Uses the current profile, or --profile and --env given here. A tool that asks a confirmation needs "yes": true. README § MCP: how to plug it in.',
  examples: ['breakrocks mcp', 'breakrocks --profile herald mcp', 'claude mcp add breakrocks -- npx -y breakrocks mcp'],
  input: object({}), output: { type: 'null', description: 'Nothing: the server speaks MCP on stdio until it is closed' }, offline: true, mcp: false,
  run: async (ctx) => {
    const server = createServer({ ...ctx.io, out: stderrOnly, interactive: false }, { profile: ctx.flags.profile, env: ctx.flags.env });
    // Until the client closes the connection, or stdin ends (the client went away).
    const closed = new Promise<void>((resolve) => {
      server.onclose = () => resolve();
      process.stdin.once('end', () => resolve());
      process.stdin.once('close', () => resolve());
    });
    await server.connect(new StdioServerTransport());
    await closed;
    await server.close().catch(() => undefined);
    return undefined;
  },
};
