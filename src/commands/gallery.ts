// The theme gallery and the universe theme history (D-244, specs v81.11.0 and v83.0.0): the gallery of a
// universe, the stars, the gallery trials (for oneself, 24 hours, on one universe), the history of the
// theme of a universe, its restoration and the end of its frozen version. The writes offer --dry-run.
import { apiCommand } from '../api/command.js';
import { usageError } from '../errors.js';

type Item = { theme: { universe: string; name: string; version?: number }; reason?: string; starred?: boolean; variant?: string; palette?: string[]; universeCount?: number; accountCount?: number };
const ref = (t: Item['theme']) => `${t.universe}/${t.name}${t.version ? ` v${t.version}` : ''}`;
const catalogText = (r: unknown) => {
  const p = r as { items?: Item[]; next?: string | null } | null;
  if (!p?.items?.length) return '(none)';
  return [...p.items.map((x) => `${x.starred ? '*' : ' '} ${ref(x.theme)}  ${x.variant ?? ''}  ${x.reason ?? ''}${x.palette?.length ? `  ${x.palette.join(' ')}` : ''}`), ...(p.next ? [`next: ${p.next}`] : [])].join('\n');
};

const theme = 'The theme: %universe/name';
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

export const themesStar = apiCommand({
  name: 'themes star', summary: 'Star a theme of the catalog (starTheme; 50 at most; starring it again changes nothing)',
  kind: 'mutation', op: 'starTheme', positionals: ['theme'], descriptions: { theme }, dry: true, depth: 1,
  text: (r) => { const t = r as { universe?: string; name?: string; version?: number } | null; return t ? `starred ${t.universe}/${t.name}` : '(none)'; },
  examples: ['breakrocks themes star %root/socle', 'breakrocks themes star %root/socle --dry-run'],
});
export const themesUnstar = apiCommand({
  name: 'themes unstar', summary: 'Unstar a theme (unstarTheme; also when it was not starred)',
  kind: 'mutation', op: 'unstarTheme', positionals: ['theme'], descriptions: { theme }, dry: true,
  examples: ['breakrocks themes unstar %root/socle'],
});
export const themesStarred = apiCommand({
  name: 'themes starred', summary: 'The themes you starred, the most recent first, 50 at most (starredThemes; --variant NIGHT|DAY)',
  kind: 'query', op: 'starredThemes', text: catalogText,
  examples: ['breakrocks themes starred', 'breakrocks themes starred --variant NIGHT --json'],
});

type Trial = { universe: string; theme?: { universe: string; name: string; version?: number } | null; layout?: { universe: string; name: string } | null; startedAt?: string; endsAt?: string };
const trialLine = (t: Trial) => `${t.universe}: ${[t.theme ? `theme ${t.theme.universe}/${t.theme.name}${t.theme.version ? ` v${t.theme.version}` : ''}` : '', t.layout ? `layout ${t.layout.universe}/${t.layout.name}` : ''].filter(Boolean).join(', ')} until ${t.endsAt ?? '?'}`;
export const themesTry = apiCommand({
  name: 'themes try', summary: 'Try a theme, a layout or both on a universe, for yourself alone, for 24 hours (startGalleryTrial; it replaces your trial there)',
  description: 'At least --theme or --layout (GALLERY_TRIAL_EMPTY otherwise); 20 universes at once. It is not the personal theme (theme try) nor the trial of a theme draft for every reader (studio try). End it with themes untry.',
  kind: 'mutation', op: 'startGalleryTrial', positionals: ['universe'], dry: true, depth: 1,
  descriptions: { universe: 'The universe where it is tried (%name, %name/sub)', theme, layout: 'The layout: %universe/name' },
  prepare: (i) => { if (i.theme === undefined && i.layout === undefined) throw usageError('GALLERY_TRIAL_EMPTY', 'Name a theme (--theme) or a layout (--layout) to try'); return i; },
  text: (r) => (r ? trialLine(r as Trial) : '(none)'),
  examples: ['breakrocks themes try %paris --theme %root/socle', 'breakrocks themes try %paris --theme %root/socle --layout %root/agora'],
});
export const themesUntry = apiCommand({
  name: 'themes untry', summary: 'End your gallery trial on a universe, theme and layout together (endGalleryTrial)',
  kind: 'mutation', op: 'endGalleryTrial', positionals: ['universe'], dry: true, descriptions: { universe: 'The universe (%name, %name/sub)' },
  select: '{ name myGalleryTrial { universe startedAt endsAt } }',
  text: (r) => { const u = r as { name?: string; myGalleryTrial?: Trial | null } | null; return u ? `${u.name}: ${u.myGalleryTrial ? 'a trial still runs' : 'no trial'}` : '(none)'; },
  examples: ['breakrocks themes untry %paris'],
});
export const themesTrials = apiCommand({
  name: 'themes trials', summary: 'Your gallery trials that run, one per universe, 20 at most (myGalleryTrials)', kind: 'query', op: 'myGalleryTrials', depth: 1,
  text: (r) => (Array.isArray(r) && r.length ? (r as Trial[]).map(trialLine).join('\n') : '(none)'),
  examples: ['breakrocks themes trials', 'breakrocks themes trials --json'],
});

export const universesThemeHistory = apiCommand({
  name: 'universes theme-history', summary: 'The history of the theme of a universe, the most recent first, one year (universeThemeHistory; who may set its theme)',
  kind: 'query', op: 'universeThemeHistory', positionals: ['universe'], descriptions: { universe: 'The universe (%name, %name/sub)' },
  text: (r) => {
    const p = r as { items?: { id: string; theme: { universe: string; name: string; version?: number }; setAt: string; endedAt?: string | null; restorable: boolean }[]; next?: string | null } | null;
    return p?.items?.length ? [...p.items.map((e) => `${e.id}  ${ref(e.theme)}  ${e.setAt} - ${e.endedAt ?? 'now'}${e.restorable ? '' : '  (not restorable)'}`), ...(p.next ? [`next: ${p.next}`] : [])].join('\n') : '(none)';
  },
  examples: ['breakrocks universes theme-history %paris', 'breakrocks universes theme-history %paris --all --json'],
});
const restoreText = (r: unknown) => {
  const x = r as { universe?: { name?: string; themeHeldVersion?: number | null } | null; proposal?: { id?: string } | null } | null;
  if (!x) return '(none)';
  return x.proposal ? `proposal ${x.proposal.id ?? '?'} filed (the universe has no leadership)` : `${x.universe?.name ?? ''}: ${x.universe?.themeHeldVersion ? `frozen at version ${x.universe.themeHeldVersion}` : 'follows the latest version'}`;
};
const restoreSelect = '{ universe { name themeHeldVersion } proposal { id } }';
export const universesThemeRestore = apiCommand({
  name: 'universes theme-restore', summary: 'Restore an entry of the theme history: the universe holds that theme at that version, or a proposal is filed (restoreUniverseTheme)',
  kind: 'mutation', op: 'restoreUniverseTheme', positionals: ['universe', 'entryId'], dry: true, select: restoreSelect, text: restoreText,
  descriptions: { universe: 'The universe (%name, %name/sub)', entryId: 'The entry of the history (universes theme-history)' },
  examples: ['breakrocks universes theme-restore %paris <entry id>', 'breakrocks universes theme-restore %paris <entry id> --dry-run'],
});
export const universesThemeFollow = apiCommand({
  name: 'universes theme-follow', summary: 'End the frozen version of a universe: its theme follows the latest version again (followThemeUpdates)',
  kind: 'mutation', op: 'followThemeUpdates', positionals: ['universe'], dry: true, select: restoreSelect, text: restoreText, descriptions: { universe: 'The universe (%name, %name/sub)' },
  examples: ['breakrocks universes theme-follow %paris'],
});
