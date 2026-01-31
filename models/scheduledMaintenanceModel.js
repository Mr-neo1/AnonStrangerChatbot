/**
 * Scheduled Maintenance Model
 * Stores maintenance windows with notifications
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connectionPool');

const ScheduledMaintenance = sequelize.define('ScheduledMaintenance', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  
  // Maintenance title/description
  title: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  
  // Schedule times
  startTime: {
    type: DataTypes.DATE,
    allowNull: false
  },
  
  endTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  
  // Duration in minutes (if endTime not set)
  durationMinutes: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  
  // Status
  status: {
    type: DataTypes.ENUM('scheduled', 'active', 'completed', 'cancelled'),
    defaultValue: 'scheduled'
  },
  
  // Should users be notified?
  notifyUsers: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  
  // Notification sent timestamp
  notificationSentAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  
  // How many minutes before to send notification
  notifyBeforeMinutes: {
    type: DataTypes.INTEGER,
    defaultValue: 30
  },
  
  // Custom message for users
  userMessage: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  
  // Created by admin
  createdBy: {
    type: DataTypes.STRING(100),
    allowNull: false
  }
}, {
  tableName: 'ScheduledMaintenance',
  freezeTableName: true,
  timestamps: true,
  indexes: [
    { fields: ['startTime'] },
    { fields: ['status'] },
    { fields: ['createdBy'] }
  ]
});

module.exports = ScheduledMaintenance;
