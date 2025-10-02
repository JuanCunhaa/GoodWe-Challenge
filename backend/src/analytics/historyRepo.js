import { initSequelize, ensureSynced, isPostgres, models } from '../../database/models/index.js';
import { getDbEngine } from '../db.js';

function toDate(d){ return (d instanceof Date) ? d : new Date(d); }

let useSequelize = false;
export async function initHistoryRepo() {
  if (isPostgres) {
    const wantSequelize = String(process.env.ANALYTICS_USE_SEQUELIZE || 'true') === 'true';
    if (wantSequelize) {
      try {
        await initSequelize();
        await ensureSynced();
        useSequelize = true;
      } catch (e) {
        // Fallback to raw pg via db.js
        console.warn('[analytics] Sequelize init failed, falling back to raw PG:', e?.message || e);
        useSequelize = false;
      }
    } else {
      useSequelize = false;
    }
  }
  // sqlite tables are created by db.js on startup
  return createRepo();
}

export function createRepo() {
  const engine = getDbEngine();
  const type = engine.type;

  function camelToSnake(name){
    // "GenerationHistory" -> "generation_history"
    return String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  }

  async function bulkInsert(table, rows) {
    if (!rows || !rows.length) return { inserted: 0 };
    if (isPostgres && useSequelize && models[table]) {
      try {
        await models[table].bulkCreate(
          rows.map(r => ({ ...r, timestamp: toDate(r.timestamp) })),
          { validate: false, ignoreDuplicates: true }
        );
        return { inserted: rows.length };
      } catch (e) {
        console.warn('[analytics] Sequelize bulkCreate failed; falling back to raw PG:', e?.message || e);
        // One-time downgrade during runtime
        useSequelize = false;
      }
    }
    const cols = Object.keys(rows[0]);
    const tableName = camelToSnake(table);
    if (engine.type === 'pg') {
      // raw PG multi-insert
      const { pgPool } = engine;
      const chunks = [];
      const params = [];
      let p = 1;
      for (const r of rows) {
        const vals = cols.map((c)=> c==='timestamp' ? toDate(r[c]) : r[c]);
        const ph = '(' + vals.map(()=> `$${p++}`).join(',') + ')';
        chunks.push(ph);
        params.push(...vals);
      }
      const conflict = (tableName === 'generation_history' || tableName === 'consumption_history' || tableName === 'battery_history' || tableName === 'grid_history')
        ? ' ON CONFLICT (plant_id, timestamp) DO NOTHING' : '';
      const sql = `INSERT INTO ${tableName} (${cols.join(',')}) VALUES ${chunks.join(',')}${conflict}`;
      await pgPool.query(sql, params);
      return { inserted: rows.length };
    }
    if (engine.type === 'sqlite') {
      // sqlite fallback via direct SQL
      const db = engine.sqliteDb;
      const placeholders = '(' + cols.map(()=> '?').join(',') + ')';
      const stmt = db.prepare(`INSERT INTO ${tableName} (${cols.join(',')}) VALUES ${placeholders}`);
      const tx = db.transaction((items)=> { for (const it of items){ const vals = cols.map((c)=> c==='timestamp' ? new Date(it[c]).toISOString() : it[c]); stmt.run(...vals); } });
      tx(rows);
      return { inserted: rows.length };
    }
    return { inserted: 0 };
  }

  async function queryAll(sqlPg, sqlSqlite, params = []) {
    if (type === 'pg') {
      const { pgPool } = engine;
      const r = await pgPool.query(sqlPg, params);
      return r.rows;
    }
    const db = engine.sqliteDb;
    return db.prepare(sqlSqlite).all(...params);
  }

  return {
    // writes
    insertGenerationBatch: (rows) => bulkInsert('GenerationHistory', rows),
    insertConsumptionBatch: (rows) => bulkInsert('ConsumptionHistory', rows),
    insertBatterySample: (row) => bulkInsert('BatteryHistory', [row]),
    insertGridSample: (row) => bulkInsert('GridHistory', [row]),

    // reads
    async getHourlyProfile({ table, plant_id, lookbackDays = 14 }){
      const pg = `
        SELECT EXTRACT(HOUR FROM timestamp) AS hour, AVG(kwh) AS kwh
        FROM ${table}
        WHERE plant_id = $1 AND timestamp >= (now() - ($2::text || ' days')::interval)
        GROUP BY hour
        ORDER BY hour
      `;
      const lite = `
        SELECT CAST(STRFTIME('%H', timestamp) AS INTEGER) AS hour, AVG(kwh) AS kwh
        FROM ${table}
        WHERE plant_id = ? AND timestamp >= DATETIME('now', '-' || ? || ' days')
        GROUP BY hour
        ORDER BY hour
      `;
      const rows = await queryAll(pg, lite, [plant_id, String(lookbackDays)]);
      const map = new Map();
      for (const r of rows) map.set(Number(r.hour), Number(r.kwh) || 0);
      return map; // hour -> avg kwh
    },

    async getDailyTotals({ table, plant_id, lookbackDays = 30 }){
      const pg = `
        SELECT DATE_TRUNC('day', timestamp) AS day, SUM(kwh) AS kwh
        FROM ${table}
        WHERE plant_id = $1 AND timestamp >= (now() - ($2::text || ' days')::interval)
        GROUP BY day
        ORDER BY day DESC
        LIMIT 60
      `;
      const lite = `
        SELECT DATE(timestamp) AS day, SUM(kwh) AS kwh
        FROM ${table}
        WHERE plant_id = ? AND timestamp >= DATETIME('now', '-' || ? || ' days')
        GROUP BY day
        ORDER BY day DESC
        LIMIT 60
      `;
      const rows = await queryAll(pg, lite, [plant_id, String(lookbackDays)]);
      return rows.map(r => ({ day: new Date(r.day).toISOString().slice(0,10), kwh: Number(r.kwh)||0 }));
    },

    async getTableStats(table){
      const snake = camelToSnake(table);
      if (engine.type === 'pg'){
        const r = await engine.pgPool.query(`SELECT COUNT(*)::bigint AS count, MAX(timestamp) AS last_ts FROM ${snake}`);
        const row = r.rows[0] || {};
        return { count: Number(row.count||0), last_ts: row.last_ts ? new Date(row.last_ts).toISOString() : null };
      }
      const db = engine.sqliteDb;
      const row = db.prepare(`SELECT COUNT(*) AS count, MAX(timestamp) AS last_ts FROM ${snake}`).get();
      return { count: Number(row?.count||0), last_ts: row?.last_ts || null };
    }
  };
}
