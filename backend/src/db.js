import fs from 'node:fs';
import path from 'node:path';

// Select engine: Postgres when DATABASE_URL is present; else SQLite (better-sqlite3)
const USE_PG = !!(process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim());

// --------- Postgres (async) ---------
let pgPool = null;
async function initPg() {
  if (!USE_PG || pgPool) return;
  const { Pool } = await import('pg');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const ddl = `
  CREATE TABLE IF NOT EXISTS powerstations (
    id TEXT PRIMARY KEY,
    business_name TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    powerstation_id TEXT NOT NULL REFERENCES powerstations(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    vendor TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS linked_accounts (
    user_id INTEGER NOT NULL,
    vendor TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    expires_at BIGINT,
    scopes TEXT,
    meta TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id, vendor)
  );`;
  await pgPool.query(ddl);
}

// --------- SQLite (sync under the hood, wrapped as async) ---------
let sqliteDb = null;
async function initSqlite() {
  if (USE_PG || sqliteDb) return;
  const { default: Database } = await import('better-sqlite3');
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

  sqliteDb = new Database(DB_PATH);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.exec(`
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

  CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    vendor TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

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
  );`);
}

// Initialize selected engine
if (USE_PG) {
  await initPg();
} else {
  await initSqlite();
}

// ---------- Public API (async) ----------

export async function seedPowerstations(ids) {
  if (USE_PG) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      for (const id of ids) {
        await client.query(
          'INSERT INTO powerstations (id, business_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
          [id, null]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  } else {
    const insert = sqliteDb.prepare('INSERT OR IGNORE INTO powerstations (id, business_name) VALUES (?, ?)');
    const tx = sqliteDb.transaction((rows) => {
      rows.forEach(({ id, name }) => insert.run(id, name));
    });
    tx(ids.map((id) => ({ id, name: null })));
  }
}

export async function listPowerstations() {
  if (USE_PG) {
    const r = await pgPool.query("SELECT id, COALESCE(business_name, '') AS business_name FROM powerstations ORDER BY id");
    return r.rows;
  } else {
    return sqliteDb.prepare("SELECT id, COALESCE(business_name, '') AS business_name FROM powerstations ORDER BY id").all();
  }
}

export async function upsertBusinessName(id, name) {
  if (USE_PG) {
    await pgPool.query(
      'INSERT INTO powerstations(id, business_name) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET business_name=EXCLUDED.business_name',
      [id, name ?? null]
    );
  } else {
    sqliteDb.prepare('INSERT INTO powerstations(id, business_name) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET business_name=excluded.business_name').run(id, name ?? null);
  }
}

// -------- Users/Auth --------
export async function createUser({ email, password_hash, powerstation_id }) {
  if (USE_PG) {
    const ps = await pgPool.query('SELECT 1 FROM powerstations WHERE id = $1', [powerstation_id]);
    if (!ps.rowCount) throw new Error('powerstation_id not found');
    const ins = await pgPool.query('INSERT INTO users(email, password_hash, powerstation_id) VALUES($1,$2,$3) RETURNING id', [email, password_hash, powerstation_id]);
    const id = ins.rows[0].id;
    return getUserById(id);
  } else {
    const ps = sqliteDb.prepare('SELECT 1 FROM powerstations WHERE id = ?').get(powerstation_id);
    if (!ps) throw new Error('powerstation_id not found');
    const stmt = sqliteDb.prepare('INSERT INTO users(email, password_hash, powerstation_id) VALUES(?,?,?)');
    const info = stmt.run(email, password_hash, powerstation_id);
    return getUserById(info.lastInsertRowid);
  }
}

export async function getUserByEmail(email) {
  if (USE_PG) {
    const r = await pgPool.query('SELECT id, email, password_hash, powerstation_id, created_at FROM users WHERE email = $1', [email]);
    return r.rows[0] || null;
  } else {
    return sqliteDb.prepare('SELECT id, email, password_hash, powerstation_id, created_at FROM users WHERE email = ?').get(email);
  }
}

export async function getUserById(id) {
  if (USE_PG) {
    const r = await pgPool.query('SELECT id, email, password_hash, powerstation_id, created_at FROM users WHERE id = $1', [id]);
    return r.rows[0] || null;
  } else {
    return sqliteDb.prepare('SELECT id, email, password_hash, powerstation_id, created_at FROM users WHERE id = ?').get(id);
  }
}

export async function createSession(user_id, token) {
  if (USE_PG) {
    await pgPool.query('INSERT INTO sessions(token, user_id) VALUES($1,$2)', [token, user_id]);
  } else {
    sqliteDb.prepare('INSERT INTO sessions(token, user_id) VALUES(?, ?)').run(token, user_id);
  }
  return { token, user_id };
}

export async function getSession(token) {
  if (USE_PG) {
    const r = await pgPool.query('SELECT token, user_id, created_at FROM sessions WHERE token = $1', [token]);
    return r.rows[0] || null;
  } else {
    return sqliteDb.prepare('SELECT token, user_id, created_at FROM sessions WHERE token = ?').get(token);
  }
}

export async function deleteSession(token) {
  if (USE_PG) {
    await pgPool.query('DELETE FROM sessions WHERE token = $1', [token]);
  } else {
    sqliteDb.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
}

// Update user password hash
export async function updateUserPassword(user_id, password_hash) {
  if (USE_PG) {
    await pgPool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, user_id]);
  } else {
    sqliteDb.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, user_id);
  }
  return getUserById(user_id);
}

// -------- OAuth/Integrations --------
export async function createOauthState({ state, vendor, user_id }){
  if (USE_PG) {
    await pgPool.query('INSERT INTO oauth_states(state, vendor, user_id) VALUES($1,$2,$3)', [state, vendor, user_id]);
  } else {
    sqliteDb.prepare('INSERT INTO oauth_states(state, vendor, user_id) VALUES(?,?,?)').run(state, vendor, user_id);
  }
}
export async function consumeOauthState(state){
  if (USE_PG) {
    const r = await pgPool.query('DELETE FROM oauth_states WHERE state = $1 RETURNING state, vendor, user_id, created_at', [state]);
    return r.rows[0] || null;
  } else {
    const row = sqliteDb.prepare('SELECT state, vendor, user_id, created_at FROM oauth_states WHERE state = ?').get(state);
    if (row) sqliteDb.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
    return row;
  }
}

export async function upsertLinkedAccount({ user_id, vendor, access_token, refresh_token, expires_at, scopes, meta }){
  const at = access_token ?? null;
  const rt = refresh_token ?? null;
  const ex = Number(expires_at) || null;
  const sc = scopes ?? null;
  const me = meta ? JSON.stringify(meta) : null;
  if (USE_PG) {
    await pgPool.query(
      `INSERT INTO linked_accounts(user_id, vendor, access_token, refresh_token, expires_at, scopes, meta, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT(user_id, vendor) DO UPDATE SET
         access_token=EXCLUDED.access_token,
         refresh_token=EXCLUDED.refresh_token,
         expires_at=EXCLUDED.expires_at,
         scopes=EXCLUDED.scopes,
         meta=EXCLUDED.meta,
         updated_at=now()`,
      [user_id, vendor, at, rt, ex, sc, me]
    );
  } else {
    sqliteDb.prepare(`INSERT INTO linked_accounts(user_id, vendor, access_token, refresh_token, expires_at, scopes, meta, updated_at)
             VALUES(?,?,?,?,?,?,?, datetime('now'))
             ON CONFLICT(user_id, vendor) DO UPDATE SET
               access_token=excluded.access_token,
               refresh_token=excluded.refresh_token,
               expires_at=excluded.expires_at,
               scopes=excluded.scopes,
               meta=excluded.meta,
               updated_at=datetime('now')`).run(user_id, vendor, at, rt, ex, sc, me);
  }
}
export async function getLinkedAccount(user_id, vendor){
  if (USE_PG) {
    const r = await pgPool.query('SELECT user_id, vendor, access_token, refresh_token, expires_at, scopes, meta, updated_at FROM linked_accounts WHERE user_id = $1 AND vendor = $2', [user_id, vendor]);
    return r.rows[0] || null;
  } else {
    return sqliteDb.prepare('SELECT user_id, vendor, access_token, refresh_token, expires_at, scopes, meta, updated_at FROM linked_accounts WHERE user_id = ? AND vendor = ?').get(user_id, vendor);
  }
}
export async function deleteLinkedAccount(user_id, vendor){
  if (USE_PG) {
    await pgPool.query('DELETE FROM linked_accounts WHERE user_id = $1 AND vendor = $2', [user_id, vendor]);
  } else {
    sqliteDb.prepare('DELETE FROM linked_accounts WHERE user_id = ? AND vendor = ?').run(user_id, vendor);
  }
}
