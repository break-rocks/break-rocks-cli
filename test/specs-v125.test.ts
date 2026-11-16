// Specs v125.0.0: one map marker per place (D-393, D-395) and the data requests to confirm (D-394).
// Against a scripted API (no network).
import { describe, expect, it } from 'vitest';
import { scripted } from './scripted.js';

describe('one map marker per place', () => {
  const post = { postId: 'p1', authorId: 'a1', universe: '%paris', createdAt: 't', foldedPlaceId: 'pl1', place: { name: 'Louvre', mapCell: '88x' } };
  it('prints the place a placed post is folded in, the folded counts of the places with a place feat, and the section "Also here" of a place card', async () => {
    const { h, calls } = scripted({
      mapPosts: [post, { ...post, postId: 'p2', foldedPlaceId: null }],
      mapPlaceFeats: [{ place: { placeId: 'pl1', name: 'Louvre' }, publishedCount: 2, liveliness: 'LIVELY', foldedCount: 5, foldedVideoCount: 3, foldedClipCount: 1 }],
      placeCard: { placeId: 'pl1', name: 'Louvre', point: { lat: 48.86, lon: 2.34 }, address: 'Rue de Rivoli, 75001 Paris', contents: [{ kind: 'EVENTS', event: { id: 'e1' } }], alsoHere: [{ kind: 'POSTS', post }] },
    });
    expect(await h.run('map', 'posts', '--cells', '861fb4677ffffff')).toBe(0);
    expect(h.lines.at(-1)).toBe('p1  t  %paris  Louvre  by a1  folded in pl1\np2  t  %paris  Louvre  by a1');
    expect(calls.at(-1)!.query).toContain('foldedPlaceId');
    expect(await h.run('map', 'place-feats', '--cells', '861fb4677ffffff', '--universe', '%paris')).toBe(0);
    expect(calls.at(-1)!.variables).toEqual({ parentMapCells: ['861fb4677ffffff'], universe: '%paris' });
    for (const f of ['foldedCount', 'foldedVideoCount', 'foldedClipCount']) expect(calls.at(-1)!.query).toContain(f);
    expect(h.lines.at(-1)).toBe('pl1  Louvre  2 feat(s)  LIVELY  folded 5  videos 3  clips 1');
    expect(await h.run('map', 'place-card', 'pl1')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'placeCard', variables: { placeId: 'pl1' } });
    expect(calls.at(-1)!.query).toContain('alsoHere');
    expect(h.lines.at(-1)).toBe('pl1  Louvre  48.86,2.34  Rue de Rivoli, 75001 Paris\ncontents (1)\n  EVENTS  e1\nalso here (1)\n  POSTS  p1  t  %paris  Louvre  by a1  folded in pl1');
    expect(await h.run('map', 'place-card', '--help')).toBe(0);
    expect(h.lines.at(-1)).toContain('API: placeCard');
  });
});

describe('the data requests to confirm', () => {
  const awaiting = { id: 'd1', kind: 'DATA_COPY', status: 'AWAITING_CONFIRMATION', requestedAt: 'r', dueAt: 'due', confirmBy: '2026-12-16T00:00:00.000Z' };
  it('prints confirm by and NOT_CONFIRMED, and confirms a data request', async () => {
    const { h, calls } = scripted({ myDataRequests: { items: [awaiting, { ...awaiting, id: 'd2', status: 'NOT_CONFIRMED' }], next: null }, confirmDataRequest: { ...awaiting, status: 'READY', confirmBy: null } });
    expect(await h.run('me', 'data', 'requests')).toBe(0);
    expect(calls.at(-1)!.query).toContain('confirmBy');
    expect(h.lines.at(-1)).toContain('d1  DATA_COPY  AWAITING_CONFIRMATION  asked r  due due  confirm by 2026-12-16T00:00:00.000Z');
    expect(h.lines.at(-1)).toContain('d2  DATA_COPY  NOT_CONFIRMED  asked r  due due  confirm by 2026-12-16T00:00:00.000Z  not confirmed: closed without running');
    expect(await h.run('me', 'data', 'confirm', 'd1', '--yes')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'confirmDataRequest', variables: { dataRequestId: 'd1' } });
    expect(h.lines.at(-1)).toBe('d1  DATA_COPY  READY  asked r  due due');
  });
});
