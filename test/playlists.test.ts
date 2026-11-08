// Specs v86.0.0 to v101.3.0: playlists (their forms, the form ROUTE and its stages, courses with links and
// documents), long videos (chapters, playback, quota) and a post with a long video. Against a scripted API.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chaptersOf } from '../src/commands/playlists.js';
import { last } from './helpers.js';
import { scripted } from './scripted.js';

const playlist = { id: 'pl1', address: '@erin>walk', name: 'walk', kind: 'ACCOUNT', form: 'ROUTE', visibility: 'PUBLIC', itemCount: 2, followed: false, pinned: false, route: { id: 'rt1', name: 'Canal' } };

describe('playlists', () => {
  it('creates one of the form ROUTE, adds an item tied to a stage, reads it back with its stages', async () => {
    const { h, calls } = scripted({
      createPlaylist: playlist, addToPlaylist: playlist,
      playlist: (v: Record<string, unknown>) => (calls.length && calls.at(-1)!.query.includes('entries') ? { ...playlist, entries: { entries: [{ item: { position: 1, kind: 'VIDEO', stageIndex: 2, watched: true, post: { id: 'p1', text: 'The lock' } } }, { courseItem: { id: 'c1', position: 2, kind: 'LINK', title: 'Map', url: 'https://example.org' } }] } } : { id: v.a === '@erin>walk' ? 'pl1' : 'other' }),
    });
    expect(await h.run('playlists', 'create', 'walk', '--kind', 'ACCOUNT', '--form', 'ROUTE', '--route-id', 'rt1')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'createPlaylist', variables: { input: { name: 'walk', kind: 'ACCOUNT', form: 'ROUTE', routeId: 'rt1' } } });
    expect(h.lines.at(-1)).toBe('@erin>walk  walk  ACCOUNT/ROUTE  PUBLIC  2 items  route Canal  [pl1]');
    expect(await h.run('playlists', 'add', '@erin>walk', 'p1', '--stage', '2')).toBe(0);
    expect(calls[1]).toMatchObject({ field: 'playlist', variables: { a: '@erin>walk' } });
    expect(calls[2]).toMatchObject({ field: 'addToPlaylist', variables: { playlistId: 'pl1', postId: 'p1', stageIndex: 2 } });
    expect(calls[2].query).not.toContain('passageStartMs');
    expect(await h.run('playlists', 'show', '@erin>walk')).toBe(0);
    expect(calls[3].query).toContain('stageIndex');
    expect(h.lines.at(-1)).toBe(['@erin>walk  walk  ACCOUNT/ROUTE  PUBLIC  2 items  route Canal  [pl1]', '1. VIDEO stage 2 ✓  p1  The lock', '2. LINK  Map  https://example.org  [c1]'].join('\n'));
  });
  it('changes, moves, follows, pins, tags and tracks by id; deletes only with yes', async () => {
    const { h, calls } = scripted({ updatePlaylist: playlist, movePlaylistItem: playlist, setPlaylistFollow: playlist, pinPlaylist: playlist, setPlaylistItemTags: playlist, setPlaylistTrack: playlist, setPlaylistTracks: playlist, deletePlaylist: true, removeFromPlaylist: true });
    const runs: [string[], string, Record<string, unknown>][] = [
      [['edit', 'pl1', '--visibility', 'UNLISTED'], 'updatePlaylist', { playlistId: 'pl1', input: { visibility: 'UNLISTED' } }],
      [['move', 'pl1', 'p1', '1'], 'movePlaylistItem', { playlistId: 'pl1', postId: 'p1', position: 1 }],
      [['remove', 'pl1', 'p1'], 'removeFromPlaylist', { playlistId: 'pl1', postId: 'p1' }],
      [['follow', '@erin>walk'], 'setPlaylistFollow', { address: '@erin>walk', following: true }],
      [['unfollow', '@erin>walk'], 'setPlaylistFollow', { following: false }],
      [['pin', 'pl1'], 'pinPlaylist', { playlistId: 'pl1', pinned: true }],
      [['unpin', 'pl1'], 'pinPlaylist', { pinned: false }],
      [['tags', 'pl1', 'p1', 'basics', 'video'], 'setPlaylistItemTags', { postId: 'p1', tags: ['basics', 'video'] }],
      [['track', 'pl1', 'quick'], 'setPlaylistTrack', { track: 'quick' }],
      [['tracks', 'pl1', '--tracks', '[{"name":"quick","title":"Quick","tags":["basics"]}]'], 'setPlaylistTracks', { tracks: [{ name: 'quick', title: 'Quick', tags: ['basics'] }] }],
    ];
    for (const [args, field, variables] of runs) {
      expect(await h.run('playlists', ...args, '--json'), args.join(' ')).toBe(0);
      expect(calls.at(-1), args.join(' ')).toMatchObject({ field, variables });
    }
    expect(await h.run('playlists', 'delete', 'pl1', '--json')).toBe(2);
    expect(await h.run('--yes', 'playlists', 'delete', 'pl1')).toBe(0);
    expect(h.lines.at(-1)).toBe('done');
  });
  it('adds a course link, and a course document sent with its form then added', async () => {
    const { h, calls } = scripted({ addLinkToPlaylist: playlist, requestDocumentUpload: { id: 'up1', url: 'https://s3.test/upload', fields: '{"key":"k"}' }, addDocumentToPlaylist: playlist });
    expect(await h.run('playlists', 'add-link', 'pl1', '--title', 'Ref', '--url', 'https://example.org/ref')).toBe(0);
    expect(calls[0].variables).toMatchObject({ playlistId: 'pl1', input: { title: 'Ref', url: 'https://example.org/ref' } });
    writeFileSync(join(h.io.cwd, 'notes.pdf'), '%PDF-1.7\n…');
    writeFileSync(join(h.io.cwd, 'notes.txt'), 'x');
    expect(await h.run('playlists', 'add-doc', 'pl1', 'notes.txt', '--rights-confirmed', '--json')).toBe(2);
    expect(await h.run('playlists', 'add-doc', 'pl1', 'notes.pdf', '--json')).toBe(2);
    expect(await h.run('playlists', 'add-doc', 'pl1', 'notes.pdf', '--rights-confirmed', '--title', 'Notes', '--dry-run', '--json')).toBe(0);
    expect(calls).toHaveLength(1);
    expect(await h.run('playlists', 'add-doc', 'pl1', 'notes.pdf', '--rights-confirmed', '--title', 'Notes')).toBe(0);
    expect(calls.slice(1).map((c) => c.field)).toEqual(['requestDocumentUpload', 'POST https://s3.test/upload', 'addDocumentToPlaylist']);
    expect(calls[1].variables.i).toEqual({ contentType: 'application/pdf', size: 12, playlistId: 'pl1' });
    expect(calls[3].variables).toMatchObject({ playlistId: 'pl1', input: { uploadId: 'up1', rightsConfirmed: true, title: 'Notes' } });
  });
  it('checks items, resets the progress, hides the checkmarks, changes and removes a course item', async () => {
    const { h, calls } = scripted({ checkPlaylistItem: true, checkPlaylistCourseItem: true, resetPlaylistProgress: true, setPlaylistCheckmarks: playlist, updatePlaylistCourseItem: playlist, removePlaylistCourseItem: true });
    expect(await h.run('playlists', 'check', 'pl1', 'p1')).toBe(0);
    expect(await h.run('playlists', 'check-item', 'pl1', 'c1')).toBe(0);
    expect(await h.run('--yes', 'playlists', 'reset-progress', 'pl1')).toBe(0);
    expect(await h.run('playlists', 'checkmarks', 'pl1', '--no-shown')).toBe(0);
    expect(await h.run('playlists', 'item-edit', 'pl1', 'c1', '--title', 'New')).toBe(0);
    expect(await h.run('--yes', 'playlists', 'item-remove', 'pl1', 'c1')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['checkPlaylistItem', 'checkPlaylistCourseItem', 'resetPlaylistProgress', 'setPlaylistCheckmarks', 'updatePlaylistCourseItem', 'removePlaylistCourseItem']);
    expect(calls[3].variables).toMatchObject({ shown: false });
    expect(calls[4].variables).toMatchObject({ itemId: 'c1', input: { title: 'New' } });
  });
  it('reads the hub and the followed playlists', async () => {
    const { h } = scripted({ playlistsHub: { mine: [playlist], followed: [], watchLater: { ...playlist, id: 'wl', address: null, name: 'Watch later', kind: 'WATCH_LATER', form: 'SIMPLE', route: null } }, followedPlaylists: { items: [playlist], next: 'n2' } });
    expect(await h.run('playlists', 'hub')).toBe(0);
    expect(h.lines.at(-1)).toBe('mine:\n  @erin>walk  walk  ACCOUNT/ROUTE  PUBLIC  2 items  route Canal  [pl1]\nfollowed:\nwatch later:\n  wl  Watch later  WATCH_LATER/SIMPLE  PUBLIC  2 items  [wl]');
    expect(await h.run('playlists', 'followed')).toBe(0);
    expect(h.lines.at(-1)).toContain('next: n2');
  });
});

describe('long videos', () => {
  it('lists, proposes and sets chapters, records the playback, reads the quota', async () => {
    const { h, calls } = scripted({ longVideos: { items: [{ id: 'p1', createdAt: '2026-11-01T10:00:00.000Z', author: { handle: 'erin' }, universe: '%paris', text: 'The match' }], next: null }, proposedChapters: [{ startSeconds: 0, title: 'Intro' }, { startSeconds: 95, title: 'Kick-off' }], setChapters: { id: 'v1', chapters: [{ startSeconds: 0, title: 'Intro' }] }, recordPlayback: true, myVideoQuota: { limitMinutes: 60, minutesLeft: 42, nextReturnAt: null }, playlist: { id: 'pl1' } });
    expect(await h.run('videos', 'list', '%paris', '--query', 'match')).toBe(0);
    expect(calls[0].variables).toEqual({ address: '%paris', query: 'match' });
    expect(h.lines.at(-1)).toBe('p1  2026-11-01T10:00:00.000Z  @erin  %paris  The match');
    expect(await h.run('videos', 'chapters', 'propose', 'p1')).toBe(0);
    expect(h.lines.at(-1)).toBe('0:00  Intro\n1:35  Kick-off');
    expect(await h.run('videos', 'chapters', 'set', 'p1', '--chapters', '0=Intro;1:35=Kick-off')).toBe(0);
    expect(calls[2].variables.chapters).toEqual([{ startSeconds: 0, title: 'Intro' }, { startSeconds: 95, title: 'Kick-off' }]);
    expect(await h.run('videos', 'chapters', 'set', 'p1', '--chapters', 'nope', '--json')).toBe(2);
    expect(await h.run('videos', 'playback', 'p1', '120', '--watched', '--playlist', '@erin>walk')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'recordPlayback', variables: { postId: 'p1', seconds: 120, watched: true, playlistId: 'pl1' } });
    expect(await h.run('videos', 'quota')).toBe(0);
    expect(h.lines.at(-1)).toBe('42 of 60 minutes left');
    expect(chaptersOf('')).toEqual([]);
    expect(chaptersOf('1:00:00=End')).toEqual([{ startSeconds: 3600, title: 'End' }]);
  });
  it('posts a long video: sent as LONG_VIDEO, then createPost with longVideo; never with a clip', async () => {
    const { h, calls } = scripted({ requestMediaUpload: { id: 'lv1', url: 'https://s3.test/v', fields: {} }, createPost: { id: 'p9' } });
    writeFileSync(join(h.io.cwd, 'match.mp4'), Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]));
    expect(await h.run('post', '--in', '%paris', '--long-video', 'match.mp4', '--video', 'match.mp4', '--json')).toBe(2);
    expect(await h.run('post', '--in', '%paris', '--long-video', 'match.mp4', '--dry-run', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ dryRun: true, longVideo: { file: 'match.mp4', type: 'video/mp4' } });
    expect(await h.run('post', 'The whole match', '--in', '%paris', '--long-video', 'match.mp4', '--json')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['requestMediaUpload', 'POST https://s3.test/v', 'createPost']);
    expect(calls[0].variables.i).toMatchObject({ kind: 'LONG_VIDEO', destination: 'POST', address: '%paris' });
    expect(calls[2].variables).toMatchObject({ longVideo: 'lv1', clip: null, text: 'The whole match' });
  });
});
