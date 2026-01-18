const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connectionPool");

const Chat = sequelize.define("Chat", {
  user1: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  user2: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  startedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'Chats',
  freezeTableName: true,
  timestamps: true,
});

// Runtime schema sync removed. Use offline migrations to alter production schemas.


module.exports = Chat;
