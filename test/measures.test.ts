// Specs v84.4.0 to v87.3.0: platform measures and their appeal, the terms accepted, advertising. Against a scripted API.
import { describe, expect, it } from 'vitest';
import { Context, NO_FLAGS } from '../src/context.js';
import { saveSession } from '../src/session.js';
import { harness, last } from './helpers.js';
import { scripted } from './scripted.js';

describe('platform measures and terms', () => {
  it('lists the measures and appeals one, only with yes', async () => {
    const measure = { id: 'pm1', kind: 'CONTENT_REMOVAL', article: 4, startsAt: '2026-11-01T10:00:00.000Z', endsAt: null, cancelled: false, appealableUntil: '2027-05-01T10:00:00.000Z', appeal: null, statement: 'Spam' };
    const { h, calls } = scripted({ myPlatformMeasures: { items: [measure], next: null }, appealPlatformMeasure: { ...measure, appeal: { status: 'OPEN', outcome: null } } });
    expect(await h.run('me', 'measures')).toBe(0);
    expect(h.lines.at(-1)).toBe('pm1  CONTENT_REMOVAL  article 4  2026-11-01T10:00:00.000Z  appealable until 2027-05-01T10:00:00.000Z');
    expect(await h.run('me', 'measures', 'appeal', 'pm1', '--text', 'A quote', '--json')).toBe(2);
    expect(await h.run('--yes', 'me', 'measures', 'appeal', 'pm1', '--text', 'A quote')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'appealPlatformMeasure', variables: { measureId: 'pm1', text: 'A quote' } });
    expect(h.lines.at(-1)).toBe('pm1  CONTENT_REMOVAL  article 4  2026-11-01T10:00:00.000Z  appeal OPEN');
  });
  it('shows a measure against a universe and the removed search words, with universe in JSON (D-397, D-398)', async () => {
    const theme = { id: 'pm2', kind: 'CONTENT_REMOVAL', article: 0, startsAt: '2026-11-16T10:00:00.000Z', endsAt: null, cancelled: false, appealableUntil: null, appeal: null, statement: 'Theme', universe: '%paris', snippet: null, subjectWhere: null };
    const words = { ...theme, id: 'pm3', universe: null, snippet: 'spam, scam', subjectWhere: '%paris' };
    const { h, calls } = scripted({ myPlatformMeasures: { items: [theme, words], next: null } });
    expect(await h.run('me', 'measures')).toBe(0);
    expect(calls[0].query).toMatch(/\buniverse\b/);
    expect(calls[0].query).toMatch(/\bsnippet\b/);
    expect(h.lines.at(-1)!.split('\n')).toEqual(['pm2  CONTENT_REMOVAL  article 0  2026-11-16T10:00:00.000Z  universe %paris', 'pm3  CONTENT_REMOVAL  article 0  2026-11-16T10:00:00.000Z  "spam, scam"  in %paris']);
    expect(await h.run('me', 'measures', '--json')).toBe(0);
    expect(last<{ items: { universe: string | null }[] }>(h).items.map((m) => m.universe)).toEqual(['%paris', null]);
  });
  it('reads the terms accepted and accepts the latest (read first when not given)', async () => {
    const terms = { terms: '2026-09-01', rules: '2026-09-01', acceptedAt: '2026-09-02T00:00:00.000Z', latestTerms: '2026-11-01', latestRules: '2026-09-01', latestTermsAppliesAt: '2026-11-15', latestRulesAppliesAt: '2026-09-01' };
    const { h, calls } = scripted({ myTermsAcceptance: terms, acceptTerms: { ...terms, terms: '2026-11-01' } });
    expect(await h.run('me', 'terms')).toBe(0);
    expect(h.lines.at(-1)).toContain('newer versions to accept: breakrocks me terms accept');
    expect(await h.run('--yes', 'me', 'terms', 'accept')).toBe(0);
    expect(calls.at(-1)).toMatchObject({ field: 'acceptTerms', variables: { terms: '2026-11-01', rules: '2026-09-01' } });
    expect(await h.run('--yes', 'me', 'terms', 'accept', '--terms', 'a', '--rules', 'b', '--json')).toBe(0);
    expect(calls.at(-1)!.variables).toMatchObject({ terms: 'a', rules: 'b' });
    expect(calls.filter((c) => c.field === 'myTermsAcceptance')).toHaveLength(2);
  });
});

describe('advertising', () => {
  const campaign = { id: 'c1', name: 'Autumn', state: 'DRAFT', bidKind: 'CPM', budget: 0, spent: 0, currency: 'EUR', startsAt: '2026-11-15T00:00:00Z', endsAt: null, rejectionReason: null };
  it('creates, submits, pauses, resumes, ends (with yes) and pays a campaign', async () => {
    const { h, calls } = scripted({ createAdCampaign: campaign, submitAdCampaign: { ...campaign, state: 'IN_REVIEW' }, setAdCampaignState: (v: Record<string, unknown>) => ({ ...campaign, state: v.state }), payAdBudget: { page: { url: 'https://pay.test/s' }, campaign: { ...campaign, budget: 50 } }, myAdCampaigns: { items: [campaign], next: null } });
    const creatives = '[{"format":"IMAGE","headline":"Repairs","text":"Same day","mediaId":"m1","callToAction":"LEARN_MORE","destinationUrl":"https://example.org"}]';
    expect(await h.run('ads', 'create', '--name', 'Autumn', '--creatives', creatives, '--universes', '%paris', '--territories', 'FR', '--languages', 'fr', '--max-cpm', '4', '--currency', 'EUR', '--starts-at', '2026-11-15T00:00:00Z')).toBe(0);
    expect(calls[0].variables.input).toMatchObject({ name: 'Autumn', universes: ['%paris'], maxCpm: 4, creatives: [{ format: 'IMAGE', mediaId: 'm1' }] });
    expect(h.lines.at(-1)).toBe('c1  Autumn  DRAFT  CPM  0/0 EUR  2026-11-15T00:00:00Z');
    expect(await h.run('ads', 'submit', 'c1')).toBe(0);
    expect(await h.run('ads', 'pause', 'c1')).toBe(0);
    expect(await h.run('ads', 'resume', 'c1')).toBe(0);
    expect(await h.run('ads', 'end', 'c1', '--json')).toBe(2);
    expect(await h.run('--yes', 'ads', 'end', 'c1')).toBe(0);
    expect(calls.filter((c) => c.field === 'setAdCampaignState').map((c) => c.variables.state)).toEqual(['PAUSED', 'RUNNING', 'ENDED']);
    expect(await h.run('--yes', 'ads', 'pay', 'c1', '50', '--currency', 'EUR', '--source', 'CARD')).toBe(0);
    expect(calls.at(-1)!.variables).toMatchObject({ campaignId: 'c1', amount: 50, currency: 'EUR', source: 'CARD' });
    expect(h.lines.at(-1)).toContain('pay at: https://pay.test/s');
    expect(await h.run('ads', 'campaigns')).toBe(0);
  });
  it('suggests universes, reads a group, the repository, why an ad, and the declared interests', async () => {
    const { h, calls } = scripted({
      adUniverseSuggestions: [{ universe: '%paris-velo', residents: 900, activeResidents: 300, cpmLow: 2, cpmHigh: 4, currency: 'EUR', topics: ['repairs'] }], adUniverseGroup: { seed: '%paris', universes: ['%paris', '%paris-velo'], refreshedAt: 'today' },
      adRepository: { items: [{ ad: { id: 'a1', headline: 'Repairs' }, firstShownAt: 'a', lastShownAt: 'b', universes: ['%paris'] }], next: null }, adWhy: { reasons: [] }, myAdInterests: { offered: true, enabled: false, interests: [] }, setAdInterests: { offered: true, enabled: true, interests: ['SPORTS'] },
    });
    expect(await h.run('ads', 'suggest', '--text', 'Repairs', '--territories', 'FR')).toBe(0);
    expect(calls[0].variables).toEqual({ input: { text: 'Repairs', territories: ['FR'] } });
    expect(h.lines.at(-1)).toBe('%paris-velo  300/900 active  CPM 2–4 EUR  repairs');
    expect(await h.run('ads', 'group', '%paris')).toBe(0);
    expect(h.lines.at(-1)).toBe('%paris: %paris, %paris-velo  (refreshed today)');
    expect(await h.run('ads', 'repository', '--universe', '%paris')).toBe(0);
    expect(h.lines.at(-1)).toBe('a1  a → b  Repairs  %paris');
    expect(await h.run('ads', 'why', 'tok', '--json')).toBe(0);
    expect(await h.run('ads', 'interests')).toBe(0);
    expect(h.lines.at(-1)).toBe('off');
    expect(await h.run('ads', 'interests', 'set', 'SPORTS', '--enabled')).toBe(0);
    expect(calls.at(-1)!.variables).toMatchObject({ enabled: true, interests: ['SPORTS'] });
    expect(h.lines.at(-1)).toBe('on: SPORTS');
    expect(await h.run('ads', 'interests', 'set', 'NOPE', '--enabled', '--json')).toBe(2);
    expect(last(h)).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });
});

describe('refusals of an appeal (D-398)', () => {
  it('gives the sentence of PLATFORM_APPEAL_LEADERSHIP_ONLY and PLATFORM_APPEAL_EXISTS answered without one', async () => {
    for (const [code, sentence] of [['PLATFORM_APPEAL_LEADERSHIP_ONLY', 'A measure against a universe is appealed by its leadership only'], ['PLATFORM_APPEAL_EXISTS', 'This measure is already appealed: one appeal per measure, whoever filed it']]) {
      const h = harness({ env: { BREAKROCKS_API_URL: 'https://api.test/graphql', BREAKROCKS_AGENTS_URL: 'https://agents.test/v1' }, fetch: async () => Response.json({ data: null, errors: [{ errorType: code, message: code }] }) });
      saveSession(new Context(h.io, NO_FLAGS), { kind: 'agent', token: 't', sessionId: 's', expiresAt: '2099-01-01T00:00:00.000Z', operatorId: 'eu-op', agentId: 'ag' });
      expect(await h.run('--yes', 'me', 'measures', 'appeal', 'pm2', '--json')).toBe(1);
      expect(last(h)).toMatchObject({ error: { code, message: sentence, source: 'platform' } });
    }
  });
});
