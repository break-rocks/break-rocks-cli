// Specs v83.1.0 (D-244, D-245, D-247): the discussions and their unread, the reactions and the threads, the
// theme gallery, stars and trials, the theme history, the universe visit history. Against a scripted API
// (no network); every one is an MCP tool; --dry-run sends nothing; a visit is recorded only on purpose.
import { describe, expect, it } from 'vitest';
import { ttlText } from '../src/commands/discussions.js';
import { tools } from '../src/mcp/server.js';
import { harness, last, sulfurSession } from './helpers.js';

type Call = { field: string; query: string; variables: Record<string, unknown> };
function scripted(answers: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const h = harness({
    env: { BREAKROCKS_SULFUR_URL: 'https://api.test' },
    fetch: async (_url, init) => {
      const { query, variables } = JSON.parse(String(init!.body));
      const field = /\{\s*(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      calls.push({ field, query, variables });
      return Response.json({ data: { [field]: field in answers ? answers[field] : { id: 'x' } } });
    },
  });
  sulfurSession(h.io, 'agent');
  return { h, calls };
}
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const discussion = { address: '%paris&general', status: 'OPEN', lifetime: 'PERMANENT', presentCount: 120, unread: 3, mentionedMe: true, muted: false, silence: { until: '2026-11-02T10:00:00.000Z', always: false }, messageTtlSeconds: 604800, messageCount: 40 };

describe('discussions', () => {

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

describe('the theme gallery', () => {
  it('reads the gallery of a universe, high contrast, night or day', async () => {
    const { h, calls } = scripted({ themeCatalog: { items: [{ theme: { universe: '%root', name: 'socle', version: 3 }, reason: 'UNIVERSAL', starred: true, variant: 'NIGHT', palette: ['#000000'] }], next: null } });
    expect(await h.run('themes', 'gallery', '%paris', '--high-contrast', '--night')).toBe(0);
    expect(calls[0].variables).toMatchObject({ universe: '%paris', order: 'GALLERY', highContrast: true, variant: 'NIGHT' });
    expect(h.lines.join('\n').split('\n').slice(1)).toEqual(['UNIVERSAL (1)', '* %root/socle  v3   -      ?         no image  0      0     0     #000000']);
    expect(await h.run('themes', 'gallery', '%paris', '--day', '--json')).toBe(0);
    expect(calls[1].variables).toMatchObject({ variant: 'DAY' });
    expect(await h.run('themes', 'gallery', '%paris', '--day', '--night', '--json')).toBe(2);
    expect(await h.run('themes', 'gallery', '--json')).toBe(2);
  });
  it('reads the appearance history and restores an entry, or files the proposal (the theme history, stars and trials withdrawn)', async () => {
    const { h, calls } = scripted({
      universeAppearanceHistory: [{ id: 'e1', setAt: '2026-10-01T00:00:00.000Z', live: true, trial: false, first: false, theme: { universe: '%paris', name: 'appearance', version: 2 }, accent: '#11707A', accentName: 'Lagoon', character: 'CALM' }],
      restoreUniverseAppearance: { theme: { universe: '%paris', name: 'appearance', version: 3 }, proposal: null },
    });
    expect(await h.run('universes', 'appearance-history', '%paris')).toBe(0);
    expect(h.lines[0]).toBe('e1  2026-10-01T00:00:00.000Z  %paris/appearance v2  #11707A Lagoon  CALM  (live)');
    expect(await h.run('universes', 'appearance-restore', '%paris', 'e1', '--propose', '--text', 'Clearer')).toBe(0);
    expect(calls[1]).toMatchObject({ field: 'restoreUniverseAppearance', variables: { universe: '%paris', entryId: 'e1', propose: true, text: 'Clearer' } });
    expect(h.lines[1]).toBe('%paris/appearance v3 set');
    expect(await h.run('universes', 'appearance-restore', '%paris', 'e1', '--dry-run', '--json')).toBe(0);
    expect(calls).toHaveLength(2);
    for (const gone of [['themes', 'star', '%root/socle'], ['themes', 'try', '%paris'], ['universes', 'theme-history', '%paris'], ['theme', 'try', '%root/socle'], ['theme', 'copy', '%root/socle'], ['layouts', 'retouch', '%paris']]) expect(await h.run(...gone, '--json'), gone.join(' ')).toBe(2);
  });
});

describe('the universe visit history', () => {

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
    const names = ['discussions_list', 'discussions_show', 'discussions_unread', 'messages_react', 'messages_unreact', 'messages_thread', 'messages_reply_thread', 'messages_delete', 'look_themes_gallery', 'look_appearance_history', 'look_appearance_restore', 'universes_history', 'universes_history_remove', 'universes_history_clear', 'universes_history_visit', 'universes_history_pause'].map((n) => `breakrocks_${n}`);
    for (const n of names) expect(all.map((t) => t.name), n).toContain(n);
    expect(all.find((t) => t.name === 'breakrocks_universes_history_clear')!.inputSchema.properties).toHaveProperty('yes');
    expect(all.find((t) => t.name === 'breakrocks_universes_history_remove')!.inputSchema.properties).not.toHaveProperty('yes');
    for (const n of ['messages_react', 'messages_unreact', 'messages_reply_thread', 'look_appearance_restore', 'universes_history_visit', 'universes_history_clear', 'universes_history_pause']) expect(all.find((t) => t.name === `breakrocks_${n}`)!.inputSchema.properties, n).toHaveProperty('dryRun');
  });
});

describe('messages delete', () => {
  const answer = { id: 'eu-m1', deleted: true, deletedBy: 'AUTHOR', deletedForMe: false };
  it('needs --yes, then deletes in a channel (a universe discussion), a group chat or a conversation', async () => {
    const { h, calls } = scripted({ deleteMessage: answer });
    expect(await h.run('messages', 'delete', 'eu-m1', '--channel', '%paris&general', '--json')).toBe(2);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('CONFIRMATION_REQUIRED');
    expect(calls).toHaveLength(0);
    expect(await h.run('messages', 'delete', 'eu-m1', '--channel', '%paris&general', '--yes')).toBe(0);
    expect(calls[0]).toMatchObject({ field: 'deleteMessage', variables: { discussion: { channel: '%paris&general' }, messageId: 'eu-m1' } });
    expect(calls[0].variables.forMe).toBeUndefined();
    expect(String(calls[0].variables.requestId)).toMatch(UUID_V7);
    expect(h.lines.at(-1)).toBe('eu-m1: deleted (by author)');
    expect(await h.run('messages', 'delete', 'eu-m1', '--group', 'g1', '--for-me', '--yes', '--json')).toBe(0);
    expect(calls[1].variables).toMatchObject({ discussion: { groupChatId: 'g1' }, forMe: true });
    expect(await h.run('messages', 'delete', 'eu-m1', '--with', 'eu-acc', '--yes', '--quiet')).toBe(0);
    expect(calls[2].variables).toMatchObject({ discussion: { accountId: 'eu-acc' } });
  });
  it('--dry-run sends nothing and asks nothing; the discussion is exactly one of three', async () => {
    const { h, calls } = scripted({ deleteMessage: answer });
    expect(await h.run('messages', 'delete', 'eu-m1', '--channel', '%paris&general', '--dry-run', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ dryRun: true, operation: 'deleteMessage', variables: { discussion: { channel: '%paris&general' }, messageId: 'eu-m1' } });
    expect(await h.run('messages', 'delete', 'eu-m1', '--yes', '--json')).toBe(2);
    expect(last<{ error: { code: string } }>(h).error.code).toBe('DISCUSSION_TARGET_INVALID');
    expect(await h.run('messages', 'delete', 'eu-m1', '--channel', '%paris&general', '--group', 'g1', '--yes', '--json')).toBe(2);
    expect(calls).toHaveLength(0);
  });
  it('is an MCP tool that needs "yes", and says moderators may delete others\' messages', () => {
    const t = tools().find((x) => x.name === 'breakrocks_messages_delete')!;
    expect(t.inputSchema.properties).toHaveProperty('yes');
    expect(t.description).toContain('moderator');
    expect(t.inputSchema.properties).toHaveProperty('dryRun');
  });
});
