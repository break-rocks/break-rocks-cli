// Discovery (specs v85.8.0, for-you.feature): why a post was recommended, the universes muted from discovery,
// the reset of the recommendations; and the resolution of an address (v86.0.0, address-parameters.feature;
// v101.0.0, D-301: an experience instance address resolves to its universe event or its route).
import { apiCommand } from '../api/command.js';
import { selection } from '../api/graphql.js';
import { doneText, listText } from './shared.js';

export const exploreWhy = apiCommand({
  name: 'explore why', summary: '"Why this post": why a post was shown in "For you" or the clip feed, from what was shown in the last 7 days (whyRecommended)', kind: 'query', op: 'whyRecommended', positionals: ['postId'], depth: 1,
  descriptions: { postId: 'The post shown' }, examples: ['breakrocks explore why <post id>', 'breakrocks explore why <post id> --json'],
});
export const exploreMuted = apiCommand({
  name: 'explore muted', summary: 'The universes muted from discovery (myMutedUniverses)', kind: 'query', op: 'myMutedUniverses',
  text: listText((m: { universe: string; since: string }) => `${m.universe}  since ${m.since}`), examples: ['breakrocks explore muted'],
});
export const exploreMute = apiCommand({
  name: 'explore mute', summary: 'Mute a universe from discovery, its sub-universes included (muteUniverseDiscovery; 500 at most)', kind: 'mutation', op: 'muteUniverseDiscovery', positionals: ['universe'],
  text: (r) => { const m = r as { universe?: string; since?: string } | null; return m ? `${m.universe} muted from discovery since ${m.since}` : '(none)'; }, examples: ['breakrocks explore mute %paris-foot'],
});
export const exploreUnmute = apiCommand({
  name: 'explore unmute', summary: 'Unmute a universe from discovery (unmuteUniverseDiscovery)', kind: 'mutation', op: 'unmuteUniverseDiscovery', positionals: ['universe'], text: doneText, examples: ['breakrocks explore unmute %paris-foot'],
});
export const exploreReset = apiCommand({
  name: 'explore reset', summary: 'Reset the recommendations: the interest profile, the recommendations of the last 7 days and the clip plays erased; the rest kept (resetRecommendations)', kind: 'mutation', op: 'resetRecommendations',
  confirm: () => 'Erase your interest profile and your recent recommendations?', text: () => 'recommendations reset', examples: ['breakrocks explore reset --yes'],
});
type Resolved = { address: string; url: string; parameters?: { key: string; value: string }[]; playlist?: { id: string; name?: string } | null; universeEvent?: { id: string; title?: string } | null; mapRoute?: { id: string; name?: string } | null };
export const resolve = apiCommand({
  name: 'resolve', summary: 'Resolve an address: its canonical address and URL, its address parameters, and the playlist, universe event or route it names (resolveAddress)', kind: 'query', op: 'resolveAddress', positionals: ['address'],
  descriptions: { address: 'The address (@erin>journey?t=90, %paris*event!id=…, @alice*route!id=…)' },
  select: `{ address url parameters ${selection('AddressParameter', 1)} playlist { id name } universeEvent { id title } mapRoute { id name } }`,
  text: (r) => { const x = r as Resolved | null; return x ? [`${x.address}  ${x.url}`, ...(x.parameters ?? []).map((p) => `${p.key}=${p.value}`), ...(x.playlist ? [`playlist ${x.playlist.id}  ${x.playlist.name ?? ''}`] : []), ...(x.universeEvent ? [`event ${x.universeEvent.id}  ${x.universeEvent.title ?? ''}`] : []), ...(x.mapRoute ? [`route ${x.mapRoute.id}  ${x.mapRoute.name ?? ''}`] : [])].join('\n') : '(none)'; },
  examples: ['breakrocks resolve "@erin>journey?t=90"', 'breakrocks resolve "%paris*event!id=<event id>" --json'],
});
