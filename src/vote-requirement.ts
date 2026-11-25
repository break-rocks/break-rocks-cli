// The vote requirement of a residence as a person reads it (D-659): in the largest whole unit (days, else hours, else
// minutes) when the backend sends the minutes; in days otherwise (a backend without the minute fields: they come back
// null). A requirement of 0 (none today) would be no condition: nothing is shown for it.
// The refusals of the requirement (VOTE_ACCOUNT_TOO_RECENT, VOTE_JOINED_TOO_RECENTLY, contracts/errors.md) are told
// from their errorInfo { days, minutes, at }: the requirement (days, minutes) and when the act is allowed (at).

export type VoteRequirement = { accountDays?: number | null; presenceDays?: number | null; accountMinutes?: number | null; presenceMinutes?: number | null; contributionRequired?: boolean | null };
export type VoteStatus = { accountDaysDone?: number | null; presenceDaysDone?: number | null; accountMinutesDone?: number | null; presenceMinutesDone?: number | null; contributed?: boolean | null };

const UNITS = [{ name: 'day', minutes: 1440 }, { name: 'hour', minutes: 60 }, { name: 'minute', minutes: 1 }] as const;
const plural = (n: number, unit: string) => `${unit}${n === 1 ? '' : 's'}`;
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const unitOf = (minutes: number) => UNITS.find((u) => minutes % u.minutes === 0) ?? UNITS[2];

/** "1 day", "7 days", "90 minutes": a requirement in minutes, in its largest whole unit. */
export function durationText(minutes: number): string {
  const unit = unitOf(minutes);
  const n = minutes / unit.minutes;
  return `${n} ${plural(n, unit.name)}`;
}

/** "0 of 1 day": the progress [done] (minutes) against [required] (minutes, more than 0), in the unit of the requirement. */
export function progressInMinutes(done: number, required: number): string {
  const unit = unitOf(required);
  const need = required / unit.minutes;
  return `${Math.floor(Math.min(done, required) / unit.minutes)} of ${need} ${plural(need, unit.name)}`;
}

/** "account 0 of 1 day, residence 0 of 1 day[, contribution required]"; null without a condition left to show. */
export function voteProgress(requirement: VoteRequirement | null | undefined, status: VoteStatus | null | undefined): string | null {
  if (!requirement) return null;
  const part = (label: string, reqMinutes: unknown, doneMinutes: unknown, reqDays: unknown, doneDays: unknown): string | null => {
    if (isCount(reqMinutes)) return reqMinutes > 0 ? `${label} ${progressInMinutes(isCount(doneMinutes) ? doneMinutes : 0, reqMinutes)}` : null;
    if (isCount(reqDays) && reqDays > 0) return `${label} ${isCount(doneDays) ? doneDays : 0} of ${reqDays} ${plural(reqDays, 'day')}`;
    return null;
  };
  const parts = [
    part('account', requirement.accountMinutes, status?.accountMinutesDone, requirement.accountDays, status?.accountDaysDone),
    part('residence', requirement.presenceMinutes, status?.presenceMinutesDone, requirement.presenceDays, status?.presenceDaysDone),
    requirement.contributionRequired ? `contribution ${status?.contributed ? 'done' : 'required'}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? parts.join(', ') : null;
}

/** The refusal codes of the vote requirement (contracts/errors.md). */
export const VOTE_REQUIREMENT_REFUSALS = ['VOTE_ACCOUNT_TOO_RECENT', 'VOTE_JOINED_TOO_RECENTLY'] as const;

/**
 * The sentence of a refusal of the vote requirement from its errorInfo ("You can vote here from <at>: an account of
 * 1 day is required"); undefined for another code, or without the facts to tell it (the API's message then).
 */
export function voteRefusalSentence(code: string, info: unknown): string | undefined {
  if (!(VOTE_REQUIREMENT_REFUSALS as readonly string[]).includes(code) || !info || typeof info !== 'object') return undefined;
  const { days, minutes, at, accountId } = info as { days?: unknown; minutes?: unknown; at?: unknown; accountId?: unknown };
  const required = isCount(minutes) && minutes > 0 ? durationText(minutes) : isCount(days) && days > 0 ? `${days} ${plural(days, 'day')}` : undefined;
  const when = typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? at : undefined;
  if (!required && !when) return undefined;
  const recipient = typeof accountId === 'string' && accountId ? accountId : undefined;
  const who = recipient ? `The account ${recipient} can` : 'You can';
  const rule = code === 'VOTE_ACCOUNT_TOO_RECENT'
    ? `an account of ${required ?? 'some time'} is required`
    : `${required ?? 'some time'} since joining is required`;
  return when ? `${who} vote here from ${when}: ${rule}` : `${recipient ? `The account ${recipient} cannot` : 'You cannot'} vote here yet: ${rule}`;
}
