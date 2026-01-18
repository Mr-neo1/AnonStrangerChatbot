const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connectionPool');

const Referral = sequelize.models.Referral || sequelize.define('Referral', {
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  inviterId: { type: DataTypes.BIGINT, allowNull: false },
  invitedId: { type: DataTypes.BIGINT, allowNull: false },
  status: { type: DataTypes.ENUM('pending','accepted','invalid'), allowNull: false, defaultValue: 'pending' },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'Referrals',
  freezeTableName: true,
  timestamps: true,
});

if (process.env.ALLOW_MODEL_SYNC === 'true') {
  // Runtime schema sync removed. Use offline migrations to alter production schemas.
}


module.exports = Referral;