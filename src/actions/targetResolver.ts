import type { ManagedGroupCommandContext } from '@wabs/plugin-sdk/managed-group-plugin';
import type { DoasExecutionTarget } from './actionPlanner';

export type DoasFanoutMode = 'children' | 'all';

export async function resolveDoasFanoutTargets(input: {
  context: Pick<ManagedGroupCommandContext, 'coveredGroupsForScope' | 'communityGroupWidForScope'>;
  scopeId: string;
  rootGroupWid: string;
  mode: DoasFanoutMode;
  includeParentByDefault: boolean;
}): Promise<DoasExecutionTarget[]> {
  const groups = await input.context.coveredGroupsForScope?.(input.scopeId) ?? [];
  if (!groups.some(group => group.groupWid === input.rootGroupWid)) return [];
  const parent = await input.context.communityGroupWidForScope?.(input.scopeId);
  if (!parent) return [];
  return groups.filter(group => group.managementMode === 'MANAGE' &&
    (group.groupWid !== parent || input.mode === 'all' || input.includeParentByDefault))
    .map(group => ({ groupId: group.groupId, groupWid: group.groupWid, label: group.groupDisplayName ?? group.groupWid }));
}
