import type { ModerationConfig, RulePolicy } from './config';

export type ViolationSource =
  | 'invite-link'
  | 'link'
  | 'phrase'
  | 'flood'
  | 'sticker-burst'
  | 'forwarded'
  | 'media'
  | 'quiet-hours';

export interface Violation {
  source: ViolationSource;
  /** Short operator-facing detail (a domain, a phrase, a count); never the message text itself. */
  detail: string;
  policy: RulePolicy;
}

export interface RuleMessage {
  body: string;
  links: Array<{ hostname?: string | undefined; url?: string | undefined; raw: string }>;
  type: string;
  hasMedia: boolean;
  mediaMimeType?: string | undefined;
  isForwarded?: boolean | undefined;
  chatId: string;
  timestamp: Date;
}

const INVITE_HOSTS = ['chat.whatsapp.com', 'whatsapp.com/channel', 'wa.me/channel'];

/** Rules that need no counters: links, phrases, forwarded chains, media and quiet hours. */
export function evaluateMessage(config: ModerationConfig, message: RuleMessage): Violation[] {
  const violations: Violation[] = [];
  const shield = config.shield;
  const hosts = message.links.map((link) => normalizeHost(link.hostname ?? hostFromRaw(link.url ?? link.raw)));
  const inviteLink = message.links.find((link) => isInviteLink(link.url ?? link.raw))
    ?? (INVITE_PATTERN.test(message.body) ? { raw: 'chat.whatsapp.com' } : undefined);

  if (shield.inviteLinkPolicy !== 'off' && inviteLink) {
    violations.push({ source: 'invite-link', detail: 'chat.whatsapp.com', policy: shield.inviteLinkPolicy });
  }
  if (shield.linkPolicy !== 'off') {
    const blocked = hosts.find((host) => host && !isInviteHost(host) && isBlockedHost(config, host));
    if (blocked) violations.push({ source: 'link', detail: blocked, policy: shield.linkPolicy });
  }
  if (shield.bannedPhrasePolicy !== 'off' && shield.bannedPhrases.length > 0) {
    const text = message.body.toLocaleLowerCase();
    const phrase = shield.bannedPhrases.find((candidate) => text.includes(candidate.toLocaleLowerCase()));
    if (phrase) violations.push({ source: 'phrase', detail: phrase, policy: shield.bannedPhrasePolicy });
  }

  const etiquette = config.etiquette;
  if (etiquette.forwardedChains.enabled && etiquette.forwardedChains.policy !== 'off' && message.isForwarded) {
    violations.push({ source: 'forwarded', detail: 'forwarded', policy: etiquette.forwardedChains.policy });
  }
  if (etiquette.mediaPolicy !== 'off' && message.hasMedia && !isSticker(message)
    && etiquette.mediaBlockedGroupChatIds.includes(message.chatId)) {
    violations.push({ source: 'media', detail: message.type, policy: etiquette.mediaPolicy });
  }
  const quiet = etiquette.quietHours;
  if (quiet.enabled && quiet.policy !== 'off'
    && (quiet.groupChatIds.length === 0 || quiet.groupChatIds.includes(message.chatId))
    && withinQuietHours(message.timestamp, quiet.start, quiet.end, quiet.timezone)) {
    violations.push({ source: 'quiet-hours', detail: `${quiet.start}-${quiet.end}`, policy: quiet.policy });
  }
  return violations;
}

export function isSticker(message: Pick<RuleMessage, 'type' | 'mediaMimeType'>): boolean {
  return message.type.toLowerCase() === 'sticker' || message.mediaMimeType === 'image/webp';
}

const INVITE_PATTERN = /\bchat\.whatsapp\.com\/[A-Za-z0-9]{8,}/iu;

export function isInviteLink(value: string): boolean {
  const lower = value.toLowerCase();
  return INVITE_PATTERN.test(value) || INVITE_HOSTS.some((host) => lower.includes(host));
}

function isInviteHost(host: string): boolean {
  return host === 'chat.whatsapp.com';
}

function isBlockedHost(config: ModerationConfig, host: string): boolean {
  const { allowedDomains, blockedDomains } = config.shield;
  if (allowedDomains.some((domain) => domainMatches(host, domain))) return false;
  if (blockedDomains.length > 0) return blockedDomains.some((domain) => domainMatches(host, domain));
  return true;
}

export function domainMatches(host: string, domain: string): boolean {
  const wanted = normalizeHost(domain);
  return Boolean(wanted) && (host === wanted || host.endsWith(`.${wanted}`));
}

function normalizeHost(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/^www\./u, '').replace(/\.$/u, '');
}

function hostFromRaw(raw: string): string {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return '';
  }
}

/** True when the local time in the zone falls in [start, end), wrapping past midnight. */
export function withinQuietHours(at: Date, start: string, end: string, timeZone: string): boolean {
  const minutes = localMinutes(at, timeZone);
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

function localMinutes(at: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  }
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

function toMinutes(value: string): number {
  const [hour, minute] = value.split(':').map((part) => Number(part));
  return (hour ?? 0) * 60 + (minute ?? 0);
}
