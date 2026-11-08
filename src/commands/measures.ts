// What the platform decided about the account and what it accepted (specs v84.4.0, v85.0.0, D-250;
// contracts/platform-measures.md): its platform measures with their statements of reasons and its appeal of one
// (DSA art. 20), the terms of use and platform rules it accepted; and advertising (specs v85.5.0, v87.3.0, D-266;
// contracts/advertising.md): campaigns, budgets, universe suggestions and groups, the public ad repository, "why
// this ad", declared ad interests. Recording an impression or a click is for an app that shows ads, not a CLI.
// The trusted flaggers, the authority orders and the transparency report are internal (backoffice-cli).
import { apiCommand } from '../api/command.js';
import { selection } from '../api/graphql.js';
import { usageError } from '../errors.js';
import { api } from '../session.js';
import { pageText } from './shared.js';

type Measure = { id: string; kind: string; article?: number; startsAt?: string; endsAt?: string | null; cancelled?: boolean; appealableUntil?: string | null; appeal?: { status?: string; outcome?: string | null } | null; statement?: string };
const measureLine = (m: Measure) => `${m.id}  ${m.kind}  article ${m.article ?? '-'}  ${m.startsAt ?? ''}${m.endsAt ? ` → ${m.endsAt}` : ''}${m.cancelled ? '  cancelled' : ''}${m.appeal ? `  appeal ${m.appeal.status}${m.appeal.outcome ? ` (${m.appeal.outcome})` : ''}` : m.appealableUntil ? `  appealable until ${m.appealableUntil}` : ''}`;
export const meMeasures = apiCommand({
  name: 'me measures', summary: 'The platform measures the account received in the last 2 years, each with its statement of reasons and its appeal (myPlatformMeasures)',
  description: 'Readable in restricted access (suspended, banned). --json gives the statements of reasons.',
  kind: 'query', op: 'myPlatformMeasures', text: pageText(measureLine), examples: ['breakrocks me measures', 'breakrocks me measures --all --json'],
});
export const meMeasuresAppeal = apiCommand({
  name: 'me measures appeal', summary: 'Appeal a platform measure, once, free, within 6 months, with a text of 2,000 characters at most (appealPlatformMeasure; DSA art. 20)',
  description: 'Decided by a member of the platform team other than its author; the measure stays in force until then. Never by a delegated agent (DELEGATED_AGENT_NOT_ALLOWED). PLATFORM_APPEAL_DEADLINE_PASSED, PLATFORM_APPEAL_EXISTS, PLATFORM_APPEAL_NOT_AVAILABLE (an authority order), PLATFORM_APPEAL_TEXT_TOO_LONG.',
  kind: 'mutation', op: 'appealPlatformMeasure', positionals: ['measureId'], dry: true, descriptions: { measureId: 'The measure (me measures)', text: 'Why (2,000 characters at most)' },
  confirm: (i) => `Appeal the measure ${String(i.measureId)}? An appeal is made once.`, text: (r) => (r ? measureLine(r as Measure) : '(none)'),
  examples: ['breakrocks me measures appeal <measure id> --text "The post quoted a news article" --yes'],
});
type Terms = { terms: string; rules: string; acceptedAt: string; latestTerms: string; latestRules: string; latestTermsAppliesAt?: string; latestRulesAppliesAt?: string };
const termsText = (r: unknown) => {
  const t = r as Terms | null;
  if (!t) return '(none)';
  const behind = t.terms !== t.latestTerms || t.rules !== t.latestRules;
  return [`terms of use: ${t.terms} accepted (latest ${t.latestTerms}, applies ${t.latestTermsAppliesAt ?? '-'})`, `platform rules: ${t.rules} accepted (latest ${t.latestRules}, applies ${t.latestRulesAppliesAt ?? '-'})`, `accepted at: ${t.acceptedAt}`, ...(behind ? ['newer versions to accept: breakrocks me terms accept'] : [])].join('\n');
};
export const meTerms = apiCommand({
  name: 'me terms', summary: 'The versions of the terms of use and of the platform rules the account accepted, and the latest published (myTermsAcceptance)', kind: 'query', op: 'myTermsAcceptance', text: termsText,
  examples: ['breakrocks me terms', 'breakrocks me terms --json'],
});
export const meTermsAccept = apiCommand({
  name: 'me terms accept', summary: 'Accept the latest published versions of the terms of use and of the platform rules (acceptTerms; the latest read first when not given)',
  description: 'Allowed in restricted access. PLATFORM_RULES_VERSION_INVALID when a version given is not the latest published.',
  kind: 'mutation', op: 'acceptTerms', hide: ['terms', 'rules'], extra: { terms: { type: 'string', description: 'The version of the terms of use (default: the latest)' }, rules: { type: 'string', description: 'The version of the platform rules (default: the latest)' } },
  prepare: async (i, ctx) => {
    if (i.terms && i.rules) return i;
    const t = (await api<{ myTermsAcceptance: Terms | null }>(ctx, '{ myTermsAcceptance { latestTerms latestRules } }')).myTermsAcceptance;
    if (!t) throw usageError('INVALID_INPUT', 'No published version read: give --terms and --rules');
    return { ...i, terms: i.terms ?? t.latestTerms, rules: i.rules ?? t.latestRules };
  },
  confirm: (i) => `Accept the terms of use ${String(i.terms ?? 'latest')} and the platform rules ${String(i.rules ?? 'latest')}?`, text: termsText,
  examples: ['breakrocks me terms accept --yes', 'breakrocks me terms accept --terms 2026-10-01 --rules 2026-10-01 --yes'],
});

// ---- Advertising ----

type Campaign = { id: string; name: string; state: string; bidKind?: string; budget?: number; spent?: number; currency?: string; startsAt?: string; endsAt?: string | null; rejectionReason?: string | null };
const campaignLine = (c: Campaign) => `${c.id}  ${c.name}  ${c.state}  ${c.bidKind ?? ''}  ${c.spent ?? 0}/${c.budget ?? 0} ${c.currency ?? ''}  ${c.startsAt ?? ''}${c.endsAt ? ` → ${c.endsAt}` : ''}${c.rejectionReason ? `  rejected: ${c.rejectionReason}` : ''}`;
const campaignText = (r: unknown) => (r ? campaignLine(r as Campaign) : '(none)');
const CAMPAIGN = selection('AdCampaign', 2);
const campaignInput = {
  name: 'The name of the campaign', creatives: 'Its creatives: [{ "format", "headline", "text", "mediaId", "callToAction", "destinationUrl" }] (JSON)', universes: 'The public universes targeted (ads on)', territories: 'The territories (ISO 3166)',
  languages: 'The languages (ISO 639-1)', maxCpm: 'The maximum price per 1,000 impressions', maxCpc: 'The maximum price per click (CPC)', currency: 'The currency (ISO 4217)', startsAt: 'When it starts (ISO 8601)', endsAt: 'When it ends (ISO 8601)',
  bidKind: 'CPM or CPC', universeGroups: 'Universe groups (their seeds, %paris)', interests: 'Declared ad interests targeted',
};
export const adsCampaigns = apiCommand({
  name: 'ads campaigns', summary: 'The ad campaigns of the account, the most recent first (myAdCampaigns)', kind: 'query', op: 'myAdCampaigns', select: `{ items ${selection('AdCampaign', 0)} next }`, text: pageText(campaignLine),
  examples: ['breakrocks ads campaigns', 'breakrocks ads campaigns --all --json'],
});
export const adsShow = apiCommand({
  name: 'ads show', summary: 'An ad campaign of the account: its creatives, states, budget and daily aggregates (adCampaign)', kind: 'query', op: 'adCampaign', positionals: ['campaignId'], select: CAMPAIGN,
  descriptions: { campaignId: 'The campaign' }, examples: ['breakrocks ads show <campaign id>', 'breakrocks ads show <campaign id> --json'],
});
export const adsCreate = apiCommand({
  name: 'ads create', summary: 'Create an ad campaign, DRAFT: its creatives, targeting (universes, groups, interests), bid and dates (createAdCampaign; a human of full age or a verified organization)',
  description: 'ADS_NOT_OPEN, ADVERTISER_NOT_ALLOWED, AD_TARGETING_INVALID, AD_BID_BELOW_FLOOR, AD_FORMAT_NOT_OFFERED. Then: ads pay (its budget), ads submit (the review of creatives).',
  kind: 'mutation', op: 'createAdCampaign', descriptions: campaignInput, dry: true, select: CAMPAIGN, text: campaignText,
  examples: ['breakrocks ads create --name "Autumn" --creatives \'[{"format":"IMAGE","headline":"Repairs","text":"Same day","mediaId":"<upload id>","callToAction":"LEARN_MORE","destinationUrl":"https://example.org"}]\' --universes %paris --territories FR --languages fr --max-cpm 4 --currency EUR --starts-at 2026-11-15T00:00:00Z'],
});
export const adsUpdate = apiCommand({
  name: 'ads update', summary: 'Change an ad campaign, its whole content (updateAdCampaign; a creative changed sends it back to the review)', kind: 'mutation', op: 'updateAdCampaign', positionals: ['campaignId'], descriptions: { ...campaignInput, campaignId: 'The campaign' }, dry: true, select: CAMPAIGN, text: campaignText,
  examples: ['breakrocks ads update <campaign id> --name "Autumn" --creatives \'[…]\' --universes %paris --territories FR --languages fr --max-cpm 5 --currency EUR --starts-at 2026-11-15T00:00:00Z'],
});
export const adsSubmit = apiCommand({
  name: 'ads submit', summary: 'Send an ad campaign to the review of its creatives (submitAdCampaign; AD_BUDGET_REQUIRED, IDENTITY_NOT_VERIFIED)', kind: 'mutation', op: 'submitAdCampaign', positionals: ['campaignId'], descriptions: { campaignId: 'The campaign' }, select: CAMPAIGN, text: campaignText,
  examples: ['breakrocks ads submit <campaign id>'],
});
const state = (verb: string, value: string, what: string) => apiCommand({
  name: `ads ${verb}`, summary: `${what} an ad campaign (setAdCampaignState ${value})`, kind: 'mutation', op: 'setAdCampaignState', fixed: { state: value }, positionals: ['campaignId'], descriptions: { campaignId: 'The campaign' }, select: CAMPAIGN, text: campaignText,
  ...(value === 'ENDED' ? { confirm: (i: Record<string, unknown>) => `End the campaign ${String(i.campaignId)}? It cannot run again.` } : {}),
  examples: [`breakrocks ads ${verb} <campaign id>${value === 'ENDED' ? ' --yes' : ''}`],
});
export const adsPause = state('pause', 'PAUSED', 'Pause');
export const adsResume = state('resume', 'RUNNING', 'Resume');
export const adsEnd = state('end', 'ENDED', 'End');
export const adsPay = apiCommand({
  name: 'ads pay', summary: 'Prepay the budget of a campaign, 10 EUR at least: by card (a page of the payment provider) or from the universe cash of --universe by its leadership (payAdBudget)', kind: 'mutation', op: 'payAdBudget', positionals: ['campaignId', 'amount'],
  descriptions: { campaignId: 'The campaign', amount: 'The amount', currency: 'The currency (ISO 4217)', source: 'CARD or UNIVERSE_CASH', universe: 'The universe whose cash pays (UNIVERSE_CASH)', returnPath: 'Where the payment page returns (a path of the app)' },
  confirm: (i) => `Pay ${String(i.amount)} ${String(i.currency)} for the campaign ${String(i.campaignId)} (${String(i.source)})?`,
  text: (r) => { const p = r as { page?: { url?: string } | null; campaign?: Campaign } | null; return p ? [p.campaign ? campaignLine(p.campaign) : '', ...(p.page?.url ? [`pay at: ${p.page.url}`] : [])].filter(Boolean).join('\n') : '(none)'; },
  examples: ['breakrocks ads pay <campaign id> 50 --currency EUR --source CARD --yes', 'breakrocks ads pay <campaign id> 20 --currency EUR --source UNIVERSE_CASH --universe %paris --yes'],
});
type Suggestion = { universe: string; residents: number; activeResidents: number; cpmLow: number; cpmHigh: number; currency: string; topics?: string[] };
export const adsSuggest = apiCommand({
  name: 'ads suggest', summary: 'At most 20 public universes with ads on for an offer, the best first, from public content only (adUniverseSuggestions; 20 a day)', kind: 'query', op: 'adUniverseSuggestions',
  descriptions: { text: 'The offer, in words', keywords: 'Keywords', siteUrl: 'The site of the advertiser', territories: 'The territories (ISO 3166)', languages: 'The languages (ISO 639-1)' },
  text: (r) => (Array.isArray(r) && r.length ? (r as Suggestion[]).map((s) => `${s.universe}  ${s.activeResidents}/${s.residents} active  CPM ${s.cpmLow}–${s.cpmHigh} ${s.currency}${s.topics?.length ? `  ${s.topics.join(', ')}` : ''}`).join('\n') : '(none)'),
  examples: ['breakrocks ads suggest --text "Repairs of bicycles in Paris" --territories FR --languages fr'],
});
export const adsGroup = apiCommand({
  name: 'ads group', summary: 'The universe group of a public universe as seed: the universes it gathers (adUniverseGroup)', kind: 'query', op: 'adUniverseGroup', positionals: ['universe'], descriptions: { universe: 'The seed universe (%paris)' },
  text: (r) => { const g = r as { seed: string; universes: string[]; refreshedAt?: string } | null; return g ? `${g.seed}: ${g.universes.join(', ')}  (refreshed ${g.refreshedAt ?? '-'})` : '(no group)'; },
  examples: ['breakrocks ads group %paris'],
});
type RepositoryEntry = { ad: { id: string; headline: string; destinationUrl?: string }; firstShownAt: string; lastShownAt: string; universes?: string[]; removedReason?: string | null };
export const adsRepository = apiCommand({
  name: 'ads repository', summary: 'The public ad repository: the ads served in the last 12 months, by advertiser or universe (adRepository)', kind: 'query', op: 'adRepository',
  descriptions: { advertiser: 'The advertiser (its account id)', universe: 'The universe' },
  text: pageText((e: RepositoryEntry) => `${e.ad.id}  ${e.firstShownAt} → ${e.lastShownAt}  ${e.ad.headline}${e.universes?.length ? `  ${e.universes.join(', ')}` : ''}${e.removedReason ? `  removed: ${e.removedReason}` : ''}`),
  examples: ['breakrocks ads repository --universe %paris', 'breakrocks ads repository --advertiser <account id> --json'],
});
export const adsWhy = apiCommand({
  name: 'ads why', summary: '"Why this ad" for the token of an ad slot (adWhy; DSA art. 26)', kind: 'query', op: 'adWhy', positionals: ['token'], descriptions: { token: 'The token of the ad slot (AD_SLOT_EXPIRED)' },
  examples: ['breakrocks ads why <slot token>'],
});
const interestsText = (r: unknown) => { const s = r as { offered?: boolean; enabled?: boolean; interests?: string[] } | null; return s ? `${s.offered ? '' : 'not offered here; '}${s.enabled ? 'on' : 'off'}${s.interests?.length ? `: ${s.interests.join(', ')}` : ''}` : '(none)'; };
export const adsInterests = apiCommand({
  name: 'ads interests', summary: 'The declared ad interests of the account: offered, on or off, and which (myAdInterests)', kind: 'query', op: 'myAdInterests', text: interestsText, examples: ['breakrocks ads interests'],
});
export const adsInterestsSet = apiCommand({
  name: 'ads interests set', summary: 'Turn one\'s declared ad interests on with 0 to 10 of them, or off, which erases them at once (setAdInterests; a human of full age)', kind: 'mutation', op: 'setAdInterests', positionals: ['interests'],
  descriptions: { enabled: 'On (true) or off (false: the interests erased)', interests: 'The interests (10 at most)' }, text: interestsText,
  examples: ['breakrocks ads interests set SPORTS TRAVEL --enabled', 'breakrocks ads interests set --no-enabled --interests ""'],
});
