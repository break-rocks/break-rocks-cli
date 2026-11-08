// Specs v85.1.0 and v78.0.0: post drafts and scheduled posts, the requests to repost a post of a private
// universe, the alternative texts and subtitles of a post. Against a scripted API (no network).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cuesOf } from '../src/commands/drafts.js';
import { tools } from '../src/mcp/server.js';
import { last } from './helpers.js';
import { scripted, UUID_V7 } from './scripted.js';

describe('post drafts and scheduled posts', () => {
  it('saves, lists, schedules, cancels, publishes and deletes', async () => {
    const draft = { id: 'd1', text: 'Match tonight', universe: '%paris', publishAt: '2026-11-10T08:00:00.000Z' };
    const { h, calls } = scripted({ savePostDraft: draft, postDrafts: { items: [draft], next: null }, schedulePostDraft: draft, publishPostDraft: { id: 'p1', url: 'https://break.rocks/p/p1' }, deletePostDraft: draft });
    expect(await h.run('drafts', 'save', 'Match tonight', '--in', '%paris')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'savePostDraft', variables: { draft: { text: 'Match tonight', universe: '%paris' } } });
    expect(String(calls[0].variables.requestId)).toMatch(UUID_V7);
    expect(await h.run('drafts', 'list', '--scheduled')).toBe(0);
    expect(calls[1].variables).toEqual({ scheduled: true });
    expect(h.lines.at(-1)).toBe('d1  scheduled 2026-11-10T08:00:00.000Z  %paris  Match tonight');
    expect(await h.run('drafts', 'schedule', 'd1', '--at', '2026-11-10T08:00:00Z')).toBe(0);
    expect(calls[2]).toMatchObject({ field: 'schedulePostDraft', variables: { draftId: 'd1', publishAt: '2026-11-10T08:00:00Z' } });
    expect(await h.run('drafts', 'schedule', 'd1', '--cancel', '--json')).toBe(0);
    expect(calls[3].variables).toMatchObject({ draftId: 'd1', publishAt: null });
    expect(await h.run('drafts', 'schedule', 'd1', '--json')).toBe(2);
    expect(await h.run('drafts', 'publish', 'd1')).toBe(0);
    expect(h.lines.at(-1)).toBe('p1 posted  https://break.rocks/p/p1');
    expect(await h.run('drafts', 'delete', 'd1', '--json')).toBe(2);
    expect(await h.run('--yes', 'drafts', 'delete', 'd1', '--json')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'deletePostDraft', variables: { draftId: 'd1' } });
  });
});

describe('requests to repost', () => {
  it('asks, lists and answers', async () => {
    const req = { id: 'r1', status: 'WAITING', postId: 'p1', universe: '%club.', targetUniverse: '%paris', requester: { handle: 'alice' }, text: null };
    const { h, calls } = scripted({ requestRepost: req, repostRequests: { items: [req], next: null }, answerRepostRequest: { ...req, status: 'ACCEPTED' } });
    expect(await h.run('reposts', 'request', 'p1', '--to', '%paris', '--text', 'Worth it')).toBe(0);
    expect(calls[0].variables).toMatchObject({ postId: 'p1', targetUniverse: '%paris', text: 'Worth it' });
    expect(await h.run('reposts', 'requests', '%paris')).toBe(0);
    expect(h.lines.at(-1)).toBe('r1  WAITING  %club. → %paris  post p1  by @alice');
    expect(await h.run('reposts', 'accept', 'r1', '--in', '%paris')).toBe(0);
    expect(await h.run('reposts', 'decline', 'r1', '--in', '%paris')).toBe(0);
    expect(calls.slice(2).map((c) => c.variables.accept)).toEqual([true, false]);
    expect(calls[2].variables).toMatchObject({ repostRequestId: 'r1', universe: '%paris' });
  });
});

describe('alternative texts and subtitles', () => {
  it('writes an alternative text, reads a suggested one, turns subtitles on and off', async () => {
    const { h, calls } = scripted({ setImageAlt: { id: 'p1' }, suggestedAlt: 'A stadium at night', setAutomaticSubtitles: { id: 'p1' } });
    expect(await h.run('posts', 'alt', 'p1', 'i1', 'The stadium')).toBe(0);
    expect(calls[0].variables).toMatchObject({ postId: 'p1', imageId: 'i1', alt: 'The stadium' });
    expect(await h.run('posts', 'suggested-alt', 'i1', '--language', 'en')).toBe(0);
    expect(h.lines.at(-1)).toBe('A stadium at night');
    expect(await h.run('posts', 'subtitles', 'off', 'p1')).toBe(0);
    expect(await h.run('posts', 'subtitles', 'on', 'p1')).toBe(0);
    expect(calls.slice(2).map((c) => c.variables.automaticSubtitles)).toEqual([false, true]);
  });
  it('corrects the subtitles from a WebVTT or SRT file', async () => {
    const { h, calls } = scripted({ correctSubtitles: { id: 'p1' } });
    writeFileSync(join(h.io.cwd, 'clip.vtt'), 'WEBVTT\n\n00:00.000 --> 00:02.500\nHello\n\n00:02.500 --> 00:01:04.000 align:start\nWorld\nagain\n');
    expect(await h.run('posts', 'subtitles', 'correct', 'p1', '--file', '@clip.vtt')).toBe(0);
    expect(calls[0].variables.cues).toEqual([{ startMs: 0, endMs: 2500, text: 'Hello' }, { startMs: 2500, endMs: 64000, text: 'World\nagain' }]);
    expect(cuesOf('1\n00:00:01,000 --> 00:00:02,000\nHi')).toEqual([{ startMs: 1000, endMs: 2000, text: 'Hi' }]);
    expect(await h.run('posts', 'subtitles', 'correct', 'p1', '--file', 'nothing here', '--json')).toBe(2);
    expect(await h.run('posts', 'subtitles', 'correct', 'p1', '--file', '@clip.vtt', '--dry-run', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ dryRun: true, operation: 'correctSubtitles' });
    expect(calls).toHaveLength(1);
  });
  it('is an MCP tool each', () => {
    const names = tools().map((t) => t.name);
    for (const n of ['drafts_list', 'drafts_save', 'drafts_schedule', 'drafts_publish', 'drafts_delete', 'reposts_request', 'reposts_accept', 'posts_alt', 'posts_subtitles_correct']) expect(names).toContain(`breakrocks_${n}`);
  });
});
