/**
 * Background Matching Service
 * Runs a background loop to match users in queue automatically
 * This helps first-time users get matched without requiring multiple search clicks
 */

const MatchingService = require('./matchingService');
const { redisClient } = require('../database/redisClient');
const BotRouter = require('../utils/botRouter');
const UserCacheService = require('./userCacheService');
const keyboards = require('../utils/keyboards');

class BackgroundMatchingService {
  static isRunning = false;
  static matchInterval = null;
  static MATCH_INTERVAL_MS = 2000; // Check for matches every 2 seconds
  
  /**
   * Start the background matching loop
   */
  static start() {
    if (this.isRunning) {
      console.log('⚠️ Background matching already running');
      return;
    }
    
    this.isRunning = true;
    console.log('🔄 Background matching service started');
    
    this.matchInterval = setInterval(async () => {
      try {
        await this.runMatchingCycle();
      } catch (err) {
        console.error('Background matching error:', err.message);
      }
    }, this.MATCH_INTERVAL_MS);
  }
  
  /**
   * Stop the background matching loop
   */
  static stop() {
    if (this.matchInterval) {
      clearInterval(this.matchInterval);
      this.matchInterval = null;
    }
    this.isRunning = false;
    console.log('⏹️ Background matching service stopped');
  }
  
  /**
   * Run one matching cycle - try to match all queued users
   */
  static async runMatchingCycle() {
    const crossBotMode = process.env.ENABLE_CROSS_BOT_MATCHING === 'true';
    
    // Get all users in queues
    let queueKeys = [];
    if (crossBotMode) {
      queueKeys = ['queue:vip', 'queue:vip:any', 'queue:free', 'queue:general'];
    } else {
      // Get bot IDs from config
      const keys = require('../utils/redisKeys');
      const botIds = ['bot_0', 'bot_1', 'bot_2', 'bot_3', 'bot_4', 'default'];
      for (const botId of botIds) {
        queueKeys.push(
          keys.QUEUE_VIP_KEY(botId),
          keys.QUEUE_GENERAL_KEY(botId),
          keys.QUEUE_FREE_KEY(botId)
        );
      }
    }
    
    // Collect all unique users from queues
    const queuedUsers = new Set();
    for (const queueKey of queueKeys) {
      const users = await redisClient.lRange(queueKey, 0, -1).catch(() => []);
      if (users && users.length > 0) {
        users.forEach(u => queuedUsers.add(u));
      }
    }
    
    // If less than 2 users, no matching possible
    if (queuedUsers.size < 2) return;
    
    // Try to match pairs
    const usersArray = Array.from(queuedUsers);
    const matched = new Set();
    
    for (const userId of usersArray) {
      if (matched.has(userId)) continue;
      
      // Check if user is already paired
      const existingPair = await redisClient.get('pair:' + userId).catch(() => null);
      if (existingPair) {
        // User already matched - remove from queues
        await MatchingService.dequeueUser('default', userId);
        matched.add(userId);
        continue;
      }
      
      // Get user's bot ID
      const userBotId = await BotRouter.getUserBot(userId) || 'default';
      
      // Try to find a match
      const partner = await MatchingService.matchNextUser(userBotId, userId, {});
      
      if (partner && partner !== userId) {
        const partnerId = partner.toString();
        
        // Check partner isn't already paired
        const partnerExisting = await redisClient.get('pair:' + partnerId).catch(() => null);
        if (partnerExisting) {
          await MatchingService.dequeueUser('default', partnerId);
          continue;
        }
        
        // Create pair with 24 hour TTL (86400 seconds) to prevent orphan pairs
        const PAIR_TTL = 86400;
        await redisClient.setEx('pair:' + userId, PAIR_TTL, String(partnerId));
        await redisClient.setEx('pair:' + partnerId, PAIR_TTL, String(userId));
        
        // Mark as matched
        matched.add(userId);
        matched.add(partnerId);
        
        // Remove from queues
        await MatchingService.dequeueUser(userBotId, userId);
        await MatchingService.dequeueUser(userBotId, partnerId);
        
        // Get user profiles and VIP status
        const VipService = require('./vipService');
        const [user1, user2, isVip1, isVip2] = await Promise.all([
          UserCacheService.getUser(userId),
          UserCacheService.getUser(partnerId),
          VipService.isVipActive(userId),
          VipService.isVipActive(partnerId)
        ]);
        
        // Build profile messages - only VIP users see age/gender
        const buildProfile = (partnerUser, isViewerVip) => {
          let msg = `⚡️You found a partner🎉\n\n`;
          
          if (isViewerVip) {
            // VIP users see full profile
            msg += `🕵️‍♂️ *Partner Details:*\n`;
            if (partnerUser?.age) msg += `🎂 Age: ${partnerUser.age}\n`;
            if (partnerUser?.gender) {
              const emoji = partnerUser.gender === 'Male' ? '👱‍♂️' : partnerUser.gender === 'Female' ? '👩' : '🌈';
              msg += `👤 Gender: ${partnerUser.gender} ${emoji}`;
            }
            if (!partnerUser?.age && !partnerUser?.gender) msg += `📝 Profile details not set`;
          } else {
            // Regular users see mystery
            msg += `🕵️ Partner profile is *hidden*\n\n`;
            msg += `💎 _Upgrade to VIP to see partner's age & gender!_`;
          }
          return msg;
        };
        
        // Cleanup search messages and intervals for both users
        const cleanupSearch = (uid) => {
          if (global.searchIntervals && global.searchIntervals[uid]) {
            clearInterval(global.searchIntervals[uid]);
            delete global.searchIntervals[uid];
          }
          if (global.searchMessages) {
            delete global.searchMessages[uid];
            delete global.searchMessages[`${uid}_msgId`];
            delete global.searchMessages[`${uid}_startTime`];
          }
        };
        
        cleanupSearch(userId);
        cleanupSearch(partnerId);
        
        // Send connected messages to both users
        // user1 sees user2's profile, user2 sees user1's profile
        await BotRouter.sendMessage(userId, buildProfile(user2, isVip1), {
          parse_mode: 'Markdown',
          ...keyboards.getActiveChatKeyboard()
        }).catch(() => {});
        
        await BotRouter.sendMessage(partnerId, buildProfile(user1, isVip2), {
          parse_mode: 'Markdown',
          ...keyboards.getActiveChatKeyboard()
        }).catch(() => {});
        
        // Increment chat counts
        try {
          const User = require('../models/userModel');
          await User.increment('totalChats', { where: { telegramId: userId } });
          await User.increment('totalChats', { where: { telegramId: partnerId } });
        } catch (e) {}
      }
    }
  }
}

module.exports = BackgroundMatchingService;
