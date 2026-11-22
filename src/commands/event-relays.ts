// Specs v122.0.0 to v122.2.0: the relay of a universe event in another universe (D-383, D-385: at once for the leadership of the
// universe that relays it, by a proposal of a resident at 5 supports within 7 days otherwise), the event catalog with the event types
// on the Map view of Experiences (Explore), and who sees a resident by name among the present residents of a universe discussion (D-384).
// The refusals are the platform's: EVENT_RELAY_NOT_ALLOWED, EVENT_RELAY_EXISTS, EVENT_RELAY_PROPOSALS_LIMIT.
import { apiCommand } from '../api/command.js';
import { discussionIdOf } from './discussions.js';
import { doneText, listText, pageText } from './shared.js';

type Relay = { id: string; universe?: string; status?: string; supports?: number; supportsNeeded?: number; mySupport?: boolean; expiresAt?: string | null; visible?: boolean; proposedBy?: { handle?: string } | null; event?: { id?: string; title?: string; startsAt?: string } | null };
const relayLine = (r: Relay) => [
  `${r.id}  %${r.universe ?? '?'}  ${r.status ?? '-'}`,
  r.status === 'PROPOSED' ? `${r.supports ?? 0}/${r.supportsNeeded ?? 5} supports${r.mySupport ? ' (yours)' : ''}${r.expiresAt ? `, until ${r.expiresAt}` : ''}` : '',
  r.visible === false ? 'hidden' : '',
  r.proposedBy?.handle ? `by @${r.proposedBy.handle}` : '',
  r.event ? `event ${r.event.id ?? '?'}  ${r.event.startsAt ?? ''}  ${r.event.title ?? ''}` : '',
].filter(Boolean).join('  ');
const relayText = (r: unknown) => (r ? relayLine(r as Relay) : '(none)');
const onRelay = { positionals: ['relayId'], rename: { relayId: 'id' }, descriptions: { id: 'The relay (the id of an EventRelay, as an event shows it in "relay")' } };

export const eventsRelay = apiCommand({
  name: 'events relay', summary: 'Relay a universe event of a public universe in another public universe: at once for its leadership, else as a proposal (relayUniverseEvent)',
  description: 'The leadership of the universe that relays makes it ACTIVE at once; a resident who can vote proposes it (PROPOSED: 5 supports within 7 days, 1 open proposal per universe and 3 in all). EVENT_RELAY_NOT_ALLOWED (an event not upcoming, of a private universe, with an access other than "public", in its own universe or a sub-universe of it, in a private universe, or a caller without the right), EVENT_RELAY_EXISTS, EVENT_RELAY_PROPOSALS_LIMIT.',
  kind: 'mutation', op: 'relayUniverseEvent', positionals: ['eventId'], rename: { eventId: 'id', universe: 'in' }, depth: 1, dry: true,
  descriptions: { id: 'The universe event', in: 'The public universe that relays it (%name)' }, text: relayText,
  examples: ['breakrocks events relay <event id> --in %paris'],
});
export const eventsRelaySupport = apiCommand({
  name: 'events relay support', summary: 'Support a proposal of relay of a universe event: a resident of the universe who can vote; at the 5th support within 7 days it is made (supportEventRelay)',
  kind: 'mutation', op: 'supportEventRelay', ...onRelay, depth: 1, text: relayText, examples: ['breakrocks events relay support <relay id>'],
});
export const eventsRelayRemove = apiCommand({
  name: 'events relay remove', summary: 'Remove a relay of a universe event: the leadership of the universe that relays it, or the resident who proposed it while it is PROPOSED (removeEventRelay)',
  kind: 'mutation', op: 'removeEventRelay', ...onRelay, confirm: (i) => `Remove the relay ${String(i.id)}?`, text: doneText, examples: ['breakrocks events relay remove <relay id> --yes'],
});
export const eventsRelaysProposals = apiCommand({
  name: 'events relays proposals', summary: 'The proposals of relay of universe events waiting for their supports in a public universe, the one that ends soonest first (eventRelayProposals)',
  kind: 'query', op: 'eventRelayProposals', positionals: ['universe'], descriptions: { universe: 'The public universe (%name)', limit: 'How many at most (1 to 50, 20 by default; LIMIT_INVALID otherwise)' }, depth: 1,
  text: pageText(relayLine), examples: ['breakrocks events relays proposals %paris', 'breakrocks events relays proposals %paris --all'],
});

type EventType = { key: string; name?: string; onExploreMap?: boolean; sensitive?: boolean };
type Family = { key: string; name?: string; types?: EventType[] };
export const eventsCatalog = apiCommand({
  name: 'events catalog', summary: 'The event catalog: its event families and event types, and which event types are on the Map view of Experiences (Explore) (eventCatalog)',
  description: 'An event type "on the Map view of Experiences (Explore)" is drawn there for its universe events that invite a passer-by (a place, in person, public) within 7 days, without their event organizer asking for it; --explore-map shown does it for any other, within 30 days.',
  kind: 'query', op: 'eventCatalog', depth: 3, hide: ['language'], extra: { language: { type: 'string', description: 'The language of the names (BCP 47: en, fr…; en by default)' } },
  prepare: (i) => ({ ...i, language: i.language ?? 'en' }),
  text: (r) => {
    const families = (r as { families?: Family[] } | null)?.families ?? [];
    return families.length ? families.map((f) => [`${f.key}  ${f.name ?? ''}`, ...(f.types ?? []).map((t) => `  ${t.key}  ${t.name ?? ''}  ${t.onExploreMap ? 'on the Map view of Experiences (Explore)' : 'in its universe'}${t.sensitive ? '  sensitive' : ''}`)].join('\n')).join('\n') : '(none)';
  },
  examples: ['breakrocks events catalog', 'breakrocks events catalog --language fr --json'],
});

export const settingsPresence = apiCommand({
  name: 'settings presence', summary: 'Choose who sees you by name among the present residents of the universe discussions: hidden, connections or everyone (setPresenceVisibility)',
  description: 'In one universe (--in %universe), or everywhere (--in left out). Without a choice, the leadership and the moderators are seen by everyone, the others by their connections. Returns what now holds.',
  kind: 'mutation', op: 'setPresenceVisibility', positionals: ['visibility'], rename: { universe: 'in' }, dry: true,
  hide: ['visibility'], extra: { visibility: { type: 'string', enum: ['hidden', 'connections', 'everyone'], description: 'hidden: nobody; connections: the accounts connected with you; everyone: every reader of the discussion' } }, require: ['visibility'],
  descriptions: { in: 'Only in this universe (%name); everywhere when left out' },
  prepare: (i) => ({ ...i, visibility: String(i.visibility).toUpperCase() }),
  text: (r) => `presence visible to: ${String(r ?? '-').toLowerCase()}`,
  examples: ['breakrocks discussions presence-choice set connections', 'breakrocks discussions presence-choice set hidden --in %paris'],
});

export const settingsPresenceShow = apiCommand({
  name: 'settings presence show', summary: 'The presence choice made everywhere: who sees you by name among the present residents of the universe discussions; none when no choice was made (mySettings.presenceVisibility)',
  description: 'The choice made with settings presence without --in. none: no choice everywhere, each universe then falls back to its own default (capabilities --universe tells the one that holds there).',
  kind: 'query', op: 'mySettings', select: '{ presenceVisibility }',
  map: (d) => ({ presenceVisibility: (d as { presenceVisibility?: string | null } | null)?.presenceVisibility ?? null }),
  text: (r) => `presence visible to: ${String((r as { presenceVisibility?: string | null } | null)?.presenceVisibility ?? 'none').toLowerCase()}`,
  examples: ['breakrocks discussions presence-choice', 'breakrocks discussions presence-choice --json'],
});

type Present = { account?: { id?: string; handle?: string; displayName?: string }; connected?: boolean; role?: string | null };
export const discussionsPresent = apiCommand({
  name: 'discussions present', summary: 'The present residents of a universe discussion you may see by name: leadership, moderators, connections, then the others, 12 at most (universeDiscussionPresent)',
  description: 'Each resident chose who sees them (settings presence); the others are only counted (discussions show). Read when asked, never pushed.',
  kind: 'query', op: 'universeDiscussionPresent', positionals: ['id'], descriptions: { id: 'The universe discussion: its address (%paris&general) or its id' },
  prepare: async (i, ctx) => ({ ...i, id: typeof i.id === 'string' ? await discussionIdOf(ctx, i.id) : i.id }),
  text: listText((p: Present) => `${p.account?.id ?? '?'}  @${p.account?.handle ?? '?'}  ${p.account?.displayName ?? ''}${p.role ? `  ${p.role}` : ''}${p.connected ? '  connected' : ''}`),
  examples: ['breakrocks discussions present %paris&general'],
});

export const eventRelayCommands = [eventsRelay, eventsRelaySupport, eventsRelayRemove, eventsRelaysProposals, eventsCatalog, settingsPresence, settingsPresenceShow, discussionsPresent];
