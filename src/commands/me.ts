// The account itself (D-92, D-303: the operations of before specs v83.1.0 still without a command): its profile
// and its links, its avatar, its handle, its password and its email address, the deletion of the account, its data
// requests (a copy, a bulk erasure, a rectification: GDPR art. 15 to 17), the onboarding, the personal invitation
// link, what it did (its interactions, its liked and reposted posts, its reports) and the exceptions of who may
// invite it. The secrets (a password) are never options: asked without echo, or read on the standard input.
import { apiCommand } from '../api/command.js';
import type { Context } from '../context.js';
import { usageError } from '../errors.js';
import { checkImage, uploadAvatar } from '../media.js';
import { pageText } from './shared.js';

const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type Profile = { id?: string; handle?: string; displayName?: string; bio?: string | null; links?: { label?: string | null; url: string }[] };
const profileText = (r: unknown) => {
  const p = r as Profile | null;
  if (!p) return '(none)';
  return [`@${p.handle ?? '?'}  ${p.displayName ?? ''}`, ...(p.bio ? [p.bio] : []), ...(p.links ?? []).map((l) => `link: ${l.label ? `${l.label} ` : ''}${l.url}`)].join('\n');
};

export const meProfileSet = apiCommand({
  name: 'me profile set', summary: 'Change the profile: display name, bio, links, avatar, AI description, organization name (updateProfile; --avatar-file: an image sent first)',
  description: 'Only the fields given change. --links: [{ "label", "url" }] (JSON), the whole list. --avatar-file: a JPEG, PNG or WebP image sent with requestAvatarUpload, then set as the avatar; --clear AVATAR removes it.',
  kind: 'mutation', op: 'updateProfile', hide: ['expected'], dry: true,
  descriptions: { displayName: 'The display name', bio: 'The bio', links: 'The links: [{ "label", "url" }] (JSON)', avatar: 'The upload id of an avatar already sent', aiDescription: 'The description shown as made by AI', organizationName: 'The organization name', clear: 'Parts to remove (AVATAR)' },
  extra: { avatarFile: { type: 'string', description: 'An image file for the avatar: JPEG, PNG or WebP, 10 MB at most' } },
  prepare: async (i, ctx: Context) => {
    const { avatarFile, ...rest } = i;
    if (avatarFile === undefined) return rest;
    if (rest.avatar !== undefined) throw usageError('INVALID_INPUT', '--avatar or --avatar-file, one of them');
    const image = checkImage(ctx, String(avatarFile), undefined, undefined, AVATAR_TYPES);
    if (rest.dryRun) return { ...rest, avatar: `<upload of ${image.name}>` };
    return { ...rest, avatar: await uploadAvatar(ctx, image) };
  },
  text: profileText,
  examples: ['breakrocks me profile set --display-name "Alice" --bio "Cyclist in Paris"', 'breakrocks me profile set --avatar-file ./me.png', 'breakrocks me profile set --links \'[{"label":"Site","url":"https://example.com"}]\''],
});

export const meHandleCheck = apiCommand({
  name: 'me handle check', summary: 'Whether a handle is free to take (handleAvailability)', kind: 'query', op: 'handleAvailability', positionals: ['handle'], descriptions: { handle: 'The handle, without @' },
  text: (r) => { const a = r as { handle: string; available: boolean; reason?: string | null } | null; return a ? `@${(a.handle ?? '').replace(/^@/, '')}  ${a.available ? 'available' : `taken${a.reason ? ` (${a.reason})` : ''}`}` : '(none)'; },
  examples: ['breakrocks me handle check alice'],
});
export const meHandleChange = apiCommand({
  name: 'me handle change', summary: 'Change the handle of the account (changeHandle)', kind: 'mutation', op: 'changeHandle', positionals: ['handle'], descriptions: { handle: 'The new handle, without @' }, depth: 1,
  confirm: (i) => `Change the handle to @${String(i.handle)}? The old one is no longer yours.`, text: profileText,
  examples: ['breakrocks me handle change alice2 --yes'],
});

/** The current and the new password: two lines of the standard input (--password-stdin), else asked without echo. */
async function passwords(ctx: Context, fromStdin: boolean): Promise<{ currentPassword: string; newPassword: string }> {
  if (fromStdin) {
    if (!ctx.io.readStdin) throw usageError('PASSWORD_REQUIRED', '--password-stdin needs a standard input');
    const [currentPassword, newPassword] = (await ctx.io.readStdin()).split(/\r?\n/);
    if (!currentPassword || !newPassword) throw usageError('PASSWORD_REQUIRED', 'On the standard input: the current password, a new line, the new password, a new line');
    return { currentPassword, newPassword };
  }
  if (!ctx.io.interactive || !ctx.io.secret) throw usageError('PASSWORD_REQUIRED', 'The passwords are missing: --password-stdin (two lines), or run in a terminal');
  const currentPassword = await ctx.io.secret('Current password: ');
  const newPassword = await ctx.io.secret('New password: ');
  if (newPassword !== await ctx.io.secret('New password again: ')) throw usageError('PASSWORD_MISMATCH', 'The two new passwords differ');
  return { currentPassword, newPassword };
}
export const mePassword = apiCommand({
  name: 'me password', summary: 'Change the password (changePassword): asked without echo, or two lines on the standard input',
  description: '--password-stdin: the current password, then the new one, one per line. Never an option of its own, never printed. Not an MCP tool.',
  kind: 'mutation', op: 'changePassword', hide: ['currentPassword', 'newPassword'], mcp: false,
  extra: { passwordStdin: { type: 'boolean', description: 'Read the current and the new password from the standard input, one per line' } },
  prepare: async (i, ctx: Context) => { const { passwordStdin, ...rest } = i; return { ...rest, ...(await passwords(ctx, !!passwordStdin)) }; },
  text: (r) => (r === true ? 'password changed' : 'nothing changed'),
  examples: ['breakrocks me password', 'printf "%s\\n%s\\n" "$OLD" "$NEW" | breakrocks me password --password-stdin'],
});

export const meEmailChange = apiCommand({
  name: 'me email change', summary: 'Ask to change the email address: a code is sent to the new one (requestEmailChange)', kind: 'mutation', op: 'requestEmailChange', positionals: ['email'],
  descriptions: { email: 'The new email address', challenge: 'The answer to a challenge, when the platform asks for one', locale: 'The language of the email (BCP 47)' },
  text: (r) => (r === true ? 'code sent: breakrocks me email confirm <code>' : 'nothing changed'),
  examples: ['breakrocks me email change new@example.com'],
});
export const meEmailConfirm = apiCommand({
  name: 'me email confirm', summary: 'Confirm the change of the email address with the code received (confirmEmailChange)', kind: 'mutation', op: 'confirmEmailChange', positionals: ['code'], descriptions: { code: 'The code received at the new address' },
  text: (r) => (r === true ? 'email address changed' : 'nothing changed'), examples: ['breakrocks me email confirm 123456'],
});

export const meDelete = apiCommand({
  name: 'me delete', summary: 'Ask to delete the account: a confirmation link is sent by email (requestAccountDeletion; --handle: the handle typed again)',
  description: '--successors: who takes over the universes owned, [{ "accountId", "universe" }] (JSON). The deletion is done by me delete confirm with the token of the email.',
  kind: 'mutation', op: 'requestAccountDeletion', positionals: ['handle'],
  descriptions: { handle: 'The handle of the account, typed again (without @)', successors: 'Who takes over each universe owned: [{ "accountId", "universe" }] (JSON)', locale: 'The language of the email (BCP 47)' },
  confirm: (i) => `Ask to delete the account @${String(i.handle).replace(/^@/, '')}?`,
  prepare: (i) => ({ ...i, handle: String(i.handle).replace(/^@/, '') }),
  text: (r) => { const d = r as { expiresAt?: string } | null; return d ? `confirmation sent by email, valid until ${d.expiresAt}` : '(none)'; },
  examples: ['breakrocks me delete alice --yes'],
});
export const meDeleteConfirm = apiCommand({
  name: 'me delete confirm', summary: 'Delete the account with the token of the confirmation email (confirmAccountDeletion)', kind: 'mutation', op: 'confirmAccountDeletion', positionals: ['token'], descriptions: { token: 'The token of the confirmation email' },
  confirm: () => 'Delete the account? It disappears after the grace period.',
  text: (r) => { const d = r as { deletedAt?: string; disappearsAt?: string } | null; return d ? `deleted ${d.deletedAt}, disappears ${d.disappearsAt}` : '(none)'; },
  examples: ['breakrocks me delete confirm <token> --yes'],
});

type DataRequest = { id: string; kind: string; status: string; scope?: string | null; requestedAt?: string; dueAt?: string; cancellableUntil?: string | null; parts?: unknown[] | null };
const dataRequestLine = (d: DataRequest) => `${d.id}  ${d.kind}${d.scope ? ` ${d.scope}` : ''}  ${d.status}  asked ${d.requestedAt ?? '-'}  due ${d.dueAt ?? '-'}${d.cancellableUntil ? `  cancellable until ${d.cancellableUntil}` : ''}${d.parts?.length ? `  ${d.parts.length} part(s)` : ''}`;
const dataRequestText = (r: unknown) => (r ? dataRequestLine(r as DataRequest) : '(none)');
const dataRequestId = { dataRequestId: 'The data request (me data requests)' };

export const meDataRequests = apiCommand({
  name: 'me data requests', summary: 'The data requests of the account: copies, bulk erasures, rectifications (myDataRequests)', kind: 'query', op: 'myDataRequests', text: pageText(dataRequestLine),
  examples: ['breakrocks me data requests', 'breakrocks me data requests --json'],
});
export const meDataCopy = apiCommand({
  name: 'me data copy', summary: 'Ask for a copy of the data of the account, prepared apart and announced by email (requestDataCopy)', kind: 'mutation', op: 'requestDataCopy',
  descriptions: { locale: 'The language of its viewer and of the email (BCP 47)' }, text: dataRequestText, examples: ['breakrocks me data copy --locale fr'],
});
export const meDataDownload = apiCommand({
  name: 'me data download', summary: 'The download address of a part of a data copy (dataCopyDownload)', kind: 'query', op: 'dataCopyDownload', positionals: ['dataRequestId', 'part'],
  descriptions: { ...dataRequestId, part: 'The part (1 for the first)' },
  text: (r) => { const d = r as { url?: string; expiresAt?: string } | null; return d ? `${d.url}\nexpires ${d.expiresAt}` : '(none)'; },
  examples: ['breakrocks me data download <data request id> 1'],
});
export const meDataErase = apiCommand({
  name: 'me data erase', summary: 'Ask for the bulk erasure of a scope: hidden at once, cancellable 24 hours, then erased for good (requestBulkErasure)', kind: 'mutation', op: 'requestBulkErasure', positionals: ['scope'],
  descriptions: { scope: 'What to erase (BulkErasureScope)' }, confirm: (i) => `Erase ${String(i.scope)}? Cancellable for 24 hours, then for good.`, text: dataRequestText,
  examples: ['breakrocks me data erase LIKES_AND_REPOSTS --yes'],
});
export const meDataEraseCancel = apiCommand({
  name: 'me data erase-cancel', summary: 'Cancel a bulk erasure within its 24 hours (cancelBulkErasure)', kind: 'mutation', op: 'cancelBulkErasure', positionals: ['dataRequestId'], descriptions: dataRequestId, text: dataRequestText,
  examples: ['breakrocks me data erase-cancel <data request id>'],
});
export const meDataRectify = apiCommand({
  name: 'me data rectify', summary: 'Ask for the rectification of data of the account, in a text (requestRectification)', kind: 'mutation', op: 'requestRectification', positionals: ['text'],
  descriptions: { text: 'What is wrong and what it should be' }, text: dataRequestText, examples: ['breakrocks me data rectify "My birth year is 1990, not 1909"'],
});

type Onboarding = { status?: string | null; offered?: boolean; skipped?: boolean; startedAt?: string | null; endsAt?: string | null; completedAt?: string | null; steps?: { kind?: string; done?: boolean }[] };
const onboardingText = (r: unknown) => {
  const o = r as Onboarding | null;
  if (!o) return '(none)';
  return [`${o.status ?? (o.skipped ? 'SKIPPED' : o.offered ? 'OFFERED' : 'NOT OFFERED')}${o.endsAt ? `  ends ${o.endsAt}` : ''}${o.completedAt ? `  completed ${o.completedAt}` : ''}`, ...(o.steps ?? []).map((s) => `${s.done ? '[x]' : '[ ]'} ${s.kind ?? JSON.stringify(s)}`)].join('\n');
};
export const meOnboarding = apiCommand({ name: 'me onboarding', summary: 'The onboarding of the account: its status and its steps (onboarding)', kind: 'query', op: 'onboarding', text: onboardingText, examples: ['breakrocks me onboarding'] });
export const meOnboardingStart = apiCommand({ name: 'me onboarding start', summary: 'Start the onboarding (startOnboarding)', kind: 'mutation', op: 'startOnboarding', text: onboardingText, examples: ['breakrocks me onboarding start'] });
export const meOnboardingSkip = apiCommand({ name: 'me onboarding skip', summary: 'Skip the onboarding (skipOnboarding)', kind: 'mutation', op: 'skipOnboarding', text: onboardingText, examples: ['breakrocks me onboarding skip'] });
export const meOnboardingRecord = apiCommand({
  name: 'me onboarding record', summary: 'Record an activity of the onboarding: an address visited, the help opened (recordOnboardingActivity)', kind: 'mutation', op: 'recordOnboardingActivity', positionals: ['kind', 'address'],
  descriptions: { kind: 'The activity (OnboardingActivity)', address: 'The address visited (ADDRESS_VISITED)' }, text: onboardingText,
  examples: ['breakrocks me onboarding record ADDRESS_VISITED %paris'],
});

type InvitationLink = { url?: string; code?: string; credited24h?: number; creditedTotal?: number };
const linkText = (r: unknown) => { const l = r as InvitationLink | null; return l ? `${l.url}  credited ${l.credited24h ?? 0} in 24 h, ${l.creditedTotal ?? 0} in all` : '(none)'; };
export const meInvitationLink = apiCommand({ name: 'me invitation-link', summary: 'The personal invitation link of the account and who joined through it (personalInvitationLink)', kind: 'query', op: 'personalInvitationLink', text: linkText, examples: ['breakrocks me invitation-link'] });
export const meInvitationLinkRenew = apiCommand({
  name: 'me invitation-link renew', summary: 'Renew the personal invitation link: the old one stops working (renewPersonalInvitationLink)', kind: 'mutation', op: 'renewPersonalInvitationLink',
  confirm: () => 'Renew the invitation link? The old one stops working.', text: linkText, examples: ['breakrocks me invitation-link renew --yes'],
});
export const meInvitationLinkRead = apiCommand({
  name: 'me invitation-link read', summary: 'What an invitation link of someone shows: whether it works, and who invites (publicInvitationLink)', kind: 'query', op: 'publicInvitationLink', positionals: ['code'], descriptions: { code: 'The code of the link (the end of its address)' },
  text: (r) => { const l = r as { works?: boolean; inviter?: { handle?: string } | null } | null; return l ? `${l.works ? 'works' : 'does not work'}${l.inviter?.handle ? `  invited by @${l.inviter.handle}` : ''}` : '(none)'; },
  examples: ['breakrocks me invitation-link read <code>'],
});

export const meInteractions = apiCommand({
  name: 'me interactions', summary: 'What the account did, counted: posts, replies, likes, reposts, follows, residences, votes, reports… (myInteractions)', kind: 'query', op: 'myInteractions',
  text: (r) => (r ? Object.entries(r as Record<string, unknown>).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${String(v)}`).join('\n') : '(none)'),
  examples: ['breakrocks me interactions'],
});
type PostLine = { id: string; createdAt?: string; author?: { handle?: string } | null; text?: string | null; universe?: string | null };
const postLine = (p: PostLine) => `${p.id}  ${p.createdAt ?? ''}  ${p.author?.handle ? `@${p.author.handle}` : '(deleted)'}${p.universe ? `  ${p.universe}` : ''}  ${(p.text ?? '').replace(/\s+/g, ' ').slice(0, 80)}`;
export const mePosts = apiCommand({
  name: 'me posts', summary: 'The posts the account liked or reposted (myPosts LIKED or REPOSTED)', kind: 'query', op: 'myPosts', positionals: ['kind'], descriptions: { kind: 'LIKED or REPOSTED' },
  text: pageText(postLine), examples: ['breakrocks me posts LIKED', 'breakrocks me posts REPOSTED --all --json'],
});
export const meReports = apiCommand({
  name: 'me reports', summary: 'The reports the account sent, and what became of them (myReports)', kind: 'query', op: 'myReports',
  text: pageText((x: { id: string; status?: string; reason?: string; createdAt?: string }) => `${x.id}  ${x.status ?? ''}  ${x.reason ?? ''}  ${x.createdAt ?? ''}`),
  examples: ['breakrocks me reports', 'breakrocks me reports --json'],
});
const inviteException = (excepted: boolean) => apiCommand({
  name: `me invite-exceptions ${excepted ? 'add' : 'remove'}`, summary: excepted ? 'Add an account to the exceptions of who may invite the account to a universe (setInviteException; invite policy "except", 1,000 at most)' : 'Remove an account from the exceptions of who may invite the account (setInviteException)',
  kind: 'mutation', op: 'setInviteException', fixed: { excepted }, positionals: ['accountId'], rename: { accountId: 'account' }, descriptions: { account: 'The account: @handle or its id' },
  text: (r) => { const a = r as { handle?: string } | null; return a ? `@${a.handle} ${excepted ? 'added to' : 'removed from'} the exceptions` : '(none)'; },
  examples: [`breakrocks me invite-exceptions ${excepted ? 'add' : 'remove'} @alice`],
});
export const meInviteExceptionsAdd = inviteException(true);
export const meInviteExceptionsRemove = inviteException(false);

export const meCommands = [
  meProfileSet, meHandleCheck, meHandleChange, mePassword, meEmailChange, meEmailConfirm, meDelete, meDeleteConfirm,
  meDataRequests, meDataCopy, meDataDownload, meDataErase, meDataEraseCancel, meDataRectify,
  meOnboarding, meOnboardingStart, meOnboardingSkip, meOnboardingRecord, meInvitationLink, meInvitationLinkRenew, meInvitationLinkRead,
  meInteractions, mePosts, meReports, meInviteExceptionsAdd, meInviteExceptionsRemove,
];
