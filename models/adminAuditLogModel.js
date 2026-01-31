/**
 * Admin Audit Log Model
 * Tracks all admin actions for accountability
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connectionPool');

const AdminAuditLog = sequelize.define('AdminAuditLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  
  // Admin identifier (Telegram ID or username)
  adminId: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  
  // Admin display name
  adminName: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  
  // Action category
  category: {
    type: DataTypes.ENUM(
      'auth',           // Login/logout
      'user',           // User management (ban/unban/vip)
      'config',         // Configuration changes
      'broadcast',      // Broadcast messages
      'bot',            // Bot management
      'export',         // Data exports
      'maintenance',    // Maintenance mode
      'report',         // Report reviews
      'other'
    ),
    allowNull: false
  },
  
  // Specific action
  action: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  
  // Target of the action (user ID, config key, etc.)
  targetType: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  
  targetId: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  
  // Previous value (for config changes)
  previousValue: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  
  // New value
  newValue: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  
  // Additional details (JSON)
  details: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const raw = this.getDataValue('details');
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },
    set(value) {
      if (typeof value === 'object') {
        this.setDataValue('details', JSON.stringify(value));
      } else {
        this.setDataValue('details', value);
      }
    }
  },
  
  // Request metadata
  ipAddress: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  
  userAgent: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  
  // Success/failure
  success: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'AdminAuditLog',
  freezeTableName: true,
  timestamps: true,
  updatedAt: false, // Audit logs should not be updated
  indexes: [
    { fields: ['adminId'] },
    { fields: ['category'] },
    { fields: ['action'] },
    { fields: ['targetType', 'targetId'] },
    { fields: ['createdAt'] },
    { fields: ['success'] }
  ]
});

module.exports = AdminAuditLog;
