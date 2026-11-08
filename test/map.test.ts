// Specs v84.0.0 to v101.4.0: map presence, live shares (a minor sharer at the center of its map cell), locatable
// residents, meet-ups, Nearby and the place of a post. Against a scripted API (no network).
import { describe, expect, it } from 'vitest';
import { scripted } from './scripted.js';

const presence = { allConnections: true, precision: 'NEIGHBOURHOOD', viewers: [{ account: { handle: 'alice' }, accountId: 'eu-a', precision: 'EXACT' }], universes: ['%paris'], ghost: false, endsAt: '2026-11-08T11:00:00.000Z' };

describe('map presence', () => {
  it('starts with an audience (viewers resolved by handle), moves, changes the audience, ghosts, stops', async () => {
    const { h, calls } = scripted({ accountByHandle: { id: 'eu-a' }, startMapPresence: presence, updateMapPresence: presence, setMapPresenceAudience: presence, setGhostMode: { ...presence, ghost: true }, stopMapPresence: true, myMapPresence: null });
    expect(await h.run('presence', 'start', '--point', '48.8566,2.3522', '--duration', 'ONE_HOUR', '--connections', '--viewers', '@alice=exact', '--universes', '%paris', '--precision', 'NEIGHBOURHOOD')).toBe(0);
    expect(calls[1]).toMatchObject({ field: 'startMapPresence', variables: { point: { lat: 48.8566, lon: 2.3522 }, duration: 'ONE_HOUR', audience: { allConnections: true, precision: 'NEIGHBOURHOOD', viewers: [{ accountId: 'eu-a', precision: 'EXACT' }], universes: ['%paris'] } } });
    expect(h.lines.at(-1)).toBe('until 2026-11-08T11:00:00.000Z\nprecision: NEIGHBOURHOOD\nall connections: yes\nviewers: @alice (EXACT)\nuniverses: %paris');
    expect(await h.run('presence', 'start', '--point', '48.8566,2.3522', '--duration', 'ONE_HOUR', '--json')).toBe(2);
    expect(await h.run('presence', 'update', '--point', '48.857,2.353')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'updateMapPresence', variables: { point: { lat: 48.857, lon: 2.353 } } });
    expect(await h.run('presence', 'audience', '--connections', '--precision', 'CITY')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'setMapPresenceAudience', variables: { audience: { allConnections: true, precision: 'CITY', viewers: [], universes: [] } } });
    expect(await h.run('presence', 'ghost', 'on')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'setGhostMode', variables: { ghost: true } });
    expect(await h.run('presence', 'stop')).toBe(0);
    expect(h.lines.at(-1)).toBe('stopped');
    expect(await h.run('presence', 'show')).toBe(0);
    expect(h.lines.at(-1)).toBe('(no map presence)');
  });
  it('reads the map presences and the groups of an area', async () => {
    const { h, calls } = scripted({ mapPresences: [{ account: { handle: 'alice' }, accountId: 'eu-a', precision: 'CITY', mapCell: '86x', point: null, endsAt: 'later' }], mapPresenceGroups: [{ mapCell: '88x', count: 5 }] });
    expect(await h.run('map', 'presences', '--cells', '861fb4677ffffff')).toBe(0);
    expect(h.lines.at(-1)).toBe('@alice  CITY  86x  until later');
    expect(await h.run('map', 'groups', '--cells', '861fb4677ffffff', '--universe', '%paris')).toBe(0);
    expect(calls[1].variables).toEqual({ parentMapCells: ['861fb4677ffffff'], universe: '%paris' });
    expect(h.lines.at(-1)).toBe('88x  5');
  });
});

describe('live shares', () => {
  it('starts in a conversation, stops, reads the positions (a minor at the center of its map cell), sends positions', async () => {
    const share = { id: 's1', endsAt: 'later', discussion: { account: { handle: 'alice' } } };
    const { h, calls } = scripted({ accountByHandle: { id: 'eu-a' }, setLiveShare: (v: Record<string, unknown>) => (v.sharing ? share : null), livePositions: [{ shareId: 's1', accountId: 'eu-a', at: 't', point: { lat: 48.85, lon: 2.35 }, mapCell: '881fb46741fffff' }], sendLivePositions: true, myLiveShares: [share], liveShares: [share] });
    expect(await h.run('live-share', 'start', '--with', '@alice', '--minutes', '60')).toBe(0);
    expect(calls[1]).toMatchObject({ field: 'setLiveShare', variables: { sharing: true, discussion: { accountId: 'eu-a' }, minutes: 60 } });
    expect(h.lines.at(-1)).toBe('s1  until later  with @alice');
    expect(await h.run('live-share', 'start', '--minutes', '60', '--json')).toBe(2);
    expect(await h.run('live-share', 'start', '--channel', '%x&a', '--json')).toBe(2);
    expect(await h.run('live-share', 'stop', 's1')).toBe(0);
    expect(calls.at(-1)!.variables).toMatchObject({ sharing: false, shareId: 's1' });
    expect(calls.at(-1)!.variables).not.toHaveProperty('discussion');
    expect(h.lines.at(-1)).toBe('stopped');
    expect(await h.run('live-share', 'positions', 's1')).toBe(0);
    expect(h.lines.at(-1)).toBe('s1  t  48.85,2.35  (a minor: the center of the map cell 881fb46741fffff)');
    expect(await h.run('live-share', 'send', 's1', '--positions', '48.85,2.35')).toBe(0);
    expect(calls.at(-1)!.variables).toEqual({ shareId: 's1', points: [{ lat: 48.85, lon: 2.35, at: '2026-10-23T10:00:00.000Z' }] });
    expect(await h.run('live-share', 'list')).toBe(0);
    expect(await h.run('live-share', 'in', '--group', 'g1')).toBe(0);
    expect(calls.at(-1)!.variables).toEqual({ discussion: { groupChatId: 'g1' } });
  });
});

describe('locatable residents, meet-ups, Nearby and the place of a post', () => {
  it('is locatable, moves, stops, and reads the residents of an area', async () => {
    const loc = { universe: '%paris-velo', activity: 'Ride', mapCell: '88x', endsAt: 'later', account: { handle: 'me' } };
    const { h, calls } = scripted({ setLocatable: (v: Record<string, unknown>) => (v.locatable ? loc : null), updateLocatableCell: loc, locatableResidents: [loc], myLocatable: [loc] });
    expect(await h.run('locatable', 'on', '%paris-velo', '--activity', 'Ride', '--point', '48.85,2.35', '--minutes', '120')).toBe(0);
    expect(calls[0].variables).toMatchObject({ universe: '%paris-velo', locatable: true, activity: 'Ride', point: { lat: 48.85, lon: 2.35 }, minutes: 120 });
    expect(await h.run('locatable', 'move', '%paris-velo', '--point', '48.84,2.42')).toBe(0);
    expect(await h.run('locatable', 'off', '%paris-velo')).toBe(0);
    expect(calls[2].variables).toMatchObject({ universe: '%paris-velo', locatable: false });
    expect(h.lines.at(-1)).toBe('stopped');
    expect(await h.run('locatable', 'residents', '%paris-velo', '--cells', '861fb4677ffffff')).toBe(0);
    expect(h.lines.at(-1)).toBe('%paris-velo  @me  Ride  88x  until later');
  });
  it('answers, changes and cancels a meet-up of a discussion', async () => {
    const meetUp = { title: 'Apéro', at: '2026-11-12T18:00:00Z', place: { name: 'Notre-Dame' }, cancelled: false, answers: [{ answer: 'ACCEPTED', account: { handle: 'me' } }] };
    const { h, calls } = scripted({ answerMeetUp: meetUp, changeMeetUp: meetUp, cancelMeetUp: { ...meetUp, cancelled: true } });
    expect(await h.run('meetups', 'answer', 'm1', 'ACCEPTED', '--group', 'g1')).toBe(0);
    expect(calls[0].variables).toMatchObject({ messageId: 'm1', answer: 'ACCEPTED', discussion: { groupChatId: 'g1' } });
    expect(h.lines.at(-1)).toBe('Apéro  2026-11-12T18:00:00Z  Notre-Dame\nanswers: @me ACCEPTED');
    expect(await h.run('meetups', 'change', 'm1', '--group', 'g1', '--at', '2026-11-12T18:00:00Z', '--point', '48.853,2.3499', '--place-name', 'Notre-Dame', '--title', 'Apéro')).toBe(0);
    expect(calls[1].variables).toMatchObject({ meetUp: { at: '2026-11-12T18:00:00Z', title: 'Apéro', place: { name: 'Notre-Dame', point: { lat: 48.853, lon: 2.3499 } } } });
    expect(await h.run('meetups', 'answer', 'm1', 'ACCEPTED', '--json')).toBe(2);
    expect(await h.run('--yes', 'meetups', 'cancel', 'm1', '--group', 'g1')).toBe(0);
    expect(h.lines.at(-1)).toContain('(cancelled)');
  });
  it('makes a nearby token, asks, answers and leaves', async () => {
    const req = { id: 'n1', status: 'WAITING', from: { handle: 'me' }, to: { handle: 'alice' }, expiresAt: 'later' };
    const { h, calls } = scripted({ createNearbyToken: { token: 'tok', expiresAt: 'later' }, requestNearbyConnection: req, nearbyRequests: [req], answerNearbyConnection: { ...req, status: 'ACCEPTED' }, leaveNearby: true, recordNearbySightings: [{ account: { handle: 'alice' }, label: 'Alice', closeness: 'NEAR', connected: false }] });
    expect(await h.run('nearby', 'token', '--quiet')).toBe(0);
    expect(h.lines.at(-1)).toBe('tok');
    expect(await h.run('nearby', 'request', 'tok')).toBe(0);
    expect(h.lines.at(-1)).toBe('n1  WAITING  from @me to @alice  until later');
    expect(await h.run('nearby', 'requests')).toBe(0);
    expect(await h.run('nearby', 'accept', 'n1')).toBe(0);
    expect(await h.run('nearby', 'decline', 'n1')).toBe(0);
    expect(calls.filter((c) => c.field === 'answerNearbyConnection').map((c) => c.variables.accept)).toEqual([true, false]);
    expect(await h.run('nearby', 'sightings', '--sightings', '[{"token":"tok","closeness":"NEAR"}]')).toBe(0);
    expect(h.lines.at(-1)).toBe('@alice  Alice  NEAR');
    expect(await h.run('nearby', 'leave')).toBe(0);
    expect(h.lines.at(-1)).toBe('done');
  });
  it('places a post at a point or a place, or removes its place', async () => {
    const { h, calls } = scripted({ setPostPlace: (v: Record<string, unknown>) => ({ id: 'p1', place: v.place ? { name: 'Canal' } : null }) });
    expect(await h.run('posts', 'place', 'p1', '--point', '48.87,2.36')).toBe(0);
    expect(calls[0].variables).toMatchObject({ postId: 'p1', place: { point: { lat: 48.87, lon: 2.36 } } });
    expect(h.lines.at(-1)).toBe('p1: placed at Canal');
    expect(await h.run('posts', 'place', 'p1', '--place-id', 'osm:1')).toBe(0);
    expect(calls[1].variables).toMatchObject({ place: { placeId: 'osm:1' } });
    expect(await h.run('posts', 'place', 'p1', '--remove')).toBe(0);
    expect(calls[2].variables).toMatchObject({ postId: 'p1', place: null });
    expect(h.lines.at(-1)).toBe('p1: no place');
    expect(await h.run('posts', 'place', 'p1', '--remove', '--point', '1,2', '--json')).toBe(2);
  });
});
