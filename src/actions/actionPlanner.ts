import type { PluginAction } from '@wabs/plugin-sdk/actions';
import type { GroupHistoryMessageCount, TransportFile } from '@wabs/plugin-sdk/transport';
import type { DoasConfig } from './config';

export type DoasActionName =
  | 'lock'
  | 'unlock'
  | 'delete'
  | 'pin'
  | 'unpin'
  | 'send'
  | 'send-media'
  | 'send-document'
  | 'approve'
  | 'reject'
  | 'add'
  | 'add-history'
  | 'remove'
  | 'promote'
  | 'demote'
  | 'subject'
  | 'description'
  | 'picture'
  | 'picture-clear'
  | 'info-lock'
  | 'info-unlock'
  | 'member-add'
  | 'join-approval'
  | 'disappearing'
  | 'report-to-admin'
  | 'invite-link'
  | 'revoke-invite'
  | 'unlink-community'
  | 'leave'
  | 'create-group'
  | 'delete-chat'
  | 'create-community'
  | 'create-child-group'
  | 'community-group-create'
  | 'dismantle-group'
  | 'dismantle-community';

export interface DoasExecutionTarget {
  groupWid: string;
  groupId?: string | undefined;
  label?: string | undefined;
}

export interface DoasPlanInput {
  actionName: DoasActionName;
  targets: DoasExecutionTarget[];
  config: DoasConfig;
  confirmed: boolean;
  fanout: boolean;
  userWid?: string | undefined;
  userWids?: string[] | undefined;
  text?: string | undefined;
  messageId?: string | undefined;
  booleanValue?: boolean | undefined;
  durationSeconds?: number | undefined;
  selectedMessageCount?: GroupHistoryMessageCount | undefined;
  autoSendInviteV4?: boolean | undefined;
  file?: TransportFile | undefined;
  title?: string | undefined;
  description?: string | undefined;
  participantWids?: string[] | undefined;
  userIdentityId?: string | undefined;
  botIdentityId?: string | undefined;
  parentCommunityWid?: string | undefined;
}

export type DoasPlanResult =
  | { ok: true; actions: PluginAction[]; actionName: DoasActionName; targetCount: number }
  | { ok: false; reason: DoasPlanRejection };

export type DoasPlanRejection =
  | 'confirm-required'
  | 'group-target-required'
  | 'user-required'
  | 'users-required'
  | 'text-required'
  | 'value-required'
  | 'invalid-value'
  | 'file-required'
  | 'delete-reply-required'
  | 'pin-reply-required'
  | 'fanout-unsupported'
  | 'bot-target-protected'
  | 'linked-parent-required';

const HIGH_RISK_ACTIONS = new Set<DoasActionName>([
  'remove',
  'promote',
  'demote',
  'add-history',
  'send',
  'send-media',
  'send-document',
  'picture',
  'picture-clear',
  'revoke-invite',
  'unlink-community',
  'leave',
  'create-group',
  'delete-chat',
  'create-community',
  'create-child-group',
  'community-group-create',
  'dismantle-group',
  'dismantle-community'
]);

const FANOUT_UNSUPPORTED_ACTIONS = new Set<DoasActionName>([
  'delete',
  'pin',
  'unpin',
  'approve',
  'reject',
  'add-history',
  'invite-link',
  'create-group',
  'delete-chat',
  'create-community',
  'create-child-group',
  'community-group-create',
  'dismantle-community'
]);

const DESTRUCTIVE_BOT_TARGET_ACTIONS = new Set<DoasActionName>([
  'reject',
  'remove',
  'demote'
]);

export function isDestructiveBotTargetAction(actionName: DoasActionName): boolean {
  return DESTRUCTIVE_BOT_TARGET_ACTIONS.has(actionName);
}

export function planDoasActions(input: DoasPlanInput): DoasPlanResult {
  if (input.targets.length === 0 && !targetlessAction(input.actionName)) {
    return { ok: false, reason: 'group-target-required' };
  }
  if (input.fanout && FANOUT_UNSUPPORTED_ACTIONS.has(input.actionName)) {
    return { ok: false, reason: 'fanout-unsupported' };
  }
  if (requiresConfirmation(input) && !input.confirmed) {
    return { ok: false, reason: 'confirm-required' };
  }

  switch (input.actionName) {
    case 'delete':
      return input.messageId
        ? { ok: true, actionName: input.actionName, targetCount: 1, actions: [{ type: 'message.delete', messageId: input.messageId, reason: input.text || 'doas delete' }] }
        : { ok: false, reason: 'delete-reply-required' };
    case 'pin':
      return input.messageId && input.durationSeconds
        ? { ok: true, actionName: input.actionName, targetCount: 1, actions: [{ type: 'message.pin', messageId: input.messageId, durationSeconds: input.durationSeconds, reason: input.text || 'doas pin' }] }
        : { ok: false, reason: input.messageId ? 'invalid-value' : 'pin-reply-required' };
    case 'unpin':
      return input.messageId
        ? { ok: true, actionName: input.actionName, targetCount: 1, actions: [{ type: 'message.unpin', messageId: input.messageId, reason: input.text || 'doas unpin' }] }
        : { ok: false, reason: 'pin-reply-required' };
    case 'send':
      if (!input.text) {
        return { ok: false, reason: 'text-required' };
      }
      return planGroupActions(input, (target) => ({
        type: 'message.sendText',
        chatId: target.groupWid,
        text: input.text!
      }));
    case 'send-media':
      if (!input.file) {
        return { ok: false, reason: 'file-required' };
      }
      return planGroupActions(input, (target) => ({
        type: 'message.sendMedia',
        chatId: target.groupWid,
        file: input.file!,
        ...(input.text ? { caption: input.text } : {})
      }));
    case 'send-document':
      if (!input.file) {
        return { ok: false, reason: 'file-required' };
      }
      return planGroupActions(input, (target) => ({
        type: 'message.sendDocument',
        chatId: target.groupWid,
        file: input.file!
      }));
    case 'approve':
    case 'reject':
    case 'add':
    case 'remove':
    case 'promote':
    case 'demote':
      if (!input.userWid) {
        return { ok: false, reason: 'user-required' };
      }
      if (isProtectedBotTarget(input)) {
        return { ok: false, reason: 'bot-target-protected' };
      }
      return planGroupActions(input, (target) => membershipAction(input, target, input.userWid!));
    case 'add-history': {
      const userWids = uniqueStrings(input.userWids ?? (input.userWid ? [input.userWid] : []));
      if (userWids.length === 0) {
        return { ok: false, reason: 'users-required' };
      }
      if (!input.selectedMessageCount) {
        return { ok: false, reason: 'invalid-value' };
      }
      return planGroupActions(input, (target) => ({
        type: 'group.addParticipantsWithHistory',
        groupWid: target.groupWid,
        userWids,
        selectedMessageCount: input.selectedMessageCount!,
        ...(input.autoSendInviteV4 !== undefined ? { autoSendInviteV4: input.autoSendInviteV4 } : {}),
        ...(input.text ? { comment: input.text } : {}),
        reason: input.text || 'doas add-history'
      }));
    }
    case 'subject':
    case 'description':
      if (!input.text) {
        return { ok: false, reason: 'text-required' };
      }
      return planGroupActions(input, (target) => profileTextAction(input, target, input.text!));
    case 'picture':
      if (!input.file) {
        return { ok: false, reason: 'file-required' };
      }
      return planGroupActions(input, (target) => ({
        type: 'group.setPicture',
        groupWid: target.groupWid,
        file: input.file!,
        reason: input.text || 'doas picture'
      }));
    case 'picture-clear':
      return planGroupActions(input, (target) => ({
        type: 'group.deletePicture',
        groupWid: target.groupWid,
        reason: input.text || 'doas picture-clear'
      }));
    case 'member-add':
    case 'join-approval':
    case 'report-to-admin':
    case 'community-group-create':
      if (input.booleanValue === undefined) {
        return { ok: false, reason: 'value-required' };
      }
      return planGroupActions(input, (target) => booleanSettingAction(input, target, input.booleanValue!));
    case 'disappearing':
      if (input.durationSeconds === undefined) {
        return { ok: false, reason: 'invalid-value' };
      }
      return planGroupActions(input, (target) => ({
        type: 'group.setDisappearingMessages',
        groupWid: target.groupWid,
        durationSeconds: input.durationSeconds!,
        reason: input.text || 'doas disappearing'
      }));
    case 'create-group':
      if (!input.title) {
        return { ok: false, reason: 'text-required' };
      }
      return {
        ok: true,
        actionName: input.actionName,
        targetCount: 1,
        actions: [{
          type: 'group.create',
          ...(input.config.joinApproval?.policy === 'require' ? { membershipApprovalMode: true } : {}),
          title: input.title,
          participantWids: uniqueStrings(input.participantWids ?? []),
          ...(input.autoSendInviteV4 !== undefined ? { autoSendInviteV4: input.autoSendInviteV4 } : {}),
          reason: input.text || 'doas create-group'
        }]
      };
    case 'delete-chat':
      return planGroupActions(input, (target) => ({
        type: 'chat.delete',
        chatId: target.groupWid,
        reason: input.text || 'doas delete-chat'
      }));
    case 'create-community':
      if (!input.title) {
        return { ok: false, reason: 'text-required' };
      }
      return {
        ok: true,
        actionName: input.actionName,
        targetCount: 1,
        actions: [{
          type: 'community.create',
          title: input.title,
          ...(input.description ? { description: input.description } : {}),
          reason: input.text || 'doas create-community'
        }]
      };
    case 'create-child-group': {
      const parentCommunityWid = input.parentCommunityWid ?? input.targets[0]?.groupWid;
      if (!parentCommunityWid) {
        return { ok: false, reason: 'linked-parent-required' };
      }
      if (!input.title) {
        return { ok: false, reason: 'text-required' };
      }
      return {
        ok: true,
        actionName: input.actionName,
        targetCount: 1,
        actions: [{
          type: 'community.createChildGroup',
          parentCommunityWid,
          title: input.title,
          participantWids: uniqueStrings(input.participantWids ?? []),
          reason: input.text || 'doas create-child-group'
        }]
      };
    }
    case 'unlink-community':
      if (!input.parentCommunityWid) {
        return { ok: false, reason: 'linked-parent-required' };
      }
      return planGroupActions(input, (target) => communityUnlinkAction(input, target, input.parentCommunityWid!));
    case 'dismantle-community':
      return planGroupActions(input, (target) => communityDismantleAction(input, target));
    default:
      return planGroupActions(input, (target) => groupAction(input, target));
  }
}

function targetlessAction(actionName: DoasActionName): boolean {
  return actionName === 'delete' ||
    actionName === 'pin' ||
    actionName === 'unpin' ||
    actionName === 'create-group' ||
    actionName === 'create-community';
}

function isProtectedBotTarget(input: DoasPlanInput): boolean {
  if (!isDestructiveBotTargetAction(input.actionName)) {
    return false;
  }
  if (!input.userIdentityId || !input.botIdentityId) {
    throw new Error('Authoritative target and bot identities are required for destructive administration actions.');
  }
  return input.userIdentityId === input.botIdentityId;
}

function requiresConfirmation(input: DoasPlanInput): boolean {
  return Boolean(input.config.requireConfirmForHighRisk) &&
    (input.fanout || input.targets.length > 1 || HIGH_RISK_ACTIONS.has(input.actionName));
}

function planGroupActions(
  input: DoasPlanInput,
  buildAction: (target: DoasExecutionTarget) => PluginAction
): Extract<DoasPlanResult, { ok: true }> {
  return {
    ok: true,
    actionName: input.actionName,
    targetCount: input.targets.length,
    actions: input.targets.map(buildAction)
  };
}

function groupAction(input: DoasPlanInput, target: DoasExecutionTarget): PluginAction {
  const reason = input.text || `doas ${input.actionName}`;
  switch (input.actionName) {
    case 'lock':
      return { type: 'group.lockMessages', groupWid: target.groupWid, reason };
    case 'unlock':
      return { type: 'group.unlockMessages', groupWid: target.groupWid, reason };
    case 'info-lock':
      return { type: 'group.lockInfo', groupWid: target.groupWid, reason };
    case 'info-unlock':
      return { type: 'group.unlockInfo', groupWid: target.groupWid, reason };
    case 'revoke-invite':
      return { type: 'group.revokeInvite', groupWid: target.groupWid, reason };
    case 'leave':
      return { type: 'group.leave', groupWid: target.groupWid, reason };
    case 'dismantle-group':
      return { type: 'group.dismantle', groupWid: target.groupWid, reason };
    default:
      throw new Error(`Unsupported doas group action: ${input.actionName}`);
  }
}

function communityUnlinkAction(
  input: DoasPlanInput,
  target: DoasExecutionTarget,
  parentCommunityWid: string
): PluginAction {
  return {
    type: 'community.unlinkGroup',
    groupWid: target.groupWid,
    parentCommunityWid,
    reason: input.text || 'doas unlink-community'
  };
}

function communityDismantleAction(input: DoasPlanInput, target: DoasExecutionTarget): PluginAction {
  const reason = input.text || `doas ${input.actionName}`;
  switch (input.actionName) {
    case 'dismantle-community':
      return { type: 'community.dismantle', groupWid: target.groupWid, reason };
    default:
      throw new Error(`Unsupported doas community dismantle action: ${input.actionName}`);
  }
}

function booleanSettingAction(input: DoasPlanInput, target: DoasExecutionTarget, value: boolean): PluginAction {
  const reason = input.text || `doas ${input.actionName}`;
  switch (input.actionName) {
    case 'member-add':
      return { type: 'group.setAddMembersAdminsOnly', groupWid: target.groupWid, enabled: value, reason };
    case 'join-approval':
      return { type: 'group.setMembershipApprovalMode', groupWid: target.groupWid, enabled: value, reason };
    case 'report-to-admin':
      return { type: 'group.setReportToAdminMode', groupWid: target.groupWid, enabled: value, reason };
    case 'community-group-create':
      return { type: 'community.setGroupCreateEveryoneAllowed', communityWid: target.groupWid, enabled: value, reason };
    default:
      throw new Error(`Unsupported doas boolean setting action: ${input.actionName}`);
  }
}

function membershipAction(input: DoasPlanInput, target: DoasExecutionTarget, userWid: string): PluginAction {
  const reason = input.text || `doas ${input.actionName}`;
  switch (input.actionName) {
    case 'approve':
      return { type: 'group.approveMembershipRequest', groupWid: target.groupWid, userWid, reason };
    case 'reject':
      return { type: 'group.rejectMembershipRequest', groupWid: target.groupWid, userWid, reason };
    case 'add':
      return { type: 'group.addParticipant', groupWid: target.groupWid, userWid, reason };
    case 'remove':
      return { type: 'group.removeParticipant', groupWid: target.groupWid, userWid, reason };
    case 'promote':
      return { type: 'group.promoteParticipant', groupWid: target.groupWid, userWid, reason };
    case 'demote':
      return { type: 'group.demoteParticipant', groupWid: target.groupWid, userWid, reason };
    default:
      throw new Error(`Unsupported doas membership action: ${input.actionName}`);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function profileTextAction(input: DoasPlanInput, target: DoasExecutionTarget, text: string): PluginAction {
  switch (input.actionName) {
    case 'subject':
      return { type: 'group.setSubject', groupWid: target.groupWid, subject: text, reason: 'doas subject' };
    case 'description':
      return { type: 'group.setDescription', groupWid: target.groupWid, description: text, reason: 'doas description' };
    default:
      throw new Error(`Unsupported doas profile text action: ${input.actionName}`);
  }
}
