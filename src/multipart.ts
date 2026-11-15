// The multipart upload of a long video of more than 500 MB (specs v122.3.0, D-386, long-videos.feature): startMultipartUpload
// answers the parts and their signed URLs, each part is sent with a PUT (read from the file by a slice, never the whole
// file in memory), retried alone when it fails, then completeMultipartUpload gives the ETag of each part. The upload is
// resumable within 24 hours: the requestId and the parts done (number → ETag) are kept in a small state file of the
// configuration folder (uploads/<key>.json, no URL, no secret), so a second run of the same command starts again with
// the same requestId (the platform answers the same upload) and sends only the parts that are missing.
import { createHash } from 'node:crypto';
import { existsSync, openAsBlob, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writePrivate } from './config.js';
import type { Context } from './context.js';
import { CliError, networkError } from './errors.js';
import { uuidv7 } from './ids.js';
import { type CheckedVideo, type LicenseChoice, type MediaTarget, plainRefusal, uploadVideo } from './media.js';
import { api } from './session.js';

/** Above it (500 MB), a long video is uploaded in parts; at or below it, with requestMediaUpload. */
export const MULTIPART_MIN_BYTES = 500 * 1024 * 1024;
const PART_ATTEMPTS = 4;

type Part = { number: number; url: string };
type Started = { mediaId: string; parts: Part[]; partSize: number; expiresAt: string };
type State = {
  version: 1; requestId: string; completeRequestId: string; file: string; size: number; mtimeMs: number; type: string; address: string | null;
  mediaId?: string; expiresAt?: string; parts: Record<string, string>;
};

/** What a started upload gives back: the media id for createPost, and `forget` once the post is created (the state file goes). */
export type LongUpload = { id: string; forget: () => void };

const START = 'mutation($i: MultipartUploadInput!, $r: ID!) { startMultipartUpload(input: $i, requestId: $r) { mediaId partSize expiresAt parts { number url } } }';
const COMPLETE = 'mutation($m: ID!, $p: [UploadPartDoneInput!]!, $r: ID!) { completeMultipartUpload(mediaId: $m, parts: $p, requestId: $r) }';

/** The state file of an upload: one per account, file (with its size and date), destination and license. */
export function stateFileOf(ctx: Context, video: CheckedVideo, target: MediaTarget, choice?: LicenseChoice): string {
  const key = createHash('sha256').update(JSON.stringify([ctx.profileName, ctx.profile().env, video.path, video.bytes, Math.round(statSync(video.path).mtimeMs), video.type, target.address ?? null, choice?.license ?? null, choice?.attribution ?? null])).digest('hex').slice(0, 32);
  return join(ctx.store.dir, 'uploads', `${key}.json`);
}

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(bytes >= 1048576 * 10 ? 0 : 1)} MB`;

/** One part sent with a PUT, tried again when the connection or the storage fails: its ETag. */
async function putPart(ctx: Context, video: CheckedVideo, blob: Blob, part: Part, start: number, end: number): Promise<string> {
  let failure = '';
  for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt++) {
    try {
      const res = await ctx.io.fetch(part.url, { method: 'PUT', body: blob.slice(start, end) });
      if (res.ok) {
        const etag = res.headers.get('etag');
        if (!etag) throw networkError('UPLOAD_FAILED', `${video.name}: the storage gave no ETag for the part ${part.number}`);
        return etag;
      }
      failure = `the storage answered ${res.status}`;
      // A refusal that another try does not change (an expired or wrong signature): the next run asks new URLs.
      if (res.status < 500 && res.status !== 408 && res.status !== 429) throw networkError('UPLOAD_FAILED', `${video.name}: the part ${part.number}: ${failure}`, { status: res.status, part: part.number });
    } catch (error) {
      if (error instanceof CliError) throw error;
      failure = (error as Error).message;
    }
    if (attempt < PART_ATTEMPTS) {
      ctx.progress(`Part ${part.number}: ${failure}; trying again (${attempt}/${PART_ATTEMPTS - 1})`);
      await ctx.io.sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw networkError('UPLOAD_FAILED', `${video.name}: the part ${part.number} failed after ${PART_ATTEMPTS} tries (${failure})`, { part: part.number });
}

/**
 * A multipart upload of [video] for [target]: its media id (completeMultipartUpload done). [stateFile] keeps the requestId and
 * the parts done; an upload that was cut off is resumed from them (the same command again, within 24 hours).
 */
export async function uploadMultipart(ctx: Context, video: CheckedVideo, target: MediaTarget, choice?: LicenseChoice): Promise<LongUpload> {
  const stateFile = stateFileOf(ctx, video, target, choice);
  const fresh = (): State => ({ version: 1, requestId: uuidv7(ctx.now()), completeRequestId: uuidv7(ctx.now()), file: video.path, size: video.bytes, mtimeMs: Math.round(statSync(video.path).mtimeMs), type: video.type, address: target.address ?? null, parts: {} });
  let state = readJson<State>(stateFile);
  if (!state || state.version !== 1 || state.size !== video.bytes || (state.expiresAt && Date.parse(state.expiresAt) <= ctx.now())) state = fresh();
  const save = () => writePrivate(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const forget = () => { rmSync(stateFile, { force: true }); };
  const blob = await openAsBlob(video.path);
  const input = { contentType: video.type, size: video.bytes, ...(target.address ? { address: target.address } : {}), ...(choice ? { license: choice.license, ...(choice.attribution ? { attribution: choice.attribution } : {}) } : {}) };

  for (let round = 1; ; round++) {
    save();
    let started: Started;
    try { started = (await api<{ startMultipartUpload: Started }>(ctx, START, { i: input, r: state.requestId })).startMultipartUpload; } catch (error) {
      // Refused by the platform before any part was sent: nothing to resume.
      if (error instanceof CliError && error.source === 'platform' && !Object.keys(state.parts).length) forget();
      throw plainRefusal(error);
    }
    state.mediaId = started.mediaId; state.expiresAt = started.expiresAt;
    save();
    const total = started.parts.length;
    const already = started.parts.filter((p) => state!.parts[String(p.number)]).length;
    ctx.progress(already ? `Resuming ${video.name}: ${already} of ${total} parts already sent` : `Sending ${video.name} (${mb(video.bytes)}) in ${total} parts…`);
    for (const part of started.parts) {
      if (state.parts[String(part.number)]) continue;
      const start = (part.number - 1) * started.partSize, end = Math.min(part.number * started.partSize, video.bytes);
      try { state.parts[String(part.number)] = await putPart(ctx, video, blob, part, start, end); } catch (error) {
        save();
        if (error instanceof CliError) throw new CliError(error.code, `${error.message}. ${Object.keys(state.parts).length} of ${total} parts are kept: run the same command again within 24 hours to resume`, error.exit, error.details, error.source);
        throw error;
      }
      save();
      ctx.progress(`Part ${part.number}/${total} sent (${Math.min(100, Math.floor(end / video.bytes * 100))} %, ${mb(end)} of ${mb(video.bytes)})`);
    }
    const done = started.parts.map((p) => ({ number: p.number, etag: state!.parts[String(p.number)] }));
    try {
      await api<{ completeMultipartUpload: boolean }>(ctx, COMPLETE, { m: started.mediaId, p: done, r: state.completeRequestId });
    } catch (error) {
      // A part missing or whose ETag does not match: the parts kept are not trusted, everything is sent again once.
      if (error instanceof CliError && error.code === 'UPLOAD_PARTS_MISSING' && round === 1) {
        ctx.progress('The platform did not find every part: sending them again');
        state.parts = {};
        continue;
      }
      throw plainRefusal(error);
    }
    return { id: started.mediaId, forget };
  }
}

/** A long video sent for [target]: with requestMediaUpload up to 500 MB, in parts above (resumable). */
export async function uploadLongVideo(ctx: Context, video: CheckedVideo, target: MediaTarget, choice?: LicenseChoice): Promise<LongUpload> {
  if (video.bytes <= MULTIPART_MIN_BYTES) return { id: await uploadVideo(ctx, video, target, 'LONG_VIDEO', choice), forget: () => undefined };
  return uploadMultipart(ctx, video, target, choice);
}

/** Whether a state file of an upload is kept for [video] (a first run was cut off). */
export const hasUploadState = (ctx: Context, video: CheckedVideo, target: MediaTarget, choice?: LicenseChoice) => existsSync(stateFileOf(ctx, video, target, choice));
