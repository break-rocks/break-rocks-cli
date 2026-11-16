// The theme gallery of a universe (D-244, specs v81.11.0) and the appearance history of a universe (D-289, specs
// v96.0.0: it replaces the theme history, its frozen version, the stars and the gallery trials, withdrawn), its
// restoration. The writes offer --dry-run.
import { apiCommand } from '../api/command.js';
import { usageError } from '../errors.js';
import { catalogText, commandLine, type CatalogPage } from '../theme/listing.js';

type Ref = { universe: string; name: string; version?: number };
const ref = (t: Ref) => `${t.universe}/${t.name}${t.version ? ` v${t.version}` : ''}`;

export const themesGallery = apiCommand({
  name: 'themes gallery', summary: 'The themes offered in a universe (the gallery), not what is applied: see look appearance show. Its field collection, then the universal one, then the most used (themeCatalog GALLERY; --high-contrast, --night or --day)',
  description: 'The themes offered in a universe (the gallery), not what is applied: see look appearance show. The text groups the themes by section (COLLECTION_<field>, UNIVERSAL, MOST_USED) under a header naming the columns (version, field, title typeface, image slots filled, screenshots, universes and accounts using it, the palette of the variant, as swatches in a truecolor terminal, * starred); a theme of an earlier section is not listed again ("also in MOST_USED" on its first row); the next page is told as a command line (--all). --json: the answer as served, the cursor whole. --high-contrast keeps the AAA themes (7:1 for body text).',
  kind: 'query', op: 'themeCatalog', positionals: ['universe'], require: ['universe'], fixed: { order: 'GALLERY' },
  hide: ['collection', 'creator', 'query', 'use', 'variant'],
  extra: { night: { type: 'boolean', description: 'The night variant' }, day: { type: 'boolean', description: 'The day variant' } },
  descriptions: { universe: 'The universe whose gallery it is (%name, %name/sub)', highContrast: 'Only the high-contrast themes (AAA)' },
  prepare: (i) => {
    if (i.night && i.day) throw usageError('INVALID_INPUT', '--night or --day, not both');
    const { night, day, ...rest } = i;
    return { ...rest, ...(night ? { variant: 'NIGHT' } : day ? { variant: 'DAY' } : {}) };
  },
  text: (r, input) => catalogText(r as CatalogPage, commandLine('themes gallery', input, ['universe']), input),
  examples: ['breakrocks look themes gallery %paris', 'breakrocks look themes gallery %paris --high-contrast --night --json'],
});

type AppearanceEntry = { id: string; setAt: string; live?: boolean; trial?: boolean; first?: boolean; theme: { universe: string; name: string; version?: number }; accent?: string; accentName?: string; character?: string; restorable?: boolean };
export const universesAppearanceHistory = apiCommand({
  name: 'universes appearance-history', summary: 'The appearance history of a universe: its last 5 appearances, the one in use first (universeAppearanceHistory)',
  description: 'Read by who applies an appearance at once (the owner and the admins of a private universe, the leadership of a public universe) and by a resident who can vote of a public universe (THEME_SET_NOT_ALLOWED otherwise). Since specs v96.0.0 (D-289) it replaces the theme history and the layout history.',
  kind: 'query', op: 'universeAppearanceHistory', positionals: ['universe'], descriptions: { universe: 'The universe (%name, %name/sub)' },
  text: (r) => (Array.isArray(r) && r.length ? (r as AppearanceEntry[]).map((e) => `${e.id}  ${e.setAt}  ${ref(e.theme)}  ${e.accent ?? ''} ${e.accentName ?? ''}  ${e.character ?? ''}${e.live ? '  (live)' : ''}${e.first ? '  (creation)' : ''}${e.restorable === false ? '  (not restorable)' : ''}`).join('\n') : '(none)'),
  examples: ['breakrocks look appearance history %paris', 'breakrocks look appearance history %paris --json'],
});
export const universesAppearanceRestore = apiCommand({
  name: 'universes appearance-restore', summary: 'Restore an appearance of the history: the next version of its theme set, or a proposal APPEARANCE filed (restoreUniverseAppearance)',
  description: 'Who applies an appearance at once restores it; a resident who can vote of a public universe, or the leadership with --propose, files a proposal of the kind APPEARANCE from that entry (--text: its reason). APPEARANCE_HISTORY_ENTRY_NOT_FOUND, APPEARANCE_NOT_RESTORABLE.',
  kind: 'mutation', op: 'restoreUniverseAppearance', positionals: ['universe', 'entryId'], dry: true, select: '{ theme { universe name version } proposal { id status } }',
  descriptions: { universe: 'The universe (%name, %name/sub)', entryId: 'The entry of the history (universes appearance-history)', propose: 'File a proposal APPEARANCE instead of restoring at once', text: 'The reason of the proposal' },
  text: (r) => { const x = r as { theme?: { universe: string; name: string; version?: number } | null; proposal?: { id?: string } | null } | null; return !x ? '(none)' : x.proposal ? `proposal ${x.proposal.id ?? '?'} filed` : x.theme ? `${ref(x.theme)} set` : '(none)'; },
  examples: ['breakrocks look appearance restore %paris <entry id>', 'breakrocks look appearance restore %paris <entry id> --propose --text "The former one was clearer"'],
});
