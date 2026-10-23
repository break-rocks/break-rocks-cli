/** Everything the CLI writes to the terminal goes through here: plain text by default, JSON with --json. */
export type Output = { line: (text: string) => void; error: (text: string) => void; json: (value: unknown) => void };

export const terminal: Output = {
  line: (text) => console.log(text),
  error: (text) => console.error(text),
  json: (value) => console.log(JSON.stringify(value, null, 2)),
};
