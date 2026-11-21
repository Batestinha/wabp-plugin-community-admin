import { randomUUID } from 'node:crypto';
import type { PluginDatabase } from '@wabs/plugin-sdk/database';

export type CaseKind = 'suspension' | 'expulsion';
export type CaseStatus = 'active' | 'ended' | 'lifted';

export interface CaseRow {
  id: string;
  scope_id: string;
  identity_id: string;
  kind: CaseKind;
  status: CaseStatus;
  reason: string;
  actor_identity_id: string | null;
  automatic: number;
  started_at: string;
  ends_at: string | null;
  ended_at: string | null;
  removed_from_json: string;
}

export interface WarningRow {
  id: number;
  scope_id: string;
  identity_id: string;
  source: string;
  reason: string;
  actor_identity_id: string | null;
  created_at: string;
  expires_at: string;
  pardoned_at: string | null;
}

export interface ReportRow {
  id: number;
  scope_id: string;
  group_wid: string;
  message_id: string;
  author_identity_id: string | null;
  reporter_identity_id: string;
  excerpt: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolution: string | null;
  created_at: string;
}

export function activeCase(db: PluginDatabase, scopeId: string, identityId: string): CaseRow | undefined {
  return db.get<CaseRow & Record<string, unknown>>(
    `SELECT * FROM cases WHERE scope_id = ? AND identity_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1`,
    scopeId, identityId
  );
}

export function caseById(db: PluginDatabase, id: string): CaseRow | undefined {
  return db.get<CaseRow & Record<string, unknown>>('SELECT * FROM cases WHERE id = ?', id);
}

export function listActiveCases(db: PluginDatabase, scopeId: string, limit = 50): CaseRow[] {
  return db.all<CaseRow & Record<string, unknown>>(
    `SELECT * FROM cases WHERE scope_id = ? AND status = 'active' ORDER BY started_at ASC LIMIT ?`, scopeId, limit
  );
}

/** Opens a case and closes any other active case of the identity in the scope (the newest decision wins). */
export function openCase(db: PluginDatabase, input: {
  scopeId: string;
  identityId: string;
  kind: CaseKind;
  reason: string;
  actorIdentityId?: string | undefined;
  automatic?: boolean | undefined;
  now: Date;
  endsAt?: Date | undefined;
  removedFrom: string[];
}): CaseRow {
  const id = randomUUID();
  db.transaction(() => {
    db.run(`UPDATE cases SET status = 'lifted', ended_at = ? WHERE scope_id = ? AND identity_id = ? AND status = 'active'`,
      input.now.toISOString(), input.scopeId, input.identityId);
    db.run(`INSERT INTO cases (id, scope_id, identity_id, kind, status, reason, actor_identity_id, automatic, started_at, ends_at, removed_from_json)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
      id, input.scopeId, input.identityId, input.kind, input.reason.slice(0, 500), input.actorIdentityId ?? null,
      input.automatic ? 1 : 0, input.now.toISOString(), input.endsAt?.toISOString() ?? null, JSON.stringify(input.removedFrom));
  });
  return caseById(db, id)!;
}

export function closeCase(db: PluginDatabase, id: string, status: 'ended' | 'lifted', now: Date): boolean {
  return db.run(`UPDATE cases SET status = ?, ended_at = ? WHERE id = ? AND status = 'active'`, status, now.toISOString(), id).changes > 0;
}

export function extendCase(db: PluginDatabase, id: string, endsAt: Date): void {
  db.run(`UPDATE cases SET ends_at = ? WHERE id = ? AND status = 'active'`, endsAt.toISOString(), id);
}

export function removedFrom(row: CaseRow): string[] {
  try {
    const value = JSON.parse(row.removed_from_json) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function addWarning(db: PluginDatabase, input: {
  scopeId: string; identityId: string; source: string; reason: string; actorIdentityId?: string | undefined; now: Date; ttlDays: number;
}): number {
  const expires = new Date(input.now.getTime() + input.ttlDays * 86_400_000);
  db.run(`INSERT INTO warnings (scope_id, identity_id, source, reason, actor_identity_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.scopeId, input.identityId, input.source, input.reason.slice(0, 500), input.actorIdentityId ?? null,
    input.now.toISOString(), expires.toISOString());
  return activeWarnings(db, input.scopeId, input.identityId, input.now).length;
}

export function activeWarnings(db: PluginDatabase, scopeId: string, identityId: string, now: Date): WarningRow[] {
  return db.all<WarningRow & Record<string, unknown>>(
    `SELECT * FROM warnings WHERE scope_id = ? AND identity_id = ? AND pardoned_at IS NULL AND expires_at > ? ORDER BY created_at ASC`,
    scopeId, identityId, now.toISOString()
  );
}

/** Pardons one warning, or all active ones when no id is given. Returns how many were pardoned. */
export function pardonWarnings(db: PluginDatabase, scopeId: string, identityId: string, now: Date, warningId?: number): number {
  return warningId === undefined
    ? db.run(`UPDATE warnings SET pardoned_at = ? WHERE scope_id = ? AND identity_id = ? AND pardoned_at IS NULL AND expires_at > ?`,
      now.toISOString(), scopeId, identityId, now.toISOString()).changes
    : db.run(`UPDATE warnings SET pardoned_at = ? WHERE id = ? AND scope_id = ? AND identity_id = ? AND pardoned_at IS NULL`,
      now.toISOString(), warningId, scopeId, identityId).changes;
}

export function recordJoin(db: PluginDatabase, scopeId: string, identityId: string, at: Date): void {
  db.run(`INSERT INTO joins (scope_id, identity_id, joined_at) VALUES (?, ?, ?)
    ON CONFLICT (scope_id, identity_id) DO UPDATE SET joined_at = excluded.joined_at WHERE excluded.joined_at > joins.joined_at`,
    scopeId, identityId, at.toISOString());
}

export function isNewMember(db: PluginDatabase, scopeId: string, identityId: string, now: Date, hours: number): boolean {
  const row = db.get<{ joined_at: string }>('SELECT joined_at FROM joins WHERE scope_id = ? AND identity_id = ?', scopeId, identityId);
  return Boolean(row && now.getTime() - Date.parse(row.joined_at) < hours * 3_600_000);
}

export function addReport(db: PluginDatabase, input: {
  scopeId: string; groupWid: string; messageId: string; authorIdentityId?: string | undefined; reporterIdentityId: string; excerpt: string; now: Date;
}): { report: ReportRow; created: boolean } {
  const result = db.run(`INSERT INTO reports (scope_id, group_wid, message_id, author_identity_id, reporter_identity_id, excerpt, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?) ON CONFLICT (scope_id, message_id, reporter_identity_id) DO NOTHING`,
    input.scopeId, input.groupWid, input.messageId, input.authorIdentityId ?? null, input.reporterIdentityId,
    input.excerpt.slice(0, 280), input.now.toISOString());
  const report = db.get<ReportRow & Record<string, unknown>>(
    'SELECT * FROM reports WHERE scope_id = ? AND message_id = ? AND reporter_identity_id = ?',
    input.scopeId, input.messageId, input.reporterIdentityId
  )!;
  return { report, created: result.changes > 0 };
}

export function reportById(db: PluginDatabase, scopeId: string, id: number): ReportRow | undefined {
  return db.get<ReportRow & Record<string, unknown>>('SELECT * FROM reports WHERE scope_id = ? AND id = ?', scopeId, id);
}

export function resolveReport(db: PluginDatabase, id: number, status: 'resolved' | 'dismissed', resolution: string, actorIdentityId: string, now: Date): boolean {
  return db.run(`UPDATE reports SET status = ?, resolution = ?, resolved_by_identity_id = ?, resolved_at = ? WHERE id = ? AND status = 'open'`,
    status, resolution, actorIdentityId, now.toISOString(), id).changes > 0;
}

export function openReports(db: PluginDatabase, scopeId: string, limit = 20): ReportRow[] {
  return db.all<ReportRow & Record<string, unknown>>(
    `SELECT * FROM reports WHERE scope_id = ? AND status = 'open' ORDER BY created_at ASC LIMIT ?`, scopeId, limit
  );
}

export function recordLock(db: PluginDatabase, groupWid: string, scopeId: string, until: Date, reason: string): void {
  db.run(`INSERT INTO locks (group_wid, scope_id, locked_until, reason) VALUES (?, ?, ?, ?)
    ON CONFLICT (group_wid) DO UPDATE SET locked_until = excluded.locked_until, reason = excluded.reason`,
    groupWid, scopeId, until.toISOString(), reason);
}

/** Returns true when this plugin holds the lock and it has expired, and forgets it. */
export function takeExpiredLock(db: PluginDatabase, groupWid: string, now: Date): boolean {
  return db.run('DELETE FROM locks WHERE group_wid = ? AND locked_until <= ?', groupWid, now.toISOString()).changes > 0;
}

export function dropLock(db: PluginDatabase, groupWid: string): boolean {
  return db.run('DELETE FROM locks WHERE group_wid = ?', groupWid).changes > 0;
}
