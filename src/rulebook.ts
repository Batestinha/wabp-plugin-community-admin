import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PluginServiceRegistration } from '@wabs/plugin-sdk/services';
import type { ModerationConfig } from './config';

export const moderationChecks = ['invite-link', 'link', 'phrase', 'flood', 'sticker-burst', 'forwarded', 'media', 'quiet-hours'] as const;
export const rulebookSchema = z.array(z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  text: z.string().min(1).max(4000).refine(text => Boolean(text.trim())),
  checks: z.array(z.enum(moderationChecks)).default([])
}).strict()).max(100).refine(rows => new Set(rows.map(row => row.id)).size === rows.length, 'Rule IDs must be unique.')
  .refine(rows => rows.map(row => row.text).join('\n\n').length <= 4000, 'Use at most 4000 characters of published rules.');

export const rulesService = { serviceId: 'official.community-admin.rules.v1', methods: [{ name: 'getPublished', access: 'read' as const }] };
export function publicRules(config: ModerationConfig) {
  const text = (config.rulebook ?? []).map(rule => rule.text).join('\n\n').trim();
  return { text, revision: createHash('sha256').update(text).digest('hex') };
}
export function registerRules(read: (scopeId: string) => Promise<ModerationConfig>): PluginServiceRegistration {
  return { serviceId: rulesService.serviceId, methods: [{
    name: 'getPublished', access: 'read', inputSchema: z.object({}).strict(),
    outputSchema: z.object({ text: z.string(), revision: z.string() }).nullable(),
    async handler(_, call) { const config = await read(call.scopeId); return config.enabled ? publicRules(config) : null; }
  }] };
}
