// Prints the table of the commands for the README (README § Commandes), from the registry: one row
// per command, its summary and its first example. npx tsx scripts/commands-table.ts
import '../src/commands/index.js';
import { ADVANCED_GROUPS } from '../src/help.js';
import { commands, groupOf } from '../src/registry.js';

const row = (c: ReturnType<typeof commands>[number]) => `| \`${c.name}\` | ${c.summary.replace(/\|/g, '\\|')}${c.interactive ? ' (confirmation: `--yes`)' : ''}${c.offline ? ' (offline)' : ''} | \`${c.examples[0].replace(/\|/g, '\\|')}\` |`;
const basic = commands().filter((c) => !ADVANCED_GROUPS.includes(groupOf(c)));
const advanced = commands().filter((c) => ADVANCED_GROUPS.includes(groupOf(c)));
process.stdout.write(['| Commande | Fait | Exemple |', '|---|---|---|', ...basic.map(row), '', 'Modération et gouvernance (hors de l\'aide de base, `breakrocks help moderation`, `breakrocks help governance`) :', '', '| Commande | Fait | Exemple |', '|---|---|---|', ...advanced.map(row), ''].join('\n'));
