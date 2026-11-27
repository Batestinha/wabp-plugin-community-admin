import { moderationChecks } from './rulebook';
import { moderationConfigPaths } from './config';
import { MODERATION_PLUGIN_ID } from './constants';

/** Package-level console metadata; written into wa-plugin.json by scripts/write-metadata.cjs. */
export interface ModerationControl {
  id: string;
  path: string;
  label: string;
  description: string;
  section: string;
  order: number;
  schema: Record<string, unknown>;
  ui: Record<string, unknown>;
}

const POLICIES = [
  { value: 'off', label: 'Off' },
  { value: 'audit', label: 'Record only' },
  { value: 'warn', label: 'Warn' },
  { value: 'delete', label: 'Delete' },
  { value: 'delete-and-warn', label: 'Delete and warn' }
];
const SPAM_POLICIES = [...POLICIES, { value: 'expel-new-members', label: 'Expel new members' }];

let order = 0;
function control(section: string, path: string, label: string, description: string, schema: Record<string, unknown>, widget: string): ModerationControl {
  order += 10;
  return { id: `plugin.${MODERATION_PLUGIN_ID}.${path}`, path, label, description, section, order, schema, ui: { widget, helpText: description } };
}
const toggle = (section: string, path: string, label: string, description: string) => control(section, path, label, description, { type: 'boolean' }, 'toggle');
const number = (section: string, path: string, label: string, description: string, min: number, max: number, unit?: string) =>
  control(section, path, label, description, { type: 'number', min, max, ...(unit ? { unit } : {}) }, 'number');
const tags = (section: string, path: string, label: string, description: string) =>
  control(section, path, label, description, { type: 'array', items: { type: 'string' } }, 'tags');
const text = (section: string, path: string, label: string, description: string, max: number) =>
  ({ ...control(section, path, label, description, { type: 'string', max }, 'text'), ui: { widget: 'text', multiline: true, helpText: description } });
const choice = (section: string, path: string, label: string, description: string, values: Array<{ value: string; label: string }>) =>
  control(section, path, label, description, { type: 'enum', enum: values }, 'select');

const GENERAL = 'People and roles';
const CASES = 'Suspensions and expulsions';
const SHIELD = 'Spam and raid shield';
const ETIQUETTE = 'Group etiquette';

const groupCreationControls: ModerationControl[] = [
  {
    "id": "plugin.official.community-admin.maxParticipants",
    "path": "maxParticipants",
    "label": "Maximum members",
    "description": "Maximum number of requested members in one subgroup creation flow.",
    "section": "Group creation",
    "order": 30,
    "schema": {
      "type": "number",
      "unit": "items",
      "min": 1,
      "max": 256
    },
    "ui": {
      "widget": "number",
      "helpText": "Maximum number of requested members in one subgroup creation flow."
    }
  },
  {
    "id": "plugin.official.community-admin.creationPolicy.infoEditPermission",
    "path": "creationPolicy.infoEditPermission",
    "label": "Edit group info",
    "description": "Choose who can edit the new subgroup name, icon, description, and settings.",
    "section": "Group creation",
    "order": 110,
    "schema": {
      "type": "enum",
      "enum": [
        {
          "value": "all_members",
          "label": "All members"
        },
        {
          "value": "admins_only",
          "label": "Only admins"
        }
      ]
    },
    "ui": {
      "widget": "select",
      "options": [
        {
          "value": "all_members",
          "label": "All members"
        },
        {
          "value": "admins_only",
          "label": "Only admins"
        }
      ],
      "helpText": "Choose who can edit the new subgroup name, icon, description, and settings."
    }
  },
  {
    "id": "plugin.official.community-admin.creationPolicy.sendMessagesPermission",
    "path": "creationPolicy.sendMessagesPermission",
    "label": "Send messages",
    "description": "Choose whether all members or only admins can send messages in new subgroups.",
    "section": "Group creation",
    "order": 120,
    "schema": {
      "type": "enum",
      "enum": [
        {
          "value": "all_members",
          "label": "All members"
        },
        {
          "value": "admins_only",
          "label": "Only admins"
        }
      ]
    },
    "ui": {
      "widget": "select",
      "options": [
        {
          "value": "all_members",
          "label": "All members"
        },
        {
          "value": "admins_only",
          "label": "Only admins"
        }
      ],
      "helpText": "Choose whether all members or only admins can send messages in new subgroups."
    }
  },
  {
    "id": "plugin.official.community-admin.creationPolicy.memberAddPermission",
    "path": "creationPolicy.memberAddPermission",
    "label": "Add members / invite links",
    "description": "Choose who can add members and create or share invite links in new subgroups.",
    "section": "Group creation",
    "order": 130,
    "schema": {
      "type": "enum",
      "enum": [
        {
          "value": "all_members",
          "label": "All members"
        },
        {
          "value": "admins_only",
          "label": "Only admins"
        }
      ]
    },
    "ui": {
      "widget": "select",
      "options": [
        {
          "value": "all_members",
          "label": "All members"
        },
        {
          "value": "admins_only",
          "label": "Only admins"
        }
      ],
      "helpText": "Choose who can add members and create or share invite links in new subgroups."
    }
  },
  {
    "id": "plugin.official.community-admin.creationPolicy.joinApproval",
    "path": "creationPolicy.joinApproval",
    "label": "Approve new members",
    "description": "Require admins to approve new subgroup join requests.",
    "section": "Group creation",
    "order": 140,
    "schema": {
      "type": "boolean"
    },
    "ui": {
      "widget": "toggle",
      "helpText": "Require admins to approve new subgroup join requests."
    }
  },
  {
    "id": "plugin.official.community-admin.creationPolicy.disappearingMessages",
    "path": "creationPolicy.disappearingMessages",
    "label": "Disappearing messages",
    "description": "Set the disappearing-message timer for new subgroups.",
    "section": "Group creation",
    "order": 150,
    "schema": {
      "type": "enum",
      "enum": [
        {
          "value": "off",
          "label": "Off"
        },
        {
          "value": "24h",
          "label": "24 hours"
        },
        {
          "value": "7d",
          "label": "7 days"
        },
        {
          "value": "90d",
          "label": "90 days"
        }
      ]
    },
    "ui": {
      "widget": "select",
      "options": [
        {
          "value": "off",
          "label": "Off"
        },
        {
          "value": "24h",
          "label": "24 hours"
        },
        {
          "value": "7d",
          "label": "7 days"
        },
        {
          "value": "90d",
          "label": "90 days"
        }
      ],
      "helpText": "Set the disappearing-message timer for new subgroups."
    }
  },
  {
    "id": "plugin.official.community-admin.creationPolicy.historySharePermission",
    "path": "creationPolicy.historySharePermission",
    "label": "Who can share message history",
    "description": "Choose who may share this group's message history when WhatsApp offers that choice. This does not turn on WhatsApp's history-sending feature.",
    "section": "Group creation",
    "order": 160,
    "schema": {
      "type": "enum",
      "enum": [
        {
          "value": "all_members",
          "label": "All members"
        },
        {
          "value": "admins_only",
          "label": "Only admins"
        }
      ]
    },
    "ui": {
      "widget": "select",
      "options": [
        {
          "value": "all_members",
          "label": "All members"
        },
        {
          "value": "admins_only",
          "label": "Only admins"
        }
      ],
      "helpText": "Choose who may share message history when WhatsApp offers that choice. This does not turn history sending on."
    }
  },
  {
    "id": "plugin.official.community-admin.creationPolicy.parentGroupCreatePermission",
    "path": "creationPolicy.parentGroupCreatePermission",
    "label": "Who can create groups",
    "description": "Choose who can create groups in the parent community.",
    "section": "Group creation",
    "order": 200,
    "schema": {
      "type": "enum",
      "enum": [
        {
          "value": "everyone",
          "label": "Everyone"
        },
        {
          "value": "community_admins",
          "label": "Only community admins"
        }
      ]
    },
    "ui": {
      "widget": "select",
      "options": [
        {
          "value": "everyone",
          "label": "Everyone"
        },
        {
          "value": "community_admins",
          "label": "Only community admins"
        }
      ],
      "helpText": "Choose who can create groups in the parent community."
    }
  },
  {
    "id": "plugin.official.community-admin.creationPolicy.parentMemberAddPermission",
    "path": "creationPolicy.parentMemberAddPermission",
    "label": "Who can add members",
    "description": "Choose who can add new members to the parent community.",
    "section": "Group creation",
    "order": 210,
    "schema": {
      "type": "enum",
      "enum": [
        {
          "value": "everyone",
          "label": "Everyone"
        },
        {
          "value": "community_admins",
          "label": "Only community admins"
        }
      ]
    },
    "ui": {
      "widget": "select",
      "options": [
        {
          "value": "everyone",
          "label": "Everyone"
        },
        {
          "value": "community_admins",
          "label": "Only community admins"
        }
      ],
      "helpText": "Choose who can add new members to the parent community."
    }
  }
];

export const moderationControls: ModerationControl[] = [
  text('Group rules', 'legacyRulesForReview', 'Previous onboarding wording', 'Review any previous wording that differed when the rules moved here.', 4000),
  control('Group rules', 'rulebook', 'Published group rules', 'Members see these rules in order. Use a stable ID for each rule. Moderators review rules without an automatic check.', {
    type: 'array', items: { type: 'object', properties: {
      id: { type: 'string', required: true }, text: { type: 'string', required: true, max: 4000 },
      checks: { type: 'array', items: { type: 'enum', enum: moderationChecks.map(value => ({ value, label: value })) } }
    } }
  }, 'json'),
  toggle(GENERAL, 'enabled', 'Enabled', 'Enable the assistant here. Assign Group Admin and Community Admin on the Access page.'),
  choice('Join approval', 'joinApproval.policy', 'Require approval in managed groups', 'Apply to existing and new standalone groups and community subgroups that members can join directly.',
    [{ value: 'leave', label: 'Keep existing settings' }, { value: 'require', label: 'Require approval' }]),
  toggle('Join approval', 'joinApproval.autoApprove', 'Automatically approve other members', 'Approve requests from members without a hold while no raid lock is active.'),
  toggle('Admin actions', 'requireConfirmForHighRisk', 'Confirm high-risk actions', 'Require confirmation before high-risk admin actions.'),
  toggle('Admin actions', 'fanout.enabled', 'Community-wide actions', 'Allow authorized actions in multiple managed groups.'),
  toggle('Admin actions', 'fanout.requireExplicitFlag', 'Require an explicit fan-out flag', 'Require the command to select multiple groups explicitly.'),
  number('Admin actions', 'fanout.maxTargets', 'Maximum groups per command', 'Limit community-wide actions to this many groups.', 1, 250),
  toggle('Admin actions', 'fanout.includeParentByDefault', 'Include the community parent', 'Include the parent in a community-wide action by default.'),
  ...groupCreationControls,
  toggle(GENERAL, 'dryRun', 'Dry run', 'Only record what would happen in the audit log; nothing is deleted, removed or sent.'),
  tags(GENERAL, 'exemptGroupChatIds', 'Exempt groups', 'Groups of this scope where moderation never acts.'),
  toggle(GENERAL, 'reports.enabled', 'Member reports', 'Let members report a message to the admins with /report.'),
  number(GENERAL, 'warnings.ttlDays', 'Warnings last', 'Days a warning stays active.', 1, 365, 'days'),
  number(GENERAL, 'warnings.alertAt', 'Alert admins at', 'Tell the admins when a member reaches this many active warnings.', 1, 50),

  number(CASES, 'suspension.defaultDays', 'Default suspension', 'Length of a suspension when the command gives none.', 1, 365, 'days'),
  number(CASES, 'suspension.maxDays', 'Longest suspension', 'Longest suspension an admin may give.', 1, 3650, 'days'),
  text(CASES, 'suspension.noticeExtra', 'Suspension notice extra', 'Extra text added to the private message a suspended member receives, for example where to keep reading the group history.', 1000),
  text(CASES, 'expulsion.noticeExtra', 'Expulsion notice extra', 'Extra text added to the private message an expelled member receives.', 1000),

  number(SHIELD, 'shield.newMemberHours', 'New member period (hours)', 'Hours after joining during which spam can lead to automatic expulsion.', 1, 720),
  choice(SHIELD, 'shield.inviteLinkPolicy', 'Group invite links', 'What to do with WhatsApp group or channel invite links.', SPAM_POLICIES),
  choice(SHIELD, 'shield.linkPolicy', 'Other links', 'What to do with links outside the allowed sites (or to the blocked sites, when listed).', POLICIES),
  tags(SHIELD, 'shield.allowedDomains', 'Allowed sites', 'Sites whose links are always fine.'),
  tags(SHIELD, 'shield.blockedDomains', 'Blocked sites', 'When set, only links to these sites count as violations.'),
  tags(SHIELD, 'shield.bannedPhrases', 'Banned phrases', 'Words or phrases that are not allowed.'),
  choice(SHIELD, 'shield.bannedPhrasePolicy', 'Banned phrase action', 'What to do when a banned phrase appears.', POLICIES),
  toggle(SHIELD, 'shield.flood.enabled', 'Flood protection', 'Act when someone sends too many messages at once.'),
  number(SHIELD, 'shield.flood.maxMessages', 'Flood messages', 'Messages allowed within the flood window.', 2, 500),
  number(SHIELD, 'shield.flood.windowSeconds', 'Flood window', 'Length of the flood window.', 5, 3600, 'seconds'),
  choice(SHIELD, 'shield.flood.policy', 'Flood action', 'What to do with a flood.', SPAM_POLICIES),
  toggle(SHIELD, 'shield.raid.enabled', 'Raid protection', 'Lock a group briefly when many people join at once.'),
  number(SHIELD, 'shield.raid.maxJoins', 'Raid joins', 'Joins within the raid window that count as a raid.', 2, 1000),
  number(SHIELD, 'shield.raid.windowSeconds', 'Raid window', 'Length of the raid window.', 10, 86_400, 'seconds'),
  number(SHIELD, 'shield.raid.lockMinutes', 'Raid lock', 'How long the group stays admin-only after a raid.', 1, 1440, 'minutes'),
  toggle(SHIELD, 'shield.raid.revokeInvite', 'Reset invite link on raid', 'Also reset the group invite link when a raid is detected.'),

  toggle(ETIQUETTE, 'etiquette.stickerBurst.enabled', 'Sticker bursts', 'Act when someone sends many stickers in a row.'),
  number(ETIQUETTE, 'etiquette.stickerBurst.maxStickers', 'Stickers allowed', 'Stickers allowed within the window.', 1, 100),
  number(ETIQUETTE, 'etiquette.stickerBurst.windowSeconds', 'Sticker window', 'Length of the sticker window.', 5, 3600, 'seconds'),
  choice(ETIQUETTE, 'etiquette.stickerBurst.policy', 'Sticker burst action', 'What to do with a sticker burst.', POLICIES),
  toggle(ETIQUETTE, 'etiquette.forwardedChains.enabled', 'Forwarded chains', 'Act on forwarded chain messages.'),
  choice(ETIQUETTE, 'etiquette.forwardedChains.policy', 'Forwarded action', 'What to do with forwarded messages.', POLICIES),
  tags(ETIQUETTE, 'etiquette.mediaBlockedGroupChatIds', 'No-media groups', 'Groups where photos, videos and documents are not allowed.'),
  choice(ETIQUETTE, 'etiquette.mediaPolicy', 'Media action', 'What to do with media in a no-media group.', POLICIES),
  toggle(ETIQUETTE, 'etiquette.quietHours.enabled', 'Quiet hours', 'Act on messages sent during quiet hours.'),
  control(ETIQUETTE, 'etiquette.quietHours.start', 'Quiet from', 'Start of quiet hours (HH:MM).', { type: 'string', max: 5 }, 'text'),
  control(ETIQUETTE, 'etiquette.quietHours.end', 'Quiet until', 'End of quiet hours (HH:MM).', { type: 'string', max: 5 }, 'text'),
  control(ETIQUETTE, 'etiquette.quietHours.timezone', 'Quiet hours time zone', 'IANA time zone, for example Europe/Lisbon.', { type: 'string', max: 64 }, 'text'),
  tags(ETIQUETTE, 'etiquette.quietHours.groupChatIds', 'Quiet hours groups', 'Groups with quiet hours; empty means every group here.'),
  choice(ETIQUETTE, 'etiquette.quietHours.policy', 'Quiet hours action', 'What to do with messages during quiet hours.', POLICIES)
];

export { moderationConfigPaths };
