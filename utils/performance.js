// Performance optimization utilities
const { redisClient } = require("../database/redisClient");

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
      // Only clean waiting queue duplicates (safe)
      const waiting = await redisClient.lRange('waiting', 0, -1);
      const unique = [...new Set(waiting)];
      
      if (waiting.length !== unique.length) {
        await redisClient.del('waiting');
        if (unique.length > 0) {
          await redisClient.lPush('waiting', ...unique);
        }
      }
      
      // Clean old rate limit keys only (safe)
      const rateLimitKeys = await redisClient.keys('rate:*');
      const pipeline = redisClient.multi();
      
      for (const key of rateLimitKeys) {
        const ttl = await redisClient.ttl(key);
        if (ttl === -1) {
          pipeline.expire(key, 3600); // 1 hour expiry for rate limits
        }
      }
      
      await pipeline.exec();
      
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  },

  // Smart session management - extend active chats
  async extendActiveSessions() {
    try {
      const pairKeys = await redisClient.keys('pair:*');
      const pipeline = redisClient.multi();
      
      for (const key of pairKeys) {
        // Extend active chat sessions to 24 hours
        pipeline.expire(key, 86400); // 24 hours
      }
      
      await pipeline.exec();
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