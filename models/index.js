const { sequelize } = require('../database/connectionPool');

// Load models and export them
const User = require('./userModel');
const Chat = require('./chatModel');
const VipSubscription = require('./vipSubscriptionModel');
const StarTransaction = require('./starTransactionModel');
const LockHistory = require('./lockChatModel');
const Referral = require('./referralModel');
const AffiliateReward = require('./affiliateRewardModel');
const Ban = require('./banModel');
const AppConfig = require('./appConfigModel');

// New models for enhanced features
const ChatRating = require('./chatRatingModel');
const AdminAuditLog = require('./adminAuditLogModel');
const AnalyticsStats = require('./analyticsStatsModel');
const ScheduledMaintenance = require('./scheduledMaintenanceModel');
const AdminLoginToken = require('./adminLoginTokenModel');

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

// Setup model associations (only if not already defined)
function setupAssociations() {
  // Only setup associations if they haven't been defined yet
  if (!Referral.associations.inviter) {
    Referral.belongsTo(User, { as: 'inviter', foreignKey: 'inviterId' });
  }
  if (!Referral.associations.invited) {
    Referral.belongsTo(User, { as: 'invited', foreignKey: 'invitedId' });
  }
  
  // Chat associations - using different aliases to avoid naming collision with existing columns
  if (!Chat.associations.firstUser) {
    Chat.belongsTo(User, { as: 'firstUser', foreignKey: 'user1' });
  }
  if (!Chat.associations.secondUser) {
    Chat.belongsTo(User, { as: 'secondUser', foreignKey: 'user2' });
  }
  
  // ChatRating associations
  if (!ChatRating.associations.rater) {
    ChatRating.belongsTo(User, { as: 'rater', foreignKey: 'raterId' });
  }
  if (!ChatRating.associations.ratedUser) {
    ChatRating.belongsTo(User, { as: 'ratedUser', foreignKey: 'ratedUserId' });
  }
}

setupAssociations();
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
  Ban,
  AppConfig,
  // New models
  ChatRating,
  AdminAuditLog,
  AnalyticsStats,
  ScheduledMaintenance,
  AdminLoginToken,
};
