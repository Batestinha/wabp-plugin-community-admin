import { withMessageSlot } from '../messageSlot';
import { protectiveTarget } from '../authority';
import type { CommandMetadata, CommandTargetSpec } from '@wabs/plugin-sdk/command-metadata';
import type { CommandContext } from '@wabs/plugin-sdk/commands';
import type { ManagedGroupCommandContext as PluginCommandContext } from '@wabs/plugin-sdk/managed-group-plugin';
import type { GroupCapabilities, GroupHistoryMessageCount, TransportFile } from '@wabs/plugin-sdk/transport';
import { requireStableIdentityAddress } from '@wabs/plugin-sdk/message-actor';
import { requirePluginStateContext } from '@wabs/plugin-sdk/stateful-plugin';
import { requireScopeId } from '@wabs/plugin-sdk/commands';
import { isDestructiveBotTargetAction, planDoasActions, type DoasActionName, type DoasExecutionTarget, type DoasPlanRejection } from './actionPlanner';
import { parseDoasConfig, type DoasConfig } from './config';
import { DOAS_PERMISSIONS, DOAS_PLUGIN_ID } from './manifest';
import { resolveDoasFanoutTargets, type DoasFanoutMode } from './targetResolver';

const CHAT_TARGET: CommandTargetSpec = {
  kind: 'group',
  name: 'chat',
  flag: 'chat'
};

const SCOPE_TARGET: CommandTargetSpec = {
  kind: 'scope',
  flag: ['scope', 'scope-id'],
  fallback: 'current_scope'
};

export const DOAS_ACTIONS = [
  'lock',
  'unlock',
  'delete',
  'pin',
  'unpin',
  'send',
  'send-media',
  'send-document',
  'approve',
  'reject',
  'add',
  'add-history',
  'remove',
  'promote',
  'demote',
  'subject',
  'description',
  'picture',
  'picture-clear',
  'info-lock',
  'info-unlock',
  'member-add',
  'join-approval',
  'disappearing',
  'report-to-admin',
  'send-history',
  'history-share',
  'invite-link',
  'revoke-invite',
  'unlink-community',
  'leave',
  'create-group',
  'delete-chat',
  'create-community',
  'create-child-group',
  'community-group-create',
  'community-member-add',
  'dismantle-group',
  'dismantle-community'
] as const satisfies readonly DoasActionName[];

export type DoasHelpTopic =
  | 'messages'
  | 'members'
  | 'settings'
  | 'invites'
  | 'communities'
  | 'lifecycle';

export type DoasCommandName = 'status' | DoasActionName;

export interface DoasCommandMetadata {
  topic: DoasHelpTopic;
  usage: string;
  descriptionKey: string;
  exampleKey: string;
  mutation: CommandMetadata['mutation'];
  dangerous: boolean;
  requiresManagedGroup: boolean;
}

export const DOAS_COMMAND_METADATA = {
  status: {
    topic: 'settings',
    usage: '/admin status [--chat <group>]',
    descriptionKey: 'official.community-admin.actions.help.status.description',
    exampleKey: 'official.community-admin.actions.help.status.example',
    mutation: 'none',
    dangerous: false,
    requiresManagedGroup: true
  },
  lock: {
    topic: 'messages',
    usage: '/admin lock [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.lock.description',
    exampleKey: 'official.community-admin.actions.help.lock.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  unlock: {
    topic: 'messages',
    usage: '/admin unlock [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.unlock.description',
    exampleKey: 'official.community-admin.actions.help.unlock.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  delete: {
    topic: 'messages',
    usage: '/admin delete [reason] [--chat <group>]',
    descriptionKey: 'official.community-admin.actions.help.delete.description',
    exampleKey: 'official.community-admin.actions.help.delete.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  pin: {
    topic: 'messages',
    usage: '/admin pin [24h|7d|30d] [reason] [--chat <group>]',
    descriptionKey: 'official.community-admin.actions.help.pin.description',
    exampleKey: 'official.community-admin.actions.help.pin.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  unpin: {
    topic: 'messages',
    usage: '/admin unpin [reason] [--chat <group>]',
    descriptionKey: 'official.community-admin.actions.help.unpin.description',
    exampleKey: 'official.community-admin.actions.help.unpin.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  send: {
    topic: 'messages',
    usage: '/admin send <text> [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.send.description',
    exampleKey: 'official.community-admin.actions.help.send.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'send-media': {
    topic: 'messages',
    usage: '/admin send-media <media-path> [caption] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.send-media.description',
    exampleKey: 'official.community-admin.actions.help.send-media.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'send-document': {
    topic: 'messages',
    usage: '/admin send-document <document-path> [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.send-document.description',
    exampleKey: 'official.community-admin.actions.help.send-document.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  approve: {
    topic: 'members',
    usage: '/admin approve @person [reason] [--chat <group>]',
    descriptionKey: 'official.community-admin.actions.help.approve.description',
    exampleKey: 'official.community-admin.actions.help.approve.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  reject: {
    topic: 'members',
    usage: '/admin reject @person [reason] [--chat <group>]',
    descriptionKey: 'official.community-admin.actions.help.reject.description',
    exampleKey: 'official.community-admin.actions.help.reject.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  add: {
    topic: 'members',
    usage: '/admin add @person [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.add.description',
    exampleKey: 'official.community-admin.actions.help.add.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'add-history': {
    topic: 'members',
    usage: '/admin add-history @person [@person ...] [--history 25|50|100] [--invite|--no-invite] [--comment <text>] [--chat <group>] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.add-history.description',
    exampleKey: 'official.community-admin.actions.help.add-history.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  remove: {
    topic: 'members',
    usage: '/admin remove @person [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.remove.description',
    exampleKey: 'official.community-admin.actions.help.remove.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  promote: {
    topic: 'members',
    usage: '/admin promote @person [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.promote.description',
    exampleKey: 'official.community-admin.actions.help.promote.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  demote: {
    topic: 'members',
    usage: '/admin demote @person [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.demote.description',
    exampleKey: 'official.community-admin.actions.help.demote.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  subject: {
    topic: 'settings',
    usage: '/admin title <text> [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.subject.description',
    exampleKey: 'official.community-admin.actions.help.subject.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  description: {
    topic: 'settings',
    usage: '/admin description <text> [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.description.description',
    exampleKey: 'official.community-admin.actions.help.description.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  picture: {
    topic: 'settings',
    usage: '/admin picture <image-path> [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.picture.description',
    exampleKey: 'official.community-admin.actions.help.picture.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'picture-clear': {
    topic: 'settings',
    usage: '/admin picture-clear [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.picture-clear.description',
    exampleKey: 'official.community-admin.actions.help.picture-clear.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'info-lock': {
    topic: 'settings',
    usage: '/admin info-lock [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.info-lock.description',
    exampleKey: 'official.community-admin.actions.help.info-lock.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'info-unlock': {
    topic: 'settings',
    usage: '/admin info-unlock [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.info-unlock.description',
    exampleKey: 'official.community-admin.actions.help.info-unlock.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'member-add': {
    topic: 'members',
    usage: '/admin member-add admins|all [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.member-add.description',
    exampleKey: 'official.community-admin.actions.help.member-add.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'join-approval': {
    topic: 'members',
    usage: '/admin join-approval on|off [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.join-approval.description',
    exampleKey: 'official.community-admin.actions.help.join-approval.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  disappearing: {
    topic: 'settings',
    usage: '/admin disappearing off|24h|7d|90d [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.disappearing.description',
    exampleKey: 'official.community-admin.actions.help.disappearing.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'report-to-admin': {
    topic: 'settings',
    usage: '/admin report-to-admin on|off [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.report-to-admin.description',
    exampleKey: 'official.community-admin.actions.help.report-to-admin.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'send-history': {
    topic: 'members',
    usage: '/admin send-history @person [@person ...] [--history 25|50|100] [--comment <text>] [--chat <group>] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.send-history.description',
    exampleKey: 'official.community-admin.actions.help.send-history.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'history-share': {
    topic: 'settings',
    usage: '/admin history-share all|admins [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.history-share.description',
    exampleKey: 'official.community-admin.actions.help.history-share.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'invite-link': {
    topic: 'invites',
    usage: '/admin invite-link [--chat <group>]',
    descriptionKey: 'official.community-admin.actions.help.invite-link.description',
    exampleKey: 'official.community-admin.actions.help.invite-link.example',
    mutation: 'none',
    dangerous: false,
    requiresManagedGroup: true
  },
  'revoke-invite': {
    topic: 'invites',
    usage: '/admin revoke-invite [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.revoke-invite.description',
    exampleKey: 'official.community-admin.actions.help.revoke-invite.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'unlink-community': {
    topic: 'communities',
    usage: '/admin unlink-community [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.unlink-community.description',
    exampleKey: 'official.community-admin.actions.help.unlink-community.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  leave: {
    topic: 'lifecycle',
    usage: '/admin leave [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.leave.description',
    exampleKey: 'official.community-admin.actions.help.leave.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'create-group': {
    topic: 'lifecycle',
    usage: '/admin create-group --title <title> [--members <person,...>] [--invite|--no-invite] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.create-group.description',
    exampleKey: 'official.community-admin.actions.help.create-group.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: false
  },
  'delete-chat': {
    topic: 'lifecycle',
    usage: '/admin delete-chat [reason] [--chat <group>] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.delete-chat.description',
    exampleKey: 'official.community-admin.actions.help.delete-chat.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'create-community': {
    topic: 'communities',
    usage: '/admin create-community --title <title> [--description <text>] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.create-community.description',
    exampleKey: 'official.community-admin.actions.help.create-community.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: false
  },
  'create-child-group': {
    topic: 'communities',
    usage: '/admin subgroup --title <title> [--members <person,...>] [--chat <community>] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.create-child-group.description',
    exampleKey: 'official.community-admin.actions.help.create-child-group.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'community-group-create': {
    topic: 'communities',
    usage: '/admin community-group-create everyone|admins [reason] [--chat <community>] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.community-group-create.description',
    exampleKey: 'official.community-admin.actions.help.community-group-create.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'community-member-add': {
    topic: 'communities',
    usage: '/admin community-member-add everyone|admins [reason] [--chat <community>] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.community-member-add.description',
    exampleKey: 'official.community-admin.actions.help.community-member-add.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'dismantle-group': {
    topic: 'lifecycle',
    usage: '/admin dismantle-group [reason] [--chat <group>] [--fanout children|all] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.dismantle-group.description',
    exampleKey: 'official.community-admin.actions.help.dismantle-group.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  },
  'dismantle-community': {
    topic: 'communities',
    usage: '/admin dismantle-community [reason] [--chat <community>] [--confirm]',
    descriptionKey: 'official.community-admin.actions.help.dismantle-community.description',
    exampleKey: 'official.community-admin.actions.help.dismantle-community.example',
    mutation: 'durable',
    dangerous: true,
    requiresManagedGroup: true
  }
} as const satisfies Record<DoasCommandName, DoasCommandMetadata>;

const MEMBERSHIP_ACTIONS = new Set<DoasActionName>(['approve', 'reject', 'add', 'add-history', 'send-history', 'remove']);
const ADMIN_ACTIONS = new Set<DoasActionName>(['promote', 'demote']);
const PROFILE_ACTIONS = new Set<DoasActionName>(['subject', 'description', 'info-lock', 'info-unlock']);
const MESSAGE_PIN_ACTIONS = new Set<DoasActionName>(['pin', 'unpin']);
const MESSAGE_SEND_ACTIONS = new Set<DoasActionName>(['send', 'send-media', 'send-document']);
const RETENTION_ACTIONS = new Set<DoasActionName>(['disappearing']);
const PRIVACY_ACTIONS = new Set<DoasActionName>(['report-to-admin', 'history-share', 'member-add', 'join-approval', 'revoke-invite']);
const MEDIA_PROFILE_ACTIONS = new Set<DoasActionName>(['picture', 'picture-clear']);
const COMMUNITY_ACTIONS = new Set<DoasActionName>([
  'unlink-community',
  'community-group-create',
  'community-member-add',
  'dismantle-community'
]);
const ADMIN_LIFECYCLE_ACTIONS = new Set<DoasActionName>(['leave', 'dismantle-group', 'delete-chat']);

interface ParsedDoasArgs {
  args: string[];
  confirmed: boolean;
  fanout?: DoasFanoutMode | undefined;
  invalidFanout?: string | undefined;
}

type TargetResolution =
  | { ok: true; targets: DoasExecutionTarget[]; fanout: boolean }
  | { ok: false; reason: 'fanout-disabled' | 'fanout-permission-denied' | 'fanout-no-targets' | 'fanout-too-many'; count?: number | undefined; limit?: number | undefined };

interface DoasActionInput {
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
}

export function registerDoasCommands(context: PluginCommandContext): void {
  const runtime = requirePluginStateContext(context);
  const router = context.router;

  for (const actionName of DOAS_ACTIONS) {
    if (['lock', 'unlock', 'subject', 'description', 'pin', 'unpin'].includes(actionName)) continue;
    const actionMeta = DOAS_COMMAND_METADATA[actionName];
    router.register('admin', actionName === 'create-child-group' ? 'subgroup' : actionName, doasCommand(permissionForAction(actionName), actionName), async (ctx) => {
      if (ctx.message.context === 'group' && ctx.targets?.chat?.source === 'flag') {
        return { handled: true, text: ctx.t('official.community-admin.actions.groupChatFlagPrivateOnly'), ...withMessageSlot('official.community-admin.actions.groupChatFlagPrivateOnly') };
      }

      const scopeId = requireScopeId(ctx);
      const config = parseDoasConfig(await runtime.configFor(scopeId, doasCommandIdentityId(ctx)));
      if (!config.enabled) {
        return { handled: true, text: ctx.t('official.community-admin.actions.disabled'), ...withMessageSlot('official.community-admin.actions.disabled') };
      }

      const parsed = parseDoasArgs(effectiveArgs(ctx));
      if (parsed.invalidFanout) {
        return {
          handled: true,
          text: ctx.t('official.community-admin.actions.help.usage', { usage: actionMeta.usage }), ...withMessageSlot('official.community-admin.actions.help.usage')
        };
      }
      const primary = primaryTarget(ctx);
      if (!primary && actionRequiresPrimaryTarget(actionName)) {
        return { handled: true, text: ctx.t('official.community-admin.actions.groupTargetRequired'), ...withMessageSlot('official.community-admin.actions.groupTargetRequired') };
      }

      const targetResolution = primary
        ? await resolveTargets({
            context,
            commandContext: ctx,
            config,
            primary,
            requestedFanout: parsed.fanout,
            scopeId
          })
        : { ok: true as const, targets: [], fanout: false };
      if (!targetResolution.ok) {
        return { handled: true, text: targetResolutionText(ctx, targetResolution) };
      }

      if (actionName === 'invite-link') {
        const groupWid = targetResolution.targets[0]?.groupWid ?? primary?.groupWid;
        if (!groupWid) {
          return { handled: true, text: ctx.t('official.community-admin.actions.groupTargetRequired'), ...withMessageSlot('official.community-admin.actions.groupTargetRequired') };
        }
        const inviteCode = await context.getGroupInviteCode?.(groupWid);
        if (!inviteCode) {
          return { handled: true, text: ctx.t('official.community-admin.actions.inviteLinkUnavailable'), ...withMessageSlot('official.community-admin.actions.inviteLinkUnavailable') };
        }
        const inviteLink = inviteCode.startsWith('http')
          ? inviteCode
          : `https://chat.whatsapp.com/${inviteCode}`;
        return {
          handled: true,
          text: ctx.t('official.community-admin.actions.inviteLink', { inviteLink }), ...withMessageSlot('official.community-admin.actions.inviteLink')
        };
      }

      const actionInput = actionInputFor(ctx, actionName, parsed.args);
      if (actionInput.userWid && ['remove', 'demote', 'reject'].includes(actionName)) {
        const member = await context.resolveIdentityAddress?.(actionInput.userWid);
        if (!member || await protectiveTarget(context, scopeId, doasCommandIdentityId(ctx), member.identityId)) {
          return { handled: true, text: ctx.t('official.community-admin.protectedMember'), ...withMessageSlot('official.community-admin.protectedMember') };
        }
      }
      const botProtection = await botProtectionInput(context, actionName, actionInput.userWid);
      const plan = planDoasActions({
        actionName,
        targets: targetResolution.targets,
        config,
        confirmed: parsed.confirmed,
        fanout: targetResolution.fanout,
        ...botProtection,
        ...(await parentCommunityInput(context, scopeId, actionName)),
        ...actionInput
      });
      if (!plan.ok) {
        return { handled: true, text: rejectionText(ctx, plan.reason) };
      }

      return {
        handled: true,
        text: ctx.t('official.community-admin.actions.planned', {
          action: actionName,
          count: String(plan.targetCount)
        }), ...withMessageSlot('official.community-admin.actions.planned'),
        pluginActions: plan.actions
      };
    });
  }
}

function doasCommand(permission: string, commandName: DoasCommandName): CommandMetadata {
  const commandMetadata = DOAS_COMMAND_METADATA[commandName];
  const { mutation, requiresManagedGroup } = commandMetadata;
  return {
    plane: 'group_operation',
    interaction: 'either_same_chat',
    pluginId: DOAS_PLUGIN_ID,
    permission,
    requiresManagedGroup,
    ...(requiresManagedGroup ? {
      privateManagedTarget: {
        mode: 'infer_group_or_community',
        explicitTargetName: 'chat',
        collapseCommunities: true
      }
    } : {}),
    targets: [CHAT_TARGET, SCOPE_TARGET],
    requiredBotCapabilities: requiredBotCapabilitiesFor(commandName),
    mutation,
    auditAction: `doas.${commandName}`,
    dangerous: commandMetadata.dangerous,
    assistant: {
      intentTags: ['doas', commandName],
      executable: true,
      requiresConfirmation: mutation !== 'none' || commandMetadata.dangerous
    },
    help: {
      familyKey: 'official.community-admin.actions.help.family',
      featureId: 'community-admin',
      topicId: commandMetadata.topic,
      descriptionKey: commandMetadata.descriptionKey,
      usage: commandMetadata.usage,
      exampleKeys: [commandMetadata.exampleKey],
      aliases: commandName === 'remove' ? ['kick'] : [],
      keywords: ['doas', commandMetadata.topic, commandName],
      ...(commandName === 'status' ? {} : { requiredConfigBooleanPath: 'enabled' })
    }
  };
}

function requiredBotCapabilitiesFor(commandName: DoasCommandName): Array<keyof GroupCapabilities> {
  switch (commandName) {
    case 'status':
    case 'create-group':
    case 'create-community':
    case 'delete-chat':
      return [];
    case 'send':
    case 'send-media':
    case 'send-document':
      return ['botIsMember', 'canSend'];
    case 'delete':
    case 'pin':
    case 'unpin':
      return ['botIsAdmin', 'canDeleteMessages'];
    case 'approve':
    case 'reject':
    case 'join-approval':
      return ['botIsAdmin', 'canApproveMembers'];
    case 'add':
    case 'add-history':
    case 'member-add':
    case 'create-child-group':
      return ['botIsAdmin', 'canAddMembers'];
    case 'send-history':
      return ['botIsAdmin'];
    case 'remove':
      return ['botIsAdmin', 'canRemoveMembers'];
    case 'promote':
    case 'demote':
      return ['botIsAdmin', 'canPromoteDemote'];
    case 'subject':
      return ['botIsAdmin', 'canChangeInfo', 'canSetSubject'];
    case 'description':
      return ['botIsAdmin', 'canChangeInfo', 'canSetDescription'];
    case 'picture':
    case 'picture-clear':
    case 'info-lock':
    case 'info-unlock':
      return ['botIsAdmin', 'canChangeInfo'];
    case 'invite-link':
    case 'revoke-invite':
      return ['botIsAdmin', 'canManageInvite'];
    case 'lock':
    case 'unlock':
    case 'disappearing':
    case 'report-to-admin':
    case 'history-share':
    case 'community-group-create':
    case 'community-member-add':
    case 'unlink-community':
    case 'leave':
    case 'dismantle-group':
    case 'dismantle-community':
      return ['botIsAdmin'];
  }
}

function permissionForAction(actionName: DoasActionName): string {
  if (ADMIN_ACTIONS.has(actionName)) {
    return DOAS_PERMISSIONS.admin;
  }
  if (MEMBERSHIP_ACTIONS.has(actionName)) {
    return DOAS_PERMISSIONS.membership;
  }
  if (PROFILE_ACTIONS.has(actionName)) {
    return DOAS_PERMISSIONS.profile;
  }
  if (MESSAGE_PIN_ACTIONS.has(actionName)) {
    return DOAS_PERMISSIONS.messagePin;
  }
  if (MESSAGE_SEND_ACTIONS.has(actionName)) {
    return DOAS_PERMISSIONS.messageSend;
  }
  if (RETENTION_ACTIONS.has(actionName)) {
    return DOAS_PERMISSIONS.retention;
  }
  if (PRIVACY_ACTIONS.has(actionName)) {
    return DOAS_PERMISSIONS.privacy;
  }
  if (MEDIA_PROFILE_ACTIONS.has(actionName)) {
    return DOAS_PERMISSIONS.mediaProfile;
  }
  if (actionName === 'invite-link') {
    return DOAS_PERMISSIONS.inviteRead;
  }
  if (actionName === 'create-group') {
    return DOAS_PERMISSIONS.groupCreate;
  }
  if (actionName === 'create-community' || actionName === 'create-child-group') {
    return DOAS_PERMISSIONS.communityCreate;
  }
  if (actionName === 'community-group-create' || actionName === 'community-member-add') {
    return DOAS_PERMISSIONS.communitySettings;
  }
  if (actionName === 'delete-chat') {
    return DOAS_PERMISSIONS.chatDelete;
  }
  if (COMMUNITY_ACTIONS.has(actionName)) {
    return DOAS_PERMISSIONS.admin;
  }
  if (ADMIN_LIFECYCLE_ACTIONS.has(actionName)) {
    return DOAS_PERMISSIONS.admin;
  }
  return DOAS_PERMISSIONS.moderate;
}

function actionRequiresPrimaryTarget(actionName: DoasActionName): boolean {
  return actionName !== 'create-group' && actionName !== 'create-community';
}

async function resolveTargets(input: {
  context: PluginCommandContext;
  commandContext: CommandContext;
  config: DoasConfig;
  primary: DoasExecutionTarget;
  requestedFanout?: DoasFanoutMode | undefined;
  scopeId: string;
}): Promise<TargetResolution> {
  const fanoutMode = input.requestedFanout ?? (
    input.config.fanout.enabled && !input.config.fanout.requireExplicitFlag ? 'children' : undefined
  );
  if (!fanoutMode) {
    return { ok: true, targets: [input.primary], fanout: false };
  }
  if (!input.config.fanout.enabled) {
    return { ok: false, reason: 'fanout-disabled' };
  }

  const fanoutPermission = await input.context.explainPermission?.({
    actorIdentityId: doasCommandIdentityId(input.commandContext),
    action: DOAS_PERMISSIONS.communityFanout,
    scopeId: input.scopeId,
    pluginId: DOAS_PLUGIN_ID,
    ...(input.commandContext.groupId ? { groupId: input.commandContext.groupId } : {})
  });
  if (!fanoutPermission?.allowed) {
    return { ok: false, reason: 'fanout-permission-denied' };
  }

  const targets = await resolveDoasFanoutTargets({
    context: input.context, scopeId: input.scopeId, rootGroupWid: input.primary.groupWid,
    mode: fanoutMode,
    includeParentByDefault: input.config.fanout.includeParentByDefault
  });
  if (targets.length === 0) {
    return { ok: false, reason: 'fanout-no-targets' };
  }
  if (targets.length > input.config.fanout.maxTargets) {
    return {
      ok: false,
      reason: 'fanout-too-many',
      count: targets.length,
      limit: input.config.fanout.maxTargets
    };
  }
  return { ok: true, targets, fanout: true };
}

function doasCommandIdentityId(context: CommandContext): string {
  if (!context.actor) {
    throw new Error('DoAS commands require an authoritative message actor.');
  }
  return requireStableIdentityAddress(context.actor).identityId;
}

function parseDoasArgs(args: string[]): ParsedDoasArgs {
  const parsed: ParsedDoasArgs = {
    args: [],
    confirmed: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--confirm') {
      parsed.confirmed = true;
      continue;
    }
    if (arg.startsWith('--fanout=')) {
      const mode = parseFanoutMode(arg.slice('--fanout='.length));
      if (!mode) {
        parsed.invalidFanout = arg;
      } else {
        parsed.fanout = mode;
      }
      continue;
    }
    if (arg === '--fanout') {
      const mode = parseFanoutMode(args[index + 1]);
      if (!mode) {
        parsed.invalidFanout = args[index + 1] ?? arg;
      } else {
        parsed.fanout = mode;
        index += 1;
      }
      continue;
    }
    parsed.args.push(arg);
  }
  return parsed;
}

function parseFanoutMode(value: string | undefined): DoasFanoutMode | undefined {
  return value === 'children' || value === 'all' ? value : undefined;
}

function actionInputFor(
  ctx: CommandContext,
  actionName: DoasActionName,
  args: string[]
): DoasActionInput {
  if (actionName === 'delete') {
    const text = args.join(' ').trim();
    return {
      ...(ctx.message.replyTo ? { messageId: ctx.message.replyTo.messageId } : {}),
      ...(text ? { text } : {})
    };
  }
  if (actionName === 'pin') {
    const parsedDuration = parsePinDuration(args[0]);
    const durationSeconds = parsedDuration.durationSeconds ?? 604800;
    const reason = args.slice(parsedDuration.consumedArgs).join(' ').trim();
    return {
      ...(ctx.message.replyTo ? { messageId: ctx.message.replyTo.messageId } : {}),
      durationSeconds,
      ...(reason ? { text: reason } : {})
    };
  }
  if (actionName === 'unpin') {
    const text = args.join(' ').trim();
    return {
      ...(ctx.message.replyTo ? { messageId: ctx.message.replyTo.messageId } : {}),
      ...(text ? { text } : {})
    };
  }
  if (actionName === 'send') {
    const text = args.join(' ').trim();
    return {
      ...(text ? { text } : {})
    };
  }
  if (actionName === 'send-media') {
    const mediaPath = args[0]?.trim();
    const text = args.slice(1).join(' ').trim();
    return {
      ...(mediaPath ? { file: fileForPath(mediaPath) } : {}),
      ...(text ? { text } : {})
    };
  }
  if (actionName === 'send-document') {
    const documentPath = args[0]?.trim();
    return {
      ...(documentPath ? { file: fileForPath(documentPath) } : {})
    };
  }
  if (actionName === 'add-history') {
    return addHistoryInputFor(ctx, args);
  }
  if (actionName === 'send-history') {
    return sendHistoryInputFor(ctx, args);
  }
  if ((MEMBERSHIP_ACTIONS.has(actionName) && actionName !== 'member-add' && actionName !== 'join-approval') || ADMIN_ACTIONS.has(actionName)) {
    const parsedUser = parseUserArg(ctx, args);
    const text = args.slice(parsedUser.consumedArgs).join(' ').trim();
    return {
      ...(parsedUser.userWid ? { userWid: parsedUser.userWid } : {}),
      ...(text ? { text } : {})
    };
  }
  if (actionName === 'member-add' || actionName === 'history-share') {
    return booleanValueInput(args, memberAddPermissionValue(args[0]));
  }
  if (actionName === 'join-approval' || actionName === 'report-to-admin') {
    return booleanValueInput(args, onOffValue(args[0]));
  }
  if (actionName === 'community-group-create' || actionName === 'community-member-add') {
    return booleanValueInput(args, communityGroupCreateValue(args[0]));
  }
  if (actionName === 'disappearing') {
    const durationSeconds = disappearingDurationSeconds(args[0]);
    const text = args.slice(1).join(' ').trim();
    return {
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      ...(text ? { text } : {})
    };
  }
  if (actionName === 'picture') {
    const imagePath = args[0]?.trim();
    const text = args.slice(1).join(' ').trim();
    return {
      ...(imagePath ? { file: imageFileForPath(imagePath) } : {}),
      ...(text ? { text } : {})
    };
  }
  if (actionName === 'create-group') {
    return createGroupInputFor(args);
  }
  if (actionName === 'create-child-group') {
    return createChildGroupInputFor(args);
  }
  if (actionName === 'create-community') {
    return createCommunityInputFor(args);
  }
  const text = args.join(' ').trim();
  return {
    ...(text ? { text } : {})
  };
}

function parseUserArg(ctx: CommandContext, args: string[]): { userWid?: string | undefined; consumedArgs: number } {
  const mention = ctx.command.mentions[0];
  if (mention) {
    return {
      userWid: mention,
      consumedArgs: args[0]?.startsWith('@') ? 1 : 0
    };
  }
  return args[0]
    ? { userWid: args[0], consumedArgs: 1 }
    : { consumedArgs: 0 };
}

function sendHistoryInputFor(ctx: CommandContext, args: string[]): DoasActionInput {
  const hasCount = args.some((arg) => arg === '--history' || arg.startsWith('--history=') || arg === '--count' || arg.startsWith('--count='));
  const input = addHistoryInputFor(ctx, hasCount ? args : ['--history', '100', ...args]);
  return {
    ...(input.userWids ? { userWids: input.userWids } : {}),
    ...(input.selectedMessageCount ? { selectedMessageCount: input.selectedMessageCount } : {}),
    ...(input.text ? { text: input.text } : {})
  };
}

function addHistoryInputFor(ctx: CommandContext, args: string[]): DoasActionInput {
  const parsed = parseFlaggedArgs(args);
  const selectedMessageCount = historyMessageCount(parsed.flags.get('history') ?? parsed.flags.get('count') ?? '25');
  const autoSendInviteV4 = parsed.flags.has('invite')
    ? true
    : parsed.flags.has('no-invite')
      ? false
      : undefined;
  const mentionSet = new Set(ctx.command.mentions);
  const explicitUsers = parsed.positionals.filter((arg) => looksLikeWid(arg) || arg.startsWith('@'));
  const userWids = uniqueStrings([
    ...mentionSet,
    ...splitList(parsed.flags.get('members') ?? parsed.flags.get('member')),
    ...explicitUsers.map((arg) => arg.startsWith('@') ? arg.slice(1) : arg)
  ]);
  const comment = parsed.flags.get('comment')?.trim();
  return {
    userWids,
    ...(selectedMessageCount ? { selectedMessageCount } : {}),
    ...(autoSendInviteV4 !== undefined ? { autoSendInviteV4 } : {}),
    ...(comment ? { text: comment } : {})
  };
}

function createGroupInputFor(args: string[]): DoasActionInput {
  const parsed = parseFlaggedArgs(args);
  const members = splitList(parsed.flags.get('members') ?? parsed.flags.get('member'));
  const autoSendInviteV4 = parsed.flags.has('invite')
    ? true
    : parsed.flags.has('no-invite')
      ? false
      : undefined;
  const title = parsed.flags.get('title')?.trim() || parsed.positionals.join(' ').trim();
  return {
    ...(title ? { title } : {}),
    participantWids: members,
    ...(autoSendInviteV4 !== undefined ? { autoSendInviteV4 } : {})
  };
}

function createChildGroupInputFor(args: string[]): DoasActionInput {
  const parsed = parseFlaggedArgs(args);
  const members = splitList(parsed.flags.get('members') ?? parsed.flags.get('member'));
  const title = parsed.flags.get('title')?.trim() || parsed.positionals.join(' ').trim();
  return {
    ...(title ? { title } : {}),
    participantWids: members
  };
}

function createCommunityInputFor(args: string[]): DoasActionInput {
  const parsed = parseFlaggedArgs(args);
  const title = parsed.flags.get('title')?.trim() || parsed.positionals.join(' ').trim();
  const description = parsed.flags.get('description')?.trim() ?? parsed.flags.get('desc')?.trim();
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {})
  };
}

function booleanValueInput(args: string[], value: boolean | undefined): DoasActionInput {
  const text = args.slice(1).join(' ').trim();
  return {
    ...(value !== undefined ? { booleanValue: value } : {}),
    ...(text ? { text } : {})
  };
}

function memberAddPermissionValue(value: string | undefined): boolean | undefined {
  const normalized = normalizeValue(value);
  if (normalized === 'admins' || normalized === 'admin' || normalized === 'admins_only' || normalized === 'community_admins') {
    return true;
  }
  if (normalized === 'all' || normalized === 'all_members' || normalized === 'everyone') {
    return false;
  }
  return undefined;
}

function communityGroupCreateValue(value: string | undefined): boolean | undefined {
  const normalized = normalizeValue(value);
  if (normalized === 'everyone' || normalized === 'all' || normalized === 'all_members') {
    return true;
  }
  if (normalized === 'admins' || normalized === 'admin' || normalized === 'community_admins' || normalized === 'admins_only') {
    return false;
  }
  return undefined;
}

function onOffValue(value: string | undefined): boolean | undefined {
  const normalized = normalizeValue(value);
  if (normalized === 'on' || normalized === 'true' || normalized === 'yes' || normalized === 'enabled' || normalized === 'enable') {
    return true;
  }
  if (normalized === 'off' || normalized === 'false' || normalized === 'no' || normalized === 'disabled' || normalized === 'disable') {
    return false;
  }
  return undefined;
}

function disappearingDurationSeconds(value: string | undefined): number | undefined {
  const normalized = normalizeValue(value);
  switch (normalized) {
    case 'off':
    case '0':
    case 'none':
      return 0;
    case '24h':
    case '1d':
      return 86400;
    case '7d':
      return 604800;
    case '90d':
      return 7776000;
    default:
      return undefined;
  }
}

function parsePinDuration(value: string | undefined): { durationSeconds?: number | undefined; consumedArgs: number } {
  const normalized = normalizeValue(value);
  switch (normalized) {
    case '24h':
    case '1d':
      return { durationSeconds: 86400, consumedArgs: 1 };
    case '7d':
      return { durationSeconds: 604800, consumedArgs: 1 };
    case '30d':
      return { durationSeconds: 2592000, consumedArgs: 1 };
    default:
      return { consumedArgs: 0 };
  }
}

function historyMessageCount(value: string | undefined): GroupHistoryMessageCount | undefined {
  const parsed = Number(value);
  return parsed === 25 || parsed === 50 || parsed === 100 ? parsed : undefined;
}

function imageFileForPath(imagePath: string): TransportFile {
  return {
    filename: filenameForPath(imagePath),
    mimeType: imageMimeTypeForPath(imagePath),
    path: imagePath
  };
}

function fileForPath(filePath: string): TransportFile {
  return {
    filename: filenameForPath(filePath),
    mimeType: mimeTypeForPath(filePath),
    path: filePath
  };
}

function filenameForPath(imagePath: string): string {
  const trimmed = imagePath.trim();
  return trimmed.split(/[\\/]/).filter(Boolean).pop() || 'group-picture';
}

function imageMimeTypeForPath(imagePath: string): string {
  const lower = imagePath.toLowerCase();
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

function mimeTypeForPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

function parseFlaggedArgs(args: string[]): { positionals: string[]; flags: Map<string, string> } {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf('=');
    if (equalsIndex >= 0) {
      flags.set(withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1));
      continue;
    }
    if (withoutPrefix === 'members' || withoutPrefix === 'member') {
      const values: string[] = [];
      while (args[index + 1] && !args[index + 1]!.startsWith('--')) {
        values.push(args[index + 1]!);
        index += 1;
      }
      flags.set(withoutPrefix, values.join(','));
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      flags.set(withoutPrefix, next);
      index += 1;
    } else {
      flags.set(withoutPrefix, 'true');
    }
  }
  return { positionals, flags };
}

function splitList(value: string | undefined): string[] {
  return uniqueStrings((value ?? '').split(/[,\s]+/));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function looksLikeWid(value: string): boolean {
  return /^[^\s@]+@(c|g)\.us$/i.test(value);
}

function normalizeValue(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/-/g, '_');
}

function primaryTarget(ctx: CommandContext): DoasExecutionTarget | undefined {
  const groupWid = ctx.groupWid ?? (ctx.message.context === 'group' ? ctx.message.chatId : undefined);
  if (!groupWid) {
    return undefined;
  }
  return {
    groupWid,
    ...(ctx.groupId ? { groupId: ctx.groupId } : {}),
    label: ctx.targets?.chat?.raw ?? groupWid
  };
}

function effectiveArgs(ctx: CommandContext): string[] {
  return ctx.remainingArgs ?? ctx.command.args;
}

function rejectionText(ctx: CommandContext, reason: DoasPlanRejection): string {
  switch (reason) {
    case 'confirm-required':
      return ctx.t('official.community-admin.actions.confirmRequired');
    case 'delete-reply-required':
      return ctx.t('official.community-admin.actions.deleteReplyRequired');
    case 'pin-reply-required':
      return ctx.t('official.community-admin.actions.pinReplyRequired');
    case 'user-required':
      return ctx.t('official.community-admin.actions.userRequired');
    case 'users-required':
      return ctx.t('official.community-admin.actions.usersRequired');
    case 'text-required':
      return ctx.t('official.community-admin.actions.textRequired');
    case 'value-required':
      return ctx.t('official.community-admin.actions.valueRequired');
    case 'invalid-value':
      return ctx.t('official.community-admin.actions.invalidValue');
    case 'file-required':
      return ctx.t('official.community-admin.actions.fileRequired');
    case 'group-target-required':
      return ctx.t('official.community-admin.actions.groupTargetRequired');
    case 'fanout-unsupported':
      return ctx.t('official.community-admin.actions.fanoutUnsupported');
    case 'bot-target-protected':
      return ctx.t('official.community-admin.actions.botTargetProtected');
    case 'linked-parent-required':
      return ctx.t('official.community-admin.actions.linkedParentRequired');
  }
}

async function parentCommunityInput(
  context: PluginCommandContext,
  scopeId: string,
  actionName: DoasActionName
): Promise<{ parentCommunityWid?: string | undefined }> {
  if (actionName !== 'unlink-community') {
    return {};
  }
  const parentCommunityWid = await context.communityGroupWidForScope?.(scopeId);
  return parentCommunityWid ? { parentCommunityWid } : {};
}

async function botProtectionInput(
  context: PluginCommandContext,
  actionName: DoasActionName,
  userWid: string | undefined
): Promise<{ userIdentityId?: string | undefined; botIdentityId?: string | undefined }> {
  if (!isDestructiveBotTargetAction(actionName) || !userWid) {
    return {};
  }
  if (!context.getCurrentBotWid || !context.resolveIdentityAddress) {
    throw new Error('Authoritative identity resolution is unavailable for destructive administration actions.');
  }
  const botWid = await context.getCurrentBotWid();
  if (!botWid) {
    throw new Error('The WhatsApp session identity is unavailable for destructive administration actions.');
  }
  const [userIdentity, botIdentity] = await Promise.all([
    context.resolveIdentityAddress(userWid),
    context.resolveIdentityAddress(botWid)
  ]);
  return {
    userIdentityId: userIdentity.identityId,
    botIdentityId: botIdentity.identityId
  };
}

function targetResolutionText(ctx: CommandContext, resolution: Exclude<TargetResolution, { ok: true }>): string {
  switch (resolution.reason) {
    case 'fanout-disabled':
      return ctx.t('official.community-admin.actions.fanoutDisabled');
    case 'fanout-permission-denied':
      return ctx.t('official.community-admin.actions.fanoutPermissionDenied');
    case 'fanout-no-targets':
      return ctx.t('official.community-admin.actions.fanoutNoTargets');
    case 'fanout-too-many':
      return ctx.t('official.community-admin.actions.fanoutTooMany', {
        count: String(resolution.count ?? 0),
        limit: String(resolution.limit ?? 0)
      });
  }
}
