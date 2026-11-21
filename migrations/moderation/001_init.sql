-- Moderation cases: a suspension or expulsion of one identity in one scope.
CREATE TABLE cases (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('suspension', 'expulsion')),
  status TEXT NOT NULL CHECK (status IN ('active', 'ended', 'lifted')),
  reason TEXT NOT NULL,
  actor_identity_id TEXT,
  automatic INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ends_at TEXT,
  ended_at TEXT,
  removed_from_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX cases_scope_identity_status ON cases (scope_id, identity_id, status);
CREATE INDEX cases_scope_status ON cases (scope_id, status, started_at);

CREATE TABLE warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_identity_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  pardoned_at TEXT
);
CREATE INDEX warnings_scope_identity ON warnings (scope_id, identity_id, expires_at);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_id TEXT NOT NULL,
  group_wid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  author_identity_id TEXT,
  reporter_identity_id TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution TEXT,
  resolved_by_identity_id TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (scope_id, message_id, reporter_identity_id)
);
CREATE INDEX reports_scope_status ON reports (scope_id, status, created_at);

-- Latest join per identity and scope, so the spam shield can tell new members apart.
CREATE TABLE joins (
  scope_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (scope_id, identity_id)
);

-- Temporary raid locks, so an unlock job only reopens a group this plugin locked.
CREATE TABLE locks (
  group_wid TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  locked_until TEXT NOT NULL,
  reason TEXT NOT NULL
);
