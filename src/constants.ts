export const MODERATION_PLUGIN_ID = 'official.community-admin';
export const MODERATION_NAMESPACE = MODERATION_PLUGIN_ID;
export const MODERATION_VERSION = '1.0.8';
export const MODERATION_CORE_API_RANGE = '^0.3.29';
export const MODERATION_DATABASE = 'moderation';
export const MODERATION_MANAGE_PERMISSION = 'plugin.community-admin.moderate';

export const SUSPENSION_END_JOB = 'suspension.end';
export const LOCK_EXPIRE_JOB = 'lock.expire';

export const MODERATION_DANGEROUS_ACTIONS = [
  'message.delete',
  'group.removeParticipant',
  'group.addParticipant',
  'group.rejectMembershipRequest',
  'group.lockMessages',
  'group.unlockMessages',
  'group.revokeInvite',
  'member.setStanding',
  'member.clearStanding'
] as const;

export const MODERATION_COMMANDS = [
  '/admin status',
  '/admin suspend',
  '/admin expel',
  '/admin lift',
  '/admin extend',
  '/admin cases',
  '/admin warn',
  '/admin pardon',
  '/admin warnings',
  '/admin lock',
  '/admin unlock',
  '/admin test',
  '/admin resolve',
  '/report'
];

export const DAY_MS = 24 * 60 * 60 * 1000;
