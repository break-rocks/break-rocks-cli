// The vote requirement in minutes (D-659: the group of friends 1 day / 1 day everywhere): its display in the largest
// whole unit, nothing for a requirement of 0, the days of a backend without the minute fields, the fields requested and
// kept by the seam, `universes residences` in text and --json, and the refusals told from their errorInfo.
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { selection } from '../src/api/graphql.js';
import { SCHEMA } from '../src/api/schema.generated.js';
import { fitDocument } from '../src/sulfur/fit.js';
import { SERVER } from '../src/sulfur/schema.generated.js';
import { durationText, progressInMinutes, voteProgress, voteRefusalSentence } from '../src/vote-requirement.js';
import { CliError } from '../src/errors.js';
import { sulfurGraphql } from '../src/sulfur/http.js';
import { harness, last, sulfurSession } from './helpers.js';

describe('the vote requirement as a person reads it', () => {
  it('shows the requirement in the largest unit that keeps it whole', () => {
    expect(progressInMinutes(1000, 1440)).toBe('0 of 1 day');
    expect(progressInMinutes(120, 180)).toBe('2 of 3 hours');
    expect(progressInMinutes(5000, 10080)).toBe('3 of 7 days');
    expect(progressInMinutes(1440, 1440)).toBe('1 of 1 day');
    expect(progressInMinutes(100, 90)).toBe('90 of 90 minutes');
    expect(progressInMinutes(59, 60)).toBe('0 of 1 hour');
  });
  it('reads the minute fields, else the days of a backend without them', () => {
    expect(voteProgress({ accountDays: 1, presenceDays: 1, accountMinutes: 1440, presenceMinutes: 1440, contributionRequired: false }, { accountDaysDone: 0, presenceDaysDone: 0, accountMinutesDone: 150, presenceMinutesDone: 0, contributed: false }))
      .toBe('account 0 of 1 day, residence 0 of 1 day');
    expect(voteProgress({ accountDays: 7, presenceDays: 3, accountMinutes: 10080, presenceMinutes: 4320, contributionRequired: false }, { accountDaysDone: 7, presenceDaysDone: 1, accountMinutesDone: 10080, presenceMinutesDone: 2000 }))
      .toBe('account 7 of 7 days, residence 1 of 3 days');
    expect(voteProgress({ accountDays: 3, presenceDays: 1, accountMinutes: null, presenceMinutes: null, contributionRequired: true }, { accountDaysDone: 2, presenceDaysDone: 0, accountMinutesDone: null, presenceMinutesDone: null, contributed: false }))
      .toBe('account 2 of 3 days, residence 0 of 1 day, contribution required');
    expect(voteProgress(null, null)).toBeNull();
  });
  it('shows no condition for a requirement of 0', () => {
    expect(voteProgress({ accountDays: 0, presenceDays: 0, accountMinutes: 0, presenceMinutes: 0, contributionRequired: false }, { accountMinutesDone: 0, presenceMinutesDone: 0 })).toBeNull();
    expect(voteProgress({ accountDays: 0, presenceDays: 0, accountMinutes: 0, presenceMinutes: 1440, contributionRequired: false }, { accountMinutesDone: 0, presenceMinutesDone: 60 })).toBe('residence 0 of 1 day');
    expect(voteProgress({ accountDays: 0, presenceDays: 0, contributionRequired: false }, {})).toBeNull();
  });
});

describe('the refusals of the vote requirement', () => {
  const at = '2026-11-27T10:00:00.000Z';
  it('tell when the act is allowed and the requirement, from errorInfo', () => {
    expect(durationText(1440)).toBe('1 day');
    expect(durationText(10080)).toBe('7 days');
    expect(voteRefusalSentence('VOTE_ACCOUNT_TOO_RECENT', { days: 1, minutes: 1440, at })).toBe(`You can vote here from ${at}: an account of 1 day is required`);
    expect(voteRefusalSentence('VOTE_JOINED_TOO_RECENTLY', { days: 3, minutes: 4320, at })).toBe(`You can vote here from ${at}: 3 days since joining is required`);
    expect(voteRefusalSentence('VOTE_JOINED_TOO_RECENTLY', { days: 1, minutes: 1440, at, accountId: 'eu_x' })).toBe(`The account eu_x can vote here from ${at}: 1 day since joining is required`);
    // A former backend: the days only, no date.
    expect(voteRefusalSentence('VOTE_ACCOUNT_TOO_RECENT', { days: 3 })).toBe('You cannot vote here yet: an account of 3 days is required');
    expect(voteRefusalSentence('VOTE_ACCOUNT_TOO_RECENT', {})).toBeUndefined();
    expect(voteRefusalSentence('NOT_A_RESIDENT', { days: 1, at })).toBeUndefined();
  });
  const refusal = async (f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      return e as CliError;
    }
    throw new Error('not refused');
  };
  it('extensions.reason and extensions.errorInfo', async () => {
    const h = harness({ fetch: async () => Response.json({ errors: [{ message: 'a resident votes here 1440 minutes after joining', extensions: { code: 'REFUSED', reason: 'VOTE_JOINED_TOO_RECENTLY', errorInfo: { days: 1, minutes: 1440, at } } }] }) });
    const e = await refusal(() => sulfurGraphql(new Context(h.io, NO_FLAGS), 'https://eu.api.test', 't', 'mutation { lendVotes(universe: "%friends", accountId: "eu_b") { holds } }'));
    expect(e.message).toBe(`You can vote here from ${at}: 1 day since joining is required`);
    expect(e.toJSON()).toMatchObject({ error: { code: 'VOTE_JOINED_TOO_RECENTLY', kind: 'REFUSED', errorInfo: { days: 1, minutes: 1440, at } } });
  });
});

describe('the minute fields requested', () => {
  it('are in the selection of a residence and kept by the seam of the new backend', () => {
    const doc = `{ myPresences ${selection('ResidencePage', 2)} }`;
    for (const f of ['accountMinutes', 'presenceMinutes', 'accountMinutesDone', 'presenceMinutesDone', 'accountDays', 'presenceDaysDone']) expect(doc).toContain(f);
    const fitted = fitDocument(doc, {}, SERVER, SCHEMA).document;
    for (const f of ['accountMinutes', 'presenceMinutes', 'accountMinutesDone', 'presenceMinutesDone', 'accountDays', 'presenceDaysDone']) expect(fitted).toContain(f);
  });
});

describe('universes residences', () => {
  const residence = (extra: Record<string, unknown>) => ({
    universe: '%friends', joinedAt: '2026-11-25T08:00:00.000Z', endsAt: '2026-12-25T08:00:00.000Z', canVote: false, canVoteAt: '2026-11-26T08:00:00.000Z', continuousPresence: null, ...extra,
  });
  const run = async (item: Record<string, unknown>, ...argv: string[]) => {
    const h = harness({
      env: { BREAKROCKS_SULFUR_URL: 'https://api.test' },
      fetch: async () => Response.json({ data: { myPresences: { items: [item], next: null } } }),
    });
    sulfurSession(h.io, 'agent');
    expect(await h.run('universes', 'residences', ...argv)).toBe(0);
    return h;
  };

  it('tells where the resident stands, in days, and gives the minute fields in --json', async () => {
    const item = residence({
      voteRequirement: { accountDays: 1, presenceDays: 1, accountMinutes: 1440, presenceMinutes: 1440, contributionRequired: false },
      voteStatus: { accountDaysDone: 3, presenceDaysDone: 0, accountMinutesDone: 4500, presenceMinutesDone: 10, contributed: false },
    });
    const text = await run(item);
    expect(text.lines.join('\n')).toContain('votes from 2026-11-26T08:00:00.000Z  (account 1 of 1 day, residence 0 of 1 day)');
    const json = await run(item, '--json');
    expect(JSON.stringify(last(json))).toContain('"accountMinutes":1440');
    expect(JSON.stringify(last(json))).toContain('"presenceMinutesDone":10');
    expect(JSON.stringify(last(json))).toContain('"accountDays":1');
  });
  it('keeps the days of a backend without the minute fields, and says nothing more once it votes', async () => {
    const legacy = await run(residence({ voteRequirement: { accountDays: 3, presenceDays: 1, contributionRequired: false }, voteStatus: { accountDaysDone: 1, presenceDaysDone: 0, contributed: false } }));
    expect(legacy.lines.join('\n')).toContain('(account 1 of 3 days, residence 0 of 1 day)');
    const votes = await run(residence({ canVote: true, voteRequirement: { accountDays: 1, presenceDays: 1, accountMinutes: 1440, presenceMinutes: 1440, contributionRequired: false }, voteStatus: { accountMinutesDone: 1440, presenceMinutesDone: 1440 } }));
    expect(votes.lines.join('\n')).toMatch(/votes$/m);
  });
});
