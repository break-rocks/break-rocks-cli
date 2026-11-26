// Media sent to the new backend (native-sulfur, server src/api/media.ts): `requestUpload` declares the kind (image, clip,
// video, document), the content type, the size, the media destination (post, reply, quote, avatar, theme…; a post's media name its
// posting address, no lookup: the first post of a new universe carries its media) and the SHA-256 of the file; a clip or a long video also its duration and its orientation, read
// from the file's header (src/mp4.ts). Up to 500 MB: the signed form (S3 checks the SHA-256 the policy fixes). Above, or when
// BREAKROCKS_MULTIPART_ABOVE (bytes) says so: in parts of 64 MiB, each PUT with its own SHA-256 (`x-amz-checksum-sha256`),
// tried again alone when it fails, then `completeUpload` with the ETags; the parts done are kept in uploads/<key>.json
// (no URL, no secret), so the same command run again within 24 hours resumes (`resumeUpload` signs the parts again).
// A post may be written while its media are processed: it is published once they are ready (server D-422).
import { createHash } from 'node:crypto';
import { closeSync, openAsBlob, openSync, readSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from '../context.js';
import { readJson, writePrivate } from '../config.js';
import { CliError, EXIT, networkError, platformRefusal, usageError } from '../errors.js';
import { probeVideo } from '../mp4.js';
import { sulfurApi } from './session.js';

export const MULTIPART_ABOVE_BYTES = 500 * 1_000_000;
export const PART_BYTES = 64 * 1024 * 1024;
const PART_ATTEMPTS = 4;

export type SulfurKind = 'image' | 'clip' | 'video' | 'document';
export type SulfurDestination = 'post' | 'reply' | 'quote' | 'dm' | 'group' | 'channel' | 'universeImage' | 'universeBanner' | 'theme' | 'avatar' | 'eventCover' | 'pageImage' | 'playlist' | 'feat';
export type SulfurFile = { path: string; name: string; type: string; bytes: number };
type Grant = { mediaId: string; uploadId: string; form: { url: string; fields: string } | null; parts: { n: number; url: string }[] | null; expiresAt: string };
type State = { version: 2; uploadId: string; mediaId: string; size: number; mtimeMs: number; partSha256: string[]; etags: Record<string, string>; expiresAt: string };

const GRANT = 'mediaId uploadId form { url fields } parts { n url } expiresAt';

/** The SHA-256 (hex) of [length] bytes of a file from [start], read by chunks (never the whole file in memory). */
export function sha256Of(path: string, start = 0, length?: number): string {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  try {
    const end = length === undefined ? statSync(path).size : start + length;
    const chunk = Buffer.alloc(4 * 1024 * 1024);
    for (let at = start; at < end;) {
      const n = readSync(fd, chunk, 0, Math.min(chunk.length, end - at), at);
      if (n <= 0) break;
      hash.update(chunk.subarray(0, n));
      at += n;
    }
  } finally { closeSync(fd); }
  return hash.digest('hex');
}

/** The duration and orientation of a clip or a long video, read from its header (VIDEO_HEADER_UNREADABLE otherwise). */
export function videoFacts(file: SulfurFile): { durationSec: number; orientation: 'h' | 'v' | 's' } {
  const probe = file.type === 'video/webm' ? undefined : probeVideo(file.path);
  if (!probe) throw usageError('VIDEO_HEADER_UNREADABLE', `${file.name}: the new backend takes an MP4 or a MOV whose header gives its duration and its size (a WebM, or a fragmented file, is not taken)`, { path: file.path });
  return { durationSec: Math.round(probe.durationSec * 1000) / 1000, orientation: probe.orientation };
}

const multipartAbove = (ctx: Context) => { const v = Number(ctx.env.BREAKROCKS_MULTIPART_ABOVE); return Number.isFinite(v) && v > 0 ? v : MULTIPART_ABOVE_BYTES; };

async function postForm(ctx: Context, grant: Grant, file: SulfurFile): Promise<void> {
  const form = grant.form!;
  const fields = JSON.parse(form.fields) as Record<string, string>;
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  body.append('file', await openAsBlob(file.path, { type: file.type }), file.name);
  let res: Response;
  try { res = await ctx.io.fetch(form.url, { method: 'POST', body }); } catch (e) { throw networkError('UPLOAD_FAILED', `${file.name}: ${(e as Error).message}`); }
  if (!res.ok) throw networkError('UPLOAD_FAILED', `${file.name}: the storage answered ${res.status}`, { status: res.status });
}

async function putPart(ctx: Context, file: SulfurFile, blob: Blob, part: { n: number; url: string }, sha256: string): Promise<string> {
  const start = (part.n - 1) * PART_BYTES, end = Math.min(part.n * PART_BYTES, file.bytes);
  let failure = '';
  for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt++) {
    try {
      const res = await ctx.io.fetch(part.url, { method: 'PUT', body: blob.slice(start, end), headers: { 'x-amz-checksum-sha256': Buffer.from(sha256, 'hex').toString('base64') } });
      if (res.ok) {
        const etag = res.headers.get('etag');
        if (!etag) throw networkError('UPLOAD_FAILED', `${file.name}: the storage gave no ETag for the part ${part.n}`);
        return etag;
      }
      failure = `the storage answered ${res.status}`;
      if (res.status < 500 && res.status !== 408 && res.status !== 429) throw networkError('UPLOAD_FAILED', `${file.name}: the part ${part.n}: ${failure}`, { status: res.status, part: part.n });
    } catch (error) {
      if (error instanceof CliError) throw error;
      failure = (error as Error).message;
    }
    if (attempt < PART_ATTEMPTS) { ctx.progress(`Part ${part.n}: ${failure}; trying again (${attempt}/${PART_ATTEMPTS - 1})`); await ctx.io.sleep(1000 * 2 ** (attempt - 1)); }
  }
  throw networkError('UPLOAD_FAILED', `${file.name}: the part ${part.n} failed after ${PART_ATTEMPTS} tries (${failure})`, { part: part.n });
}

const stateFile = (ctx: Context, file: SulfurFile, key: string) => join(ctx.store.dir, 'uploads', `${createHash('sha256').update(JSON.stringify(['sulfur', ctx.profileName, file.path, file.bytes, key])).digest('hex').slice(0, 32)}.json`);

async function multipart(ctx: Context, file: SulfurFile, input: Record<string, unknown>): Promise<string> {
  const at = stateFile(ctx, file, JSON.stringify(input));
  const mtimeMs = Math.round(statSync(file.path).mtimeMs);
  let state = readJson<State>(at);
  if (state && (state.version !== 2 || state.size !== file.bytes || state.mtimeMs !== mtimeMs || Date.parse(state.expiresAt) + 23 * 3600_000 <= ctx.now())) state = undefined;
  const blob = await openAsBlob(file.path);
  let grant: Grant;
  if (state) {
    try { grant = (await sulfurApi<{ resumeUpload: Grant }>(ctx, `mutation($u: ID!, $p: [String!]) { resumeUpload(uploadId: $u, partSha256: $p) { ${GRANT} } }`, { u: state.uploadId, p: state.partSha256 })).resumeUpload; } catch (error) {
      // No answer (the network, the server, the session): the parts done are kept for the next run. Refused by the
      // platform (the upload ended, unknown): a new upload.
      if (!(error instanceof CliError) || error.exit === EXIT.NETWORK) throw error;
      state = undefined;
    }
  }
  if (!state) {
    const count = Math.ceil(file.bytes / PART_BYTES);
    ctx.progress(`Hashing ${file.name} (${count} part${count > 1 ? 's' : ''})…`);
    const partSha256 = Array.from({ length: count }, (_, i) => sha256Of(file.path, i * PART_BYTES, Math.min(PART_BYTES, file.bytes - i * PART_BYTES)));
    grant = (await sulfurApi<{ requestUpload: Grant }>(ctx, `mutation($i: UploadInput!) { requestUpload(input: $i) { ${GRANT} } }`, { i: { ...input, partSha256 } })).requestUpload;
    state = { version: 2, uploadId: grant.uploadId, mediaId: grant.mediaId, size: file.bytes, mtimeMs, partSha256, etags: {}, expiresAt: grant.expiresAt };
  }
  const s = state;
  s.expiresAt = grant!.expiresAt;
  const save = () => writePrivate(at, `${JSON.stringify(s, null, 2)}\n`);
  save();
  const parts = grant!.parts ?? [];
  const done = parts.filter((p) => s.etags[String(p.n)]).length;
  ctx.progress(done ? `Resuming ${file.name}: ${done} of ${parts.length} parts already sent` : `Sending ${file.name} (${Math.ceil(file.bytes / 1048576)} MB) in ${parts.length} parts…`);
  for (const part of parts) {
    if (s.etags[String(part.n)]) continue;
    try { s.etags[String(part.n)] = await putPart(ctx, file, blob, part, s.partSha256[part.n - 1]); } catch (error) {
      save();
      if (error instanceof CliError) throw new CliError(error.code, `${error.message}. ${Object.keys(s.etags).length} of ${parts.length} parts are kept: run the same command again within 24 hours to resume`, error.exit, error.details, error.source);
      throw error;
    }
    save();
    ctx.progress(`Part ${part.n}/${parts.length} sent`);
  }
  const done2 = parts.map((p) => ({ n: p.n, etag: s.etags[String(p.n)], sha256: s.partSha256[p.n - 1] }));
  const mediaId = (await sulfurApi<{ completeUpload: string }>(ctx, 'mutation($u: ID!, $p: [UploadedPart!]!) { completeUpload(uploadId: $u, parts: $p) }', { u: s.uploadId, p: done2 })).completeUpload;
  rmSync(at, { force: true });
  return mediaId;
}

/**
 * Sends [file] as a media of [kind] for [destination]: its media id. [scope] is the id of the universe (an image or a banner
 * of a universe…) or of the discussion or playlist; [address] the posting address of a post, a reply or a quote (the
 * universe need not exist yet: its first post carries its media). Both together are refused by the server (BAD_DESTINATION).
 */
export async function sulfurUpload(ctx: Context, file: SulfurFile, kind: SulfurKind, destination: SulfurDestination, scope?: string | null, address?: string | null): Promise<string> {
  const video = kind === 'clip' || kind === 'video' ? videoFacts(file) : undefined;
  const input: Record<string, unknown> = { kind, type: file.type, size: file.bytes, destination, ...(scope ? { scope } : address ? { address } : {}), ...(video ? { durationSec: video.durationSec, orientation: video.orientation } : {}) };
  if (file.bytes > multipartAbove(ctx)) return multipart(ctx, file, input);
  ctx.progress(`Sending ${file.name} (${file.bytes >= 1048576 ? `${Math.ceil(file.bytes / 1048576)} MB` : `${Math.ceil(file.bytes / 1024)} KB`})…`);
  const grant = (await sulfurApi<{ requestUpload: Grant }>(ctx, `mutation($i: UploadInput!) { requestUpload(input: $i) { ${GRANT} } }`, { i: { ...input, sha256: sha256Of(file.path) } })).requestUpload;
  if (!grant.form) throw networkError('UPLOAD_FAILED', `${file.name}: the new backend gave no upload form`);
  await postForm(ctx, grant, file);
  return grant.mediaId;
}

/** The id of the universe at [address] (%name, %name/sub), the scope of a universe's image or banner; null when it does not exist yet. */
export async function universeIdOf(ctx: Context, address: string | null | undefined): Promise<string | null> {
  if (!address) return null;
  const name = address.split('#')[0];
  const u = (await sulfurApi<{ universe: { id: string } | null }>(ctx, 'query($n: String!) { universe(name: $n) { id } }', { n: name.startsWith('%') ? name : `%${name}` })).universe;
  return u?.id ?? null;
}

/** The state of my media (myMedia): ready, processing, refused… */
export async function mediaStates(ctx: Context, ids: string[]): Promise<{ id: string; state: string; reason: string | null }[]> {
  return ((await sulfurApi<{ myMedia: ({ id: string; state: string; reason: string | null } | null)[] }>(ctx, 'query($ids: [ID!]!) { myMedia(ids: $ids) { id state reason } }', { ids })).myMedia ?? []).filter((m): m is { id: string; state: string; reason: string | null } => !!m);
}

/** Waits until the media [id] is processed (myMedia ready), at most [maxMs]: MEDIA_REFUSED or MEDIA_FAILED with its reason. */
export async function waitReady(ctx: Context, id: string, maxMs = 3 * 60_000): Promise<void> {
  const start = ctx.now();
  for (;;) {
    const m = (await mediaStates(ctx, [id]))[0];
    if (m?.state === 'ready') return;
    if (m?.state === 'refused' || m?.state === 'failed') throw platformRefusal(m.state === 'refused' ? 'MEDIA_REFUSED' : 'MEDIA_FAILED', `The media was ${m.state}${m.reason ? ` (${m.reason})` : ''}`, { mediaId: id, reason: m.reason });
    if (ctx.now() - start > maxMs) throw networkError('MEDIA_NOT_READY', 'The media is still processing: try again in a moment', { mediaId: id });
    ctx.progress('The platform is processing the media…');
    await ctx.io.sleep(2000);
  }
}
