import type { PluginManifest } from '@wabs/plugin-sdk/manifest';
import { doasManifest } from './actions/manifest';
import { communitySubgroupsManifest } from './subgroups/manifest';
import { moderationConfigSchema } from './config';
import {
  LOCK_EXPIRE_JOB,
  MODERATION_COMMANDS,
  MODERATION_CORE_API_RANGE,
  MODERATION_DANGEROUS_ACTIONS,
  MODERATION_DATABASE,
  MODERATION_MANAGE_PERMISSION,
  MODERATION_NAMESPACE as ns,
  MODERATION_PLUGIN_ID,
  MODERATION_VERSION,
  SUSPENSION_END_JOB
} from './constants';
import { moderationMessages } from './messages';
import { doasMessages } from './actions/messages';
import { communitySubgroupsMessages } from './subgroups/messages';

import { rulesService } from './rulebook';

const grants = ['moderate', 'group-info', 'group-settings', 'structure', 'send'].map(name => 'plugin.community-admin.' + name);
const commands = [...new Set([...MODERATION_COMMANDS, ...doasManifest.commands, ...communitySubgroupsManifest.commands])];

const integrations = [
  { pluginId: 'official.community-events', versionRange: '>=0.24.0', description: 'Checks whether an event owns a subgroup before allowing members to change its title.' },
  { pluginId: 'official.nl-assistant', versionRange: '*', description: 'Makes eligible group administrative actions available through the assistant.' },
];

export const moderationManifest: PluginManifest & { integrations: typeof integrations } = {
  ...{ operationCatalogVersion: require('../wa-plugin.json').operationCatalogVersion, operationPermissions: require('../wa-plugin.json').operationPermissions },
  pluginId: MODERATION_PLUGIN_ID,
  name: 'Group Administration Assistant',
  author: { name: 'Batestinha', url: 'https://github.com/Batestinha' },
  kind: 'managed_group',
  version: MODERATION_VERSION,
  coreApiRange: MODERATION_CORE_API_RANGE,
  messageNamespace: ns,
  descriptionKey: `${ns}.description`,
  defaultMessages: { ...moderationMessages, ...doasMessages, ...communitySubgroupsMessages,
    [ns + '.help.family']: 'Group Administration Assistant', [ns + '.help.feature.title']: 'Group Administration Assistant',
    [ns + '.role.group.label']: 'Group Admin', [ns + '.role.group.description']: 'Moderate members and manage group information in this scope.',
    [ns + '.role.community.label']: 'Community Admin', [ns + '.role.community.description']: 'Manage members, settings, structure and sending in this scope.',
    [ns + '.subgroups.infoDenied']: 'Only administrators can edit information in this group.' },
  commands,
  help: {
    featureId: 'community-admin',
    titleKey: `${ns}.help.feature.title`,
    summaryKey: `${ns}.help.feature.summaryNeutral`,
    order: 80,
    aliases: ['Administração da comunidade', 'Assistente de Administração da Comunidade', 'Community Administration Assistant', 'Community Administration Manager', 'moderation', 'moderação', 'suspend', 'expel', 'report', 'denunciar'],
    topics: [
      { topicId: 'group-rules', titleKey: ns + '.rules.title', summaryKey: ns + '.rules.help', order: 10,
        commands: ['/rules'], exampleKeys: [ns + '.rules.example'], keywords: ['rules', 'regras'],
        availability: { invocation: 'either', requiresCurrentManagedGroupMembership: true, currentManagedGroupMembershipMode: 'effective_scope' } },
      ...(doasManifest.help?.topics ?? []), ...(communitySubgroupsManifest.help?.topics ?? []),
      {
        topicId: 'moderate-members',
        titleKey: `${ns}.help.moderate.title`,
        summaryKey: `${ns}.help.moderate.summary`,
        order: 10,
        commands: MODERATION_COMMANDS.filter((command) => command.startsWith('/admin ')),
        instructionKeys: [`${ns}.help.moderate.instruction`],
        exampleKeys: [`${ns}.help.moderate.example`],
        keywords: ['suspend', 'expel', 'ban', 'kick', 'warn', 'lift', 'lock'],
        availability: { invocation: 'either', permission: MODERATION_MANAGE_PERMISSION }
      },
      {
        topicId: 'report-message',
        titleKey: `${ns}.help.report.title`,
        summaryKey: `${ns}.help.report.summaryModerators`,
        order: 20,
        commands: ['/report'],
        instructionKeys: [`${ns}.help.report.instructionModerators`],
        exampleKeys: [`${ns}.help.report.example`],
        keywords: ['report', 'spam', 'abuse', 'denunciar'],
        availability: { invocation: 'group_only', requiresCurrentManagedGroupMembership: true }
      }
    ]
  },
  eventSubscriptions: ['message', 'participant.change', 'group.scope.covered', 'plugin.job'],
  requiredPermissions: grants,
  roles: [
    { key: 'group-admin', labelKey: ns + '.role.group.label', descriptionKey: ns + '.role.group.description', permissions: grants.slice(0, 2) },
    { key: 'community-admin', labelKey: ns + '.role.community.label', descriptionKey: ns + '.role.community.description', permissions: grants }
  ],
  requiredBotCapabilities: [],
  configSchema: moderationConfigSchema,
  dangerousActions: [...new Set([...MODERATION_DANGEROUS_ACTIONS, ...doasManifest.dangerousActions, ...communitySubgroupsManifest.dangerousActions])],
  backgroundJobs: [SUSPENSION_END_JOB, LOCK_EXPIRE_JOB, 'scope.configuration.changed'],
  databases: [{ name: MODERATION_DATABASE, engine: 'sqlite', scope: 'account', migrations: 'migrations/moderation' }],
  dataVersion: '1',
  dependencies: [],
  integrations,
  cancellation: communitySubgroupsManifest.cancellation,
  memberSubscriptions: [],
  services: [...(communitySubgroupsManifest.services ?? []), rulesService],
  assistant: {
    summary: 'Moderates the groups of a scope (a community or standalone groups): suspensions and expulsions, member reports, a spam and raid shield, and etiquette rules.',
    useCases: [
      'Suspend a member for a number of days: they are removed from every group here and added back when it ends.',
      'Expel a member: they are removed from every group here and kept out.',
      'Take member reports and let admins act on them privately.',
      'Remove obvious spam, lock a group during a raid, and warn about etiquette rules.'
    ],
    prerequisites: [
      'enabled=true in the target scope.',
      'Groups must be in MANAGE mode, with the bot as admin, for removals, deletions and locks.',
      'WABP core API 0.3.24 or later, for member standings.'
    ],
    limitations: [
      'Only admins of the authority groups may moderate; the bot by itself only expels obvious spam from members who joined recently.',
      'What a suspension or expulsion means for other host features (for example chat history) is decided by the host, not this plugin.',
      'dryRun=true (the default) only records decisions in the audit log.'
    ],
    workflows: [
      { intent: 'community_rules', description: 'Show the published rules for the current scope.', commands: ['/rules'] },
      { intent: 'moderation_case', description: 'Suspend, expel, lift or extend.', commands: ['/admin suspend', '/admin expel', '/admin lift', '/admin extend'] },
      { intent: 'moderation_report', description: 'Report a message, or act on a report.', commands: ['/report', '/admin resolve'] },
      { intent: 'moderation_status', description: 'Show settings, cases and warnings.', commands: ['/admin status', '/admin cases', '/admin warnings'] }
    ]
  }
};
