// The real-time updates: the former backend's (the WebSocket of its AppSync Event API, its Cognito id token) were retired with
// it on 2026-11-28; native-sulfur's Event APIs are not wired in the CLI yet, so --watch reads again (src/watch.ts). What stays:
// the shape of an event a command watches for, and the end of the process.
export type RealtimeEvent = { id: string; at?: string; type: string; [field: string]: unknown };
export type RealtimeMode = 'auto' | 'on' | 'off';

/** Ends the process once the CLI is done (its exit code). */
export function exitWhenDone(code: number): void {
  process.exitCode = code;
}
