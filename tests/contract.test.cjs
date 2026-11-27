const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validatePluginManifest, pluginIdentityProblem } = require('@wabs/plugin-sdk/manifest');
const { isDangerousPluginActionType } = require('@wabs/plugin-sdk/actions');
const plugin = require('../dist/index.js').default;
const { moderationConfigPaths } = require('../dist/config');
const metadata = require('../wa-plugin.json');

test('wa-plugin.json matches the compiled manifest and declares its own title and author', () => {
  assert.equal(validatePluginManifest(plugin.manifest), plugin.manifest);
  assert.equal(metadata.schemaVersion, 3);
  assert.equal(pluginIdentityProblem(metadata.pluginId, { name: metadata.name, author: metadata.author }), undefined);
  for (const key of ['pluginId', 'name', 'author', 'version', 'coreApiRange', 'messageNamespace', 'commands', 'eventSubscriptions',
    'dangerousActions', 'backgroundJobs', 'databases', 'requiredPermissions']) {
    assert.deepEqual(plugin.manifest[key], metadata[key], key);
  }
  assert.equal(require('../package.json').version, metadata.version);
});

test('every dangerous action is a real host action, including member standings', () => {
  // The vendored SDK 0.3.40 predates these host actions. The platform release that
  // runs this plugin treats them as dangerous, so the manifest must name them.
  const hostActionsAfterVendoredSdk = new Set([
    'group.sendHistoryBundle',
    'group.setHistoryShareMode',
    'community.setMemberAddEveryoneAllowed'
  ]);
  for (const action of metadata.dangerousActions) {
    assert.ok(isDangerousPluginActionType(action) || hostActionsAfterVendoredSdk.has(action), action);
  }
  assert.ok(metadata.dangerousActions.includes('member.setStanding'));
  assert.ok(metadata.dangerousActions.includes('member.clearStanding'));
});

test('every configuration path has a console control and Portuguese covers every message', () => {
  assert.deepEqual([...metadata.operatorConsole.configPaths].sort(), moderationConfigPaths().sort());
  assert.deepEqual(metadata.operatorConsole.internalConfigPaths, []);
  const pt = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/pt-PT', metadata.messageNamespace + '.json')));
  for (const key of Object.keys(plugin.manifest.defaultMessages)) assert.ok(pt[key]?.trim(), key);
  assert.equal(plugin.lifecycle, undefined);
});

test('the plugin knows nothing about any particular host history service', () => {
  const sources = fs.readdirSync(path.join(__dirname, '../src'), { recursive: true }).filter(file => file.endsWith('.ts')).map(file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /chat ?archive|topomare/iu);
});
