// A long video (specs v122.3.0, D-386, long-videos.feature): native-sulfur takes it in one request up to 500 MB and in parts
// above, resumable within 24 hours (src/sulfur/media.ts). The former backend's own multipart upload (startMultipartUpload,
// completeMultipartUpload) was retired with it on 2026-11-28.
import type { Context } from './context.js';
import { type CheckedVideo, type LicenseChoice, type MediaTarget, uploadVideo } from './media.js';

/** Above it (500 MB), a long video is sent in parts. */
export const MULTIPART_MIN_BYTES = 500 * 1024 * 1024;

export type LongUpload = { id: string; forget: () => void };

/** A long video sent for [target] (in parts above 500 MB, resumable: src/sulfur/media.ts). */
export async function uploadLongVideo(ctx: Context, video: CheckedVideo, target: MediaTarget, choice?: LicenseChoice): Promise<LongUpload> {
  return { id: await uploadVideo(ctx, video, target, 'LONG_VIDEO', choice), forget: () => undefined };
}
