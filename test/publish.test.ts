// Publishing, watching and batches against a scripted API (no network): the media sent with a
// presigned POST and the post sent again while they are processed, with the same requestId; --watch;
// batch; theme publish with its images; the advanced groups out of the basic help.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { saveSession } from '../src/session.js';
import { instantOf } from '../src/commands/read.js';
import { splitCommand } from '../src/watch.js';
import { harness, last } from './helpers.js';

type Call = { field: string; variables: Record<string, unknown>; query: string };
type Handler = (variables: Record<string, unknown>, n: number) => unknown;

/** A harness signed in as a delegated agent, whose API answers by the first field of each request. */
function scripted(handlers: Record<string, Handler>, extra: Parameters<typeof harness>[0] = {}) {
  const calls: Call[] = [];
  const uploads: { url: string; fields: Record<string, string>; file?: { name: string; size: number; type: string } }[] = [];
  const counts: Record<string, number> = {};
  const h = harness({
    ...extra,
    env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1', ...extra.env },
    fetch: async (url, init) => {
      if (String(url).startsWith('https://s3.test/')) {
        const form = init!.body as FormData;
        const fields: Record<string, string> = {};
        let file;
        for (const [k, v] of form.entries()) { if (typeof v === 'string') fields[k] = v; else file = { name: (v as File).name, size: v.size, type: v.type }; }
        uploads.push({ url: String(url), fields, file });
        return new Response(null, { status: 204 });
      }
      const { query, variables } = JSON.parse(String(init!.body));
      const field = /\{\s*(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      calls.push({ field, variables, query });
      counts[field] = (counts[field] ?? 0) + 1;
      const handler = handlers[field];
      if (!handler) return Response.json({ data: null, errors: [{ errorType: 'NO_HANDLER', message: field }] });
      try { return Response.json({ data: { [field]: handler(variables, counts[field]) } }); } catch (e) { return Response.json({ data: null, errors: [{ errorType: (e as Error).message, message: 'refused' }] }); }
    },
  });
  saveSession(new Context(h.io, NO_FLAGS), { kind: 'agent', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op', agentId: 'ag' });
  return { h, calls, uploads };
}
const png = (w: number, h: number) => { const b = Buffer.alloc(64); Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13]).copy(b); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const upload = (_v: unknown, n: number) => ({ id: `up-${n}`, url: 'https://s3.test/bucket', fields: JSON.stringify({ key: `k-${n}`, policy: 'p' }) });
const post = (v: Record<string, unknown>) => ({ id: 'post-1', text: v.text, images: (v.images as unknown[] | null) ?? [] });

describe('post', () => {
  it('sends its images with the presigned POST, then the post again while they are processed, with the same requestId', async () => {
    const { h, calls, uploads } = scripted({ requestImageUpload: upload, createPost: (v, n) => { if (n === 1) throw new Error('IMAGE_NOT_READY'); return post(v); } });
    writeFileSync(join(h.dir, 'a.png'), png(800, 600));
    const exit = await h.run('post', 'Le stade #foot', '--in', '%paris', '--image', join(h.dir, 'a.png'), '--alt', 'Le stade', '--json');
    expect(h.values, JSON.stringify(h.values)).toHaveLength(1);
    expect(exit, JSON.stringify(h.values)).toBe(0);
    expect(uploads).toEqual([{ url: 'https://s3.test/bucket', fields: { key: 'k-1', policy: 'p' }, file: { name: 'a.png', size: 64, type: 'image/png' } }]);
    const sent = calls.filter((c) => c.field === 'createPost');
    expect(sent.length).toBe(2);
    expect(sent[0].variables).toMatchObject({ text: 'Le stade #foot', universe: '%paris', images: [{ id: 'up-1', alt: 'Le stade' }] });
    expect(sent[1].variables.requestId).toBe(sent[0].variables.requestId);
    expect(calls.find((c) => c.field === 'requestImageUpload')!.variables).toEqual({ t: 'image/png', s: 64 });
    expect(h.slept).toEqual([2000]);
    expect(last(h)).toMatchObject({ id: 'post-1' });
  });
  it('checks before sending anything: empty, images and a clip, a type, the text, --dry-run', async () => {
    const { h, calls } = scripted({});
    writeFileSync(join(h.dir, 'a.png'), png(10, 10));
    writeFileSync(join(h.dir, 'b.txt'), 'not an image');
    writeFileSync(join(h.dir, 'c.mp4'), Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D, 0, 0, 0, 0]));
    const code = async (...argv: string[]) => { await h.run(...argv, '--json'); return last<{ error?: { code: string } }>(h).error?.code; };
    expect(await code('post', '--in', '%paris')).toBe('POST_EMPTY');
    expect(await code('post', 'x', '--image', join(h.dir, 'a.png'), '--video', join(h.dir, 'c.mp4'))).toBe('POST_IMAGES_AND_CLIP');
    expect(await code('post', 'x', '--image', join(h.dir, 'b.txt'))).toBe('IMAGE_TYPE_NOT_SUPPORTED');
    expect(await code('post', 'é'.repeat(1001))).toBe('POST_TEXT_TOO_LONG');
    expect(await code('post', 'x', '--image', join(h.dir, 'a.png'), '--alt', 'a', '--alt', 'b')).toBe('INVALID_INPUT');
    expect(await h.run('post', 'Bonjour', '--in', '%paris', '--video', join(h.dir, 'c.mp4'), '--dry-run', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ dryRun: true, operation: 'createPost', video: { type: 'video/mp4' } });
    expect(calls).toEqual([]);
  });
  it('reads its text from a file or stdin', async () => {
    const { h, calls } = scripted({ createPost: post }, { });
    h.io.readStdin = async () => 'Depuis stdin\n';
    writeFileSync(join(h.dir, 't.md'), 'Depuis un fichier\n');
    await h.run('post', '-', '--in', '%paris', '--json');
    await h.run('post', '--file', join(h.dir, 't.md'), '--json');
    expect(calls.map((c) => c.variables.text)).toEqual(['Depuis stdin', 'Depuis un fichier']);
  });
});

describe('the interactions', () => {
  it('resolve an @handle to the id of the account, and send the arguments of the contract', async () => {
    const { h, calls } = scripted({ accountByHandle: () => ({ id: 'eu-alice' }), block: (v) => ({ id: v.accountId, handle: 'alice' }), likePost: (v) => ({ id: v.id, likeCount: 1 }) });
    expect(await h.run('block', '@alice', '--json')).toBe(0);
    expect(calls.find((c) => c.field === 'block')!.variables).toEqual({ accountId: 'eu-alice' });
    expect(await h.run('like', 'p1', '--quiet')).toBe(0);
    expect(h.lines.pop()).toBe('p1');
  });
  it('ask a confirmation for what cannot be undone', async () => {
    const { h, calls } = scripted({ deletePost: (v) => ({ id: v.id }) });
    expect(await h.run('posts', 'delete', 'p1', '--json')).toBe(2);
    expect(calls).toEqual([]);
    expect(await h.run('posts', 'delete', 'p1', '--yes', '--json')).toBe(0);
  });
  it('report a theme by its address, with its reason and its part', async () => {
    const { h, calls } = scripted({ reportTheme: () => ({ id: 'r1' }) });
    expect(await h.run('report', 'theme', '%paris/stade-nuit', '--reason', 'ILLEGAL', '--part', 'BANNER', '--json')).toBe(0);
    expect(calls[0].variables).toEqual({ universe: '%paris', name: 'stade-nuit', part: 'BANNER', reason: 'ILLEGAL', article: null });
  });
});

describe('--watch', () => {
  it('writes each new post once, oldest first, as JSON lines; the summary on stderr', async () => {
    const pages = [['a'], ['b', 'a'], ['c', 'b', 'a']];
    const { h } = scripted({ posts: (_v, n) => ({ items: (pages[n - 1] ?? pages[2]).map((id) => ({ id, createdAt: '2026-10-23T10:00:00.000Z', display: id, author: { handle: 'x', id: 'x' }, universe: '%x', images: [] })), next: null }) });
    expect(await h.run('posts', 'list', '%x', '--watch', '--jsonl', '--interval', '15', '--duration', '30')).toBe(0);
    expect(h.lines.map((l) => JSON.parse(l).id)).toEqual(['b', 'c']);
    expect(h.slept).toEqual([15000, 15000]);
    expect(h.errors.join('\n')).toMatch(/Watched: 3 reads, 2 new item/);
  });
  it('stops at a refusal of the usage limits, with its code', async () => {
    const { h } = scripted({ posts: (_v, n) => { if (n > 1) throw new Error('QUOTA_EXCEEDED'); return { items: [], next: null }; } });
    expect(await h.run('posts', 'list', '%x', '--watch', '--interval', '15', '--json')).toBe(1);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('QUOTA_EXCEEDED');
  });
  it('refuses an interval under 15 seconds', async () => {
    const { h } = scripted({});
    expect(await h.run('feed', '--watch', '--interval', '5', '--json')).toBe(2);
  });
  it('splits the command of --exec without a shell', () => {
    expect(splitCommand(`node "my handler.js" --flag 'a b'`)).toEqual(['node', 'my handler.js', '--flag', 'a b']);
  });
});

describe('batch', () => {
  it('runs the lines in order, each with its requestId; stops at the first refusal unless --continue', async () => {
    const { h, calls } = scripted({ likePost: (v) => { if (v.id === 'bad') throw new Error('POST_NOT_FOUND'); return { id: v.id }; }, replyTo: (v) => ({ id: `r-${v.requestId}` }) });
    const file = join(h.dir, 'a.jsonl');
    writeFileSync(file, ['{"command": "like", "input": {"id": "p1"}}', '{"command": "like", "input": {"id": "bad"}}', '{"argv": ["reply", "p1", "Bien vu"], "requestId": "5b0c3f6e-6d2f-4c7e-9a43-0f1c2b3d4e5f"}'].join('\n'));
    expect(await h.run('batch', '--file', file, '--json')).toBe(1);
    expect(last(h)).toMatchObject({ done: 1, failed: 1, skipped: 1 });
    expect(await h.run('batch', file, '--continue', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ done: 2, failed: 1, skipped: 0, results: [{ ok: true }, { ok: false, error: { code: 'POST_NOT_FOUND' } }, { ok: true, requestId: '5b0c3f6e-6d2f-4c7e-9a43-0f1c2b3d4e5f' }] });
    expect(calls.filter((c) => c.field === 'replyTo')[0].variables.requestId).toBe('5b0c3f6e-6d2f-4c7e-9a43-0f1c2b3d4e5f');
  });
});

describe('theme publish', () => {
  const doc = {
    format: 'break-rocks-theme/2', universe: '%ignored', name: 'cli2-test',
    variants: {
      night: { palette: { background: '#0E1116', surface: '#161B22', text: '#F2F4F7', primary: '#E5484D', accent: '#4CC2FF', link: '#7CC4FF' } },
      day: { palette: { background: '#FFFFFF', surface: '#F4F5F7', text: '#14171C', primary: '#C8102E', accent: '#0067B8', link: '#0057A0' } },
    },
    typography: { title: 'Bebas Neue' },
    imageSlots: { timeColumn: { day: 'time-column-day.png' }, cardTexture: { day: 'card-texture-day.png' }, page: null },
  };
  it('sends each image the JSON names, replaces it with its upload id, then publishes', async () => {
    const { h, calls, uploads } = scripted({ requestImageUpload: upload, publishTheme: (v) => ({ name: JSON.parse(String(v.t)).name, version: 1 }) });
    const dir = join(h.dir, 't'); mkdirSync(dir);
    writeFileSync(join(dir, 'theme.json'), JSON.stringify(doc));
    writeFileSync(join(dir, 'time-column-day.png'), png(1080, 1440));
    writeFileSync(join(dir, 'card-texture-day.png'), png(1024, 1024));
    expect(await h.run('theme', 'publish', join(dir, 'theme.json'), '--in', '%paris', '--json')).toBe(0);
    expect(uploads.length).toBe(2);
    const published = calls.find((c) => c.field === 'publishTheme')!.variables;
    expect(published.u).toBe('%paris');
    const sent = JSON.parse(String(published.t));
    expect(sent.imageSlots).toEqual({ timeColumn: { day: 'up-1' }, cardTexture: { day: 'up-2' }, page: null });
    expect(sent.universe).toBeUndefined();
    expect(last(h)).toMatchObject({ uploads: [{ ref: 'time-column-day.png', id: 'up-1' }, { ref: 'card-texture-day.png', id: 'up-2' }] });
  });
  it('names each file missing, before anything is sent', async () => {
    const { h, calls } = scripted({});
    const dir = join(h.dir, 't'); mkdirSync(dir);
    writeFileSync(join(dir, 'theme.json'), JSON.stringify(doc));
    expect(await h.run('theme', 'publish', join(dir, 'theme.json'), '--in', '%paris', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'IMAGE_FILE_MISSING', missing: ['imageSlots.timeColumn.day', 'imageSlots.cardTexture.day'] } });
    expect(calls).toEqual([]);
  });
});

describe('the help', () => {
  it('keeps moderation and governance out of the basic help', async () => {
    const h = harness();
    await h.run('help');
    expect(h.lines[0]).not.toContain('moderation ban');
    expect(h.lines[0]).toContain('breakrocks help moderation');
    await h.run('help', 'moderation');
    expect(h.lines[1]).toContain('moderation ban');
  });
});

describe('durations', () => {
  it('read 2h, 30m, 7d and dates', () => {
    const now = Date.parse('2026-10-23T10:00:00.000Z');
    expect(new Date(instantOf('2h', now)).toISOString()).toBe('2026-10-23T08:00:00.000Z');
    expect(new Date(instantOf('7d', now)).toISOString()).toBe('2026-10-16T10:00:00.000Z');
    expect(instantOf('2026-10-01', now)).toBe(Date.parse('2026-10-01'));
    expect(() => instantOf('soon', now)).toThrow(/neither a duration/);
  });
});
