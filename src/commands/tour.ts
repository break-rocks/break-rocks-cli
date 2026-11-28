// The app tour of specs v157.0.0 (D-514, D-515; contracts/onboarding.md § The app tour): Settings.tour, what the apps keep with
// the account. The tour itself (the steps, the hidden gesture demos, the tour voice) is played by the mobile apps only, in a
// window below 600 pixels; the CLI reads its state and writes what a terminal can do honestly: "Skip the tour" and the three
// preferences (the default tour mode, the voice language, "Move on alone after a successful gesture"). It never starts,
// resumes, replays nor finishes the tour (`step`, `gestures`, IN_PROGRESS and FINISHED are written by the apps as the user
// plays it; a replay writes `gestures` only), nor closes the cards. An agent operator has no app tour (D-515).
import { apiCommand } from '../api/command.js';
import { cliRefusal, usageError } from '../errors.js';
import type { Context } from '../context.js';
import { readSession } from '../session.js';
import { settingsBut } from './navigation.js';

const TOUR = '{ tour { state step mode voiceLanguage autoAdvance resumeCardClosed newNavigationCardDismissed gestures { gesture outcome } } }';

/** The session of an agent operator account (its key signs in): it has no app tour. A delegated agent acts for its operator, the API says. */
function notForOperator(ctx: Context): void {
  if ((readSession(ctx)?.kind ?? ctx.profile().kind) === 'operator') throw cliRefusal('NO_APP_TOUR_FOR_AGENT_OPERATOR', 'An agent operator has no app tour (D-515): the app tour is for the account of a human, played in the mobile apps');
}

type Tour = { state: string; step?: number | null; mode?: string | null; voiceLanguage?: string | null; autoAdvance?: boolean; resumeCardClosed?: boolean; newNavigationCardDismissed?: boolean; gestures?: { gesture: string; outcome: string }[] };
const STATES: Record<string, string> = {
  NOT_STARTED: 'not started', NEW_NAVIGATION: 'not started (an account created before the app tour: the new navigation card is offered)',
  IN_PROGRESS: 'in progress', FINISHED: 'finished', SKIPPED: 'skipped',
};
const MODES: Record<string, string> = { READ: 'Read', LISTEN: 'Listen', BOTH: 'Both' };
const word = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export const tourText = (r: unknown) => {
  const t = (r as { tour?: Tour } | null)?.tour;
  if (!t) return 'No app tour for this account.';
  return [
    `App tour: ${STATES[t.state] ?? t.state}${t.state === 'IN_PROGRESS' && t.step ? `, left at step ${t.step} of 9` : ''}`,
    `Tour mode: ${t.mode ? MODES[t.mode] ?? t.mode : 'not chosen (the apps choose Both, or Listen with a screen reader on)'}`,
    `Voice language: ${t.voiceLanguage ?? 'the language of the app'}`,
    `Move on alone after a successful gesture: ${t.autoAdvance ? 'on' : 'off'}`,
    `Hidden gestures: ${t.gestures?.length ? t.gestures.map((g) => `${word(g.gesture)} (${word(g.outcome)})`).join(', ') : 'none reached'}`,
  ].join('\n');
};

export const tourShow = apiCommand({
  name: 'me tour', summary: 'The app tour of the account: its state, its mode, its voice language (mySettings.tour)',
  description: 'NOT_STARTED, NEW_NAVIGATION (derived for an account created before the app tour), IN_PROGRESS (with its step, 1 to 8), FINISHED or SKIPPED, the default tour mode, the voice language, "Move on alone after a successful gesture" and the hidden gestures reached. The app tour is played by the mobile apps, on a phone; an agent operator has no app tour (D-515).',
  kind: 'query', op: 'mySettings', select: TOUR, text: tourText,
  prepare: (i, ctx) => { notForOperator(ctx); return i; },
  examples: ['breakrocks me tour', 'breakrocks me tour --json --fields tour.state'],
});

export const tourSkip = apiCommand({
  name: 'me tour skip', summary: 'Skip the app tour of the account (setSettings tour SKIPPED)',
  description: 'Writes "Skip the tour": allowed from NOT_STARTED, NEW_NAVIGATION and IN_PROGRESS, and again once skipped. A finished or skipped tour is never left (TOUR_STATE_INVALID for FINISHED); a replay is made in the apps, which write the gestures only. Skipping completes nothing of the onboarding.',
  kind: 'mutation', op: 'setSettings', dry: true,
  hide: settingsBut('tour'), fixed: { 'input.tour': { state: 'SKIPPED' } },
  prepare: (i, ctx) => { notForOperator(ctx); return i; },
  select: TOUR, text: tourText,
  examples: ['breakrocks me tour skip', 'breakrocks me tour skip --dry-run'],
});

export const tourSet = apiCommand({
  name: 'me tour set', summary: 'Choose the tour mode, the voice language or the auto move on option (setSettings tour)',
  description: 'The preferences kept with the account for the app tour: --mode READ, LISTEN or BOTH (the default tour mode), --voice-language (one of the 20 languages of the apps, BCP 47), --auto-advance or --no-auto-advance ("Move on alone after a successful gesture", off by default; the apps apply it only while "Nothing disappears on its own" is off, D-515). A field not given stays. The state, the step and the gestures are written by the apps as the tour is played.',
  kind: 'mutation', op: 'setSettings', dry: true, flatten: ['input', 'input.tour'],
  hide: [...settingsBut('tour'), 'input.tour.state', 'input.tour.step', 'input.tour.gestures', 'input.tour.resumeCardClosed', 'input.tour.newNavigationCardDismissed'],
  descriptions: { mode: 'The default tour mode: READ, LISTEN or BOTH', voiceLanguage: 'The voice language (BCP 47: fr, en…)', autoAdvance: '"Move on alone after a successful gesture": --auto-advance, or --no-auto-advance' },
  prepare: (i, ctx) => {
    notForOperator(ctx);
    if (i.mode === undefined && i.voiceLanguage === undefined && i.autoAdvance === undefined) throw usageError('INVALID_INPUT', 'Give at least one of --mode, --voice-language, --auto-advance');
    return i;
  },
  select: TOUR, text: tourText,
  examples: ['breakrocks me tour set --mode LISTEN', 'breakrocks me tour set --voice-language fr --auto-advance --dry-run'],
});

// The gesture tips of the apps (Settings.tips, contracts/layouts.md § Gesture tips): which were already shown. The apps mark them;
// the CLI reads them only (a tip shown is never shown again, so marking one from a terminal would hide it in the apps).
type Tips = { homeGestures?: boolean; universeGestures?: boolean; authorSwipe?: boolean };
const TIPS: Record<string, string> = { homeGestures: 'the gestures of the home', universeGestures: 'the gestures of a universe', authorSwipe: 'the swipe to the author of a clip or a post' };
export const tipsShow = apiCommand({
  name: 'me tips', summary: 'The gesture tips of the apps already shown to the account (mySettings.tips)',
  kind: 'query', op: 'mySettings', select: '{ tips { homeGestures universeGestures authorSwipe } }',
  text: (r) => { const t = (r as { tips?: Tips | null } | null)?.tips; return t ? Object.entries(TIPS).map(([k, label]) => `${label}: ${t[k as keyof Tips] ? 'shown' : 'not shown yet'}`).join('\n') : 'No gesture tips for this account.'; },
  examples: ['breakrocks me tips', 'breakrocks me tips --json'],
});

export const tourCommands = [tourShow, tourSkip, tourSet, tipsShow];
