// Specs v83.1.0 (D-244, D-245, D-247): the discussions and their unread, the reactions and the threads, the
// theme gallery, stars and trials, the theme history, the universe visit history. Against a scripted API
// (no network); every one is an MCP tool; --dry-run sends nothing; a visit is recorded only on purpose.
import { describe, expect, it } from 'vitest';
import { ttlText } from '../src/commands/discussions.js';
import { Context, NO_FLAGS } from '../src/context.js';
import { tools } from '../src/mcp/server.js';
import { saveSession } from '../src/session.js';
import { harness, last } from './helpers.js';

type Call = { field: string; query: string; variables: Record<string, unknown> };
function scripted(answers: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const h = harness({
    env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1' },
    fetch: async (_url, init) => {
      const { query, variables } = JSON.parse(String(init!.body));
      const field = /\{\s*(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      calls.push({ field, query, variables });
      return Response.json({ data: { [field]: field in answers ? answers[field] : { id: 'x' } } });
    },
  });
  saveSession(new Context(h.io, NO_FLAGS), { kind: 'agent', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op', agentId: 'ag' });
  return { h, calls };
}
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const discussion = { address: '%paris&general', status: 'OPEN', lifetime: 'PERMANENT', presentCount: 120, unread: 3, mentionedMe: true, muted: false, silence: { until: '2026-11-02T10:00:00.000Z', always: false }, messageTtlSeconds: 604800, messageCount: 40 };

describe('discussions', () => {
  it('lists those with unread messages, with presentCount, silence, mentionedMe and messageTtlSeconds', async () => {
    const { h, calls } = scripted({ myUnreadDiscussions: { items: [discussion], next: null } });
    expect(await h.run('discussions', 'unread', '--limit', '5', '--json')).toBe(0);
    expect(calls[0].variables).toMatchObject({ limit: 5 });
    for (const f of ['presentCount', 'silence', 'mentionedMe', 'messageTtlSeconds']) expect(calls[0].query).toContain(f);
    expect(await h.run('discussions', 'unread')).toBe(0);
    expect(h.lines.join('\n')).toBe('%paris&general  OPEN  present 120  unread 3 (mentions you)  kept 7d  silence until 2026-11-02T10:00:00.000Z');
  });
  it('shows one, and lists those of a universe', async () => {
    const { h, calls } = scripted({ universeDiscussion: discussion, universeDiscussions: { items: [{ ...discussion, silence: null, mentionedMe: false }], membersCreate: false } });
    expect(await h.run('discussions', 'show', '%paris&general')).toBe(0);
    expect(calls[0].variables).toEqual({ address: '%paris&general' });
    expect(h.lines.join('\n')).toContain('present now: 120 (approximate)');
    expect(h.lines.join('\n')).toContain('mentioned me: yes');
    expect(h.lines.join('\n')).toContain('messages kept: 7d (604800 s)');
    h.lines.length = 0;
    expect(await h.run('discussions', 'list', '%paris', '--all-levels')).toBe(0);
    expect(calls[1].variables).toEqual({ universe: '%paris', allLevels: true });
    expect(h.lines.join('\n')).toContain('present 120  unread 3  kept 7d  silence -');
  });
  it('says how long messages are kept', () => {
    expect([ttlText(604800), ttlText(21600), ttlText(90), ttlText(null)]).toEqual(['7d', '6h', '90s', '-']);
  });
});

describe('reactions and threads', () => {
  it('react and unreact send one emoji with an idempotency key; --dry-run sends nothing', async () => {
    const { h, calls } = scripted({ reactToMessage: { id: 'm1', reactions: [{ reaction: '👍', count: 2 }], myReactions: ['👍'] }, unreactToMessage: { id: 'm1', reactions: [], myReactions: [] } });
    expect(await h.run('messages', 'react', 'm1', '👍')).toBe(0);
    expect(calls[0].field).toBe('reactToMessage');
    expect(calls[0].variables).toMatchObject({ messageId: 'm1', reaction: '👍' });
    expect(String(calls[0].variables.requestId)).toMatch(UUID_V7);
    expect(h.lines.join('\n')).toBe('m1: 👍 2 (yours)');
    expect(await h.run('messages', 'unreact', 'm1', '👍', '--json')).toBe(0);
    expect(calls[1]).toMatchObject({ field: 'unreactToMessage', variables: { messageId: 'm1', reaction: '👍' } });
    expect(await h.run('messages', 'react', 'm1', '🎉', '--dry-run', '--json')).toBe(0);
    expect(calls).toHaveLength(2);
    expect(last(h)).toMatchObject({ dryRun: true, operation: 'reactToMessage', variables: { messageId: 'm1', reaction: '🎉' } });
  });
  it('reads a thread (--all follows the pages) and replies in it', async () => {
    let page = 0;
    const { h, calls } = scripted({ threadMessages: undefined, replyInThread: { id: 'eu-r1', threadRoot: 'm1' } });
    h.io.fetch = (async (_u: unknown, init: { body: string }) => {
      const { query, variables } = JSON.parse(init.body);
      const field = /\{\s*(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      calls.push({ field, query, variables });
      if (field === 'replyInThread') return Response.json({ data: { replyInThread: { id: 'eu-r1', threadRoot: 'm1' } } });
      page++;
      return Response.json({ data: { threadMessages: { items: [{ id: `r${page}`, createdAt: '2026-11-01T10:00:00.000Z', text: `reply ${page}`, author: { handle: 'wheatley' } }], next: page < 2 ? 'c1' : null } } });
    }) as typeof fetch;
    expect(await h.run('messages', 'thread', 'm1', '--all', '--json')).toBe(0);
    expect(last<{ items: { id: string }[] }>(h).items.map((m) => m.id)).toEqual(['r1', 'r2']);
    expect(calls.filter((c) => c.field === 'threadMessages').map((c) => c.variables.after ?? null)).toEqual([null, 'c1']);
    expect(await h.run('messages', 'reply-thread', 'm1', '--text', 'Bonne idée', '--request-id', '0198a2b4-0000-7000-8000-000000000001', '--json')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'replyInThread', variables: { messageId: 'm1', text: 'Bonne idée', requestId: '0198a2b4-0000-7000-8000-000000000001' } });
    expect(await h.run('messages', 'reply-thread', 'm1', '--json')).toBe(2);
    expect(await h.run('messages', 'reply-thread', 'm1', '--text', 'x', '--dry-run', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ dryRun: true, operation: 'replyInThread' });
    expect(calls.filter((c) => c.field === 'replyInThread')).toHaveLength(1);
  });
});

describe('the theme gallery', () => {
  it('reads the gallery of a universe, high contrast, night or day', async () => {
    const { h, calls } = scripted({ themeCatalog: { items: [{ theme: { universe: '%root', name: 'socle', version: 3 }, reason: 'UNIVERSAL', starred: true, variant: 'NIGHT', palette: ['#000000'] }], next: null } });
    expect(await h.run('themes', 'gallery', '%paris', '--high-contrast', '--night')).toBe(0);
    expect(calls[0].variables).toMatchObject({ universe: '%paris', order: 'GALLERY', highContrast: true, variant: 'NIGHT' });
    expect(h.lines.join('\n')).toBe('* %root/socle v3  NIGHT  UNIVERSAL  #000000');
    expect(await h.run('themes', 'gallery', '%paris', '--day', '--json')).toBe(0);
    expect(calls[1].variables).toMatchObject({ variant: 'DAY' });
    expect(await h.run('themes', 'gallery', '%paris', '--day', '--night', '--json')).toBe(2);
    expect(await h.run('themes', 'gallery', '--json')).toBe(2);
  });
  it('stars, unstars and lists the starred themes', async () => {
    const { h, calls } = scripted({ starTheme: { universe: '%root', name: 'socle', version: 1 }, unstarTheme: true, starredThemes: { items: [], next: null } });
    expect(await h.run('themes', 'star', '%root/socle')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'starTheme', variables: { theme: { universe: '%root', name: 'socle' } } });
    expect(await h.run('themes', 'unstar', '%root/socle', '--json')).toBe(0);
    expect(calls[1].field).toBe('unstarTheme');
    expect(await h.run('themes', 'starred', '--variant', 'DAY', '--json')).toBe(0);
    expect(calls[2]).toMatchObject({ field: 'starredThemes', variables: { variant: 'DAY' } });
    expect(await h.run('themes', 'star', '%root/socle', '--dry-run', '--json')).toBe(0);
    expect(calls).toHaveLength(3);
  });
  it('tries, ends and lists the gallery trials; a trial needs a theme or a layout', async () => {
    const trial = { universe: '%paris', theme: { universe: '%root', name: 'socle', version: 1 }, layout: null, startedAt: '2026-11-01T10:00:00.000Z', endsAt: '2026-11-02T10:00:00.000Z' };
    const { h, calls } = scripted({ startGalleryTrial: trial, endGalleryTrial: { name: '%paris', myGalleryTrial: null }, myGalleryTrials: [trial] });
    expect(await h.run('themes', 'try', '%paris', '--theme', '%root/socle', '--layout', '%root/agora')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'startGalleryTrial', variables: { universe: '%paris', theme: { universe: '%root', name: 'socle' }, layout: { universe: '%root', name: 'agora' } } });
    expect(h.lines[0]).toBe('%paris: theme %root/socle v1 until 2026-11-02T10:00:00.000Z');
    expect(await h.run('themes', 'try', '%paris', '--json')).toBe(2);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('GALLERY_TRIAL_EMPTY');
    expect(await h.run('themes', 'untry', '%paris')).toBe(0);
    expect(calls[1]).toMatchObject({ field: 'endGalleryTrial', variables: { universe: '%paris' } });
    expect(await h.run('themes', 'trials', '--json')).toBe(0);
    expect(calls[2].field).toBe('myGalleryTrials');
    expect(await h.run('themes', 'try', '%paris', '--theme', '%root/socle', '--dry-run', '--json')).toBe(0);
    expect(calls).toHaveLength(3);
  });
  it('reads the theme history, restores an entry, follows the updates', async () => {
    const { h, calls } = scripted({
      universeThemeHistory: { items: [{ id: 'e1', theme: { universe: '%root', name: 'socle', version: 2 }, setAt: '2026-10-01T00:00:00.000Z', endedAt: null, restorable: true }], next: null },
      restoreUniverseTheme: { universe: { name: '%paris', themeHeldVersion: 2 }, proposal: null }, followThemeUpdates: { universe: { name: '%paris', themeHeldVersion: null }, proposal: null },
    });
    expect(await h.run('universes', 'theme-history', '%paris')).toBe(0);
    expect(h.lines[0]).toBe('e1  %root/socle v2  2026-10-01T00:00:00.000Z - now');
    expect(await h.run('universes', 'theme-restore', '%paris', 'e1')).toBe(0);
    expect(calls[1]).toMatchObject({ field: 'restoreUniverseTheme', variables: { universe: '%paris', entryId: 'e1' } });
    expect(h.lines[1]).toBe('%paris: frozen at version 2');
    expect(await h.run('universes', 'theme-follow', '%paris')).toBe(0);
    expect(calls[2].field).toBe('followThemeUpdates');
    expect(h.lines[2]).toBe('%paris: follows the latest version');
    expect(await h.run('universes', 'theme-restore', '%paris', 'e1', '--dry-run', '--json')).toBe(0);
    expect(calls).toHaveLength(3);
  });
});

describe('the universe visit history', () => {
  it('lists, removes one, clears all (only with yes) and pauses', async () => {
    const { h, calls } = scripted({ universeHistory: [{ universe: '%paris/velo', parent: '%paris', private: false, visitedAt: '2026-11-01T10:00:00.000Z' }], removeRecentUniverse: true, clearRecentUniverses: true, setSettings: { universeHistoryPaused: true } });
    expect(await h.run('universes', 'history', '--limit', '5')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'universeHistory', variables: { limit: 5 } });
    expect(h.lines[0]).toBe('%paris/velo  in %paris  2026-11-01T10:00:00.000Z');
    expect(await h.run('universes', 'history', 'remove', '%paris/velo', '--json')).toBe(0);
    expect(calls[1]).toMatchObject({ field: 'removeRecentUniverse', variables: { universe: '%paris/velo' } });
    expect(await h.run('universes', 'history', 'clear', '--json')).toBe(2);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('CONFIRMATION_REQUIRED');
    expect(calls).toHaveLength(2);
    expect(await h.run('universes', 'history', 'clear', '--dry-run', '--json')).toBe(0);
    expect(calls).toHaveLength(2);
    expect(await h.run('universes', 'history', 'clear', '--yes', '--json')).toBe(0);
    expect(calls[2].field).toBe('clearRecentUniverses');
    expect(await h.run('settings', 'history-pause', 'on')).toBe(0);
    expect(calls[3]).toMatchObject({ field: 'setSettings', variables: { input: { universeHistoryPaused: true } } });
    expect(h.lines.at(-1)).toBe('visit history paused');
    expect(await h.run('settings', 'history-pause', 'off', '--json')).toBe(0);
    expect(calls[4].variables).toMatchObject({ input: { universeHistoryPaused: false } });
    expect(await h.run('settings', 'history-pause', 'maybe', '--json')).toBe(2);
  });
  it('records a visit only through universes visit, never implicitly', async () => {
    const { h, calls } = scripted({ universe: { name: '%paris', id: 'u' }, recordUniverseVisit: false });
    for (const argv of [['universes', 'show', '%paris'], ['universes', 'history'], ['universes', 'list', '--recent'], ['universes', 'sub', '%paris'], ['discussions', 'list', '%paris']]) await h.run(...argv, '--json');
    expect(calls.some((c) => c.query.includes('recordUniverseVisit'))).toBe(false);
    expect(await h.run('universes', 'visit', '%paris', '--dry-run', '--json')).toBe(0);
    expect(calls.some((c) => c.query.includes('recordUniverseVisit'))).toBe(false);
    expect(await h.run('universes', 'visit', '%paris')).toBe(0);
    expect(calls.filter((c) => c.field === 'recordUniverseVisit')).toHaveLength(1);
    expect(h.lines.at(-1)).toMatch(/^not recorded/);
  });
});

describe('MCP', () => {
  it('exposes every new command as a tool, "yes" only on the destructive one', () => {
    const all = tools();
    const names = ['discussions_list', 'discussions_show', 'discussions_unread', 'messages_react', 'messages_unreact', 'messages_thread', 'messages_reply_thread', 'themes_gallery', 'themes_star', 'themes_unstar', 'themes_starred', 'themes_try', 'themes_untry', 'themes_trials', 'universes_theme_history', 'universes_theme_restore', 'universes_theme_follow', 'universes_history', 'universes_history_remove', 'universes_history_clear', 'universes_visit', 'settings_history_pause'].map((n) => `breakrocks_${n}`);
    for (const n of names) expect(all.map((t) => t.name), n).toContain(n);
    expect(all.find((t) => t.name === 'breakrocks_universes_history_clear')!.inputSchema.properties).toHaveProperty('yes');
    expect(all.find((t) => t.name === 'breakrocks_universes_history_remove')!.inputSchema.properties).not.toHaveProperty('yes');
    for (const n of ['messages_react', 'messages_unreact', 'messages_reply_thread', 'themes_star', 'themes_try', 'universes_visit', 'universes_history_clear', 'settings_history_pause']) expect(all.find((t) => t.name === `breakrocks_${n}`)!.inputSchema.properties, n).toHaveProperty('dryRun');
  });
});
