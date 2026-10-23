// Media sent to the platform (as the web app does,
// video.ts): checked as the apps check them before anything is sent (an image JPEG, PNG, WebP or GIF
// of at most 10 MB, its alternative text at most 1,000 characters; a video MP4, QuickTime or WebM
// of at most 512 MB), then requestImageUpload / requestVideoUpload and the presigned POST of S3 (its
// fields, then the file). The platform processes them afterwards: the post waits for it
// (IMAGE_NOT_READY, CLIP_NOT_READY: the same request sent again with the same requestId).
import { existsSync, openAsBlob, readFileSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import type { Context } from './context.js';
import { CliError, networkError, usageError } from './errors.js';
import { api } from './session.js';
import { imageInfo } from './theme/images.js';

export const MAX_POST_IMAGES = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_ALT = 1000;
export const MAX_CLIP_BYTES = 512 * 1024 * 1024;
export const MAX_POST_TEXT = 1000;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length;

export type CheckedImage = { path: string; name: string; type: string; bytes: number; width?: number; height?: number; alt?: string };
export type CheckedVideo = { path: string; name: string; type: string; bytes: number };

function fileAt(ctx: Context, path: string): string {
  const full = resolve(ctx.io.cwd, path);
  if (!existsSync(full) || !statSync(full).isFile()) throw usageError('FILE_NOT_FOUND', `No file ${path}`, { path });
  return full;
}

/** An image checked before it is sent ([maxBytes]: 10 MB for a post, 5 MB for a theme). */
export function checkImage(ctx: Context, path: string, alt?: string, maxBytes = MAX_IMAGE_BYTES, types = IMAGE_TYPES): CheckedImage {
  const full = fileAt(ctx, path);
  const head = new Uint8Array(readFileSync(full).subarray(0, 64 * 1024));
  const info = imageInfo(head);
  if (!info || !types.includes(info.type)) throw usageError('IMAGE_TYPE_NOT_SUPPORTED', `${path}: an image is ${types.map((t) => t.replace('image/', '').toUpperCase()).join(', ')}`, { path });
  const bytes = statSync(full).size;
  if (bytes > maxBytes) throw usageError('IMAGE_TOO_LARGE', `${path}: ${(bytes / 1048576).toFixed(1)} MB, at most ${maxBytes / 1048576} MB`, { path, bytes });
  if (alt !== undefined && graphemes(alt) > MAX_ALT) throw usageError('IMAGE_ALT_TOO_LONG', `The alternative text of ${path} has more than ${MAX_ALT} characters`, { path });
  return { path: full, name: basename(full), type: info.type, bytes, width: info.width, height: info.height, ...(alt ? { alt } : {}) };
}

/** The type of a video from its first bytes (MP4 or QuickTime by the brand of "ftyp", WebM by EBML), else by its extension. */
export function videoTypeOf(head: Uint8Array, name: string): string | undefined {
  const ascii = (i: number, n: number) => String.fromCharCode(...head.subarray(i, i + n));
  if (head.length >= 12 && ascii(4, 4) === 'ftyp') return ascii(8, 4) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  if (head.length >= 4 && head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3) return 'video/webm';
  return { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' }[extname(name).toLowerCase()];
}

/** A video checked before it is sent. */
export function checkVideo(ctx: Context, path: string): CheckedVideo {
  const full = fileAt(ctx, path);
  const type = videoTypeOf(new Uint8Array(readFileSync(full).subarray(0, 64)), full);
  if (!type || !VIDEO_TYPES.includes(type)) throw usageError('VIDEO_TYPE_NOT_SUPPORTED', `${path}: a video is an MP4, a MOV or a WebM`, { path });
  const bytes = statSync(full).size;
  if (bytes < 1) throw usageError('VIDEO_SIZE_INVALID', `${path} is empty`, { path });
  if (bytes > MAX_CLIP_BYTES) throw usageError('CLIP_TOO_LARGE', `${path}: at most 512 MB`, { path, bytes });
  return { path: full, name: basename(full), type, bytes };
}

/** The text of a post checked (POST_TEXT_TOO_LONG beyond 1,000 visible characters). */
export function checkText(text: string): string {
  if (graphemes(text) > MAX_POST_TEXT) throw usageError('POST_TEXT_TOO_LONG', `The text has ${graphemes(text)} characters, at most ${MAX_POST_TEXT}`);
  return text;
}

type Form = { id: string; url: string; fields: string | Record<string, string> };

async function send(ctx: Context, form: Form, file: { path: string; type: string; name: string }): Promise<string> {
  const fields = (typeof form.fields === 'string' ? JSON.parse(form.fields) : form.fields) as Record<string, string>;
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  body.append('file', await openAsBlob(file.path, { type: file.type }), file.name);
  let res: Response;
  try { res = await ctx.io.fetch(form.url, { method: 'POST', body }); } catch (e) { throw networkError('UPLOAD_FAILED', `${file.name}: ${(e as Error).message}`); }
  if (!res.ok) throw networkError('UPLOAD_FAILED', `${file.name}: the storage answered ${res.status}`, { status: res.status });
  return form.id;
}

/** Sends an image checked: its upload id. */
export async function uploadImage(ctx: Context, image: CheckedImage): Promise<string> {
  ctx.progress(`Sending ${image.name} (${Math.ceil(image.bytes / 1024)} KB)…`);
  const { requestImageUpload } = await api<{ requestImageUpload: Form }>(ctx, 'mutation($t: String!, $s: Int!) { requestImageUpload(contentType: $t, size: $s) { id url fields } }', { t: image.type, s: image.bytes });
  return send(ctx, requestImageUpload, image);
}

/** Sends a video checked: its upload id (the clip of a post once converted). */
export async function uploadVideo(ctx: Context, video: CheckedVideo): Promise<string> {
  ctx.progress(`Sending ${video.name} (${Math.ceil(video.bytes / 1048576)} MB)…`);
  const { requestVideoUpload } = await api<{ requestVideoUpload: Form }>(ctx, 'mutation($t: String!, $s: Int!) { requestVideoUpload(contentType: $t, size: $s) { id url fields } }', { t: video.type, s: video.bytes });
  return send(ctx, requestVideoUpload, video);
}

/**
 * [request] sent again while the platform processes the media (IMAGE_NOT_READY, CLIP_NOT_READY):
 * every [stepMs], at most [maxMs]; the same requestId, so nothing is made twice.
 */
export async function whileProcessing<T>(ctx: Context, request: () => Promise<T>, options: { stepMs?: number; maxMs?: number } = {}): Promise<T> {
  const step = options.stepMs ?? 2000, max = options.maxMs ?? 10 * 60_000;
  const start = ctx.now();
  for (;;) {
    try { return await request(); } catch (error) {
      if (!(error instanceof CliError) || !['IMAGE_NOT_READY', 'CLIP_NOT_READY'].includes(error.code) || ctx.now() - start + step > max) throw error;
      ctx.progress(`The platform is processing the media (${error.code}): trying again in ${step / 1000} s`);
      await ctx.io.sleep(step);
    }
  }
}
