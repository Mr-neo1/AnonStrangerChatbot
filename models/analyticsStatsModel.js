/**
 * Analytics Stats Model
 * Stores daily aggregated statistics for charts
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connectionPool');

const AnalyticsStats = sequelize.define('AnalyticsStats', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  
  // Date for the stats (YYYY-MM-DD)
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    unique: true
  },
  
  // User metrics
  newUsers: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  activeUsers: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  totalUsers: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  // Chat metrics
  totalChats: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  averageChatDuration: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  
  totalMessages: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  // VIP metrics
  newVipSubscriptions: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  activeVipUsers: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  vipRevenue: {
    type: DataTypes.INTEGER, // In Stars
    defaultValue: 0
  },
  
  // Lock chat metrics
  totalLocks: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  lockRevenue: {
    type: DataTypes.INTEGER, // In Stars
    defaultValue: 0
  },
  
  // Rating metrics
  positiveRatings: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  negativeRatings: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  totalReports: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  // Ban metrics
  newBans: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  unbans: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  // Peak concurrent users
  peakConcurrentUsers: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  
  // Referral metrics
  newReferrals: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  tableName: 'AnalyticsStats',
  freezeTableName: true,
  timestamps: true,
  indexes: [
    { fields: ['date'], unique: true }
  ]
});

module.exports = AnalyticsStats;
