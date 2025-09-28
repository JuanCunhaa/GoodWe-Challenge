import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// Prefer ./data (clean path). Fallback to ./backend/data if existing DB is there
const CWD = process.cwd();
const PRIMARY_DIR = path.join(CWD, 'data');
const PRIMARY_DB = path.join(PRIMARY_DIR, 'app.db');
const LEGACY_DIR = path.join(CWD, 'backend', 'data');
const LEGACY_DB = path.join(LEGACY_DIR, 'app.db');

let DATA_DIR = PRIMARY_DIR;
let DB_PATH = PRIMARY_DB;
try {
  const legacyExists = fs.existsSync(LEGACY_DB);
  const primaryExists = fs.existsSync(PRIMARY_DB);
  if (!primaryExists && legacyExists) {
    DATA_DIR = LEGACY_DIR;
    DB_PATH = LEGACY_DB;
  }
} catch {}

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS powerstations (
  id TEXT PRIMARY KEY,
  business_name TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  powerstation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(powerstation_id) REFERENCES powerstations(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- OAuth states (anti-CSRF) por vendor
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  vendor TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Linked accounts (tokens criptografados)
CREATE TABLE IF NOT EXISTS linked_accounts (
  user_id INTEGER NOT NULL,
  vendor TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  scopes TEXT,
  meta TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(user_id, vendor)
);
`);

export function seedPowerstations(ids) {
  const insert = db.prepare('INSERT OR IGNORE INTO powerstations (id, business_name) VALUES (?, ?)');
  const tx = db.transaction((rows) => {
    rows.forEach(({ id, name }) => insert.run(id, name));
  });
  tx(ids.map((id, i) => ({ id, name: null })));
}

export function listPowerstations() {
  // In SQLite, string literals must use single quotes
  return db.prepare("SELECT id, COALESCE(business_name, '') AS business_name FROM powerstations ORDER BY id").all();
}

export function upsertBusinessName(id, name) {
  db.prepare('INSERT INTO powerstations(id, business_name) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET business_name=excluded.business_name').run(id, name ?? null);
}

// -------- Users/Auth --------
export function createUser({ email, password_hash, powerstation_id }) {
  const ps = db.prepare('SELECT 1 FROM powerstations WHERE id = ?').get(powerstation_id);
  if (!ps) throw new Error('powerstation_id not found');
  const stmt = db.prepare('INSERT INTO users(email, password_hash, powerstation_id) VALUES(?,?,?)');
  const info = stmt.run(email, password_hash, powerstation_id);
  return getUserById(info.lastInsertRowid);
}

export function getUserByEmail(email) {
  return db.prepare('SELECT id, email, password_hash, powerstation_id, created_at FROM users WHERE email = ?').get(email);
}

export function getUserById(id) {
  return db.prepare('SELECT id, email, password_hash, powerstation_id, created_at FROM users WHERE id = ?').get(id);
}

export function createSession(user_id, token) {
  db.prepare('INSERT INTO sessions(token, user_id) VALUES(?, ?)').run(token, user_id);
  return { token, user_id };
}

export function getSession(token) {
  return db.prepare('SELECT token, user_id, created_at FROM sessions WHERE token = ?').get(token);
}

export function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Update user password hash
export function updateUserPassword(user_id, password_hash) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, user_id);
  return getUserById(user_id);
}

// -------- OAuth/Integrations --------
export function createOauthState({ state, vendor, user_id }){
  db.prepare('INSERT INTO oauth_states(state, vendor, user_id) VALUES(?,?,?)').run(state, vendor, user_id);
}
export function consumeOauthState(state){
  const row = db.prepare('SELECT state, vendor, user_id, created_at FROM oauth_states WHERE state = ?').get(state);
  if (row) db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
  return row;
}

export function upsertLinkedAccount({ user_id, vendor, access_token, refresh_token, expires_at, scopes, meta }){
  db.prepare(`INSERT INTO linked_accounts(user_id, vendor, access_token, refresh_token, expires_at, scopes, meta, updated_at)
             VALUES(?,?,?,?,?,?,?, datetime('now'))
             ON CONFLICT(user_id, vendor) DO UPDATE SET
               access_token=excluded.access_token,
               refresh_token=excluded.refresh_token,
               expires_at=excluded.expires_at,
               scopes=excluded.scopes,
               meta=excluded.meta,
               updated_at=datetime('now')`).run(user_id, vendor, access_token ?? null, refresh_token ?? null, Number(expires_at)||null, scopes ?? null, meta ? JSON.stringify(meta) : null);
}
export function getLinkedAccount(user_id, vendor){
  return db.prepare('SELECT user_id, vendor, access_token, refresh_token, expires_at, scopes, meta, updated_at FROM linked_accounts WHERE user_id = ? AND vendor = ?').get(user_id, vendor);
}
export function deleteLinkedAccount(user_id, vendor){
  db.prepare('DELETE FROM linked_accounts WHERE user_id = ? AND vendor = ?').run(user_id, vendor);
}
