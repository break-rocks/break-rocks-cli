// The theme gallery of a universe (D-244, specs v81.11.0) and the appearance history of a universe (D-289, specs
// v96.0.0: it replaces the theme history, its frozen version, the stars and the gallery trials, withdrawn), its
// restoration. The writes offer --dry-run.
import { apiCommand } from '../api/command.js';
import { usageError } from '../errors.js';

type Item = { theme: { universe: string; name: string; version?: number }; reason?: string; starred?: boolean; variant?: string; palette?: string[]; universeCount?: number; accountCount?: number };
const ref = (t: Item['theme']) => `${t.universe}/${t.name}${t.version ? ` v${t.version}` : ''}`;
const catalogText = (r: unknown) => {
  const p = r as { items?: Item[]; next?: string | null } | null;
  if (!p?.items?.length) return '(none)';
  return [...p.items.map((x) => `${x.starred ? '*' : ' '} ${ref(x.theme)}  ${x.variant ?? ''}  ${x.reason ?? ''}${x.palette?.length ? `  ${x.palette.join(' ')}` : ''}`), ...(p.next ? [`next: ${p.next}`] : [])].join('\n');
};

export const themesGallery = apiCommand({
  name: 'themes gallery', summary: 'The theme gallery of a universe: its field collection, then the universal one, then the most used (themeCatalog GALLERY; --high-contrast, --night or --day)',
  description: 'Each theme comes with its reason (COLLECTION_<field>, UNIVERSAL, MOST_USED), its palette and whether you starred it. --high-contrast keeps the AAA themes (7:1 for body text).',
  kind: 'query', op: 'themeCatalog', positionals: ['universe'], require: ['universe'], fixed: { order: 'GALLERY' },
  hide: ['collection', 'creator', 'query', 'use', 'variant'],
  extra: { night: { type: 'boolean', description: 'The night variant' }, day: { type: 'boolean', description: 'The day variant' } },
  descriptions: { universe: 'The universe whose gallery it is (%name, %name/sub)', highContrast: 'Only the high-contrast themes (AAA)' },
  prepare: (i) => {
    if (i.night && i.day) throw usageError('INVALID_INPUT', '--night or --day, not both');
    const { night, day, ...rest } = i;
    return { ...rest, ...(night ? { variant: 'NIGHT' } : day ? { variant: 'DAY' } : {}) };
  },
  text: catalogText,
  examples: ['breakrocks themes gallery %paris', 'breakrocks themes gallery %paris --high-contrast --night --json'],
});

type AppearanceEntry = { id: string; setAt: string; live?: boolean; trial?: boolean; first?: boolean; theme: { universe: string; name: string; version?: number }; accent?: string; accentName?: string; character?: string; restorable?: boolean };
export const universesAppearanceHistory = apiCommand({
  name: 'universes appearance-history', summary: 'The appearance history of a universe: its last 5 appearances, the one in use first (universeAppearanceHistory)',
  description: 'Read by who applies an appearance at once (the owner and the admins of a private universe, the leadership of a public universe) and by a resident who can vote of a public universe (THEME_SET_NOT_ALLOWED otherwise). Since specs v96.0.0 (D-289) it replaces the theme history and the layout history.',
  kind: 'query', op: 'universeAppearanceHistory', positionals: ['universe'], descriptions: { universe: 'The universe (%name, %name/sub)' },
  text: (r) => (Array.isArray(r) && r.length ? (r as AppearanceEntry[]).map((e) => `${e.id}  ${e.setAt}  ${ref(e.theme)}  ${e.accent ?? ''} ${e.accentName ?? ''}  ${e.character ?? ''}${e.live ? '  (live)' : ''}${e.first ? '  (creation)' : ''}${e.restorable === false ? '  (not restorable)' : ''}`).join('\n') : '(none)'),
  examples: ['breakrocks universes appearance-history %paris', 'breakrocks universes appearance-history %paris --json'],
});
export const universesAppearanceRestore = apiCommand({
  name: 'universes appearance-restore', summary: 'Restore an appearance of the history: the next version of its theme set, or a proposal APPEARANCE filed (restoreUniverseAppearance)',
  description: 'Who applies an appearance at once restores it; a resident who can vote of a public universe, or the leadership with --propose, files a proposal of the kind APPEARANCE from that entry (--text: its reason). APPEARANCE_HISTORY_ENTRY_NOT_FOUND, APPEARANCE_NOT_RESTORABLE.',
  kind: 'mutation', op: 'restoreUniverseAppearance', positionals: ['universe', 'entryId'], dry: true, select: '{ theme { universe name version } proposal { id status } }',
  descriptions: { universe: 'The universe (%name, %name/sub)', entryId: 'The entry of the history (universes appearance-history)', propose: 'File a proposal APPEARANCE instead of restoring at once', text: 'The reason of the proposal' },
  text: (r) => { const x = r as { theme?: { universe: string; name: string; version?: number } | null; proposal?: { id?: string } | null } | null; return !x ? '(none)' : x.proposal ? `proposal ${x.proposal.id ?? '?'} filed` : x.theme ? `${ref(x.theme)} set` : '(none)'; },
  examples: ['breakrocks universes appearance-restore %paris <entry id>', 'breakrocks universes appearance-restore %paris <entry id> --propose --text "The former one was clearer"'],
});
