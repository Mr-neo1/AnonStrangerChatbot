/**
 * User Data Cache Service
 * Reduces database load by caching frequently accessed user data in Redis
 * Critical for scaling to high user counts (30k-40k DAU)
 */

const { redisClient } = require('../database/redisClient');
const User = require('../models/userModel');

const CACHE_TTL = 600; // 10 minutes cache (reduced DB load for high traffic)
const CACHE_PREFIX = 'user:cache:';

class UserCacheService {
  /**
   * Get user data with caching (batched support)
   * @param {number|string|Array} userIds - Single userId or array of userIds
   * @param {Array} attributes - Attributes to fetch (default: all essential fields)
   * @returns {Object|Array} User data or null
   */
  static async getUser(userIds, attributes = ['userId', 'gender', 'age', 'banned', 'botId']) {
    const isBatch = Array.isArray(userIds);
    const ids = isBatch ? userIds : [userIds];
    
    if (ids.length === 0) return isBatch ? [] : null;
    
    const results = await Promise.all(
      ids.map(async (userId) => {
        const uid = String(userId);
        const cacheKey = `${CACHE_PREFIX}${uid}`;
        
        try {
          // Try cache first
          const cached = await redisClient.get(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached);
            // Filter to requested attributes
            if (attributes.length < 5) {
              const filtered = {};
              attributes.forEach(attr => { if (attr in parsed) filtered[attr] = parsed[attr]; });
              return filtered;
            }
            return parsed;
          }
          
          // Cache miss - fetch from database (only existing columns)
          const user = await User.findOne({ 
            where: { userId }, 
            attributes: ['userId', 'telegramId', 'botId', 'gender', 'age', 'banned', 'totalChats', 'dailyStreak', 'vipGender', 'hasStarted']
          });
          
          if (user) {
            const userData = user.toJSON();
            // Store in cache (fire-and-forget)
            redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(userData)).catch(() => {});
            
            // Return filtered data
            if (attributes.length < 6) {
              const filtered = {};
              attributes.forEach(attr => { if (attr in userData) filtered[attr] = userData[attr]; });
              return filtered;
            }
            return userData;
          }
          
          return null;
        } catch (err) {
          console.error(`Cache error for user ${userId}:`, err.message);
          // Fallback to direct DB query on cache error
          try {
            const user = await User.findOne({ where: { userId }, attributes });
            return user ? user.toJSON() : null;
          } catch (dbErr) {
            return null;
          }
        }
      })
    );
    
    return isBatch ? results : results[0];
  }

  /**
   * Invalidate user cache (call when user data changes)
   * @param {number|string} userId
   */
  static async invalidate(userId) {
    const cacheKey = `${CACHE_PREFIX}${String(userId)}`;
    try {
      await redisClient.del(cacheKey);
    } catch (err) {
      // Ignore cache deletion errors
    }
  }

  /**
   * Batch invalidate multiple users
   * @param {Array} userIds
   */
  static async invalidateBatch(userIds) {
    if (!userIds || userIds.length === 0) return;
    const keys = userIds.map(id => `${CACHE_PREFIX}${String(id)}`);
    try {
      await redisClient.del(keys);
    } catch (err) {
      // Ignore
    }
  }

  /**
   * Preload users into cache (useful before matching)
   * @param {Array} userIds
   */
  static async preload(userIds) {
    if (!userIds || userIds.length === 0) return;
    
    // Use getUser which will populate cache
    await UserCacheService.getUser(userIds);
  }

  /**
   * Get partner ID from cache (most frequent operation)
   * @param {number|string} chatId
   * @returns {string|null} Partner ID
   */
  static async getPartnerId(chatId) {
    try {
      return await redisClient.get(`pair:${chatId}`);
    } catch (err) {
      return null;
    }
  }

  /**
   * Batch get partner IDs
   * @param {Array} chatIds
   * @returns {Array} Array of partner IDs (null if not paired)
   */
  static async getPartnerIds(chatIds) {
    if (!chatIds || chatIds.length === 0) return [];
    
    const keys = chatIds.map(id => `pair:${id}`);
    try {
      return await redisClient.mGet(keys);
    } catch (err) {
      return chatIds.map(() => null);
    }
  }
}

module.exports = UserCacheService;
