const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connectionPool");

const User = sequelize.define("User", {
  userId: {
    type: DataTypes.BIGINT,
    allowNull: false,
    primaryKey: true,
    unique: true,
  },
  telegramId: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  botId: {
    // Which bot the user joined from (for federation tracking)
    // e.g., 'bot_0', 'bot_1', 'default'
    type: DataTypes.STRING(50),
    defaultValue: 'default',
    allowNull: false
  },
  botName: {
    // Human-readable bot name (e.g., 'Unknown meet bot', 'Random chat bot')
    type: DataTypes.STRING(100),
    allowNull: true
  },
  gender: {
    type: DataTypes.ENUM("Male", "Female", "Other"),
    allowNull: true,
  },
  vipGender: {
    // VIP-specific matching preference (only for VIPs)
    type: DataTypes.ENUM("Male", "Female", "Other", "Any"),
    allowNull: true,
    defaultValue: 'Any'
  },
  vipAgeMin: {
    // VIP-specific age preference - minimum
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null
  },
  vipAgeMax: {
    // VIP-specific age preference - maximum
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null
  },
  hasStarted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  age: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  banned: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  totalChats: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  dailyStreak: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  lastActiveDate: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  allowMedia: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Privacy setting: allow receiving media from partners'
  },
}, {
  tableName: 'User',
  freezeTableName: true,
  timestamps: true,
  indexes: [
    // Index on userId (primary key - auto-indexed)
    // Index for banned user lookups
    { fields: ['banned'] },
    // Index for bot-specific queries
    { fields: ['botId'] },
    // Composite index for active user queries
    { fields: ['banned', 'hasStarted'] },
    // Index for gender-based matching
    { fields: ['gender'] },
    // Index for VIP gender preference
    { fields: ['vipGender'] },
    // Index for last active tracking
    { fields: ['lastActiveDate'] },
  ]
});

// For local dev; schema updates must be performed via offline migrations. Runtime model.sync has been removed to prevent accidental schema changes.


module.exports = User;
