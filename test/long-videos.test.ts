// Specs v122.3.0 (D-386): the tabs of the long videos, their history (list, remove, clear, pause), hasLongVideos on a
// universe, and the upload of a long video above 500 MB in parts (startMultipartUpload, the parts sent with a PUT to
// signed URLs, retries per part, resume with the same requestId, completeMultipartUpload with the ETags). The API is
// scripted; the parts go to a local HTTP server (no network beyond the loopback).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { checkVideo } from '../src/media.js';
import { MULTIPART_MIN_BYTES, stateFileOf, uploadMultipart } from '../src/multipart.js';
import { saveSession } from '../src/session.js';
import { harness, last } from './helpers.js';

type Call = { field: string; query: string; variables: Record<string, unknown> };
type Handler = (variables: Record<string, unknown>, n: number) => unknown;

/** A harness signed in as a delegated agent; the API answers by the first field of each request (a Handler, or a value); other URLs go to [other]. */
function scripted(handlers: Record<string, Handler | unknown>, other?: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  const h = harness({
    env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1' },
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
      } catch (e) { return Response.json({ data: null, errors: [{ errorType: (e as Error).message, message: 'refused' }] }); }
    },
  });
  saveSession(new Context(h.io, NO_FLAGS), { kind: 'agent', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op', agentId: 'ag' });
  return { h, calls, ctx: new Context(h.io, NO_FLAGS) };
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MP4_HEAD = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
const sha = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex');

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
  it('pauses and resumes it with settings video-history-pause, like history-pause (the other settings untouched)', async () => {
    const { h, calls } = scripted({ setSettings: { videoHistoryPaused: true } });
    expect(await h.run('settings', 'video-history-pause', 'on')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'setSettings', variables: { input: { videoHistoryPaused: true } } });
    expect(h.lines.at(-1)).toBe('long videos history paused');
    expect(await h.run('settings', 'video-history-pause', 'off', '--json')).toBe(0);
    expect(calls[1].variables).toMatchObject({ input: { videoHistoryPaused: false } });
    expect(calls[1].variables.input).toEqual({ videoHistoryPaused: false });
    expect(await h.run('settings', 'video-history-pause', 'maybe', '--json')).toBe(2);
    expect(await h.run('settings', 'history-pause', 'on', '--json')).toBe(0);
    expect(calls[2].variables.input).toEqual({ universeHistoryPaused: true });
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

// ---- The multipart upload ----

type PartLog = { number: number; bytes: number; sha: string };
let servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((done) => { s.closeAllConnections(); s.close(done); }))); servers = []; });

/** A local storage: PUT /part/<n> answers the ETag "e<n>"; [fail] decides per request ("cut": the connection is cut; a number: that status). */
async function storage(fail: (number: number, attempt: number) => 'cut' | number | undefined = () => undefined) {
  const log: PartLog[] = [];
  const attempts: Record<number, number> = {};
  const server = createServer((req, res) => {
    const number = Number(/\/part\/(\d+)/.exec(req.url ?? '')![1]);
    attempts[number] = (attempts[number] ?? 0) + 1;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const failure = fail(number, attempts[number]);
      if (failure === 'cut') { req.socket.destroy(); return; }
      if (failure) { res.writeHead(failure).end(); return; }
      const body = Buffer.concat(chunks);
      log.push({ number, bytes: body.length, sha: sha(body) });
      res.writeHead(200, { ETag: `"e${number}"` }).end();
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  servers.push(server);
  return { log, attempts, url: (n: number) => `http://127.0.0.1:${(server.address() as AddressInfo).port}/part/${n}` };
}

/** The API of a multipart upload of [size] bytes in parts of [partSize] bytes, its parts on [url]. */
function multipartApi(url: (n: number) => string, size: number, partSize: number, extra: Record<string, Handler> = {}) {
  const total = Math.ceil(size / partSize);
  return {
    startMultipartUpload: () => ({ mediaId: 'm1', partSize, expiresAt: '2026-10-24T10:00:00.000Z', parts: Array.from({ length: total }, (_, i) => ({ number: i + 1, url: url(i + 1) })) }),
    completeMultipartUpload: () => true,
    ...extra,
  };
}

/** A video of [size] bytes (an MP4 header, then a varying content, so that a part sent for another is noticed). */
function video(dir: string, size: number, name = 'match.mp4') {
  const body = Buffer.alloc(size);
  for (let i = 0; i < size; i++) body[i] = (i * 31 + (i >> 8)) & 0xff;
  MP4_HEAD.copy(body);
  writeFileSync(join(dir, name), body);
  return body;
}

describe('the multipart upload of a long video', () => {
  it('sends the parts with a PUT, each its slice of the file, then completes with the ETags', async () => {
    const s = await storage();
    const size = 1_000_000, partSize = 300_000;
    const { h, calls, ctx } = scripted(multipartApi(s.url, size, partSize), (url, init) => fetch(url, init));
    const body = video(h.dir, size);
    const target = { destination: 'POST', address: '%paris' } as const;
    const v = checkVideo(ctx, 'match.mp4');
    const upload = await uploadMultipart(ctx, v, target, { license: 'CC0' });
    expect(upload.id).toBe('m1');
    expect(calls.map((c) => c.field)).toEqual(['startMultipartUpload', 'completeMultipartUpload']);
    expect(calls[0].variables.i).toEqual({ contentType: 'video/mp4', size: v.bytes, address: '%paris', license: 'CC0' });
    expect(String(calls[0].variables.r)).toMatch(UUID_V7);
    expect(calls[1].variables).toMatchObject({ m: 'm1', p: [1, 2, 3, 4].map((n) => ({ number: n, etag: `"e${n}"` })) });
    expect(calls[1].variables.r).not.toBe(calls[0].variables.r);
    expect(s.log.sort((a, b) => a.number - b.number).map((p) => p.bytes)).toEqual([300_000, 300_000, 300_000, 100_000]);
    expect(s.log.sort((a, b) => a.number - b.number).map((p) => p.sha)).toEqual([0, 1, 2, 3].map((i) => sha(body.subarray(i * partSize, (i + 1) * partSize))));
    expect(existsSync(stateFileOf(ctx, v, target, { license: 'CC0' }))).toBe(true);
    upload.forget();
    expect(existsSync(stateFileOf(ctx, v, target, { license: 'CC0' }))).toBe(false);
  });

  it('resumes after an interruption with the same requestId, sending only the parts that are missing', async () => {
    let cut = true;
    const s = await storage((n) => (cut && n === 3 ? 'cut' : undefined));
    const size = 1_000_000, partSize = 300_000;
    const { h, calls, ctx } = scripted(multipartApi(s.url, size, partSize), (url, init) => fetch(url, init));
    video(h.dir, size);
    const target = { destination: 'POST', address: '%paris' } as const;
    const v = checkVideo(ctx, 'match.mp4');
    await expect(uploadMultipart(ctx, v, target)).rejects.toMatchObject({ code: 'UPLOAD_FAILED', message: expect.stringContaining('2 of 4 parts are kept') });
    expect(s.log.map((p) => p.number).sort()).toEqual([1, 2]);
    expect(s.attempts[3]).toBe(4);
    expect(h.slept).toEqual([1000, 2000, 4000]);
    const stateFile = stateFileOf(ctx, v, target);
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    expect(state.parts).toEqual({ 1: '"e1"', 2: '"e2"' });
    expect(JSON.stringify(state)).not.toContain('127.0.0.1');
    expect(calls.map((c) => c.field)).toEqual(['startMultipartUpload']);

    cut = false;
    s.log.length = 0;
    const upload = await uploadMultipart(ctx, v, target);
    expect(calls.map((c) => c.field)).toEqual(['startMultipartUpload', 'startMultipartUpload', 'completeMultipartUpload']);
    expect(calls[1].variables.r).toBe(calls[0].variables.r);
    expect(s.log.map((p) => p.number).sort()).toEqual([3, 4]);
    expect(calls[2].variables.p).toEqual([1, 2, 3, 4].map((n) => ({ number: n, etag: `"e${n}"` })));
    expect(h.errors.some((l) => l.startsWith('Resuming match.mp4: 2 of 4 parts already sent'))).toBe(true);
    expect(upload.id).toBe('m1');
    upload.forget();
    expect(existsSync(stateFile)).toBe(false);
  });

  it('starts again with a new requestId when the upload is no longer resumable (24 hours) or the file changed', async () => {
    let cut = true;
    const s = await storage((n) => (cut && n === 2 ? 'cut' : undefined));
    const size = 600_000, partSize = 200_000;
    const { h, calls, ctx } = scripted(multipartApi(s.url, size, partSize), (url, init) => fetch(url, init));
    video(h.dir, size);
    const target = { destination: 'POST', address: null } as const;
    await expect(uploadMultipart(ctx, checkVideo(ctx, 'match.mp4'), target)).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
    cut = false;
    h.clock.now += 25 * 3600_000;
    s.log.length = 0;
    await uploadMultipart(ctx, checkVideo(ctx, 'match.mp4'), target);
    expect(calls[1].variables.r).not.toBe(calls[0].variables.r);
    expect(s.log.map((p) => p.number).sort()).toEqual([1, 2, 3]);
    // Another size: another upload (another state file).
    video(h.dir, 400_000);
    const other = checkVideo(ctx, 'match.mp4');
    expect(stateFileOf(ctx, other, target)).not.toBe(stateFileOf(ctx, { ...other, bytes: 600_000 }, target));
  });

  it('tries a part again alone when the storage fails, not the others', async () => {
    const s = await storage((n, attempt) => (n === 2 && attempt === 1 ? 503 : undefined));
    const size = 600_000, partSize = 200_000;
    const { h, calls, ctx } = scripted(multipartApi(s.url, size, partSize), (url, init) => fetch(url, init));
    video(h.dir, size);
    const upload = await uploadMultipart(ctx, checkVideo(ctx, 'match.mp4'), { destination: 'POST' });
    expect(s.attempts).toEqual({ 1: 1, 2: 2, 3: 1 });
    expect(h.slept).toEqual([1000]);
    expect(calls.map((c) => c.field)).toEqual(['startMultipartUpload', 'completeMultipartUpload']);
    upload.forget();
  });

  it('does not try again a part the storage refuses for good (403: the next run asks new URLs)', async () => {
    const s = await storage((n) => (n === 1 ? 403 : undefined));
    const { h, ctx } = scripted(multipartApi(s.url, 400_000, 200_000), (url, init) => fetch(url, init));
    video(h.dir, 400_000);
    await expect(uploadMultipart(ctx, checkVideo(ctx, 'match.mp4'), { destination: 'POST' })).rejects.toMatchObject({ code: 'UPLOAD_FAILED', message: expect.stringContaining('403') });
    expect(s.attempts[1]).toBe(1);
  });

  it('sends every part again once when the platform says a part is missing (UPLOAD_PARTS_MISSING), and refuses the second time', async () => {
    const s = await storage();
    let completes = 0;
    const { h, calls, ctx } = scripted(multipartApi(s.url, 400_000, 200_000, { completeMultipartUpload: () => { if (++completes === 1) throw new Error('UPLOAD_PARTS_MISSING'); return true; } }), (url, init) => fetch(url, init));
    video(h.dir, 400_000);
    const upload = await uploadMultipart(ctx, checkVideo(ctx, 'match.mp4'), { destination: 'POST' });
    expect(calls.map((c) => c.field)).toEqual(['startMultipartUpload', 'completeMultipartUpload', 'startMultipartUpload', 'completeMultipartUpload']);
    expect(s.log).toHaveLength(4);
    upload.forget();
    const bad = scripted(multipartApi(s.url, 400_000, 200_000, { completeMultipartUpload: () => { throw new Error('UPLOAD_PARTS_MISSING'); } }), (url, init) => fetch(url, init));
    await expect(uploadMultipart(bad.ctx, checkVideo(bad.ctx, join(h.dir, 'match.mp4')), { destination: 'POST' })).rejects.toMatchObject({ code: 'UPLOAD_PARTS_MISSING' });
    expect(bad.calls.map((c) => c.field)).toEqual(['startMultipartUpload', 'completeMultipartUpload', 'startMultipartUpload', 'completeMultipartUpload']);
  });
});

describe('a multipart upload the platform refuses to start', () => {
  it('leaves no state file behind (NOT_IMPLEMENTED, VIDEO_SIZE_INVALID…)', async () => {
    const { h, ctx } = scripted({ startMultipartUpload: () => { throw new Error('VIDEO_SIZE_INVALID'); } });
    video(h.dir, 1000);
    const v = checkVideo(ctx, 'match.mp4');
    await expect(uploadMultipart(ctx, v, { destination: 'POST' })).rejects.toMatchObject({ code: 'VIDEO_SIZE_INVALID' });
    expect(existsSync(stateFileOf(ctx, v, { destination: 'POST' }))).toBe(false);
  });
});

describe('post --long-video', () => {
  /** A sparse video of [size] bytes (no content written but the MP4 header). */
  const sparse = (dir: string, size: number) => { const file = join(dir, 'big.mp4'); writeFileSync(file, MP4_HEAD); truncateSync(file, size); return file; };
  const parts = async (url: string, init: RequestInit) => {
    if (init.method !== 'PUT') throw new Error(`unexpected ${init.method} ${url}`);
    return new Response(null, { status: 200, headers: { ETag: `"${url.split('/').pop()}"` } });
  };

  it('uploads in parts above 500 MB, with progress, then createPost with the media id; the state file is gone', async () => {
    const size = MULTIPART_MIN_BYTES + 1, partSize = 200 * 1024 * 1024;
    const { h, calls } = scripted({ ...multipartApi((n) => `https://s3.test/part/${n}`, size, partSize), createPost: { id: 'p9' } }, parts);
    sparse(h.dir, size);
    expect(await h.run('post', 'The whole match', '--in', '%paris', '--long-video', 'big.mp4', '--license', 'CC0', '--json')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['startMultipartUpload', 'completeMultipartUpload', 'createPost']);
    expect(calls[0].variables.i).toEqual({ contentType: 'video/mp4', size, address: '%paris', license: 'CC0' });
    expect(calls[1].variables).toMatchObject({ m: 'm1', p: [{ number: 1, etag: '"1"' }, { number: 2, etag: '"2"' }, { number: 3, etag: '"3"' }] });
    expect(calls[2].variables).toMatchObject({ longVideo: 'm1', clip: null, text: 'The whole match' });
  });

  it('keeps the upload when createPost is refused, to be resumed by the same command', async () => {
    const size = MULTIPART_MIN_BYTES + 1;
    let failing = true;
    const { h, calls } = scripted({ ...multipartApi((n) => `https://s3.test/part/${n}`, size, size), createPost: () => { if (failing) throw new Error('POST_EMPTY'); return { id: 'p9' }; } }, parts);
    sparse(h.dir, size);
    expect(await h.run('post', 'x', '--in', '%paris', '--long-video', 'big.mp4', '--license', 'CC0', '--json')).toBe(1);
    expect(existsSync(join(h.dir, 'config', 'uploads')) && readdirSync(join(h.dir, 'config', 'uploads')).length).toBe(1);
    failing = false;
    expect(await h.run('post', 'x', '--in', '%paris', '--long-video', 'big.mp4', '--license', 'CC0', '--json')).toBe(0);
    expect(calls.filter((c) => c.field === 'startMultipartUpload').map((c) => c.variables.r)).toHaveLength(2);
    expect(calls.filter((c) => c.field === 'startMultipartUpload')[1].variables.r).toBe(calls[0].variables.r);
    expect(readdirSync(join(h.dir, 'config', 'uploads'))).toEqual([]);
  });

  it('keeps requestMediaUpload at 500 MB or below, and tells the way of the upload in --dry-run', async () => {
    const { h, calls } = scripted({ requestMediaUpload: { id: 'lv1', url: 'https://s3.test/v', fields: {} }, createPost: { id: 'p9' } }, async () => new Response(null, { status: 204 }));
    sparse(h.dir, MULTIPART_MIN_BYTES);
    expect(await h.run('post', 'The match', '--in', '%paris', '--long-video', 'big.mp4', '--license', 'CC0', '--dry-run', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ longVideo: { file: 'big.mp4', bytes: MULTIPART_MIN_BYTES, upload: 'single' } });
    expect(await h.run('post', 'The match', '--in', '%paris', '--long-video', 'big.mp4', '--license', 'CC0', '--json')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['requestMediaUpload', 'createPost']);
    truncateSync(join(h.dir, 'big.mp4'), MULTIPART_MIN_BYTES + 1);
    expect(await h.run('post', 'The match', '--in', '%paris', '--long-video', 'big.mp4', '--license', 'CC0', '--dry-run', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ longVideo: { upload: 'multipart' } });
    expect(calls).toHaveLength(2);
  });
});
