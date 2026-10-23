import { describe, expect, it } from 'vitest';
import { toolName } from '../src/commands/core.js';
import { CliError } from '../src/errors.js';
import { commands, findCommand, toolInputSchema } from '../src/registry.js';
import { object, parseCommandLine, validate, list, str, int, bool } from '../src/schema.js';
import './helpers.js';

const schema = object({ name: str('n'), months: int('m', { minimum: 1, maximum: 12 }), fullAge: bool('f'), interactions: list('i', { type: 'string', enum: ['post', 'reply'] }), files: list('files') }, ['name']);

describe('the options of a command line', () => {
  it('read flags in kebab case, values inline or next, booleans, arrays by commas or repeated, positionals', () => {
    expect(parseCommandLine(schema, { positionals: ['name', 'files'] }, ['herald', '--months', '3', '--full-age', '--interactions=post,reply', 'a.png', 'b.png']))
      .toEqual({ name: 'herald', months: 3, fullAge: true, interactions: ['post', 'reply'], files: ['a.png', 'b.png'] });
    expect(parseCommandLine(schema, { positionals: ['name'] }, ['x', '--interactions', 'post', '--interactions', 'reply', '--no-full-age'])).toEqual({ name: 'x', interactions: ['post', 'reply'], fullAge: false });
    expect(parseCommandLine(schema, { aliases: { env: 'fullAge' } }, ['--env'])).toEqual({ fullAge: true });
  });
  it('refuse an unknown option, a missing value, a number that is none, an extra argument', () => {
    const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as CliError).code; } return 'none'; };
    expect(code(() => parseCommandLine(schema, {}, ['--nope']))).toBe('UNKNOWN_OPTION');
    expect(code(() => parseCommandLine(schema, {}, ['--name']))).toBe('MISSING_VALUE');
    expect(code(() => parseCommandLine(schema, {}, ['--months', 'two']))).toBe('INVALID_INPUT');
    expect(code(() => parseCommandLine(schema, { positionals: ['name'] }, ['a', 'b']))).toBe('UNEXPECTED_ARGUMENT');
  });
  it('are validated against the schema', () => {
    expect(validate(schema, { name: 'x', months: 13 })).toEqual(['input.months: must be at most 12']);
    expect(validate(schema, { months: 1 })).toEqual(['input.name: is required']);
    expect(validate(schema, { name: 'x', interactions: ['like'] })[0]).toContain('must be one of');
    expect(validate(schema, { name: 'x', other: 1 })).toEqual(['input.other: is not an option']);
    expect(validate(schema, { name: 'x', months: 2, fullAge: true })).toEqual([]);
  });
});

describe('the registry', () => {
  it('gives each command a summary, an example, an object input schema and an output schema', () => {
    for (const c of commands()) {
      expect(c.summary, c.name).toBeTruthy();
      expect(c.examples.length, c.name).toBeGreaterThan(0);
      expect(c.input.type, c.name).toBe('object');
      expect(c.input.additionalProperties, c.name).toBe(false);
      expect(c.output, c.name).toBeTruthy();
      for (const p of c.args?.positionals ?? []) expect(c.input.properties[p], `${c.name} ${p}`).toBeTruthy();
      for (const r of c.input.required ?? []) expect(c.input.properties[r], `${c.name} ${r}`).toBeTruthy();
      for (const e of c.examples) expect(e.includes(`breakrocks`), c.name).toBe(true);
    }
  });
  it('names one MCP tool per command, unique and valid, with "yes" for those that ask a confirmation', () => {
    const names = commands().filter((c) => c.mcp !== false).map((c) => toolName(c.name));
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(toolName('operator recovery-key set')).toBe('breakrocks_operator_recovery_key_set');
    const del = findCommand(['profile', 'remove'])!.command;
    expect(toolInputSchema(del).properties.yes).toBeTruthy();
    expect(toolInputSchema(findCommand(['profile', 'list'])!.command).properties.yes).toBeUndefined();
  });
  it('finds a command by its first words, the longest name first', () => {
    expect(findCommand(['theme', 'check', 'x.json', 'a.png'])).toMatchObject({ command: { name: 'theme check' }, rest: ['x.json', 'a.png'] });
    expect(findCommand(['profile', 'add', 'atlas'])).toMatchObject({ command: { name: 'profile add' }, rest: ['atlas'] });
    expect(findCommand(['theme'])).toBeUndefined();
  });
});
