// Private universes and what their owner and admins run (D-92, D-303: the operations of before specs v83.1.0 still
// without a command): join requests, invitations received, admins, the transfer, the deletion and its
// cancellation, the settings, own domains (DNS proof), the member tier (team, declaration), exposed parts,
// reactivation, reputation, search words, identity (banner, logo, watermark), the subscription tiers and the
// subscription to one. And what any universe offers its reader: residences, the sub-universe map, the landing page,
// the members page listing, the landing mark.
import { apiCommand } from '../api/command.js';
import type { Context } from '../context.js';
import { usageError } from '../errors.js';
import { checkImage, uploadImage } from '../media.js';
import { pageText } from './shared.js';

const u = { universe: 'The universe (%name)', in: 'The universe (%name)', account: 'The account: @handle or its id' };
type Ref = { handle?: string } | null | undefined;
const at = (a: Ref) => (a?.handle ? `@${a.handle}` : '-');
type UniverseLine = { name?: string; display?: string | null; private?: boolean; memberCount?: number | null; archived?: boolean };
const universeText = (r: unknown) => { const x = r as UniverseLine | null; return x ? `${x.name ?? ''}${x.display ? `  ${x.display}` : ''}${x.memberCount != null ? `  ${x.memberCount} member(s)` : ''}` : '(none)'; };

// ---- Join requests and invitations ----

type JoinRequest = { account?: Ref; createdAt?: string; expiresAt?: string; universe?: string };
export const joinRequests = apiCommand({
  name: 'universes join-requests', summary: 'The join requests waiting in a private universe joined by request, the oldest first (joinRequests; its owner and admins)', kind: 'query', op: 'joinRequests', positionals: ['universe'], descriptions: u,
  text: pageText((x: JoinRequest) => `${at(x.account)}  asked ${x.createdAt ?? '-'}  expires ${x.expiresAt ?? '-'}`), examples: ['breakrocks universes join-requests %club.'],
});
const answersText = (r: unknown) => { const a = r as { answered?: number; waiting?: number } | null; return a ? `answered ${a.answered ?? 0}, waiting ${a.waiting ?? 0}` : '(none)'; };
const answerOne = (accept: boolean) => apiCommand({
  name: `universes join-requests ${accept ? 'accept' : 'decline'}`, summary: `${accept ? 'Accept' : 'Decline'} the join request of an account (answerJoinRequest)`, kind: 'mutation', op: 'answerJoinRequest', fixed: { accept },
  positionals: ['universe', 'accountId'], rename: { accountId: 'account' }, descriptions: u, text: answersText, examples: [`breakrocks universes join-requests ${accept ? 'accept' : 'decline'} %club. @alice`],
});
const answerAll = (accept: boolean) => apiCommand({
  name: `universes join-requests ${accept ? 'accept-all' : 'decline-all'}`, summary: accept ? 'Accept every waiting join request, up to the member tier (answerAllJoinRequests)' : 'Decline every waiting join request (answerAllJoinRequests)',
  kind: 'mutation', op: 'answerAllJoinRequests', fixed: { accept }, positionals: ['universe'], descriptions: u, text: answersText,
  ...(accept ? {} : { confirm: (i: Record<string, unknown>) => `Decline every join request of ${String(i.universe)}?` }),
  examples: [`breakrocks universes join-requests ${accept ? 'accept-all %club.' : 'decline-all %club. --yes'}`],
});
export const joinRequestsAccept = answerOne(true);
export const joinRequestsDecline = answerOne(false);
export const joinRequestsAcceptAll = answerAll(true);
export const joinRequestsDeclineAll = answerAll(false);

type Invitation = { universe?: string; inviter?: Ref; status?: string; createdAt?: string; expiresAt?: string };
export const invitations = apiCommand({
  name: 'universes invitations', summary: 'The invitations to private universes received, the most recent first (universeInvitations)', kind: 'query', op: 'universeInvitations',
  text: pageText((x: Invitation) => `${x.universe ?? ''}  ${x.status ?? ''}  by ${at(x.inviter)}  expires ${x.expiresAt ?? '-'}`), examples: ['breakrocks universes invitations'],
});
export const invitationsAccept = apiCommand({
  name: 'universes invitations accept', summary: 'Accept an invitation to a private universe: join it, with the version of its conditions accepted (answerUniverseInvitation)',
  description: '--conditions-version: the version of the conditions of the universe accepted (universes conditions show); CONDITIONS_NOT_ACCEPTED without it when it has conditions.',
  kind: 'mutation', op: 'answerUniverseInvitation', fixed: { accept: true }, positionals: ['universe'], descriptions: { ...u, conditionsVersion: 'The version of the conditions accepted' }, depth: 1, text: universeText,
  examples: ['breakrocks universes invitations accept %club. --conditions-version 2'],
});
export const invitationsDecline = apiCommand({
  name: 'universes invitations decline', summary: 'Decline an invitation to a private universe (answerUniverseInvitation)', kind: 'mutation', op: 'answerUniverseInvitation', fixed: { accept: false }, hide: ['conditionsVersion'],
  positionals: ['universe'], descriptions: u, depth: 1, text: universeText, examples: ['breakrocks universes invitations decline %club.'],
});

// ---- The owner and the admins ----

const admin = (on: boolean) => apiCommand({
  name: `universes admins ${on ? 'add' : 'remove'}`, summary: on ? 'Name a member admin of a private universe (setUniverseAdmin; its owner)' : 'Remove the admin role of a member (setUniverseAdmin)', kind: 'mutation', op: 'setUniverseAdmin', fixed: { admin: on },
  positionals: ['universe', 'accountId'], rename: { accountId: 'account' }, descriptions: u,
  text: (r) => { const m = r as { account?: Ref; role?: string } | null; return m ? `${at(m.account)}  ${m.role ?? ''}` : '(none)'; },
  examples: [`breakrocks universes admins ${on ? 'add' : 'remove'} %club. @alice`],
});
export const adminsAdd = admin(true);
export const adminsRemove = admin(false);
const transfer = (accept: boolean) => apiCommand({
  name: `universes transfer ${accept ? 'accept' : 'decline'}`, summary: accept ? 'Accept the transfer of a private universe: become its owner (answerUniverseTransfer)' : 'Decline the transfer of a private universe (answerUniverseTransfer)',
  kind: 'mutation', op: 'answerUniverseTransfer', fixed: { accept }, positionals: ['universe'], descriptions: u, depth: 1, text: universeText,
  ...(accept ? { confirm: (i: Record<string, unknown>) => `Become the owner of ${String(i.universe)}?` } : {}),
  examples: [`breakrocks universes transfer ${accept ? 'accept %club. --yes' : 'decline %club.'}`],
});
export const transferAccept = transfer(true);
export const transferDecline = transfer(false);
const deletionText = (r: unknown) => { const d = r as { universe?: string; deletedAt?: string | null; deletedForGoodAt?: string | null } | null; return d ? `${d.universe}  ${d.deletedAt ? `deleted ${d.deletedAt}, for good ${d.deletedForGoodAt ?? '-'}` : 'not deleted'}` : '(none)'; };
export const universesDelete = apiCommand({
  name: 'universes delete', summary: 'Delete a private universe: hidden at once, deleted for good 30 days later unless cancelled (deletePrivateUniverse; its owner)', kind: 'mutation', op: 'deletePrivateUniverse', positionals: ['universe'], descriptions: u,
  confirm: (i) => `Delete ${String(i.universe)}? Deleted for good in 30 days unless cancelled.`, text: deletionText, examples: ['breakrocks universes delete %club. --yes'],
});
export const universesDeleteCancel = apiCommand({
  name: 'universes delete-cancel', summary: 'Cancel the deletion of a private universe before it is deleted for good (cancelUniverseDeletion)', kind: 'mutation', op: 'cancelUniverseDeletion', positionals: ['universe'], descriptions: u,
  text: deletionText, examples: ['breakrocks universes delete-cancel %club.'],
});
export const privateSet = apiCommand({
  name: 'universes private set', summary: 'Change the settings of a private universe: display case, join mode, automatic alternative texts and subtitles (changePrivateUniverse; its owner)',
  description: 'A field not given stays. --join-mode INVITATION, REQUEST or SUBSCRIPTION; --no-automatic-alt, --no-automatic-subtitles turn them off. legalSpace is always refused.',
  kind: 'mutation', op: 'changePrivateUniverse', positionals: ['universe'], hide: ['input.legalSpace'], dry: true, descriptions: { ...u, display: 'The display case of its name (the same name)' }, depth: 1, text: universeText,
  examples: ['breakrocks universes private set %club. --join-mode REQUEST', 'breakrocks universes private set %club. --no-automatic-subtitles'],
});
type Creation = { status?: string; dnsProof?: { recordType?: string; recordName?: string; value?: string; expiresAt?: string } | null; universe?: { name?: string } | null };
export const domains = apiCommand({
  name: 'universes domains', summary: 'The own domains waiting for their DNS proof: the TXT record to publish (pendingDomains)', kind: 'query', op: 'pendingDomains',
  text: (r) => (Array.isArray(r) && r.length ? (r as { universe?: string; recordType?: string; recordName?: string; value?: string; expiresAt?: string }[]).map((d) => `${d.universe}  ${d.recordType} ${d.recordName} "${d.value}"  expires ${d.expiresAt}`).join('\n') : '(none)'),
  examples: ['breakrocks universes domains'],
});
export const domainsCheck = apiCommand({
  name: 'universes domains check', summary: 'Look for the DNS TXT record of an own domain: found, the private universe is created (checkDnsProof)', kind: 'mutation', op: 'checkDnsProof', positionals: ['domain'], descriptions: { domain: 'The domain (example.com)' },
  text: (r) => { const c = r as Creation | null; return c ? `${c.status}${c.universe?.name ? `  ${c.universe.name}` : ''}${c.dnsProof ? `  ${c.dnsProof.recordType} ${c.dnsProof.recordName} "${c.dnsProof.value}"` : ''}` : '(none)'; },
  examples: ['breakrocks universes domains check example.com'],
});
export const teamTier = apiCommand({
  name: 'universes team-tier', summary: 'After a declaration found false: choose the free member tier of a team, 10 members (chooseTeamMemberTier; its owner)', kind: 'mutation', op: 'chooseTeamMemberTier', positionals: ['universe'], descriptions: u, depth: 1,
  confirm: (i) => `Choose the team tier for ${String(i.universe)}? Its members beyond 10 become read-only.`, text: universeText, examples: ['breakrocks universes team-tier %club. --yes'],
});
export const declare = apiCommand({
  name: 'universes declare', summary: 'Declare an association (its registration number) or an open-source project (its public repository): the member tier goes to 1,000, free (declareUniverse)',
  kind: 'mutation', op: 'declareUniverse', positionals: ['universe', 'kind', 'reference'], descriptions: { ...u, kind: 'ASSOCIATION or OPEN_SOURCE', reference: 'The registration number, or the https address of the public repository' }, depth: 1, text: universeText,
  examples: ['breakrocks universes declare %club. OPEN_SOURCE https://github.com/example/club'],
});
export const expose = apiCommand({
  name: 'universes expose', summary: 'Expose a sub-universe of a private universe and everything below it: read, reply or participate (exposeUniverse)', kind: 'mutation', op: 'exposeUniverse', positionals: ['universe'],
  descriptions: { universe: 'The sub-universe (%club./news)', access: 'READ (by default), REPLY or PARTICIPATE' }, depth: 1, text: universeText, examples: ['breakrocks universes expose %club./news --access REPLY'],
});
export const hide = apiCommand({
  name: 'universes hide', summary: 'Hide the exposed parts of a private universe again (hideUniverse)', kind: 'mutation', op: 'hideUniverse', positionals: ['universe'], descriptions: u, depth: 1, text: universeText, examples: ['breakrocks universes hide %club./news'],
});
export const reactivate = apiCommand({
  name: 'universes reactivate', summary: 'Reactivate an archived universe: its 12 months start again (reactivateUniverse; its owner)', kind: 'mutation', op: 'reactivateUniverse', positionals: ['universe'], descriptions: u, depth: 1, text: universeText, examples: ['breakrocks universes reactivate %club.'],
});
const reputationText = (r: unknown) => { const x = r as { universe?: string; turnedOn?: boolean; foldingCoefficient?: number; threshold?: number; appliesFrom?: string | null } | null; return x ? `${x.universe}  ${x.turnedOn ? 'on' : 'off'}  folding coefficient ${x.foldingCoefficient}  threshold ${x.threshold}${x.appliesFrom ? `  from ${x.appliesFrom}` : ''}` : '(none)'; };
export const reputation = apiCommand({
  name: 'universes reputation', summary: 'The reputation of a private universe, for its members (privateUniverseReputation)', kind: 'query', op: 'privateUniverseReputation', positionals: ['universe'], descriptions: u, text: reputationText, examples: ['breakrocks universes reputation %club.'],
});
export const reputationSet = apiCommand({
  name: 'universes reputation set', summary: 'Turn the reputation of a private universe on (from the next midnight UTC) or off (at once), and set its folding coefficient (setUniverseReputation; its owner)', kind: 'mutation', op: 'setUniverseReputation', positionals: ['universe'],
  descriptions: { ...u, turnedOn: 'On (--turned-on) or off (--no-turned-on)', foldingCoefficient: 'The coefficient of the folding threshold' }, text: reputationText, examples: ['breakrocks universes reputation set %club. --turned-on --folding-coefficient 1.5'],
});
export const searchWords = apiCommand({
  name: 'universes search-words', summary: 'Set the universe search words of a universe: the whole list, 10 at most ([] or none: cleared) (setUniverseSearchWords)', kind: 'mutation', op: 'setUniverseSearchWords', positionals: ['universe', 'words'],
  descriptions: { ...u, words: 'The words, 1 to 40 characters each' }, depth: 1, text: universeText, examples: ['breakrocks universes search-words %paris velo bike cycling', 'breakrocks universes search-words %paris --words []'],
});

const IMAGE_PARTS = { bannerFile: ['banner', 'UNIVERSE_BANNER'], bannerNightFile: ['bannerNight', 'UNIVERSE_BANNER'], logoFile: ['logo', 'UNIVERSE_IMAGE'] } as const;
export const identity = apiCommand({
  name: 'universes identity', summary: 'Set the banner, its night variant, the logo and the watermark of a universe (setUniverseIdentity; --clear: remove parts)',
  description: '--banner-file, --banner-night-file, --logo-file: an image sent first (or --banner { "id", "alt" } of an image already sent). --watermark { "kind", "orientation", "text" } (JSON). --clear BANNER,LOGO… The rights of its showcase.',
  kind: 'mutation', op: 'setUniverseIdentity', positionals: ['universe'], dry: true, descriptions: { ...u, clear: 'Parts to remove: BANNER, BANNER_NIGHT, LOGO, WATERMARK, TERRITORY' }, depth: 1,
  extra: { bannerFile: { type: 'string', description: 'An image file for the banner' }, bannerNightFile: { type: 'string', description: 'An image file for the night banner' }, logoFile: { type: 'string', description: 'An image file for the logo' } },
  prepare: async (i, ctx: Context) => {
    const out: Record<string, unknown> = { ...i };
    for (const [flag, [field, destination]] of Object.entries(IMAGE_PARTS)) {
      const path = out[flag];
      delete out[flag];
      if (path === undefined) continue;
      if (out[field] !== undefined) throw usageError('INVALID_INPUT', `--${field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} or its file, one of them`);
      const image = checkImage(ctx, String(path));
      out[field] = { id: out.dryRun ? `<upload of ${image.name}>` : await uploadImage(ctx, image, { destination }) };
    }
    return out;
  },
  text: universeText, examples: ['breakrocks universes identity %club. --banner-file ./banner.jpg', 'breakrocks universes identity %club. --clear LOGO,WATERMARK'],
});

// ---- Subscription tiers ----

type Tier = { id: string; name?: string; perks?: string[]; prices?: { currency?: string; monthlyAmount?: number | null; yearlyAmount?: number | null }[]; withdrawnAt?: string | null };
const tierText = (r: unknown) => { const t = r as Tier | null; return t ? `${t.id}  ${t.name ?? ''}  ${(t.prices ?? []).map((p) => `${p.monthlyAmount ?? '-'}/month ${p.yearlyAmount ?? '-'}/year ${p.currency ?? ''}`).join(', ')}  ${(t.perks ?? []).join(',')}${t.withdrawnAt ? `  withdrawn ${t.withdrawnAt}` : ''}` : '(none)'; };
const tierFields = { currency: 'The currency (EUR, USD…)', monthlyAmount: 'The monthly price, in the smallest unit (cents)', yearlyAmount: 'The yearly price, in the smallest unit', name: 'The name of the tier', perks: 'The perks (TierPerk)', tierId: 'The tier (its id)' };
export const tiersOffer = apiCommand({
  name: 'universes tiers offer', summary: 'Offer a subscription tier in a private universe joined by subscription, 3 at most (offerSubscriptionTier; its owner)', kind: 'mutation', op: 'offerSubscriptionTier', positionals: ['universe'], dry: true,
  descriptions: { ...u, ...tierFields }, text: tierText, examples: ['breakrocks universes tiers offer %club. --name Supporter --currency EUR --monthly-amount 300 --perks TIER_BADGE,RESERVED_POSTS'],
});
export const tiersChange = apiCommand({
  name: 'universes tiers change', summary: 'Change a subscription tier: a rise applies 30 days later, a decrease at once (changeSubscriptionTier)', kind: 'mutation', op: 'changeSubscriptionTier', positionals: ['universe', 'tierId'], dry: true,
  descriptions: { ...u, ...tierFields }, text: tierText, examples: ['breakrocks universes tiers change %club. <tier id> --name Supporter --currency EUR --monthly-amount 400 --perks TIER_BADGE'],
});
export const tiersWithdraw = apiCommand({
  name: 'universes tiers withdraw', summary: 'Withdraw a subscription tier: its paying members keep it until the end of their paid period (withdrawSubscriptionTier)', kind: 'mutation', op: 'withdrawSubscriptionTier', positionals: ['universe', 'tierId'],
  descriptions: { ...u, ...tierFields }, confirm: (i) => `Withdraw the tier ${String(i.tierId)} of ${String(i.universe)}?`, text: tierText, examples: ['breakrocks universes tiers withdraw %club. <tier id> --yes'],
});
const paymentText = (r: unknown) => { const p = r as { url?: string; expiresAt?: string; accessFrom?: string | null } | null; return p ? [`open to pay: ${p.url}`, `expires ${p.expiresAt}`, ...(p.accessFrom ? [`access from ${p.accessFrom}`] : [])].join('\n') : '(none)'; };
export const tiersSubscribe = apiCommand({
  name: 'universes tiers subscribe', summary: 'Subscribe to a tier of a private universe: the address of the payment page, the membership starts once paid (startTierSubscription)',
  description: '--immediate-access-consent: access at once, waiving the 14 days of withdrawal; without it, the access and the first payment 14 days later. --conditions-version: the version of the conditions of the universe accepted. Never a delegated agent.',
  kind: 'mutation', op: 'startTierSubscription', positionals: ['universe', 'tierId'], dry: true,
  descriptions: { ...u, tierId: 'The tier (its id)', interval: 'MONTH or YEAR', automaticRenewal: 'Renewed on its own (--no-automatic-renewal: not)', immediateAccessConsent: 'Access at once, the 14 days of withdrawal waived', conditionsVersion: 'The version of the conditions accepted', returnPath: 'Where the payment page comes back (a path of the web app)', currency: 'The currency' },
  text: paymentText, examples: ['breakrocks universes tiers subscribe %club. <tier id> --interval MONTH --automatic-renewal --no-immediate-access-consent --conditions-version 1'],
});
const renewal = (enabled: boolean) => apiCommand({
  name: `universes tiers renewal ${enabled ? 'on' : 'off'}`, summary: enabled ? 'Turn the renewal of a tier subscription back on (setTierSubscriptionRenewal)' : 'Turn the renewal of a tier subscription off: it ends at its paid date, without refund (setTierSubscriptionRenewal)',
  kind: 'mutation', op: 'setTierSubscriptionRenewal', fixed: { enabled }, positionals: ['universe'], descriptions: u,
  text: (r) => { const s = r as { status?: string; automaticRenewal?: boolean; paidUntil?: string } | null; return s ? `${s.status}  renewal ${s.automaticRenewal ? 'on' : 'off'}  paid until ${s.paidUntil}` : '(none)'; },
  examples: [`breakrocks universes tiers renewal ${enabled ? 'on' : 'off'} %club.`],
});
export const tiersRenewalOn = renewal(true);
export const tiersRenewalOff = renewal(false);

// ---- What a reader of any universe has ----

export const residences = apiCommand({
  name: 'universes residences', summary: 'The residences of the account in public universes, the most recent first (myPresences)', kind: 'query', op: 'myPresences',
  text: pageText((x: { universe?: string; joinedAt?: string; endsAt?: string; canVote?: boolean; canVoteAt?: string | null }) => `${x.universe}  since ${x.joinedAt ?? '-'}  ends ${x.endsAt ?? '-'}  ${x.canVote ? 'votes' : `votes from ${x.canVoteAt ?? '-'}`}`),
  examples: ['breakrocks universes residences'],
});
export const subMap = apiCommand({ name: 'universes sub-map', summary: 'The sub-universe map of a universe (subUniverseMap; null when not offered)', kind: 'query', op: 'subUniverseMap', positionals: ['universe'], descriptions: u, examples: ['breakrocks universes sub-map %paris --json'] });
export const landing = apiCommand({
  name: 'universes landing', summary: 'The landing page of a universe as shown without an account: its name, its theme, its governance level, never its content (universeLanding)', kind: 'query', op: 'universeLanding', positionals: ['universe'], descriptions: u,
  examples: ['breakrocks universes landing %paris --json'],
});
export const land = apiCommand({
  name: 'universes land', summary: 'Mark a landing in a universe, as the apps do: whether it landed before; recorded in the visit history unless paused (markLanding)', kind: 'mutation', op: 'markLanding', positionals: ['universe'], descriptions: u, depth: 1,
  examples: ['breakrocks universes land %paris'],
});
const listed = (on: boolean) => apiCommand({
  name: `universes ${on ? 'listed' : 'unlisted'}`, summary: on ? 'Be listed on the members page of a public universe (setListedOnMembersPage; by default)' : 'Not be listed on the members page of a public universe (setListedOnMembersPage)',
  kind: 'mutation', op: 'setListedOnMembersPage', fixed: { listed: on }, positionals: ['universe'], descriptions: u,
  text: (r) => { const m = r as { universe?: string; listed?: boolean } | null; return m ? `${m.universe}  ${m.listed ? 'listed' : 'not listed'}` : '(none)'; }, examples: [`breakrocks universes ${on ? 'listed' : 'unlisted'} %paris`],
});
export const listedOn = listed(true);
export const listedOff = listed(false);

export const privateUniverseCommands = [
  joinRequests, joinRequestsAccept, joinRequestsDecline, joinRequestsAcceptAll, joinRequestsDeclineAll, invitations, invitationsAccept, invitationsDecline,
  adminsAdd, adminsRemove, transferAccept, transferDecline, universesDelete, universesDeleteCancel, privateSet, domains, domainsCheck, teamTier, declare, expose, hide, reactivate,
  reputation, reputationSet, searchWords, identity, tiersOffer, tiersChange, tiersWithdraw, tiersSubscribe, tiersRenewalOn, tiersRenewalOff,
  residences, subMap, landing, land, listedOn, listedOff,
];
