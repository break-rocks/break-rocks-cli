// Media sent to the platform (as the web app does,
// video.ts): checked as the apps check them before anything is sent (an image JPEG, PNG, WebP or GIF
// of at most 10 MB, its alternative text at most 1,000 characters; a video MP4, QuickTime or WebM
// of at most 512 MB), then requestMediaUpload (its kind and its media destination: a post in its
// universe, a message, a theme) and the presigned POST of S3 (its fields, then the file). The platform
// processes them afterwards: the post waits for it (IMAGE_NOT_READY, CLIP_NOT_READY: the same request sent
// again with the same requestId).
import { existsSync, openAsBlob, readFileSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import type { Context } from './context.js';
import { CliError, networkError, platformRefusal, usageError } from './errors.js';
import { uuidv7 } from './ids.js';
import { api, readSession } from './session.js';
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
export function checkVideo(ctx: Context, path: string, maxBytes = MAX_CLIP_BYTES): CheckedVideo {
  const full = fileAt(ctx, path);
  const type = videoTypeOf(new Uint8Array(readFileSync(full).subarray(0, 64)), full);
  if (!type || !VIDEO_TYPES.includes(type)) throw usageError('VIDEO_TYPE_NOT_SUPPORTED', `${path}: a video is an MP4, a MOV or a WebM`, { path });
  const bytes = statSync(full).size;
  if (bytes < 1) throw usageError('VIDEO_SIZE_INVALID', `${path} is empty`, { path });
  if (bytes > maxBytes) throw usageError('CLIP_TOO_LARGE', `${path}: at most ${Math.round(maxBytes / 1048576)} MB`, { path, bytes });
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

/** Where a media goes (MediaDestination), and for a post the universe of its posting address (none: the personal space). */
export type MediaTarget = { destination: 'POST' | 'DIRECT_MESSAGE' | 'GROUP_MESSAGE' | 'CHANNEL_MESSAGE' | 'THEME' | 'UNIVERSE_BANNER' | 'UNIVERSE_IMAGE'; address?: string | null };

// ---- Media licenses (specs v101.8.0, D-309, media-licenses.feature) ----

/** The media licenses of a video of a post, a reply or a quote (MediaLicense). */
export const MEDIA_LICENSES = ['CC0', 'CC_BY', 'CC_BY_SA', 'PUBLIC_DOMAIN', 'OWN_WORK_ALL_RIGHTS'] as const;
export type MediaLicense = (typeof MEDIA_LICENSES)[number];
export const MAX_ATTRIBUTION = 200;
/** The media license declared with a video, and its attribution (the author and the source of the work). */
export type LicenseChoice = { license: MediaLicense; attribution?: string };
const LICENSE_NAMES: Record<MediaLicense, string> = { CC0: 'CC0', CC_BY: 'CC BY', CC_BY_SA: 'CC BY-SA', PUBLIC_DOMAIN: 'Public domain', OWN_WORK_ALL_RIGHTS: 'All rights reserved' };

/** The line of a media license, as shown under the video: "CC BY · Jane Doe", "CC0", "Public domain", "All rights reserved"; none: undefined. */
export function licenseLine(media: { license?: string | null; attribution?: string | null } | null | undefined): string | undefined {
  const license = media?.license as MediaLicense | undefined;
  if (!license) return undefined;
  const name = LICENSE_NAMES[license] ?? license;
  return media?.attribution ? `${name} · ${media.attribution}` : name;
}

/** "cc-by", "CC BY", "cc_by_sa", "public domain" → the value of MediaLicense; anything else: undefined. */
export function licenseOf(raw: string): MediaLicense | undefined {
  const value = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return (MEDIA_LICENSES as readonly string[]).includes(value) ? value as MediaLicense : undefined;
}

/** Whether the profile acts as a delegated agent (the BREAKROCKS_* variables, a local agent, a profile or a session of a delegated agent). */
export function actsAsDelegatedAgent(ctx: Context): boolean {
  if (ctx.env.BREAKROCKS_OPERATOR_ID?.trim() && ctx.env.BREAKROCKS_AGENT_ID?.trim() && ctx.env.BREAKROCKS_AGENT_KEY) return true;
  const profile = ctx.profile();
  if (profile.kind === 'agent' || profile.localAgent) return true;
  return readSession(ctx)?.kind === 'agent';
}

/**
 * --license and --attribution checked as the platform checks them, before anything is sent: a media license for
 * the video of a post, a reply or a quote only, an attribution with a media license only (MEDIA_LICENSE_NOT_ALLOWED);
 * at most 200 visible characters (MEDIA_ATTRIBUTION_TOO_LONG); required for CC BY and CC BY-SA
 * (MEDIA_ATTRIBUTION_REQUIRED); and from a delegated agent, a media license for every video (MEDIA_LICENSE_REQUIRED).
 */
export function checkLicense(ctx: Context, given: { license?: string; attribution?: string }, hasVideo: boolean): LicenseChoice | undefined {
  const attribution = given.attribution?.trim() || undefined;
  if (given.license === undefined) {
    if (attribution) throw usageError('MEDIA_LICENSE_NOT_ALLOWED', 'An attribution goes with a media license: give --license too');
    if (hasVideo && actsAsDelegatedAgent(ctx)) throw usageError('MEDIA_LICENSE_REQUIRED', `A delegated agent declares the media license of every video it posts: --license ${MEDIA_LICENSES.join('|')} (with --attribution "<author, source>" for CC_BY and CC_BY_SA)`);
    return undefined;
  }
  const license = licenseOf(given.license);
  if (!license) throw usageError('INVALID_INPUT', `--license: one of ${MEDIA_LICENSES.join(', ')}`);
  if (!hasVideo) throw usageError('MEDIA_LICENSE_NOT_ALLOWED', 'A media license is declared for the video of a post, a reply or a quote only (--video or --long-video)');
  if (attribution && graphemes(attribution) > MAX_ATTRIBUTION) throw usageError('MEDIA_ATTRIBUTION_TOO_LONG', `An attribution has at most ${MAX_ATTRIBUTION} visible characters (${graphemes(attribution)} given)`);
  if (!attribution && (license === 'CC_BY' || license === 'CC_BY_SA')) throw usageError('MEDIA_ATTRIBUTION_REQUIRED', `The media license ${LICENSE_NAMES[license]} requires an attribution, the author and the source of the work: --attribution "<author, source>"`);
  return { license, ...(attribution ? { attribution } : {}) };
}

/** The refusals of a media license by the platform, said plainly (their code kept). */
const LICENSE_REFUSALS: Record<string, string> = {
  MEDIA_LICENSE_REQUIRED: 'A delegated agent declares the media license of every video it posts: give --license',
  MEDIA_ATTRIBUTION_REQUIRED: 'CC BY and CC BY-SA require an attribution, the author and the source of the work: give --attribution',
  MEDIA_ATTRIBUTION_TOO_LONG: `An attribution has at most ${MAX_ATTRIBUTION} visible characters`,
  MEDIA_LICENSE_NOT_ALLOWED: 'A media license is declared for the video of a post, a reply or a quote only, and an attribution goes with a media license',
};

/** VIDEO_QUOTA_EXCEEDED said plainly: never paid, with x402 or otherwise. */
export function videoQuotaRefusal(error: CliError): CliError {
  const info = (error.details as { errorInfo?: { minutesLeft?: number; retryAt?: string } }).errorInfo;
  const left = info?.minutesLeft !== undefined ? ` (${info.minutesLeft} minutes left${info.retryAt ? `, more back at ${info.retryAt}` : ''})` : '';
  return platformRefusal(error.code, `The video quota of 30 days is reached${left}: it cannot be paid for, not even with x402 (videos quota)`, error.details);
}

/** A refusal of the platform said plainly, for the media license and the video quota. */
export function plainRefusal(error: unknown): unknown {
  if (!(error instanceof CliError) || error.source !== 'platform') return error;
  if (LICENSE_REFUSALS[error.code]) return platformRefusal(error.code, LICENSE_REFUSALS[error.code], error.details);
  if (error.code === 'VIDEO_QUOTA_EXCEEDED') return videoQuotaRefusal(error);
  return error;
}

async function requestUpload(ctx: Context, kind: 'IMAGE' | 'VIDEO' | 'LONG_VIDEO', file: { type: string; bytes: number }, target: MediaTarget, choice?: LicenseChoice): Promise<Form> {
  const input = { kind, contentType: file.type, size: file.bytes, destination: target.destination, ...(target.destination === 'POST' && target.address ? { address: target.address } : {}), ...(choice ? { license: choice.license, ...(choice.attribution ? { attribution: choice.attribution } : {}) } : {}) };
  try {
    return (await api<{ requestMediaUpload: Form }>(ctx, 'mutation($i: MediaUploadInput!, $r: ID!) { requestMediaUpload(input: $i, requestId: $r) { id url fields } }', { i: input, r: uuidv7(ctx.now()) })).requestMediaUpload;
  } catch (error) { throw plainRefusal(error); }
}

/** Sends an image checked for [target]: its upload id. */
export async function uploadImage(ctx: Context, image: CheckedImage, target: MediaTarget): Promise<string> {
  ctx.progress(`Sending ${image.name} (${Math.ceil(image.bytes / 1024)} KB)…`);
  return send(ctx, await requestUpload(ctx, 'IMAGE', image, target), image);
}

/** Sends a video checked for [target], under its media license if one is declared: its upload id (the clip of a post or a message once converted). */
export async function uploadVideo(ctx: Context, video: CheckedVideo, target: MediaTarget, kind: 'VIDEO' | 'LONG_VIDEO' = 'VIDEO', choice?: LicenseChoice): Promise<string> {
  ctx.progress(`Sending ${video.name} (${Math.ceil(video.bytes / 1048576)} MB)${choice ? ` under ${licenseLine(choice)}` : ''}…`);
  return send(ctx, await requestUpload(ctx, kind, video, target, choice), video);
}

/** Sends the avatar of the account (requestAvatarUpload: a JPEG, PNG or WebP image): its upload id, for updateProfile. */
export async function uploadAvatar(ctx: Context, image: CheckedImage): Promise<string> {
  ctx.progress(`Sending ${image.name} (${Math.ceil(image.bytes / 1024)} KB)…`);
  const form = (await api<{ requestAvatarUpload: Form }>(ctx, 'mutation($c: String!, $r: ID!) { requestAvatarUpload(contentType: $c, requestId: $r) { id url fields } }', { c: image.type, r: uuidv7(ctx.now()) })).requestAvatarUpload;
  return send(ctx, form, image);
}

/** A course document or a post document (specs v87.5.0, D-268): a PDF of 20 MB at most, or a markdown text of 200 KB at most. */
export const DOCUMENT_TYPES: Record<string, { type: string; max: number }> = { '.pdf': { type: 'application/pdf', max: 20 * 1024 * 1024 }, '.md': { type: 'text/markdown', max: 200 * 1024 }, '.markdown': { type: 'text/markdown', max: 200 * 1024 } };
export type CheckedDocument = { path: string; name: string; type: string; bytes: number };
export function checkDocument(ctx: Context, path: string): CheckedDocument {
  const full = fileAt(ctx, path);
  const kind = DOCUMENT_TYPES[extname(full).toLowerCase()];
  if (!kind) throw usageError('DOCUMENT_FORMAT_NOT_ALLOWED', `${path}: a document is a PDF (.pdf) or a markdown text (.md)`, { path });
  if (kind.type === 'application/pdf' && String.fromCharCode(...readFileSync(full).subarray(0, 4)) !== '%PDF') throw usageError('DOCUMENT_FORMAT_NOT_ALLOWED', `${path} is not a PDF`, { path });
  const bytes = statSync(full).size;
  if (bytes > kind.max) throw usageError('DOCUMENT_TOO_LARGE', `${path}: at most ${kind.max >= 1048576 ? `${kind.max / 1048576} MB` : `${kind.max / 1024} KB`}`, { path, bytes, max: kind.max });
  return { path: full, name: basename(full), type: kind.type, bytes };
}
/** Sends a document checked (requestDocumentUpload; for a course, its playlist): its upload id. */
export async function uploadDocument(ctx: Context, doc: CheckedDocument, playlistId?: string): Promise<string> {
  ctx.progress(`Sending ${doc.name} (${Math.ceil(doc.bytes / 1024)} KB)…`);
  const input = { contentType: doc.type, size: doc.bytes, ...(playlistId ? { playlistId } : {}) };
  const form = (await api<{ requestDocumentUpload: Form }>(ctx, 'mutation($i: DocumentUploadInput!, $r: ID!) { requestDocumentUpload(input: $i, requestId: $r) { id url fields } }', { i: input, r: uuidv7(ctx.now()) })).requestDocumentUpload;
  return send(ctx, form, doc);
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
