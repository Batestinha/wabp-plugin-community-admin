export const MODERATION_PLUGIN_ID = 'official.moderation';
export const MODERATION_NAMESPACE = MODERATION_PLUGIN_ID;
export const MODERATION_VERSION = '0.1.1';
export const MODERATION_CORE_API_RANGE = '^0.3.24';
export const MODERATION_DATABASE = 'moderation';
export const MODERATION_MANAGE_PERMISSION = 'plugin.moderation.manage';
export const MODERATION_REPORT_PERMISSION = 'plugin.moderation.report';

export const SUSPENSION_END_JOB = 'suspension.end';
export const LOCK_EXPIRE_JOB = 'lock.expire';

export const MODERATION_DANGEROUS_ACTIONS = [
  'message.delete',
  'group.removeParticipant',
  'group.addParticipantsWithHistory',
  'group.rejectMembershipRequest',
  'group.lockMessages',
  'group.unlockMessages',
  'group.revokeInvite',
  'member.setStanding',
  'member.clearStanding'
] as const;

export const MODERATION_COMMANDS = [
  '/mod status',
  '/mod suspend',
  '/mod expel',
  '/mod lift',
  '/mod extend',
  '/mod cases',
  '/mod warn',
  '/mod pardon',
  '/mod warnings',
  '/mod lock',
  '/mod unlock',
  '/mod test',
  '/mod resolve',
  '/report'
];

export const DAY_MS = 24 * 60 * 60 * 1000;
