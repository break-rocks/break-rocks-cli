// The colours of the human-readable outputs (README § Colour): ANSI sequences written by hand, no
// dependency (CLAUDE.md § Dependencies). On only when the stream is a terminal, never with --json,
// off with --no-color, NO_COLOR or TERM=dumb, on with FORCE_COLOR (not "0"). The text is the same
// with or without them: a colour only wraps it, so the plain output (a pipe, a test) never changes.

type Stream = 'out' | 'err';
const state: Record<Stream, boolean> & { truecolor: boolean } = { out: false, err: false, truecolor: false };

/** What decides: the environment, whether the stream is a terminal, --json and --no-color. */
export type ColourInputs = { env: NodeJS.ProcessEnv; tty: boolean; json: boolean; noColor: boolean };

/** Whether a stream is coloured (the order of the conventions of no-color.org and FORCE_COLOR). */
export function colourEnabled({ env, tty, json, noColor }: ColourInputs): boolean {
  if (json || noColor) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  const force = env.FORCE_COLOR;
  if (force !== undefined) return force !== '0' && force !== 'false';
  if (env.TERM === 'dumb') return false;
  return tty;
}

/** Whether the terminal draws 24-bit colours: COLORTERM truecolor or 24bit, or FORCE_COLOR=3. */
export const truecolorEnabled = (env: NodeJS.ProcessEnv): boolean => /^(truecolor|24bit)$/i.test(env.COLORTERM ?? '') || env.FORCE_COLOR === '3';

/** Turns the colours of stdout and stderr on or off for this run (cli.ts; off in the MCP server); truecolor: the swatches. */
export function setColour(on: { out: boolean; err: boolean; truecolor?: boolean }): void { state.out = on.out; state.err = on.err; state.truecolor = !!on.truecolor; }

/**
 * A color (#RRGGBB) of a palette as a swatch: its hex on a background of that color, the text black or
 * white by its luminance, when stdout is coloured and the terminal draws 24-bit colours; else the hex
 * alone. The plain text is the same either way.
 */
export function swatch(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!state.out || !state.truecolor || !m) return hex;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
  const fg = 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? '30' : '97';
  return `\x1b[48;2;${r};${g};${b};${fg}m${hex}\x1b[39;49m`;
}

const style = (stream: Stream, open: string, close: string) => (text: string) => (state[stream] && text ? `\x1b[${open}m${text}\x1b[${close}m` : text);

/** The one palette, for a stream. */
function palette(s: Stream) {
  return {
    /** A command name, the command of a usage line. */
    command: style(s, '1', '22'),
    bold: style(s, '1', '22'),
    /** A domain of the top-level help. */
    domain: style(s, '35', '39'),
    /** An address of a universe or an account (%paris, @R2D2). */
    address: style(s, '36', '39'),
    /** Secondary data: ids, timestamps, the profile, environment and cell line. */
    dim: style(s, '2', '22'),
    error: style(s, '31', '39'),
    /** The code of a refusal: red and bold. */
    code: style(s, '1;31', '22;39'),
    warn: style(s, '33', '39'),
    /** A confirmation: done, signed in. */
    ok: style(s, '32', '39'),
  };
}

/** The palette of stdout (the answers, the help). */
export const paint = palette('out');
/** The palette of stderr (refusals, warnings). */
export const paintErr = palette('err');

// A span already styled: its opening sequences, its text, its closing ones (never nested).
const STYLED = /((?:\x1b\[[0-9;]*m)+[^\x1b]*(?:\x1b\[[0-9;]*m)+)/;
const TOKENS = /(^|[\s([{,;"'])([%@][\p{L}\p{N}_][\p{L}\p{N}_.-]*[\p{L}\p{N}_]|[%@][\p{L}\p{N}_])|(\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b)/giu;

/**
 * The text of an answer with the palette of stdout applied where its shape is plain: the addresses
 * (%paris, @R2D2, not inside an address of the web or an email) in the second accent, the timestamps
 * and the UUIDs dim. What a command already styled is left as it is.
 */
export function highlight(text: string): string {
  if (!state.out) return text;
  return text.split(STYLED).map((part, i) => (i % 2 ? part : part.replace(TOKENS, (_m, before: string | undefined, address: string | undefined, dimmed: string | undefined) => (address ? `${before}${paint.address(address)}` : paint.dim(dimmed!))))).join('');
}

/** The text without its colours (tests, widths). */
export const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');
