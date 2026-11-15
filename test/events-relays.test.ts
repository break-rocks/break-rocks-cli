// Specs v122.0.0 to v122.2.0: the map of Explore choice of a universe event, the relay of a universe event in another universe, the
// event catalog, who sees a resident by name among the present residents of a universe discussion, the vote lent and its holder.
// Against a scripted API.
import { describe, expect, it } from 'vitest';
import { scripted } from './scripted.js';

const relay = { id: 'r1', universe: 'paris', status: 'PROPOSED', supports: 2, supportsNeeded: 5, mySupport: true, expiresAt: '2026-11-22T10:00:00.000Z', visible: true, proposedBy: { handle: 'alice' }, event: { id: 'e1', title: 'Night ride', startsAt: '2026-11-20T19:00:00.000Z' } };

describe('the map of Explore choice of a universe event (--explore-map)', () => {
  it('is sent as exploreMapChoice by events create and events change; left out otherwise', async () => {
    const { h, calls } = scripted({ createUniverseEvent: { id: 'e1' }, changeUniverseEvent: { id: 'e1' } });
    const create = ['events', 'create', '%paris', '--title', 'Picnic', '--starts-at', '2026-11-01T12:00:00Z', '--minutes', '60', '--tags', 'parc'];
    expect(await h.run(...create, '--explore-map', 'shown')).toBe(0);
    expect(calls[0].variables).toMatchObject({ input: { universe: '%paris', exploreMapChoice: 'SHOWN' } });
    expect(await h.run(...create, '--explore-map', 'by-type')).toBe(0);
    expect(calls[1].variables).toMatchObject({ input: { exploreMapChoice: 'BY_TYPE' } });
    expect(await h.run(...create)).toBe(0);
    expect((calls[2].variables.input as Record<string, unknown>).exploreMapChoice).toBeUndefined();
    expect(await h.run('events', 'change', 'e1', '--explore-map', 'kept')).toBe(0);
    expect(calls[3].variables).toMatchObject({ input: { eventId: 'e1', exploreMapChoice: 'KEPT' } });
    expect(await h.run('events', 'change', 'e1', '--explore-map', 'everywhere', '--json')).toBe(2);
  });
  it('events list asks for the choice, whether it is on the map and the relays, and shows them', async () => {
    const { h, calls } = scripted({ universeEvents: [{ id: 'e1', title: 'Night ride', onExploreMap: true, exploreMapChoice: 'SHOWN', relayedIn: ['lyon'], relay: null }] });
    expect(await h.run('events', 'list', '%paris')).toBe(0);
    for (const field of ['onExploreMap', 'exploreMapChoice', 'relayedIn', 'relay']) expect(calls[0].query).toContain(field);
    expect(h.lines.join('\n')).toMatch(/onExploreMap: true[\s\S]*exploreMapChoice: SHOWN[\s\S]*relayedIn: lyon/);
  });
});

describe('the relay of a universe event', () => {
  it('relays an event in a universe (--in required); tells its status, its supports and when it ends', async () => {
    const { h, calls } = scripted({ relayUniverseEvent: relay });
    expect(await h.run('events', 'relay', 'e1', '--json')).toBe(2);
    expect(await h.run('events', 'relay', 'e1', '--in', '%paris')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'relayUniverseEvent', variables: { eventId: 'e1', universe: '%paris' } });
    expect(calls[0].variables.requestId).toEqual(expect.any(String));
    expect(h.lines.at(-1)).toBe('r1  %paris  PROPOSED  2/5 supports (yours), until 2026-11-22T10:00:00.000Z  by @alice  event e1  2026-11-20T19:00:00.000Z  Night ride');
  });
  it('--dry-run sends nothing', async () => {
    const { h, calls } = scripted();
    expect(await h.run('events', 'relay', 'e1', '--in', '%paris', '--dry-run')).toBe(0);
    expect(calls).toHaveLength(0);
  });
  it('supports a proposal, by the relay id', async () => {
    const { h, calls } = scripted({ supportEventRelay: { ...relay, status: 'ACTIVE', supports: 5, expiresAt: null, proposedBy: null } });
    expect(await h.run('events', 'relay', 'support', 'r1')).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ field: 'supportEventRelay', variables: { relayId: 'r1' } });
    expect(h.lines.at(-1)).toMatch(/^r1  %paris  ACTIVE  event e1/);
  });
  it('removes a relay after a confirmation (--yes)', async () => {
    const { h, calls } = scripted({ removeEventRelay: true });
    expect(await h.run('events', 'relay', 'remove', 'r1', '--json')).toBe(2);
    expect(calls).toHaveLength(0);
    expect(await h.run('events', 'relay', 'remove', 'r1', '--yes')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'removeEventRelay', variables: { relayId: 'r1' } });
    expect(h.lines.at(-1)).toBe('done');
  });
  it('lists the proposals of a universe, followed to their end with --all', async () => {
    const pages = [{ items: [relay], next: 'c1' }, { items: [{ ...relay, id: 'r2', supports: 4, mySupport: false }], next: null }];
    const { h, calls } = scripted({ eventRelayProposals: (v: Record<string, unknown>) => (v.after === 'c1' ? pages[1] : pages[0]) });
    expect(await h.run('events', 'relays', 'proposals', '%paris')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'eventRelayProposals', variables: { universe: '%paris' } });
    expect(h.lines.at(-1)).toMatch(/\nnext: c1$/);
    expect(await h.run('events', 'relays', 'proposals', '%paris', '--all')).toBe(0);
    expect(calls.slice(1).map((c) => c.variables.after ?? null)).toEqual([null, 'c1']);
    expect(h.lines.join('\n')).toContain('r2  %paris  PROPOSED  4/5 supports');
  });
});

describe('the event catalog', () => {
  it('tells the event types on the map of Explore', async () => {
    const { h, calls } = scripted({ eventCatalog: { updatedAt: '2026-11-15T00:00:00.000Z', families: [{ key: 'sport', name: 'Sport', iconUrl: 'https://x/i.svg', types: [{ key: 'running', name: 'Running', onExploreMap: true, sensitive: false }, { key: 'quiz', name: 'Quiz', onExploreMap: false, sensitive: false }] }] } });
    expect(await h.run('events', 'catalog', '--language', 'fr')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'eventCatalog', variables: { language: 'fr' } });
    expect(calls[0].query).toContain('onExploreMap');
    expect(h.lines.join('\n')).toBe('sport  Sport\n  running  Running  on the map of Explore\n  quiz  Quiz  in its universe');
    expect(await h.run('events', 'catalog')).toBe(0);
    expect(calls[1].variables.language).toBe('en');
  });
});

describe('the named presence', () => {
  it('chooses who sees the account by name, in a universe or everywhere', async () => {
    const { h, calls } = scripted({ setPresenceVisibility: (v: Record<string, unknown>) => v.visibility });
    expect(await h.run('settings', 'presence', 'hidden', '--in', '%paris')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'setPresenceVisibility', variables: { visibility: 'HIDDEN', universe: '%paris' } });
    expect(h.lines.at(-1)).toBe('presence visible to: hidden');
    expect(await h.run('settings', 'presence', 'connections')).toBe(0);
    expect(calls[1].variables).toMatchObject({ visibility: 'CONNECTIONS' });
    expect(calls[1].variables.universe).toBeUndefined();
    expect(await h.run('settings', 'presence', 'everyone', '--dry-run')).toBe(0);
    expect(calls).toHaveLength(2);
    expect(await h.run('settings', 'presence', 'nobody', '--json')).toBe(2);
    expect(await h.run('settings', 'presence', '--json')).toBe(2);
  });
  it('reads the presence choice made everywhere (settings presence show), none when there is no choice', async () => {
    const { h, calls } = scripted({ mySettings: { presenceVisibility: 'CONNECTIONS' } });
    expect(await h.run('settings', 'presence', 'show')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'mySettings' });
    expect(calls[0].query).toContain('presenceVisibility');
    expect(h.lines.at(-1)).toBe('presence visible to: connections');
    expect(await h.run('settings', 'presence', 'show', '--json')).toBe(0);
    expect(h.values.at(-1)).toEqual({ presenceVisibility: 'CONNECTIONS' });
    const none = scripted({ mySettings: { presenceVisibility: null } });
    expect(await none.h.run('settings', 'presence', 'show')).toBe(0);
    expect(none.h.lines.at(-1)).toBe('presence visible to: none');
    expect(await none.h.run('settings', 'presence', 'show', '--json')).toBe(0);
    expect(none.h.values.at(-1)).toEqual({ presenceVisibility: null });
  });
  it('reads the present residents of a discussion by its address or its id', async () => {
    const { h, calls } = scripted({ universeDiscussion: { id: 'd1' }, universeDiscussionPresent: [{ account: { id: 'a1', handle: 'alice', displayName: 'Alice' }, connected: true, role: 'MODERATOR' }, { account: { id: 'a2', handle: 'bob', displayName: 'Bob' }, connected: false, role: null }] });
    expect(await h.run('discussions', 'present', '%paris&general')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['universeDiscussion', 'universeDiscussionPresent']);
    expect(calls[1].variables).toMatchObject({ id: 'd1' });
    expect(h.lines.join('\n')).toBe('a1  @alice  Alice  MODERATOR  connected\na2  @bob  Bob');
    expect(await h.run('discussions', 'present', 'd9')).toBe(0);
    expect(calls.at(-1)!.variables).toMatchObject({ id: 'd9' });
  });
  it('shows the presence visibility in a universe standing (capabilities --universe)', async () => {
    const { h, calls } = scripted({ universe: { name: '%paris', exists: true }, myStandingIn: { presenceVisibility: 'CONNECTIONS', residence: null } });
    expect(await h.run('capabilities', '--universe', '%paris', '--json')).toBe(0);
    expect(calls.some((c) => c.query.includes('presenceVisibility'))).toBe(true);
    expect(JSON.stringify(h.values.at(-1))).toContain('"presenceVisibility":"CONNECTIONS"');
  });
});

describe('a vote lent', () => {
  it('proposals show asks for myHolderBallot and shows it', async () => {
    const { h, calls } = scripted({ proposal: { id: 'p1', title: 'A bench', myBallot: null, myHolderBallot: 'NOT_CAST' } });
    expect(await h.run('proposals', 'show', 'p1')).toBe(0);
    expect(calls[0].query).toContain('myHolderBallot');
    expect(h.lines.join('\n')).toContain('myHolderBallot: NOT_CAST');
  });
});
