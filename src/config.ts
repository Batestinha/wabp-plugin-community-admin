import { rulebookSchema } from './rulebook';
import { z } from 'zod';
import { communitySubgroupCreationPolicySchema } from './subgroups/creationPolicy';

/** off: ignore; audit: record only; warn: warn the author; delete: remove the message; delete-and-warn: both. */
export const rulePolicySchema = z.enum(['off', 'audit', 'warn', 'delete', 'delete-and-warn']);
/** Invite links may additionally expel members who joined recently: the bot's only automatic expulsion. */
export const spamPolicySchema = z.enum(['off', 'audit', 'warn', 'delete', 'delete-and-warn', 'expel-new-members']);

const chatIds = z.array(z.string().trim().min(1)).default([]);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u, 'use HH:MM');

export const moderationConfigSchema = z.object({
  rulebook: rulebookSchema.optional(),
  legacyRulesForReview: z.string().max(4000).optional(),
  enabled: z.boolean().default(false),
  requireConfirmForHighRisk: z.boolean().default(true),
  fanout: z.object({
    enabled: z.boolean().default(false), requireExplicitFlag: z.boolean().default(true),
    maxTargets: z.number().int().positive().max(250).default(25), includeParentByDefault: z.boolean().default(false)
  }).strict().default({}),
  maxParticipants: z.number().int().min(1).max(256).default(128),
  creationPolicy: communitySubgroupCreationPolicySchema,
  joinApproval: z.object({ policy: z.enum(['leave', 'require']).default('leave'), autoApprove: z.boolean().default(false) }).strict().default({}),
  /** While true, every decision is only recorded in the audit log; nothing is deleted, removed or sent. */
  dryRun: z.boolean().default(true),
  /** Groups of the scope that this plugin never acts in. */
  exemptGroupChatIds: chatIds,
  suspension: z.object({
    defaultDays: z.number().int().min(1).max(365).default(7),
    maxDays: z.number().int().min(1).max(3650).default(365),
    /** Extra operator text appended to the private suspension notice, for example where to read the chat history. */
    noticeExtra: z.string().max(1000).default('')
  }).strict().default({}),
  expulsion: z.object({
    noticeExtra: z.string().max(1000).default('')
  }).strict().default({}),
  reports: z.object({
    enabled: z.boolean().default(true)
  }).strict().default({}),
  warnings: z.object({
    ttlDays: z.number().int().min(1).max(365).default(30),
    /** Admins are told when a member reaches this many active warnings; the bot never suspends on its own. */
    alertAt: z.number().int().min(1).max(50).default(3)
  }).strict().default({}),
  shield: z.object({
    /** A member counts as new for this long after joining a covered group. */
    newMemberHours: z.number().int().min(1).max(24 * 30).default(48),
    inviteLinkPolicy: spamPolicySchema.default('off'),
    linkPolicy: rulePolicySchema.default('off'),
    allowedDomains: z.array(z.string().trim().min(1)).default([]),
    blockedDomains: z.array(z.string().trim().min(1)).default([]),
    bannedPhrases: z.array(z.string().trim().min(1)).default([]),
    bannedPhrasePolicy: rulePolicySchema.default('off'),
    flood: z.object({
      enabled: z.boolean().default(false),
      maxMessages: z.number().int().min(2).max(500).default(8),
      windowSeconds: z.number().int().min(5).max(3600).default(20),
      policy: spamPolicySchema.default('warn')
    }).strict().default({}),
    raid: z.object({
      enabled: z.boolean().default(false),
      maxJoins: z.number().int().min(2).max(1000).default(10),
      windowSeconds: z.number().int().min(10).max(86_400).default(120),
      lockMinutes: z.number().int().min(1).max(1440).default(15),
      revokeInvite: z.boolean().default(false)
    }).strict().default({})
  }).strict().default({}),
  etiquette: z.object({
    stickerBurst: z.object({
      enabled: z.boolean().default(false),
      maxStickers: z.number().int().min(1).max(100).default(5),
      windowSeconds: z.number().int().min(5).max(3600).default(60),
      policy: rulePolicySchema.default('warn')
    }).strict().default({}),
    forwardedChains: z.object({
      enabled: z.boolean().default(false),
      policy: rulePolicySchema.default('warn')
    }).strict().default({}),
    mediaBlockedGroupChatIds: chatIds,
    mediaPolicy: rulePolicySchema.default('warn'),
    quietHours: z.object({
      enabled: z.boolean().default(false),
      start: clock.default('23:00'),
      end: clock.default('07:00'),
      timezone: z.string().trim().min(1).default('UTC'),
      groupChatIds: chatIds,
      policy: rulePolicySchema.default('warn')
    }).strict().default({})
  }).strict().default({})
}).strict().transform(config => ({ ...config, rulebook: config.rulebook, legacyRulesForReview: config.legacyRulesForReview }));

export type ModerationConfig = z.infer<typeof moderationConfigSchema>;
export type RulePolicy = z.infer<typeof spamPolicySchema>;

export function parseModerationConfig(input: unknown): ModerationConfig {
  return moderationConfigSchema.parse(input ?? {});
}

/** Every leaf path of the configuration, for the operator console metadata. */
export function moderationConfigPaths(): string[] {
  const paths: string[] = [];
  const walk = (value: unknown, prefix: string) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) walk(child, prefix ? `${prefix}.${key}` : key);
      return;
    }
    paths.push(prefix);
  };
  walk(moderationConfigSchema.parse({}), '');
  return paths;
}
