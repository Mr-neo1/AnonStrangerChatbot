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
  messageCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  botId: {
    type: DataTypes.STRING,
    allowNull: true,
  },
}, {
  tableName: 'Chats',
  freezeTableName: true,
  timestamps: true,
  indexes: [
    // Index for finding chats by user1
    { fields: ['user1'] },
    // Index for finding chats by user2
    { fields: ['user2'] },
    // Index for active chat queries
    { fields: ['active'] },
    // Composite index for active chats by user
    { fields: ['user1', 'active'] },
    { fields: ['user2', 'active'] },
    // Index for recent chats sorting
    { fields: ['createdAt'] },
  ]
});

// Runtime schema sync for new columns
Chat.sync({ alter: true }).catch(err => console.error('Chat sync error:', err.message));


module.exports = Chat;
