const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connectionPool');

const LockHistory = sequelize.models.LockHistory || sequelize.define('LockHistory', {
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  chatId: { type: DataTypes.BIGINT, allowNull: false },
  userId: { type: DataTypes.BIGINT, allowNull: false },
  durationMinutes: { type: DataTypes.INTEGER, allowNull: false },
  startedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  starsPaid: { type: DataTypes.INTEGER, allowNull: true }
}, {
  tableName: 'Locks',
  freezeTableName: true,
  timestamps: true,
});

if (process.env.ALLOW_MODEL_SYNC === 'true') {
  // Runtime schema sync removed. Use offline migrations to alter production schemas.
}


module.exports = LockHistory;