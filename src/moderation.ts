import type { PluginAction } from '@wabs/plugin-sdk/actions';
import type { PluginDatabase, PluginDatabaseRegistry } from '@wabs/plugin-sdk/database';
import type { PluginEphemeralStore } from '@wabs/plugin-sdk/ephemeral-store';
import type { TranslateFn } from '@wabs/plugin-sdk/i18n';
import type { StableIdentityAddressResolution } from '@wabs/plugin-sdk/identity';
import type { PluginCoveredGroup } from '@wabs/plugin-sdk/hook-plugin';
import type { PluginJobInput } from '@wabs/plugin-sdk/jobs';
import type { GroupParticipant } from '@wabs/plugin-sdk/transport';
import type { PluginPermissionHoldersForScope } from '@wabs/plugin-sdk/permission-holders';
import { parseModerationConfig, type ModerationConfig } from './config';
import {
  DAY_MS,
  MODERATION_DATABASE,
  MODERATION_MANAGE_PERMISSION,
  MODERATION_NAMESPACE as ns,
  MODERATION_PLUGIN_ID,
  SUSPENSION_END_JOB
} from './constants';
import { activeCase, closeCase, openCase, removedFrom, type CaseKind, type CaseRow } from './store';

/** Host capabilities this plugin uses; commands, hooks and jobs each provide a subset. */
export interface ModerationDeps {
  configFor?: ((scopeId: string, actorIdentityId?: string | undefined) => Promise<Record<string, unknown>>) | undefined;
  databases?: PluginDatabaseRegistry | undefined;
  ephemeralStore?: PluginEphemeralStore | undefined;
  coveredGroupsForScope?: ((scopeId: string) => Promise<PluginCoveredGroup[]>) | undefined;
  getGroupParticipants?: ((groupWid: string) => Promise<GroupParticipant[]>) | undefined;
  resolveIdentityAddress?: ((wid: string) => Promise<StableIdentityAddressResolution>) | undefined;
  resolveStableIdentityById?: ((identityId: string) => Promise<StableIdentityAddressResolution>) | undefined;
  communityParentGroupWidForGroup?: ((groupWid: string) => Promise<string | undefined>) | undefined;
  communityGroupWidForScope?: ((scopeId: string) => Promise<string | undefined>) | undefined;
  communityAnnouncementGroupWidForScope?: ((scopeId: string) => Promise<string | undefined>) | undefined;
  protectedWidsForActions?: (() => Promise<string[]>) | undefined;
  /** Core API 0.3.26: who holds one of this plugin's permissions in a scope, i.e. the moderators an operator chose. */
  permissionHoldersForScope?: PluginPermissionHoldersForScope | undefined;
  getCurrentBotWid?: (() => Promise<string | undefined>) | undefined;
  enqueuePluginJob?: ((input: PluginJobInput) => Promise<unknown>) | undefined;
  listEnabledScopes?: (() => Promise<Array<{ scopeId: string; name?: string | undefined }>>) | undefined;
  i18n?: {
    translatorForScope?(scopeId: string): Promise<TranslateFn>;
    translatorForIdentity?(identityId: string, scopeId?: string): Promise<TranslateFn>;
  } | undefined;
  now?: (() => Date) | undefined;
}

export interface Member {
  identityId: string;
  /** Address used to remove, add and mention the member. */
  wid: string;
  deliveryChatId: string;
  mentionWid: string;
  label: string;
  addresses: Set<string>;
}

export interface ScopeGroup {
  groupWid: string;
  label: string;
  managementMode: 'OBSERVE' | 'ASSIST' | 'MANAGE';
}

export function nowFrom(deps: ModerationDeps): Date {
  return deps.now?.() ?? new Date();
}

/**
 * The scope's display name, for notices. Command contexts may not list scopes, so it falls back to the
 * community's own group name, then to the first covered group's name; the id is the last resort.
 */
export async function scopeName(deps: ModerationDeps, scopeId: string): Promise<string> {
  const scopes = await deps.listEnabledScopes?.().catch(() => []) ?? [];
  const named = scopes.find((scope) => scope.scopeId === scopeId)?.name?.trim();
  if (named) return named;
  const groups = await deps.coveredGroupsForScope?.(scopeId).catch(() => []) ?? [];
  const community = await deps.communityGroupWidForScope?.(scopeId).catch(() => undefined);
  const label = (wid: string | undefined) => groups.find((group) => group.groupWid === wid)?.groupDisplayName?.trim();
  return label(community) || groups.map((group) => group.groupDisplayName?.trim()).find(Boolean) || scopeId;
}

export async function scopeTranslator(deps: ModerationDeps, scopeId: string): Promise<TranslateFn> {
  return await deps.i18n?.translatorForScope?.(scopeId).catch(() => undefined) ?? ((key: string) => key);
}

/** Notices go to members in their own language when the host knows it. */
export async function memberTranslator(deps: ModerationDeps, identityId: string, scopeId: string, fallback: TranslateFn): Promise<TranslateFn> {
  return await deps.i18n?.translatorForIdentity?.(identityId, scopeId).catch(() => undefined) ?? fallback;
}

export async function configFor(deps: ModerationDeps, scopeId: string, actorIdentityId?: string): Promise<ModerationConfig> {
  return parseModerationConfig(deps.configFor ? await deps.configFor(scopeId, actorIdentityId) : {});
}

export function database(deps: ModerationDeps): PluginDatabase | undefined {
  return deps.databases?.open(MODERATION_DATABASE);
}

export function toMember(resolution: StableIdentityAddressResolution): Member {
  const addresses = new Set([
    resolution.canonicalWid, resolution.originalWid, resolution.mentionWid, resolution.deliveryChatId,
    ...(resolution.phoneWid ? [resolution.phoneWid] : []), ...(resolution.lidWid ? [resolution.lidWid] : []),
    ...resolution.phoneWids, ...resolution.lidWids, ...resolution.aliases
  ].filter(Boolean));
  return {
    identityId: resolution.identityId,
    wid: resolution.canonicalWid,
    deliveryChatId: resolution.deliveryChatId,
    mentionWid: resolution.mentionWid,
    label: resolution.displayName?.trim() || `@${resolution.mentionWid.split('@')[0]}`,
    addresses
  };
}

export async function memberByWid(deps: ModerationDeps, wid: string): Promise<Member | undefined> {
  if (!deps.resolveIdentityAddress) return undefined;
  try {
    return toMember(await deps.resolveIdentityAddress(wid));
  } catch {
    return undefined;
  }
}

export async function memberById(deps: ModerationDeps, identityId: string): Promise<Member | undefined> {
  if (!deps.resolveStableIdentityById) return undefined;
  try {
    return toMember(await deps.resolveStableIdentityById(identityId));
  } catch {
    return undefined;
  }
}

/** The bot itself, the owner and subowners are never moderated. */
export async function isProtected(deps: ModerationDeps, member: Member): Promise<boolean> {
  const protectedWids = new Set([
    ...(await deps.protectedWidsForActions?.().catch(() => []) ?? []),
    ...[await deps.getCurrentBotWid?.().catch(() => undefined)].filter((wid): wid is string => Boolean(wid))
  ]);
  return [...member.addresses].some((address) => protectedWids.has(address));
}

/**
 * Covered groups of the scope that cases act on, minus exempt ones. Works the same for communities and
 * standalone groups. The community announcement group is left out when the community group itself is
 * covered: WhatsApp keeps it in step with community membership (removing someone from the community
 * removes them there; adding them to a subgroup adds them there).
 */
export async function scopeGroups(deps: ModerationDeps, scopeId: string, config: ModerationConfig): Promise<ScopeGroup[]> {
  const groups = await deps.coveredGroupsForScope?.(scopeId) ?? [];
  const exempt = new Set(config.exemptGroupChatIds);
  const community = await deps.communityGroupWidForScope?.(scopeId).catch(() => undefined);
  const announcement = await deps.communityAnnouncementGroupWidForScope?.(scopeId).catch(() => undefined);
  if (announcement && community && groups.some((group) => group.groupWid === community)) exempt.add(announcement);
  return groups
    .filter((group) => !exempt.has(group.groupWid))
    .map((group) => ({
      groupWid: group.groupWid,
      label: group.groupDisplayName?.trim() || group.groupWid,
      managementMode: group.managementMode ?? 'OBSERVE'
    }));
}

export async function participantsOf(deps: ModerationDeps, groupWid: string): Promise<GroupParticipant[]> {
  if (!deps.getGroupParticipants) return [];
  try {
    return await deps.getGroupParticipants(groupWid);
  } catch {
    return [];
  }
}

export async function groupsWithMember(deps: ModerationDeps, groups: ScopeGroup[], member: Member): Promise<ScopeGroup[]> {
  const found: ScopeGroup[] = [];
  for (const group of groups) {
    const participants = await participantsOf(deps, group.groupWid);
    if (participants.some((participant) => member.addresses.has(participant.wid))) found.push(group);
  }
  return found;
}

export type AuthorityResult =
  | { ok: true }
  | { ok: false; authorityLabel?: string | undefined };

/**
 * Admins of the authority groups may moderate the whole scope. Without configured groups that is the
 * community parent when there is one, otherwise the group where the command runs. Being an admin of
 * one event or sub-group is not enough to moderate a whole community.
 */
/**
 * Identity ids of the scope's moderators: whoever the host lets use plugin.community-admin.moderate there (the
 * owner, subowners, bot admins and the people an operator allowed, for example on the console's Access
 * page). Undefined on hosts without that capability, so callers fall back to WhatsApp group admins.
 */
export async function moderatorIdentityIds(deps: ModerationDeps, scopeId: string): Promise<Set<string> | undefined> {
  if (!deps.permissionHoldersForScope) return undefined;
  try {
    const holders = await deps.permissionHoldersForScope({ scopeId, permission: MODERATION_MANAGE_PERMISSION });
    return new Set(holders.map((holder) => holder.identityId));
  } catch {
    return undefined;
  }
}

/** The scope's moderators as members, never the bot itself; undefined when the host can't tell. */
export async function moderatorsOf(deps: ModerationDeps, scopeId: string): Promise<Member[] | undefined> {
  const ids = await moderatorIdentityIds(deps, scopeId);
  if (!ids) return undefined;
  const bot = await deps.getCurrentBotWid?.().catch(() => undefined);
  const members: Member[] = [];
  for (const identityId of [...ids].sort()) {
    const member = await memberById(deps, identityId);
    if (member && !(bot && member.addresses.has(bot))) members.push(member);
  }
  return members;
}

export async function adminRecipients(deps: ModerationDeps, _config: ModerationConfig, scopeId: string, _groupWid: string | undefined): Promise<string[]> {
  const moderators = await moderatorsOf(deps, scopeId);
  return [...new Set((moderators ?? []).map(member => member.deliveryChatId))].sort();
}

export function alertActions(recipients: string[], text: string): PluginAction[] {
  return recipients.map((chatId) => ({ type: 'message.sendText', chatId, text }));
}

export function parseDays(raw: string | undefined, fallback: number, max: number): number | undefined {
  if (!raw) return fallback;
  const match = /^(\d{1,4})\s*(d|day|days|dia|dias)?$/iu.exec(raw.trim());
  if (!match) return undefined;
  const days = Number(match[1]);
  return days >= 1 && days <= max ? days : undefined;
}

export function formatDate(date: Date, locale: string | undefined, timeZone = 'UTC'): string {
  try {
    return new Intl.DateTimeFormat(locale ?? 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date);
  } catch {
    return date.toISOString();
  }
}

export interface CasePlan {
  actions: PluginAction[];
  removed: ScopeGroup[];
  skipped: ScopeGroup[];
  caseRow?: CaseRow | undefined;
}

/**
 * Opens a suspension or expulsion and plans its actions in a safe order: the audit record, the host
 * standing (aborting the batch if it cannot be recorded), the removals, the private notice and, for a
 * suspension, the job that ends it. In dry run only the audit record is produced.
 */
export async function planCase(deps: ModerationDeps, input: {
  db: PluginDatabase;
  config: ModerationConfig;
  scopeId: string;
  scopeLabel: string;
  member: Member;
  kind: CaseKind;
  reason: string;
  days?: number | undefined;
  actorIdentityId?: string | undefined;
  automatic?: boolean | undefined;
  t: TranslateFn;
  locale?: string | undefined;
}): Promise<CasePlan> {
  const noticeT = await memberTranslator(deps, input.member.identityId, input.scopeId, input.t);
  const now = nowFrom(deps);
  const groups = await groupsWithMember(deps, await scopeGroups(deps, input.scopeId, input.config), input.member);
  const removable = groups.filter((group) => group.managementMode === 'MANAGE');
  const skipped = groups.filter((group) => group.managementMode !== 'MANAGE');
  const endsAt = input.kind === 'suspension' ? new Date(now.getTime() + (input.days ?? input.config.suspension.defaultDays) * DAY_MS) : undefined;
  const audit: PluginAction = {
    type: 'audit.record',
    action: `moderation.${input.kind}.${input.config.dryRun ? 'planned' : 'started'}`,
    targetJson: { scopeId: input.scopeId, identityId: input.member.identityId },
    metadataJson: {
      reason: input.reason,
      automatic: Boolean(input.automatic),
      ...(endsAt ? { endsAt: endsAt.toISOString() } : {}),
      groups: removable.map((group) => group.groupWid),
      skippedGroups: skipped.map((group) => group.groupWid),
      dryRun: input.config.dryRun
    }
  };
  if (input.config.dryRun) return { actions: [audit], removed: removable, skipped };

  const caseRow = openCase(input.db, {
    scopeId: input.scopeId,
    identityId: input.member.identityId,
    kind: input.kind,
    reason: input.reason,
    actorIdentityId: input.actorIdentityId,
    automatic: input.automatic,
    now,
    endsAt,
    removedFrom: removable.map((group) => group.groupWid)
  });
  const extra = input.kind === 'suspension' ? input.config.suspension.noticeExtra : input.config.expulsion.noticeExtra;
  const notice = input.kind === 'suspension'
    ? noticeT(`${ns}.notice.suspended`, { scope: input.scopeLabel, until: formatDate(endsAt!, input.locale), reason: input.reason })
    : noticeT(`${ns}.notice.expelled`, { scope: input.scopeLabel, reason: input.reason });
  const actions: PluginAction[] = [
    audit,
    {
      type: 'member.setStanding',
      identityId: input.member.identityId,
      standing: input.kind === 'suspension' ? 'suspended' : 'expelled',
      caseRef: caseRow.id,
      ...(endsAt ? { endsAt } : {}),
      reason: input.reason,
      abortBatchOnFailure: true
    },
    ...removable.map((group): PluginAction => ({
      type: 'group.removeParticipant', groupWid: group.groupWid, userWid: input.member.wid, reason: `${MODERATION_PLUGIN_ID}:${input.kind}`
    })),
    { type: 'message.sendText', chatId: input.member.deliveryChatId, text: extra.trim() ? `${notice}\n\n${extra.trim()}` : notice }
  ];
  if (endsAt) {
    actions.push({
      type: 'plugin.enqueueJob',
      pluginId: MODERATION_PLUGIN_ID,
      jobName: SUSPENSION_END_JOB,
      scopeId: input.scopeId,
      runAt: endsAt,
      payload: { caseId: caseRow.id },
      dedupeKey: `${SUSPENSION_END_JOB}:${caseRow.id}:${endsAt.toISOString()}`
    });
  }
  return { actions, removed: removable, skipped, caseRow };
}

/**
 * Ends a case (on schedule or on request): adds the member back to the groups they were removed from that
 * the scope still covers, clears the host standing and tells them.
 */
export async function planRestore(deps: ModerationDeps, input: {
  db: PluginDatabase;
  config: ModerationConfig;
  scopeId: string;
  scopeLabel: string;
  caseRow: CaseRow;
  status: 'ended' | 'lifted';
  t: TranslateFn;
}): Promise<{ actions: PluginAction[]; readded: ScopeGroup[] }> {
  const member = await memberById(deps, input.caseRow.identity_id);
  const covered = await scopeGroups(deps, input.scopeId, input.config);
  const wanted = new Set(removedFrom(input.caseRow));
  const wantedGroups = covered.filter((group) => wanted.has(group.groupWid) && group.managementMode === 'MANAGE');
  // Re-adding someone to a subgroup makes WhatsApp put them back in the community as well; adding them to the
  // community group too is refused (409, already a member). Only add there when no subgroup is re-added.
  const community = await deps.communityGroupWidForScope?.(input.scopeId).catch(() => undefined);
  const readded = community && wantedGroups.some((group) => group.groupWid !== community)
    ? wantedGroups.filter((group) => group.groupWid !== community)
    : wantedGroups;
  const audit: PluginAction = {
    type: 'audit.record',
    action: `moderation.${input.caseRow.kind}.${input.config.dryRun ? 'restore-planned' : input.status}`,
    targetJson: { scopeId: input.scopeId, identityId: input.caseRow.identity_id, caseId: input.caseRow.id },
    metadataJson: { groups: readded.map((group) => group.groupWid), dryRun: input.config.dryRun }
  };
  if (input.config.dryRun) return { actions: [audit], readded };
  closeCase(input.db, input.caseRow.id, input.status, nowFrom(deps));
  const actions: PluginAction[] = [
    audit,
    { type: 'member.clearStanding', identityId: input.caseRow.identity_id, caseRef: input.caseRow.id, reason: input.status }
  ];
  if (member) {
    for (const group of readded) {
      // A plain add: every transport supports it. The history variant isn't available on whatsmeow and
      // made the host start its optional WhatsApp Web provider just to fail (seen 2026-11-22).
      actions.push({
        type: 'group.addParticipant',
        groupWid: group.groupWid,
        userWid: member.wid,
        reason: `${MODERATION_PLUGIN_ID}:${input.caseRow.kind}-${input.status}`
      });
    }
    const noticeT = await memberTranslator(deps, member.identityId, input.scopeId, input.t);
    const noticeKey = input.caseRow.kind === 'expulsion' ? `${ns}.notice.restoredExpulsion` : `${ns}.notice.restored`;
    actions.push({ type: 'message.sendText', chatId: member.deliveryChatId, text: noticeT(noticeKey, { scope: input.scopeLabel }) });
  }
  return { actions, readded };
}

/** An active case still holds the member out of the scope's groups. */
export function holdingCase(db: PluginDatabase | undefined, scopeId: string, identityId: string): CaseRow | undefined {
  return db ? activeCase(db, scopeId, identityId) : undefined;
}
