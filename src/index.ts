import type { ManagedGroupPlugin } from '@wabs/plugin-sdk/managed-group-plugin';
import { registerModerationCommands } from './commands';
import { createModerationHooks } from './hooks';
import { moderationManifest } from './manifest';

export const moderationPlugin: ManagedGroupPlugin = {
  manifest: moderationManifest,
  registerCommands(context) {
    registerModerationCommands(context);
  },
  registerHooks(context) {
    return createModerationHooks(context as unknown as Parameters<typeof createModerationHooks>[0]);
  }
};

export default moderationPlugin;
