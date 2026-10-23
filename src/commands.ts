import type { Output } from './output.js';

export type CommandContext = { out: Output; json: boolean; args: string[] };
export type Command = { name: string; summary: string; run: (context: CommandContext) => Promise<number> | number };

/** The commands of the CLI, in the order of the help. The scope of the first real commands is decided in EN-ATTENTE (D-91). */
export const COMMANDS: Command[] = [
  { name: 'help', summary: 'Show this help', run: ({ out, json }) => { if (json) out.json({ commands: COMMANDS.map(({ name, summary }) => ({ name, summary })) }); else out.line(helpText()); return 0; } },
  { name: 'version', summary: 'Show the version of the CLI', run: async ({ out, json }) => { const { VERSION } = await import('./version.js'); if (json) out.json({ version: VERSION }); else out.line(VERSION); return 0; } },
];

export const commandNamed = (name: string) => COMMANDS.find((c) => c.name === name);

export function helpText(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  return [
    'Usage: breakrocks <command> [options]',
    '',
    'Commands:',
    ...COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`),
    '',
    'Options:',
    '  --json       Answer in JSON (for scripts and AI agents)',
    '  --version    Show the version of the CLI',
    '  --help       Show this help',
  ].join('\n');
}
