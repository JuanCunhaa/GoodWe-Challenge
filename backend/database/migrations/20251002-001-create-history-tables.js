/** @type {import('sequelize-cli').Migration} */
export const up = async ({ context }) => {
  const qi = context.getQueryInterface ? context.getQueryInterface() : context;
  const { DataTypes } = context.sequelize || (await import('sequelize'));

  await qi.createTable('generation_history', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    plant_id: { type: DataTypes.STRING, allowNull: false },
    timestamp: { type: DataTypes.DATE, allowNull: false },
    kwh: { type: DataTypes.DOUBLE, allowNull: false },
  });
  await qi.addIndex('generation_history', ['plant_id', 'timestamp']);

  await qi.createTable('consumption_history', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    plant_id: { type: DataTypes.STRING, allowNull: false },
    timestamp: { type: DataTypes.DATE, allowNull: false },
    kwh: { type: DataTypes.DOUBLE, allowNull: false },
  });
  await qi.addIndex('consumption_history', ['plant_id', 'timestamp']);

  await qi.createTable('battery_history', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    plant_id: { type: DataTypes.STRING, allowNull: false },
    timestamp: { type: DataTypes.DATE, allowNull: false },
    soc: { type: DataTypes.DOUBLE, allowNull: true },
    power_kw: { type: DataTypes.DOUBLE, allowNull: true },
  });
  await qi.addIndex('battery_history', ['plant_id', 'timestamp']);

  await qi.createTable('grid_history', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    plant_id: { type: DataTypes.STRING, allowNull: false },
    timestamp: { type: DataTypes.DATE, allowNull: false },
    power_kw: { type: DataTypes.DOUBLE, allowNull: true },
    import_kw: { type: DataTypes.DOUBLE, allowNull: true },
    export_kw: { type: DataTypes.DOUBLE, allowNull: true },
  });
  await qi.addIndex('grid_history', ['plant_id', 'timestamp']);
};

export const down = async ({ context }) => {
  const qi = context.getQueryInterface ? context.getQueryInterface() : context;
  await qi.dropTable('grid_history');
  await qi.dropTable('battery_history');
  await qi.dropTable('consumption_history');
  await qi.dropTable('generation_history');
};

