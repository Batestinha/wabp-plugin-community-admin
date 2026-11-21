import type { PluginManifest } from '@wabs/plugin-sdk/manifest';
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

export const moderationManifest: PluginManifest = {
  pluginId: MODERATION_PLUGIN_ID,
  name: 'Moderation',
  author: { name: 'Batestinha', url: 'https://github.com/Batestinha' },
  kind: 'managed_group',
  version: MODERATION_VERSION,
  coreApiRange: MODERATION_CORE_API_RANGE,
  messageNamespace: ns,
  descriptionKey: `${ns}.description`,
  defaultMessages: moderationMessages,
  commands: MODERATION_COMMANDS,
  help: {
    featureId: 'moderation',
    titleKey: `${ns}.help.feature.title`,
    summaryKey: `${ns}.help.feature.summary`,
    order: 80,
    aliases: ['moderation', 'moderação', 'suspend', 'expel', 'report', 'denunciar'],
    topics: [
      {
        topicId: 'moderate-members',
        titleKey: `${ns}.help.moderate.title`,
        summaryKey: `${ns}.help.moderate.summary`,
        order: 10,
        commands: MODERATION_COMMANDS.filter((command) => command.startsWith('/mod ')),
        instructionKeys: [`${ns}.help.moderate.instruction`],
        exampleKeys: [`${ns}.help.moderate.example`],
        keywords: ['suspend', 'expel', 'ban', 'kick', 'warn', 'lift', 'lock'],
        availability: { invocation: 'either', permission: MODERATION_MANAGE_PERMISSION }
      },
      {
        topicId: 'report-message',
        titleKey: `${ns}.help.report.title`,
        summaryKey: `${ns}.help.report.summary`,
        order: 20,
        commands: ['/report'],
        instructionKeys: [`${ns}.help.report.instruction`],
        exampleKeys: [`${ns}.help.report.example`],
        keywords: ['report', 'spam', 'abuse', 'denunciar'],
        availability: { invocation: 'group_only', requiresCurrentManagedGroupMembership: true }
      }
    ]
  },
  eventSubscriptions: ['message', 'participant.change', 'plugin.job'],
  requiredPermissions: [MODERATION_MANAGE_PERMISSION],
  requiredBotCapabilities: [],
  configSchema: moderationConfigSchema,
  dangerousActions: [...MODERATION_DANGEROUS_ACTIONS],
  backgroundJobs: [SUSPENSION_END_JOB, LOCK_EXPIRE_JOB],
  databases: [{ name: MODERATION_DATABASE, engine: 'sqlite', scope: 'account', migrations: 'migrations/moderation' }],
  dataVersion: '1',
  dependencies: [],
  cancellation: { workflows: [] },
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
      { intent: 'moderation_case', description: 'Suspend, expel, lift or extend.', commands: ['/mod suspend', '/mod expel', '/mod lift', '/mod extend'] },
      { intent: 'moderation_report', description: 'Report a message, or act on a report.', commands: ['/report', '/mod resolve'] },
      { intent: 'moderation_status', description: 'Show settings, cases and warnings.', commands: ['/mod status', '/mod cases', '/mod warnings'] }
    ]
  }
};
