import { z } from 'zod';

export const doasConfigSchema = z.object({
  enabled: z.boolean().default(false),
  joinApproval: z.object({ policy: z.enum(['leave', 'require']).default('leave') }).default({}),
  requireConfirmForHighRisk: z.boolean().default(true),
  fanout: z.object({
    enabled: z.boolean().default(false),
    requireExplicitFlag: z.boolean().default(true),
    maxTargets: z.number().int().positive().max(250).default(25),
    includeParentByDefault: z.boolean().default(false)
  }).default({})
}).default({});

export type DoasConfig = z.infer<typeof doasConfigSchema>;

export function parseDoasConfig(input: unknown): DoasConfig {
  return doasConfigSchema.parse(input);
}
