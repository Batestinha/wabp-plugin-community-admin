import type { PluginAction } from '@wabs/plugin-sdk/actions';
import type { CommandMetadata, CommandTargetSpec } from '@wabs/plugin-sdk/command-metadata';
import type { CommandContext, CommandResult } from '@wabs/plugin-sdk/commands';
import type { ManagedGroupCommandContext } from '@wabs/plugin-sdk/managed-group-plugin';
import type { PluginDatabase } from '@wabs/plugin-sdk/database';
import type { ModerationConfig } from './config';
import {
  DAY_MS,
  LOCK_EXPIRE_JOB,
  MODERATION_MANAGE_PERMISSION,
  MODERATION_NAMESPACE as ns,
  MODERATION_PLUGIN_ID,
  SUSPENSION_END_JOB
} from './constants';
import {
  adminRecipients,
  alertActions,
  checkAuthority,
  configFor,
  database,
  formatDate,
  isProtected,
  memberById,
  memberByWid,
  memberTranslator,
  nowFrom,
  parseDays,
  planCase,
  planRestore,
  scopeName,
  type Member,
  type ModerationDeps
} from './moderation';
import { evaluateMessage } from './rules';
import {
  activeCase,
  activeWarnings,
  addReport,
  addWarning,
  dropLock,
  extendCase,
  listActiveCases,
  openReports,
  pardonWarnings,
  recordLock,
  reportById,
  resolveReport
} from './store';

type Deps = Omit<ManagedGroupCommandContext, 'listEnabledScopes'> & ModerationDeps;

const CHAT_FLAG_TARGET: CommandTargetSpec = { kind: 'group', name: 'chat', flag: 'chat' };
const SCOPE_TARGET: CommandTargetSpec = { kind: 'scope', flag: ['scope', 'scope-id'], fallback: 'current_scope' };

function modCommand(subcommand: string, mutation: CommandMetadata['mutation']): CommandMetadata {
  return {
    plane: 'group_operation',
    interaction: 'either_same_chat',
    pluginId: MODERATION_PLUGIN_ID,
    requiresManagedGroup: true,
    permission: MODERATION_MANAGE_PERMISSION,
    privateManagedTarget: { mode: 'infer_group_or_community', explicitTargetName: 'chat', collapseCommunities: true },
    targets: [CHAT_FLAG_TARGET, SCOPE_TARGET],
    mutation,
    auditAction: `moderation.${subcommand}`,
    ...(mutation === 'durable' ? { dangerous: true } : {}),
    help: {
      familyKey: `${ns}.help.family`,
      featureId: 'moderation',
      topicId: 'moderate-members',
      descriptionKey: `${ns}.help.cmd.${subcommand}`,
      usage: `/mod ${subcommand}`,
      exampleKeys: [`${ns}.help.moderate.example`]
    }
  };
}

const REPORT_COMMAND: CommandMetadata = {
  plane: 'group_operation',
  interaction: 'group_same_chat',
  pluginId: MODERATION_PLUGIN_ID,
  requiresManagedGroup: true,
  requiresCurrentManagedGroupMembership: true,
  targets: [SCOPE_TARGET],
  mutation: 'durable',
  auditAction: 'moderation.report',
  help: {
    familyKey: `${ns}.help.family`,
    featureId: 'moderation',
    topicId: 'report-message',
    descriptionKey: `${ns}.help.cmd.report`,
    usage: '/report',
    exampleKeys: [`${ns}.help.report.example`]
  }
};

function reply(text: string, pluginActions: PluginAction[] = []): CommandResult {
  return { handled: true, text, ...(pluginActions.length ? { pluginActions } : {}) };
}

function args(ctx: CommandContext): string[] {
  return (ctx.remainingArgs ?? ctx.command.args).filter((arg) => !arg.startsWith('@'));
}

function scopeOf(ctx: CommandContext): string | undefined {
  return ctx.targets?.scope?.id ?? ctx.scopeId;
}

/** The member a command is about: a mention, the author of the quoted message, or a phone number. */
async function targetMember(deps: Deps, ctx: CommandContext): Promise<{ member?: Member | undefined; rest: string[] }> {
  const rest = args(ctx);
  const mentioned = ctx.command.mentions[0] ?? ctx.message.mentions?.[0]?.wid;
  if (mentioned) return { member: await memberByWid(deps, mentioned), rest };
  const quotedAuthor = ctx.message.replyTo?.snapshot?.authorWid;
  if (quotedAuthor) return { member: await memberByWid(deps, quotedAuthor), rest };
  const phone = rest[0]?.replace(/[\s()+-]/gu, '');
  if (phone && /^\d{8,15}$/u.test(phone)) {
    const member = await memberByWid(deps, `${phone}@s.whatsapp.net`) ?? await memberByWid(deps, `${phone}@c.us`);
    return { member, rest: rest.slice(1) };
  }
  return { rest };
}

interface Prepared {
  scopeId: string;
  config: ModerationConfig;
  db: PluginDatabase;
  actor: Member;
}

/** Scope, configuration, storage, the acting admin and the authority check, shared by every /mod command. */
async function prepare(deps: Deps, ctx: CommandContext): Promise<Prepared | CommandResult> {
  const scopeId = scopeOf(ctx);
  if (!scopeId) return reply(ctx.t(`${ns}.disabled`));
  const actorIdentityId = ctx.actor?.identityAddress.identityId;
  const config = await configFor(deps, scopeId, actorIdentityId);
  if (!config.enabled) return reply(ctx.t(`${ns}.disabled`));
  const db = database(deps);
  if (!db) return reply(ctx.t(`${ns}.unavailable`));
  const actor = actorIdentityId ? await memberById(deps, actorIdentityId) : undefined;
  if (!actor) return reply(ctx.t(`${ns}.unknownMember`));
  const authority = await checkAuthority(deps, config, actor, ctx.groupWid);
  if (!authority.ok) {
    return reply(authority.authorityLabel
      ? ctx.t(`${ns}.notAuthorized`, { authority: authority.authorityLabel })
      : ctx.t(`${ns}.notAuthorizedUnknown`));
  }
  return { scopeId, config, db, actor };
}

function isResult(value: Prepared | CommandResult): value is CommandResult {
  return 'handled' in value;
}

function dry(ctx: CommandContext, config: ModerationConfig): string {
  return config.dryRun ? ctx.t(`${ns}.dryRunSuffix`) : '';
}

export function registerModerationCommands(context: ManagedGroupCommandContext): void {
  const deps = context as unknown as Deps;
  const router = context.router;

  router.register('mod', 'status', modCommand('status', 'none'), async (ctx) => {
    const prepared = await prepare(deps, ctx);
    if (isResult(prepared)) return prepared;
    const { config, db, scopeId } = prepared;
    const authority = config.authorityGroupChatIds.length
      ? ctx.t(`${ns}.authority.configured`, { count: config.authorityGroupChatIds.length })
      : ctx.t(`${ns}.authority.parent`);
    return reply(ctx.t(`${ns}.status`, {
      state: ctx.t(`${ns}.state.${config.enabled ? 'on' : 'off'}`),
      dry: config.dryRun ? ctx.t(`${ns}.state.dry`) : '',
      cases: listActiveCases(db, scopeId).length,
      reports: openReports(db, scopeId).length,
      authority
    }));
  });

  const startCase = (kind: 'suspension' | 'expulsion') => async (ctx: CommandContext): Promise<CommandResult> => {
    const prepared = await prepare(deps, ctx);
    if (isResult(prepared)) return prepared;
    const { config, db, scopeId, actor } = prepared;
    const { member, rest } = await targetMember(deps, ctx);
    if (!member) return reply(ctx.t(kind === 'suspension' ? `${ns}.usage.suspend` : `${ns}.usage.expel`));
    if (await isProtected(deps, member)) return reply(ctx.t(`${ns}.protectedMember`));
    let days: number | undefined;
    let reasonWords = rest;
    if (kind === 'suspension') {
      const parsed = /^\d/u.test(rest[0] ?? '') ? parseDays(rest[0], config.suspension.defaultDays, config.suspension.maxDays) : config.suspension.defaultDays;
      if (parsed === undefined) return reply(ctx.t(`${ns}.usage.suspend`));
      days = parsed;
      if (/^\d/u.test(rest[0] ?? '')) reasonWords = rest.slice(1);
    }
    const reason = reasonWords.join(' ').trim();
    if (!reason) return reply(ctx.t(`${ns}.reasonRequired`));
    const t = ctx.t;
    const plan = await planCase(deps, {
      db, config, scopeId, scopeLabel: await scopeName(deps, scopeId), member, kind, reason, days,
      actorIdentityId: actor.identityId, t, locale: ctx.locale
    });
    const until = formatDate(new Date(nowFrom(deps).getTime() + (days ?? 0) * DAY_MS), ctx.locale);
    return reply(kind === 'suspension'
      ? t(`${ns}.suspended`, { member: member.label, until, count: plan.removed.length, dry: dry(ctx, config) })
      : t(`${ns}.expelled`, { member: member.label, count: plan.removed.length, dry: dry(ctx, config) }), plan.actions);
  };
  router.register('mod', 'suspend', modCommand('suspend', 'durable'), startCase('suspension'));
  router.register('mod', 'expel', modCommand('expel', 'durable'), startCase('expulsion'));

  router.register('mod', 'lift', modCommand('lift', 'durable'), async (ctx) => {
    const prepared = await prepare(deps, ctx);
    if (isResult(prepared)) return prepared;
    const { config, db, scopeId } = prepared;
    const { member } = await targetMember(deps, ctx);
    if (!member) return reply(ctx.t(`${ns}.usage.member`));
    const row = activeCase(db, scopeId, member.identityId);
    if (!row) return reply(ctx.t(`${ns}.noCase`, { member: member.label }));
    const plan = await planRestore(deps, { db, config, scopeId, scopeLabel: await scopeName(deps, scopeId), caseRow: row, status: 'lifted', t: ctx.t });
    return reply(ctx.t(`${ns}.lifted`, {
      kind: ctx.t(`${ns}.kind.${row.kind}`), member: member.label, count: plan.readded.length, dry: dry(ctx, config)
    }), plan.actions);
  });

  router.register('mod', 'extend', modCommand('extend', 'durable'), async (ctx) => {
    const prepared = await prepare(deps, ctx);
    if (isResult(prepared)) return prepared;
    const { config, db, scopeId } = prepared;
    const { member, rest } = await targetMember(deps, ctx);
    if (!member) return reply(ctx.t(`${ns}.usage.extend`));
    const row = activeCase(db, scopeId, member.identityId);
    if (!row || row.kind !== 'suspension' || !row.ends_at) return reply(ctx.t(`${ns}.noCase`, { member: member.label }));
    const days = parseDays(rest[0], 0, config.suspension.maxDays);
    if (!days) return reply(ctx.t(`${ns}.usage.extend`));
    const endsAt = new Date(Date.parse(row.ends_at) + days * DAY_MS);
    extendCase(db, row.id, endsAt);
    return reply(ctx.t(`${ns}.extended`, { member: member.label, until: formatDate(endsAt, ctx.locale) }), [
      { type: 'member.setStanding', identityId: row.identity_id, standing: 'suspended', caseRef: row.id, endsAt, reason: row.reason },
      { type: 'plugin.enqueueJob', pluginId: MODERATION_PLUGIN_ID, jobName: SUSPENSION_END_JOB, scopeId, runAt: endsAt,
        payload: { caseId: row.id }, dedupeKey: `${SUSPENSION_END_JOB}:${row.id}:${endsAt.toISOString()}` },
      { type: 'audit.record', action: 'moderation.suspension.extended', targetJson: { scopeId, identityId: row.identity_id, caseId: row.id },
        metadataJson: { endsAt: endsAt.toISOString() } }
    ]);
  });

  router.register('mod', 'cases', modCommand('cases', 'none'), async (ctx) => {
    const prepared = await prepare(deps, ctx);
    if (isResult(prepared)) return prepared;
    const rows = listActiveCases(prepared.db, prepared.scopeId);
    if (rows.length === 0) return reply(ctx.t(`${ns}.cases.none`));
    const lines = [ctx.t(`${ns}.cases.header`)];
    for (const row of rows) {
      const member = await memberById(deps, row.identity_id);
      lines.push(ctx.t(`${ns}.cases.item`, {
        member: member?.label ?? row.identity_id,
        kind: ctx.t(`${ns}.kind.${row.kind}`),
        until: row.ends_at ? ctx.t(`${ns}.cases.until`, { until: formatDate(new Date(row.ends_at), ctx.locale) }) : '',
        reason: row.reason
      }));
    }
    return reply(lines.join('\n'));
  });

  router.register('mod', 'warn', modCommand('warn', 'durable'), async (ctx) => {
    const prepared = await prepare(deps, ctx);
    if (isResult(prepared)) return prepared;
    const { config, db, scopeId, actor } = prepared;
    const { member, rest } = await targetMember(deps, ctx);
    if (!member) return reply(ctx.t(`${ns}.usage.member`));
    if (await isProtected(deps, member)) return reply(ctx.t(`${ns}.protectedMember`));
    const reason = rest.join(' ').trim();
    if (!reason) return reply(ctx.t(`${ns}.reasonRequired`));
    const audit: PluginAction = { type: 'audit.record', action: 'moderation.warning.given',
      targetJson: { scopeId, identityId: member.identityId }, metadataJson: { reason, dryRun: config.dryRun } };
    if (config.dryRun) return reply(ctx.t(`${ns}.warned`, { member: member.label, count: activeWarnings(db, scopeId, member.identityId, nowFrom(deps)).length, dry: dry(ctx, config) }), [audit]);
    const count = addWarning(db, { scopeId, identityId: member.identityId, source: 'admin', reason, actorIdentityId: actor.identityId, now: nowFrom(deps), ttlDays: config.warnings.ttlDays });
    const noticeT = await memberTranslator(deps, member.identityId, scopeId, ctx.t);
    const actions: PluginAction[] = [audit,
      { type: 'message.sendText', chatId: member.deliveryChatId, text: noticeT(`${ns}.notice.warned`, { member: member.label, reason }) }];
    if (count >= config.warnings.alertAt) {
      actions.push(...alertActions(await adminRecipients(deps, config, ctx.groupWid), ctx.t(`${ns}.alert.warningLimit`, { member: member.label, count })));
    }
    return reply(ctx.t(`${ns}.warned`, { member: member.label, count, dry: '' }), actions);
  });

  router.register('mod', 'pardon', modCommand('pardon', 'durable'), async (ctx) => {
    const prepared = await prepare(deps, ctx);
    if (isResult(prepared)) return prepared;
    const { member, rest } = await targetMember(deps, ctx);
    if (!member) return reply(ctx.t(`${ns}.usage.member`));
    const id = rest[0] && /^#?\d+$/u.test(rest[0]) ? Number(rest[0].replace('#', '')) : undefined;
    const count = prepared.config.dryRun ? 0 : pardonWarnings(prepared.db, prepared.scopeId, member.identityId, nowFrom(deps), id);
    return reply(ctx.t(`${ns}.pardoned`, { member: member.label, count }));
  });

  router.register('mod', 'warnings', modCommand('warnings', 'none'), async (ctx) => {
    const prepared = await prepare(deps, ctx);
    if (isResult(prepared)) return prepared;
    const { member } = await targetMember(deps, ctx);
    if (!member) return reply(ctx.t(`${ns}.usage.member`));
    const rows = activeWarnings(prepared.db, prepared.scopeId, member.identityId, nowFrom(deps));
    if (rows.length === 0) return reply(ctx.t(`${ns}.warnings.none`, { member: member.label }));
    return reply([ctx.t(`${ns}.warnings.header`, { member: member.label }), ...rows.map((row) => ctx.t(`${ns}.warnings.item`, {
      id: row.id, date: formatDate(new Date(row.created_at), ctx.locale), reason: row.reason
    }))].join('\n'));
  });

  router.register('mod', 'lock', modCommand('lock', 'durable'), async (ctx) => {
    const prepared = await prepare(deps, ctx);
    if (isResult(prepared)) return prepared;
    if (!ctx.groupWid) return reply(ctx.t(`${ns}.usage.lock`));
    const rest = args(ctx);
    const minutes = /^\d+$/u.test(rest[0] ?? '') ? Math.min(Number(rest[0]), 7 * 24 * 60) : undefined;
    const until = minutes ? new Date(nowFrom(deps).getTime() + minutes * 60_000) : undefined;
    const reason = (minutes ? rest.slice(1) : rest).join(' ').trim() || 'manual';
    const audit: PluginAction = { type: 'audit.record', action: 'moderation.lock', targetJson: { scopeId: prepared.scopeId, groupWid: ctx.groupWid },
      metadataJson: { reason, until: until?.toISOString() ?? null, dryRun: prepared.config.dryRun } };
    const text = ctx.t(`${ns}.locked`, { until: until ? formatDate(until, ctx.locale) : '…', dry: dry(ctx, prepared.config) });
    if (prepared.config.dryRun) return reply(text, [audit]);
    const actions: PluginAction[] = [audit, { type: 'group.lockMessages', groupWid: ctx.groupWid, reason: `${MODERATION_PLUGIN_ID}:${reason}` }];
    if (until) {
      recordLock(prepared.db, ctx.groupWid, prepared.scopeId, until, reason);
      actions.push({ type: 'plugin.enqueueJob', pluginId: MODERATION_PLUGIN_ID, jobName: LOCK_EXPIRE_JOB, scopeId: prepared.scopeId, runAt: until,
        payload: { groupWid: ctx.groupWid }, dedupeKey: `${LOCK_EXPIRE_JOB}:${ctx.groupWid}:${until.toISOString()}` });
    }
    return reply(text, actions);
  });

  router.register('mod', 'unlock', modCommand('unlock', 'durable'), async (ctx) => {
    const prepared = await prepare(deps, ctx);
    if (isResult(prepared)) return prepared;
    if (!ctx.groupWid) return reply(ctx.t(`${ns}.usage.lock`));
    const audit: PluginAction = { type: 'audit.record', action: 'moderation.unlock', targetJson: { scopeId: prepared.scopeId, groupWid: ctx.groupWid },
      metadataJson: { dryRun: prepared.config.dryRun } };
    if (prepared.config.dryRun) return reply(ctx.t(`${ns}.unlocked`, { dry: dry(ctx, prepared.config) }), [audit]);
    dropLock(prepared.db, ctx.groupWid);
    return reply(ctx.t(`${ns}.unlocked`, { dry: '' }), [audit, { type: 'group.unlockMessages', groupWid: ctx.groupWid, reason: `${MODERATION_PLUGIN_ID}:manual` }]);
  });

  router.register('mod', 'test', modCommand('test', 'none'), async (ctx) => {
    const prepared = await prepare(deps, ctx);
    if (isResult(prepared)) return prepared;
    const text = ctx.command.rawArgs.trim();
    const violations = evaluateMessage(prepared.config, {
      body: text, links: extractLinks(text), type: 'chat', hasMedia: false, chatId: ctx.groupWid ?? '', timestamp: nowFrom(deps)
    });
    return reply(violations.length === 0
      ? ctx.t(`${ns}.test.none`)
      : ctx.t(`${ns}.test.hit`, { rules: violations.map((violation) => `${ctx.t(`${ns}.rule.${violation.source}`)} (${violation.policy})`).join(', ') }));
  });

  router.register('mod', 'resolve', modCommand('resolve', 'durable'), async (ctx) => {
    const prepared = await prepare(deps, ctx);
    if (isResult(prepared)) return prepared;
    const { config, db, scopeId, actor } = prepared;
    const rest = args(ctx);
    const id = Number((rest[0] ?? '').replace('#', ''));
    const action = (rest[1] ?? '').toLowerCase();
    if (!Number.isSafeInteger(id) || !['delete', 'warn', 'suspend', 'expel', 'dismiss'].includes(action)) return reply(ctx.t(`${ns}.usage.resolve`));
    const report = reportById(db, scopeId, id);
    if (!report || report.status !== 'open') return reply(ctx.t(`${ns}.report.unknown`, { id }));
    const now = nowFrom(deps);
    if (action === 'dismiss') {
      if (!config.dryRun) resolveReport(db, id, 'dismissed', 'dismiss', actor.identityId, now);
      return reply(ctx.t(`${ns}.report.dismissed`, { id }), [{ type: 'audit.record', action: 'moderation.report.dismissed',
        targetJson: { scopeId, reportId: id }, metadataJson: { dryRun: config.dryRun } }]);
    }
    const author = report.author_identity_id ? await memberById(deps, report.author_identity_id) : undefined;
    if (!author) return reply(ctx.t(`${ns}.unknownMember`));
    if (await isProtected(deps, author)) return reply(ctx.t(`${ns}.protectedMember`));
    const actions: PluginAction[] = [{ type: 'audit.record', action: `moderation.report.${action}`, targetJson: { scopeId, reportId: id, identityId: author.identityId },
      metadataJson: { dryRun: config.dryRun } }];
    if (!config.dryRun) {
      if (action === 'delete' || action === 'warn' || action === 'suspend' || action === 'expel') {
        actions.push({ type: 'message.delete', messageId: report.message_id, reason: `${MODERATION_PLUGIN_ID}:report-${id}` });
      }
      if (action === 'warn') {
        addWarning(db, { scopeId, identityId: author.identityId, source: 'report', reason: `report #${id}`, actorIdentityId: actor.identityId, now, ttlDays: config.warnings.ttlDays });
        const noticeT = await memberTranslator(deps, author.identityId, scopeId, ctx.t);
        actions.push({ type: 'message.sendText', chatId: author.deliveryChatId, text: noticeT(`${ns}.notice.warned`, { member: author.label, reason: `report #${id}` }) });
      }
      if (action === 'suspend' || action === 'expel') {
        const plan = await planCase(deps, { db, config, scopeId, scopeLabel: await scopeName(deps, scopeId), member: author,
          kind: action === 'suspend' ? 'suspension' : 'expulsion', reason: `report #${id}`, actorIdentityId: actor.identityId, t: ctx.t, locale: ctx.locale });
        actions.push(...plan.actions);
      }
      resolveReport(db, id, 'resolved', action, actor.identityId, now);
    }
    return reply(ctx.t(`${ns}.report.resolved`, { id, action, dry: dry(ctx, config) }), actions);
  });

  router.register('report', '*', REPORT_COMMAND, async (ctx) => {
    const scopeId = scopeOf(ctx);
    if (!scopeId || !ctx.groupWid) return reply(ctx.t(`${ns}.report.needsReply`));
    const reporterId = ctx.actor?.identityAddress.identityId;
    const config = await configFor(deps, scopeId, reporterId);
    if (!config.enabled || !config.reports.enabled) return reply(ctx.t(`${ns}.report.disabled`));
    const db = database(deps);
    if (!db) return reply(ctx.t(`${ns}.unavailable`));
    const quoted = ctx.message.replyTo;
    if (!quoted?.messageId || !reporterId) return reply(ctx.t(`${ns}.report.needsReply`));
    const author = quoted.snapshot?.authorWid ? await memberByWid(deps, quoted.snapshot.authorWid) : undefined;
    const reporter = await memberById(deps, reporterId);
    const { report, created } = addReport(db, {
      scopeId, groupWid: ctx.groupWid, messageId: quoted.messageId, authorIdentityId: author?.identityId,
      reporterIdentityId: reporterId, excerpt: (quoted.snapshot?.body ?? '').replace(/\s+/gu, ' ').trim(), now: nowFrom(deps)
    });
    const answer = ctx.t(created ? `${ns}.report.thanks` : `${ns}.report.duplicate`);
    const actions: PluginAction[] = [];
    // Keep the reporter anonymous: remove the /report message and answer privately when the group allows it.
    if (ctx.managementMode === 'MANAGE') actions.push({ type: 'message.delete', messageId: ctx.message.id, reason: `${MODERATION_PLUGIN_ID}:report-anonymity` });
    if (reporter) actions.push({ type: 'message.sendText', chatId: reporter.deliveryChatId, text: answer });
    if (created) {
      const reasonText = ctx.command.rawArgs.replace(/^\*\s*/u, '').trim();
      actions.push({ type: 'audit.record', action: 'moderation.report.opened', targetJson: { scopeId, reportId: report.id, groupWid: ctx.groupWid } });
      actions.push(...alertActions(await adminRecipients(deps, config, ctx.groupWid), ctx.t(`${ns}.alert.report`, {
        id: report.id,
        group: await groupLabel(deps, scopeId, ctx.groupWid),
        reporter: reporter?.label ?? '?',
        author: author?.label ?? '?',
        excerpt: report.excerpt || '…',
        reason: reasonText ? ctx.t(`${ns}.alert.reportReason`, { reason: reasonText }) : ''
      })));
    }
    return reporter ? { handled: true, pluginActions: actions } : reply(answer, actions);
  });
}

async function groupLabel(deps: Deps, scopeId: string, groupWid: string): Promise<string> {
  const groups = await deps.coveredGroupsForScope?.(scopeId).catch(() => []) ?? [];
  return groups.find((group) => group.groupWid === groupWid)?.groupDisplayName?.trim() || groupWid;
}

function extractLinks(text: string): Array<{ raw: string; url: string }> {
  return [...text.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>]+|\b[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>]*)?/giu)].map((match) => ({ raw: match[0], url: match[0] }));
}
