// D-390: the tree of the commands, the help by domains, the search, the suggestions, and the former
// names that keep working (command line, batch, MCP) with a deprecation notice on stderr.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEMA as GENERATED } from '../src/api/schema.generated.js';
import { toolName } from '../src/commands/core.js';
import { commandOfTool } from '../src/mcp/server.js';
import { aliases, commands, findCommand, groupOf } from '../src/registry.js';
import { DOMAINS, GROUP_SUMMARIES, PLACEMENTS } from '../src/tree.js';
import { harness, last } from './helpers.js';

const moved = [...PLACEMENTS].filter(([name, p]) => p.path !== name);

describe('the top-level help', () => {
  it('is under 40 lines, by domains', async () => {
    const h = harness();
    expect(await h.run('help')).toBe(0);
    const text = h.lines[0];
    expect(text.split('\n').length).toBeLessThan(40);
    for (const d of DOMAINS) expect(text).toContain(`${d.title}`);
    expect(text).toContain('breakrocks help <domain>');
    expect(text).toContain('breakrocks help <word>');
    expect(text).toContain('breakrocks help options');
    expect(await h.run()).toBe(0);
    expect(h.lines[1]).toBe(text);
  });
  it('puts every group in a domain', () => {
    const placed = DOMAINS.flatMap((d) => d.groups);
    expect([...new Set(commands().map(groupOf))].filter((g) => !placed.includes(g))).toEqual([]);
  });
  it('lists every command with --all', async () => {
    const h = harness();
    expect(await h.run('help', '--all')).toBe(0);
    for (const c of commands()) expect(h.lines[0]).toContain(`  ${c.name} `);
  });
});

describe('the list descriptions', () => {
  const operations = new Set([...Object.keys(GENERATED.query ?? {}), ...Object.keys(GENERATED.mutation ?? {})]);
  it('are one line of 60 characters at most', () => {
    const long = commands().filter((c) => c.summary.length > 60 || c.summary.includes('\n')).map((c) => `${c.name}: ${c.summary}`);
    expect(long).toEqual([]);
    expect(Object.entries(GROUP_SUMMARIES).filter(([, s]) => s.length > 60)).toEqual([]);
  });
  it('name no API operation, no legal reference', () => {
    const bad = commands().filter((c) => c.summary.split(/[^A-Za-z]+/).some((w) => operations.has(w) && /[a-z][A-Z]/.test(w)) || /DSA|art\.|\(\w+\)/.test(c.summary)).map((c) => `${c.name}: ${c.summary}`);
    expect(bad).toEqual([]);
  });
  it('keep the operation and the details in the help of the command', async () => {
    const h = harness();
    expect(await h.run('posts', 'pin', '--help')).toBe(0);
    expect(h.lines[0]).toMatch(/^Pin a post in a universe\n/);
    expect(h.lines[0]).toContain('API: setPinnedPost');
    expect(await h.run('ads', 'why', '--help')).toBe(0);
    expect(h.lines[1]).toContain('DSA art. 26');
  });
  it('come from the tree for every command, and the tree names only commands', () => {
    const declared = new Set(commands().flatMap((c) => [c.name, ...(c.aliases ?? [])]));
    expect([...PLACEMENTS.keys()].filter((n) => !declared.has(n))).toEqual([]);
  });
});

describe('the help of a domain, a group, a word', () => {
  it('shows the groups of a domain', async () => {
    const h = harness();
    expect(await h.run('help', 'talk')).toBe(0);
    expect(h.lines[0]).toContain('messages direct …');
    expect(h.lines[0]).toContain('discussions channels …');
  });
  it('folds the subgroups of a group, and shows a subgroup', async () => {
    const h = harness();
    expect(await h.run('universes')).toBe(0);
    expect(h.lines[0]).toContain('universes private …');
    expect(h.lines[0]).not.toContain('universes private create');
    expect(await h.run('help', 'universes', 'private')).toBe(0);
    expect(h.lines[1]).toContain('universes private create');
    expect(await h.run('universes', 'private', 'tiers', 'renewal')).toBe(0);
    expect(h.lines[2]).toContain('universes private tiers renewal on');
  });
  it('searches the names and the descriptions', async () => {
    const h = harness();
    expect(await h.run('help', 'invite', '--json')).toBe(0);
    const names = last<{ commands: { name: string }[] }>(h).commands.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['universes private invite', 'messages groups invite']));
    expect(await h.run('help', 'zzzz-nothing', '--json')).toBe(2);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('UNKNOWN_COMMAND');
  });
  it('suggests the closest commands to an unknown one', async () => {
    const h = harness();
    expect(await h.run('univrses', '--json')).toBe(2);
    expect(last<{ error: { code: string; suggestions: string[] } }>(h).error).toMatchObject({ code: 'UNKNOWN_COMMAND', suggestions: ['universes'] });
    expect(await h.run('posts', 'lik')).toBe(2);
    expect(h.errors.at(-1)).toContain('Did you mean "posts like"');
  });
  it('shows the global options', async () => {
    const h = harness();
    expect(await h.run('help', 'options')).toBe(0);
    expect(h.lines[0]).toContain('--json');
    expect(h.lines[0]).toContain('Exit codes');
  });
});

describe('the former names', () => {
  it('every former path still resolves to its command', () => {
    expect(moved.length).toBeGreaterThan(150);
    for (const [name, p] of moved) {
      const found = findCommand(name.split(' '));
      expect(found, name).toBeDefined();
      expect(found!.command.name, name).toBe(p.path);
      expect(found!.alias, name).toBe(name);
      expect(aliases().get(name)?.name).toBe(p.path);
    }
  });
  it('a former name is never the path of another command', () => {
    const paths = new Set(commands().map((c) => c.name));
    expect(moved.filter(([name]) => paths.has(name)).map(([n]) => n)).toEqual([]);
  });
  it('runs, with one line on stderr naming the new path, stdout clean', async () => {
    const h = harness();
    expect(await h.run('profile', 'add', 'atlas', '--env', 'dev', '--json')).toBe(0);
    expect(h.errors).toEqual(['Warning: "breakrocks profile add" is deprecated, use "breakrocks config add".']);
    expect(last(h)).toMatchObject({ name: 'atlas', env: 'dev' });
    expect(h.lines).toEqual([]);
    expect(await h.run('theme', 'prompt', '--help')).toBe(0);
    expect(h.lines[0]).toContain('Usage: breakrocks look themes prompt');
    expect(h.lines[0]).toContain('Former name (deprecated');
  });
  it('a former group shows where its commands went', async () => {
    const h = harness();
    expect(await h.run('theme')).toBe(0);
    expect(h.lines[0]).toContain('theme prompt');
    expect(h.lines[0]).toContain('→ look themes prompt');
  });
  it('batch accepts them', async () => {
    const h = harness();
    writeFileSync(join(h.dir, 'a.jsonl'), [JSON.stringify({ command: 'profile add', input: { name: 'scribe', env: 'staging' } }), JSON.stringify({ argv: ['profile', 'show', 'scribe'] })].join('\n'));
    expect(await h.run('batch', '--file', 'a.jsonl', '--json')).toBe(0);
    expect(last<{ done: number; results: { command: string }[] }>(h)).toMatchObject({ done: 2, results: [{ command: 'config add' }, { command: 'config show' }] });
    expect(h.errors.join('\n')).toContain('use "breakrocks config add"');
  });
  it('the MCP server accepts their former tool names, and lists the new ones only', () => {
    for (const [name, p] of moved) {
      const command = commands().find((c) => c.name === p.path)!;
      if (command.mcp === false) continue;
      expect(commandOfTool(toolName(name))?.name, name).toBe(p.path);
      expect(commandOfTool(toolName(p.path))?.name).toBe(p.path);
    }
  });
  it('the schema answers by the former name too', async () => {
    const h = harness();
    expect(await h.run('schema', 'dm', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ command: 'messages direct send', formerNames: ['dm'], mcpTool: 'breakrocks_messages_direct_send' });
  });
});
