// Specs v88.0.0 to v101.0.0: Messages › Universes and mentions, the block of a universe in Messages, the pin for
// oneself, the place of a channel, contribution votes, the order TOP and the stance. Against a scripted API.
import { describe, expect, it } from 'vitest';
import { last } from './helpers.js';
import { scripted } from './scripted.js';

const discussion = { id: 'd1', address: '%paris&general', status: 'OPEN', presentCount: 3, unread: 1, mentionedMe: false, messageTtlSeconds: 604800, silence: null, pinnedByMe: true, lastMessage: { text: 'Hello all' } };

describe('Messages › Universes', () => {
  it('lists the universe discussions in Messages and the mentions; ignores a mention, removes a discussion (by its address)', async () => {
    const { h, calls } = scripted({
      myDiscussionsInMessages: { items: [discussion], next: null }, myDiscussionMentions: { items: [{ discussion, message: { id: 'm1', createdAt: '2026-11-08T10:00:00.000Z', text: '@me look', author: { handle: 'alice' } } }], next: null },
      universeDiscussion: { id: 'd1' }, ignoreDiscussionMention: true, removeDiscussionFromMessages: true,
    });
    expect(await h.run('messages', 'universes')).toBe(0);
    expect(h.lines.at(-1)).toBe('%paris&general  OPEN  present 3  unread 1  kept 7d  silence -  pinned  "Hello all"');
    expect(await h.run('messages', 'mentions')).toBe(0);
    expect(h.lines.at(-1)).toBe('%paris&general  2026-11-08T10:00:00.000Z  @alice  @me look');
    expect(await h.run('messages', 'ignore-mention', '%paris&general')).toBe(0);
    expect(calls.slice(2).map((c) => c.field)).toEqual(['universeDiscussion', 'ignoreDiscussionMention']);
    expect(calls[3].variables).toMatchObject({ id: 'd1' });
    expect(await h.run('messages', 'remove-discussion', 'd1')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'removeDiscussionFromMessages', variables: { id: 'd1' } });
    expect(h.lines.at(-1)).toBe('done');
  });
  it('blocks and unblocks a universe in Messages', async () => {
    const { h, calls } = scripted({ setUniverseBlockedInMessages: (v: Record<string, unknown>) => ({ universeDiscussions: 'ALL', universesInMessages: [], blockedUniverses: v.blocked ? ['%paris'] : [] }) });
    expect(await h.run('messages', 'block-universe', '%paris')).toBe(0);
    expect(h.lines.at(-1)).toBe('blocked in Messages: %paris');
    expect(await h.run('messages', 'unblock-universe', '%paris')).toBe(0);
    expect(calls.map((c) => c.variables.blocked)).toEqual([true, false]);
    expect(h.lines.at(-1)).toBe('blocked in Messages: -');
  });
});

describe('a universe discussion', () => {
  it('is pinned and unpinned for oneself', async () => {
    const { h, calls } = scripted({ setUniverseDiscussionPinnedByMe: (v: Record<string, unknown>) => ({ ...discussion, pinnedByMe: v.pinned }) });
    expect(await h.run('discussions', 'pin', 'd1')).toBe(0);
    expect(h.lines.at(-1)).toBe('%paris&general: pinned for you');
    expect(await h.run('discussions', 'unpin', 'd1')).toBe(0);
    expect(calls.map((c) => c.variables.pinned)).toEqual([true, false]);
  });
  it('gets a place (a point or a zone, with its name) and loses it', async () => {
    const { h, calls } = scripted({ setUniverseDiscussionPlace: (v: Record<string, unknown>) => ({ ...discussion, address: '%paris&canal', place: v.point ? { name: v.name, point: v.point } : v.zone ? { name: v.name, zone: {} } : null }) });
    expect(await h.run('discussions', 'place', 'set', 'd1', '--point', '48.8721,2.3654', '--name', 'Canal')).toBe(0);
    expect(calls[0].variables).toMatchObject({ id: 'd1', name: 'Canal', point: { lat: 48.8721, lon: 2.3654 } });
    expect(h.lines.at(-1)).toBe('%paris&canal: placed at Canal (48.8721,2.3654)');
    expect(await h.run('discussions', 'place', 'set', 'd1', '--zone', '{"center":{"lat":1,"lon":2},"radius":"M500"}', '--name', 'Canal')).toBe(0);
    expect(calls[1].variables.zone).toEqual({ center: { lat: 1, lon: 2 }, radius: 'M500' });
    expect(await h.run('discussions', 'place', 'set', 'd1', '--point', '1,2', '--json')).toBe(2);
    expect(await h.run('discussions', 'place', 'set', 'd1', '--name', 'x', '--json')).toBe(2);
    expect(await h.run('discussions', 'place', 'remove', 'd1')).toBe(0);
    expect(calls.at(-1)!.variables).toEqual({ id: 'd1', requestId: expect.any(String) });
    expect(h.lines.at(-1)).toBe('%paris&canal: no place');
  });
});

describe('contributions of a temporary universe discussion', () => {
  it('votes UP or DOWN and withdraws the vote', async () => {
    const { h, calls } = scripted({ voteOnContribution: { id: 'm1', score: 4, myVote: 'UP' }, withdrawContributionVote: { id: 'm1', score: 3, myVote: null } });
    expect(await h.run('messages', 'vote', 'm1', 'UP')).toBe(0);
    expect(calls[0].variables).toMatchObject({ messageId: 'm1', vote: 'UP' });
    expect(h.lines.at(-1)).toBe('m1: score 4, your vote UP');
    expect(await h.run('messages', 'unvote', 'm1')).toBe(0);
    expect(h.lines.at(-1)).toBe('m1: score 3');
    expect(await h.run('messages', 'vote', 'm1', 'SIDEWAYS', '--json')).toBe(2);
  });
  it('reads the best contributions first (order TOP) and sends with a stance', async () => {
    const { h, calls } = scripted({ messages: { items: [], next: null }, sendMessage: { id: 'm2', stance: 'AGAINST' } });
    expect(await h.run('channels', 'read', '%paris&budget', '--top', '--json')).toBe(0);
    expect(calls[0].variables).toMatchObject({ d: { channel: '%paris&budget' }, order: 'TOP' });
    expect(await h.run('channels', 'read', '%paris&budget', '--json')).toBe(0);
    expect(calls[1].query).not.toContain('order');
    expect(await h.run('channels', 'read', '%paris&budget', '--top', '--since', '2h', '--json')).toBe(2);
    expect(await h.run('channels', 'send', '%paris&budget', 'Too expensive', '--stance', 'AGAINST', '--json')).toBe(0);
    expect(calls.at(-1)!.variables.input).toMatchObject({ to: { channel: '%paris&budget' }, text: 'Too expensive', stance: 'AGAINST' });
    expect(await h.run('channels', 'send', '%paris&budget', 'x', '--stance', 'FOR', '--dry-run', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ dryRun: true, stance: 'FOR' });
  });
  it('tells the levels where a channel proposal may open a channel', async () => {
    const { h, calls } = scripted({ channelProposalLevels: ['%paris', '%paris/velo'] });
    expect(await h.run('channels', 'levels', '%paris')).toBe(0);
    expect(calls[0].variables).toEqual({ universe: '%paris' });
    expect(h.lines.at(-1)).toBe('%paris\n%paris/velo');
  });
});
