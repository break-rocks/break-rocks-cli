// Publishing, watching and batches against a scripted API (no network): the media sent with a
// presigned POST and the post sent again while they are processed, with the same requestId; --watch;
// batch; theme publish with its images; the advanced groups out of the basic help.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { instantOf } from '../src/commands/read.js';
import { splitCommand } from '../src/watch.js';
import { harness, last, sulfurSession, sulfurError } from './helpers.js';

type Call = { field: string; variables: Record<string, unknown>; query: string };
type Handler = (variables: Record<string, unknown>, n: number) => unknown;

/** A harness signed in as a delegated agent, whose API answers by the first field of each request. */
function scripted(handlers: Record<string, Handler>, extra: Parameters<typeof harness>[0] = {}) {
  const calls: Call[] = [];
  const uploads: { url: string; fields: Record<string, string>; file?: { name: string; size: number; type: string } }[] = [];
  const counts: Record<string, number> = {};
  const h = harness({
    ...extra,
    env: { BREAKROCKS_SULFUR_URL: 'https://api.test', ...extra.env },
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
      if (!handler) return Response.json({ data: null, errors: [sulfurError({ errorType: 'NO_HANDLER', message: field })] });
      try { return Response.json({ data: { [field]: handler(variables, counts[field]) } }); } catch (e) { return Response.json({ data: null, errors: [sulfurError({ errorType: (e as Error).message, message: 'refused' })] }); }
    },
  });
  sulfurSession(h.io, 'agent');
  return { h, calls, uploads };
}
const png = (w: number, h: number) => { const b = Buffer.alloc(64); Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13]).copy(b); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const post = (v: Record<string, unknown>) => ({ id: 'post-1', text: v.text, images: (v.images as unknown[] | null) ?? [] });

describe('post', () => {

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
    expect(await h.run('post', 'Bonjour', '--in', '%paris', '--video', join(h.dir, 'c.mp4'), '--license', 'CC0', '--dry-run', '--json')).toBe(0);
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

  it('ask a confirmation for what cannot be undone', async () => {
    const { h, calls } = scripted({ deletePost: (v) => ({ id: v.postId }) });
    expect(await h.run('posts', 'delete', 'p1', '--json')).toBe(2);
    expect(calls).toEqual([]);
    expect(await h.run('posts', 'delete', 'p1', '--yes', '--json')).toBe(0);
  });
  it('report a theme by its address, with its reason and its part; ILLEGAL needs --good-faith', async () => {
    const { h, calls } = scripted({ report: () => ({ id: 'r1' }) });
    expect(await h.run('report', 'theme', '%paris/stade-nuit', '--reason', 'ILLEGAL', '--part', 'BANNER', '--json')).toBe(2);
    expect(calls).toEqual([]);
    expect(await h.run('report', 'theme', '%paris/stade-nuit', '--reason', 'ILLEGAL', '--part', 'BANNER', '--details', 'Not theirs', '--good-faith', '--json')).toBe(0);
    expect(calls[0].variables).toMatchObject({ t: { kind: 'THEME', universe: '%paris', name: 'stade-nuit', themePart: 'BANNER' }, reason: 'ILLEGAL', article: null, details: 'Not theirs', goodFaith: true, r: expect.stringMatching(UUID_V7) });
    expect(await h.run('report', 'channel-message', 'm1', '--channel', '%club&general', '--reason', 'SPAM_OR_FLOOD', '--json')).toBe(0);
    expect(calls[1].variables.t).toEqual({ kind: 'CHANNEL_MESSAGE', discussion: { channel: '%club&general' }, messageId: 'm1' });
  });
  it('report the targets of specs v84 to v101: a route, a playlist item, a place sent, with the reasons of the contract', async () => {
    const { h, calls } = scripted({ report: () => ({ id: 'r1' }) });
    expect(await h.run('report', 'route', 'rt1', '--reason', 'MISLEADING', '--json')).toBe(0);
    expect(calls[0].variables.t).toEqual({ kind: 'ROUTE', routeId: 'rt1' });
    expect(await h.run('report', 'playlist-item', 'pl1', '--post', 'p1', '--reason', 'UNDECLARED_COMMERCIAL', '--json')).toBe(0);
    expect(calls[1].variables.t).toEqual({ kind: 'PLAYLIST_ITEM', playlistId: 'pl1', postId: 'p1' });
    expect(await h.run('report', 'place-message', 'm1', '--channel', '%paris&velo', '--reason', 'MISLEADING_LINK', '--json')).toBe(0);
    expect(calls[2].variables.t).toEqual({ kind: 'PLACE_MESSAGE', discussion: { channel: '%paris&velo' }, messageId: 'm1' });
    expect(await h.run('report', 'playlist-item', 'pl1', '--reason', 'OFF_TOPIC', '--json')).toBe(2);
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
    const { h, calls } = scripted({ setLike: (v) => { if (v.postId === 'bad') throw new Error('POST_NOT_FOUND'); return { id: v.postId }; }, replyTo: (v) => ({ id: `r-${v.requestId}` }) });
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
    imageSlots: { page: { day: 'page-day.png' }, pageHeader: { day: 'page-header-day.png' }, cardTexture: { day: 'card-texture-day.png' } },
  };



  it('refuses an archive without a theme document', async () => {
    const { h, calls } = scripted({});
    const { writeZip } = await import('../src/theme/zip.js');
    writeFileSync(join(h.dir, 'empty.zip'), writeZip([{ path: 'page-day.png', bytes: png(10, 10) }]));
    expect(await h.run('theme', 'publish', join(h.dir, 'empty.zip'), '--in', '%paris', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'IMPORT_NO_JSON' } });
    expect(calls).toEqual([]);
  });
  it('names each file missing, before anything is sent', async () => {
    const { h, calls } = scripted({});
    const dir = join(h.dir, 't'); mkdirSync(dir);
    writeFileSync(join(dir, 'theme.json'), JSON.stringify(doc));
    expect(await h.run('theme', 'publish', join(dir, 'theme.json'), '--in', '%paris', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'IMAGE_FILE_MISSING', missing: ['imageSlots.page.day', 'imageSlots.pageHeader.day'] } });
    expect(calls).toEqual([]);
  });
});

describe('the theme catalog and the page of a theme', () => {
  it('lists the themes of quick start by group and image, with their reason', async () => {
    const item = { theme: { universe: '%root', name: 'belgique', version: 2 }, reason: 'COUNTRY', universeCount: 3, accountCount: 0, hasImage: true, look: null };
    const { h, calls } = scripted({ themeCatalog: () => ({ items: [item], next: null }) });
    expect(await h.run('themes', 'list', '--order', 'QUICK_START', '--universe', '%paris', '--group', 'COUNTRY', '--with-image')).toBe(0);
    expect(calls[0].variables).toMatchObject({ o: 'QUICK_START', u: '%paris', g: 'COUNTRY', wi: true });
    expect(h.lines.at(-1)!.split('\n').slice(1)).toEqual(['COUNTRY (1)', '  %root/belgique  v2   -      ?         img     0      3     0']);
    expect(await h.run('themes', 'list', '--order', 'QUICK_START', '--universe', '%paris', '--without-image', '--json')).toBe(0);
    expect(calls[1].variables).toMatchObject({ wi: false, g: null });
    expect(await h.run('themes', 'list', '--with-image', '--without-image', '--json')).toBe(2);
  });
  it('shows a theme with its image slots, their widths and its screenshots', async () => {
    const theme = {
      universe: '%paris', name: 'stade-nuit', version: 3, collection: 'SPORT', official: false, contrastLevel: 'AA', creator: { handle: 'alice' }, typography: { title: 'Bebas Neue' }, universeCount: 1, accountCount: 0, corrected: ['night.text'],
      document: JSON.stringify({ appearance: { accent: '#E5484D', imageShows: 'through', sky: 'band' } }),
      imageSlots: { page: { url: 'https://media.example/posts/u1', widths: [2160, 1080], urlNight: 'https://media.example/posts/u2', widthsNight: [2160], removed: false }, pageHeader: null, timeColumn: null },
      screenshots: ['a', 'b', 'c'], screenshotsDay: ['d', 'e', 'f'], pageScreenshots: { desktop: { url: 'x', urlNight: 'y' }, tablet: null, phone: { url: 'z', urlNight: null } },
    };
    const { h } = scripted({ theme: () => theme });
    expect(await h.run('themes', 'show', '%paris/stade-nuit')).toBe(0);
    for (const line of ['%paris/stade-nuit v3\n', '  collection     SPORT\n', '  creator        @alice\n', '  page image     shows through, sky band\n',
      '    page                day https://media.example/posts/u1/1080.webp (2160, 1080)\n                        day largest https://media.example/posts/u1/2160.webp\n                        night https://media.example/posts/u2/2160.webp (2160)\n',
      '  screenshots night (3)\n    a\n', '    desktop day x  night y\n    phone   day z\n', "breakrocks look themes shots '%paris/stade-nuit' --out <folder>", 'corrected at publication: night.text']) expect(h.all()).toContain(line);
  });
});

describe('theme trials, draft previews and the personal accent', () => {
  it('sends startUniverseThemeTrial, endUniverseThemeTrial, startDraftPreview, endDraftPreview and setPersonalTheme(accent)', async () => {
    const { h, calls } = scripted({
      startUniverseThemeTrial: (v) => ({ universe: '%paris', draftId: v.draftId, version: 1, startedAt: '2026-10-27T10:00:00.000Z', endsAt: '2026-10-28T10:00:00.000Z', startedBy: { id: 'eu-1', handle: 'alice', displayName: 'Alice' } }),
      endUniverseThemeTrial: () => ({ name: '%paris' }), startDraftPreview: (v) => ({ universe: '%paris', draftId: v.draftId, version: 1, endsAt: '2026-10-28T10:00:00.000Z' }), endDraftPreview: () => ({ name: '%paris' }),
      setPersonalTheme: (v) => ({ accent: (v.input as { accent?: string }).accent }),
    });
    expect(await h.run('studio', 'try', 'd-1')).toBe(0);
    expect(h.all()).toMatch(/%paris: trial of the draft d-1 \(v1\) until 2026-10-28T10:00:00.000Z/);
    expect(calls.at(-1)!.query).not.toContain('document');
    expect(await h.run('studio', 'end-try', '%paris', '--json')).toBe(0);
    expect(calls.at(-1)!.variables).toEqual({ universe: '%paris', requestId: expect.stringMatching(UUID_V7) });
    expect(await h.run('studio', 'preview', 'd-1', '--json')).toBe(0);
    expect(await h.run('studio', 'end-preview', '%paris', '--json')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['startUniverseThemeTrial', 'endUniverseThemeTrial', 'startDraftPreview', 'endDraftPreview']);
    expect(await h.run('theme', 'personal', 'set', '--accent', 'universe', '--json')).toBe(0);
    expect(calls.at(-1)!.variables).toEqual({ input: { accent: 'universe' }, requestId: expect.stringMatching(UUID_V7) });
    // Withdrawn since specs v96.0.0 (D-289): no personal theme, no post transparency, no "my theme everywhere".
    for (const flag of ['--post-transparency', '--my-theme-everywhere']) expect(await h.run('theme', 'personal', 'set', flag, 'LIQUID', '--json')).toBe(2);
    expect(await h.run('theme', 'personal', 'clear', '--json')).toBe(0);
    expect(calls.at(-1)!.variables).toEqual({ input: { clear: ['ACCENT', 'DEVICE_DISPLAY_MODE'] }, requestId: expect.stringMatching(UUID_V7) });
  });
});

describe('messages', () => {

  it('sends and reads the messages of a group chat and of a channel as discussions', async () => {
    const page = (v: Record<string, unknown>) => ({ items: [{ id: 'm1', createdAt: '2026-10-23T10:00:00.000Z', text: 'x' }], next: null, discussion: v.d });
    const { h, calls } = scripted({ sendMessage: (v) => ({ id: `eu-${v.requestId}` }), messages: page });
    expect(await h.run('groups', 'send', 'g1', 'Salut', '--json')).toBe(0);
    expect(calls.at(-1)!.variables.input).toMatchObject({ to: { groupChatId: 'g1' }, text: 'Salut' });
    expect(await h.run('channels', 'send', '%club~general', 'Salut', '--json')).toBe(0);
    expect(calls.at(-1)!.variables.input).toMatchObject({ to: { channel: '%club~general' }, text: 'Salut' });
    expect(await h.run('channels', 'read', '%club~general', '--json')).toBe(0);
    expect(calls.at(-1)!.variables.d).toEqual({ channel: '%club~general' });
    expect(await h.run('groups', 'read', 'g1', '--json')).toBe(0);
    expect(calls.at(-1)!.variables.d).toEqual({ groupChatId: 'g1' });
    expect(last(h)).toMatchObject({ items: [{ id: 'm1' }] });
  });
  it('creates a group chat and tells the invitations refused', async () => {
    const { h, calls } = scripted({ accountByHandle: (v) => ({ id: `eu-${v.h}` }) });
    // createGroupChat answers its data and the error GROUP_INVITATIONS_REFUSED.
    h.io.fetch = (async (_url: string, init: RequestInit) => {
      const { query, variables } = JSON.parse(String(init.body));
      calls.push({ field: query.includes('accountByHandle') ? 'accountByHandle' : 'createGroupChat', variables, query });
      if (query.includes('accountByHandle')) return Response.json({ data: { accountByHandle: { id: `eu-${variables.h}` } } });
      return Response.json({ data: { createGroupChat: { id: 'g1', name: 'relais', memberCount: 1 } }, errors: [sulfurError({ errorType: 'GROUP_INVITATIONS_REFUSED', message: 'x', partial: true, errorInfo: { refused: [{ accountId: 'eu-bob', code: 'NOT_CONNECTED' }] } })] });
    }) as typeof fetch;
    expect(await h.run('groups', 'create', 'relais', '@alice', '@bob', '--json')).toBe(0);
    expect(last(h)).toEqual({ group: { id: 'g1', name: 'relais', memberCount: 1 }, refused: [{ accountId: 'eu-bob', code: 'NOT_CONNECTED' }] });
    expect(calls.find((c) => c.field === 'createGroupChat')!.variables.i).toEqual(['eu-alice', 'eu-bob']);
  });
  it('sets an ephemeral conversation by its duration', async () => {
    const { h, calls } = scripted({ accountByHandle: () => ({ id: 'eu-bob' }), setConversationEphemeral: () => true });
    expect(await h.run('dm', 'ephemeral', '@bob', '24h', '--json')).toBe(0);
    expect(calls.find((c) => c.field === 'setConversationEphemeral')!.variables).toEqual({ a: 'eu-bob', d: 'HOURS_24', r: expect.stringMatching(UUID_V7) });
  });
});

describe('the help', () => {
  it('shows the domains, then the commands of a domain', async () => {
    const h = harness();
    await h.run('help');
    expect(h.lines[0]).not.toContain('moderation ban');
    expect(h.lines[0]).toContain('governance  governance, proposals, jury, moderation');
    await h.run('help', 'governance');
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
