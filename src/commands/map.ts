// The people on the map (specs v84.0.0, D-248, map-presence.feature and map-safety.feature): the map presence of a
// human (its audience, its duration, the ghost mode), the map presences and groups of an area; the live shares of a
// conversation or a group chat (C-13; since v94.0.0 a minor sharer is read at the center of its map cell, and since
// v101.4.0 its real-time position carries that map cell); the locatable residents of a public universe; the
// meet-ups of a discussion; Nearby (BLE tokens, contracts/nearby.md); the place of a post. A delegated agent is
// refused where the contract says so (DELEGATED_AGENT_NOT_ALLOWED). Map avatars are deferred by the platform.
import { accountIdOf, apiCommand } from '../api/command.js';
import type { Context } from '../context.js';
import { usageError } from '../errors.js';
import { bool, list, str } from '../schema.js';
import { cellsProperty, discussionTarget, doneText, listText, oneDiscussion, pointOf, pointsOf } from './shared.js';

const cells = { parentMapCells: 'cells' };
const cellsDesc = { cells: cellsProperty.description! };
const pointProp = { point: str('The point, <lat>,<lon> (48.8566,2.3522)') };
const withPoint = (i: Record<string, unknown>) => (i.point === undefined ? i : { ...i, point: pointOf(String(i.point), '--point') });

// ---- Map presence ----

type Presence = { allConnections?: boolean; precision?: string; viewers?: { account?: { handle?: string } | null; accountId?: string; precision?: string | null }[]; universes?: string[]; ghost?: boolean; endsAt?: string };
const presenceText = (r: unknown) => {
  const p = r as Presence | null;
  if (!p) return '(no map presence)';
  const viewers = (p.viewers ?? []).map((v) => `${v.account?.handle ? `@${v.account.handle}` : v.accountId}${v.precision ? ` (${v.precision})` : ''}`);
  return [`until ${p.endsAt ?? '-'}${p.ghost ? '  ghost mode' : ''}`, `precision: ${p.precision ?? '-'}`, `all connections: ${p.allConnections ? 'yes' : 'no'}`, `viewers: ${viewers.join(', ') || '-'}`, `universes: ${p.universes?.join(', ') || '-'}`].join('\n');
};
const audienceExtra = {
  connections: bool('Shared with all one\'s connections'),
  viewers: list('Connected accounts who see it: @handle, or @handle=EXACT|NEIGHBOURHOOD|CITY (a minor: never EXACT)', { type: 'string' }),
  universes: list('Public universes one is a resident of whose residents see it in groups only (3 at most; a minor: none)', { type: 'string' }),
};
const audienceHide = ['audience.allConnections', 'audience.viewers', 'audience.universes'];
async function audienceOf(ctx: Context, i: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { connections, viewers, universes, ...rest } = i;
  const resolved = await Promise.all(((viewers as string[] | undefined) ?? []).map(async (v) => {
    const [who, precision] = v.split('=');
    return { accountId: await accountIdOf(ctx, who), ...(precision ? { precision: precision.toUpperCase() } : {}) };
  }));
  if (!connections && !resolved.length && !(universes as string[] | undefined)?.length) throw usageError('INVALID_INPUT', 'An audience: --connections, --viewers or --universes');
  return { ...rest, 'audience.allConnections': !!connections, 'audience.viewers': resolved, 'audience.universes': universes ?? [] };
}
export const presenceShow = apiCommand({
  name: 'presence show', summary: 'The map presence of the account: its audience, its precision, until when, the ghost mode (myMapPresence)', kind: 'query', op: 'myMapPresence', text: presenceText,
  examples: ['breakrocks presence show', 'breakrocks presence show --json'],
});
export const presenceStart = apiCommand({
  name: 'presence start', summary: 'Start (or replace) one\'s map presence for a duration, with an audience and a point (startMapPresence; a human only)',
  description: 'The point becomes map cells at once; it is kept as a point for EXACT viewers only, during the map presence only. The audience: --connections, --viewers (connected accounts), --universes (groups only). A minor: connections only, never EXACT, CITY at most. MAP_PRESENCE_CONNECTIONS_ONLY, MAP_PRESENCE_UNIVERSE_LIMIT, MAP_SHARE_RATE_LIMITED, NOT_CONNECTED, NOT_A_RESIDENT.',
  kind: 'mutation', op: 'startMapPresence', flatten: ['audience'], hide: [...audienceHide, 'point'], extra: { ...pointProp, ...audienceExtra }, require: ['point'], dry: true,
  descriptions: { duration: 'How long: ONE_HOUR, EIGHT_HOURS, ONE_DAY or SEVEN_DAYS', precision: 'The precision by default: EXACT, NEIGHBOURHOOD or CITY' },
  prepare: async (i, ctx) => withPoint(await audienceOf(ctx, i)), text: presenceText,
  examples: ['breakrocks presence start --point 48.8566,2.3522 --duration ONE_HOUR --connections --precision NEIGHBOURHOOD', 'breakrocks presence start --point 48.8566,2.3522 --duration EIGHT_HOURS --viewers @alice=EXACT --universes %paris'],
});
export const presenceUpdate = apiCommand({
  name: 'presence update', summary: 'Move one\'s map presence to a point, every 5 minutes at most (updateMapPresence; MAP_PRESENCE_TOO_SOON)', kind: 'mutation', op: 'updateMapPresence', hide: ['point'], extra: pointProp, require: ['point'],
  prepare: withPoint, text: presenceText, examples: ['breakrocks presence update --point 48.8570,2.3530'],
});
export const presenceAudience = apiCommand({
  name: 'presence audience', summary: 'Change the audience of one\'s map presence, 30 times in 24 hours at most (setMapPresenceAudience)', kind: 'mutation', op: 'setMapPresenceAudience', flatten: ['audience'], hide: audienceHide, extra: audienceExtra, dry: true,
  descriptions: { precision: 'The precision by default: EXACT, NEIGHBOURHOOD or CITY' }, prepare: (i, ctx) => audienceOf(ctx, i), text: presenceText,
  examples: ['breakrocks presence audience --connections --precision CITY'],
});
const ghost = (on: boolean) => apiCommand({
  name: `presence ghost ${on ? 'on' : 'off'}`, summary: `Turn the ghost mode ${on ? 'on: nobody sees one\'s map presence, the audience not told' : 'off'} (setGhostMode)`, kind: 'mutation', op: 'setGhostMode', fixed: { ghost: on }, text: presenceText,
  examples: [`breakrocks presence ghost ${on ? 'on' : 'off'}`],
});
export const presenceGhostOn = ghost(true);
export const presenceGhostOff = ghost(false);
export const presenceStop = apiCommand({
  name: 'presence stop', summary: 'Stop one\'s map presence; nothing is kept (stopMapPresence)', kind: 'mutation', op: 'stopMapPresence', text: (r) => (r ? 'stopped' : 'there was none'), examples: ['breakrocks presence stop'],
});
type MapPresence = { account?: { handle?: string } | null; accountId: string; precision?: string; mapCell?: string | null; point?: { lat: number; lon: number } | null; endsAt?: string };
export const mapPresences = apiCommand({
  name: 'map presences', summary: 'The map presences of the connected accounts one may see in an area of the map (mapPresences; none in the ghost mode, none across a block)', kind: 'query', op: 'mapPresences', rename: cells, descriptions: cellsDesc,
  text: listText((p: MapPresence) => `${p.account?.handle ? `@${p.account.handle}` : p.accountId}  ${p.precision ?? ''}  ${p.point ? `${p.point.lat},${p.point.lon}` : p.mapCell ?? '-'}  until ${p.endsAt ?? '-'}`),
  examples: ['breakrocks map presences --cells 861fb4677ffffff'],
});
export const mapGroups = apiCommand({
  name: 'map groups', summary: 'The groups of map presence of an area (3 people at least per map cell of resolution 8; never a minor) (mapPresenceGroups)', kind: 'query', op: 'mapPresenceGroups', rename: cells,
  descriptions: { ...cellsDesc, universe: 'The universe filter (its residents only: NOT_A_RESIDENT); none: everyone one may see' },
  text: listText((g: { mapCell: string; count: number }) => `${g.mapCell}  ${g.count}`), examples: ['breakrocks map groups --cells 861fb4677ffffff --universe %paris'],
});

// ---- Live shares ----

type LiveShare = { id: string; startedAt?: string; endsAt?: string; eventId?: string | null; meetUpId?: string | null; discussion?: { account?: { handle?: string } | null; groupChat?: { id?: string; name?: string } | null } };
const shareLine = (s: LiveShare) => `${s.id}  until ${s.endsAt ?? '-'}  ${s.discussion?.account?.handle ? `with @${s.discussion.account.handle}` : s.discussion?.groupChat ? `in group ${s.discussion.groupChat.name ?? s.discussion.groupChat.id}` : ''}${s.eventId ? `  until the event ${s.eventId}` : ''}${s.meetUpId ? `  until the meet-up ${s.meetUpId}` : ''}`;
const conversation = { ...discussionTarget, hide: ['discussion.channel'] };
const oneConversation = (i: Record<string, unknown>) => {
  if ((i.group === undefined) === (i.with === undefined)) throw usageError('DISCUSSION_TARGET_INVALID', 'Name the conversation with --with (@handle or id) or the group chat with --group, one of them');
  return i;
};
export const liveShareList = apiCommand({
  name: 'live-share list', summary: 'The live shares of the account in progress (myLiveShares)', kind: 'query', op: 'myLiveShares', text: listText(shareLine), examples: ['breakrocks live-share list'],
});
export const liveShareIn = apiCommand({
  name: 'live-share in', summary: 'The live shares in progress in a conversation (--with) or a group chat (--group) one takes part in (liveShares)', kind: 'query', op: 'liveShares', ...conversation, prepare: oneConversation,
  text: listText(shareLine), examples: ['breakrocks live-share in --with @alice', 'breakrocks live-share in --group <group id> --json'],
});
export const liveShareStart = apiCommand({
  name: 'live-share start', summary: 'Start a live share of one\'s position in a conversation or a group chat: 15 to 1,440 minutes, until an event or a meet-up (setLiveShare; a human only)',
  description: 'NOT_CONNECTED, LIVE_SHARE_TOO_LONG, EVENT_NOT_ATTENDED, MEET_UP_NOT_PARTICIPANT, MEET_UP_SHARE_NOT_OPEN. The positions are sent by live-share send (an app sends them every 15 seconds).',
  kind: 'mutation', op: 'setLiveShare', fixed: { sharing: true }, ...conversation, hide: ['discussion.channel', 'shareId'], dry: true,
  descriptions: { ...discussionTarget.descriptions, minutes: 'How long, 15 to 1,440 minutes', untilEventId: 'Until the end of an event one attends (within 24 hours)', untilMeetUpId: 'Until 15 minutes after a meet-up' },
  prepare: oneConversation, text: (r) => (r ? shareLine(r as LiveShare) : '(none)'),
  examples: ['breakrocks live-share start --with @alice --minutes 60', 'breakrocks live-share start --group <group id> --until-meet-up-id <meet-up id>'],
});
export const liveShareStop = apiCommand({
  name: 'live-share stop', summary: 'Stop a live share of one\'s own (setLiveShare)', kind: 'mutation', op: 'setLiveShare', fixed: { sharing: false }, flatten: [], hide: ['discussion', 'minutes', 'untilEventId', 'untilMeetUpId'], positionals: ['shareId'],
  descriptions: { shareId: 'The live share (live-share list)' }, text: (r) => (r ? shareLine(r as LiveShare) : 'stopped'), examples: ['breakrocks live-share stop <share id>'],
});
type LivePosition = { shareId: string; accountId: string; at: string; point: { lat: number; lon: number }; mapCell?: string | null; secondsToMeetUp?: number | null; secondsToMeetingPoint?: number | null };
export const liveSharePositions = apiCommand({
  name: 'live-share positions', summary: 'The last position of each live share asked (20 at most) one may see; a minor sharer at the center of its map cell (livePositions)', kind: 'query', op: 'livePositions', positionals: ['shareIds'],
  descriptions: { shareIds: 'The live shares (20 at most)' },
  text: listText((p: LivePosition) => `${p.shareId}  ${p.at}  ${p.point.lat},${p.point.lon}${p.mapCell ? `  (a minor: the center of the map cell ${p.mapCell})` : ''}${p.secondsToMeetUp != null ? `  ${Math.round(p.secondsToMeetUp / 60)} min to the meet-up` : ''}`),
  examples: ['breakrocks live-share positions <share id> <share id>'],
});
export const liveShareSend = apiCommand({
  name: 'live-share send', summary: 'Send the last 1 to 3 positions of one\'s live share, at the time of sending (sendLivePositions; every 15 seconds at most: false beyond)', kind: 'mutation', op: 'sendLivePositions', positionals: ['shareId'], hide: ['points'],
  extra: { positions: str('The positions: "<lat>,<lon>;…" (1 to 3, the latest last), or the JSON of [PositionInput]') }, require: ['positions'],
  descriptions: { shareId: 'The live share' },
  prepare: (i, ctx) => {
    const { positions, ...rest } = i;
    const s = String(positions).trim();
    const points = s.startsWith('[') && s.includes('"at"') ? JSON.parse(s) : pointsOf(s, '--positions').map((p) => ({ ...p, at: new Date(ctx.now()).toISOString() }));
    if (!points.length || points.length > 3) throw usageError('INVALID_INPUT', '--positions: 1 to 3 positions');
    return { ...rest, points };
  },
  text: (r) => (r === true ? 'sent' : 'dropped (every 15 seconds at most)'), examples: ['breakrocks live-share send <share id> --positions 48.8566,2.3522'],
});

// ---- Locatable residents ----

type Locatable = { universe: string; activity: string; mapCell: string; endsAt: string; account?: { handle?: string } | null; accountId?: string };
const locatableLine = (l: Locatable) => `${l.universe}  ${l.account?.handle ? `@${l.account.handle}  ` : ''}${l.activity}  ${l.mapCell}  until ${l.endsAt}`;
export const locatableShow = apiCommand({
  name: 'locatable show', summary: 'Where the account is locatable now: its universes, activities and map cells (myLocatable)', kind: 'query', op: 'myLocatable', text: listText(locatableLine), examples: ['breakrocks locatable show'],
});
export const locatableResidents = apiCommand({
  name: 'locatable residents', summary: 'The locatable residents of a universe in an area of the map, to its residents (locatableResidents)', kind: 'query', op: 'locatableResidents', positionals: ['universe'], rename: cells, descriptions: cellsDesc,
  text: listText(locatableLine), examples: ['breakrocks locatable residents %paris --cells 861fb4677ffffff'],
});
export const locatableOn = apiCommand({
  name: 'locatable on', summary: 'Make oneself locatable in a public universe for an activity, 15 to 480 minutes, at a point turned into a map cell at once (setLocatable)', kind: 'mutation', op: 'setLocatable', fixed: { locatable: true }, positionals: ['universe'],
  hide: ['point'], extra: pointProp, require: ['point', 'activity', 'minutes'], dry: true, descriptions: { activity: 'The activity (ACTIVITY_TOO_LONG)', minutes: 'How long, 15 to 480 minutes' },
  prepare: withPoint, text: (r) => (r ? locatableLine(r as Locatable) : '(none)'), examples: ['breakrocks locatable on %paris-velo --activity "Ride to Vincennes" --point 48.8566,2.3522 --minutes 120'],
});
export const locatableOff = apiCommand({
  name: 'locatable off', summary: 'Stop being locatable in a universe (setLocatable)', kind: 'mutation', op: 'setLocatable', fixed: { locatable: false }, positionals: ['universe'], hide: ['point', 'activity', 'minutes'],
  text: (r) => (r ? locatableLine(r as Locatable) : 'stopped'), examples: ['breakrocks locatable off %paris-velo'],
});
export const locatableMove = apiCommand({
  name: 'locatable move', summary: 'Move one\'s map cell as a locatable resident, once every 15 minutes at most (updateLocatableCell)', kind: 'mutation', op: 'updateLocatableCell', positionals: ['universe'], hide: ['point'], extra: pointProp, require: ['point'],
  prepare: withPoint, text: (r) => (r ? locatableLine(r as Locatable) : '(none)'), examples: ['breakrocks locatable move %paris-velo --point 48.8400,2.4200'],
});

// ---- Meet-ups ----

type MeetUp = { at?: string; title?: string | null; cancelled?: boolean; place?: { name?: string } | null; answers?: { answer?: string; account?: { handle?: string } | null }[] };
const meetUpText = (r: unknown) => { const m = r as MeetUp | null; return m ? `${m.title ?? 'Meet-up'}  ${m.at ?? ''}  ${m.place?.name ?? ''}${m.cancelled ? '  (cancelled)' : ''}${m.answers?.length ? `\nanswers: ${m.answers.map((a) => `${a.account?.handle ? `@${a.account.handle}` : '?'} ${a.answer}`).join(', ')}` : ''}` : '(none)'; };
const meetUpBase = { ...discussionTarget, positionals: ['messageId'], descriptions: { ...discussionTarget.descriptions, messageId: 'The message of the meet-up' } };
export const meetupsAnswer = apiCommand({
  name: 'meetups answer', summary: 'Answer a meet-up of a discussion, ACCEPTED or DECLINED, until its time; again to change the answer (answerMeetUp)', kind: 'mutation', op: 'answerMeetUp', ...meetUpBase, positionals: ['messageId', 'answer'], dry: true,
  prepare: oneDiscussion, text: meetUpText, examples: ['breakrocks meetups answer <message id> ACCEPTED --group <group id>'],
});
export const meetupsChange = apiCommand({
  name: 'meetups change', summary: 'Change a meet-up: its whole place, time and title, by its author or a group chat admin (changeMeetUp; a change of the day clears the answers)', kind: 'mutation', op: 'changeMeetUp', ...meetUpBase,
  flatten: ['discussion', 'meetUp'], hide: ['meetUp.place'], extra: { ...pointProp, placeName: str('The name of the place') }, require: ['point', 'placeName'], dry: true,
  descriptions: { ...meetUpBase.descriptions, at: 'When (ISO 8601)', title: 'Its title' },
  prepare: (i) => { oneDiscussion(i); const { point, placeName, ...rest } = i; return { ...rest, 'meetUp.place': { name: placeName, point: pointOf(String(point), '--point') } }; },
  text: meetUpText, examples: ['breakrocks meetups change <message id> --group <group id> --at 2026-11-12T18:00:00Z --point 48.8530,2.3499 --place-name "Notre-Dame" --title "Apéro"'],
});
export const meetupsCancel = apiCommand({
  name: 'meetups cancel', summary: 'Cancel a meet-up until its time, by its author or a group chat admin: it stays as a message, cancelled (cancelMeetUp)', kind: 'mutation', op: 'cancelMeetUp', ...meetUpBase,
  prepare: oneDiscussion, confirm: (i) => `Cancel the meet-up ${String(i.messageId)}?`, text: meetUpText, examples: ['breakrocks meetups cancel <message id> --group <group id> --yes'],
});

// ---- Nearby ----

type NearbyRequest = { id: string; status: string; from?: { handle?: string } | null; to?: { handle?: string } | null; fromLabel?: string; expiresAt?: string };
const nearbyLine = (n: NearbyRequest) => `${n.id}  ${n.status}  from ${n.from?.handle ? `@${n.from.handle}` : n.fromLabel ?? '?'} to ${n.to?.handle ? `@${n.to.handle}` : '?'}  until ${n.expiresAt ?? '-'}`;
export const nearbyToken = apiCommand({
  name: 'nearby token', summary: 'The nearby token of the account to advertise (BLE), valid until its expiry (createNearbyToken)', kind: 'mutation', op: 'createNearbyToken',
  text: (r) => { const t = r as { token?: string; expiresAt?: string } | null; return t ? `${t.token}  until ${t.expiresAt}` : '(none)'; }, quiet: (r) => (r as { token?: string } | null)?.token, examples: ['breakrocks nearby token'],
});
export const nearbyRequest = apiCommand({
  name: 'nearby request', summary: 'Ask to connect with the account of a nearby token seen around (requestNearbyConnection; 10 in any 10 minutes)', kind: 'mutation', op: 'requestNearbyConnection', positionals: ['token'],
  descriptions: { token: 'The nearby token seen' }, text: (r) => (r ? nearbyLine(r as NearbyRequest) : '(none)'), examples: ['breakrocks nearby request <token>'],
});
export const nearbyRequests = apiCommand({
  name: 'nearby requests', summary: 'The requests to connect through Nearby, sent and received (nearbyRequests)', kind: 'query', op: 'nearbyRequests', text: listText(nearbyLine), examples: ['breakrocks nearby requests'],
});
const answerNearby = (accept: boolean) => apiCommand({
  name: `nearby ${accept ? 'accept' : 'decline'}`, summary: `${accept ? 'Accept' : 'Decline'} a request to connect through Nearby${accept ? ': the two accounts are connected' : ''} (answerNearbyConnection)`, kind: 'mutation', op: 'answerNearbyConnection', fixed: { accept }, positionals: ['nearbyRequestId'],
  descriptions: { nearbyRequestId: 'The request (nearby requests)' }, text: (r) => (r ? nearbyLine(r as NearbyRequest) : '(none)'), examples: [`breakrocks nearby ${accept ? 'accept' : 'decline'} <request id>`],
});
export const nearbyAccept = answerNearby(true);
export const nearbyDecline = answerNearby(false);
export const nearbyLeave = apiCommand({
  name: 'nearby leave', summary: 'Stop Nearby: one\'s nearby token no longer works and one\'s requests waiting end (leaveNearby)', kind: 'mutation', op: 'leaveNearby', text: doneText, examples: ['breakrocks nearby leave'],
});
export const nearbySightings = apiCommand({
  name: 'nearby sightings', summary: 'Send the nearby tokens seen around with their closeness; the persons close by come back (recordNearbySightings)', kind: 'mutation', op: 'recordNearbySightings',
  descriptions: { sightings: 'The tokens seen: [{ "token", "closeness" }] (JSON)' },
  text: listText((p: { label?: string; account?: { handle?: string } | null; closeness?: string; connected?: boolean }) => `${p.account?.handle ? `@${p.account.handle}` : '?'}  ${p.label ?? ''}  ${p.closeness ?? ''}${p.connected ? '  connected' : ''}`),
  examples: ['breakrocks nearby sightings --sightings \'[{"token":"<token>","closeness":"NEAR"}]\''],
});

// ---- The place of a post ----

export const postsPlace = apiCommand({
  name: 'posts place', summary: 'Place one\'s post at a point or a place, or remove its place (--remove) (setPostPlace)', description: 'POST_PLACE_NOT_ALLOWED for a post of a private universe, a reply, a repost or a quote. The precision and the moment of a placed video are deferred by the platform.',
  kind: 'mutation', op: 'setPostPlace', positionals: ['postId'], hide: ['place'], dry: true,
  extra: { ...pointProp, placeId: str('A place of the places search (places search)'), remove: bool('Remove the place of the post') }, descriptions: { postId: 'The post' },
  prepare: (i) => {
    const { point, placeId, remove, ...rest } = i;
    if ([point, placeId, remove || undefined].filter((x) => x !== undefined).length !== 1) throw usageError('INVALID_INPUT', '--point, --place-id or --remove, one of them');
    return { ...rest, place: remove ? null : point !== undefined ? { point: pointOf(String(point), '--point') } : { placeId } };
  },
  text: (r) => { const p = r as { id?: string; place?: { name?: string; mapCell?: string } | null } | null; return p ? `${p.id}: ${p.place ? `placed at ${p.place.name ?? p.place.mapCell}` : 'no place'}` : '(none)'; },
  examples: ['breakrocks posts place <post id> --point 48.8566,2.3522', 'breakrocks posts place <post id> --remove'],
});
