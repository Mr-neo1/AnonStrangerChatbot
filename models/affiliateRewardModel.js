const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connectionPool');

const AffiliateReward = sequelize.models.AffiliateReward || sequelize.define('AffiliateReward', {
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.BIGINT, allowNull: false },
  vipDaysGranted: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  source: { type: DataTypes.ENUM('affiliate_payment','referral_milestone'), allowNull: false, defaultValue: 'affiliate_payment' },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'AffiliateRewards',
  freezeTableName: true,
  timestamps: true,
});

if (process.env.ALLOW_MODEL_SYNC === 'true') {
  // Runtime schema sync removed. Use offline migrations to alter production schemas.
}


module.exports = AffiliateReward;