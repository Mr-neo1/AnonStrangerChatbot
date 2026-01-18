const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connectionPool');

// Safe-define: avoid redefining if model already exists
const VipSubscription = sequelize.models.VipSubscription || sequelize.define('VipSubscription', {
  userId: { type: DataTypes.BIGINT, allowNull: false, primaryKey: true },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  source: { type: DataTypes.STRING, allowNull: true }
}, {
  tableName: 'VipSubscriptions',
  freezeTableName: true,
  timestamps: true,
});

// Runtime schema sync removed. Use offline migrations to alter production schemas.


module.exports = VipSubscription;