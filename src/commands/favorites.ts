// The favorite universes and their alerts (D-92, D-303: the operations of before specs v83.1.0 still without a
// command): the list with the alert of each, the alerts of one turned on or off, and the pick of favorites no
// longer offered. Adding, removing and moving a favorite: universes favorite add, remove, move.
import { apiCommand } from '../api/command.js';

type Favorites = { offered?: boolean; items?: { universe: string; alerts?: boolean }[] };
const favoritesText = (r: unknown) => {
  const f = r as Favorites | null;
  if (!f) return '(none)';
  const lines = (f.items ?? []).map((x) => `${x.universe}${x.alerts ? '  alerts on' : ''}`);
  return [...(lines.length ? lines : ['(no favorite universe)']), ...(f.offered ? ['the pick of favorites is offered (universes favorite skip: no longer)'] : [])].join('\n');
};
export const favoriteList = apiCommand({ name: 'universes favorite list', summary: 'The favorite universes, in their order, with their alerts (favoriteUniverses)', kind: 'query', op: 'favoriteUniverses', text: favoritesText, examples: ['breakrocks universes favorite list'] });
const alerts = (on: boolean) => apiCommand({
  name: `universes favorite alerts-${on ? 'on' : 'off'}`, summary: `Turn the alerts of a favorite universe ${on ? 'on' : 'off'} (setUniverseAlerts)`, kind: 'mutation', op: 'setUniverseAlerts', fixed: { alerts: on }, positionals: ['universe'],
  descriptions: { universe: 'The favorite universe (%name)' }, text: favoritesText, examples: [`breakrocks universes favorite alerts-${on ? 'on' : 'off'} %paris`],
});
export const favoriteAlertsOn = alerts(true);
export const favoriteAlertsOff = alerts(false);
export const favoriteSkip = apiCommand({ name: 'universes favorite skip', summary: 'No longer offer the pick of favorite universes, on any device (skipFavoriteUniverses)', kind: 'mutation', op: 'skipFavoriteUniverses', text: favoritesText, examples: ['breakrocks universes favorite skip'] });

export const favoriteCommands = [favoriteList, favoriteAlertsOn, favoriteAlertsOff, favoriteSkip];
