import { initSequelize, ensureSynced, isPostgres, models } from '../../database/models/index.js';
import { getDbEngine } from '../db.js';

function toDate(d){ return (d instanceof Date) ? d : new Date(d); }

export async function initHistoryRepo() {
  if (isPostgres) {
    await initSequelize();
    await ensureSynced();
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
    if (isPostgres && models[table]) {
      await models[table].bulkCreate(rows.map(r => ({ ...r, timestamp: toDate(r.timestamp) })), { validate: false });
      return { inserted: rows.length };
    }
    // sqlite fallback via direct SQL
    const db = engine.sqliteDb;
    if (!db) return { inserted: 0 };
    const cols = Object.keys(rows[0]);
    const placeholders = '(' + cols.map(()=> '?').join(',') + ')';
    const tableName = camelToSnake(table);
    const stmt = db.prepare(`INSERT INTO ${tableName} (${cols.join(',')}) VALUES ${placeholders}`);
    const tx = db.transaction((items)=> { for (const it of items){ const vals = cols.map((c)=> c==='timestamp' ? new Date(it[c]).toISOString() : it[c]); stmt.run(...vals); } });
    tx(rows);
    return { inserted: rows.length };
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
  };
}
