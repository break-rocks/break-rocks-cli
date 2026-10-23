import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { capture, harness, last } from './helpers.js';

describe('the command line', () => {
  it('shows the help without a command, with "help" and with --help', async () => {
    for (const argv of [[], ['help'], ['--help']]) {
      const c = capture();
      expect(await main(argv, c.out)).toBe(0);
      expect(c.lines.join('\n')).toContain('Usage: breakrocks <command>');
    }
  });
  it('shows the help of a group and of a command', async () => {
    const h = harness();
    expect(await h.run('agents')).toBe(0);
    expect(h.lines[0]).toContain('agents create');
    expect(await h.run('agents', 'create', '--help')).toBe(0);
    expect(h.lines[1]).toContain('Usage: breakrocks agents create <name>');
    expect(await h.run('help', 'operator', 'register')).toBe(0);
    expect(h.lines[2]).toContain('--full-age');
  });
  it('shows the version of package.json', async () => {
    const c = capture();
    expect(await main(['--version'], c.out)).toBe(0);
    expect(c.lines[0]).toMatch(/^\d+\.\d+\.\d+$/);
    const j = capture();
    expect(await main(['version', '--json'], j.out)).toBe(0);
    expect(j.values[0]).toEqual({ version: c.lines[0] });
  });
  it('refuses an unknown command with the exit code 2, in text and in JSON', async () => {
    const c = capture();
    expect(await main(['nope'], c.out)).toBe(2);
    expect(c.errors[0]).toContain('Unknown command "nope"');
    const j = capture();
    expect(await main(['nope', '--json'], j.out)).toBe(2);
    expect((j.values[0] as { error: { code: string } }).error.code).toBe('UNKNOWN_COMMAND');
  });
  it('refuses an unknown option and a value out of its schema (exit 2)', async () => {
    const h = harness();
    expect(await h.run('profile', 'add', 'x', '--nope', '--json')).toBe(2);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('UNKNOWN_OPTION');
    expect(await h.run('profile', 'add', 'x', '--env', 'moon', '--json')).toBe(2);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('INVALID_INPUT');
    expect(await h.run('operator', 'register', '--country', 'FRA', '--json')).toBe(2);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('INVALID_INPUT');
  });
  it('lists the commands in JSON', async () => {
    const c = capture();
    expect(await main(['help', '--json'], c.out)).toBe(0);
    const names = (c.values[0] as { commands: { name: string }[] }).commands.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['help', 'version', 'schema', 'profile add', 'operator register', 'agents create', 'agent login', 'wallet set', 'whoami', 'capabilities', 'theme check', 'mcp']));
  });
  it('keeps the fields asked (--fields) and writes only the identifier (--quiet)', async () => {
    const h = harness();
    expect(await h.run('profile', 'add', 'atlas', '--env', 'dev', '--json', '--fields', 'name,env')).toBe(0);
    expect(last(h)).toEqual({ name: 'atlas', env: 'dev' });
    expect(await h.run('profile', 'show', 'atlas', '--quiet')).toBe(0);
    expect(h.lines[h.lines.length - 1]).toBe('atlas');
    expect(await h.run('profile', 'list', '--json', '--fields', 'name')).toBe(0);
    expect(last(h)).toEqual([{ name: 'atlas' }]);
  });
  it('writes no color nor control character, whatever the output', async () => {
    const h = harness();
    await h.run('help');
    await h.run('nope');
    expect(h.all()).not.toMatch(/\x1b\[/);
  });
});

describe('the README', () => {
  it('lists every command', async () => {
    const { readFileSync } = await import('node:fs');
    const { commands } = await import('../src/registry.js');
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(commands().map((c) => c.name).filter((n) => !readme.includes(`| \`${n}\` |`))).toEqual([]);
  });
});

describe('breakrocks schema', () => {
  it('gives the JSON Schemas of the input and the output of a command, and its MCP tool', async () => {
    const h = harness();
    expect(await h.run('schema', 'agents', 'create', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ command: 'agents create', mcpTool: 'breakrocks_agents_create', input: { type: 'object', required: ['name'] }, output: { type: 'object' } });
    expect(await h.run('schema', 'agents', 'delete', '--json')).toBe(0);
    expect(last<{ input: { properties: Record<string, unknown> } }>(h).input.properties).toHaveProperty('yes');
    expect(await h.run('schema', 'all', '--json')).toBe(0);
    expect((last(h) as unknown as unknown[]).length).toBeGreaterThan(30);
    expect(await h.run('schema', 'nope', '--json')).toBe(2);
  });
});
