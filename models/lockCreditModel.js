const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connectionPool');

const LockCredit = sequelize.models.LockCredit || sequelize.define('LockCredit', {
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  telegramId: { type: DataTypes.BIGINT, allowNull: false },
  minutes: { type: DataTypes.INTEGER, allowNull: false },
  consumed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'LockCredits',
  freezeTableName: true,
  timestamps: true,
});

module.exports = LockCredit;