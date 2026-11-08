// Specs v101.8.0 (D-309, media-licenses.feature, delegated-agents.feature "Since v101.8.0"): the media license of
// the video of a post, a reply or a quote, declared with requestMediaUpload and checked before anything is sent; a
// delegated agent always declares one; its line under the video when read; the video quota of a delegated agent,
// never paid with x402. Against a scripted API (no network).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { complete } from '../src/completion/engine.js';
import { completionModel } from '../src/completion/model.js';
import { createServer } from '../src/mcp/server.js';
import { checkLicense, licenseLine, licenseOf } from '../src/media.js';
import { saveSession } from '../src/session.js';
import { harness, last } from './helpers.js';

type Call = { field: string; variables: Record<string, unknown>; query?: string };
type Answer = unknown | ((v: Record<string, unknown>) => unknown);

/** A harness whose API answers by the first field of each request; an answer { error } is a refusal; signed in as a human or a delegated agent. */
function scripted(answers: Record<string, Answer>, as: 'human' | 'agent' = 'agent') {
  const calls: Call[] = [];
  const h = harness({
    env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1' },
    fetch: async (url, init) => {
      if (String(url).startsWith('https://s3.test/')) { calls.push({ field: `POST ${String(url)}`, variables: {} }); return new Response(null, { status: 204 }); }
      const { query, variables } = JSON.parse(String(init!.body));
      const field = /\{\s*(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      calls.push({ field, variables, query });
      const raw = answers[field];
      const answer = typeof raw === 'function' ? raw(variables) : raw ?? { id: 'x' };
      const error = (answer as { error?: { code: string; info?: unknown } }).error;
      if (error) return Response.json({ data: { [field]: null }, errors: [{ errorType: error.code, message: 'refused', ...(error.info ? { errorInfo: error.info } : {}) }] });
      return Response.json({ data: { [field]: answer } });
    },
  });
  const ctx = new Context(h.io, NO_FLAGS);
  if (as === 'human') {
    ctx.saveProfile({ env: 'dev', kind: 'human', accountId: 'eu-erin' });
    saveSession(ctx, { kind: 'human', token: 't', idToken: 'i', refreshToken: 'r', pool: { userPoolId: 'eu-west-1_x', clientId: 'c', region: 'eu-west-1' }, accountId: 'eu-erin', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', signInAgainBy: '2099-01-01T00:00:00.000Z' });
  } else {
    saveSession(ctx, { kind: 'agent', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op', agentId: 'ag' });
  }
  writeFileSync(join(h.dir, 'clip.mp4'), Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D, 0, 0, 0, 0]));
  writeFileSync(join(h.dir, 'match.mp4'), Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D, 0, 0, 0, 0]));
  const code = async (...argv: string[]) => { const exit = await h.run(...argv, '--json'); return { exit, code: last<{ error?: { code: string; source?: string; message?: string } }>(h).error?.code, error: last<{ error?: { code: string; source?: string; message?: string } }>(h).error }; };
  return { h, calls, code };
}
const upload = { id: 'up-1', url: 'https://s3.test/bucket', fields: {} };
const uploads = (calls: Call[]) => calls.filter((c) => c.field === 'requestMediaUpload').map((c) => c.variables.i as Record<string, unknown>);

describe('the media license of a video', () => {
  it('a human declares one, or none; CC BY with its attribution; CC0 may carry one', async () => {
    const { h, calls } = scripted({ requestMediaUpload: upload, createPost: { id: 'p1' } }, 'human');
    expect(await h.run('post', 'Sunset', '--in', '%paris', '--video', 'clip.mp4', '--license', 'PUBLIC_DOMAIN', '--json')).toBe(0);
    expect(await h.run('post', 'Sunset', '--in', '%paris', '--video', 'clip.mp4', '--json')).toBe(0);
    expect(await h.run('post', 'Harbour', '--in', '%paris', '--video', 'clip.mp4', '--license', 'CC_BY', '--attribution', 'Jane Doe, archive.org/details/harbour-1952', '--json')).toBe(0);
    expect(await h.run('post', 'Harbour', '--in', '%paris', '--video', 'clip.mp4', '--license', 'CC0', '--attribution', ' Jane Doe ', '--json')).toBe(0);
    expect(await h.run('post', 'Documentary', '--in', '%paris', '--long-video', 'match.mp4', '--license', 'OWN_WORK_ALL_RIGHTS', '--json')).toBe(0);
    expect(uploads(calls)).toEqual([
      { kind: 'VIDEO', contentType: 'video/mp4', size: 16, destination: 'POST', address: '%paris', license: 'PUBLIC_DOMAIN' },
      { kind: 'VIDEO', contentType: 'video/mp4', size: 16, destination: 'POST', address: '%paris' },
      { kind: 'VIDEO', contentType: 'video/mp4', size: 16, destination: 'POST', address: '%paris', license: 'CC_BY', attribution: 'Jane Doe, archive.org/details/harbour-1952' },
      { kind: 'VIDEO', contentType: 'video/mp4', size: 16, destination: 'POST', address: '%paris', license: 'CC0', attribution: 'Jane Doe' },
      { kind: 'LONG_VIDEO', contentType: 'video/mp4', size: 16, destination: 'POST', address: '%paris', license: 'OWN_WORK_ALL_RIGHTS' },
    ]);
  });

  it('is checked before anything is sent: an attribution for CC BY and CC BY-SA, 200 characters, a video only (exit 2)', async () => {
    const { calls, code } = scripted({}, 'human');
    for (const license of ['CC_BY', 'CC_BY_SA']) expect(await code('post', 'Harbour', '--in', '%paris', '--video', 'clip.mp4', '--license', license)).toMatchObject({ exit: 2, code: 'MEDIA_ATTRIBUTION_REQUIRED' });
    expect(await code('post', 'Harbour', '--in', '%paris', '--video', 'clip.mp4', '--license', 'CC_BY', '--attribution', '   ')).toMatchObject({ exit: 2, code: 'MEDIA_ATTRIBUTION_REQUIRED' });
    expect(await code('post', 'Harbour', '--in', '%paris', '--video', 'clip.mp4', '--license', 'CC_BY', '--attribution', 'é'.repeat(201))).toMatchObject({ exit: 2, code: 'MEDIA_ATTRIBUTION_TOO_LONG' });
    expect(await code('post', 'Harbour', '--in', '%paris', '--license', 'CC0')).toMatchObject({ exit: 2, code: 'MEDIA_LICENSE_NOT_ALLOWED' });
    expect(await code('post', 'Harbour', '--in', '%paris', '--video', 'clip.mp4', '--attribution', 'Jane Doe')).toMatchObject({ exit: 2, code: 'MEDIA_LICENSE_NOT_ALLOWED' });
    expect((await code('post', 'Harbour', '--in', '%paris', '--video', 'clip.mp4', '--license', 'GPL')).exit).toBe(2);
    // A message takes none: the option does not exist there.
    expect((await code('dm', '@bob', 'Look', '--video', 'clip.mp4', '--license', 'CC0')).exit).toBe(2);
    expect(calls).toEqual([]);
  });

  it('a delegated agent always declares one, for a clip and a long video, a reply and a quote (exit 2, nothing sent)', async () => {
    const { h, calls, code } = scripted({ requestMediaUpload: upload, replyTo: { id: 'r1' }, post: { universe: '%paris' } });
    const refused = await code('post', 'Dance', '--in', '%paris', '--video', 'clip.mp4');
    expect(refused).toMatchObject({ exit: 2, code: 'MEDIA_LICENSE_REQUIRED' });
    expect(refused.error?.message).toContain('--license');
    expect(await code('post', 'Archive footage', '--in', '%news', '--long-video', 'match.mp4')).toMatchObject({ exit: 2, code: 'MEDIA_LICENSE_REQUIRED' });
    expect(await code('reply', 'p1', 'Look', '--video', 'clip.mp4')).toMatchObject({ exit: 2, code: 'MEDIA_LICENSE_REQUIRED' });
    expect(await code('quote', 'p1', 'Look', '--video', 'clip.mp4')).toMatchObject({ exit: 2, code: 'MEDIA_LICENSE_REQUIRED' });
    expect(await code('drafts', 'save', 'Dance', '--in', '%paris', '--video', 'clip.mp4')).toMatchObject({ exit: 2, code: 'MEDIA_LICENSE_REQUIRED' });
    expect(calls).toEqual([]);
    // A post without a video needs none.
    expect(checkLicense(new Context(h.io, NO_FLAGS), {}, false)).toBeUndefined();
    expect(await h.run('reply', 'p1', 'Look', '--video', 'clip.mp4', '--license', 'CC_BY_SA', '--attribution', 'City Archives', '--json')).toBe(0);
    expect(uploads(calls)).toEqual([{ kind: 'VIDEO', contentType: 'video/mp4', size: 16, destination: 'POST', address: '%paris', license: 'CC_BY_SA', attribution: 'City Archives' }]);
  });

  it('the BREAKROCKS_* variables of a delegated agent count as one too', () => {
    const h = harness({ env: { BREAKROCKS_OPERATOR_ID: 'eu-op', BREAKROCKS_AGENT_ID: 'ag', BREAKROCKS_AGENT_KEY: 'pem' } });
    expect(() => checkLicense(new Context(h.io, NO_FLAGS), {}, true)).toThrow(/media license/);
  });

  it('drafts save sends its video first, under its media license; --dry-run sends nothing', async () => {
    const { h, calls } = scripted({ requestMediaUpload: upload, savePostDraft: { id: 'd1', text: 'Dance', universe: '%paris' } });
    expect(await h.run('drafts', 'save', 'Dance', '--in', '%paris', '--video', 'clip.mp4', '--license', 'CC0', '--dry-run', '--json')).toBe(0);
    expect(JSON.stringify(last(h))).toContain('under CC0');
    expect(calls).toEqual([]);
    expect(await h.run('drafts', 'save', 'Dance', '--in', '%paris', '--video', 'clip.mp4', '--license', 'CC0', '--json')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['requestMediaUpload', 'POST https://s3.test/bucket', 'savePostDraft']);
    expect(uploads(calls)[0]).toMatchObject({ kind: 'VIDEO', address: '%paris', license: 'CC0' });
    expect(calls[2].variables.draft).toMatchObject({ clip: 'up-1', universe: '%paris' });
    expect((await scripted({}).code('drafts', 'save', 'x', '--video', 'clip.mp4', '--clip', 'up-9', '--license', 'CC0')).exit).toBe(2);
  });

  it('the refusals of the platform are said plainly, their code kept (exit 1)', async () => {
    for (const refusal of ['MEDIA_LICENSE_REQUIRED', 'MEDIA_ATTRIBUTION_REQUIRED', 'MEDIA_ATTRIBUTION_TOO_LONG', 'MEDIA_LICENSE_NOT_ALLOWED']) {
      const { code } = scripted({ requestMediaUpload: { error: { code: refusal } } }, 'human');
      const r = await code('post', 'Harbour', '--in', '%paris', '--video', 'clip.mp4', '--license', 'CC0');
      expect(r).toMatchObject({ exit: 1, code: refusal, error: { source: 'platform' } });
      expect(r.error?.message).not.toBe('refused');
    }
  });

  it('beyond the video quota, a delegated agent is refused without an offer to pay', async () => {
    const { calls, code } = scripted({ requestMediaUpload: { error: { code: 'VIDEO_QUOTA_EXCEEDED', info: { minutesLeft: 20, retryAt: '2026-11-20T00:00:00.000Z' } } } });
    const r = await code('post', 'Concert', '--in', '%paris', '--long-video', 'match.mp4', '--license', 'CC0');
    expect(r).toMatchObject({ exit: 1, code: 'VIDEO_QUOTA_EXCEEDED', error: { errorInfo: { minutesLeft: 20 } } });
    expect(r.error?.message).toContain('20 minutes left');
    expect(r.error?.message).toContain('x402');
    expect(calls.map((c) => c.field)).toEqual(['requestMediaUpload']);
  });
});

describe('reading the media license', () => {
  const post = { id: 'p1', createdAt: '2026-11-08T10:00:00.000Z', kind: 'POST', display: 'Harbour', author: { handle: 'erin', id: 'eu-erin' }, universe: '%paris', url: 'https://break.rocks/p/p1', images: [], link: null, replyCount: 0, likeCount: 0, repostCount: 0, tags: [], clip: { url: 'https://cdn.test/c.m3u8', license: 'CC_BY', attribution: 'Jane Doe, archive.org' }, longVideo: null };

  it('its line: the short name and the attribution', () => {
    expect(licenseLine({ license: 'CC_BY', attribution: 'Jane Doe' })).toBe('CC BY · Jane Doe');
    expect(licenseLine({ license: 'CC_BY_SA', attribution: 'Jane Doe' })).toBe('CC BY-SA · Jane Doe');
    expect(licenseLine({ license: 'CC0' })).toBe('CC0');
    expect(licenseLine({ license: 'PUBLIC_DOMAIN', attribution: null })).toBe('Public domain');
    expect(licenseLine({ license: 'OWN_WORK_ALL_RIGHTS' })).toBe('All rights reserved');
    expect(licenseLine({ license: null })).toBeUndefined();
    expect(licenseOf('cc-by-sa')).toBe('CC_BY_SA');
    expect(licenseOf('public domain')).toBe('PUBLIC_DOMAIN');
  });

  it('posts show, render, posts list and videos list show it; --json carries license and attribution', async () => {
    const { h, calls } = scripted({ post, posts: { items: [post], next: null }, longVideos: { items: [{ ...post, clip: null, longVideo: { license: 'CC0', attribution: null } }], next: null } }, 'human');
    expect(await h.run('posts', 'show', 'p1')).toBe(0);
    expect(calls[0].variables).toEqual({ id: 'p1' });
    expect(h.lines.at(-1)).toContain('media license: CC BY · Jane Doe, archive.org');
    expect(await h.run('posts', 'show', 'p1', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ post: { clip: { license: 'CC_BY', attribution: 'Jane Doe, archive.org' } } });
    expect(await h.run('render', 'p1')).toBe(0);
    expect(h.lines.at(-1)).toContain('[clip] https://cdn.test/c.m3u8\n[media license] CC BY · Jane Doe, archive.org');
    expect(await h.run('render', 'p1', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ license: 'CC_BY', attribution: 'Jane Doe, archive.org' });
    expect(await h.run('posts', 'list', '%paris')).toBe(0);
    expect(h.lines.at(-1)).toContain('[media license] CC BY · Jane Doe, archive.org');
    expect(await h.run('videos', 'list', '%paris')).toBe(0);
    expect(h.lines.at(-1)).toContain('[CC0]');
    // The selection of a post asks for them, of its clip and of its long video.
    expect(calls[0].query).toMatch(/clip \{[^}]*\blicense\b/);
    expect(calls[0].query).toMatch(/longVideo \{[^}]*\battribution\b/);
  });

  it('a video without a media license shows none', async () => {
    const { h } = scripted({ post: { ...post, clip: { url: 'https://cdn.test/c.m3u8', license: null, attribution: null } } }, 'human');
    expect(await h.run('render', 'p1')).toBe(0);
    expect(h.lines.at(-1)).not.toContain('media license');
    expect(await h.run('posts', 'show', 'p1')).toBe(0);
    expect(h.lines.at(-1)).not.toContain('media license:');
  });
});

describe('the tools of the MCP server', () => {
  it('post, reply, quote and drafts save take license (an enum) and attribution; the instructions say an agent declares it', async () => {
    const h = harness();
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = createServer(h.io);
    await server.connect(a);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(b);
    expect(client.getInstructions()).toContain('declares the media license of every video');
    const { tools } = await client.listTools();
    for (const name of ['breakrocks_post', 'breakrocks_reply', 'breakrocks_quote', 'breakrocks_drafts_save']) {
      const props = (tools.find((t) => t.name === name)!.inputSchema.properties ?? {}) as Record<string, { enum?: string[] }>;
      expect(props.license?.enum, name).toEqual(['CC0', 'CC_BY', 'CC_BY_SA', 'PUBLIC_DOMAIN', 'OWN_WORK_ALL_RIGHTS']);
      expect(props.attribution, name).toBeDefined();
    }
    for (const name of ['breakrocks_dm']) expect((tools.find((t) => t.name === name)?.inputSchema.properties ?? {}) as object).not.toHaveProperty('license');
    expect(tools.find((t) => t.name === 'breakrocks_videos_quota')!.description).toContain('60,000');
    await client.close();
  });
});

describe('the completion', () => {
  it('offers the media licenses after --license', () => {
    expect(complete(completionModel(), ['post', '--license', ''], () => []).values.map((v) => v.value)).toEqual(['CC0', 'CC_BY', 'CC_BY_SA', 'PUBLIC_DOMAIN', 'OWN_WORK_ALL_RIGHTS']);
  });
});
