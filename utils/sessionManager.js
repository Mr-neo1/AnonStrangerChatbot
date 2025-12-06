// Smart session management to prevent chat disruption
const { redisClient } = require("../database/redisClient");

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
      const pairKeys = await redisClient.keys('pair:*');
      const pipeline = redisClient.multi();
      
      for (const pairKey of pairKeys) {
        const chatId = pairKey.split(':')[1];
        
        if (await this.isChatActive(chatId)) {
          // Extend active chats to 6 hours
          pipeline.expire(pairKey, 21600);
        } else {
          // Mark inactive chats for shorter expiry (2 hours)
          pipeline.expire(pairKey, 7200);
        }
      }
      
      await pipeline.exec();
    } catch (error) {
      console.error('Session extend error:', error);
    }
  }

  // Clean only truly abandoned sessions (no activity for 2+ hours)
  static async cleanAbandonedSessions() {
    try {
      const pairKeys = await redisClient.keys('pair:*');
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
        await redisClient.del(...toDelete);
        console.log(`Cleaned ${toDelete.length} abandoned sessions`);
      }
    } catch (error) {
      console.error('Abandoned session cleanup error:', error);
    }
  }
}

// Run smart session management
setInterval(async () => {
  await SessionManager.extendActiveChats();
}, 1800000); // Every 30 minutes

setInterval(async () => {
  await SessionManager.cleanAbandonedSessions();
}, 7200000); // Every 2 hours

module.exports = SessionManager;