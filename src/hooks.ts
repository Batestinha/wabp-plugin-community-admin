import type { PluginAction } from '@wabs/plugin-sdk/actions';
import type { PluginHookContext } from '@wabs/plugin-sdk/hook-plugin';
import type { PluginJobEvent, PluginMessageEvent, PluginParticipantChangeEvent, PluginRuntimeHooks } from '@wabs/plugin-sdk/hooks';
import type { TranslateFn } from '@wabs/plugin-sdk/i18n';
import type { ModerationConfig, RulePolicy } from './config';
import { LOCK_EXPIRE_JOB, MODERATION_NAMESPACE as ns, MODERATION_PLUGIN_ID, SUSPENSION_END_JOB } from './constants';
import {
  adminRecipients,
  moderatorIdentityIds,
  alertActions,
  configFor,
  database,
  isProtected,
  memberById,
  memberByWid,
  nowFrom,
  participantsOf,
  planCase,
  planRestore,
  scopeName,
  scopeTranslator,
  type Member,
  type ModerationDeps
} from './moderation';
import { evaluateMessage, isSticker, type Violation } from './rules';
import { activeCase, addWarning, caseById, isNewMember, recordJoin, recordLock, takeExpiredLock } from './store';

type HookContext = Omit<PluginHookContext, 'listEnabledScopes'> & ModerationDeps;

const ARRIVALS = new Set<PluginParticipantChangeEvent['action']>(['join', 'add', 'membership_approved']);
const ADMIN_CACHE_SECONDS = 600;

export function createModerationHooks(context: HookContext): PluginRuntimeHooks {
  return {
    async onRuntimeReady() {
      for (const { scopeId } of await context.listEnabledScopes?.() ?? []) {
        const config = await configFor(context, scopeId);
        if (config.enabled && config.joinApproval.policy === 'require') {
          await context.enqueuePluginJob?.({ jobName: 'scope.configuration.changed', scopeId, payload: {},
            dedupeKey: 'community-admin:join-approval:' + scopeId, replaceRetainedTerminalJob: true });
        }
      }
    },
    async onGroupScopeCovered(event) {
      if (event.newManagementMode !== 'MANAGE') return;
      return requiredApproval(context, event.scopeId, event.chatId);
    },
    async onMessage(event) {
      return handleMessage(context, event);
    },
    async onParticipantChange(event) {
      return handleParticipantChange(context, event);
    },
    async onPluginJob(job) {
      return handleJob(context, job);
    }
  };
}

async function translator(context: HookContext, scopeId: string): Promise<TranslateFn> {
  return scopeTranslator(context, scopeId);
}

export async function handleMessage(context: HookContext, event: PluginMessageEvent): Promise<PluginAction[] | void> {
  if (!event.groupWid || event.message.fromMe || event.isCommandLike) return;
  const config = await configFor(context, event.scopeId, event.actorIdentityId);
  if (!config.enabled || config.exemptGroupChatIds.includes(event.groupWid)) return;
  const db = database(context);
  if (!db) return;

  const now = event.receivedAt ?? nowFrom(context);
  const violations = evaluateMessage(config, {
    body: event.message.body ?? '',
    links: event.message.links ?? [],
    type: event.message.type,
    hasMedia: event.message.hasMedia,
    mediaMimeType: event.message.mediaMimeType,
    isForwarded: event.message.isForwarded,
    chatId: event.groupWid,
    timestamp: event.message.timestamp ?? now
  });
  violations.push(...await counterViolations(context, config, event));
  if (violations.length === 0) return;

  const member = await memberByWid(context, event.actorWid) ?? await memberById(context, event.actorIdentityId);
  if (!member || await isProtected(context, member) || await isGroupAdmin(context, event.groupWid, member)
    || await isModerator(context, event.scopeId, member)) return;

  const t = await translator(context, event.scopeId);
  const mode = event.managementMode ?? 'OBSERVE';
  const actions: PluginAction[] = [];
  let deleted = false;
  let expelled = false;
  for (const violation of violations) {
    actions.push({
      type: 'audit.record',
      action: 'moderation.violation.detected',
      targetJson: { scopeId: event.scopeId, identityId: member.identityId, messageId: event.message.id, groupWid: event.groupWid },
      metadataJson: { source: violation.source, detail: violation.detail, policy: violation.policy, dryRun: config.dryRun, mode }
    });
    if (config.dryRun || violation.policy === 'audit' || violation.policy === 'off' || mode === 'OBSERVE') continue;

    const policy = effectivePolicy(violation.policy, isNewMember(db, event.scopeId, member.identityId, now, config.shield.newMemberHours));
    if (policy === 'expel-new-members' && mode === 'MANAGE' && !expelled) {
      if (!deleted) actions.push({ type: 'message.delete', messageId: event.message.id, reason: `${MODERATION_PLUGIN_ID}:${violation.source}` });
      deleted = true;
      expelled = true;
      const plan = await planCase(context, {
        db, config, scopeId: event.scopeId, scopeLabel: await scopeName(context, event.scopeId), member,
        kind: 'expulsion', reason: t(`${ns}.rule.${violation.source}`), automatic: true, t
      });
      actions.push(...plan.actions);
      actions.push(...alertActions(await adminRecipients(context, config, event.scopeId, event.groupWid), t(`${ns}.alert.autoExpel`, {
        member: member.label, rule: t(`${ns}.rule.${violation.source}`), group: event.groupWid, dry: ''
      })));
      continue;
    }
    const wantsDelete = policy === 'delete' || policy === 'delete-and-warn';
    const wantsWarn = policy === 'warn' || policy === 'delete-and-warn';
    if (wantsDelete && mode === 'MANAGE' && !deleted) {
      actions.push({ type: 'message.delete', messageId: event.message.id, reason: `${MODERATION_PLUGIN_ID}:${violation.source}` });
      deleted = true;
    }
    if (wantsWarn || (wantsDelete && mode !== 'MANAGE')) {
      actions.push(...warnActions(db, config, t, event.scopeId, event.groupWid, member, violation, now));
      const count = addWarning(db, {
        scopeId: event.scopeId, identityId: member.identityId, source: violation.source,
        reason: t(`${ns}.rule.${violation.source}`), now, ttlDays: config.warnings.ttlDays
      });
      if (count === config.warnings.alertAt) {
        actions.push(...alertActions(await adminRecipients(context, config, event.scopeId, event.groupWid),
          t(`${ns}.alert.warningLimit`, { member: member.label, count })));
      }
    }
  }
  return actions;
}

/** Invite links and floods from new members may expel; from everyone else they fall back to delete and warn. */
function effectivePolicy(policy: RulePolicy, newMember: boolean): RulePolicy {
  if (policy !== 'expel-new-members') return policy;
  return newMember ? policy : 'delete-and-warn';
}

function warnActions(
  _db: unknown, _config: ModerationConfig, t: TranslateFn, _scopeId: string, groupWid: string, member: Member, violation: Violation, _now: Date
): PluginAction[] {
  const mention = `@${member.mentionWid.split('@')[0]}`;
  return [{
    type: 'message.sendText',
    chatId: groupWid,
    text: t(`${ns}.violation.warn`, { member: mention, rule: t(`${ns}.rule.${violation.source}`) }),
    mentionedWids: [member.mentionWid]
  }];
}

async function counterViolations(context: HookContext, config: ModerationConfig, event: PluginMessageEvent): Promise<Violation[]> {
  const store = context.ephemeralStore;
  if (!store) return [];
  const found: Violation[] = [];
  const flood = config.shield.flood;
  if (flood.enabled && flood.policy !== 'off') {
    const count = await store.increment(`moderation:flood:${event.scopeId}:${event.actorIdentityId}`, flood.windowSeconds);
    if (count === flood.maxMessages + 1) found.push({ source: 'flood', detail: `${count}/${flood.windowSeconds}s`, policy: flood.policy });
  }
  const burst = config.etiquette.stickerBurst;
  if (burst.enabled && burst.policy !== 'off' && isSticker(event.message)) {
    const count = await store.increment(`moderation:stickers:${event.groupWid}:${event.actorIdentityId}`, burst.windowSeconds);
    if (count > burst.maxStickers) found.push({ source: 'sticker-burst', detail: `${count}/${burst.windowSeconds}s`, policy: burst.policy });
  }
  return found;
}

/** Moderators an operator chose are trusted like group admins: automatic rules never act on them. */
async function isModerator(context: HookContext, scopeId: string, member: Member): Promise<boolean> {
  return Boolean((await moderatorIdentityIds(context, scopeId))?.has(member.identityId));
}

async function isGroupAdmin(context: HookContext, groupWid: string, member: Member): Promise<boolean> {
  const key = `moderation:admins:${groupWid}`;
  let admins = await context.ephemeralStore?.get(key) as string[] | undefined;
  if (!Array.isArray(admins)) {
    admins = (await participantsOf(context, groupWid))
      .filter((participant) => participant.isAdmin || participant.isSuperAdmin)
      .map((participant) => participant.wid);
    await context.ephemeralStore?.set(key, admins, ADMIN_CACHE_SECONDS);
  }
  return admins.some((wid) => member.addresses.has(wid));
}

export async function handleParticipantChange(context: HookContext, event: PluginParticipantChangeEvent): Promise<PluginAction[] | void> {
  if (!event.groupWid) return;
  if (event.action === 'promote' || event.action === 'demote') {
    await context.ephemeralStore?.delete?.(`moderation:admins:${event.groupWid}`);
    return;
  }
  const arrival = ARRIVALS.has(event.action);
  const request = event.action === 'membership_request';
  if (!arrival && !request) return;
  const config = await configFor(context, event.scopeId);
  if (!config.enabled || config.exemptGroupChatIds.includes(event.groupWid)) return;
  const db = database(context);
  if (!db) return;
  const now = event.occurredAt ?? event.receivedAt ?? nowFrom(context);
  const bots = new Set(event.botIdentityIds);
  const t = await translator(context, event.scopeId);
  const actions: PluginAction[] = [];
  const mode = event.managementMode ?? 'OBSERVE';

  const standing = await context.memberStandingsForScope?.(event.scopeId);
  for (const identity of event.affectedIdentities) {
    if (bots.has(identity.identityId)) continue;
    if (arrival) recordJoin(db, event.scopeId, identity.identityId, now);
    const recorded = standing?.find(member => member.identityId === identity.identityId);
    const held = activeCase(db, event.scopeId, identity.identityId) ??
      (recorded ? { id: recorded.caseRef, kind: recorded.standing === 'expelled' ? 'expulsion' : 'suspension' } : undefined);
    if (!held) {
      if (request && config.joinApproval.autoApprove && mode === 'MANAGE' && !config.dryRun &&
          !db.get('SELECT 1 FROM locks WHERE group_wid = ? AND reason = ? AND locked_until > ?', event.groupWid, 'raid', now.toISOString())) {
        actions.push({ type: 'group.approveMembershipRequest', groupWid: event.groupWid, userWid: identity.canonicalWid,
          reason: MODERATION_PLUGIN_ID + ':auto-approve' },
          { type: 'audit.record', action: 'community-admin.join-request.approved',
            targetJson: { scopeId: event.scopeId, groupWid: event.groupWid, identityId: identity.identityId } });
      }
      continue;
    }
    actions.push({
      type: 'audit.record',
      action: 'moderation.rejoin.blocked',
      targetJson: { scopeId: event.scopeId, identityId: identity.identityId, groupWid: event.groupWid, caseId: held.id },
      metadataJson: { kind: held.kind, event: event.action, dryRun: config.dryRun, mode }
    });
    if (config.dryRun || mode !== 'MANAGE') continue;
    actions.push(request
      ? { type: 'group.rejectMembershipRequest', groupWid: event.groupWid, userWid: identity.canonicalWid, reason: `${MODERATION_PLUGIN_ID}:${held.kind}` }
      : { type: 'group.removeParticipant', groupWid: event.groupWid, userWid: identity.canonicalWid, reason: `${MODERATION_PLUGIN_ID}:${held.kind}` });
    actions.push(...alertActions(await adminRecipients(context, config, event.scopeId, event.groupWid), t(`${ns}.alert.rejoin`, {
      member: identity.displayName?.trim() || `@${identity.mentionWid.split('@')[0]}`,
      kind: t(`${ns}.kind.${held.kind}`),
      group: event.groupDisplayName?.trim() || event.groupWid,
      dry: ''
    })));
  }

  if (arrival && config.shield.raid.enabled && context.ephemeralStore) {
    actions.push(...await raidActions(context, config, event, t, mode));
  }
  return actions;
}

async function raidActions(
  context: HookContext, config: ModerationConfig, event: PluginParticipantChangeEvent, t: TranslateFn, mode: string
): Promise<PluginAction[]> {
  const raid = config.shield.raid;
  const joins = event.affectedIdentities.filter((identity) => !event.botIdentityIds.includes(identity.identityId)).length;
  let count = 0;
  for (let index = 0; index < joins; index += 1) {
    count = await context.ephemeralStore!.increment(`moderation:raid:${event.groupWid}`, raid.windowSeconds);
  }
  if (count < raid.maxJoins || count - joins >= raid.maxJoins) return [];
  const until = new Date(nowFrom(context).getTime() + raid.lockMinutes * 60_000);
  const actions: PluginAction[] = [{
    type: 'audit.record',
    action: 'moderation.raid.detected',
    targetJson: { scopeId: event.scopeId, groupWid: event.groupWid },
    metadataJson: { joins: count, windowSeconds: raid.windowSeconds, dryRun: config.dryRun, mode }
  }];
  if (config.dryRun || mode !== 'MANAGE') return actions;
  const db = database(context);
  if (db) recordLock(db, event.groupWid!, event.scopeId, until, 'raid');
  actions.push({ type: 'group.lockMessages', groupWid: event.groupWid!, reason: `${MODERATION_PLUGIN_ID}:raid` });
  if (raid.revokeInvite) actions.push({ type: 'group.revokeInvite', groupWid: event.groupWid!, reason: `${MODERATION_PLUGIN_ID}:raid` });
  actions.push({
    type: 'plugin.enqueueJob', pluginId: MODERATION_PLUGIN_ID, jobName: LOCK_EXPIRE_JOB, scopeId: event.scopeId, runAt: until,
    payload: { groupWid: event.groupWid }, dedupeKey: `${LOCK_EXPIRE_JOB}:${event.groupWid}:${until.toISOString()}`
  });
  actions.push(...alertActions(await adminRecipients(context, config, event.scopeId, event.groupWid), t(`${ns}.alert.raid`, {
    count, group: event.groupDisplayName?.trim() || event.groupWid!, seconds: raid.windowSeconds, minutes: raid.lockMinutes, dry: ''
  })));
  return actions;
}

async function requiredApproval(context: HookContext, scopeId: string, groupWid?: string): Promise<PluginAction[]> {
  const config = await configFor(context, scopeId);
  if (!config.enabled || config.joinApproval.policy !== 'require') return [];
  const groups = await context.coveredGroupsForScope?.(scopeId) ?? [];
  return groups.filter(group => group.managementMode === 'MANAGE' && (!groupWid || group.groupWid === groupWid))
    .map(group => ({ type: 'group.setMembershipApprovalMode', groupWid: group.groupWid, enabled: true,
      reason: MODERATION_PLUGIN_ID + ':require-join-approval' }));
}

export async function handleJob(context: HookContext, job: PluginJobEvent): Promise<PluginAction[] | void> {
  if (job.jobName === 'scope.configuration.changed') return requiredApproval(context, job.scopeId);
  const db = database(context);
  if (!db) return;
  const now = nowFrom(context);
  if (job.jobName === SUSPENSION_END_JOB) {
    const caseId = (job.payload as { caseId?: unknown } | undefined)?.caseId;
    if (typeof caseId !== 'string') return;
    const row = caseById(db, caseId);
    // Lifted, replaced or extended cases do nothing here; an extension queues its own job.
    if (!row || row.status !== 'active' || row.kind !== 'suspension' || !row.ends_at || Date.parse(row.ends_at) > now.getTime() + 1000) return;
    const config = await configFor(context, row.scope_id);
    const t = await translator(context, row.scope_id);
    const plan = await planRestore(context, {
      db, config: { ...config, dryRun: false }, scopeId: row.scope_id, scopeLabel: await scopeName(context, row.scope_id), caseRow: row, status: 'ended', t
    });
    return plan.actions;
  }
  if (job.jobName === LOCK_EXPIRE_JOB) {
    const groupWid = (job.payload as { groupWid?: unknown } | undefined)?.groupWid;
    if (typeof groupWid !== 'string' || !takeExpiredLock(db, groupWid, new Date(now.getTime() + 1000))) return;
    return [
      { type: 'group.unlockMessages', groupWid, reason: `${MODERATION_PLUGIN_ID}:raid-ended` },
      { type: 'audit.record', action: 'moderation.raid.unlocked', targetJson: { scopeId: job.scopeId, groupWid } }
    ];
  }
}
