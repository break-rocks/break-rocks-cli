// The commands run against dev on the new backend (native-sulfur), by scripts/e2e-sulfur-dev.mjs or by hand, with the
// date of the last run: read by scripts/sulfur-table.ts (docs/sulfur.md, column Dev).
export const VERIFIED_ON = '2026-11-25';
export const VERIFIED: ReadonlySet<string> = new Set([
  'login', 'logout', 'whoami', 'me profile show', 'me profile set',
  'posts create', 'posts reply', 'posts quote', 'posts repost', 'posts like', 'posts delete', 'posts thread', 'posts list', 'posts feed', 'posts show', 'posts place',
  'accounts follow', 'accounts unfollow', 'accounts is-following', 'accounts show',
  'universes show', 'universes join', 'universes leave',
  'look personal saved', 'usage', 'me capabilities',
  'events catalog', 'events list', 'events create', 'playlists create', 'playlists add', 'playlists show', 'playlists hub',
  'my-places save', 'my-places list', 'map posts', 'map places search',
  'experiences import', 'experiences kinds', 'experiences publish', 'experiences runs start', 'experiences runs join', 'experiences runs leave',
  'experiences runs measure', 'experiences runs end', 'experiences runs show', 'experiences runs list', 'experiences runs ranking',
  'experiences runs draw', 'experiences runs tournament', 'experiences runs contest', 'experiences runs entries', 'experiences feats list',
  'experiences feats at', 'experiences feats publish',
  'messages groups create', 'messages groups invite', 'messages groups accept', 'messages groups invitations', 'connections request',
  'connections requests', 'connections accept',
]);
