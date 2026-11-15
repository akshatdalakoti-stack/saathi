// The database: one SQLite file, using Node's built-in sqlite module
// (no native packages to compile, so it installs the same on Windows and Render).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'saathi.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
// Wait up to 5 s for a lock instead of failing at once (e.g. two processes starting together).
db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY,
  care_id TEXT UNIQUE NOT NULL,          -- shareable ID, e.g. KAMLA-4821
  name TEXT NOT NULL,                    -- full name
  call_name TEXT,                        -- how Saathi greets them, e.g. "Kamla ji"
  birth_year INTEGER,
  language TEXT DEFAULT 'en',            -- 'en' or 'hi'
  text_size INTEGER DEFAULT 1,           -- 0 normal, 1 large, 2 extra large
  conditions TEXT, allergies TEXT, blood_group TEXT,
  doctor_name TEXT, doctor_phone TEXT,
  passcode_hash TEXT NOT NULL,           -- circle passcode needed to ask to join
  checkin_by TEXT DEFAULT '11:00',       -- if no sign of life by then, family is told
  routine TEXT,                          -- JSON: wake, breakfast, lunch, tea, dinner, bed
  escalation TEXT,                       -- JSON: minutes before each reminder step
  demo_fast INTEGER DEFAULT 0,           -- demo mode: escalation in minutes, not hours
  card_token TEXT,                       -- secret link for the emergency card
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT, phone TEXT,
  relation TEXT,                         -- son, daughter, nurse, self...
  role TEXT NOT NULL,                    -- elder | caretaker | family
  permission TEXT NOT NULL DEFAULT 'view', -- owner | manage | suggest | view
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | active | removed
  pin_hash TEXT,
  notify INTEGER DEFAULT 1,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at INTEGER, expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS medications (
  id INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL, strength TEXT,
  form TEXT DEFAULT 'tablet',            -- tablet | capsule | syrup | injection | drops | inhaler
  amount REAL DEFAULT 1,                 -- how many per dose
  purpose TEXT,                          -- plain words: "for blood sugar"
  category TEXT DEFAULT 'other',         -- what it's for, as a picture + translated word (shared/categories.js)
  pill_color TEXT DEFAULT 'white', pill_shape TEXT DEFAULT 'round',
  food TEXT DEFAULT 'after',             -- before | after | with | empty | any
  times TEXT NOT NULL,                   -- JSON list of "HH:MM"
  days TEXT DEFAULT 'daily',             -- 'daily' or JSON list of weekdays (0 = Sunday)
  start_date TEXT, end_date TEXT,
  stock REAL, refill_at_days INTEGER DEFAULT 5, refill_alert_at INTEGER,
  critical INTEGER DEFAULT 0,            -- critical medicines escalate twice as fast
  notes TEXT,
  active INTEGER DEFAULT 1,
  created_by TEXT, created_at INTEGER, updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS doses (
  id INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  med_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  date TEXT NOT NULL, time TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'due',    -- due | taken | skipped | missed | unsure
  acted_at INTEGER, acted_by TEXT,
  snooze_until INTEGER,
  level INTEGER DEFAULT 0,               -- escalation step reached (0-3)
  upcoming_sent INTEGER DEFAULT 0,
  UNIQUE (med_id, date, time)
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  doctor TEXT NOT NULL, specialty TEXT, place TEXT,
  starts_at INTEGER NOT NULL,
  purpose TEXT, companion_id INTEGER, notes TEXT,
  sent_day INTEGER DEFAULT 0, sent_soon INTEGER DEFAULT 0,
  status TEXT DEFAULT 'upcoming',        -- upcoming | done | cancelled
  created_by TEXT, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                    -- med_add | med_edit | med_stop | appt_add | appt_edit | appt_cancel
  target_id INTEGER, payload TEXT, summary TEXT,
  reason TEXT,                           -- why the family member is suggesting it
  status TEXT DEFAULT 'pending',         -- pending | approved | declined
  decided_at INTEGER, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL,
  actor TEXT, kind TEXT, text TEXT, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL,
  date TEXT, mood TEXT, symptoms TEXT, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL,
  member_id INTEGER, from_elder INTEGER DEFAULT 0,
  text TEXT, hearted INTEGER DEFAULT 0, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL,
  text TEXT, asked_by TEXT, done INTEGER DEFAULT 0, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, profile_id INTEGER,
  to_email TEXT, to_name TEXT, subject TEXT, html TEXT,
  kind TEXT, status TEXT, error TEXT, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS action_tokens (
  token TEXT PRIMARY KEY,
  dose_ids TEXT, action TEXT, actor TEXT,
  expires_at INTEGER, used_at INTEGER
);

CREATE TABLE IF NOT EXISTS alerts_sent (
  key TEXT PRIMARY KEY, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS routines (
  id INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                    -- bp | sugar | weight | walk | exercise | water | other
  title TEXT, time TEXT NOT NULL,
  days TEXT DEFAULT 'daily',
  active INTEGER DEFAULT 1,
  created_by TEXT, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS routine_logs (
  id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL,
  routine_id INTEGER, kind TEXT, date TEXT,
  value1 REAL, value2 REAL,              -- BP upper/lower, sugar, weight
  by TEXT, created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_doses_profile_date ON doses(profile_id, date);
CREATE INDEX IF NOT EXISTS idx_logs_profile_kind ON routine_logs(profile_id, kind, created_at);
CREATE INDEX IF NOT EXISTS idx_doses_status ON doses(status, due_at);
`);

// Small migrations for databases created by an older version of Saathi.
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumnIfMissing('medications', 'category', "TEXT DEFAULT 'other'");
addColumnIfMissing('proposals', 'reason', 'TEXT');
addColumnIfMissing('medications', 'refill_by', 'INTEGER'); // who said "I'll pick up the refill"

// SQLite cannot store true/false or undefined, so turn them into 1/0 and null.
function clean(params) {
  const out = [];
  for (const p of params) {
    if (p === undefined) out.push(null);
    else if (p === true) out.push(1);
    else if (p === false) out.push(0);
    else out.push(p);
  }
  return out;
}

const statementCache = new Map();
function prepare(sql) {
  let stmt = statementCache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    statementCache.set(sql, stmt);
  }
  return stmt;
}

// Small helpers so the rest of the code reads plainly.
export function one(sql, ...params) {
  return prepare(sql).get(...clean(params));
}
export function all(sql, ...params) {
  return prepare(sql).all(...clean(params));
}
export function run(sql, ...params) {
  return prepare(sql).run(...clean(params));
}

// Runs several writes as one unit: either all of them happen or none do.
export function transaction(work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function logActivity(profileId, actor, kind, text) {
  run('INSERT INTO activity (profile_id, actor, kind, text, created_at) VALUES (?, ?, ?, ?, ?)',
    profileId, actor, kind, text, Date.now());
}

// Some alerts must only be sent once (e.g. "no check-in today"). This remembers them.
export function alreadySent(key) {
  return !!one('SELECT key FROM alerts_sent WHERE key = ?', key);
}
export function markSent(key) {
  run('INSERT OR IGNORE INTO alerts_sent (key, created_at) VALUES (?, ?)', key, Date.now());
}
