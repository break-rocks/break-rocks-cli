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
    expect(await h.run('theme')).toBe(0);
    expect(h.lines[0]).toContain('theme check');
    expect(await h.run('theme', 'pack', '--help')).toBe(0);
    expect(h.lines[1]).toContain('Usage: breakrocks theme pack <file>');
    expect(await h.run('help', 'theme', 'check')).toBe(0);
    expect(h.lines[2]).toContain('--strict');
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
    expect(await h.run('theme', 'prompt', '--field', 'sport', '--json')).toBe(2);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('INVALID_INPUT');
  });
  it('lists the commands in JSON', async () => {
    const c = capture();
    expect(await main(['help', '--json'], c.out)).toBe(0);
    const names = (c.values[0] as { commands: { name: string }[] }).commands.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['help', 'version', 'schema', 'profile add', 'profile remove', 'theme prompt', 'theme check', 'theme pack']));
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

describe('breakrocks schema', () => {
  it('gives the JSON Schemas of the input and the output of a command, and its MCP tool', async () => {
    const h = harness();
    expect(await h.run('schema', 'theme', 'pack', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ command: 'theme pack', mcpTool: 'breakrocks_theme_pack', input: { type: 'object', required: ['file'] }, output: { type: 'object' } });
    expect(await h.run('schema', 'profile', 'remove', '--json')).toBe(0);
    expect(last<{ input: { properties: Record<string, unknown> } }>(h).input.properties).toHaveProperty('yes');
    expect(await h.run('schema', 'all', '--json')).toBe(0);
    expect((last(h) as unknown as unknown[]).length).toBeGreaterThan(10);
    expect(await h.run('schema', 'nope', '--json')).toBe(2);
  });
});
