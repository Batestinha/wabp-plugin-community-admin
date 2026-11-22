import { z } from 'zod';
import { communitySubgroupCreationPolicySchema } from './creationPolicy';

export const communitySubgroupsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxParticipants: z.number().int().positive().max(256).default(128),
  joinApproval: z.object({ policy: z.enum(['leave', 'require']).default('leave') }).default({}),
  creationPolicy: communitySubgroupCreationPolicySchema
}).default({});

export type CommunitySubgroupsConfig = z.infer<typeof communitySubgroupsConfigSchema>;

export function parseCommunitySubgroupsConfig(input: unknown): CommunitySubgroupsConfig {
  const config = communitySubgroupsConfigSchema.parse(input);
  if (config.joinApproval.policy === 'require') config.creationPolicy.joinApproval = true;
  return config;
}
