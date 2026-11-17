// Specs v129.1.0 (D-411): My places: the saved items, the My places tags, sharing as a playlist of the form MAP, "In common",
// the whole of My places deleted, the refusals of a delegated agent, a backend before v129.1.0. Against a scripted API.
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { latLngToCell } from '../src/h3.js';
import { commands } from '../src/registry.js';
import { saveSession } from '../src/session.js';
import { harness, last } from './helpers.js';

type Call = { field: string; variables: Record<string, unknown>; query: string };
/** A fake API: [answers] by field (a function gets the variables), [errors] by field. */
function fake(answers: Record<string, unknown>, errors: Record<string, { errorType?: string; message: string; errorInfo?: unknown }> = {}) {
  const calls: Call[] = [];
  const h = harness({
    env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1' },
    fetch: async (_url, init) => {
      const { query, variables } = JSON.parse(String(init!.body));
      const field = /\{\s*(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      calls.push({ field, query, variables });
      if (errors[field]) return Response.json({ data: { [field]: null }, errors: [errors[field]] });
      const answer = answers[field];
      return Response.json({ data: { [field]: typeof answer === 'function' ? answer(variables) : answer ?? null } });
    },
  });
  saveSession(new Context(h.io, NO_FLAGS), { kind: 'agent', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op', agentId: 'ag' });
  return { h, calls };
}

const tags = [
  { id: 'tg1', name: 'to-try', color: 'AUBERGINE', starter: 'TO_TRY', itemCount: 3, playlist: null },
  { id: 'tg2', name: 'done', color: 'FOREST', starter: 'DONE', itemCount: 1, playlist: { id: 'pl9', address: '@me>done', name: 'Done', visibility: 'PUBLIC' } },
  { id: 'tg3', name: 'bakeries', color: 'MUSTARD', starter: null, itemCount: 0, playlist: null },
];
const item = (over: Record<string, unknown> = {}) => ({ id: 'si1', kind: 'PLACE', targetId: 'pl-1', exists: true, name: 'Chez Odile', point: { lat: 48.85, lon: 2.35 }, mapCell: '891fb46', endsAt: null, doneAt: null, tags: [{ id: 'tg1', name: 'to-try', color: 'AUBERGINE' }], note: 'Ask for the rye', savedAt: '2026-11-17T10:00:00.000Z', ...over });
const cell = latLngToCell(48.85, 2.35, 9);

describe('the saved items', () => {
  it('lists them (a tag by its name, the cells checked), then follows the pages with --all', async () => {
    const { h, calls } = fake({ myPlacesTags: tags, myPlaces: (v: { after: string | null }) => (v.after ? { items: [item({ id: 'si2', kind: 'ROUTE', exists: false, name: null, point: null, tags: [], note: '', doneAt: '2026-11-10T09:00:00.000Z' })], next: null, total: 2 } : { items: [item()], next: 'n2', total: 2 }) });
    expect(await h.run('my-places', 'list', '--tag', '#to-try')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['myPlacesTags', 'myPlaces']);
    expect(calls[1].variables).toMatchObject({ tagId: 'tg1' });
    expect(h.lines.at(-1)).toBe('2 saved items\nsi1  PLACE  Chez Odile  48.85,2.35  #to-try  note: "Ask for the rye"\nnext: n2');
    expect(await h.run('my-places', 'list', '--all', '--cells', cell)).toBe(0);
    expect(calls.at(-1)!.variables).toMatchObject({ mapCells: [cell], after: 'n2' });
    expect(h.lines.at(-1)).toBe('2 saved items\nsi1  PLACE  Chez Odile  48.85,2.35  #to-try  note: "Ask for the rye"\nsi2  ROUTE  no longer exists (pl-1)  done on 2026-11-10');
    expect(await h.run('my-places', 'list', '--cells', '861fb4677ffffff,891fb4677ffffff', '--json')).toBe(2);
    expect(await h.run('my-places', 'list', '--cells', 'zz', '--json')).toBe(2);
  });
  it('compares only playlists, by address or id: "In common"', async () => {
    const { h, calls } = fake({ playlist: { id: 'pl-erin' }, myPlaces: { items: [], next: null, total: 0 } });
    expect(await h.run('my-places', 'list', '--in-common', '@erin>places', '--in-common', 'pl-2')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'myPlaces', variables: { inCommonPlaylistIds: ['pl-erin', 'pl-2'] } });
    expect(h.lines.at(-1)).toBe('(none)');
  });
  it('reads whether a thing is saved', async () => {
    const { h, calls } = fake({ mySavedItem: null });
    expect(await h.run('my-places', 'show', 'PLACE', 'pl-1')).toBe(0);
    expect(calls[0].variables).toEqual({ kind: 'PLACE', targetId: 'pl-1' });
    expect(h.lines.at(-1)).toBe('(not saved)');
  });
  it('saves with tags by name and a note, changes them, removes one', async () => {
    const { h, calls } = fake({ myPlacesTags: tags, saveToMyPlaces: item(), updateSavedItem: item({ tags: [] }), removeSavedItem: true });
    expect(await h.run('my-places', 'save', 'PLACE', 'pl-1', '--tags', 'to-try', '--tags', 'DONE', '--note', 'Ask for the rye')).toBe(0);
    const save = calls.find((c) => c.field === 'saveToMyPlaces')!;
    expect(save.variables).toMatchObject({ input: { kind: 'PLACE', targetId: 'pl-1', tagIds: ['tg1', 'tg2'], note: 'Ask for the rye' } });
    expect(save.variables.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await h.run('my-places', 'save', 'PLACE', 'pl-1', '--dry-run', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ dryRun: true, operation: 'saveToMyPlaces', variables: { input: { kind: 'PLACE', targetId: 'pl-1' } } });
    expect(await h.run('my-places', 'save', 'POST', 'p1', '--json')).toBe(2);
    expect(await h.run('my-places', 'edit', 'si1', '--clear-tags', '--note', '')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'updateSavedItem', variables: { itemId: 'si1', input: { tagIds: [], note: '' } } });
    expect(await h.run('my-places', 'edit', 'si1', '--clear-tags', '--tags', 'done', '--json')).toBe(2);
    expect(await h.run('my-places', 'remove', 'si1')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'removeSavedItem', variables: { itemId: 'si1' } });
    expect(h.lines.at(-1)).toMatch(/done/);
  });
  it('deletes the whole of My places only once confirmed with --yes', async () => {
    const { h, calls } = fake({ clearMyPlaces: true });
    expect(await h.run('my-places', 'clear')).toBe(2);
    expect(h.errors.join('\n')).toMatch(/CONFIRMATION_REQUIRED.*Pass --yes/s);
    expect(calls).toEqual([]);
    expect(await h.run('my-places', 'clear', '--yes')).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ field: 'clearMyPlaces' });
  });
});

describe('the My places tags', () => {
  it('lists, creates, renames and deletes them, by name or by id', async () => {
    const { h, calls } = fake({ myPlacesTags: tags, createMyPlacesTag: tags[2], updateMyPlacesTag: tags[2], deleteMyPlacesTag: true });
    expect(await h.run('my-places', 'tags')).toBe(0);
    expect(h.lines.at(-1)).toBe([
      'tg1  #to-try  aubergine  3 saved items  starter TO_TRY', 'tg2  #done  forest  1 saved item  starter DONE  shared as @me>done (public)', 'tg3  #bakeries  mustard  0 saved items',
    ].join('\n'));
    expect(await h.run('my-places', 'tags', 'create', '#bakeries', '--color', 'MUSTARD')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'createMyPlacesTag', variables: { name: 'bakeries', color: 'MUSTARD' } });
    expect(await h.run('my-places', 'tags', 'edit', 'bakeries', '--name', '#pastry', '--color', 'LAGOON')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'updateMyPlacesTag', variables: { tagId: 'tg3', name: 'pastry', color: 'LAGOON' } });
    expect(await h.run('my-places', 'tags', 'delete', 'tg3')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'deleteMyPlacesTag', variables: { tagId: 'tg3' } });
  });
});

describe('sharing as a playlist of the form MAP', () => {
  const playlist = { id: 'pl9', address: '@me>bakeries', name: 'Bakeries', form: 'MAP', visibility: 'PUBLIC', itemCount: 4 };
  it('shares a tag at once, the whole of My places only with --yes, and reads whether it is shared', async () => {
    const { h, calls } = fake({ myPlacesTags: tags, shareMyPlaces: playlist, myPlacesPlaylist: null });
    expect(await h.run('my-places', 'share', 'Bakeries', '--tag', 'bakeries', '--visibility', 'PUBLIC')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'shareMyPlaces', variables: { tagId: 'tg3', name: 'Bakeries', visibility: 'PUBLIC' } });
    expect(h.lines.at(-1)).toBe('@me>bakeries  Bakeries  MAP  public  4 saved items');
    const before = calls.length;
    expect(await h.run('my-places', 'share', 'All')).toBe(2);
    expect(h.errors.join('\n')).toMatch(/What you save later is shared too/);
    expect(calls).toHaveLength(before);
    expect(await h.run('my-places', 'share', 'All', '--dry-run')).toBe(0);
    expect(await h.run('my-places', 'share', 'All', '--yes')).toBe(0);
    expect(calls.at(-1)!.variables).not.toHaveProperty('tagId');
    expect(await h.run('my-places', 'shared')).toBe(0);
    expect(h.lines.at(-1)).toBe('(the whole of My places is not shared)');
    expect(await h.run('schema', 'my-places', 'share', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ mcpTool: 'breakrocks_my_places_share' });
  });
  it('reads the saved items of a playlist as the reader may, "In common" included, and follows the pages', async () => {
    const page = (v: { n: string | null }) => ({ id: 'pl9', address: '@erin>places', name: 'Places', form: 'MAP', visibility: 'PUBLIC', itemCount: 2, mapItems: v.n ? { items: [{ kind: 'ROUTE', targetId: 'r1', name: 'Canal run', point: null, inCommon: false }], next: null, total: 2 } : { items: [{ kind: 'PLACE', targetId: 'pl-1', name: 'Chez Odile', point: { lat: 48.85, lon: 2.35 }, inCommon: true }], next: 'n2', total: 2 } });
    const { h, calls } = fake({ playlist: page });
    expect(await h.run('my-places', 'playlist', '@erin>places', '--in-common', '--all')).toBe(0);
    expect(calls[0].variables).toMatchObject({ a: '@erin>places', c: true });
    expect(calls).toHaveLength(2);
    expect(h.lines.at(-1)).toBe('@erin>places  Places  2 saved items\nPLACE  Chez Odile  pl-1  48.85,2.35  in common\nROUTE  Canal run  r1');
    expect(await h.run('my-places', 'playlist', 'pl9', '--json')).toBe(2);
    const other = fake({ playlist: { id: 'p', address: '@erin>j', name: 'J', form: 'SIMPLE', mapItems: null } });
    expect(await other.h.run('my-places', 'playlist', '@erin>j')).toBe(0);
    expect(other.h.lines.at(-1)).toMatch(/not a playlist of the form MAP/);
  });
});

describe('the refusals', () => {
  it('tells what a delegated agent may not do, with the code of the platform', async () => {
    const notAllowed = { errorType: 'DELEGATED_AGENT_NOT_ALLOWED', message: 'DELEGATED_AGENT_NOT_ALLOWED' };
    const { h } = fake({ myPlacesTags: tags }, { shareMyPlaces: notAllowed, clearMyPlaces: notAllowed, deleteMyPlacesTag: notAllowed, saveToMyPlaces: notAllowed });
    expect(await h.run('my-places', 'share', 'Bakeries', '--tag', 'bakeries', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'DELEGATED_AGENT_NOT_ALLOWED', source: 'platform', message: expect.stringMatching(/never shares My places of its human.*Ask your human/) } });
    expect(await h.run('my-places', 'clear', '--yes', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'DELEGATED_AGENT_NOT_ALLOWED', message: expect.stringMatching(/never deletes the whole of My places/) } });
    expect(await h.run('my-places', 'tags', 'delete', 'bakeries', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'DELEGATED_AGENT_NOT_ALLOWED', message: expect.stringMatching(/shared playlist/) } });
    expect(await h.run('my-places', 'save', 'PLACE', 'pl-1', '--tags', 'bakeries')).toBe(1);
    expect(h.errors.join('\n')).toMatch(/DELEGATED_AGENT_NOT_ALLOWED/);
  });
  it('maps the codes of My places, with the sentence of the platform or ours', async () => {
    const { h } = fake({}, { myPlaces: { errorType: 'MY_PLACES_NOT_OPEN', message: 'MY_PLACES_NOT_OPEN' }, saveToMyPlaces: { errorType: 'MY_PLACES_FULL', message: 'My places holds 5,000 saved items at most', errorInfo: { max: 5000 } } });
    expect(await h.run('my-places', 'list', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'MY_PLACES_NOT_OPEN', message: expect.stringMatching(/not open on this platform yet/) } });
    expect(await h.run('my-places', 'save', 'ROUTE', 'r1', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'MY_PLACES_FULL', errorInfo: { max: 5000 } } });
  });
  it('says clearly that a backend before v129.1.0 does not serve it', async () => {
    const { h } = fake({}, { myPlaces: { message: "Validation error of type FieldUndefined: Field 'myPlaces' in type 'Query' is undefined" } });
    expect(await h.run('my-places', 'list', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'OPERATION_NOT_SERVED', what: 'My places' } });
    expect(h.errors.join('\n')).not.toMatch(/\bat \w+ \(/);
  });
});

describe('the registry', () => {
  it('has a command and a tool for every operation; the deletions and the whole share ask a confirmation', async () => {
    const mine = commands().filter((c) => c.name.startsWith('my-places'));
    const ops = ['myPlaces', 'mySavedItem', 'saveToMyPlaces', 'updateSavedItem', 'removeSavedItem', 'clearMyPlaces', 'myPlacesTags', 'createMyPlacesTag', 'updateMyPlacesTag', 'deleteMyPlacesTag', 'shareMyPlaces', 'myPlacesPlaylist'];
    expect(ops.filter((o) => !mine.some((c) => c.api === o))).toEqual([]);
    expect(mine.filter((c) => c.interactive).map((c) => c.name)).toEqual(['my-places clear', 'my-places share']);
    const { h } = fake({});
    expect(await h.run('schema', 'my-places', 'clear', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ mcpTool: 'breakrocks_my_places_clear', interactive: true });
    expect(await h.run('my-places', 'clear', '--help')).toBe(0);
    expect(h.lines.at(-1)).toMatch(/--yes/);
  });
});
