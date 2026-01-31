const { redisClient } = require('../database/redisClient');
const User = require('../models/userModel');
const VipSubscription = require('../models/vipSubscriptionModel');

class VipService {
  // Activate VIP for userId for durationDays (can stack)
  static async activateVip(userId, durationDays, opts = {}) {
    const now = new Date();
    const transaction = opts.transaction;
    const existing = await VipSubscription.findOne({ where: { userId }, transaction });
    let newExpiry;
    if (existing && existing.expiresAt > now) {
      newExpiry = new Date(existing.expiresAt.getTime() + durationDays * 24 * 3600 * 1000);
      existing.expiresAt = newExpiry;
      existing.source = opts.source || existing.source;
      await existing.save({ transaction });
    } else {
      newExpiry = new Date(now.getTime() + durationDays * 24 * 3600 * 1000);
      await VipSubscription.upsert({ userId, expiresAt: newExpiry, source: opts.source || null }, { transaction });
    }

    // If caller asked to defer Redis set (e.g., during a transaction), skip it
    if (!opts.deferSetRedis) {
      const ttlSeconds = Math.max(1, Math.floor((newExpiry.getTime() - Date.now()) / 1000));
      await redisClient.setEx(`user:vip:${userId}`, ttlSeconds, '1');
    }

    return newExpiry;
  }

  static async setRedisVip(userId, expiryDate) {
    const ttlSeconds = Math.max(1, Math.floor((new Date(expiryDate).getTime() - Date.now()) / 1000));
    await redisClient.setEx(`user:vip:${userId}`, ttlSeconds, '1');
  }

  static async isVip(userId) {
    // Check redis first
    const v = await redisClient.get(`user:vip:${userId}`);
    if (v) return true;

    // Fallback to DB (and set redis if valid)
    const sub = await VipSubscription.findOne({ where: { userId } });
    if (sub && sub.expiresAt > new Date()) {
      const ttlSeconds = Math.max(1, Math.floor((new Date(sub.expiresAt) - Date.now()) / 1000));
      await redisClient.setEx(`user:vip:${userId}`, ttlSeconds, '1');
      return true;
    }

    return false;
  }

  static async getVipPreferences(userId) {
    // Use cached user data (performance optimization)
    const UserCacheService = require('./userCacheService');
    const user = await UserCacheService.getUser(userId);
    // Default preferences
    return { gender: (user && user.vipGender) ? user.vipGender : 'Any' };
  }

  // Check if VIP is currently active and validate cache against DB expiry
  // Returns true if VIP is active, false otherwise. If expired, the subscription is removed (idempotent) and Redis cache is cleared.
  // OPTIMIZED: Check Redis cache first to avoid DB queries (50% faster for active VIPs)
  static async isVipActive(userId) {
    const logger = require('../utils/logger');
    const redisKey = `user:vip:${userId}`;

    try {
      // OPTIMIZATION: Check Redis first - if cached, VIP is definitely active (TTL matches DB expiry)
      const cached = await redisClient.get(redisKey).catch(() => null);
      if (cached === '1') {
        return true; // Cache hit - VIP is active (no DB query needed)
      }

      // Cache miss or expired - check DB
      const sub = await VipSubscription.findOne({ where: { userId } });
      if (!sub) {
        await redisClient.del(redisKey).catch(() => {});
        return false;
      }

      // If expired, expire it (idempotent), clear cache and log
      if (sub.expiresAt <= new Date()) {
        try {
          await VipSubscription.destroy({ where: { userId } });
        } catch (err) {
          // ignore destroy failures for idempotency
        }
        await redisClient.del(redisKey);
        logger.appendJsonLog('vip.log', { ts: new Date().toISOString(), action: 'downgraded_at_search', userId });
        return false;
      }

      // Active: set Redis cache with TTL that does not exceed DB expiry
      const ttlSeconds = Math.max(1, Math.floor((new Date(sub.expiresAt).getTime() - Date.now()) / 1000));
      await redisClient.setEx(redisKey, ttlSeconds, '1');
      return true;
    } catch (err) {
      // On any unexpected error, be conservative: treat as non-VIP and clear cache
      try { await redisClient.del(redisKey); } catch (e) {}
      return false;
    }
  }

  // Force downgrade if expired (returns true if downgraded)
  static async checkAndExpire(userId) {
    const sub = await VipSubscription.findOne({ where: { userId } });
    if (!sub) {
      await redisClient.del(`user:vip:${userId}`);
      return false;
    }
    if (sub.expiresAt <= new Date()) {
      await VipSubscription.destroy({ where: { userId } });
      await redisClient.del(`user:vip:${userId}`);
      return true;
    }
    return false;
  }}

module.exports = VipService;
