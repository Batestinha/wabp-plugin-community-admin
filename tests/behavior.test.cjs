const assert = require('node:assert/strict');
const { test } = require('node:test');
const plugin = require('../dist').default;
const { host, person, run, types } = require('./helpers.cjs');

const ana = person('Ana', '351910000001');
const rui = person('Rui', '351910000002');
const eva = person('Eva', '351910000003');

function community(config, holders = [ana]) {
  const h = host({
    config,
    holders,
    groups: [
      { groupWid: 'parent@g.us', name: 'Climbers', members: [[ana, true], [rui], [eva]] },
      { groupWid: 'main@g.us', name: 'Main', parent: 'parent@g.us', members: [[ana, true], [rui], [eva, true]] },
      { groupWid: 'event@g.us', name: 'Saturday', parent: 'parent@g.us', members: [[rui], [eva, true]] },
      { groupWid: 'watch@g.us', name: 'Watch only', parent: 'parent@g.us', mode: 'OBSERVE', members: [[rui]] }
    ]
  });
  plugin.registerCommands(h.context);
  return h;
}

test('a suspension records the standing first, removes the member from every managed group and schedules the end', async () => {
  const h = community();
  const result = await run(h, ana, '/admin suspend 7d insults', { groupWid: 'main@g.us', mentions: [rui] });
  assert.match(result.text, /Rui is suspended until .*Removed from 3 group\(s\)\./u);
  assert.deepEqual(types(result.pluginActions), [
    'audit.record', 'member.setStanding', 'group.removeParticipant', 'group.removeParticipant', 'group.removeParticipant',
    'message.sendText', 'plugin.enqueueJob'
  ]);
  const [, standing, ...rest] = result.pluginActions;
  assert.equal(standing.standing, 'suspended');
  assert.equal(standing.abortBatchOnFailure, true);
  assert.deepEqual(rest.filter(action => action.type === 'group.removeParticipant').map(action => action.groupWid).sort(),
    ['event@g.us', 'main@g.us', 'parent@g.us']);
  const notice = rest.find(action => action.type === 'message.sendText');
  assert.equal(notice.chatId, rui.deliveryChatId);
  assert.doesNotMatch(notice.text, /archive/iu);
  const job = rest.find(action => action.type === 'plugin.enqueueJob');
  assert.equal(job.jobName, 'suspension.end');
  assert.equal(job.runAt.toISOString(), '2026-11-28T12:00:00.000Z');
});

test('the operator notice text is appended verbatim, so hosts can point at their own history service', async () => {
  const h = community({ suspension: { noticeExtra: 'Keep reading at https://example.org/history' } });
  const result = await run(h, ana, '/admin suspend 2d spam', { groupWid: 'main@g.us', mentions: [rui] });
  const notice = result.pluginActions.find(action => action.type === 'message.sendText');
  assert.match(notice.text, /\n\nKeep reading at https:\/\/example\.org\/history$/u);
});

test('dry run only records the decision', async () => {
  const h = community({ dryRun: true });
  const result = await run(h, ana, '/admin expel spam', { groupWid: 'main@g.us', mentions: [rui] });
  assert.deepEqual(types(result.pluginActions), ['audit.record']);
  assert.match(result.text, /dry run/u);
});

test('by default anyone the host lets run /admin moderates; nobody needs to be a WhatsApp admin', async () => {
  // Only the bot is an admin here, as in communities where people never get WhatsApp admin rights.
  const h = host({ holders: [eva], groups: [{ groupWid: 'solo@g.us', name: 'Solo', members: [[eva], [rui]] }] });
  plugin.registerCommands(h.context);
  const result = await run(h, eva, '/admin suspend 1d off-topic', { groupWid: 'solo@g.us', mentions: [rui] });
  assert.match(result.text, /Removed from 1 group\(s\)/u);
  const status = await run(h, eva, '/admin status', { groupWid: 'solo@g.us' });
  assert.match(status.text, /Authority: people allowed to moderate \(1\)\./u);
});

test('reports and alerts reach the moderators the host lists, never the bot, whoever the WhatsApp admins are', async () => {
  const h = community({}, [eva]);
  const reply = { messageId: 'bad-2', snapshot: { authorWid: rui.canonicalWid, type: 'chat', body: 'buy followers now', hasMedia: false } };
  const report = await run(h, rui, '/report spam', { groupWid: 'main@g.us', replyTo: reply });
  const alerts = report.pluginActions.filter(action => action.type === 'message.sendText' && action.chatId !== rui.deliveryChatId);
  assert.deepEqual(alerts.map(action => action.chatId), [eva.deliveryChatId]);
  assert.ok(!alerts.some(action => action.chatId === h.bot.deliveryChatId));
});

test('when the host cannot list moderators, reports remain private', async () => {
  const h = community({}, 'throws');
  const reply = { messageId: 'bad-4', snapshot: { authorWid: rui.canonicalWid, type: 'chat', body: 'spam', hasMedia: false } };
  const report = await run(h, eva, '/report', { groupWid: 'main@g.us', replyTo: reply });
  const alerts = report.pluginActions.filter(action => action.type === 'message.sendText' && action.chatId !== eva.deliveryChatId);
  assert.deepEqual(alerts.map(action => action.chatId), []);
});

test('moderators are never caught by automatic rules, like admins', async () => {
  const h = community({ shield: { inviteLinkPolicy: 'delete' } }, [rui]);
  const hooks = plugin.registerHooks(h.context);
  const result = await hooks.onMessage({
    pluginId: 'official.community-admin', scopeId: 'scope-1', groupWid: 'main@g.us', managementMode: 'MANAGE', receivedAt: new Date(),
    message: { id: 'm-mod', chatId: 'main@g.us', body: 'https://chat.whatsapp.com/AbCdEfGhIjKl', type: 'chat', hasMedia: false, links: [], mentions: [], fromMe: false, timestamp: new Date() },
    actor: { wid: rui.canonicalWid, identityAddress: rui, fromMe: false }, actorIdentityId: rui.identityId, actorWid: rui.canonicalWid, isCommandLike: false, mentionsBot: false
  });
  assert.equal(result, undefined);
});

test('the bot and its owners are never moderated', async () => {
  const h = community();
  const result = await run(h, ana, '/admin expel test', { groupWid: 'main@g.us', mentions: [h.bot] });
  assert.match(result.text, /cannot moderate the bot/u);
});

test('the rejoin guard removes a suspended member and rejects their join requests', async () => {
  const h = community();
  await run(h, ana, '/admin suspend 7d insults', { groupWid: 'main@g.us', mentions: [rui] });
  const hooks = plugin.registerHooks(h.context);
  const join = await hooks.onParticipantChange({
    pluginId: 'official.community-admin', scopeId: 'scope-1', groupWid: 'main@g.us', managementMode: 'MANAGE', receivedAt: new Date(),
    eventId: 'e1', chatId: 'main@g.us', action: 'join', botIdentityIds: [h.bot.identityId], affectedIdentities: [rui]
  });
  assert.ok(join.some(action => action.type === 'group.removeParticipant' && action.userWid === rui.canonicalWid));
  assert.ok(join.some(action => action.type === 'message.sendText' && action.chatId === ana.deliveryChatId));
  const request = await hooks.onParticipantChange({
    pluginId: 'official.community-admin', scopeId: 'scope-1', groupWid: 'event@g.us', managementMode: 'MANAGE', receivedAt: new Date(),
    eventId: 'e2', chatId: 'event@g.us', action: 'membership_request', botIdentityIds: [], affectedIdentities: [rui]
  });
  assert.ok(request.some(action => action.type === 'group.rejectMembershipRequest'));
});

test('the end job adds the member back where they were removed, clears the standing and tells them', async () => {
  const h = community();
  const suspended = await run(h, ana, '/admin suspend 7d insults', { groupWid: 'main@g.us', mentions: [rui] });
  const job = suspended.pluginActions.find(action => action.type === 'plugin.enqueueJob');
  const hooks = plugin.registerHooks(h.context);
  assert.equal(await hooks.onPluginJob({ pluginId: 'official.community-admin', scopeId: 'scope-1', receivedAt: new Date(),
    jobName: 'suspension.end', payload: job.payload, runAt: job.runAt }), undefined, 'too early');
  h.setNow(job.runAt);
  const ended = await hooks.onPluginJob({ pluginId: 'official.community-admin', scopeId: 'scope-1', receivedAt: new Date(),
    jobName: 'suspension.end', payload: job.payload, runAt: job.runAt });
  assert.deepEqual(types(ended), ['audit.record', 'member.clearStanding', 'group.addParticipant',
    'group.addParticipant', 'group.addParticipant', 'message.sendText']);
  // A plain add: the history variant isn't supported on whatsmeow and woke the host's WhatsApp Web provider.
  assert.ok(ended.filter(action => action.type === 'group.addParticipant').every(action => action.userWid === rui.canonicalWid));
  assert.ok(!ended.some(action => action.type === 'group.addParticipantsWithHistory'));
  assert.match(ended.at(-1).text, /suspension from Climbers has ended/u);
  assert.equal(await hooks.onPluginJob({ pluginId: 'official.community-admin', scopeId: 'scope-1', receivedAt: new Date(),
    jobName: 'suspension.end', payload: job.payload, runAt: job.runAt }), undefined, 'runs once');
});

test('the community announcement group is left to WhatsApp when the community group is covered', async () => {
  const h = host({
    groups: [
      { groupWid: 'parent@g.us', name: 'Climbers', members: [[ana, true], [rui]] },
      { groupWid: 'announce@g.us', name: 'Climbers', parent: 'parent@g.us', members: [[ana, true], [rui]] },
      { groupWid: 'main@g.us', name: 'Main', parent: 'parent@g.us', members: [[ana, true], [rui]] }
    ]
  });
  h.context.communityGroupWidForScope = async () => 'parent@g.us';
  h.context.communityAnnouncementGroupWidForScope = async () => 'announce@g.us';
  plugin.registerCommands(h.context);
  const result = await run(h, ana, '/admin suspend 1d spam', { groupWid: 'main@g.us', mentions: [rui] });
  const removed = result.pluginActions.filter(action => action.type === 'group.removeParticipant').map(action => action.groupWid).sort();
  assert.deepEqual(removed, ['main@g.us', 'parent@g.us']);
  assert.match(result.text, /Removed from 2 group\(s\)/u);
});

test('notices name the scope even when the context lists no scopes; an expulsion lift says expulsion', async () => {
  const h = community();
  delete h.context.listEnabledScopes;
  h.context.communityGroupWidForScope = async () => 'parent@g.us';
  plugin.registerCommands(h.context);
  const expelled = await run(h, ana, '/admin expel spam', { groupWid: 'main@g.us', mentions: [rui] });
  const notice = expelled.pluginActions.find(action => action.type === 'message.sendText' && action.chatId === rui.deliveryChatId);
  assert.match(notice.text, /groups of Climbers\./u);
  assert.doesNotMatch(notice.text, /scope-1/u);
  const lifted = await run(h, ana, '/admin lift', { groupWid: 'main@g.us', mentions: [rui] });
  const restored = lifted.pluginActions.find(action => action.type === 'message.sendText' && action.chatId === rui.deliveryChatId);
  assert.match(restored.text, /Your expulsion from Climbers has been lifted/u);
});

test('a lift re-adds to the subgroups only; WhatsApp puts the member back in the community itself', async () => {
  const h = community();
  h.context.communityGroupWidForScope = async () => 'parent@g.us';
  plugin.registerCommands(h.context);
  await run(h, ana, '/admin suspend 3d spam', { groupWid: 'main@g.us', mentions: [rui] });
  const lifted = await run(h, ana, '/admin lift', { groupWid: 'main@g.us', mentions: [rui] });
  const added = lifted.pluginActions.filter(action => action.type === 'group.addParticipant').map(action => action.groupWid).sort();
  assert.deepEqual(added, ['event@g.us', 'main@g.us']);
  assert.match(lifted.text, /Adding them back to 2 group\(s\)/u);
});

test('lift ends an expulsion on request and extend moves the end date', async () => {
  const h = community();
  await run(h, ana, '/admin expel spam', { groupWid: 'main@g.us', mentions: [eva] });
  const lifted = await run(h, ana, '/admin lift', { groupWid: 'main@g.us', mentions: [eva] });
  assert.match(lifted.text, /expulsion of Eva is lifted/u);
  assert.ok(lifted.pluginActions.some(action => action.type === 'member.clearStanding'));

  await run(h, ana, '/admin suspend 3d spam', { groupWid: 'main@g.us', mentions: [rui] });
  const extended = await run(h, ana, '/admin extend 4d', { groupWid: 'main@g.us', mentions: [rui] });
  const job = extended.pluginActions.find(action => action.type === 'plugin.enqueueJob');
  assert.equal(job.runAt.toISOString(), '2026-11-28T12:00:00.000Z');
});

test('invite-link spam from a new member is deleted and expels them; from an old member it is deleted and warned', async () => {
  const h = community({ shield: { inviteLinkPolicy: 'expel-new-members' } });
  const hooks = plugin.registerHooks(h.context);
  const message = (who, id) => ({
    pluginId: 'official.community-admin', scopeId: 'scope-1', groupWid: 'main@g.us', managementMode: 'MANAGE', receivedAt: new Date('2026-11-21T12:00:00Z'),
    message: { id, chatId: 'main@g.us', body: 'join https://chat.whatsapp.com/AbCdEfGhIjKl', type: 'chat', hasMedia: false, links: [{ raw: 'https://chat.whatsapp.com/AbCdEfGhIjKl', url: 'https://chat.whatsapp.com/AbCdEfGhIjKl', hostname: 'chat.whatsapp.com' }], mentions: [], fromMe: false, timestamp: new Date('2026-11-21T12:00:00Z') },
    actor: { wid: who.canonicalWid, identityAddress: who, fromMe: false }, actorIdentityId: who.identityId, actorWid: who.canonicalWid, isCommandLike: false, mentionsBot: false
  });
  await hooks.onParticipantChange({ pluginId: 'official.community-admin', scopeId: 'scope-1', groupWid: 'main@g.us', managementMode: 'MANAGE',
    receivedAt: new Date('2026-11-21T11:00:00Z'), occurredAt: new Date('2026-11-21T11:00:00Z'), eventId: 'j', chatId: 'main@g.us', action: 'join', botIdentityIds: [], affectedIdentities: [rui] });
  const fresh = await hooks.onMessage(message(rui, 'm1'));
  assert.ok(fresh.some(action => action.type === 'message.delete'));
  assert.ok(fresh.some(action => action.type === 'member.setStanding' && action.standing === 'expelled'));
  const old = await hooks.onMessage(message(person('Old', '351910000009'), 'm2'));
  assert.ok(old === undefined || !old.some(action => action.type === 'member.setStanding'));
});

test('admins are never caught by automatic rules', async () => {
  const h = community({ shield: { inviteLinkPolicy: 'delete' } });
  const hooks = plugin.registerHooks(h.context);
  const result = await hooks.onMessage({
    pluginId: 'official.community-admin', scopeId: 'scope-1', groupWid: 'main@g.us', managementMode: 'MANAGE', receivedAt: new Date(),
    message: { id: 'm', chatId: 'main@g.us', body: 'https://chat.whatsapp.com/AbCdEfGhIjKl', type: 'chat', hasMedia: false, links: [], mentions: [], fromMe: false, timestamp: new Date() },
    actor: { wid: ana.canonicalWid, identityAddress: ana, fromMe: false }, actorIdentityId: ana.identityId, actorWid: ana.canonicalWid, isCommandLike: false, mentionsBot: false
  });
  assert.equal(result, undefined);
});

test('a report is anonymous in the group and reaches the community admins privately; resolve acts on it', async () => {
  const h = community();
  const reply = { messageId: 'bad-1', snapshot: { authorWid: rui.canonicalWid, type: 'chat', body: 'buy followers now', hasMedia: false } };
  const report = await run(h, eva, '/report spam', { groupWid: 'main@g.us', replyTo: reply });
  assert.equal(report.text, undefined);
  assert.ok(report.pluginActions.some(action => action.type === 'message.delete'), 'the /report message is removed');
  const alerts = report.pluginActions.filter(action => action.type === 'message.sendText' && action.chatId !== eva.deliveryChatId);
  assert.deepEqual(alerts.map(action => action.chatId), [ana.deliveryChatId]);
  assert.match(alerts[0].text, /Report #1 in Main by Eva: message by Rui: “buy followers now” Reason: spam/u);
  const duplicate = await run(h, eva, '/report', { groupWid: 'main@g.us', replyTo: reply });
  assert.ok(duplicate.pluginActions.some(action => action.type === 'message.sendText' && /already reported/u.test(action.text)));
  const resolved = await run(h, ana, '/admin resolve 1 delete', { groupWid: 'main@g.us' });
  assert.ok(resolved.pluginActions.some(action => action.type === 'message.delete' && action.messageId === 'bad-1'));
  const again = await run(h, ana, '/admin resolve 1 dismiss', { groupWid: 'main@g.us' });
  assert.match(again.text, /no open report #1/u);
});

test('groups outside MANAGE mode are left alone', async () => {
  const h = community();
  const result = await run(h, ana, '/admin expel spam', { groupWid: 'main@g.us', mentions: [rui] });
  assert.ok(!result.pluginActions.some(action => action.type === 'group.removeParticipant' && action.groupWid === 'watch@g.us'));
});

test('Community Admin and Group Admin expose the intended grants and every route has one handler', () => {
  const { context } = community();
  const registered = [];
  context.router.register = (family, action) => registered.push('/' + family + (action === '*' ? '' : ' ' + action));
  plugin.registerCommands(context);
  assert.equal(registered.length, new Set(registered).size);
  assert.deepEqual([...registered].sort(), [...plugin.manifest.commands].sort());
  const [group, communityRole] = plugin.manifest.roles;
  assert.deepEqual(group.permissions, ['plugin.community-admin.moderate','plugin.community-admin.group-info']);
  assert.deepEqual(communityRole.permissions, plugin.manifest.requiredPermissions);
  assert.deepEqual(plugin.registerServices(context).map(service => service.serviceId), ['official.community-subgroups.v1']);
  assert.deepEqual(plugin.registerAssistantTools(context).map(tool => tool.descriptor.name), [
    'official.community-admin.participants.preview','official.community-admin.participants.execute','official.community-admin.group.execute']);
});

test('auto-approval audits each unheld request and yields to raid locks and standings', async () => {
  const h = community({ joinApproval: { autoApprove: true } });
  const hooks = plugin.registerHooks(h.context);
  const now = new Date();
  const event = { pluginId: plugin.manifest.pluginId, scopeId: 'scope-1', groupWid: 'main@g.us', managementMode: 'MANAGE',
    receivedAt: now, eventId: 'request', chatId: 'main@g.us', action: 'membership_request', botIdentityIds: [], affectedIdentities: [rui] };
  const approved = await hooks.onParticipantChange(event);
  assert.ok(approved.some(action => action.type === 'group.approveMembershipRequest'));
  assert.ok(approved.some(action => action.action === 'community-admin.join-request.approved'));
  require('../dist/store').recordLock(h.context.databases.open('moderation'), event.groupWid, event.scopeId, new Date(now.getTime()+60000), 'raid');
  assert.ok(!(await hooks.onParticipantChange(event)).some(action => action.type === 'group.approveMembershipRequest'));
  h.context.memberStandingsForScope = async () => [{ identityId: rui.identityId, standing: 'suspended', caseRef: 'suspended' }];
  const rejected = await hooks.onParticipantChange(event);
  assert.ok(rejected.some(action => action.type === 'group.rejectMembershipRequest'));
  assert.ok(!rejected.some(action => action.type === 'group.approveMembershipRequest'));
});

test('required join approval reconciles all managed groups and is inherited by group creation', async () => {
  const h = community({ joinApproval: { policy: 'require', autoApprove: false } });
  const hooks = plugin.registerHooks(h.context);
  await hooks.onRuntimeReady({ botIdentityId: h.bot.identityId, firstReadyForIdentity: false, startupBeforeWorker: true });
  const actions = await hooks.onPluginJob({ scopeId: 'scope-1', jobName: 'scope.configuration.changed', payload: {} });
  assert.deepEqual(actions.map(action => action.groupWid).sort(), ['event@g.us','main@g.us','parent@g.us']);
  assert.ok(actions.every(action => action.type === 'group.setMembershipApprovalMode' && action.enabled));
  assert.deepEqual(await hooks.onGroupScopeCovered({ scopeId: 'scope-1', chatId: 'watch@g.us', newManagementMode: 'OBSERVE' }), undefined);
  const raw = await h.context.configFor('scope-1');
  assert.equal(require('../dist/subgroups/config').parseCommunitySubgroupsConfig(raw).creationPolicy.joinApproval,true);
});

test('group information follows current membership and the observed WhatsApp edit setting', async () => {
  const h=community();
  h.context.explainPermission=async request=>({allowed:request.allowCurrentManagedGroupMember === true, reasons:[]});
  h.context.getGroupMetadataSnapshot=async()=>({source:'whatsmeow.GetGroupInfo',raw:{isLocked:true}});
  const denied=await run(h,rui,'/admin description Test',{groupWid:'main@g.us'});
  assert.equal(denied.pluginActions,undefined);
  h.context.getGroupMetadataSnapshot=async()=>({source:'whatsmeow.GetGroupInfo',raw:{isLocked:false}});
  const accepted=await run(h,rui,'/admin description Test',{groupWid:'main@g.us'});
  assert.equal(accepted.pluginActions[0].description,'Test');
  h.context.explainPermission=async()=>({allowed:false,reasons:[]});
  assert.equal((await run(h,rui,'/admin description Test',{groupWid:'main@g.us'})).pluginActions,undefined);
});
