const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { moderationMessages } = require('../dist/messages');

const MIGRATIONS = path.join(__dirname, '../migrations/moderation');

function openDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderation-'));
  const filePath = path.join(dir, 'moderation.sqlite');
  const sqlite = new DatabaseSync(filePath);
  for (const file of fs.readdirSync(MIGRATIONS).sort()) sqlite.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  const db = {
    name: 'moderation', filePath,
    exec: sql => sqlite.exec(sql),
    prepare: sql => sqlite.prepare(sql),
    get: (sql, ...args) => sqlite.prepare(sql).get(...args),
    all: (sql, ...args) => sqlite.prepare(sql).all(...args),
    run: (sql, ...args) => sqlite.prepare(sql).run(...args),
    close: () => sqlite.close(),
    transaction(operation) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const value = operation(); sqlite.exec('COMMIT'); return value; } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
  return { db, registry: { open: name => { if (name !== 'moderation') throw new Error('undeclared db ' + name); return db; }, closeAll() {} } };
}

function t(key, params = {}) {
  const template = moderationMessages[key] ?? key;
  return template.replace(/\{([a-zA-Z]+)\}/gu, (_, name) => (name in params ? String(params[name]) : `{${name}}`));
}

function person(name, number) {
  const wid = `${number}@s.whatsapp.net`;
  const lid = `${number}9@lid`;
  return {
    identityId: `identity-${name}`, displayName: name, canonicalWid: wid, originalWid: wid, mentionWid: wid,
    deliveryChatId: wid, addressBookWid: wid, phoneWid: wid, lidWid: lid, phoneWids: [wid], lidWids: [lid], aliases: [wid, lid], dedupeKey: wid
  };
}

/**
 * A fake host. `groups` are the scope's covered groups ({ groupWid, name, mode, parent?, members: [[person, admin?]] }).
 * Works for a community (groups with a parent) and for standalone groups (no parent).
 */
function host({ groups, config = {}, holders, now = new Date('2026-11-21T12:00:00Z') }) {
  const { db, registry } = openDatabase();
  const people = new Map();
  const participants = new Map();
  for (const group of groups) {
    participants.set(group.groupWid, group.members.map(([who, admin]) => {
      for (const address of who.aliases) people.set(address, who);
      return { wid: who.canonicalWid, isAdmin: Boolean(admin), isSuperAdmin: false };
    }));
  }
  const bot = person('Bot', '351900000000');
  const owner = person('Owner', '351900000001');
  for (const who of [bot, owner]) for (const address of who.aliases) people.set(address, who);
  const store = new Map();
  const jobs = [];
  const context = {
    pluginId: 'official.community-admin',
    databases: registry,
    configFor: async () => ({ enabled: true, dryRun: false, ...config }),
    coveredGroupsForScope: async scopeId => groups.map(group => ({
      scopeId, groupId: group.groupWid, groupWid: group.groupWid, groupDisplayName: group.name, managementMode: group.mode ?? 'MANAGE'
    })),
    getGroupParticipants: async groupWid => participants.get(groupWid) ?? [],
    communityParentGroupWidForGroup: async groupWid => groups.find(group => group.groupWid === groupWid)?.parent,
    resolveIdentityAddress: async wid => { const who = people.get(wid); if (!who) throw new Error('unknown ' + wid); return who; },
    resolveStableIdentityById: async id => { const who = [...people.values()].find(candidate => candidate.identityId === id); if (!who) throw new Error('unknown ' + id); return who; },
    protectedWidsForActions: async () => [owner.canonicalWid],
    // `holders`: the moderators a core API 0.3.26 host lists (the bot is always there, as the account owner);
    // 'throws' makes the capability fail; absent means an older host without it.
    ...(holders === undefined ? {} : { permissionHoldersForScope: async ({ permission }) => {
      if (holders === 'throws') throw new Error('unavailable');
      if (permission !== 'plugin.community-admin.moderate') throw new Error('not declared: ' + permission);
      return [{ identityId: bot.identityId, via: ['owner'] }, ...holders.map(who => ({ identityId: who.identityId, via: ['exception'] }))];
    } }),
    getCurrentBotWid: async () => bot.canonicalWid,
    listEnabledScopes: async () => [{ scopeId: 'scope-1', kind: 'COMMUNITY_LIKE', name: 'Climbers' }],
    enqueuePluginJob: async job => { jobs.push(job); },
    i18n: { translatorForScope: async () => t, translatorForIdentity: async () => t, translator: () => t },
    ephemeralStore: {
      get: async key => store.get(key)?.value,
      set: async (key, value) => { store.set(key, { value }); },
      setIfAbsent: async (key, value) => { if (store.has(key)) return false; store.set(key, { value }); return true; },
      delete: async key => (store.delete(key) ? 1 : 0),
      increment: async key => { const next = (store.get(key)?.value ?? 0) + 1; store.set(key, { value: next }); return next; },
      admitRateLimit: async () => 'allowed'
    },
    now: () => now
  };
  const commands = new Map();
  context.pluginId = 'official.community-admin';
  context.manifest = require('../dist/manifest').moderationManifest;
  context.dataStore = { get: async key => store.get(key), set: async (key,val) => store.set(key,val), delete: async key => store.delete(key) };
  context.flowEngine = { registerDefinitionResolver() {} };
  context.router = { register(namespace, subcommand, metadata, handler) { commands.set(`${namespace} ${subcommand}`, { metadata, handler }); } };
  return { context, db, people, participants, jobs, bot, owner, commands, setNow: value => { now = value; } };
}

/** Runs a registered command as if `actor` typed it in `groupWid`. */
async function run(h, actor, line, { groupWid, mentions = [], replyTo, mode = 'MANAGE', scopeId = 'scope-1' } = {}) {
  const [namespace, maybeSub, ...rest] = line.replace(/^\//u, '').split(/\s+/u);
  const key = h.commands.has(`${namespace} ${maybeSub}`) ? `${namespace} ${maybeSub}` : `${namespace} *`;
  const command = h.commands.get(key);
  if (!command) throw new Error('no command ' + line);
  const args = key.endsWith('*') ? [maybeSub, ...rest].filter(Boolean) : rest;
  return command.handler({
    message: { id: `msg-${Math.random()}`, chatId: groupWid, body: line, mentions: mentions.map(who => ({ wid: who.canonicalWid, token: '@' })), replyTo, type: 'chat', links: [], hasMedia: false, fromMe: false, timestamp: new Date() },
    command: { namespace, subcommand: key.endsWith('*') ? undefined : maybeSub, args, rawArgs: args.join(' '), mentions: mentions.map(who => who.canonicalWid), rawBody: line },
    actor: { wid: actor.canonicalWid, identityAddress: actor, fromMe: false },
    scopeId, groupWid, managementMode: mode, t, locale: 'en-GB', remainingArgs: args
  });
}

function types(actions = []) {
  return actions.map(action => action.type);
}

module.exports = { openDatabase, host, person, run, t, types };
