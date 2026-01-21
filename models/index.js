const { sequelize } = require('../database/connectionPool');

// Load models and export them
const User = require('./userModel');
const Chat = require('./chatModel');
const VipSubscription = require('./vipSubscriptionModel');
const StarTransaction = require('./starTransactionModel');
const LockHistory = require('./lockChatModel');
const Referral = require('./referralModel');
const AffiliateReward = require('./affiliateRewardModel');

async function ensureIndexes() {
  const tasks = [];
  const addSafe = (model, fields, name) => {
    if (!model || !model.addIndex) return;
    tasks.push(model.addIndex(fields, { name, concurrently: false, unique: false }).catch(() => {}));
  };

  // Existing indexes
  addSafe(User, ['userId'], 'idx_user_userId');
  addSafe(User, ['createdAt'], 'idx_user_createdAt');
  addSafe(Chat, ['active'], 'idx_chats_active');
  addSafe(Chat, ['createdAt'], 'idx_chats_createdAt');
  addSafe(VipSubscription, ['userId'], 'idx_vip_userId');
  addSafe(VipSubscription, ['expiresAt'], 'idx_vip_expiresAt');
  addSafe(StarTransaction, ['userId'], 'idx_star_tx_userId');
  addSafe(StarTransaction, ['createdAt'], 'idx_star_tx_createdAt');
  
  // OPTIMIZATION: Add performance indexes
  addSafe(User, ['banned'], 'idx_user_banned');
  addSafe(User, ['gender'], 'idx_user_gender');
  addSafe(VipSubscription, ['userId', 'expiresAt'], 'idx_vip_user_expires');

  return Promise.all(tasks);
}

ensureIndexes().catch(() => {});

module.exports = {
  sequelize,
  User,
  Chat,
  VipSubscription,
  StarTransaction,
  LockHistory,
  Referral,
  AffiliateReward,
};
