import { z } from 'zod';
import type { AssistantTool, AssistantToolContext } from '@wabs/plugin-sdk/assistant-tools';
import { jsonSchemaForZodObject, throwIfAborted } from '@wabs/plugin-sdk/assistant-tools';
import type { PluginAction } from '@wabs/plugin-sdk/actions';
import type { ManagedGroupCommandContext as PluginCommandContext } from '@wabs/plugin-sdk/managed-group-plugin';
import type { GroupParticipant } from '@wabs/plugin-sdk/transport';
import { requireStableIdentityAddress } from '@wabs/plugin-sdk/message-actor';
import { parseDoasConfig } from './config';
import { DOAS_PERMISSIONS, DOAS_PLUGIN_ID } from './manifest';
import { resolveDoasFanoutTargets, type DoasFanoutMode } from './targetResolver';

const widSchema = z.string().min(3).max(160).regex(/^[^\s]+$/);
const fanoutSchema = z.enum(['none', 'children', 'all']);
const participantFilterSchema = z.enum(['all', 'admins', 'members', 'normal-members', 'super-admins', 'explicit']);
const participantActionSchema = z.enum(['approve', 'reject', 'add', 'promote', 'demote', 'remove']);
const groupActionSchema = z.enum([
  'lock',
  'unlock',
  'send',
  'info-lock',
  'info-unlock',
  'member-add',
  'join-approval',
  'disappearing',
  'report-to-admin',
  'picture-clear',
  'revoke-invite',
  'unlink-community',
  'leave',
  'delete-chat',
  'community-group-create',
  'dismantle-group',
  'dismantle-community',
  'subject',
  'description'
]);
const destructiveBotTargetParticipantActions = new Set<z.infer<typeof participantActionSchema>>([
  'reject',
  'demote',
  'remove'
]);
const groupToolFanoutUnsupportedActions = new Set<z.infer<typeof groupActionSchema>>([
  'delete-chat',
  'community-group-create',
  'dismantle-community'
]);

const exclusionsSchema = z.object({
  bot: z.boolean(),
  requester: z.boolean(),
  protectedOwners: z.boolean(),
  superAdmins: z.boolean()
}).strict();

const participantPreviewInputSchema = z.object({
  filter: participantFilterSchema,
  userWids: z.array(widSchema).max(250).optional(),
  fanout: fanoutSchema,
  groupWids: z.array(widSchema).max(50).optional(),
  exclude: exclusionsSchema
}).strict();

const participantExecuteInputSchema = z.object({
  action: participantActionSchema,
  fanout: fanoutSchema,
  targets: z.array(z.object({
    groupWid: widSchema,
    userWids: z.array(widSchema).min(1).max(250)
  }).strict()).min(1).max(50),
  reason: z.string().min(1).max(500).optional(),
  exclude: exclusionsSchema
}).strict();

const groupExecuteInputSchema = z.object({
  action: groupActionSchema,
  fanout: fanoutSchema,
  groupWids: z.array(widSchema).max(50).optional(),
  text: z.string().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
  durationSeconds: z.number().int().nonnegative().max(7776000).optional(),
  reason: z.string().min(1).max(500).optional()
}).strict();

const participantOutputSchema = z.object({
  wid: z.string(),
  displayName: z.string().optional(),
  isAdmin: z.boolean(),
  isSuperAdmin: z.boolean()
}).strict();

const exclusionOutputSchema = z.object({
  wid: z.string(),
  displayName: z.string().optional(),
  reason: z.string()
}).strict();

const participantGroupOutputSchema = z.object({
  groupWid: z.string(),
  label: z.string().optional(),
  participantCount: z.number().int().nonnegative(),
  selected: z.array(participantOutputSchema),
  excluded: z.array(exclusionOutputSchema),
  missingWids: z.array(z.string())
}).strict();

const previewOutputSchema = z.object({
  text: z.string(),
  totalSelected: z.number().int().nonnegative(),
  totalExcluded: z.number().int().nonnegative(),
  groups: z.array(participantGroupOutputSchema),
  warnings: z.array(z.string())
}).strict();

const executeOutputSchema = z.object({
  applied: z.boolean(),
  text: z.string(),
  actionCount: z.number().int().nonnegative(),
  groups: z.array(z.object({
    groupWid: z.string(),
    label: z.string().optional(),
    userWids: z.array(z.string())
  }).strict()),
  warnings: z.array(z.string())
}).strict();

type ParticipantPreviewInput = z.infer<typeof participantPreviewInputSchema>;
type ParticipantExecuteInput = z.infer<typeof participantExecuteInputSchema>;
type GroupExecuteInput = z.infer<typeof groupExecuteInputSchema>;
type PreviewOutput = z.infer<typeof previewOutputSchema>;
type ExecuteOutput = z.infer<typeof executeOutputSchema>;

interface ResolvedGroupTarget {
  groupWid: string;
  groupId?: string | undefined;
  label?: string | undefined;
}

interface ParticipantSelection {
  group: ResolvedGroupTarget;
  participantCount: number;
  selected: GroupParticipant[];
  selectedIdentityIds: string[];
  requestedIdentityIds: string[];
  excluded: Array<{ participant: GroupParticipant; reason: string }>;
  missingWids: string[];
}

export function registerDoasAssistantTools(context: PluginCommandContext): AssistantTool[] {
  return [
    participantsPreviewTool(context),
    participantExecuteTool(context),
    groupExecuteTool(context)
  ];
}

function participantsPreviewTool(
  pluginContext: PluginCommandContext
): AssistantTool<ParticipantPreviewInput, PreviewOutput> {
  return {
    descriptor: {
      name: 'official.community-admin.participants.preview',
      description: 'List group participants or preview exact participant targets for DoAS actions, with admin/member filters and bot/requester/owner/super-admin exclusions.',
      pluginId: DOAS_PLUGIN_ID,
      permission: DOAS_PERMISSIONS.inspect,
      inputSchema: participantPreviewInputJsonSchema(),
      outputSchema: previewOutputJsonSchema(),
      mutation: 'none',
      dangerous: false,
      approval: 'never'
    },
    inputSchema: participantPreviewInputSchema,
    outputSchema: previewOutputSchema,
    async run(toolContext, input) {
      throwIfAborted(toolContext.signal);
      const groups = await resolveGroups(pluginContext, toolContext, input.fanout, input.groupWids);
      throwIfAborted(toolContext.signal);
      const selection = await selectParticipants(pluginContext, toolContext, groups.targets, input, actionEligibilityForFilter(input.filter));
      throwIfAborted(toolContext.signal);
      return { content: previewContent(toolContext, selection, groups.warnings) };
    }
  };
}

function participantExecuteTool(
  pluginContext: PluginCommandContext
): AssistantTool<ParticipantExecuteInput, ExecuteOutput> {
  return {
    descriptor: {
      name: 'official.community-admin.participants.execute',
      description: 'Execute exact participant DoAS actions after a preview: approve, reject, add, promote, demote, or remove specified WIDs. Revalidates destructive current-member actions before returning audited group actions.',
      pluginId: DOAS_PLUGIN_ID,
      inputSchema: participantExecuteInputJsonSchema(),
      outputSchema: executeOutputJsonSchema(),
      mutation: 'durable',
      dangerous: true,
      approval: 'always'
    },
    inputSchema: participantExecuteInputSchema,
    outputSchema: executeOutputSchema,
    requiresApproval: (toolContext, input) => dynamicPermissionAllowed(pluginContext, toolContext, permissionForParticipantAction(input.action)),
    async run(toolContext, input) {
      throwIfAborted(toolContext.signal);
      const permission = await dynamicPermission(pluginContext, toolContext, permissionForParticipantAction(input.action));
      throwIfAborted(toolContext.signal);
      if (!permission.allowed) {
        return { content: emptyExecution(t(toolContext, 'official.community-admin.actions.toolPermissionDenied', {
          action: permission.action,
          reasons: permission.reasons.join('; ')
        }, `Permission denied for ${permission.action}: ${permission.reasons.join('; ')}`)) };
      }
      const config = parseDoasConfig(await pluginContext.configFor?.(
        toolContext.scopeId,
        requireStableIdentityAddress(toolContext.actor).identityId
      ) ?? {});
      throwIfAborted(toolContext.signal);
      if (!config.enabled) {
        return { content: emptyExecution(t(toolContext, 'official.community-admin.actions.toolDisabled', {
          scopeId: toolContext.scopeId
        }, `DoAS is disabled for scope ${toolContext.scopeId}.`)) };
      }
      const protectedBotTarget = await destructiveBotTarget(pluginContext, input.action, input.targets);
      throwIfAborted(toolContext.signal);
      if (protectedBotTarget) {
        return { content: emptyExecution(t(toolContext, 'official.community-admin.actions.toolProtectedSession', {
          action: input.action,
          target: protectedBotTarget
        }, `Refusing to ${input.action} the WhatsApp session ${protectedBotTarget}.`)) };
      }
      const requestedGroupWids = input.targets.map((target) => target.groupWid);
      const groups = await resolveGroups(pluginContext, toolContext, input.fanout, requestedGroupWids);
      throwIfAborted(toolContext.signal);
      if (!participantActionNeedsCurrentMember(input.action)) {
        const actions = input.targets.flatMap((target) =>
          target.userWids.map((userWid) => participantAction(input.action, target.groupWid, userWid, input.reason))
        );
        return {
          content: {
            applied: true,
            text: t(toolContext, 'official.community-admin.actions.toolQueuedActions', {
              count: String(actions.length),
              action: input.action
            }, `Queued ${actions.length} ${input.action} action(s).`),
            actionCount: actions.length,
            groups: input.targets.map((target) => ({
              groupWid: target.groupWid,
              userWids: target.userWids
            })),
            warnings: groups.warnings
          },
          pluginActions: actions
        };
      }
      const explicitWidsByGroup = new Map(input.targets.map((target) => [target.groupWid, new Set(target.userWids)]));
      const selection = await selectParticipants(pluginContext, toolContext, groups.targets, {
        filter: 'explicit',
        userWids: [...new Set(input.targets.flatMap((target) => target.userWids))],
        exclude: input.exclude
      }, actionEligibilityForParticipantAction(input.action), explicitWidsByGroup);
      throwIfAborted(toolContext.signal);
      const mismatch = exactTargetMismatch(input.targets, selection);
      if (mismatch) {
        return { content: emptyExecution(t(toolContext, 'official.community-admin.actions.toolTargetChanged', {
          reason: mismatch
        }, `Target set changed since preview: ${mismatch}. Preview again before executing.`)) };
      }
      const actions = selection.flatMap((entry) =>
        entry.selected.map((participant) => participantAction(input.action, entry.group.groupWid, participant.wid, input.reason))
      );
      return {
        content: executionContent(toolContext, input.action, selection, actions.length, groups.warnings, true),
        pluginActions: actions
      };
    }
  };
}

async function destructiveBotTarget(
  pluginContext: PluginCommandContext,
  action: z.infer<typeof participantActionSchema>,
  targets: ParticipantExecuteInput['targets']
): Promise<string | undefined> {
  if (!destructiveBotTargetParticipantActions.has(action)) {
    return undefined;
  }
  const botWid = await pluginContext.getCurrentBotWid?.();
  if (!botWid) {
    return undefined;
  }
  const botIdentityId = await authoritativeIdentityIdForWid(pluginContext, botWid);
  for (const target of targets) {
    for (const userWid of target.userWids) {
      if (await authoritativeIdentityIdForWid(pluginContext, userWid) === botIdentityId) {
        return userWid;
      }
    }
  }
  return undefined;
}

function groupExecuteTool(
  pluginContext: PluginCommandContext
): AssistantTool<GroupExecuteInput, ExecuteOutput> {
  return {
    descriptor: {
      name: 'official.community-admin.group.execute',
      description: 'Execute group-level DoAS actions such as locks, invite revocation, subject, description, admission settings, retention, reporting, picture clear, delete-chat, or community group-add settings across the current group or configured community fan-out.',
      pluginId: DOAS_PLUGIN_ID,
      inputSchema: groupExecuteInputJsonSchema(),
      outputSchema: executeOutputJsonSchema(),
      mutation: 'durable',
      dangerous: true,
      approval: 'always'
    },
    inputSchema: groupExecuteInputSchema,
    outputSchema: executeOutputSchema,
    requiresApproval: (toolContext, input) => dynamicPermissionAllowed(pluginContext, toolContext, permissionForGroupAction(input.action)),
    async run(toolContext, input) {
      throwIfAborted(toolContext.signal);
      const permission = await dynamicPermission(pluginContext, toolContext, permissionForGroupAction(input.action));
      throwIfAborted(toolContext.signal);
      if (!permission.allowed) {
        return { content: emptyExecution(t(toolContext, 'official.community-admin.actions.toolPermissionDenied', {
          action: permission.action,
          reasons: permission.reasons.join('; ')
        }, `Permission denied for ${permission.action}: ${permission.reasons.join('; ')}`)) };
      }
      const config = parseDoasConfig(await pluginContext.configFor?.(
        toolContext.scopeId,
        requireStableIdentityAddress(toolContext.actor).identityId
      ) ?? {});
      throwIfAborted(toolContext.signal);
      if (!config.enabled) {
        return { content: emptyExecution(t(toolContext, 'official.community-admin.actions.toolDisabled', {
          scopeId: toolContext.scopeId
        }, `DoAS is disabled for scope ${toolContext.scopeId}.`)) };
      }
      if ((input.action === 'send' || input.action === 'subject' || input.action === 'description') && !input.text) {
        return { content: emptyExecution(t(toolContext, 'official.community-admin.actions.toolTextRequired', {
          action: input.action
        }, `Action ${input.action} requires text.`)) };
      }
      if (booleanGroupAction(input.action) && input.enabled === undefined) {
        return { content: emptyExecution(t(toolContext, 'official.community-admin.actions.toolTextRequired', {
          action: input.action
        }, `Action ${input.action} requires text.`)) };
      }
      if (input.action === 'disappearing' && input.durationSeconds === undefined) {
        return { content: emptyExecution(t(toolContext, 'official.community-admin.actions.toolTextRequired', {
          action: input.action
        }, `Action ${input.action} requires text.`)) };
      }
      if (input.fanout !== 'none' && groupToolFanoutUnsupportedActions.has(input.action)) {
        return { content: emptyExecution(t(
          toolContext,
          'official.community-admin.actions.fanoutUnsupported',
          {},
          'This action cannot be fanned out.'
        )) };
      }
      const groups = await resolveGroups(pluginContext, toolContext, input.fanout, input.groupWids);
      throwIfAborted(toolContext.signal);
      const parentCommunityWid = await parentCommunityWidForAction(pluginContext, toolContext.scopeId, input.action);
      throwIfAborted(toolContext.signal);
      if (input.action === 'unlink-community' && !parentCommunityWid) {
        return { content: emptyExecution(t(
          toolContext,
          'official.community-admin.actions.toolLinkedParentRequired',
          {},
          'Action unlink-community needs a community-inherited child group target.'
        )) };
      }
      const actions = groups.targets.map((group) => groupAction(input, group.groupWid, parentCommunityWid));
      return {
        content: {
          applied: true,
          text: t(toolContext, 'official.community-admin.actions.toolQueuedGroupActions', {
            action: input.action,
            count: String(groups.targets.length)
          }, `Queued ${input.action} for ${groups.targets.length} group(s).`),
          actionCount: actions.length,
          groups: groups.targets.map((group) => ({
            groupWid: group.groupWid,
            ...(group.label ? { label: group.label } : {}),
            userWids: []
          })),
          warnings: groups.warnings
        },
        pluginActions: actions
      };
    }
  };
}

async function resolveGroups(
  pluginContext: PluginCommandContext,
  toolContext: AssistantToolContext,
  fanout: DoasFanoutMode | 'none',
  requestedGroupWids?: string[] | undefined
): Promise<{ targets: ResolvedGroupTarget[]; warnings: string[] }> {
  throwIfAborted(toolContext.signal);
  const primaryGroupWid = toolContext.groupWid ?? (toolContext.message.context === 'group' ? toolContext.message.chatId : undefined);
  if (!primaryGroupWid) {
    throw new Error('DoAS assistant tools require a managed group target.');
  }

  const config = parseDoasConfig(await pluginContext.configFor?.(
    toolContext.scopeId,
    requireStableIdentityAddress(toolContext.actor).identityId
  ) ?? {});
  throwIfAborted(toolContext.signal);
  let targets: ResolvedGroupTarget[];
  if (fanout === 'none') {
    targets = [{
      groupWid: primaryGroupWid,
      ...(toolContext.groupId ? { groupId: toolContext.groupId } : {}),
      label: primaryGroupWid
    }];
  } else {
    if (!config.fanout.enabled) {
      throw new Error('Community fan-out is disabled for this scope.');
    }
    const permission = await pluginContext.explainPermission?.({
      actorIdentityId: requireStableIdentityAddress(toolContext.actor).identityId,
      action: DOAS_PERMISSIONS.communityFanout,
      scopeId: toolContext.scopeId,
      pluginId: DOAS_PLUGIN_ID,
      ...(toolContext.groupId ? { groupId: toolContext.groupId } : {})
    });
    if (!permission?.allowed) {
      throw new Error(`Community fan-out permission denied: ${permission?.reasons.join('; ') ?? 'unavailable'}`);
    }
    throwIfAborted(toolContext.signal);
    targets = await resolveDoasFanoutTargets({
      rootGroupWid: primaryGroupWid,
      mode: fanout,
      includeParentByDefault: config.fanout.includeParentByDefault,
      context: pluginContext, scopeId: toolContext.scopeId
    });
    throwIfAborted(toolContext.signal);
  }

  const requested = new Set(requestedGroupWids ?? []);
  if (requested.size > 0) {
    const byWid = new Map(targets.map((target) => [target.groupWid, target]));
    const missing = [...requested].filter((groupWid) => !byWid.has(groupWid));
    if (missing.length > 0) {
      throw new Error(`Requested group(s) are not in the assistant DoAS target set: ${missing.join(', ')}`);
    }
    targets = [...requested].map((groupWid) => byWid.get(groupWid)!);
  }

  if (targets.length === 0) {
    throw new Error('No DoAS target groups matched this request.');
  }
  if (targets.length > config.fanout.maxTargets) {
    throw new Error(`DoAS target count ${targets.length} exceeds configured max ${config.fanout.maxTargets}.`);
  }
  return { targets, warnings: config.enabled ? [] : ['DoAS mutations are disabled for this scope.'] };
}

async function selectParticipants(
  pluginContext: PluginCommandContext,
  toolContext: AssistantToolContext,
  groups: ResolvedGroupTarget[],
  input: Pick<ParticipantPreviewInput, 'filter' | 'userWids' | 'exclude'>,
  eligibility: (participant: GroupParticipant) => boolean,
  explicitWidsByGroup?: Map<string, Set<string>> | undefined
): Promise<ParticipantSelection[]> {
  if (!pluginContext.getGroupParticipants) {
    throw new Error('Group participant lookup is unavailable in this runtime.');
  }
  const excludedIdentityIds = await excludedIdentities(pluginContext, toolContext, input.exclude);
  throwIfAborted(toolContext.signal);
  const explicitGlobal = new Set(input.userWids ?? []);

  const result: ParticipantSelection[] = [];
  for (const group of groups) {
    throwIfAborted(toolContext.signal);
    const participants = await pluginContext.getGroupParticipants(group.groupWid);
    throwIfAborted(toolContext.signal);
    const explicitForGroup = explicitWidsByGroup?.get(group.groupWid) ?? explicitGlobal;
    const explicitIdentityIdsByWid = await authoritativeIdentityIdsForWids(pluginContext, explicitForGroup);
    const requestedIdentityIds = [...new Set(explicitIdentityIdsByWid.values())];
    const selected: GroupParticipant[] = [];
    const selectedIdentityIds: string[] = [];
    const excluded: Array<{ participant: GroupParticipant; reason: string }> = [];
    const participantIdentityIds = await Promise.all(participants.map(async (participant) => ({
      participant,
      identityId: await authoritativeIdentityIdForWid(pluginContext, participant.wid)
    })));
    const availableIdentityIds = new Set(participantIdentityIds.map(({ identityId }) => identityId));
    const missingWids = [...explicitForGroup].filter((wid) => {
      const identityId = explicitIdentityIdsByWid.get(wid);
      return !identityId || !availableIdentityIds.has(identityId);
    });

    for (const { participant, identityId } of participantIdentityIds) {
      if (!matchesParticipantFilter(participant, identityId, input.filter, new Set(requestedIdentityIds)) || !eligibility(participant)) {
        continue;
      }
      const exclusion = excludedIdentityIds.get(identityId) ?? (
        input.exclude.superAdmins && participant.isSuperAdmin ? 'super-admin' : undefined
      );
      if (exclusion) {
        excluded.push({ participant, reason: exclusion });
      } else {
        selected.push(participant);
        selectedIdentityIds.push(identityId);
      }
    }
    result.push({
      group,
      participantCount: participants.length,
      selected,
      selectedIdentityIds,
      requestedIdentityIds,
      excluded,
      missingWids
    });
  }
  return result;
}

async function excludedIdentities(
  pluginContext: PluginCommandContext,
  toolContext: AssistantToolContext,
  exclude: z.infer<typeof exclusionsSchema>
): Promise<Map<string, string>> {
  const excluded = new Map<string, string>();
  if (exclude.bot) {
    const botWid = await pluginContext.getCurrentBotWid?.();
    if (botWid) {
      excluded.set(await authoritativeIdentityIdForWid(pluginContext, botWid), 'bot');
    }
  }
  if (exclude.requester) {
    const actorIdentityId = requireStableIdentityAddress(toolContext.actor).identityId;
    excluded.set(actorIdentityId, 'requester');
  }
  if (exclude.protectedOwners) {
    for (const wid of await pluginContext.protectedWidsForActions?.() ?? []) {
      excluded.set(await authoritativeIdentityIdForWid(pluginContext, wid), 'protected-owner');
    }
  }
  return excluded;
}

function matchesParticipantFilter(
  participant: GroupParticipant,
  participantIdentityId: string,
  filter: z.infer<typeof participantFilterSchema>,
  explicitIdentityIds: Set<string>
): boolean {
  if (explicitIdentityIds.size > 0 || filter === 'explicit') {
    return explicitIdentityIds.has(participantIdentityId);
  }
  switch (filter) {
    case 'admins':
      return participant.isAdmin || participant.isSuperAdmin;
    case 'members':
    case 'normal-members':
      return !participant.isAdmin && !participant.isSuperAdmin;
    case 'super-admins':
      return participant.isSuperAdmin;
    case 'all':
      return true;
  }
}

function actionEligibilityForFilter(_filter: z.infer<typeof participantFilterSchema>): (participant: GroupParticipant) => boolean {
  return () => true;
}

function actionEligibilityForParticipantAction(action: z.infer<typeof participantActionSchema>): (participant: GroupParticipant) => boolean {
  switch (action) {
    case 'approve':
    case 'reject':
    case 'add':
      return () => true;
    case 'promote':
      return (participant) => !participant.isAdmin && !participant.isSuperAdmin;
    case 'demote':
      return (participant) => participant.isAdmin || participant.isSuperAdmin;
    case 'remove':
      return () => true;
  }
}

function exactTargetMismatch(expected: ParticipantExecuteInput['targets'], actual: ParticipantSelection[]): string | undefined {
  const actualByGroup = new Map(actual.map((entry) => [entry.group.groupWid, {
    selected: new Set(entry.selectedIdentityIds),
    requested: new Set(entry.requestedIdentityIds)
  }]));
  for (const target of expected) {
    const resolved = actualByGroup.get(target.groupWid);
    const actualIdentityIds = resolved?.selected ?? new Set<string>();
    const expectedIdentityIds = resolved?.requested ?? new Set<string>();
    if (actualIdentityIds.size !== expectedIdentityIds.size) {
      return `${target.groupWid} expected=${target.userWids.join(',')} actual=${actualIdentityIds.size}`;
    }
    for (const identityId of expectedIdentityIds) {
      if (!actualIdentityIds.has(identityId)) {
        return `${target.groupWid} missing authoritative identity ${identityId}`;
      }
    }
  }
  return undefined;
}

async function authoritativeIdentityIdsForWids(
  pluginContext: PluginCommandContext,
  wids: Iterable<string>
): Promise<Map<string, string>> {
  const entries = await Promise.all([...wids].map(async (wid) => [
    wid,
    await authoritativeIdentityIdForWid(pluginContext, wid)
  ] as const));
  return new Map(entries);
}

async function authoritativeIdentityIdForWid(
  pluginContext: PluginCommandContext,
  wid: string
): Promise<string> {
  if (!pluginContext.resolveIdentityAddress) {
    throw new Error('Authoritative identity-address resolution is unavailable.');
  }
  const identityId = (await pluginContext.resolveIdentityAddress(wid)).identityId?.trim();
  if (!identityId) {
    throw new Error(`Authoritative identity is unavailable for ${wid}.`);
  }
  return identityId;
}

function participantAction(
  action: z.infer<typeof participantActionSchema>,
  groupWid: string,
  userWid: string,
  reason?: string | undefined
): PluginAction {
  const actionReason = reason ?? `assistant doas ${action}`;
  switch (action) {
    case 'approve':
      return { type: 'group.approveMembershipRequest', groupWid, userWid, reason: actionReason };
    case 'reject':
      return { type: 'group.rejectMembershipRequest', groupWid, userWid, reason: actionReason };
    case 'add':
      return { type: 'group.addParticipant', groupWid, userWid, reason: actionReason };
    case 'promote':
      return { type: 'group.promoteParticipant', groupWid, userWid, reason: actionReason };
    case 'demote':
      return { type: 'group.demoteParticipant', groupWid, userWid, reason: actionReason };
    case 'remove':
      return { type: 'group.removeParticipant', groupWid, userWid, reason: actionReason };
  }
}

function participantActionNeedsCurrentMember(action: z.infer<typeof participantActionSchema>): boolean {
  return action === 'promote' || action === 'demote' || action === 'remove';
}

async function dynamicPermissionAllowed(
  pluginContext: PluginCommandContext,
  toolContext: AssistantToolContext,
  action: string
): Promise<boolean> {
  return (await dynamicPermission(pluginContext, toolContext, action)).allowed;
}

async function dynamicPermission(
  pluginContext: PluginCommandContext,
  toolContext: AssistantToolContext,
  action: string
): Promise<{ action: string; allowed: boolean; reasons: string[] }> {
  const permission = await pluginContext.explainPermission?.({
    actorIdentityId: requireStableIdentityAddress(toolContext.actor).identityId,
    action,
    scopeId: toolContext.scopeId,
    pluginId: DOAS_PLUGIN_ID,
    ...(toolContext.groupId ? { groupId: toolContext.groupId } : {})
  });
  return {
    action,
    allowed: Boolean(permission?.allowed),
    reasons: permission?.reasons ?? ['Permission explanation is unavailable.']
  };
}

function permissionForParticipantAction(action: z.infer<typeof participantActionSchema>): string {
  switch (action) {
    case 'promote':
    case 'demote':
      return DOAS_PERMISSIONS.admin;
    case 'approve':
    case 'reject':
    case 'add':
    case 'remove':
      return DOAS_PERMISSIONS.membership;
  }
}

function permissionForGroupAction(action: z.infer<typeof groupActionSchema>): string {
  switch (action) {
    case 'delete-chat':
      return DOAS_PERMISSIONS.chatDelete;
    case 'community-group-create':
      return DOAS_PERMISSIONS.communitySettings;
    case 'disappearing':
      return DOAS_PERMISSIONS.retention;
    case 'report-to-admin':
      return DOAS_PERMISSIONS.privacy;
    case 'picture-clear':
      return DOAS_PERMISSIONS.mediaProfile;
    case 'send':
      return DOAS_PERMISSIONS.messageSend;
    case 'unlink-community':
    case 'leave':
    case 'dismantle-group':
    case 'dismantle-community':
      return DOAS_PERMISSIONS.admin;
    case 'subject':
    case 'description':
    case 'info-lock':
    case 'info-unlock':
      return DOAS_PERMISSIONS.profile;
    case 'member-add':
    case 'join-approval':
    case 'revoke-invite':
      return DOAS_PERMISSIONS.privacy;
    case 'lock':
    case 'unlock':
      return DOAS_PERMISSIONS.moderate;
  }
}

async function parentCommunityWidForAction(
  pluginContext: PluginCommandContext,
  scopeId: string,
  action: z.infer<typeof groupActionSchema>
): Promise<string | undefined> {
  return action === 'unlink-community'
    ? pluginContext.communityGroupWidForScope?.(scopeId)
    : undefined;
}

function groupAction(input: GroupExecuteInput, groupWid: string, parentCommunityWid?: string | undefined): PluginAction {
  const reason = input.reason ?? `assistant doas ${input.action}`;
  switch (input.action) {
    case 'lock':
      return { type: 'group.lockMessages', groupWid, reason };
    case 'unlock':
      return { type: 'group.unlockMessages', groupWid, reason };
    case 'send':
      return { type: 'message.sendText', chatId: groupWid, text: input.text! };
    case 'info-lock':
      return { type: 'group.lockInfo', groupWid, reason };
    case 'info-unlock':
      return { type: 'group.unlockInfo', groupWid, reason };
    case 'member-add':
      return { type: 'group.setAddMembersAdminsOnly', groupWid, enabled: input.enabled!, reason };
    case 'join-approval':
      return { type: 'group.setMembershipApprovalMode', groupWid, enabled: input.enabled!, reason };
    case 'disappearing':
      return { type: 'group.setDisappearingMessages', groupWid, durationSeconds: input.durationSeconds!, reason };
    case 'report-to-admin':
      return { type: 'group.setReportToAdminMode', groupWid, enabled: input.enabled!, reason };
    case 'picture-clear':
      return { type: 'group.deletePicture', groupWid, reason };
    case 'revoke-invite':
      return { type: 'group.revokeInvite', groupWid, reason };
    case 'leave':
      return { type: 'group.leave', groupWid, reason };
    case 'delete-chat':
      return { type: 'chat.delete', chatId: groupWid, reason };
    case 'community-group-create':
      return { type: 'community.setGroupCreateEveryoneAllowed', communityWid: groupWid, enabled: input.enabled!, reason };
    case 'dismantle-group':
      return { type: 'group.dismantle', groupWid, reason };
    case 'dismantle-community':
      return { type: 'community.dismantle', groupWid, reason };
    case 'unlink-community':
      if (!parentCommunityWid) {
        throw new Error('Action unlink-community needs a community parent target.');
      }
      return { type: 'community.unlinkGroup', groupWid, parentCommunityWid, reason };
    case 'subject':
      return { type: 'group.setSubject', groupWid, subject: input.text!, reason };
    case 'description':
      return { type: 'group.setDescription', groupWid, description: input.text!, reason };
  }
}

function booleanGroupAction(action: z.infer<typeof groupActionSchema>): boolean {
  return action === 'member-add' ||
    action === 'join-approval' ||
    action === 'report-to-admin' ||
    action === 'community-group-create';
}

function previewContent(toolContext: AssistantToolContext, selection: ParticipantSelection[], warnings: string[]): PreviewOutput {
  const groups = selection.map((entry) => ({
    groupWid: entry.group.groupWid,
    ...(entry.group.label ? { label: entry.group.label } : {}),
    participantCount: entry.participantCount,
    selected: entry.selected.map(participantOutput),
    excluded: entry.excluded.map((excluded) => ({
      ...participantOutput(excluded.participant),
      reason: excluded.reason
    })),
    missingWids: entry.missingWids
  }));
  const totalSelected = groups.reduce((count, group) => count + group.selected.length, 0);
  const totalExcluded = groups.reduce((count, group) => count + group.excluded.length, 0);
  return {
    text: t(toolContext, 'official.community-admin.actions.toolPreview', {
      selected: String(totalSelected),
      groups: String(groups.length),
      excluded: String(totalExcluded)
    }, `Preview selected ${totalSelected} participant(s) across ${groups.length} group(s); excluded ${totalExcluded}.`),
    totalSelected,
    totalExcluded,
    groups,
    warnings
  };
}

function executionContent(
  toolContext: AssistantToolContext,
  action: z.infer<typeof participantActionSchema>,
  selection: ParticipantSelection[],
  actionCount: number,
  warnings: string[],
  applied: boolean
): ExecuteOutput {
  return {
    applied,
    text: applied
      ? t(toolContext, 'official.community-admin.actions.toolExecutionQueued', {
          count: String(actionCount),
          action
        }, `Queued ${actionCount} ${action} action(s).`)
      : t(toolContext, 'official.community-admin.actions.toolExecutionNotQueued', {
          count: String(actionCount),
          action
        }, `Did not queue ${actionCount} ${action} action(s).`),
    actionCount,
    groups: selection.map((entry) => ({
      groupWid: entry.group.groupWid,
      ...(entry.group.label ? { label: entry.group.label } : {}),
      userWids: entry.selected.map((participant) => participant.wid)
    })),
    warnings
  };
}

function t(
  toolContext: AssistantToolContext,
  key: string,
  params: Record<string, string | number | boolean | Date | null | undefined>,
  fallback: string
): string {
  return toolContext.translate?.(key, params) ?? fallback;
}

function emptyExecution(text: string): ExecuteOutput {
  return {
    applied: false,
    text,
    actionCount: 0,
    groups: [],
    warnings: []
  };
}

function participantOutput(participant: GroupParticipant): z.infer<typeof participantOutputSchema> {
  return {
    wid: participant.wid,
    ...(participant.displayName ? { displayName: participant.displayName } : {}),
    isAdmin: participant.isAdmin,
    isSuperAdmin: participant.isSuperAdmin
  };
}

function participantPreviewInputJsonSchema(): Record<string, unknown> {
  return jsonSchemaForZodObject({
    filter: { enum: ['all', 'admins', 'members', 'normal-members', 'super-admins', 'explicit'] },
    userWids: { type: 'array', maxItems: 250, items: { type: 'string', minLength: 3, maxLength: 160 } },
    fanout: { enum: ['none', 'children', 'all'] },
    groupWids: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 3, maxLength: 160 } },
    exclude: exclusionsJsonSchema()
  }, ['filter', 'fanout', 'exclude']);
}

function participantExecuteInputJsonSchema(): Record<string, unknown> {
  return jsonSchemaForZodObject({
    action: { enum: ['approve', 'reject', 'add', 'promote', 'demote', 'remove'] },
    fanout: { enum: ['none', 'children', 'all'] },
    targets: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['groupWid', 'userWids'],
        properties: {
          groupWid: { type: 'string', minLength: 3, maxLength: 160 },
          userWids: { type: 'array', minItems: 1, maxItems: 250, items: { type: 'string', minLength: 3, maxLength: 160 } }
        }
      }
    },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    exclude: exclusionsJsonSchema()
  }, ['action', 'fanout', 'targets', 'exclude']);
}

function groupExecuteInputJsonSchema(): Record<string, unknown> {
  return jsonSchemaForZodObject({
    action: { enum: ['lock', 'unlock', 'info-lock', 'info-unlock', 'revoke-invite', 'unlink-community', 'leave', 'dismantle-group', 'dismantle-community', 'subject', 'description'] },
    fanout: { enum: ['none', 'children', 'all'] },
    groupWids: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 3, maxLength: 160 } },
    text: { type: 'string', minLength: 1, maxLength: 500 },
    reason: { type: 'string', minLength: 1, maxLength: 500 }
  }, ['action', 'fanout']);
}

function exclusionsJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['bot', 'requester', 'protectedOwners', 'superAdmins'],
    properties: {
      bot: { type: 'boolean' },
      requester: { type: 'boolean' },
      protectedOwners: { type: 'boolean' },
      superAdmins: { type: 'boolean' }
    }
  };
}

function previewOutputJsonSchema(): Record<string, unknown> {
  const participant = {
    type: 'object',
    additionalProperties: false,
    required: ['wid', 'isAdmin', 'isSuperAdmin'],
    properties: {
      wid: { type: 'string' },
      displayName: { type: 'string' },
      isAdmin: { type: 'boolean' },
      isSuperAdmin: { type: 'boolean' }
    }
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'totalSelected', 'totalExcluded', 'groups', 'warnings'],
    properties: {
      text: { type: 'string' },
      totalSelected: { type: 'number' },
      totalExcluded: { type: 'number' },
      groups: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['groupWid', 'participantCount', 'selected', 'excluded', 'missingWids'],
          properties: {
            groupWid: { type: 'string' },
            label: { type: 'string' },
            participantCount: { type: 'number' },
            selected: { type: 'array', items: participant },
            excluded: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['wid', 'isAdmin', 'isSuperAdmin', 'reason'],
                properties: {
                  wid: { type: 'string' },
                  displayName: { type: 'string' },
                  isAdmin: { type: 'boolean' },
                  isSuperAdmin: { type: 'boolean' },
                  reason: { type: 'string' }
                }
              }
            },
            missingWids: { type: 'array', items: { type: 'string' } }
          }
        }
      },
      warnings: { type: 'array', items: { type: 'string' } }
    }
  };
}

function executeOutputJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['applied', 'text', 'actionCount', 'groups', 'warnings'],
    properties: {
      applied: { type: 'boolean' },
      text: { type: 'string' },
      actionCount: { type: 'number' },
      groups: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['groupWid', 'userWids'],
          properties: {
            groupWid: { type: 'string' },
            label: { type: 'string' },
            userWids: { type: 'array', items: { type: 'string' } }
          }
        }
      },
      warnings: { type: 'array', items: { type: 'string' } }
    }
  };
}
