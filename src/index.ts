import type { ManagedGroupPlugin } from '@wabs/plugin-sdk/managed-group-plugin';
import { registerDoasCommands } from './actions/commands';
import { registerDoasAssistantTools } from './actions/assistantTools';
import { registerCommunitySubgroupCommands } from './subgroups/commands';
import { registerCommunitySubgroupServices } from './subgroups/service';
import { registerModerationCommands } from './commands';
import { createModerationHooks } from './hooks';
import { moderationManifest } from './manifest';

export const moderationPlugin: ManagedGroupPlugin = {
  manifest: moderationManifest,
  registerCommands(context) {
    registerModerationCommands(context);
    registerDoasCommands(context);
    registerCommunitySubgroupCommands(context);
  },
  registerAssistantTools: registerDoasAssistantTools,
  registerServices: registerCommunitySubgroupServices,
  registerHooks(context) {
    return createModerationHooks(context as unknown as Parameters<typeof createModerationHooks>[0]);
  }
};

export default moderationPlugin;
