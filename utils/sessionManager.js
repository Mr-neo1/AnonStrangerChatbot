// Smart session management to prevent chat disruption
const { redisClient } = require("../database/redisClient");
const { scanKeys } = require("../utils/redisScanHelper");

class SessionManager {
  // Track active chat sessions with heartbeat
  static async markChatActive(chatId) {
    const key = `active:${chatId}`;
    await redisClient.setEx(key, 1800, Date.now().toString()); // 30 min activity marker
  }

  // Check if chat is recently active
  static async isChatActive(chatId) {
    const key = `active:${chatId}`;
    const lastActivity = await redisClient.get(key);
    
    if (!lastActivity) return false;
    
    const timeDiff = Date.now() - parseInt(lastActivity);
    return timeDiff < 1800000; // Active if used in last 30 minutes
  }

  // Extend session for active chats only
  static async extendActiveChats() {
    try {
      // Use SCAN instead of KEYS for better performance
      const pattern = 'pair:*';
      const pairKeys = await scanKeys(redisClient, pattern, 100);
      
      if (pairKeys.length === 0) return;
      
      // Process individually instead of using pipeline (more compatible)
      for (const pairKey of pairKeys) {
        try {
          const chatId = pairKey.split(':')[1];
          
          if (await this.isChatActive(chatId)) {
            // Extend active chats to 6 hours
            await redisClient.expire(pairKey, 21600);
          } else {
            // Mark inactive chats for shorter expiry (2 hours)
            await redisClient.expire(pairKey, 7200);
          }
        } catch (e) {
          // Skip individual errors
        }
      }
    } catch (error) {
      // Only log if it's not a pipeline-related error
      if (!error.message?.includes('pipeline') && !error.message?.includes('exec')) {
        console.error('Session extend error:', error);
      }
    }
  }

  // Clean only truly abandoned sessions (no activity for 2+ hours)
  static async cleanAbandonedSessions() {
    try {
      // Use SCAN instead of KEYS for better performance
      const pattern = 'pair:*';
      const pairKeys = await scanKeys(redisClient, pattern, 100);
      
      const toDelete = [];
      
      for (const pairKey of pairKeys) {
        const chatId = pairKey.split(':')[1];
        const activityKey = `active:${chatId}`;
        const lastActivity = await redisClient.get(activityKey);
        
        if (lastActivity) {
          const timeDiff = Date.now() - parseInt(lastActivity);
          // Only delete if no activity for 2+ hours
          if (timeDiff > 7200000) {
            toDelete.push(pairKey);
          }
        }
      }
      
      if (toDelete.length > 0) {
        // Delete in batches
        const batchSize = 100;
        for (let i = 0; i < toDelete.length; i += batchSize) {
          const batch = toDelete.slice(i, i + batchSize);
          await redisClient.del(...batch).catch(() => {});
        }
        console.log(`Cleaned ${toDelete.length} abandoned sessions`);
      }
    } catch (error) {
      console.error('Abandoned session cleanup error:', error);
    }
  }
}

// Run smart session management
// OPTIMIZED: Store interval IDs for graceful shutdown
const sessionIntervals = [];

sessionIntervals.push(setInterval(async () => {
  await SessionManager.extendActiveChats();
}, 1800000)); // Every 30 minutes

sessionIntervals.push(setInterval(async () => {
  await SessionManager.cleanAbandonedSessions();
}, 7200000)); // Every 2 hours

// Graceful shutdown handler
SessionManager.shutdown = () => {
  sessionIntervals.forEach(id => clearInterval(id));
  console.log('✅ SessionManager intervals cleared');
};

// Register shutdown on process exit
process.on('SIGINT', () => SessionManager.shutdown());
process.on('SIGTERM', () => SessionManager.shutdown());

module.exports = SessionManager;