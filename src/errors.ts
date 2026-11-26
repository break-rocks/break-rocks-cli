import { voteRefusalSentence } from './vote-requirement.js';

/**
 * Exit codes (README § Output and exit codes): 0 done; 1 refused, by the platform (the code of
 * the contract) or by a guard of the CLI (a payment cap, a missing key; `source: "cli"`); 2 usage
 * (an unknown command or option, a value out of its schema, a confirmation missing); 3 network or
 * session (no answer, or a session to open again).
 */
export const EXIT = { OK: 0, REFUSED: 1, USAGE: 2, NETWORK: 3 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Who refused: the platform (a code of the contract) or the CLI itself. */
export type ErrorSource = 'platform' | 'cli';

/** A refusal or a failure, by its stable code: the message is for people, the code for programs. */
export class CliError extends Error {
  readonly code: string;
  readonly exit: ExitCode;
  readonly details: Record<string, unknown>;
  readonly source: ErrorSource;
  constructor(code: string, message: string, exit: ExitCode = EXIT.REFUSED, details: Record<string, unknown> = {}, source: ErrorSource = 'cli') {
    super(message);
    this.code = code; this.exit = exit; this.details = details; this.source = source;
  }
  /** `{ error: { code, message, source, … } }`, the JSON of every refusal. */
  toJSON() { return { error: { code: this.code, message: this.message, source: this.source, ...this.details } }; }
}

export const usageError = (code: string, message: string, details: Record<string, unknown> = {}) => new CliError(code, message, EXIT.USAGE, details);
export const cliRefusal = (code: string, message: string, details: Record<string, unknown> = {}) => new CliError(code, message, EXIT.REFUSED, details);
export const platformRefusal = (code: string, message: string, details: Record<string, unknown> = {}) => new CliError(code, message, EXIT.REFUSED, details, 'platform');
export const networkError = (code: string, message: string, details: Record<string, unknown> = {}, source: ErrorSource = 'cli') => new CliError(code, message, EXIT.NETWORK, details, source);

/** The sentence of a platform code the API answers without one (its message empty or the code itself). */
export const REFUSAL_SENTENCES: Record<string, string> = {
  PLATFORM_APPEAL_EXISTS: 'This measure is already appealed: one appeal per measure, whoever filed it',
  EXPERIENCES_NOT_OPEN: 'Experiences are not open on this platform yet (the switch experiences.open is off); what was done is kept',
  MY_PLACES_NOT_OPEN: 'My places is not open on this platform yet (the switch map.savePlace is off); what was saved is kept',
  DELEGATED_AGENT_NOT_ALLOWED: 'A delegated agent may not do this: ask the human the agent acts for',
  PLATFORM_APPEAL_LEADERSHIP_ONLY: 'A measure against a universe is appealed by its leadership only',
};
export const refusalSentence = (code: string, message?: string) => (!message || message === code ? REFUSAL_SENTENCES[code] ?? message ?? code : message);

const cellOf = (info: Record<string, unknown>) => (typeof info.cell === 'string' && info.cell ? ` (cell ${info.cell})` : '');

/**
 * The refusals of the cells, the limits and the closed provider, told for people (server docs/talc-deviations.md,
 * scalability audit 2026-11-26). A function answers undefined when its errorInfo lacks the fact it tells: the API's message then.
 */
const REFUSAL_TELLERS: Record<string, (info: Record<string, unknown>) => string | undefined> = {
  ACCOUNT_IN_OTHER_CELL: (i) => `This account is served from another region${cellOf(i)}: it cannot be followed or blocked from yours yet`,
  UNIVERSE_IN_OTHER_CELL: (i) => `This universe is served from another region${cellOf(i)}: joining it and taking part in its governance from yours is not possible yet`,
  CROSS_CELL_NOT_SUPPORTED: (i) => `Not available yet: a conversation, a connection or a group invitation between accounts of two regions${cellOf(i)}`,
  FOLLOWING_LIMIT: (i) => (typeof i.max === 'number' ? `You follow the most accounts allowed (${i.max}): unfollow an account to follow another` : undefined),
  AUDIENCE_QUOTA: () => 'You have posted as much as your audience allows for this hour: try again later',
  PROVIDER_NOT_AVAILABLE: () => 'Not available yet: payments are closed on this platform until its payment provider is set up',
  MESSAGE_ID_INVALID: () => 'The identifier of the message is too far from the platform clock (a message is dated within the last minute): check the date and time of this machine, then send it again',
  CURSOR_INVALID: () => 'This cursor is no longer valid (it belongs to another list, or the list changed): start again from the first page, without --after',
};

/** The sentence of a refusal told above, from its errorInfo; undefined for another code. */
export function refusalTold(code: string, errorInfo: unknown): string | undefined {
  const info = parsedInfo(errorInfo);
  return REFUSAL_TELLERS[code]?.(info && typeof info === 'object' ? info as Record<string, unknown> : {});
}

/** The sentence of a platform refusal: from its errorInfo when it tells more (the vote requirement, D-659; the cells and the limits), else as refusalSentence. */
export const refusalText = (code: string, message: string | undefined, errorInfo: unknown) => voteRefusalSentence(code, parsedInfo(errorInfo)) ?? refusalTold(code, errorInfo) ?? refusalSentence(code, message);

/** An errorInfo as an object: talc's AWSJSON may come as a JSON string. */
function parsedInfo(info: unknown): unknown {
  if (typeof info !== 'string') return info;
  try { return JSON.parse(info); } catch { return undefined; }
}

/** Any thrown value as a CliError (an unexpected one keeps its message, code INTERNAL_ERROR). */
export function asCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new CliError('INTERNAL_ERROR', message, EXIT.REFUSED);
}
