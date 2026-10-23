/**
 * Everything the CLI writes to the terminal goes through here: plain text by default, JSON with
 * --json. Never colors nor animations: the output reads the same in a terminal, a pipe or an
 * AI agent. Progress and questions go to stderr, so that stdout carries the answer only.
 */
export type Output = { line: (text: string) => void; error: (text: string) => void; json: (value: unknown) => void };

export const terminal: Output = {
  line: (text) => console.log(text),
  error: (text) => console.error(text),
  json: (value) => console.log(JSON.stringify(value, null, 2)),
};

/** An output that writes nothing to stdout (the MCP server: stdout is its protocol); errors still go to stderr. */
export const stderrOnly: Output = {
  line: (text) => console.error(text),
  error: (text) => console.error(text),
  json: (value) => console.error(JSON.stringify(value)),
};
