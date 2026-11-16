// The colours of the human-readable outputs (README § Colour): only in a terminal, never in JSON,
// off with NO_COLOR, --no-color or TERM=dumb, on with FORCE_COLOR; the text the same without them.
import { afterEach, describe, expect, it } from 'vitest';
import { colourEnabled, highlight, plain, setColour } from '../src/colour.js';
import { harness, last } from './helpers.js';

const ESC = '\x1b[';
const RED = '\x1b[31m';
const tty = (env: Record<string, string> = {}) => {
  const h = harness({ env });
  h.io.tty = { out: true, err: true };
  return h;
};

afterEach(() => setColour({ out: false, err: false }));

describe('when the colours are on', () => {
  const env = {} as NodeJS.ProcessEnv;
  it('follows the terminal, --json, --no-color, NO_COLOR, FORCE_COLOR and TERM=dumb', () => {
    expect(colourEnabled({ env, tty: true, json: false, noColor: false })).toBe(true);
    expect(colourEnabled({ env, tty: false, json: false, noColor: false })).toBe(false);
    expect(colourEnabled({ env, tty: true, json: true, noColor: false })).toBe(false);
    expect(colourEnabled({ env, tty: true, json: false, noColor: true })).toBe(false);
    expect(colourEnabled({ env: { NO_COLOR: '1' }, tty: true, json: false, noColor: false })).toBe(false);
    expect(colourEnabled({ env: { NO_COLOR: '' }, tty: true, json: false, noColor: false })).toBe(true);
    expect(colourEnabled({ env: { TERM: 'dumb' }, tty: true, json: false, noColor: false })).toBe(false);
    expect(colourEnabled({ env: { FORCE_COLOR: '1' }, tty: false, json: false, noColor: false })).toBe(true);
    expect(colourEnabled({ env: { FORCE_COLOR: '0' }, tty: true, json: false, noColor: false })).toBe(false);
    expect(colourEnabled({ env: { FORCE_COLOR: '1', NO_COLOR: '1' }, tty: true, json: false, noColor: false })).toBe(false);
    expect(colourEnabled({ env: { FORCE_COLOR: '1' }, tty: true, json: true, noColor: false })).toBe(false);
  });
  it('never in a pipe (not a terminal), with NO_COLOR, --no-color or --json', async () => {
    const pipe = harness();
    expect(await pipe.run('help')).toBe(0);
    expect(await pipe.run('nope')).toBe(2);
    const terminal = tty({ NO_COLOR: '1' });
    expect(await terminal.run('help')).toBe(0);
    expect(await terminal.run('nope')).toBe(2);
    const flag = tty();
    expect(await flag.run('help', '--no-color')).toBe(0);
    expect(await flag.run('nope', '--no-color')).toBe(2);
    const json = tty({ FORCE_COLOR: '1' });
    expect(await json.run('help', '--json')).toBe(0);
    expect(await json.run('nope', '--json')).toBe(2);
    expect(last<{ error: { code: string } }>(json).error.code).toBe('UNKNOWN_COMMAND');
    for (const h of [pipe, terminal, flag, json]) expect(h.all()).not.toContain(ESC);
    expect(flag.lines[0]).toBe(pipe.lines[0]);
    expect(flag.errors[0]).toBe(pipe.errors[0]);
  });
  it('in a terminal and with FORCE_COLOR, the same text once the colours are taken out', async () => {
    const pipe = harness();
    const forced = harness({ env: { FORCE_COLOR: '1' } });
    const terminal = tty();
    for (const h of [pipe, forced, terminal]) {
      expect(await h.run('help')).toBe(0);
      expect(await h.run('posts', 'pin', '--help')).toBe(0);
      expect(await h.run('Account')).toBe(0);
    }
    for (const h of [forced, terminal]) {
      expect(h.lines[0]).toContain(`${ESC}35maccount${ESC}39m`);
      expect(h.lines[1]).toContain(`Usage: ${ESC}1mbreakrocks posts pin${ESC}22m <post-id>`);
      expect(h.lines.map(plain)).toEqual(pipe.lines);
    }
  });
});

describe('the palette', () => {
  it('writes a refusal in red, its code bold', async () => {
    const h = tty();
    expect(await h.run('nope')).toBe(2);
    expect(h.errors[0]).toContain(`${RED}Error${ESC}39m ${ESC}1;31mUNKNOWN_COMMAND${ESC}22;39m`);
    expect(plain(h.errors[0])).toMatch(/^Error UNKNOWN_COMMAND: Unknown command "nope"\./);
  });
  it('writes a deprecation warning in yellow on stderr', async () => {
    const h = tty();
    expect(await h.run('profile', 'add', 'atlas', '--env', 'dev')).toBe(0);
    expect(h.errors[0]).toMatch(/^\x1b\[33mWarning: "breakrocks profile add" is deprecated/);
  });
  it('puts the addresses in the second accent, the timestamps and UUIDs dim, never inside a link or an email', () => {
    setColour({ out: true, err: false });
    expect(highlight('@R2D2 in %paris, 2026-11-16T10:00:00.000Z')).toBe(`${ESC}36m@R2D2${ESC}39m in ${ESC}36m%paris${ESC}39m, ${ESC}2m2026-11-16T10:00:00.000Z${ESC}22m`);
    expect(highlight('0192f1e2-7a3b-7c4d-8e5f-0a1b2c3d4e5f')).toBe(`${ESC}2m0192f1e2-7a3b-7c4d-8e5f-0a1b2c3d4e5f${ESC}22m`);
    for (const text of ['https://break.rocks/@alice', 'https://break.rocks/%25paris', 'dev+cli@break.rocks']) expect(highlight(text)).toBe(text);
    expect(highlight(`${ESC}1m@kept${ESC}22m @also`)).toBe(`${ESC}1m@kept${ESC}22m ${ESC}36m@also${ESC}39m`);
    setColour({ out: false, err: false });
    expect(highlight('@R2D2 in %paris')).toBe('@R2D2 in %paris');
  });
});
