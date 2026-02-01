#!/usr/bin/env node
/**
 * Initialize required PostgreSQL tables for the bot using Sequelize QueryInterface.
 * Safe, additive-only: creates tables and indexes if missing. No destructive changes.
 */
const { Sequelize, DataTypes } = require('sequelize');
const config = require('../config/config');
const { sequelize } = require('../database/connectionPool');

async function ensureTable(queryInterface, tableName, definition, indexes = []) {
  const tables = await queryInterface.showAllTables();
  const exists = tables.includes(tableName);
  if (exists) {
    console.log(`- Table exists: ${tableName}`);
    return false;
  }
  await queryInterface.createTable(tableName, definition);
  for (const idx of indexes) {
    await queryInterface.addIndex(tableName, idx.fields, {
      name: idx.name,
      unique: !!idx.unique,
      using: idx.using,
    });
  }
  console.log(`  ✅ Created ${tableName}`);
  return true;
}

async function main() {
  if (!config.POSTGRES_URI) {
    console.error('❌ POSTGRES_URI not set. This script is for PostgreSQL only.');
    process.exit(2);
  }

  try {
    await sequelize.authenticate();
  } catch (err) {
    console.error('❌ Failed to connect to PostgreSQL:', err.message);
    process.exit(1);
  }

  const qi = sequelize.getQueryInterface();
  console.log('Initializing PostgreSQL schema...');

  // User table (matches models/userModel.js)
  await ensureTable(qi, 'User', {
    userId: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false },
    telegramId: { type: DataTypes.BIGINT, allowNull: false },
    username: { type: DataTypes.STRING(255), allowNull: true },
    firstName: { type: DataTypes.STRING(255), allowNull: true },
    lastName: { type: DataTypes.STRING(255), allowNull: true },
    botId: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'default' },
    botName: { type: DataTypes.STRING(100), allowNull: true },
    gender: { type: DataTypes.ENUM('Male', 'Female', 'Other'), allowNull: true },
    vipGender: { type: DataTypes.ENUM('Male', 'Female', 'Other', 'Any'), allowNull: true, defaultValue: 'Any' },
    vipAgeMin: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
    vipAgeMax: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
    hasStarted: { type: DataTypes.BOOLEAN, defaultValue: false },
    age: { type: DataTypes.INTEGER, allowNull: true },
    banned: { type: DataTypes.BOOLEAN, defaultValue: false },
    totalChats: { type: DataTypes.INTEGER, defaultValue: 0 },
    dailyStreak: { type: DataTypes.INTEGER, defaultValue: 0 },
    lastActiveDate: { type: DataTypes.DATEONLY, allowNull: true },
    allowMedia: { type: DataTypes.BOOLEAN, defaultValue: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
  }, [
    { fields: ['banned'], name: 'idx_user_banned' },
    { fields: ['botId'], name: 'idx_user_botId' },
    { fields: ['banned', 'hasStarted'], name: 'idx_user_banned_hasStarted' },
    { fields: ['gender'], name: 'idx_user_gender' },
    { fields: ['vipGender'], name: 'idx_user_vipGender' },
    { fields: ['lastActiveDate'], name: 'idx_user_lastActiveDate' },
  ]);

  // Chats table (matches models/chatModel.js)
  await ensureTable(qi, 'Chats', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    user1: { type: DataTypes.BIGINT, allowNull: false },
    user2: { type: DataTypes.BIGINT, allowNull: false },
    active: { type: DataTypes.BOOLEAN, defaultValue: true },
    startedAt: { type: DataTypes.DATE, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
  }, [
    { fields: ['user1'], name: 'idx_chats_user1' },
    { fields: ['user2'], name: 'idx_chats_user2' },
    { fields: ['active'], name: 'idx_chats_active' },
    { fields: ['user1', 'active'], name: 'idx_chats_user1_active' },
    { fields: ['user2', 'active'], name: 'idx_chats_user2_active' },
    { fields: ['createdAt'], name: 'idx_chats_createdAt' },
  ]);

  // Locks table (matches models/lockChatModel.js)
  await ensureTable(qi, 'Locks', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    chatId: { type: DataTypes.BIGINT, allowNull: false },
    userId: { type: DataTypes.BIGINT, allowNull: false },
    durationMinutes: { type: DataTypes.INTEGER, allowNull: false },
    startedAt: { type: DataTypes.DATE, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    starsPaid: { type: DataTypes.INTEGER, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
  }, [
    { fields: ['chatId'], name: 'idx_locks_chatId' },
  ]);

  // VipSubscriptions (matches models/vipSubscriptionModel.js)
  await ensureTable(qi, 'VipSubscriptions', {
    userId: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    source: { type: DataTypes.STRING, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
  }, [
    { fields: ['expiresAt'], name: 'idx_vip_expiresAt' },
    { fields: ['source'], name: 'idx_vip_source' },
  ]);

  // StarTransactions (matches models/starTransactionModel.js)
  await ensureTable(qi, 'StarTransactions', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.BIGINT, allowNull: false },
    telegramChargeId: { type: DataTypes.STRING, allowNull: false, unique: true },
    amount: { type: DataTypes.INTEGER, allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false },
    payload: { type: DataTypes.STRING, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
  }, [
    { fields: ['userId'], name: 'idx_stars_userId' },
    { fields: ['telegramChargeId'], name: 'idx_stars_chargeId', unique: true },
    { fields: ['createdAt'], name: 'idx_stars_createdAt' },
    { fields: ['userId', 'createdAt'], name: 'idx_stars_user_createdAt' },
  ]);

  // Referrals (matches models/referralModel.js)
  await ensureTable(qi, 'Referrals', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    inviterId: { type: DataTypes.BIGINT, allowNull: false },
    invitedId: { type: DataTypes.BIGINT, allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'accepted', 'invalid'), allowNull: false, defaultValue: 'pending' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
  }, []);

  // AffiliateRewards (matches models/affiliateRewardModel.js)
  await ensureTable(qi, 'AffiliateRewards', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.BIGINT, allowNull: false },
    vipDaysGranted: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    source: { type: DataTypes.ENUM('affiliate_payment','referral_milestone'), allowNull: false, defaultValue: 'affiliate_payment' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
  }, [
    { fields: ['userId'], name: 'idx_affiliate_user' },
  ]);

  // AffiliateRewardCredits (matches models/affiliateRewardCreditModel.js)
  await ensureTable(qi, 'AffiliateRewardCredits', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    referrerTelegramId: { type: DataTypes.BIGINT, allowNull: false },
    sourcePaymentId: { type: DataTypes.STRING, allowNull: false },
    rewardType: { type: DataTypes.ENUM('VIP_DAYS', 'LOCK_MINUTES'), allowNull: false },
    rewardValue: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.ENUM('AVAILABLE','REDEEMED'), allowNull: false, defaultValue: 'AVAILABLE' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
  }, [
    { fields: ['referrerTelegramId'], name: 'idx_affiliate_credits_referrer' },
    { fields: ['status'], name: 'idx_affiliate_credits_status' },
  ]);

  // Bans (matches models/banModel.js)
  await ensureTable(qi, 'Bans', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.BIGINT, allowNull: false },
    reason: { type: DataTypes.TEXT },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
  }, [
    { fields: ['userId'], name: 'idx_bans_user' },
    { fields: ['createdAt'], name: 'idx_bans_createdAt' },
  ]);

  // LockCredits (uses custom script already; ensure here too)
  await ensureTable(qi, 'LockCredits', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    telegramId: { type: DataTypes.BIGINT, allowNull: false },
    minutes: { type: DataTypes.INTEGER, allowNull: false },
    consumed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
  }, [
    { fields: ['telegramId'], name: 'idx_lockcredits_telegramId' },
  ]);

  // app_config (matches models/appConfigModel.js)
  const appConfigTables = await qi.showAllTables();
  const hasAppConfig = appConfigTables.includes('app_config');
  if (!hasAppConfig) {
    await qi.createTable('app_config', {
      key: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      value: { type: DataTypes.TEXT, allowNull: true },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await qi.addIndex('app_config', ['key'], { name: 'idx_app_config_key', unique: true });
    console.log('  ✅ Created app_config');
  } else {
    console.log('- Table exists: app_config');
  }

  console.log('✅ PostgreSQL schema initialization complete.');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Schema initialization failed:', err);
  process.exit(1);
});
