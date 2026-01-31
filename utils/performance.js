// Performance optimization utilities
const { redisClient } = require("../database/redisClient");
const { scanKeys } = require("../utils/redisScanHelper");

// Cache frequently accessed data
const cache = {
  // Cache user data for 5 minutes to reduce DB queries
  async getUser(userId) {
    const cacheKey = `user:${userId}`;
    let user = await redisClient.get(cacheKey);
    
    if (user) {
      return JSON.parse(user);
    }
    
    // If not in cache, will be fetched from DB and cached
    return null;
  },

  async setUser(userId, userData) {
    const cacheKey = `user:${userId}`;
    await redisClient.setEx(cacheKey, 300, JSON.stringify(userData)); // 5 min cache
  },

  async deleteUser(userId) {
    const cacheKey = `user:${userId}`;
    await redisClient.del(cacheKey);
  }
};

// Rate limiting to prevent spam and reduce server load
const rateLimiter = {
  async checkLimit(userId, action = 'message', limit = 90, window = 60) {
    const key = `rate:${action}:${userId}`;
    const current = await redisClient.incr(key);
    
    if (current === 1) {
      await redisClient.expire(key, window);
    }
    
    return current <= limit;
  }
};

// Smart memory optimization - preserve active chats
const cleanup = {
  async cleanInactiveData() {
    try {
      // Only clean queue duplicates (safe) for both VIP and general queues
      const keysHelper = require('../utils/redisKeys');
      const botId = require('../config/config').BOT_ID || 'default';
      const queueKeys = [keysHelper.QUEUE_VIP_KEY(botId), keysHelper.QUEUE_GENERAL_KEY(botId), 'queue:vip', 'queue:general'];
      
      for (const key of queueKeys) {
        try {
          const waiting = await redisClient.lRange(key, 0, -1);
          const unique = [...new Set(waiting)];
          if (waiting.length !== unique.length) {
            await redisClient.del(key);
            if (unique.length > 0) {
              await redisClient.lPush(key, ...unique);
            }
          }
        } catch (e) {
          // Ignore individual queue errors
        }
      }
      
      // Clean old rate limit keys only (safe) - Use SCAN instead of KEYS
      const pattern = 'rate:*';
      const rateLimitKeys = await scanKeys(redisClient, pattern, 100);
      
      // Use individual commands instead of pipeline (more compatible)
      for (const key of rateLimitKeys) {
        try {
          const ttl = await redisClient.ttl(key);
          if (ttl === -1) {
            await redisClient.expire(key, 3600); // 1 hour expiry for rate limits
          }
        } catch (e) {
          // Ignore individual key errors
        }
      }
      
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  },

  // Smart session management - extend active chats
  async extendActiveSessions() {
    try {
      // Use SCAN instead of KEYS for better performance
      const pattern = 'pair:*';
      const pairKeys = await scanKeys(redisClient, pattern, 100);
      
      // Use individual commands instead of pipeline (more compatible)
      for (const key of pairKeys) {
        try {
          // Extend active chat sessions to 24 hours
          await redisClient.expire(key, 86400); // 24 hours
        } catch (e) {
          // Ignore individual key errors
        }
      }
    } catch (error) {
      console.error('Session extend error:', error);
    }
  }
};

// Safe cleanup every 15 minutes + session extension every hour
setInterval(async () => {
  await cleanup.cleanInactiveData();
}, 900000); // 15 minutes

setInterval(async () => {
  await cleanup.extendActiveSessions();
}, 3600000); // 1 hour

module.exports = { cache, rateLimiter, cleanup };