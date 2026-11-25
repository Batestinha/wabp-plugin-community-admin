import type { PluginManifest } from '@wabs/plugin-sdk/manifest';
import { doasConfigSchema } from './config';
import { doasMessages } from './messages';

export const DOAS_PLUGIN_ID = 'official.community-admin';

export const DOAS_PERMISSIONS = {
  inspect: 'plugin.community-admin.moderate',
  moderate: 'plugin.community-admin.moderate',
  membership: 'plugin.community-admin.moderate',
  profile: 'plugin.community-admin.group-info',
  messagePin: 'plugin.community-admin.group-info',
  retention: 'plugin.community-admin.group-settings',
  privacy: 'plugin.community-admin.group-settings',
  mediaProfile: 'plugin.community-admin.group-info',
  messageSend: 'plugin.community-admin.send',
  inviteRead: 'plugin.community-admin.group-settings',
  groupCreate: 'plugin.community-admin.structure',
  communityCreate: 'plugin.community-admin.structure',
  communitySettings: 'plugin.community-admin.group-settings',
  chatDelete: 'plugin.community-admin.structure',
  admin: 'plugin.community-admin.structure',
  communityFanout: 'plugin.community-admin.structure',
  configure: 'plugin.configure'
} as const;

export const doasManifest: PluginManifest = {
  pluginId: DOAS_PLUGIN_ID,
  name: 'Group administration',
  author: { name: 'Batestinha' },
  kind: 'managed_group',
  version: '0.4.0',
  coreApiRange: '>=0.2.0',
  messageNamespace: 'official.community-admin',
  descriptionKey: 'official.community-admin.actions.description',
  defaultMessages: doasMessages,
  commands: [
    '/admin status',
    '/admin lock',
    '/admin unlock',
    '/admin delete',
    '/admin pin',
    '/admin unpin',
    '/admin send',
    '/admin send-media',
    '/admin send-document',
    '/admin approve',
    '/admin reject',
    '/admin add',
    '/admin add-history',
    '/admin send-history',
    '/admin remove',
    '/admin promote',
    '/admin demote',
    '/admin title',
    '/admin description',
    '/admin picture',
    '/admin picture-clear',
    '/admin info-lock',
    '/admin info-unlock',
    '/admin member-add',
    '/admin join-approval',
    '/admin disappearing',
    '/admin report-to-admin',
    '/admin history-share',
    '/admin invite-link',
    '/admin revoke-invite',
    '/admin unlink-community',
    '/admin leave',
    '/admin create-group',
    '/admin delete-chat',
    '/admin create-community',
    '/admin subgroup',
    '/admin community-group-create',
    '/admin community-member-add',
    '/admin dismantle-group',
    '/admin dismantle-community'
  ],
  help: {
    featureId: 'doas',
    titleKey: 'official.community-admin.actions.help.feature.title',
    summaryKey: 'official.community-admin.actions.help.feature.summary',
    order: 60,
    aliases: ['do as', 'administration', 'moderation'],
    topics: [
      {
        topicId: 'messages',
        titleKey: 'official.community-admin.actions.help.topic.messages.title',
        summaryKey: 'official.community-admin.actions.help.topic.messages.summary',
        order: 10,
        commands: ['/admin lock', '/admin unlock', '/admin delete', '/admin pin', '/admin unpin', '/admin send', '/admin send-media', '/admin send-document'],
        instructionKeys: ['official.community-admin.actions.help.topic.messages.instruction'],
        keywords: ['message', 'send', 'delete', 'pin', 'lock']
      },
      {
        topicId: 'members',
        titleKey: 'official.community-admin.actions.help.topic.members.title',
        summaryKey: 'official.community-admin.actions.help.topic.members.summary',
        order: 20,
        commands: ['/admin approve', '/admin reject', '/admin add', '/admin add-history', '/admin send-history', '/admin remove', '/admin promote', '/admin demote', '/admin member-add', '/admin join-approval'],
        instructionKeys: ['official.community-admin.actions.help.topic.members.instruction'],
        keywords: ['member', 'participant', 'approve', 'remove', 'admin']
      },
      {
        topicId: 'settings',
        titleKey: 'official.community-admin.actions.help.topic.settings.title',
        summaryKey: 'official.community-admin.actions.help.topic.settings.summary',
        order: 30,
        commands: ['/admin status', '/admin title', '/admin description', '/admin picture', '/admin picture-clear', '/admin info-lock', '/admin info-unlock', '/admin disappearing', '/admin report-to-admin', '/admin history-share'],
        instructionKeys: ['official.community-admin.actions.help.topic.settings.instruction'],
        keywords: ['settings', 'profile', 'subject', 'description', 'privacy']
      },
      {
        topicId: 'invites',
        titleKey: 'official.community-admin.actions.help.topic.invites.title',
        summaryKey: 'official.community-admin.actions.help.topic.invites.summary',
        order: 40,
        commands: ['/admin invite-link', '/admin revoke-invite'],
        instructionKeys: ['official.community-admin.actions.help.topic.invites.instruction'],
        keywords: ['invite', 'link', 'revoke']
      },
      {
        topicId: 'communities',
        titleKey: 'official.community-admin.actions.help.topic.communities.title',
        summaryKey: 'official.community-admin.actions.help.topic.communities.summary',
        order: 50,
        commands: ['/admin unlink-community', '/admin create-community', '/admin subgroup', '/admin community-group-create', '/admin community-member-add', '/admin dismantle-community'],
        instructionKeys: ['official.community-admin.actions.help.topic.communities.instruction'],
        keywords: ['community', 'child group', 'unlink', 'create']
      },
      {
        topicId: 'lifecycle',
        titleKey: 'official.community-admin.actions.help.topic.lifecycle.title',
        summaryKey: 'official.community-admin.actions.help.topic.lifecycle.summary',
        order: 60,
        commands: ['/admin leave', '/admin create-group', '/admin delete-chat', '/admin dismantle-group'],
        instructionKeys: ['official.community-admin.actions.help.topic.lifecycle.instruction'],
        keywords: ['group', 'create', 'leave', 'delete', 'dismantle']
      }
    ]
  },
  requiredPermissions: [
    DOAS_PERMISSIONS.inspect,
    DOAS_PERMISSIONS.moderate,
    DOAS_PERMISSIONS.membership,
    DOAS_PERMISSIONS.profile,
    DOAS_PERMISSIONS.messagePin,
    DOAS_PERMISSIONS.retention,
    DOAS_PERMISSIONS.privacy,
    DOAS_PERMISSIONS.mediaProfile,
    DOAS_PERMISSIONS.messageSend,
    DOAS_PERMISSIONS.inviteRead,
    DOAS_PERMISSIONS.groupCreate,
    DOAS_PERMISSIONS.communityCreate,
    DOAS_PERMISSIONS.communitySettings,
    DOAS_PERMISSIONS.chatDelete,
    DOAS_PERMISSIONS.admin,
    DOAS_PERMISSIONS.communityFanout,
    DOAS_PERMISSIONS.configure
  ],
  requiredBotCapabilities: [],
  configSchema: doasConfigSchema,
  dangerousActions: [
    'message.delete',
    'message.pin',
    'message.unpin',
    'group.addParticipant',
    'group.addParticipantsWithHistory',
    'group.removeParticipant',
    'group.promoteParticipant',
    'group.demoteParticipant',
    'group.lockMessages',
    'group.unlockMessages',
    'group.lockInfo',
    'group.unlockInfo',
    'group.revokeInvite',
    'group.setSubject',
    'group.setDescription',
    'group.setAddMembersAdminsOnly',
    'group.setMembershipApprovalMode',
    'group.setDisappearingMessages',
    'group.setReportToAdminMode',
    'group.setHistoryShareMode',
    'group.sendHistoryBundle',
    'group.setPicture',
    'group.deletePicture',
    'group.approveMembershipRequest',
    'group.rejectMembershipRequest',
    'community.unlinkGroup',
    'group.leave',
    'group.create',
    'community.create',
    'community.createChildGroup',
    'community.setGroupCreateEveryoneAllowed',
    'community.setMemberAddEveryoneAllowed',
    'group.dismantle',
    'community.dismantle',
    'chat.delete'
  ],
  backgroundJobs: [],
  cancellation: { workflows: [] },
  assistant: {
    summary: 'Delegated, scoped WhatsApp group and community administration actions performed by the bot after permission, mode, capability, preview, and confirmation checks.',
    useCases: [
      'Let scoped delegates lock or unlock group messaging without giving them broad platform administration.',
      'Let trusted delegates approve, reject, add, remove, promote, or demote members through audited bot actions.',
      'Preview exact participant targets by listing members, filtering admins or normal members, and excluding the bot, requester, protected owners, or super-admins before execution.',
      'Apply selected admin actions across enrolled community child groups when fan-out is explicitly enabled.'
    ],
    prerequisites: [
      'The plugin must be enabled in the target scope and config.enabled must be true for mutations.',
      'The caller needs the permission tier for the requested action.',
      'The bot must be a group admin with the WhatsApp capability required for each emitted action.'
    ],
    limitations: [
      'Private chat targets must match an enrolled managed group or community by exact display name or chat ID.',
      'Community fan-out is disabled by default and requires the doas.community-fanout permission.',
      'Destructive participant actions are explicitly refused when the target is the WhatsApp session.'
    ],
    workflows: [
      {
        intent: 'doas_status',
        description: 'Inspect do-as configuration and current target capability state.',
        commands: ['/admin status']
      },
      {
        intent: 'doas_moderate',
        description: 'Lock or unlock messaging, delete a replied-to message, or revoke the invite link.',
        commands: ['/admin lock', '/admin unlock', '/admin delete', '/admin pin', '/admin unpin', '/admin send', '/admin send-media', '/admin send-document', '/admin revoke-invite', '/admin unlink-community', '/admin leave', '/admin delete-chat', '/admin dismantle-group', '/admin dismantle-community']
      },
      {
        intent: 'doas_membership',
        description: 'Approve, reject, add, or remove members through bot-mediated admin actions.',
        commands: ['/admin approve', '/admin reject', '/admin add', '/admin add-history', '/admin send-history', '/admin remove', '/admin member-add', '/admin join-approval']
      },
      {
        intent: 'doas_profile',
        description: 'Change group subject, description, or info edit lock state.',
        commands: ['/admin title', '/admin description', '/admin picture', '/admin picture-clear', '/admin info-lock', '/admin info-unlock', '/admin disappearing', '/admin report-to-admin', '/admin history-share', '/admin invite-link']
      },
      {
        intent: 'doas_admin',
        description: 'Promote or demote group admins with explicit confirmation.',
        commands: ['/admin promote', '/admin demote', '/admin create-group', '/admin create-community', '/admin subgroup', '/admin community-group-create', '/admin community-member-add']
      }
    ]
  }
};
