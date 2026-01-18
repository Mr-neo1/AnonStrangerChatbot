const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connectionPool');

/**
 * AppConfig Model
 * Stores dynamic configuration that can be updated via admin dashboard
 * without requiring bot restart
 */
const AppConfig = sequelize.define('AppConfig', {
  key: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false,
    comment: 'Configuration key (e.g., vip_price_299, lock_chat_enabled)'
  },
  value: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Configuration value (stored as string, parsed as needed)'
  },
  updatedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'updatedAt'
  }
}, {
  tableName: 'app_config',
  timestamps: false,
  indexes: [
    {
      unique: true,
      fields: ['key']
    }
  ]
});

module.exports = AppConfig;
