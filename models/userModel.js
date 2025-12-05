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
});

// For local dev; in production, use migrations.
User.sync();

module.exports = User;
