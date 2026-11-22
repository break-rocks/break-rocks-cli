// Specs v156.0.0 (D-506, D-510, D-512 (6), (8), (9)): the pre-filled links of the creation templates (offline), the short
// links /go/<code> and their daily limit, the settings "The center button opens" and "Share my activity with my close
// ones". Against a scripted API.
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { buildLink, keyOfPointer, openLink, templateOf } from '../src/experiences/prefill.js';
import { saveSession } from '../src/session.js';
import { harness, last } from './helpers.js';

type Call = { field: string; variables: Record<string, unknown>; query: string };
function fake(answers: Record<string, unknown>, errors: Record<string, { errorType?: string; message: string; errorInfo?: unknown }> = {}) {
  const calls: Call[] = [];
  const h = harness({
    env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1' },
    fetch: async (_url, init) => {
      const { query, variables } = JSON.parse(String(init!.body));
      const field = /\{\s*(\w+)/.exec(query.replace(/^[^{]*/, ''))![1];
      calls.push({ field, query, variables });
      if (errors[field]) return Response.json({ data: { [field]: null }, errors: [errors[field]] });
      const answer = answers[field];
      return Response.json({ data: { [field]: typeof answer === 'function' ? answer(variables) : answer ?? null } });
    },
  });
  saveSession(new Context(h.io, NO_FLAGS), { kind: 'agent', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op', agentId: 'ag' });
  return { h, calls };
}

describe('the keys of a pre-filled link', () => {
  it('come from the pointers of the choices, without the engine block, in kebab-case', () => {
    expect(keyOfPointer('/tournament/entrants/max', 'tournament')).toBe('entrants.max');
    expect(keyOfPointer('/contest/datedProof', 'contest')).toBe('dated-proof');
    expect(keyOfPointer('/ranking', 'challenge')).toBe('ranking');
    expect(keyOfPointer('/contest/public/votePer', 'contest')).toBe('public.vote-per');
  });

  it('are listed per creation template, with their default', async () => {
    const h = harness();
    expect(await h.run('experiences', 'prefill', 'keys', 'tournament', '--json')).toBe(0);
    const t = last<{ templates: { template: string; keys: { key: string; default: string }[]; notCarried: string[] }[] }>(h).templates[0];
    expect(t.template).toBe('tournament');
    expect(t.keys.find((k) => k.key === 'consolation')?.default).toBe('absent');
    expect(t.keys.find((k) => k.key === 'entrants.max')?.default).toBe('none (always written)');
    expect(t.notCarried).toContain('/tournament/challenges');
    expect(await h.run('experiences', 'prefill', 'keys', 'nope', '--json')).toBe(2);
  });
});

describe('experiences prefill build', () => {
  it('writes the keys sorted, the defaults left out, the values encoded, the attribution; it sends nothing', async () => {
    const h = harness();
    expect(await h.run('experiences', 'prefill', 'build', 'tournament', 'validation=REFEREED-true', 'format=POOLS_THEN_ELIMINATION', 'entrants.max=24', 'consolation=', 'activity=Pétanque; doubles', '--after', '@alice*open-des-sables', '--json')).toBe(0);
    const r = last<{ path: string; url: string; asked: string[]; shortLinkNeeded: boolean }>(h);
    expect(r.path).toBe('/new/tournament/v/activity=P%C3%A9tanque%3B%20doubles;entrants.max=24;format=POOLS_THEN_ELIMINATION;validation=REFEREED-true?after=%40alice*open-des-sables');
    expect(r.url).toBe(`https://beta.break.rocks${r.path}`);
    expect(r.path).not.toContain('consolation');
    expect(r.asked).toEqual(['dated-proof', 'ends-within-hours', 'profile', 'seeding']);
    expect(r.shortLinkNeeded).toBe(false);
  });

  it('writes a set in the order of the catalogue, joined by ","', () => {
    const r = buildLink(templateOf('contest')!, { forms: 'VIDEO,IMAGE', warnings: 'RISKY_PLACE,PHYSICAL_EFFORT' });
    expect('built' in r && r.built.path).toBe('/new/contest/v/forms=IMAGE,VIDEO;warnings=PHYSICAL_EFFORT,RISKY_PLACE');
  });

  it('refuses an unknown key, a value outside its choice, a key given twice, and a link beyond 2,000 characters', async () => {
    const h = harness();
    expect(await h.run('experiences', 'prefill', 'build', 'tournament', 'entrants.max=80', 'colour=red', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'PREFILLED_VALUES_INVALID', problems: [{ key: 'entrants.max' }, { key: 'colour' }] } });
    expect(await h.run('experiences', 'prefill', 'build', 'tournament', 'entrants.max=8', 'entrants.max=9', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'PREFILLED_KEY_TWICE' } });
    const long = '%'.repeat(100);
    const t = { key: 'many', version: 1, engine: { name: 'x', version: 1 }, choices: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`/x/t${i}`, { kind: 'TEXT' as const }])) };
    const r = buildLink(t, Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`t${i}`, long])));
    expect('built' in r && r.built.length).toBeGreaterThan(2000);
  });

  it('makes its short link with --short, and tells the daily limit with the moment it is possible again', async () => {
    const { h, calls } = fake({ createShortLink: (v: { u: string }) => ({ code: '7Hk2pQa9xT', url: v.u }) });
    expect(await h.run('experiences', 'prefill', 'build', 'attendance-meetup', 'ends-within-hours=3', '--short', '--json')).toBe(0);
    expect(calls[0].variables).toMatchObject({ u: '/new/attendance-meetup/v/ends-within-hours=3' });
    expect(last<{ shortLink: { link: string } }>(h).shortLink.link).toBe('https://beta.break.rocks/go/7Hk2pQa9xT');
    const limited = fake({}, { createShortLink: { errorType: 'SHORT_LINK_RATE_LIMITED', message: 'limit', errorInfo: { retryAt: '2026-10-24T00:00:00.000Z' } } });
    expect(await limited.h.run('links', 'shorten', 'https://break.rocks/new/contest/v/forms=IMAGE', '--json')).toBe(1);
    expect(last(limited.h)).toMatchObject({ error: { code: 'SHORT_LINK_RATE_LIMITED', source: 'platform', errorInfo: { retryAt: '2026-10-24T00:00:00.000Z' } } });
    expect(limited.calls[0].variables).toMatchObject({ u: '/new/contest/v/forms=IMAGE' });
  });
});

describe('experiences prefill open', () => {
  it('tells what opening fills: an unknown key ignored, a value out of bounds asked again; it creates nothing', async () => {
    const h = harness();
    expect(await h.run('experiences', 'prefill', 'open', 'https://break.rocks/new/tournament/v/colour=red;entrants.max=80;format=SCORE_RACE?after=%40alice*open-des-sables', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ valid: true, template: 'tournament', filled: [{ key: 'format', value: 'SCORE_RACE' }], askedAgain: [{ key: 'entrants.max', value: '80' }], ignored: ['colour'], after: '@alice*open-des-sables' });
    expect(await h.run('experiences', 'prefill', 'open', '/new/tournament/v/entrants.max=16')).toBe(0);
    expect(h.lines.at(-1)).toMatch(/opening it creates nothing[\s\S]*entrants\.max = 16[\s\S]*asked: .*the owner, the place of discussion and the name/);
  });

  it('a creation template no longer in the catalogue: the link is no longer valid (exit 1)', async () => {
    const h = harness();
    expect(await h.run('experiences', 'prefill', 'open', '/new/withdrawn/v/a=1', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ valid: false, template: 'withdrawn' });
    expect(openLink('/new/contest').valid).toBe(true);
    expect(await h.run('experiences', 'prefill', 'open', 'https://break.rocks/u/paris', '--json')).toBe(2);
  });

  it('reads a short link first, and an unknown one is not found', async () => {
    const { h, calls } = fake({ shortLink: (v: { c: string }) => (v.c === '7Hk2pQa9xT' ? { code: v.c, url: '/new/attendance-meetup/v/ends-within-hours=3' } : null) });
    expect(await h.run('experiences', 'prefill', 'open', 'https://break.rocks/go/7Hk2pQa9xT', '--json')).toBe(0);
    expect(last(h)).toMatchObject({ valid: true, template: 'attendance-meetup', filled: [{ key: 'ends-within-hours', value: '3' }] });
    expect(calls[0]).toMatchObject({ field: 'shortLink', variables: { c: '7Hk2pQa9xT' } });
    expect(await h.run('links', 'resolve', '0000000000', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'SHORT_LINK_NOT_FOUND' } });
    expect(await h.run('links', 'resolve', '/go/7Hk2pQa9xT')).toBe(0);
    expect(h.lines.at(-1)).toMatch(/^https:\/\/beta\.break\.rocks\/go\/7Hk2pQa9xT {2}→ {2}\/new\/attendance-meetup/);
  });
});

describe('the settings of v156', () => {
  it('reads and changes what the center button opens', async () => {
    const { h, calls } = fake({ mySettings: { navigation: { centerButtonOpens: 'MAP' } }, setSettings: (v: { input: { navigation: { centerButtonOpens: string } } }) => ({ navigation: v.input.navigation }) });
    expect(await h.run('me', 'navigation')).toBe(0);
    expect(h.lines.at(-1)).toBe('The center button opens: Map (Explore)');
    expect(await h.run('me', 'navigation', 'set', 'my-experiences')).toBe(0);
    expect(calls[1].variables).toMatchObject({ input: { navigation: { centerButtonOpens: 'MY_EXPERIENCES' } } });
    expect(Object.keys((calls[1].variables as { input: object }).input)).toEqual(['navigation']);
    expect(h.lines.at(-1)).toBe('The center button opens: My experiences');
    expect(await h.run('me', 'navigation', 'set', 'centre', '--json')).toBe(2);
  });

  it('turns "Share my activity with my close ones" on and off', async () => {
    const { h, calls } = fake({ mySettings: { shareActivityWithCloseOnes: false }, setSettings: (v: { input: { shareActivityWithCloseOnes: boolean } }) => v.input });
    expect(await h.run('me', 'privacy', 'share-activity')).toBe(0);
    expect(h.lines.at(-1)).toBe('Share my activity with my close ones: off');
    expect(await h.run('me', 'privacy', 'share-activity', 'set', 'on')).toBe(0);
    expect(calls[1].variables).toMatchObject({ input: { shareActivityWithCloseOnes: true } });
    expect(h.lines.at(-1)).toBe('Share my activity with my close ones: on');
  });
});

describe('the app tour of v157 (D-514, D-515)', () => {
  const TOUR = { state: 'IN_PROGRESS', step: 4, mode: 'LISTEN', voiceLanguage: 'fr', autoAdvance: false, resumeCardClosed: false, newNavigationCardDismissed: false, gestures: [{ gesture: 'DOUBLE_TAP_PLACE', outcome: 'TRIED' }] };

  it('reads the state of the app tour', async () => {
    const { h, calls } = fake({ mySettings: { tour: TOUR } });
    expect(await h.run('me', 'tour')).toBe(0);
    expect(calls[0].query).toContain('tour { state step mode voiceLanguage');
    expect(h.lines.at(-1)).toBe([
      'App tour: in progress, left at step 4 of 9', 'Tour mode: Listen', 'Voice language: fr', 'Move on alone after a successful gesture: off', 'Hidden gestures: double tap place (tried)',
    ].join('\n'));
  });

  it('skips the tour, writing the state alone', async () => {
    const { h, calls } = fake({ setSettings: (v: { input: { tour: object } }) => ({ tour: { ...TOUR, ...v.input.tour, step: null } }) });
    expect(await h.run('me', 'tour', 'skip')).toBe(0);
    expect(calls[0].variables).toMatchObject({ input: { tour: { state: 'SKIPPED' } } });
    expect(Object.keys((calls[0].variables as { input: object }).input)).toEqual(['tour']);
    expect(h.lines.at(-1)).toMatch(/^App tour: skipped/);
    expect(await h.run('me', 'tour', 'skip', '--dry-run', '--json')).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('changes the preferences, never the state, and asks for at least one', async () => {
    const { h, calls } = fake({ setSettings: (v: { input: { tour: object } }) => ({ tour: { ...TOUR, ...v.input.tour } }) });
    expect(await h.run('me', 'tour', 'set', '--mode', 'BOTH', '--auto-advance', '--voice-language', 'de')).toBe(0);
    expect(calls[0].variables).toMatchObject({ input: { tour: { mode: 'BOTH', autoAdvance: true, voiceLanguage: 'de' } } });
    expect(Object.keys((calls[0].variables as { input: object }).input)).toEqual(['tour']);
    expect(await h.run('me', 'tour', 'set', '--json')).toBe(2);
    expect(await h.run('me', 'tour', 'set', '--mode', 'whisper', '--json')).toBe(2);
    expect(await h.run('me', 'tour', 'set', '--state', 'FINISHED', '--json')).toBe(2);
    expect(await h.run('me', 'tour', 'set', '--step', '3', '--json')).toBe(2);
    expect(calls).toHaveLength(1);
  });

  it('shows the refusal of the platform for a finished tour', async () => {
    const { h } = fake({}, { setSettings: { errorType: 'TOUR_STATE_INVALID', message: 'the app tour is finished' } });
    expect(await h.run('me', 'tour', 'skip', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'TOUR_STATE_INVALID' } });
  });

  it('says an agent operator has no app tour, without calling the API', async () => {
    const { h, calls } = fake({});
    saveSession(new Context(h.io, NO_FLAGS), { kind: 'operator', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op' });
    expect(await h.run('me', 'tour', '--json')).toBe(1);
    expect(last(h)).toMatchObject({ error: { code: 'NO_APP_TOUR_FOR_AGENT_OPERATOR' } });
    expect(await h.run('me', 'tour', 'skip', '--json')).toBe(1);
    expect(calls).toHaveLength(0);
  });
});
