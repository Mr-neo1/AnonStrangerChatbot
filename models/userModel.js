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
}, {
  tableName: 'User',
  freezeTableName: true,
  timestamps: true,
});

// For local dev; schema updates must be performed via offline migrations. Runtime model.sync has been removed to prevent accidental schema changes.


module.exports = User;
