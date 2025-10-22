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
  );

  -- History tables (also created by Sequelize migrations; keep as fallback)
  CREATE TABLE IF NOT EXISTS generation_history (
    id BIGSERIAL PRIMARY KEY,
    plant_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    kwh DOUBLE PRECISION NOT NULL
  );
  CREATE INDEX IF NOT EXISTS generation_history_plant_ts ON generation_history(plant_id, timestamp);
  DO $$ BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS generation_history_unique ON generation_history(plant_id, timestamp);
  EXCEPTION WHEN others THEN END $$;

  CREATE TABLE IF NOT EXISTS consumption_history (
    id BIGSERIAL PRIMARY KEY,
    plant_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    kwh DOUBLE PRECISION NOT NULL
  );
  CREATE INDEX IF NOT EXISTS consumption_history_plant_ts ON consumption_history(plant_id, timestamp);
  DO $$ BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS consumption_history_unique ON consumption_history(plant_id, timestamp);
  EXCEPTION WHEN others THEN END $$;

  CREATE TABLE IF NOT EXISTS battery_history (
    id BIGSERIAL PRIMARY KEY,
    plant_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    soc DOUBLE PRECISION,
    power_kw DOUBLE PRECISION
  );
  CREATE INDEX IF NOT EXISTS battery_history_plant_ts ON battery_history(plant_id, timestamp);
  DO $$ BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS battery_history_unique ON battery_history(plant_id, timestamp);
  EXCEPTION WHEN others THEN END $$;

  CREATE TABLE IF NOT EXISTS grid_history (
    id BIGSERIAL PRIMARY KEY,
    plant_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    power_kw DOUBLE PRECISION,
    import_kw DOUBLE PRECISION,
    export_kw DOUBLE PRECISION
  );
  CREATE INDEX IF NOT EXISTS grid_history_plant_ts ON grid_history(plant_id, timestamp);
  DO $$ BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS grid_history_unique ON grid_history(plant_id, timestamp);
  EXCEPTION WHEN others THEN END $$;

  -- Device history (IoT)
  CREATE TABLE IF NOT EXISTS device_history (
    id BIGSERIAL PRIMARY KEY,
    vendor TEXT NOT NULL,
    device_id TEXT NOT NULL,
    name TEXT,
    room TEXT,
    ts TIMESTAMPTZ NOT NULL,
    state_on BOOLEAN,
    power_w DOUBLE PRECISION,
    energy_wh DOUBLE PRECISION,
    source TEXT
  );
  CREATE INDEX IF NOT EXISTS device_history_idx ON device_history(vendor, device_id, ts);
  DO $$ BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS device_history_unique ON device_history(vendor, device_id, ts);
  EXCEPTION WHEN others THEN END $$;

  -- App Rooms (per user) and Device Metadata
  CREATE TABLE IF NOT EXISTS rooms (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, name)
  );

  CREATE TABLE IF NOT EXISTS device_meta (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vendor TEXT NOT NULL,
    device_id TEXT NOT NULL,
    room_id BIGINT REFERENCES rooms(id) ON DELETE SET NULL,
    essential BOOLEAN DEFAULT FALSE,
    type TEXT,
    priority INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id, vendor, device_id)
  );
  
  -- Automations and state
  CREATE TABLE IF NOT EXISTS automations (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    kind TEXT NOT NULL,
    schedule_json TEXT NOT NULL,
    conditions_json TEXT,
    actions_json TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS automation_state (
    automation_id BIGINT PRIMARY KEY REFERENCES automations(id) ON DELETE CASCADE,
    last_state TEXT,
    last_at TIMESTAMPTZ
  );

  -- Habit mining: patterns and logs
  CREATE TABLE IF NOT EXISTS habit_patterns (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trigger_vendor TEXT NOT NULL,
    trigger_device_id TEXT NOT NULL,
    trigger_event TEXT NOT NULL, -- 'on' | 'off' | other
    action_vendor TEXT NOT NULL,
    action_device_id TEXT NOT NULL,
    action_event TEXT NOT NULL, -- 'on' | 'off'
    context_key TEXT,
    triggers_total BIGINT NOT NULL DEFAULT 0,
    pairs_total BIGINT NOT NULL DEFAULT 0,
    avg_delay_s DOUBLE PRECISION,
    first_seen TIMESTAMPTZ DEFAULT now(),
    last_seen TIMESTAMPTZ DEFAULT now(),
    confidence DOUBLE PRECISION,
    state TEXT NOT NULL DEFAULT 'shadow', -- shadow|suggested|active|paused|retired
    undo_count BIGINT NOT NULL DEFAULT 0,
  );

  -- Unique index using expression to normalize null context
  CREATE UNIQUE INDEX IF NOT EXISTS habit_patterns_unq ON habit_patterns (
    user_id, trigger_vendor, trigger_device_id, trigger_event,
    action_vendor, action_device_id, action_event, (COALESCE(context_key,'global'))
  );

  CREATE TABLE IF NOT EXISTS habit_logs (
    id BIGSERIAL PRIMARY KEY,
    pattern_id BIGINT REFERENCES habit_patterns(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    event TEXT NOT NULL, -- trigger|pair|auto_action|undo|promote|pause|retire
    meta TEXT
  );
  `;
  await pgPool.query(ddl);
  // Best-effort online migration for older deployments (ignore errors)
  try { await pgPool.query('ALTER TABLE device_meta ADD COLUMN IF NOT EXISTS priority INTEGER'); } catch {}
  try { await pgPool.query('ALTER TABLE automations ADD COLUMN IF NOT EXISTS conditions_json TEXT'); } catch {}
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
  );

  -- History tables (sqlite fallback when Postgres is not configured)
  CREATE TABLE IF NOT EXISTS generation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plant_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    kwh REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS generation_history_plant_ts ON generation_history(plant_id, timestamp);
  CREATE UNIQUE INDEX IF NOT EXISTS generation_history_unique ON generation_history(plant_id, timestamp);

  CREATE TABLE IF NOT EXISTS consumption_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plant_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    kwh REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS consumption_history_plant_ts ON consumption_history(plant_id, timestamp);
  CREATE UNIQUE INDEX IF NOT EXISTS consumption_history_unique ON consumption_history(plant_id, timestamp);

  CREATE TABLE IF NOT EXISTS battery_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plant_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    soc REAL,
    power_kw REAL
  );
  CREATE INDEX IF NOT EXISTS battery_history_plant_ts ON battery_history(plant_id, timestamp);
  CREATE UNIQUE INDEX IF NOT EXISTS battery_history_unique ON battery_history(plant_id, timestamp);

  CREATE TABLE IF NOT EXISTS grid_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plant_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    power_kw REAL,
    import_kw REAL,
    export_kw REAL
  );
  CREATE INDEX IF NOT EXISTS grid_history_plant_ts ON grid_history(plant_id, timestamp);
  CREATE UNIQUE INDEX IF NOT EXISTS grid_history_unique ON grid_history(plant_id, timestamp);

  -- Device history (IoT)
  CREATE TABLE IF NOT EXISTS device_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor TEXT NOT NULL,
    device_id TEXT NOT NULL,
    name TEXT,
    room TEXT,
    ts TEXT NOT NULL,
    state_on INTEGER,
    power_w REAL,
    energy_wh REAL,
    source TEXT
  );
  CREATE INDEX IF NOT EXISTS device_history_idx ON device_history(vendor, device_id, ts);
  CREATE UNIQUE INDEX IF NOT EXISTS device_history_unique ON device_history(vendor, device_id, ts);

  -- App Rooms (per user) and Device Metadata
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
  );

  CREATE TABLE IF NOT EXISTS device_meta (
    user_id INTEGER NOT NULL,
    vendor TEXT NOT NULL,
    device_id TEXT NOT NULL,
    room_id INTEGER,
    essential INTEGER DEFAULT 0,
    type TEXT,
    priority INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY(user_id, vendor, device_id)
  );
  
  -- Automations and state
  CREATE TABLE IF NOT EXISTS automations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    kind TEXT NOT NULL,
    schedule_json TEXT NOT NULL,
    conditions_json TEXT,
    actions_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS automation_state (
    automation_id INTEGER PRIMARY KEY,
    last_state TEXT,
    last_at TEXT
  );

  -- Habit mining: patterns and logs
  CREATE TABLE IF NOT EXISTS habit_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    trigger_vendor TEXT NOT NULL,
    trigger_device_id TEXT NOT NULL,
    trigger_event TEXT NOT NULL,
    action_vendor TEXT NOT NULL,
    action_device_id TEXT NOT NULL,
    action_event TEXT NOT NULL,
    context_key TEXT,
    triggers_total INTEGER NOT NULL DEFAULT 0,
    pairs_total INTEGER NOT NULL DEFAULT 0,
    avg_delay_s REAL,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now')),
    confidence REAL,
    state TEXT NOT NULL DEFAULT 'shadow',
    undo_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS habit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_id INTEGER REFERENCES habit_patterns(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    event TEXT NOT NULL,
    meta TEXT
  );
  `);
  // Online migration for existing DBs (ignore if column already exists)
  try { sqliteDb.prepare('ALTER TABLE device_meta ADD COLUMN priority INTEGER').run(); } catch {}
  try { sqliteDb.prepare('ALTER TABLE automations ADD COLUMN conditions_json TEXT').run(); } catch {}
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

// --------- Engine Introspection (for analytics) ---------
export function getDbEngine() {
  return { type: USE_PG ? 'pg' : 'sqlite', pgPool, sqliteDb };
}

// --------- History write helpers (cross-engine) ---------
export async function insertGenerationHistory({ plant_id, timestamp, kwh }){
  if (USE_PG) {
    await pgPool.query('INSERT INTO generation_history(plant_id, timestamp, kwh) VALUES($1,$2,$3)', [plant_id, new Date(timestamp), Number(kwh)||0]);
  } else {
    sqliteDb.prepare('INSERT INTO generation_history(plant_id, timestamp, kwh) VALUES(?,?,?)').run(plant_id, new Date(timestamp).toISOString(), Number(kwh)||0);
  }
}
export async function insertConsumptionHistory({ plant_id, timestamp, kwh }){
  if (USE_PG) {
    await pgPool.query('INSERT INTO consumption_history(plant_id, timestamp, kwh) VALUES($1,$2,$3)', [plant_id, new Date(timestamp), Number(kwh)||0]);
  } else {
    sqliteDb.prepare('INSERT INTO consumption_history(plant_id, timestamp, kwh) VALUES(?,?,?)').run(plant_id, new Date(timestamp).toISOString(), Number(kwh)||0);
  }
}
export async function insertBatteryHistory({ plant_id, timestamp, soc, power_kw }){
  if (USE_PG) {
    await pgPool.query('INSERT INTO battery_history(plant_id, timestamp, soc, power_kw) VALUES($1,$2,$3,$4)', [plant_id, new Date(timestamp), (soc!=null?Number(soc):null), (power_kw!=null?Number(power_kw):null)]);
  } else {
    sqliteDb.prepare('INSERT INTO battery_history(plant_id, timestamp, soc, power_kw) VALUES(?,?,?,?)').run(plant_id, new Date(timestamp).toISOString(), (soc!=null?Number(soc):null), (power_kw!=null?Number(power_kw):null));
  }
}
export async function insertGridHistory({ plant_id, timestamp, power_kw, import_kw, export_kw }){
  if (USE_PG) {
    await pgPool.query('INSERT INTO grid_history(plant_id, timestamp, power_kw, import_kw, export_kw) VALUES($1,$2,$3,$4,$5)', [plant_id, new Date(timestamp), (power_kw!=null?Number(power_kw):null), (import_kw!=null?Number(import_kw):null), (export_kw!=null?Number(export_kw):null)]);
  } else {
    sqliteDb.prepare('INSERT INTO grid_history(plant_id, timestamp, power_kw, import_kw, export_kw) VALUES(?,?,?,?,?)').run(plant_id, new Date(timestamp).toISOString(), (power_kw!=null?Number(power_kw):null), (import_kw!=null?Number(import_kw):null), (export_kw!=null?Number(export_kw):null));
  }
}

// --------- Device history helpers ---------
export async function insertDeviceHistory({ vendor, device_id, name, room, ts, state_on, power_w, energy_wh, source }){
  const tDate = new Date(ts);
  if (USE_PG) {
    try {
      await pgPool.query(
        'INSERT INTO device_history(vendor, device_id, name, room, ts, state_on, power_w, energy_wh, source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (vendor, device_id, ts) DO NOTHING',
        [vendor, device_id, name ?? null, room ?? null, tDate, (state_on==null? null : !!state_on), (power_w!=null? Number(power_w): null), (energy_wh!=null? Number(energy_wh): null), source ?? null]
      );
    } catch {}
  } else {
    try {
      sqliteDb.prepare('INSERT OR IGNORE INTO device_history(vendor, device_id, name, room, ts, state_on, power_w, energy_wh, source) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(vendor, device_id, name ?? null, room ?? null, tDate.toISOString(), (state_on==null? null : (!!state_on?1:0)), (power_w!=null? Number(power_w): null), (energy_wh!=null? Number(energy_wh): null), source ?? null);
    } catch {}
  }
}

// -------- Habit patterns (miner storage) --------
export async function upsertHabitPattern({ user_id, trigger_vendor, trigger_device_id, trigger_event, action_vendor, action_device_id, action_event, context_key='global', delay_s=null }){
  const now = new Date();
  const ctx = context_key || 'global';
  if (USE_PG) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      // upsert row
      const sel = await client.query(
        `SELECT id, triggers_total, pairs_total, avg_delay_s FROM habit_patterns
         WHERE user_id=$1 AND trigger_vendor=$2 AND trigger_device_id=$3 AND trigger_event=$4
           AND action_vendor=$5 AND action_device_id=$6 AND action_event=$7 AND COALESCE(context_key,'global')=COALESCE($8,'global')
         LIMIT 1`, [user_id, trigger_vendor, trigger_device_id, trigger_event, action_vendor, action_device_id, action_event, ctx]
      );
      let id = sel.rows[0]?.id || null;
      let triggers = Number(sel.rows[0]?.triggers_total||0);
      let pairs = Number(sel.rows[0]?.pairs_total||0);
      let avg = sel.rows[0]?.avg_delay_s==null? null : Number(sel.rows[0]?.avg_delay_s);
      if (!id) {
        const ins = await client.query(
          `INSERT INTO habit_patterns(user_id, trigger_vendor, trigger_device_id, trigger_event, action_vendor, action_device_id, action_event, context_key, triggers_total, pairs_total, avg_delay_s, first_seen, last_seen, confidence, state)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9, $10, $10, 0.0, 'shadow') RETURNING id`,
          [user_id, trigger_vendor, trigger_device_id, trigger_event, action_vendor, action_device_id, action_event, ctx, (delay_s!=null? Number(delay_s): null), now]
        );
        id = ins.rows[0].id;
      }
      // increment counters
      triggers += 1;
      if (delay_s != null) {
        const d = Number(delay_s);
        if (avg==null) avg = d; else avg = 0.8*avg + 0.2*d;
        pairs += 1;
      }
      const conf = triggers>0 ? (pairs / triggers) : 0;
      await client.query(`UPDATE habit_patterns SET triggers_total=$1, pairs_total=$2, avg_delay_s=$3, last_seen=$4, confidence=$5,
        state = CASE WHEN state='shadow' AND $5>=0.6 AND $2>=3 AND $1>=5 THEN 'suggested' ELSE state END
      WHERE id=$6`, [triggers, pairs, avg, now, conf, id]);
      await client.query('COMMIT');
      return { id, triggers_total:triggers, pairs_total:pairs, avg_delay_s:avg, confidence: conf };
    } catch (e) { try { await client.query('ROLLBACK') } catch {}; throw e; } finally { client.release(); }
  } else {
    const row = sqliteDb.prepare(
      `SELECT id, triggers_total, pairs_total, avg_delay_s FROM habit_patterns WHERE user_id=? AND trigger_vendor=? AND trigger_device_id=? AND trigger_event=? AND action_vendor=? AND action_device_id=? AND action_event=? AND COALESCE(context_key,'global')=COALESCE(?, 'global') LIMIT 1`
    ).get(user_id, trigger_vendor, trigger_device_id, trigger_event, action_vendor, action_device_id, action_event, ctx);
    let id = row?.id || null;
    let triggers = Number(row?.triggers_total||0);
    let pairs = Number(row?.pairs_total||0);
    let avg = row?.avg_delay_s==null? null : Number(row?.avg_delay_s);
    if (!id) {
      const info = sqliteDb.prepare(
        `INSERT INTO habit_patterns(user_id, trigger_vendor, trigger_device_id, trigger_event, action_vendor, action_device_id, action_event, context_key, triggers_total, pairs_total, avg_delay_s, first_seen, last_seen, confidence, state)
         VALUES(?,?,?,?,?,?,?,?,0,0,?,?,?,0.0,'shadow')`
      ).run(user_id, trigger_vendor, trigger_device_id, trigger_event, action_vendor, action_device_id, action_event, ctx, (delay_s!=null? Number(delay_s): null), new Date().toISOString(), new Date().toISOString());
      id = info.lastInsertRowid;
    }
    triggers += 1;
    if (delay_s != null) {
      const d = Number(delay_s);
      if (avg==null) avg = d; else avg = 0.8*avg + 0.2*d;
      pairs += 1;
    }
    const conf = triggers>0 ? (pairs / triggers) : 0;
    sqliteDb.prepare(`UPDATE habit_patterns SET triggers_total=?, pairs_total=?, avg_delay_s=?, last_seen=?, confidence=?, state = CASE WHEN state='shadow' AND ?>=0.6 AND pairs_total>=3 AND triggers_total>=5 THEN 'suggested' ELSE state END WHERE id=?`)
      .run(triggers, pairs, avg, new Date().toISOString(), conf, conf, id);
    return { id, triggers_total:triggers, pairs_total:pairs, avg_delay_s:avg, confidence: conf };
  }
}

export async function listHabitPatternsByUser(user_id){
  if (USE_PG) {
    const r = await pgPool.query('SELECT * FROM habit_patterns WHERE user_id=$1 ORDER BY state DESC, confidence DESC, last_seen DESC', [user_id]);
    return r.rows;
  } else {
    return sqliteDb.prepare('SELECT * FROM habit_patterns WHERE user_id=? ORDER BY state DESC, confidence DESC, last_seen DESC').all(user_id);
  }
}

export async function setHabitPatternState(id, state){
  const st = String(state||'').toLowerCase();
  if (!['shadow','suggested','active','paused','retired'].includes(st)) throw new Error('invalid state');
  if (USE_PG) {
    await pgPool.query('UPDATE habit_patterns SET state=$1 WHERE id=$2', [st, id]);
  } else {
    sqliteDb.prepare('UPDATE habit_patterns SET state=? WHERE id=?').run(st, id);
  }
}

export async function incHabitUndo(id){
  if (USE_PG) {
    await pgPool.query('UPDATE habit_patterns SET undo_count = COALESCE(undo_count,0)+1 WHERE id=$1', [id]);
  } else {
    sqliteDb.prepare('UPDATE habit_patterns SET undo_count = COALESCE(undo_count,0)+1 WHERE id=?').run(id);
  }
}

export async function insertHabitLog({ pattern_id, user_id, event, meta }){
  const m = meta ? JSON.stringify(meta) : null;
  if (USE_PG) {
    await pgPool.query('INSERT INTO habit_logs(pattern_id, user_id, event, meta) VALUES($1,$2,$3,$4)', [pattern_id, user_id, event, m]);
  } else {
    sqliteDb.prepare('INSERT INTO habit_logs(pattern_id, user_id, event, meta) VALUES(?,?,?,?)').run(pattern_id, user_id, event, m);
  }
}

export async function listHabitLogsByUser(user_id, { limit=50, pattern_id=null }={}){
  const lim = Math.max(1, Math.min(500, Number(limit)||50));
  if (USE_PG) {
    if (pattern_id) {
      const sql = `SELECT l.id, l.ts, l.event, l.meta, l.pattern_id,
        p.trigger_vendor, p.trigger_device_id, p.trigger_event,
        p.action_vendor, p.action_device_id, p.action_event,
        p.context_key, p.state
        FROM habit_logs l JOIN habit_patterns p ON p.id = l.pattern_id
        WHERE l.user_id=$1 AND l.pattern_id=$2
        ORDER BY l.ts DESC
        LIMIT $3`;
      const r = await pgPool.query(sql, [user_id, Number(pattern_id), lim]);
      return r.rows;
    } else {
      const sql = `SELECT l.id, l.ts, l.event, l.meta, l.pattern_id,
        p.trigger_vendor, p.trigger_device_id, p.trigger_event,
        p.action_vendor, p.action_device_id, p.action_event,
        p.context_key, p.state
        FROM habit_logs l JOIN habit_patterns p ON p.id = l.pattern_id
        WHERE l.user_id=$1
        ORDER BY l.ts DESC
        LIMIT $2`;
      const r = await pgPool.query(sql, [user_id, lim]);
      return r.rows;
    }
  } else {
    if (pattern_id) {
      const sql = `SELECT l.id, l.ts, l.event, l.meta, l.pattern_id,
        p.trigger_vendor, p.trigger_device_id, p.trigger_event,
        p.action_vendor, p.action_device_id, p.action_event,
        p.context_key, p.state
        FROM habit_logs l JOIN habit_patterns p ON p.id = l.pattern_id
        WHERE l.user_id=? AND l.pattern_id=?
        ORDER BY l.ts DESC
        LIMIT ?`;
      return sqliteDb.prepare(sql).all(user_id, Number(pattern_id), lim);
    } else {
      const sql = `SELECT l.id, l.ts, l.event, l.meta, l.pattern_id,
        p.trigger_vendor, p.trigger_device_id, p.trigger_event,
        p.action_vendor, p.action_device_id, p.action_event,
        p.context_key, p.state
        FROM habit_logs l JOIN habit_patterns p ON p.id = l.pattern_id
        WHERE l.user_id=?
        ORDER BY l.ts DESC
        LIMIT ?`;
      return sqliteDb.prepare(sql).all(user_id, lim);
    }
  }
}

// --------- Rooms + Device Meta (CRUD) ---------
export async function listRoomsByUser(user_id){
  if (USE_PG) {
    const r = await pgPool.query('SELECT id, name, created_at FROM rooms WHERE user_id = $1 ORDER BY name', [user_id]);
    return r.rows;
  } else {
    return sqliteDb.prepare('SELECT id, name, created_at FROM rooms WHERE user_id = ? ORDER BY name').all(user_id);
  }
}

export async function createRoom(user_id, name){
  const nm = String(name||'').trim();
  if (!nm) throw new Error('name is required');
  if (USE_PG) {
    const r = await pgPool.query('INSERT INTO rooms(user_id, name) VALUES($1,$2) ON CONFLICT(user_id, name) DO NOTHING RETURNING id, name, created_at', [user_id, nm]);
    if (r.rowCount) return r.rows[0];
    const q = await pgPool.query('SELECT id, name, created_at FROM rooms WHERE user_id=$1 AND name=$2', [user_id, nm]);
    return q.rows[0];
  } else {
    sqliteDb.prepare('INSERT OR IGNORE INTO rooms(user_id, name) VALUES(?, ?)').run(user_id, nm);
    return sqliteDb.prepare('SELECT id, name, created_at FROM rooms WHERE user_id = ? AND name = ?').get(user_id, nm);
  }
}

export async function deleteRoom(user_id, room_id){
  if (USE_PG) {
    await pgPool.query('DELETE FROM rooms WHERE user_id = $1 AND id = $2', [user_id, room_id]);
  } else {
    sqliteDb.prepare('DELETE FROM rooms WHERE user_id = ? AND id = ?').run(user_id, room_id);
  }
}

export async function getDeviceMetaMap(user_id){
  if (USE_PG) {
    const r = await pgPool.query('SELECT vendor, device_id, room_id, essential, type, priority, updated_at FROM device_meta WHERE user_id = $1', [user_id]);
    const map = {}; for (const row of r.rows){ map[`${row.vendor}|${row.device_id}`] = row; }
    return map;
  } else {
    const rows = sqliteDb.prepare('SELECT vendor, device_id, room_id, essential, type, priority, updated_at FROM device_meta WHERE user_id = ?').all(user_id);
    const map = {}; for (const row of rows){ map[`${row.vendor}|${row.device_id}`] = { ...row, essential: !!row.essential }; }
    return map;
  }
}

// Get any user (first by id) to be used by internal service tasks (e.g., IoT ingestor)
export async function getAnyUser() {
  if (USE_PG) {
    const r = await pgPool.query('SELECT id, email, password_hash, powerstation_id, created_at FROM users ORDER BY id ASC LIMIT 1');
    return r.rows[0] || null;
  } else {
    return sqliteDb.prepare('SELECT id, email, password_hash, powerstation_id, created_at FROM users ORDER BY id ASC LIMIT 1').get();
  }
}

// -------- Automations CRUD --------
export async function listAutomationsUsers(){
  if (USE_PG) {
    const r = await pgPool.query('SELECT DISTINCT user_id FROM automations');
    return r.rows.map(x => x.user_id);
  } else {
    const rows = sqliteDb.prepare('SELECT DISTINCT user_id FROM automations').all();
    return rows.map(x => x.user_id);
  }
}

export async function listAutomationsByUser(user_id){
  if (USE_PG) {
    const r = await pgPool.query('SELECT id, user_id, name, enabled, kind, schedule_json, conditions_json, actions_json, created_at, updated_at FROM automations WHERE user_id=$1 ORDER BY id', [user_id]);
    return r.rows.map(row => ({ ...row, enabled: !!row.enabled }));
  } else {
    const rows = sqliteDb.prepare('SELECT id, user_id, name, enabled, kind, schedule_json, conditions_json, actions_json, created_at, updated_at FROM automations WHERE user_id = ? ORDER BY id').all(user_id);
    return rows.map(row => ({ ...row, enabled: !!row.enabled }));
  }
}

export async function upsertAutomation(user_id, { id=null, name, enabled=true, kind, schedule={}, conditions=null, actions={} }){
  const sch = JSON.stringify(schedule||{});
  const cond = conditions ? JSON.stringify(conditions) : null;
  const act = JSON.stringify(actions||{});
  if (id) {
    if (USE_PG) {
      await pgPool.query('UPDATE automations SET name=$1, enabled=$2, kind=$3, schedule_json=$4, conditions_json=$5, actions_json=$6, updated_at=now() WHERE id=$7 AND user_id=$8', [name, !!enabled, kind, sch, cond, act, id, user_id]);
      const r = await pgPool.query('SELECT id, user_id, name, enabled, kind, schedule_json, conditions_json, actions_json, created_at, updated_at FROM automations WHERE id=$1 AND user_id=$2', [id, user_id]);
      return r.rows[0] || null;
    } else {
      const en = enabled ? 1 : 0;
      sqliteDb.prepare('UPDATE automations SET name=?, enabled=?, kind=?, schedule_json=?, conditions_json=?, actions_json=?, updated_at=datetime(\'now\') WHERE id=? AND user_id=?').run(name, en, kind, sch, cond, act, id, user_id);
      return sqliteDb.prepare('SELECT id, user_id, name, enabled, kind, schedule_json, conditions_json, actions_json, created_at, updated_at FROM automations WHERE id=? AND user_id=?').get(id, user_id);
    }
  } else {
    if (USE_PG) {
      const r = await pgPool.query('INSERT INTO automations(user_id, name, enabled, kind, schedule_json, conditions_json, actions_json) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [user_id, name, !!enabled, kind, sch, cond, act]);
      const nid = r.rows[0]?.id; return upsertAutomation(user_id, { id: nid, name, enabled, kind, schedule, conditions, actions });
    } else {
      const en = enabled ? 1 : 0;
      const r = sqliteDb.prepare('INSERT INTO automations(user_id, name, enabled, kind, schedule_json, conditions_json, actions_json) VALUES(?,?,?,?,?,?,?)').run(user_id, name, en, kind, sch, cond, act);
      const nid = r.lastInsertRowid; return upsertAutomation(user_id, { id: nid, name, enabled, kind, schedule, conditions, actions });
    }
  }
}

export async function deleteAutomation(user_id, id){
  if (USE_PG) {
    await pgPool.query('DELETE FROM automations WHERE id=$1 AND user_id=$2', [id, user_id]);
  } else {
    sqliteDb.prepare('DELETE FROM automations WHERE id=? AND user_id=?').run(id, user_id);
  }
}

export async function getAutomationState(automation_id){
  if (USE_PG) {
    const r = await pgPool.query('SELECT automation_id, last_state, last_at FROM automation_state WHERE automation_id=$1', [automation_id]);
    return r.rows[0] || null;
  } else {
    return sqliteDb.prepare('SELECT automation_id, last_state, last_at FROM automation_state WHERE automation_id=?').get(automation_id);
  }
}

export async function setAutomationState(automation_id, { last_state=null, last_at=new Date() }){
  if (USE_PG) {
    await pgPool.query(`INSERT INTO automation_state(automation_id, last_state, last_at) VALUES($1,$2,$3)
      ON CONFLICT (automation_id) DO UPDATE SET last_state=EXCLUDED.last_state, last_at=EXCLUDED.last_at`, [automation_id, last_state, new Date(last_at)]);
  } else {
    sqliteDb.prepare(`INSERT INTO automation_state(automation_id, last_state, last_at) VALUES(?,?,?)
      ON CONFLICT(automation_id) DO UPDATE SET last_state=excluded.last_state, last_at=excluded.last_at`).run(automation_id, last_state, new Date(last_at).toISOString());
  }
}

export async function upsertDeviceMeta(user_id, { vendor, device_id, room_id=null, essential=false, type=null, priority=null }){
  const v = String(vendor||''); const id = String(device_id||''); if (!v || !id) throw new Error('vendor and device_id required');
  const ess = !!essential;
  const t = type ? String(type) : null;
  let prio = null;
  if (priority != null) {
    const n = Number(priority);
    if (Number.isFinite(n)) {
      prio = Math.max(1, Math.min(3, Math.round(n)));
    }
  }
  if (USE_PG) {
    await pgPool.query(
      `INSERT INTO device_meta(user_id, vendor, device_id, room_id, essential, type, priority, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT(user_id, vendor, device_id) DO UPDATE SET room_id=EXCLUDED.room_id, essential=EXCLUDED.essential, type=EXCLUDED.type, priority=EXCLUDED.priority, updated_at=now()`,
      [user_id, v, id, (room_id? Number(room_id): null), ess, t, prio]
    );
  } else {
    sqliteDb.prepare(
      `INSERT INTO device_meta(user_id, vendor, device_id, room_id, essential, type, priority, updated_at)
       VALUES(?,?,?,?,?,?,?, datetime('now'))
       ON CONFLICT(user_id, vendor, device_id) DO UPDATE SET
         room_id=excluded.room_id, essential=excluded.essential, type=excluded.type, priority=excluded.priority, updated_at=datetime('now')`
    ).run(user_id, v, id, (room_id? Number(room_id): null), (ess?1:0), t, prio);
  }
  return { vendor: v, device_id: id, room_id, essential: ess, type: t, priority: prio };
}
