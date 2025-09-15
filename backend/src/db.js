import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'backend', 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

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
