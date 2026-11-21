const assert = require('node:assert/strict');
const { test } = require('node:test');
const { evaluateMessage, withinQuietHours, isInviteLink } = require('../dist/rules');
const { parseModerationConfig } = require('../dist/config');

const base = { type: 'chat', hasMedia: false, chatId: 'g@g.us', timestamp: new Date('2026-11-21T12:00:00Z'), links: [] };

test('defaults are safe: off, dry run, nothing triggers', () => {
  const config = parseModerationConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.dryRun, true);
  assert.deepEqual(evaluateMessage(config, { ...base, body: 'https://chat.whatsapp.com/AbCdEfGhIjKl and spam.example' }), []);
});

test('invite links are recognised in text and in parsed links', () => {
  assert.equal(isInviteLink('https://chat.whatsapp.com/AbCdEfGhIjKl'), true);
  assert.equal(isInviteLink('https://whatsapp.com/channel/0029Va'), true);
  assert.equal(isInviteLink('https://example.org'), false);
  const config = parseModerationConfig({ shield: { inviteLinkPolicy: 'delete' } });
  assert.deepEqual(evaluateMessage(config, { ...base, body: 'come: chat.whatsapp.com/AbCdEfGhIjKl' }).map(v => v.source), ['invite-link']);
});

test('allowed sites pass, blocked sites (when listed) are the only ones caught', () => {
  const allowAll = parseModerationConfig({ shield: { linkPolicy: 'warn', allowedDomains: ['example.org'] } });
  const links = host => [{ raw: `https://${host}/x`, url: `https://${host}/x`, hostname: host }];
  assert.deepEqual(evaluateMessage(allowAll, { ...base, body: '', links: links('www.example.org') }), []);
  assert.deepEqual(evaluateMessage(allowAll, { ...base, body: '', links: links('spam.test') }).map(v => v.detail), ['spam.test']);
  const blockList = parseModerationConfig({ shield: { linkPolicy: 'warn', blockedDomains: ['bad.test'] } });
  assert.deepEqual(evaluateMessage(blockList, { ...base, body: '', links: links('ok.test') }), []);
  assert.deepEqual(evaluateMessage(blockList, { ...base, body: '', links: links('cdn.bad.test') }).map(v => v.source), ['link']);
});

test('banned phrases, forwarded chains and media in no-media groups', () => {
  const config = parseModerationConfig({
    shield: { bannedPhrases: ['Free Money'], bannedPhrasePolicy: 'delete' },
    etiquette: { forwardedChains: { enabled: true }, mediaBlockedGroupChatIds: ['g@g.us'] }
  });
  const sources = evaluateMessage(config, { ...base, body: 'get FREE money', isForwarded: true, hasMedia: true, type: 'image' }).map(v => v.source);
  assert.deepEqual(sources.sort(), ['forwarded', 'media', 'phrase']);
  assert.deepEqual(evaluateMessage(config, { ...base, body: 'sticker', hasMedia: true, type: 'sticker' }).map(v => v.source), []);
});

test('quiet hours wrap past midnight and follow the time zone', () => {
  assert.equal(withinQuietHours(new Date('2026-11-21T23:30:00Z'), '23:00', '07:00', 'UTC'), true);
  assert.equal(withinQuietHours(new Date('2026-11-21T06:59:00Z'), '23:00', '07:00', 'UTC'), true);
  assert.equal(withinQuietHours(new Date('2026-11-21T07:00:00Z'), '23:00', '07:00', 'UTC'), false);
  assert.equal(withinQuietHours(new Date('2026-07-01T22:30:00Z'), '23:00', '07:00', 'Europe/Lisbon'), true);
  assert.equal(withinQuietHours(new Date('2026-11-21T12:00:00Z'), '09:00', '17:00', 'Not/AZone'), true);
});
