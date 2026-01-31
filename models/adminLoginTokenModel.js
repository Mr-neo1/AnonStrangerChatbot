/**
 * Admin Login Token Model
 * For Telegram-based admin authentication
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connectionPool');

const AdminLoginToken = sequelize.define('AdminLoginToken', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  
  // Unique token for verification
  token: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true
  },
  
  // Telegram user ID requesting login
  telegramId: {
    type: DataTypes.BIGINT,
    allowNull: false
  },
  
  // Telegram username (for display)
  username: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  
  // Telegram first name
  firstName: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  
  // Token status
  status: {
    type: DataTypes.ENUM('pending', 'verified', 'expired', 'used'),
    defaultValue: 'pending'
  },
  
  // Expiry time (5 minutes from creation)
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  
  // IP address that requested the token
  requestIp: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  
  // When token was verified via bot
  verifiedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  
  // Session token returned after successful verification
  sessionToken: {
    type: DataTypes.STRING(64),
    allowNull: true
  }
}, {
  tableName: 'AdminLoginToken',
  freezeTableName: true,
  timestamps: true,
  indexes: [
    { fields: ['token'], unique: true },
    { fields: ['telegramId'] },
    { fields: ['status'] },
    { fields: ['expiresAt'] }
  ]
});

module.exports = AdminLoginToken;
