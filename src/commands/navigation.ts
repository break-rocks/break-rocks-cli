// The account settings of specs v156.0.0 (D-512 (6), (8); apps/experiences-place.feature): Me › Navigation, "The center
// button opens" (Settings.navigation.centerButtonOpens: the place view Experiences opens on, the same on every device of
// the account), and Me › Privacy, "Share my activity with my close ones" (Settings.shareActivityWithCloseOnes, off by
// default; the position only while shared elsewhere). A delegated agent reads and changes them for its human as the
// platform allows.
import { apiCommand } from '../api/command.js';
import { SCHEMA } from '../api/schema.generated.js';

/** Every field of SettingsInput but [keep], hidden from a command that changes one setting. */
export const settingsBut = (...keep: string[]) => Object.keys(SCHEMA.types.SettingsInput?.f ?? {}).filter((f) => !keep.includes(f)).map((f) => `input.${f}`);

const VIEWS: Record<string, string> = { map: 'MAP', now: 'NOW', 'my-experiences': 'MY_EXPERIENCES', 'last-view': 'LAST_VIEW' };
const VIEW_WORDS: Record<string, string> = { MAP: 'Map (Explore)', NOW: 'Now', MY_EXPERIENCES: 'My experiences', LAST_VIEW: 'the last view open' };
type Navigation = { navigation?: { centerButtonOpens?: string } | null } | null;
const navigationText = (r: unknown) => `The center button opens: ${VIEW_WORDS[(r as Navigation)?.navigation?.centerButtonOpens ?? 'MAP'] ?? (r as Navigation)?.navigation?.centerButtonOpens}`;

export const navigationShow = apiCommand({
  name: 'me navigation', summary: 'Me › Navigation: the place view Experiences opens on, "The center button opens" (mySettings.navigation)',
  description: 'Map (Explore, by default), Now, My experiences or the last view open; an account setting, the same on every device.',
  kind: 'query', op: 'mySettings', select: '{ navigation { centerButtonOpens } }', text: navigationText,
  examples: ['breakrocks me navigation', 'breakrocks me navigation --json'],
});

export const navigationSet = apiCommand({
  name: 'me navigation set', summary: 'Choose what the center button opens: map, now, my-experiences or last-view (setSettings navigation)',
  description: 'The place view Experiences opens on (D-512 (8)): map (the Map view, Explore; the default), now, my-experiences, or last-view (the place view last open on the device). On the web and from 600 pixels of width, Experiences opens on its Map view whatever the setting.',
  kind: 'mutation', op: 'setSettings', positionals: ['view'], dry: true,
  hide: settingsBut(), extra: { view: { type: 'string', enum: Object.keys(VIEWS), description: 'map, now, my-experiences or last-view' } }, require: ['view'],
  prepare: (i) => { const { view, ...rest } = i; return { ...rest, 'input.navigation': { centerButtonOpens: VIEWS[String(view)] } }; },
  select: '{ navigation { centerButtonOpens } }', text: navigationText,
  examples: ['breakrocks me navigation set now', 'breakrocks me navigation set last-view --dry-run'],
});

type Shared = { shareActivityWithCloseOnes?: boolean } | null;
const sharedText = (r: unknown) => `Share my activity with my close ones: ${(r as Shared)?.shareActivityWithCloseOnes ? 'on' : 'off'}`;

export const shareActivityShow = apiCommand({
  name: 'me privacy share-activity', summary: 'Me › Privacy: whether your activity is shared with your close ones (mySettings.shareActivityWithCloseOnes)',
  description: 'Off by default. On, your close ones see your activity in Experiences › Now (Close ones); your position only while you share it elsewhere (a map presence, a live share).',
  kind: 'query', op: 'mySettings', select: '{ shareActivityWithCloseOnes }', text: sharedText,
  examples: ['breakrocks me privacy share-activity'],
});

export const shareActivitySet = apiCommand({
  name: 'me privacy share-activity set', summary: 'Turn "Share my activity with my close ones" on or off (setSettings shareActivityWithCloseOnes)',
  description: 'Your position is never shared by this setting alone: only while a map presence or a live share shares it.',
  kind: 'mutation', op: 'setSettings', positionals: ['state'], dry: true,
  hide: settingsBut(), extra: { state: { type: 'string', enum: ['on', 'off'], description: 'on: share your activity with your close ones; off: stop' } }, require: ['state'],
  prepare: (i) => { const { state, ...rest } = i; return { ...rest, 'input.shareActivityWithCloseOnes': state === 'on' }; },
  select: '{ shareActivityWithCloseOnes }', text: sharedText,
  examples: ['breakrocks me privacy share-activity set on', 'breakrocks me privacy share-activity set off --dry-run'],
});

export const navigationCommands = [navigationShow, navigationSet, shareActivityShow, shareActivitySet];
