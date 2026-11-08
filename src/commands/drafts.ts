// Post drafts and scheduled posts (specs v85.1.0, drafts-and-scheduled-posts.feature), the requests to repost a
// post of a private universe into another universe, and what the author of a post changes on its media without
// the post being shown as changed: the alternative text of an image, the automatic subtitles of a clip and
// their corrections (v78.0.0, D-214). The writes offer --dry-run; the refusals are the platform's.
import { apiCommand } from '../api/command.js';
import { selection } from '../api/graphql.js';
import type { Context } from '../context.js';
import { usageError } from '../errors.js';
import { pageText, textOrFile } from './shared.js';

type Draft = { id: string; text?: string; universe?: string | null; publishAt?: string | null; updatedAt?: string; failure?: { code?: string } | null; images?: unknown[]; clip?: unknown };
const draftLine = (d: Draft) => `${d.id}  ${d.publishAt ? `scheduled ${d.publishAt}` : 'draft'}  ${d.universe ?? '(personal space)'}  ${(d.text ?? '').replace(/\s+/g, ' ').slice(0, 60)}${d.failure?.code ? `  failed: ${d.failure.code}` : ''}`;
const draftText = (r: unknown) => (r ? draftLine(r as Draft) : '(none)');
const draftId = { draftId: 'The post draft (its id: drafts list)' };

export const draftsList = apiCommand({
  name: 'drafts list', summary: 'The post drafts and the scheduled posts of the account (postDrafts; --scheduled: the scheduled posts only, the earliest first)',
  description: '--no-scheduled: the drafts not scheduled only. --limit from 1 to 50 (20 by default).',
  kind: 'query', op: 'postDrafts', descriptions: { scheduled: 'true: the scheduled posts only; false: the drafts not scheduled only' },
  text: pageText(draftLine),
  examples: ['breakrocks drafts list', 'breakrocks drafts list --scheduled --json'],
});
export const draftsShow = apiCommand({
  name: 'drafts show', summary: 'A post draft or a scheduled post of the account (postDraft)', kind: 'query', op: 'postDraft', positionals: ['id'], descriptions: { id: 'The post draft' },
  examples: ['breakrocks drafts show <draft id>', 'breakrocks drafts show <draft id> --json'],
});
export const draftsSave = apiCommand({
  name: 'drafts save', summary: 'Save a post draft: a new one, or the whole content of one (--draft-id) (savePostDraft)',
  description: 'The content of a post: --text, --in (a universe, or none: the personal space), --link, --images (uploaded image ids, JSON), --clip, --place, --reply-policy, --announcement. A scheduled post is locked from 1 minute before its time (SCHEDULED_POST_LOCKED); 50 drafts (100 with X2, 500 with X10: POST_DRAFT_LIMIT).',
  kind: 'mutation', op: 'savePostDraft', flatten: ['draft'], positionals: ['draft.text'], rename: { 'draft.universe': 'in' }, dry: true,
  descriptions: { ...draftId, text: 'The text of the post', in: 'Where it will be posted (%universe, %universe/sub; none: the personal space)', images: 'Images: [{ "id": <upload id>, "alt": <text> }]', place: 'Its place: { "point": { "lat", "lon" } } or { "placeId" }' },
  text: draftText,
  examples: ['breakrocks drafts save "Match tonight #football" --in %test-village-sport', 'breakrocks drafts save "The corrected text" --draft-id <draft id> --in %paris'],
});
export const draftsSchedule = apiCommand({
  name: 'drafts schedule', summary: 'Schedule a post draft: published at --at, 5 minutes to 30 days from now (--cancel: back to a draft) (schedulePostDraft)',
  description: 'For a universe or the personal space (SCHEDULED_POST_NOT_ALLOWED otherwise); 20 waiting (40 with X2, 200 with X10: SCHEDULED_POST_LIMIT); SCHEDULED_POST_TIME_INVALID out of 5 minutes to 30 days.',
  kind: 'mutation', op: 'schedulePostDraft', positionals: ['draftId'], rename: { publishAt: 'at' }, dry: true,
  descriptions: { ...draftId, at: 'When it is published (ISO 8601)' },
  extra: { cancel: { type: 'boolean', description: 'Cancel the scheduled post: it stays a post draft' } },
  prepare: (i) => {
    const { cancel, ...rest } = i;
    if (!cancel === (rest.at === undefined)) throw usageError('INVALID_INPUT', '--at <date> or --cancel, one of them');
    return cancel ? { ...rest, at: null } : rest;
  },
  text: draftText,
  examples: ['breakrocks drafts schedule <draft id> --at 2026-11-10T08:00:00Z', 'breakrocks drafts schedule <draft id> --cancel'],
});
export const draftsPublish = apiCommand({
  name: 'drafts publish', summary: 'Publish a post draft now, as a post (publishPostDraft): the draft is deleted once posted', kind: 'mutation', op: 'publishPostDraft', positionals: ['draftId'], descriptions: draftId, depth: 1, dry: true,
  text: (r) => { const p = r as { id?: string; url?: string } | null; return p ? `${p.id} posted${p.url ? `  ${p.url}` : ''}` : '(none)'; },
  examples: ['breakrocks drafts publish <draft id>'],
});
export const draftsDelete = apiCommand({
  name: 'drafts delete', summary: 'Delete a post draft or a scheduled post, with the media it alone holds (deletePostDraft)', kind: 'mutation', op: 'deletePostDraft', positionals: ['draftId'], descriptions: draftId,
  confirm: (i) => `Delete the post draft ${String(i.draftId)}?`, text: (r) => (r ? `${(r as Draft).id} deleted` : '(none)'),
  examples: ['breakrocks drafts delete <draft id> --yes'],
});

// ---- Requests to repost a post of a private universe ----

type RepostRequest = { id: string; status: string; postId: string; universe: string; targetUniverse: string; requester?: { handle?: string } | null; text?: string | null; expiresAt?: string };
const repostRequestLine = (x: RepostRequest) => `${x.id}  ${x.status}  ${x.universe} → ${x.targetUniverse}  post ${x.postId}  by ${x.requester?.handle ? `@${x.requester.handle}` : '-'}${x.text ? `  "${x.text}"` : ''}`;
export const repostsRequest = apiCommand({
  name: 'reposts request', summary: 'Ask to repost a post of a private universe one is a member of into another universe (requestRepost; --text: as a quote)',
  description: 'The moderation of the target universe answers it (reposts accept or decline).',
  kind: 'mutation', op: 'requestRepost', positionals: ['postId'], rename: { targetUniverse: 'to' }, dry: true,
  descriptions: { postId: 'The post of the private universe', to: 'The universe it would be reposted into (a posting address)', text: 'A text of one\'s own: a quote' },
  text: (r) => (r ? repostRequestLine(r as RepostRequest) : '(none)'),
  examples: ['breakrocks reposts request <post id> --to %paris', 'breakrocks reposts request <post id> --to %paris --text "Worth reading"'],
});
export const repostsRequests = apiCommand({
  name: 'reposts requests', summary: 'The requests to repost a post of a private universe into a universe, waiting for its moderation (repostRequests)', kind: 'query', op: 'repostRequests', positionals: ['universe'],
  text: pageText(repostRequestLine), examples: ['breakrocks reposts requests %paris', 'breakrocks reposts requests %paris --all --json'],
});
const answerRepost = (accept: boolean) => apiCommand({
  name: `reposts ${accept ? 'accept' : 'decline'}`, summary: `${accept ? 'Accept' : 'Decline'} a request to repost a post of a private universe into a universe one moderates (answerRepostRequest)${accept ? ': the post is reposted' : ''}`,
  kind: 'mutation', op: 'answerRepostRequest', fixed: { accept }, positionals: ['repostRequestId'], rename: { universe: 'in' }, dry: true,
  descriptions: { repostRequestId: 'The request (reposts requests)', in: 'The universe it would be reposted into' },
  text: (r) => (r ? repostRequestLine(r as RepostRequest) : '(none)'),
  examples: [`breakrocks reposts ${accept ? 'accept' : 'decline'} <request id> --in %paris`],
});
export const repostsAccept = answerRepost(true);
export const repostsDecline = answerRepost(false);

// ---- The media of a post: alternative texts and subtitles ----

const POST1 = selection('Post', 1);
const postDone = (what: string) => (r: unknown) => { const p = r as { id?: string } | null; return p ? `${p.id}: ${what}` : '(none)'; };
export const postsAlt = apiCommand({
  name: 'posts alt', summary: 'Write the alternative text of an image of one\'s post in place of its automatic one, once per image (setImageAlt)',
  description: 'The post is not shown as changed; an image whose author already wrote its alternative text: IMAGE_ALT_ALREADY_WRITTEN (posts edit changes it within the edit window).',
  kind: 'mutation', op: 'setImageAlt', positionals: ['postId', 'imageId', 'alt'], select: POST1, dry: true,
  descriptions: { postId: 'The post', imageId: 'The image of the post', alt: 'The alternative text (1,000 visible characters at most)' },
  text: postDone('alternative text written'),
  examples: ['breakrocks posts alt <post id> <image id> "The stadium at night"'],
});
export const postsSuggestedAlt = apiCommand({
  name: 'posts suggested-alt', summary: 'The alternative text a platform AI agent suggests for an image uploaded for a post (suggestedAlt)',
  description: 'Written once per image (asked again: the same text); sent back unchanged as the "alt" of the image, it is marked as suggested by AI. 20 an hour and 100 a day per account.',
  kind: 'query', op: 'suggestedAlt', positionals: ['imageId'], descriptions: { imageId: 'The upload id of the image (destination POST)', language: 'The language of the text (ISO 639-1: fr, en…)' },
  text: (r) => (typeof r === 'string' ? r : '(none: the agent wrote none)'),
  examples: ['breakrocks posts suggested-alt <upload id> --language en'],
});
const subtitles = (on: boolean) => apiCommand({
  name: `posts subtitles ${on ? 'on' : 'off'}`, summary: `Turn the automatic subtitles of the clip of one's post ${on ? 'back on' : 'off'} (setAutomaticSubtitles)`,
  kind: 'mutation', op: 'setAutomaticSubtitles', fixed: { automaticSubtitles: on }, positionals: ['postId'], select: POST1, dry: true, descriptions: { postId: 'The post with a clip' },
  text: postDone(`automatic subtitles ${on ? 'on' : 'off'}`), examples: [`breakrocks posts subtitles ${on ? 'on' : 'off'} <post id>`],
});
export const postsSubtitlesOn = subtitles(true);
export const postsSubtitlesOff = subtitles(false);

/** "00:01:02,500" or "01:02.500" → milliseconds. */
function msOf(t: string): number {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(t.trim());
  if (!m) throw usageError('SUBTITLE_CUES_INVALID', `"${t}" is not a time of a cue (00:01:02.500)`);
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4].padEnd(3, '0'));
}
/** The cues of a WebVTT or SRT text, or of their JSON ([{ startMs, endMs, text }]). */
export function cuesOf(text: string): { startMs: number; endMs: number; text: string }[] {
  const s = text.replace(/^﻿/, '').trim();
  if (s.startsWith('[')) {
    try { return JSON.parse(s); } catch { throw usageError('SUBTITLE_CUES_INVALID', 'The cues: JSON expected'); }
  }
  const cues: { startMs: number; endMs: number; text: string }[] = [];
  for (const block of s.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [start, end] = lines[at].split('-->').map((x) => x.trim().split(/\s+/)[0]);
    cues.push({ startMs: msOf(start), endMs: msOf(end), text: lines.slice(at + 1).join('\n').trim() });
  }
  if (!cues.length) throw usageError('SUBTITLE_CUES_INVALID', 'No cue found: WebVTT, SRT or the JSON of the cues');
  return cues;
}
export const postsSubtitlesCorrect = apiCommand({
  name: 'posts subtitles correct', summary: 'Correct the subtitles of the clip of one\'s post: every cue, in order, from a WebVTT or SRT file (correctSubtitles)',
  description: 'Each cue changed becomes the text of the author (marked corrected), translated again; a version of the post history. --cues: @file.vtt, @file.srt, or the JSON [{ "startMs", "endMs", "text" }].',
  kind: 'mutation', op: 'correctSubtitles', positionals: ['postId'], hide: ['cues'], select: POST1, dry: true,
  extra: { file: { type: 'string', description: 'The cues: @file.vtt, @file.srt, or their JSON [{ "startMs", "endMs", "text" }]' } }, require: ['file'],
  descriptions: { postId: 'The post with a clip' },
  prepare: (i, ctx: Context) => { const { file, ...rest } = i; return { ...rest, cues: cuesOf(textOrFile(ctx, String(file))) }; },
  text: postDone('subtitles corrected'),
  examples: ['breakrocks posts subtitles correct <post id> --file @clip.vtt', 'breakrocks posts subtitles correct <post id> --file @clip.srt --dry-run'],
});
