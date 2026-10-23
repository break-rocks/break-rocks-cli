/**
 * Exit codes (README § Sorties et codes de sortie): 0 done; 1 refused, by the platform (the code of
 * the contract) or by a guard of the CLI (a payment cap, a missing key; `source: "cli"`); 2 usage
 * (an unknown command or option, a value out of its schema, a confirmation missing); 3 network or
 * session (no answer, or a session to open again).
 */
export const EXIT = { OK: 0, REFUSED: 1, USAGE: 2, NETWORK: 3 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Who refused: the platform (a code of contracts/errors.md or agent-sign-in.md) or the CLI itself. */
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

/** Any thrown value as a CliError (an unexpected one keeps its message, code INTERNAL_ERROR). */
export function asCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new CliError('INTERNAL_ERROR', message, EXIT.REFUSED);
}
