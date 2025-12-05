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
  gender: {
    type: DataTypes.ENUM("Male", "Female", "Other"),
    allowNull: true,
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
});

// For local dev; in production, use migrations.
User.sync({ force: true }); // Force recreate table with new schema

module.exports = User;
