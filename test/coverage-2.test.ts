// D-303 (0.18.0): the operations of before specs v83.1.0 that had no command. Every command added is run from
// each of its examples against a scripted API (no network): it sends its operation, in text and in JSON, and is
// an MCP tool (unless it says otherwise). The commands whose input is more than their arguments have tests of
// their own below.
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { billingCommands } from '../src/commands/billing.js';
import { chatCommands } from '../src/commands/chats.js';
import { civicCommands, civicGovernanceCommands } from '../src/commands/civic.js';
import { discussionModerationCommands } from '../src/commands/discussions-moderation.js';
import { meCommands } from '../src/commands/me.js';
import { privateUniverseCommands } from '../src/commands/private-universes.js';
import { tools } from '../src/mcp/server.js';
import type { AnyCommand } from '../src/registry.js';
import { scripted } from './scripted.js';

export const ADDED: AnyCommand[] = [...meCommands, ...chatCommands, ...privateUniverseCommands, ...civicCommands, ...civicGovernanceCommands, ...discussionModerationCommands, ...billingCommands];

/** The words of an example, as a shell splits them (quotes kept together), without "breakrocks". */
export function words(example: string): string[] {
  const out: string[] = [];
  for (const m of example.replace(/<[^>]+>/g, 'x').matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? m[3]);
  return out[0] === 'breakrocks' ? out.slice(1) : out;
}
const opOf = (c: AnyCommand) => /The (?:query|mutation) (\w+) of the API/.exec(c.description ?? '')?.[1];
/** The examples that need more than the command line (a file, the standard input): tested apart. */
const APART = new Set(['breakrocks universes identity %club. --banner-file ./banner.jpg', 'breakrocks me profile set --avatar-file ./me.png', 'breakrocks me password', 'printf "%s\\n%s\\n" "$OLD" "$NEW" | breakrocks me password --password-stdin']);

describe('the commands of the operations of before v83.1.0', () => {
  const titles = new Set(tools().map((t) => t.title));
  for (const command of ADDED) {
    it(`${command.name}: its examples send ${opOf(command)}`, async () => {
      expect(opOf(command)).toBeTruthy();
      if (command.mcp !== false) expect(titles.has(`breakrocks ${command.name}`)).toBe(true);
      for (const example of command.examples.filter((e) => !APART.has(e))) {
        for (const json of [false, true]) {
          const { h, calls } = scripted();
          const code = await h.run('--yes', ...(json ? ['--json'] : []), ...words(example));
          expect(code, `${example}${json ? ' --json' : ''}: ${h.all()}`).toBe(0);
          expect(calls.map((c) => c.field)).toContain(opOf(command));
        }
      }
    });
  }
});

describe('the account', () => {
  it('sends an avatar file, then sets it', async () => {
    const { h, calls } = scripted({ requestAvatarUpload: { id: 'up1', url: 'https://s3.test/up', fields: '{"key":"k"}' }, updateProfile: { id: 'a1', handle: 'alice', displayName: 'Alice', links: [] } });
    // A PNG of 1×1 pixel.
    writeFileSync(join(h.dir, 'me.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    h.io.cwd = h.dir;
    expect(await h.run('me', 'profile', 'set', '--avatar-file', 'me.png', '--bio', 'Cyclist')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['requestAvatarUpload', 'POST https://s3.test/up', 'updateProfile']);
    expect(calls[0].variables).toMatchObject({ c: 'image/png' });
    expect(calls[2].variables).toMatchObject({ input: { avatar: 'up1', bio: 'Cyclist' } });
    expect(h.lines.at(-1)).toBe('@alice  Alice');
    expect(await h.run('me', 'profile', 'set', '--avatar-file', 'me.png', '--avatar', 'up2')).toBe(2);
  });
  it('changes the password from the standard input, never from an option', async () => {
    const { h, calls } = scripted({ changePassword: true });
    h.io.readStdin = async () => 'old secret\nnew secret\n';
    expect(await h.run('me', 'password', '--password-stdin')).toBe(0);
    expect(calls[0].variables).toMatchObject({ currentPassword: 'old secret', newPassword: 'new secret' });
    expect(h.all()).not.toContain('secret');
    expect(await h.run('me', 'password', '--current-password', 'x')).toBe(2);
    h.io.readStdin = async () => 'only one\n';
    expect(await h.run('me', 'password', '--password-stdin')).toBe(2);
    expect(tools().some((t) => t.title === 'breakrocks me password')).toBe(false);
  });
  it('asks for a confirmation before an erasure or a deletion', async () => {
    const { h, calls } = scripted();
    expect(await h.run('me', 'data', 'erase', 'LOCATION')).toBe(2);
    expect(await h.run('me', 'delete', '@alice')).toBe(2);
    expect(calls).toEqual([]);
    expect(await h.run('--yes', 'me', 'delete', '@alice')).toBe(0);
    expect(calls[0].variables).toMatchObject({ handle: 'alice' });
  });
});

describe('connections and private messages', () => {
  it('names the discussion with exactly one target', async () => {
    const { h, calls } = scripted({ accountByHandle: { id: 'a2' }, changeMessage: { id: 'm1', text: 'See you at 8', author: { handle: 'me' }, createdAt: '2026-11-08T10:00:00.000Z' } });
    expect(await h.run('messages', 'edit', 'm1', 'See you at 8', '--with', '@alice')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'changeMessage', variables: { messageId: 'm1', text: 'See you at 8', discussion: { accountId: 'a2' } } });
    expect(h.lines.at(-1)).toBe('m1  2026-11-08T10:00:00.000Z  @me  See you at 8');
    expect(await h.run('messages', 'edit', 'm1', 'x', '--with', '@alice', '--group', 'g1')).toBe(2);
    expect(await h.run('messages', 'pin', 'm1')).toBe(2);
  });
  it('sets and clears the meeting point of a group chat', async () => {
    const { h, calls } = scripted();
    expect(await h.run('groups', 'meeting-point', 'g1', '--name', 'Bastille', '--point', '48.8532,2.3691')).toBe(0);
    expect(calls[0].variables).toMatchObject({ groupChatId: 'g1', place: { name: 'Bastille', point: { lat: 48.8532, lon: 2.3691 } } });
    expect(await h.run('groups', 'meeting-point', 'g1', '--clear')).toBe(0);
    expect(calls[1].variables).toMatchObject({ place: null });
    expect(await h.run('groups', 'meeting-point', 'g1', '--name', 'x')).toBe(2);
  });
  it('mutes, unmutes, silences and pins with fixed values', async () => {
    const { h, calls } = scripted();
    for (const argv of [['groups', 'mute', 'g1', '--mentions'], ['groups', 'unmute', 'g1'], ['messages', 'silence', '--group', 'g1', '--hours', '8'], ['messages', 'unsilence', '--group', 'g1'], ['messages', 'unpin', 'm1', '--group', 'g1']]) expect(await h.run(...argv)).toBe(0);
    expect(calls.map((c) => c.variables)).toMatchObject([{ muted: true, mentions: true }, { muted: false }, { silenced: true, hours: 8, discussion: { groupChatId: 'g1' } }, { silenced: false }, { pinned: false, messageId: 'm1' }]);
  });
});

describe('private universes', () => {
  it('sends a banner file, then sets the identity', async () => {
    const { h, calls } = scripted({ requestMediaUpload: { id: 'up1', url: 'https://s3.test/up', fields: '{}' }, setUniverseIdentity: { name: '%club.' } });
    writeFileSync(join(h.dir, 'banner.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    h.io.cwd = h.dir;
    expect(await h.run('universes', 'identity', '%club.', '--banner-file', 'banner.png', '--clear', 'LOGO')).toBe(0);
    expect(calls.map((c) => c.field)).toEqual(['requestMediaUpload', 'POST https://s3.test/up', 'setUniverseIdentity']);
    expect(calls[0].variables).toMatchObject({ i: { destination: 'UNIVERSE_BANNER' } });
    expect(calls[2].variables).toMatchObject({ universe: '%club.', input: { banner: { id: 'up1' }, clear: ['LOGO'] } });
    expect(await h.run('universes', 'identity', '%club.', '--banner-file', 'banner.png', '--banner', '{"id":"x"}')).toBe(2);
  });
  it('answers join requests one by one or all at once, and the decline of all asks first', async () => {
    const { h, calls } = scripted({ accountByHandle: { id: 'a1' }, answerJoinRequest: { answered: 1, waiting: 2 }, answerAllJoinRequests: { answered: 2, waiting: 0 } });
    expect(await h.run('universes', 'join-requests', 'accept', '%club.', '@alice')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'answerJoinRequest', variables: { accept: true, accountId: 'a1', universe: '%club.' } });
    expect(h.lines.at(-1)).toBe('answered 1, waiting 2');
    expect(await h.run('universes', 'join-requests', 'decline-all', '%club.')).toBe(2);
    expect(await h.run('--yes', 'universes', 'join-requests', 'decline-all', '%club.')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'answerAllJoinRequests', variables: { accept: false } });
  });
  it('subscribes to a tier: the payment page', async () => {
    const { h, calls } = scripted({ startTierSubscription: { url: 'https://pay.test/x', expiresAt: '2026-11-08T11:00:00.000Z', accessFrom: null } });
    expect(await h.run('universes', 'tiers', 'subscribe', '%club.', 't1', '--interval', 'MONTH', '--automatic-renewal', '--immediate-access-consent', '--conditions-version', '1')).toBe(0);
    expect(calls[0].variables).toMatchObject({ universe: '%club.', input: { tierId: 't1', interval: 'MONTH', automaticRenewal: true, immediateAccessConsent: true, conditionsVersion: 1 } });
    expect(h.lines.at(-1)).toContain('open to pay: https://pay.test/x');
  });
});

describe('governance', () => {
  it('chooses a backup delegate or none', async () => {
    const { h, calls } = scripted({ accountByHandle: { id: 'a1' } });
    expect(await h.run('governance', 'backup-delegate', '%paris', '@alice')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'setBackupDelegate', variables: { universe: '%paris', accountId: 'a1' } });
    expect(await h.run('governance', 'backup-delegate', '%paris', '--clear')).toBe(0);
    expect(calls.at(-1)!.variables).toMatchObject({ accountId: null });
    expect(await h.run('governance', 'backup-delegate', '%paris')).toBe(2);
  });
  it('changes an event by its id, the input flattened', async () => {
    const { h, calls } = scripted();
    expect(await h.run('events', 'change', 'e1', '--title', 'Night ride', '--clear', 'ROUTE', '--point', '{"lat":48.85,"lon":2.35}')).toBe(0);
    expect(calls[0].variables).toMatchObject({ input: { eventId: 'e1', title: 'Night ride', clear: ['ROUTE'], point: { lat: 48.85, lon: 2.35 } } });
  });
  it('votes as a juror, after a confirmation', async () => {
    const { h, calls } = scripted();
    expect(await h.run('jury', 'vote', 's1', '--outcome', 'REDUCED', '--reduced-to-days', '2', '--reasons', 'A first time')).toBe(2);
    expect(await h.run('--yes', 'jury', 'vote', 's1', '--outcome', 'REDUCED', '--reduced-to-days', '2', '--reasons', 'A first time')).toBe(0);
    expect(calls[0].variables).toMatchObject({ sanctionId: 's1', outcome: 'REDUCED', reducedToDays: 2, reasons: 'A first time' });
  });
});

describe('the moderation of universe discussions', () => {
  it('names a universe discussion by its address, resolved to its id', async () => {
    const { h, calls } = scripted({ universeDiscussion: (v: Record<string, unknown>) => ({ id: v.a === '%paris&velo' ? 'd1' : 'd2' }), moveUniverseDiscussion: { id: 'd1', address: '%paris&velo', lifetime: 'PERMANENT', status: 'OPEN' } });
    expect(await h.run('discussions', 'move', '%paris&velo', '--before', '%paris&general')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'moveUniverseDiscussion', variables: { id: 'd1', before: 'd2' } });
    expect(h.lines.at(-1)).toBe('%paris&velo  PERMANENT OPEN');
    expect(await h.run('discussions', 'slow-mode', 'd9', '30')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'setUniverseDiscussionSlowMode', variables: { id: 'd9', seconds: 30 } });
  });
  it('bans after a confirmation, lifts without', async () => {
    const { h, calls } = scripted({ accountByHandle: { id: 'a1' } });
    expect(await h.run('discussions', 'ban', 'd1', '@spammer', '--hours', '24')).toBe(2);
    expect(await h.run('--yes', 'discussions', 'ban', 'd1', '@spammer', '--hours', '24', '--article', '3')).toBe(0);
    expect(calls.at(-1)!.variables).toMatchObject({ id: 'd1', accountId: 'a1', banned: true, hours: 24, article: 3 });
    expect(await h.run('discussions', 'unban', 'd1', '@spammer')).toBe(0);
    expect(calls.at(-1)!.variables).toMatchObject({ banned: false });
  });
});

describe('the paid tiers', () => {
  it('gives the payment page of a subscription, never pays, and asks first', async () => {
    const { h, calls } = scripted({ startSubscription: { url: 'https://checkout.test/s', expiresAt: '2026-11-08T11:00:00.000Z' } });
    expect(await h.run('subscription', 'start', 'X2', '--interval', 'YEAR', '--automatic-renewal')).toBe(2);
    expect(await h.run('--yes', 'subscription', 'start', 'X2', '--interval', 'YEAR', '--automatic-renewal')).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].variables).toMatchObject({ tier: 'X2', interval: 'YEAR', automaticRenewal: true });
    expect(h.lines.at(-1)).toContain('open: https://checkout.test/s');
  });
  it('sends the billing day with its subscription', async () => {
    const { h, calls } = scripted({ billingDayOffer: { amount: 120, currency: 'EUR' } });
    expect(await h.run('subscription', 'billing-day', 'offer', '15', '--kind', 'TIER_SUBSCRIPTION', '--universe', '%club.', '--settle-now')).toBe(0);
    expect(calls[0].variables).toEqual({ input: { day: 15, settleNow: true }, subscription: { kind: 'TIER_SUBSCRIPTION', universe: '%club.' } });
  });
});
