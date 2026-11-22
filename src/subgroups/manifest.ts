import type { PluginManifest } from '@wabs/plugin-sdk/manifest';
import { communitySubgroupsConfigSchema } from './config';
import { communitySubgroupsMessages } from './messages';
import {
  COMMUNITY_SUBGROUPS_CANDIDATE_METHOD,
  COMMUNITY_SUBGROUPS_CANDIDATE_TIMEOUT_MS,
  COMMUNITY_SUBGROUPS_RECONCILE_CREATOR_METHOD,
  COMMUNITY_SUBGROUPS_RECONCILE_CREATOR_TIMEOUT_MS,
  COMMUNITY_SUBGROUPS_CONFIGURE_METHOD,
  COMMUNITY_SUBGROUPS_CONFIGURE_TIMEOUT_MS,
  COMMUNITY_SUBGROUPS_COMPLETE_METHOD,
  COMMUNITY_SUBGROUPS_COMPLETE_TIMEOUT_MS,
  COMMUNITY_SUBGROUPS_SERVICE_ID
} from './serviceApi';

export const COMMUNITY_SUBGROUPS_PLUGIN_ID = 'official.community-admin';

export const communitySubgroupsManifest: PluginManifest = {
  pluginId: COMMUNITY_SUBGROUPS_PLUGIN_ID,
  kind: 'managed_group',
  version: '0.1.2',
  coreApiRange: '^0.3.0',
  messageNamespace: 'official.community-admin',
  descriptionKey: 'official.community-admin.subgroups.description',
  defaultMessages: communitySubgroupsMessages,
  commands: [
    '/group create',
    '/admin title',
    '/admin description',
    '/admin pin',
    '/admin unpin'
  ],
  help: {
    featureId: 'subgroups',
    titleKey: 'official.community-admin.subgroups.help.feature.title',
    summaryKey: 'official.community-admin.subgroups.help.feature.summary',
    order: 50,
    aliases: ['subgroup', 'community group', 'child group'],
    topics: [
      {
        topicId: 'create-subgroup',
        titleKey: 'official.community-admin.subgroups.help.create.title',
        summaryKey: 'official.community-admin.subgroups.help.create.summary',
        order: 10,
        commands: ['/group create'],
        instructionKeys: ['official.community-admin.subgroups.help.create.instruction'],
        exampleKeys: ['official.community-admin.subgroups.help.create.example'],
        keywords: ['create', 'child group', 'members'],
        availability: { invocation: 'group_only', requiredAccessPlane: 'group_member' }
      },
      {
        topicId: 'edit-subgroup',
        titleKey: 'official.community-admin.subgroups.help.edit.title',
        summaryKey: 'official.community-admin.subgroups.help.edit.summary',
        order: 20,
        commands: ['/admin title', '/admin description'],
        instructionKeys: ['official.community-admin.subgroups.help.edit.instruction'],
        exampleKeys: ['official.community-admin.subgroups.help.title.example'],
        keywords: ['title', 'description', 'rename'],
        availability: { invocation: 'group_only', requiredAccessPlane: 'group_member' }
      },
      {
        topicId: 'pin-messages',
        titleKey: 'official.community-admin.subgroups.help.pin.title',
        summaryKey: 'official.community-admin.subgroups.help.pin.summary',
        order: 30,
        commands: ['/admin pin', '/admin unpin'],
        instructionKeys: ['official.community-admin.subgroups.help.pin.instruction'],
        exampleKeys: ['official.community-admin.subgroups.help.pin.example'],
        keywords: ['pin', 'unpin', 'message'],
        availability: { invocation: 'group_only', requiredAccessPlane: 'group_member' }
      }
    ]
  },
  services: [{
    serviceId: COMMUNITY_SUBGROUPS_SERVICE_ID,
    methods: [
      {
        name: COMMUNITY_SUBGROUPS_CANDIDATE_METHOD,
        access: 'mutation',
        timeoutMs: COMMUNITY_SUBGROUPS_CANDIDATE_TIMEOUT_MS
      },
      {
        name: COMMUNITY_SUBGROUPS_RECONCILE_CREATOR_METHOD,
        access: 'mutation',
        timeoutMs: COMMUNITY_SUBGROUPS_RECONCILE_CREATOR_TIMEOUT_MS
      },
      {
        name: COMMUNITY_SUBGROUPS_CONFIGURE_METHOD,
        access: 'mutation',
        timeoutMs: COMMUNITY_SUBGROUPS_CONFIGURE_TIMEOUT_MS
      },
      {
        name: COMMUNITY_SUBGROUPS_COMPLETE_METHOD,
        access: 'mutation',
        timeoutMs: COMMUNITY_SUBGROUPS_COMPLETE_TIMEOUT_MS
      }
    ]
  }],
  eventSubscriptions: [],
  requiredPermissions: [],
  requiredBotCapabilities: [],
  configSchema: communitySubgroupsConfigSchema,
  dangerousActions: [
    'group.setSubject',
    'group.setDescription',
    'message.pin',
    'message.unpin'
  ],
  backgroundJobs: [],
  cancellation: {
    workflows: [
      {
        id: 'subgroup-create',
        description: 'Guided subgroup creation before the managed group is created.',
        mode: 'core-flow',
        scope: 'actor-chat',
        commands: ['/group create'],
        cancellableStates: ['active'],
        terminalStates: ['completed', 'cancelled', 'expired'],
        effects: ['discard-subgroup-draft']
      },
      {
        id: 'pin-duration',
        description: 'Guided pin-duration choice before a quoted message is pinned.',
        mode: 'core-flow',
        scope: 'actor-chat',
        commands: ['/admin pin'],
        cancellableStates: ['active'],
        terminalStates: ['completed', 'cancelled', 'expired'],
        effects: ['discard-pin-draft']
      }
    ]
  },
  assistant: {
    summary: 'Member-facing creation and management of community child groups.',
    useCases: [
      'Let community members create a subgroup through a guided title, description, and member setup flow.',
      'Let subgroup members request title and description changes through the bot.',
      'Let subgroup members pin or unpin quoted messages through the bot.'
    ],
    prerequisites: [
      'The plugin must be enabled for the target scope.',
      'The bot must be a community admin for subgroup creation.',
      'The bot must be a group admin in child groups for title, description, pin, and unpin actions.'
    ],
    workflows: [
      {
        intent: 'community_subgroup_create',
        description: 'Start a guided subgroup creation flow.',
        commands: ['/group create']
      },
      {
        intent: 'community_subgroup_profile',
        description: 'Change the title or description of the current subgroup.',
        commands: ['/admin title', '/admin description']
      },
      {
        intent: 'community_subgroup_pin',
        description: 'Pin or unpin a quoted subgroup message.',
        commands: ['/admin pin', '/admin unpin']
      }
    ]
  }
};
