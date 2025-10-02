import { Sequelize, DataTypes } from 'sequelize';

// Simple Sequelize bootstrap for Postgres-only usage in this project.
// If DATABASE_URL is not present, this module exports nulls (handled by callers).

const connectionString = process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim();
export const isPostgres = !!connectionString;

export let sequelize = null;
export const models = {};

export async function initSequelize() {
  if (!isPostgres) return { sequelize: null, models: {} };
  if (sequelize) return { sequelize, models };

  sequelize = new Sequelize(connectionString, {
    dialect: 'postgres',
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
    logging: false,
    define: { timestamps: false },
  });

  // Define models
  models.GenerationHistory = sequelize.define('GenerationHistory', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    plant_id: { type: DataTypes.STRING, allowNull: false },
    timestamp: { type: DataTypes.DATE, allowNull: false },
    kwh: { type: DataTypes.DOUBLE, allowNull: false },
  }, {
    tableName: 'generation_history',
    timestamps: false,
    indexes: [
      { fields: ['plant_id'] },
      { fields: ['timestamp'] },
      { fields: ['plant_id', 'timestamp'] },
    ],
  });

  models.ConsumptionHistory = sequelize.define('ConsumptionHistory', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    plant_id: { type: DataTypes.STRING, allowNull: false },
    timestamp: { type: DataTypes.DATE, allowNull: false },
    kwh: { type: DataTypes.DOUBLE, allowNull: false },
  }, {
    tableName: 'consumption_history',
    timestamps: false,
    indexes: [
      { fields: ['plant_id'] },
      { fields: ['timestamp'] },
      { fields: ['plant_id', 'timestamp'] },
    ],
  });

  models.BatteryHistory = sequelize.define('BatteryHistory', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    plant_id: { type: DataTypes.STRING, allowNull: false },
    timestamp: { type: DataTypes.DATE, allowNull: false },
    soc: { type: DataTypes.DOUBLE, allowNull: true },
    power_kw: { type: DataTypes.DOUBLE, allowNull: true },
  }, {
    tableName: 'battery_history',
    timestamps: false,
    indexes: [
      { fields: ['plant_id'] },
      { fields: ['timestamp'] },
      { fields: ['plant_id', 'timestamp'] },
    ],
  });

  models.GridHistory = sequelize.define('GridHistory', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    plant_id: { type: DataTypes.STRING, allowNull: false },
    timestamp: { type: DataTypes.DATE, allowNull: false },
    power_kw: { type: DataTypes.DOUBLE, allowNull: true },
    import_kw: { type: DataTypes.DOUBLE, allowNull: true },
    export_kw: { type: DataTypes.DOUBLE, allowNull: true },
  }, {
    tableName: 'grid_history',
    timestamps: false,
    indexes: [
      { fields: ['plant_id'] },
      { fields: ['timestamp'] },
      { fields: ['plant_id', 'timestamp'] },
    ],
  });

  return { sequelize, models };
}

export async function ensureSynced() {
  if (!isPostgres) return; // sqlite handled separately
  if (!sequelize) await initSequelize();
  await sequelize.sync();
}
