import type { PluginPermissionHoldersForScope } from '@wabs/plugin-sdk/permission-holders';

export async function protectiveTarget(context: { permissionHoldersForScope?: PluginPermissionHoldersForScope | undefined },
  scopeId: string, actorIdentityId: string, targetIdentityId: string): Promise<boolean> {
  if (!context.permissionHoldersForScope) return true;
  const holders = await context.permissionHoldersForScope({ scopeId, permission: 'plugin.community-admin.moderate' });
  const target = holders.find(member => member.identityId === targetIdentityId);
  if (!target) return false;
  if (target.via.some(source => source === 'owner' || source === 'subowner')) return true;
  const actor = holders.find(member => member.identityId === actorIdentityId);
  if (actor?.via.some(source => source === 'owner' || source === 'subowner')) return false;
  const senior = await context.permissionHoldersForScope({ scopeId, permission: 'plugin.community-admin.structure' });
  return senior.some(member => member.identityId === targetIdentityId) || !senior.some(member => member.identityId === actorIdentityId);
}
