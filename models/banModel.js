const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connectionPool');

// Simple ban table mapping to existing Bans schema
const Ban = sequelize.define('Bans', {
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.BIGINT, allowNull: false },
  reason: { type: DataTypes.TEXT },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  freezeTableName: true,
  timestamps: false,
  indexes: [
    // Index for fast ban checks by userId
    { fields: ['userId'] },
    // Index for recent bans
    { fields: ['createdAt'] },
  ]
});

module.exports = Ban;