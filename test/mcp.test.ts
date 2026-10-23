// The MCP server, through a client of the SDK in memory: its tools (one per command), a call, the
// refusal of a tool that asks a confirmation without "yes", its resources and its prompt.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/mcp/server.js';
import { commands } from '../src/registry.js';
import { fakePayer, onPlatform } from './fake-platform.js';
import { harness } from './helpers.js';

async function connected(h: ReturnType<typeof harness>, base = {}) {
  const server = createServer(h.io, base);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(b);
  return client;
}
const textOf = (r: any) => JSON.parse((r.content as { text: string }[])[0].text);

describe('the MCP server', () => {
  it('lists every command of the registry as a tool, with its input schema', async () => {
    const client = await connected(harness());
    const { tools } = await client.listTools();
    expect(tools.length).toBe(commands().length - 1);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['breakrocks_whoami', 'breakrocks_capabilities', 'breakrocks_agents_create', 'breakrocks_operator_register', 'breakrocks_theme_prompt', 'breakrocks_agent_login']));
    expect(names).not.toContain('breakrocks_mcp');
    const create = tools.find((t) => t.name === 'breakrocks_agents_create')!;
    expect(create.inputSchema).toMatchObject({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, interactions: { type: 'array' } } });
    expect(tools.find((t) => t.name === 'breakrocks_agents_delete')!.inputSchema.properties).toHaveProperty('yes');
  });
  it('gives each tool a complete input schema: every property typed and described, the required ones known', async () => {
    const client = await connected(harness());
    const { tools } = await client.listTools();
    const incomplete: string[] = [];
    for (const t of tools) {
      const props = (t.inputSchema.properties ?? {}) as Record<string, { type?: unknown; anyOf?: unknown; enum?: unknown; description?: string }>;
      for (const [name, p] of Object.entries(props)) if (!(p.type || p.anyOf || p.enum) || !p.description) incomplete.push(`${t.name}.${name}`);
      for (const r of (t.inputSchema.required ?? []) as string[]) if (!props[r]) incomplete.push(`${t.name} requires ${r}`);
      if (!t.description) incomplete.push(`${t.name}: no description`);
    }
    expect(incomplete).toEqual([]);
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['breakrocks_posts_list', 'breakrocks_post', 'breakrocks_theme_publish', 'breakrocks_batch', 'breakrocks_moderation_ban', 'breakrocks_layouts_apply']));
  });
  it('watches only for a bounded duration', async () => {
    const client = await connected(harness());
    const r = await client.callTool({ name: 'breakrocks_feed', arguments: { watch: true } });
    expect(r.isError).toBe(true);
    expect(textOf(r).error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('--duration') });
  });
  it('answers a call with the JSON of the command', async () => {
    const client = await connected(harness());
    const r = await client.callTool({ name: 'breakrocks_theme_prompt', arguments: { field: 'sport', mood: 'stadium at night', name: 'stade-nuit', universe: '%football' } });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toMatchObject({ field: 'SPORT', name: 'stade-nuit' });
    const bad = await client.callTool({ name: 'breakrocks_theme_prompt', arguments: { field: 'sport' } });
    expect(bad.isError).toBe(true);
    expect(textOf(bad).error.code).toBe('INVALID_INPUT');
  });
  it('refuses a tool that asks a confirmation unless "yes": true', async () => {
    const h = harness();
    const client = await connected(h);
    await client.callTool({ name: 'breakrocks_profile_add', arguments: { name: 'old', env: 'dev' } });
    const refused = await client.callTool({ name: 'breakrocks_profile_remove', arguments: { name: 'old' } });
    expect(refused.isError).toBe(true);
    expect(textOf(refused).error.code).toBe('CONFIRMATION_REQUIRED');
    const done = await client.callTool({ name: 'breakrocks_profile_remove', arguments: { name: 'old', yes: true } });
    expect(textOf(done)).toEqual({ removed: 'old', keysKept: [] });
    const extra = await client.callTool({ name: 'breakrocks_profile_list', arguments: { yes: true } });
    expect(extra.isError).toBe(true);
  });
  it('signs in a delegated agent from its variables and answers whoami, as a tool and as a resource', async () => {
    const { h, platform } = await onPlatform({ payer: fakePayer });
    writeFileSync(join(h.dir, 'w.key'), '44'.repeat(32));
    await h.run('--env', 'dev', 'operator', 'keygen', '--json');
    await h.run('--env', 'dev', 'wallet', 'set', '--key', join(h.dir, 'w.key'), '--json');
    await h.run('--env', 'dev', 'operator', 'register', '--country', 'FR', '--full-age', '--yes', '--json');
    const out = join(h.dir, 'a.pem');
    await h.run('agents', 'create', 'relay', '--out', out, '--json');
    const created = h.values[h.values.length - 1] as { agentId: string; operatorId: string };
    const { readFileSync } = await import('node:fs');
    const agent = harness({ fetch: platform.fetch, env: { BREAKROCKS_OPERATOR_ID: created.operatorId, BREAKROCKS_AGENT_ID: created.agentId, BREAKROCKS_AGENT_KEY: readFileSync(out, 'utf8') } });
    agent.clock.now = h.clock.now;
    const client = await connected(agent, { env: 'dev' });
    const login = await client.callTool({ name: 'breakrocks_agent_login', arguments: {} });
    expect(textOf(login)).toMatchObject({ agentId: created.agentId, keySource: 'env' });
    const who = await client.callTool({ name: 'breakrocks_whoami', arguments: {} });
    expect(textOf(who)).toMatchObject({ actor: 'delegated-agent', agentId: created.agentId, account: { id: created.operatorId } });
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(['breakrocks://whoami', 'breakrocks://capabilities', 'breakrocks://profiles']);
    const capabilities = await client.readResource({ uri: 'breakrocks://capabilities' });
    expect(JSON.parse((capabilities.contents[0] as { text: string }).text)).toMatchObject({ actor: 'delegated-agent', canManageAgents: false });
    const refused = await client.callTool({ name: 'breakrocks_agents_list', arguments: {} });
    expect(textOf(refused).error.code).toBe('DELEGATED_AGENT_CANNOT_MANAGE_AGENTS');
  });
  it('gives the theme prompt as an MCP prompt', async () => {
    const client = await connected(harness());
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['theme-prompt']);
    const p = await client.getPrompt({ name: 'theme-prompt', arguments: { field: 'culture', mood: 'white museum', name: 'musee', universe: '%paris', fonts: 'Playfair Display' } });
    expect((p.messages[0].content as { text: string }).text).toContain('"title": "Playfair Display"');
    await expect(client.getPrompt({ name: 'theme-prompt', arguments: { field: 'x', mood: 'm', name: 'n1', universe: '%p' } })).rejects.toThrow(/THEME_FIELD_INVALID/);
  });
});
