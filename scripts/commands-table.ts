// Prints the tables of the commands for the README (README § Commands), from the registry and the tree
// (src/tree.ts): one table per domain, one row per command, its summary and its first example.
// npx tsx scripts/commands-table.ts
import '../src/commands/index.js';
import { commands, groupOf } from '../src/registry.js';
import { DOMAINS } from '../src/tree.js';

const row = (c: ReturnType<typeof commands>[number]) => `| \`${c.name}\` | ${c.summary.replace(/\|/g, '\\|')}${c.interactive ? ' (confirmation: `--yes`)' : ''}${c.offline ? ' (offline)' : ''} | \`${c.examples[0].replace(/\|/g, '\\|')}\` |`;
const sections = DOMAINS.map((d) => {
  const list = commands().filter((c) => d.groups.includes(groupOf(c)));
  return [`#### ${d.title}`, '', `\`breakrocks help ${d.name}\``, '', '| Command | Does | Example |', '|---|---|---|', ...list.map(row), ''].join('\n');
});
process.stdout.write(sections.join('\n'));
