const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connectionPool');

const StarTransaction = sequelize.models.StarTransaction || sequelize.define('StarTransaction', {
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.BIGINT, allowNull: false },
  telegramChargeId: { type: DataTypes.STRING, unique: true, allowNull: false },
  amount: { type: DataTypes.INTEGER, allowNull: false },
  currency: { type: DataTypes.STRING, allowNull: false },
  payload: { type: DataTypes.STRING, allowNull: true },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'StarTransactions',
  freezeTableName: true,
  timestamps: true,
  indexes: [
    // Index for user payment history
    { fields: ['userId'] },
    // Index for transaction lookups
    { fields: ['telegramChargeId'], unique: true },
    // Index for revenue analytics
    { fields: ['createdAt'] },
    // Composite index for user revenue queries
    { fields: ['userId', 'createdAt'] },
  ]
});

if (process.env.ALLOW_MODEL_SYNC === 'true') {
  // Runtime schema sync removed. Use offline migrations to alter production schemas.
}


module.exports = StarTransaction;