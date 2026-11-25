// Experiences beyond their documents: the kinds (models) the platform runs, an experience made public, its runs (start,
// join, a measure, the end, the ranking; a tournament's and a contest's acts), and the place feats (a run at a place, its
// end with its photo or clip, its publication as a post). Each command is one operation of API v2 (apiCommand), the same on
// both backends (docs/sulfur.md).
import { apiCommand } from '../api/command.js';

const runId = { runId: 'The run (experienceRun)' };

export const experiencesKinds = apiCommand({
  name: 'experiences kinds', summary: 'The kinds of experience the platform runs, with their versions (experienceKinds)', kind: 'query', op: 'experienceKinds',
  examples: ['breakrocks experiences kinds', 'breakrocks experiences kinds --json'],
  text: (r) => ((r as { name: string; version: number }[] | null) ?? []).map((k) => `${k.name} v${k.version}`).join('\n') || '(none)',
});

export const experiencesPublish = apiCommand({
  name: 'experiences publish', summary: 'Make an experience public, unlisted or private again (publishExperience)', kind: 'mutation', op: 'publishExperience',
  positionals: ['experienceId'], descriptions: { experienceId: 'The experience (experiences list)', visibility: 'PUBLIC, UNLISTED or PRIVATE' },
  examples: ['breakrocks experiences publish <experience id> --visibility PUBLIC'],
});

export const runsStart = apiCommand({
  name: 'experiences runs start', summary: 'Start a run of an experience: a challenge, a tournament, a contest (startExperienceRun)', kind: 'mutation', op: 'startExperienceRun',
  positionals: ['input.experienceId'],
  descriptions: { experienceId: 'The experience to run', parameters: 'Its parameters: [{ "key", "value" }] (JSON)', tournament: 'A tournament\'s settings (TournamentStartInput, JSON)', contest: 'A contest\'s settings (ContestStartInput, JSON)', startsAt: 'When it starts (ISO 8601; now when absent)', discussion: 'The discussion it is run in (DiscussionRefInput, JSON)' },
  examples: ['breakrocks experiences runs start <experience id>', 'breakrocks experiences runs start <experience id> --starts-at 2026-12-01T10:00:00Z --appear-in-ranking'],
});

export const runsJoin = apiCommand({
  name: 'experiences runs join', summary: 'Join a run (joinExperienceRun; --code: the code of a private run)', kind: 'mutation', op: 'joinExperienceRun', positionals: ['runId'], descriptions: runId,
  examples: ['breakrocks experiences runs join <run id>'],
});

export const runsLeave = apiCommand({
  name: 'experiences runs leave', summary: 'Leave a run (leaveExperienceRun)', kind: 'mutation', op: 'leaveExperienceRun', positionals: ['runId'], descriptions: runId,
  examples: ['breakrocks experiences runs leave <run id>'],
});

export const runsMeasure = apiCommand({
  name: 'experiences runs measure', summary: 'Record a measure of a run: a value, a visit, a proof; --final the last one (submitExperienceMeasure)', kind: 'mutation', op: 'submitExperienceMeasure',
  positionals: ['input.runId'],
  descriptions: { runId: 'The run', value: 'The value measured (an integer: points, metres, seconds…)', final: 'The final measure', measuredAt: 'When it was measured (ISO 8601)', visit: 'A visit of a stage (VisitProgressInput, JSON)', proofMediaId: 'A photo or a clip uploaded for the feat (destination feat)' },
  examples: ['breakrocks experiences runs measure <run id> --value 42 --measured-at 2026-11-25T10:00:00Z --final'],
});

export const runsEnd = apiCommand({
  name: 'experiences runs end', summary: 'End a run (endExperienceRun: its organizer)', kind: 'mutation', op: 'endExperienceRun', positionals: ['runId'], descriptions: runId,
  examples: ['breakrocks experiences runs end <run id>'],
});

export const runsShow = apiCommand({
  name: 'experiences runs show', summary: 'A run: its state, its participants, its measures (experienceRun)', kind: 'query', op: 'experienceRun', positionals: ['id'], descriptions: { id: 'The run' },
  examples: ['breakrocks experiences runs show <run id> --json'],
});

export const runsList = apiCommand({
  name: 'experiences runs list', summary: 'Your runs, the most recent first (myExperienceRuns)', kind: 'query', op: 'myExperienceRuns',
  examples: ['breakrocks experiences runs list', 'breakrocks experiences runs list --all --json'],
});

export const runsRanking = apiCommand({
  name: 'experiences runs ranking', summary: 'The ranking of a run (experienceRunRanking)', kind: 'query', op: 'experienceRunRanking', positionals: ['runId'], descriptions: runId,
  examples: ['breakrocks experiences runs ranking <run id>'],
});

export const runsDraw = apiCommand({
  name: 'experiences runs draw', summary: 'Draw a tournament: its first round (drawTournament; --order: the seeds in order)', kind: 'mutation', op: 'drawTournament', positionals: ['runId'], descriptions: runId,
  examples: ['breakrocks experiences runs draw <run id>'],
});

export const runsTournament = apiCommand({
  name: 'experiences runs tournament', summary: 'Act on a tournament: declare a result, confirm, vote, decide, schedule… (actOnTournament)', kind: 'mutation', op: 'actOnTournament', positionals: ['runId'],
  flatten: [], descriptions: { ...runId, act: 'The act (TournamentActInput, JSON): one of declare, confirm, vote, decide, contest, settle, choose, schedule, seed, invite, setSignUp, follow…' },
  examples: ['breakrocks experiences runs tournament <run id> --act \'{"follow":true}\''],
});

export const runsContest = apiCommand({
  name: 'experiences runs contest', summary: 'Act on a contest: submit an entry, score, rank, vote… (actOnContest)', kind: 'mutation', op: 'actOnContest', positionals: ['runId'],
  flatten: [], descriptions: { ...runId, act: 'The act (ContestActInput, JSON): one of submit, withdraw, score, rank, decide, vote, invite, setSignUp, follow…' },
  examples: ['breakrocks experiences runs contest <run id> --act \'{"follow":true}\''],
});

export const runsEntries = apiCommand({
  name: 'experiences runs entries', summary: 'The entries of a contest (contestEntries)', kind: 'query', op: 'contestEntries', positionals: ['runId'], descriptions: runId,
  examples: ['breakrocks experiences runs entries <run id>'],
});

export const featsList = apiCommand({
  name: 'experiences feats list', summary: 'Your place feats, done or in progress (myFeats)', kind: 'query', op: 'myFeats',
  examples: ['breakrocks experiences feats list --json'],
});

export const featsOf = apiCommand({
  name: 'experiences feats at', summary: 'The feats of a place (placeFeats)', kind: 'query', op: 'placeFeats', positionals: ['placeId'], descriptions: { placeId: 'The place (map places search)' },
  examples: ['breakrocks experiences feats at <place id>'],
});

export const featsStart = apiCommand({
  name: 'experiences feats start', summary: 'Start a place feat: its run at the place (startPlaceFeatRun)', kind: 'mutation', op: 'startPlaceFeatRun', positionals: ['placeFeatId'], descriptions: { placeFeatId: 'The place feat (experiences feats at)' },
  examples: ['breakrocks experiences feats start <place feat id>'],
});

export const featsEnd = apiCommand({
  name: 'experiences feats end', summary: 'End a place feat: its outcome, its photo or clip (endPlaceFeatRun)', kind: 'mutation', op: 'endPlaceFeatRun', positionals: ['input.instanceId'],
  descriptions: { instanceId: 'The feat in progress (experiences feats start)', outcome: 'How it ended', mediaId: 'A photo or a clip uploaded for it (destination feat)' },
  examples: ['breakrocks experiences feats end <instance id> --outcome COMPLETED'],
});

export const featsPublish = apiCommand({
  name: 'experiences feats publish', summary: 'Publish a feat done as a post of a universe (publishFeat)', kind: 'mutation', op: 'publishFeat', positionals: ['input.instanceId'],
  descriptions: { instanceId: 'The feat done', universe: 'The universe of its post (%name)', text: 'The text of its post', inIt: 'You are in its photo or clip', peopleShownAgreed: 'The people shown agreed', placement: 'Where it is shown on the map' },
  examples: ['breakrocks experiences feats publish <instance id> --universe %paris --text "Done!" --in-it --people-shown-agreed'],
});

export const experienceRunCommands = [experiencesKinds, experiencesPublish, runsStart, runsJoin, runsLeave, runsMeasure, runsEnd, runsShow, runsList, runsRanking, runsDraw, runsTournament, runsContest, runsEntries, featsList, featsOf, featsStart, featsEnd, featsPublish];
