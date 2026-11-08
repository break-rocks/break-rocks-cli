// Specs v85.8.0 and v86.0.0: why a post is recommended, universes muted from discovery, the reset of the
// recommendations, and the resolution of an address. Against a scripted API.
import { describe, expect, it } from 'vitest';
import { scripted } from './scripted.js';

describe('discovery', () => {
  it('explains a recommendation, mutes and unmutes a universe, lists them, resets only with yes', async () => {
    const { h, calls } = scripted({ whyRecommended: { reason: 'AFFINITY', affinities: [], adProfileUsed: false }, muteUniverseDiscovery: { universe: '%paris-foot', since: 'now' }, unmuteUniverseDiscovery: true, myMutedUniverses: [{ universe: '%paris-foot', since: 'now' }], resetRecommendations: {} });
    expect(await h.run('explore', 'why', 'p1', '--json')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'whyRecommended', variables: { postId: 'p1' } });
    expect(await h.run('explore', 'mute', '%paris-foot')).toBe(0);
    expect(h.lines.at(-1)).toBe('%paris-foot muted from discovery since now');
    expect(await h.run('explore', 'muted')).toBe(0);
    expect(h.lines.at(-1)).toBe('%paris-foot  since now');
    expect(await h.run('explore', 'unmute', '%paris-foot')).toBe(0);
    expect(await h.run('explore', 'reset', '--json')).toBe(2);
    expect(await h.run('--yes', 'explore', 'reset')).toBe(0);
    expect(calls.at(-1)!.field).toBe('resetRecommendations');
  });
  it('resolves an address to its object and its parameters', async () => {
    const { h, calls } = scripted({ resolveAddress: { address: '@erin>journey', url: 'https://break.rocks/@erin>journey', parameters: [{ key: 't', value: '90' }], playlist: { id: 'pl1', name: 'journey' }, universeEvent: null, mapRoute: null } });
    expect(await h.run('resolve', '@erin>journey?t=90')).toBe(0);
    expect(calls[0].variables).toEqual({ address: '@erin>journey?t=90' });
    expect(h.lines.at(-1)).toBe('@erin>journey  https://break.rocks/@erin>journey\nt=90\nplaylist pl1  journey');
  });
});
