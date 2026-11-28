// Specs v122.3.0 (D-386): the tabs of the long videos, their history (list, remove, clear, pause), hasLongVideos on a
// universe, and the way a long video is sent (in parts above 500 MB: native-sulfur's upload, sulfur tests). The API is
// scripted.
import { truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { MULTIPART_MIN_BYTES } from '../src/multipart.js';
import { harness, last, sulfurSession, sulfurError } from './helpers.js';

type Call = { field: string; query: string; variables: Record<string, unknown> };
type Handler = (variables: Record<string, unknown>, n: number) => unknown;

/** A harness signed in as a delegated agent; the API answers by the first field of each request (a Handler, or a value); other URLs go to [other]. */
function scripted(handlers: Record<string, Handler | unknown>, other?: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  const h = harness({
    env: { BREAKROCKS_SULFUR_URL: 'https://api.test' },
    fetch: async (url, init) => {
      if (String(url) !== 'https://api.test/graphql') {
        if (!other) throw new Error(`no network in tests: ${String(url)}`);
        return other(String(url), init ?? {});
      }
      const { query, variables } = JSON.parse(String(init!.body));
      const field = /\{\s*(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      calls.push({ field, query, variables });
      counts[field] = (counts[field] ?? 0) + 1;
      const handler = handlers[field];
      try {
        const data = typeof handler === 'function' ? (handler as Handler)(variables, counts[field]) : handler;
        return Response.json({ data: { [field]: data === undefined ? { id: 'x' } : data } });
      } catch (e) { return Response.json({ data: null, errors: [sulfurError({ errorType: (e as Error).message, message: 'refused' })] }); }
    },
  });
  sulfurSession(h.io, 'agent');
  return { h, calls, ctx: new Context(h.io, NO_FLAGS) };
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MP4_HEAD = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);

describe('videos list --tab', () => {
  it('asks the tab For you or Following of the long videos, without an address', async () => {
    const { h, calls } = scripted({ longVideos: { items: [{ id: 'p1', createdAt: '2026-11-01T10:00:00.000Z', author: { handle: 'erin' }, universe: '%paris', text: 'The match' }], next: null } });
    expect(await h.run('videos', 'list', '--tab', 'for-you', '--json')).toBe(0);
    expect(calls[0].variables).toMatchObject({ tab: 'FOR_YOU' });
    expect(calls[0].query).toContain('$tab: LongVideosTab');
    expect(await h.run('videos', 'list', '--tab', 'following', '--json')).toBe(0);
    expect(calls[1].variables).toMatchObject({ tab: 'FOLLOWING' });
    expect(await h.run('videos', 'list', '%paris', '--json')).toBe(0);
    expect(calls[2].variables.tab).toBeUndefined();
    expect(await h.run('videos', 'list', '--tab', 'FOR_YOU', '--json')).toBe(2);
    expect(await h.run('videos', 'list', '--tab', 'trending', '--json')).toBe(2);
    expect(calls).toHaveLength(3);
  });
});

describe('the history of the long videos', () => {
  const entry = (id: string) => ({ positionSeconds: 3725, watchedAt: '2026-11-14T20:00:00.000Z', post: { id, createdAt: '2026-11-01T10:00:00.000Z', author: { handle: 'erin' }, universe: '%paris', text: 'The whole match' } });
  it('lists the entries, follows the pages with --all and tells when it is paused', async () => {
    const { h, calls } = scripted({ videoHistory: (v: Record<string, unknown>) => (v.after ? { items: [entry('p2')], next: null, paused: true } : { items: [entry('p1')], next: 'c1', paused: true }) });
    expect(await h.run('videos', 'history', '--limit', '1')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'videoHistory', variables: { limit: 1 } });
    expect(h.lines.join('\n')).toBe('p1  2026-11-14T20:00:00.000Z  at 1:02:05  @erin  %paris  The whole match\nnext: c1\n(the history is paused: nothing new is kept)');
    for (const f of ['positionSeconds', 'watchedAt', 'paused']) expect(calls[0].query).toContain(f);
    expect(await h.run('videos', 'history', '--all', '--json')).toBe(0);
    expect(calls.slice(1).map((c) => c.variables.after ?? null)).toEqual([null, 'c1']);
    expect((last<{ items: { post: { id: string } }[] }>(h)).items.map((i) => i.post.id)).toEqual(['p1', 'p2']);
    expect(await h.run('videos', 'history', '--limit', 'ten', '--json')).toBe(2);
  });
  it('removes one, clears all only with yes, and nothing is sent by --dry-run', async () => {
    const { h, calls } = scripted({ removeFromVideoHistory: true });
    expect(await h.run('videos', 'history', 'remove', 'p1')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'removeFromVideoHistory', variables: { postId: 'p1' } });
    expect(String(calls[0].variables.requestId)).toMatch(UUID_V7);
    expect(await h.run('videos', 'history', 'remove', '--json')).toBe(2);
    expect(await h.run('videos', 'history', 'clear', '--json')).toBe(2);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('CONFIRMATION_REQUIRED');
    expect(await h.run('videos', 'history', 'clear', '--dry-run', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ dryRun: true, operation: 'removeFromVideoHistory' });
    expect(calls).toHaveLength(1);
    expect(await h.run('videos', 'history', 'clear', '--yes', '--json')).toBe(0);
    expect(calls[1].field).toBe('removeFromVideoHistory');
    expect(calls[1].variables.postId).toBeUndefined();
  });

});

describe('universes show', () => {
  it('tells whether the long videos mode is offered (hasLongVideos)', async () => {
    const { h, calls } = scripted({ universe: { name: '%paris', hasLongVideos: true }, universeGovernance: null });
    expect(await h.run('universes', 'show', '%paris')).toBe(0);
    expect(calls[0].query).toContain('hasLongVideos');
    expect(h.lines[0]).toContain('long videos mode: offered');
  });
});

describe('post --long-video', () => {
  it('tells the way of the upload in --dry-run: in parts above 500 MB', async () => {
    const { h } = scripted({});
    const file = join(h.dir, 'big.mp4'); writeFileSync(file, MP4_HEAD); truncateSync(file, MULTIPART_MIN_BYTES);
    expect(await h.run('post', 'The match', '--in', '%paris', '--long-video', 'big.mp4', '--dry-run', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ longVideo: { file: 'big.mp4', bytes: MULTIPART_MIN_BYTES, upload: 'single' } });
    truncateSync(file, MULTIPART_MIN_BYTES + 1);
    expect(await h.run('post', 'The match', '--in', '%paris', '--long-video', 'big.mp4', '--dry-run', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ longVideo: { upload: 'multipart' } });
  });
});
