import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import type { Output } from '../src/output.js';

function capture() {
  const lines: string[] = []; const errors: string[] = []; const values: unknown[] = [];
  const out: Output = { line: (t) => lines.push(t), error: (t) => errors.push(t), json: (v) => values.push(v) };
  return { out, lines, errors, values };
}

describe('the command line', () => {
  it('shows the help without a command, with "help" and with --help', async () => {
    for (const argv of [[], ['help'], ['--help']]) {
      const c = capture();
      expect(await main(argv, c.out)).toBe(0);
      expect(c.lines.join('\n')).toContain('Usage: breakrocks <command>');
    }
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
    expect(j.values[0]).toEqual({ error: 'UNKNOWN_COMMAND', command: 'nope' });
  });
  it('lists the commands in JSON', async () => {
    const c = capture();
    expect(await main(['help', '--json'], c.out)).toBe(0);
    expect((c.values[0] as { commands: { name: string }[] }).commands.map((x) => x.name)).toEqual(['help', 'version']);
  });
});
