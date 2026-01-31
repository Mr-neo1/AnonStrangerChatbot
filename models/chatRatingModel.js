/**
 * Chat Rating Model
 * Stores user feedback after chat sessions
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connectionPool');

const ChatRating = sequelize.define('ChatRating', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  
  // Who gave the rating
  raterId: {
    type: DataTypes.BIGINT,
    allowNull: false
  },
  
  // Who was rated
  ratedUserId: {
    type: DataTypes.BIGINT,
    allowNull: false
  },
  
  // Rating type: 'positive' (thumbs up) or 'negative' (thumbs down)
  ratingType: {
    type: DataTypes.ENUM('positive', 'negative', 'skipped'),
    allowNull: false,
    defaultValue: 'skipped'
  },
  
  // Report reason if negative
  reportReason: {
    type: DataTypes.ENUM('none', 'vcs_spam', 'vulgar', 'harassment', 'underage', 'other'),
    allowNull: false,
    defaultValue: 'none'
  },
  
  // Additional details for 'other' reason
  reportDetails: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  
  // Chat metadata
  chatDuration: {
    type: DataTypes.INTEGER, // seconds
    allowNull: true
  },
  
  messageCount: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  
  // Who ended the chat
  endedBy: {
    type: DataTypes.ENUM('rater', 'rated', 'system', 'unknown'),
    allowNull: false,
    defaultValue: 'unknown'
  },
  
  // Bot the chat occurred on
  botId: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  
  // Was this reviewed by admin?
  reviewed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  
  reviewedBy: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  
  reviewedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  
  // Action taken (if any)
  actionTaken: {
    type: DataTypes.STRING(100),
    allowNull: true
  }
}, {
  tableName: 'ChatRating',
  freezeTableName: true,
  timestamps: true,
  indexes: [
    { fields: ['raterId'] },
    { fields: ['ratedUserId'] },
    { fields: ['ratingType'] },
    { fields: ['reportReason'] },
    { fields: ['reviewed'] },
    { fields: ['createdAt'] },
    // Composite indexes for common queries
    { fields: ['ratedUserId', 'ratingType'] },
    { fields: ['reportReason', 'reviewed'] }
  ]
});

module.exports = ChatRating;
