const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connectionPool');

// New additive table to store affiliate reward credits. MANUAL SQL required to create this table in production.
const AffiliateRewardCredit = sequelize.models.AffiliateRewardCredit || sequelize.define('AffiliateRewardCredit', {
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  referrerTelegramId: { type: DataTypes.BIGINT, allowNull: false },
  sourcePaymentId: { type: DataTypes.STRING, allowNull: false },
  rewardType: { type: DataTypes.ENUM('VIP_DAYS', 'LOCK_MINUTES'), allowNull: false },
  rewardValue: { type: DataTypes.INTEGER, allowNull: false },
  status: { type: DataTypes.ENUM('AVAILABLE','REDEEMED'), allowNull: false, defaultValue: 'AVAILABLE' },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'AffiliateRewardCredits',
  freezeTableName: true,
  timestamps: true,
});

// NOTE: This table must be created manually in production using the SQL in scripts/migrations/create-affiliate-rewards-credits.sql

module.exports = AffiliateRewardCredit;