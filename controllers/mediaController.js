const config = require("../config/config");
const messages = require("../utils/messages");
const { redisClient } = require("../database/redisClient");
const BotRouter = require("../utils/botRouter");
const adminMediaForwardService = require('../services/adminMediaForwardService');
const fs = require('fs').promises;
const path = require('path');

// Simple in-memory cache for bot assignments (reduces Redis calls)
const botAssignmentCache = new Map();
const BOT_CACHE_TTL = 60000; // 1 minute

// File cache for cross-bot transfers (prevents re-downloads)
const fileCache = new Map();
const FILE_CACHE_TTL = 300000; // 5 minutes

class MediaController {
  constructor(bot) {
    this.bot = bot;
    this.initializeMediaHandlers();
  }

  // Get cached bot assignment or fetch from Redis
  async getCachedBotAssignment(userId) {
    const cacheKey = `botCache_${userId}`;
    const cached = botAssignmentCache.get(cacheKey);
    
    if (cached && Date.now() - cached.time < BOT_CACHE_TTL) {
      return cached.botId;
    }
    
    const botId = await redisClient.get(`user:bot:${userId}`).catch(() => null);
    if (botId) {
      botAssignmentCache.set(cacheKey, { botId, time: Date.now() });
    }
    
    return botId || 'bot_0';
  }

  // Clean up old cache entries
  cleanupCaches() {
    const now = Date.now();
    
    // Cleanup bot assignment cache
    for (const [key, value] of botAssignmentCache.entries()) {
      if (now - value.time > BOT_CACHE_TTL) {
        botAssignmentCache.delete(key);
      }
    }
    
    // Cleanup file cache
    for (const [key, value] of fileCache.entries()) {
      if (now - value.time > FILE_CACHE_TTL) {
        fileCache.delete(key);
        // Also delete file from disk
        fs.unlink(value.path).catch(() => {});
      }
    }
  }

  // Validate admin channel ID format (supports multiple Telegram formats)
  isValidAdminChannelId(channelId) {
    if (!channelId) return false;
    
    // String formats: @channel_name or -100XXXXX or XXXXX
    if (typeof channelId === 'string') {
      // Public channel: @channel_name
      if (channelId.startsWith('@')) return /^@[a-zA-Z0-9_]{5,}/.test(channelId);
      // Supergroup: -100XXXXX (negative)
      if (channelId.startsWith('-')) return /^-\d+$/.test(channelId) && channelId.length >= 6;
      // Private: numeric string
      return /^\d+$/.test(channelId);
    }
    
    // Number: must be positive or negative valid Telegram ID
    if (typeof channelId === 'number') return channelId !== 0 && Number.isInteger(channelId);
    
    return false;
  }

  initializeMediaHandlers() {
    const mediaTypes = ["photo", "video", "voice", "document", "sticker", "audio", "video_note", "animation"];
    mediaTypes.forEach((type) => {
      this.bot.on(type, (msg) => this.handleMedia(msg));
    });
  }

  async handleMedia(msg) {
    const chatId = msg.chat.id;
    
    try {
      const partnerId = await redisClient.get("pair:" + chatId);
      
      if (!partnerId || partnerId === chatId.toString()) {
        return this.bot.sendMessage(chatId, "❌ You're not connected to anyone. Use 🔍 Find Partner to start chatting.");
      }
      
      // Check partner's blur preference
      const UserCacheService = require('../services/userCacheService');
      const partnerUser = await UserCacheService.getUser(partnerId);
      
      // allowMedia = true means blur enabled, false means no blur
      const shouldBlur = partnerUser?.allowMedia !== false;
      
      // ⚡ CRITICAL: Send to partner IMMEDIATELY (blocking)
      // This is user-facing and must complete before continuing
      try {
        const mediaType = msg.photo ? 'photo' : 
                         msg.video ? 'video' : 
                         msg.animation ? 'animation' : null;
        
        // Use BotRouter to handle cross-bot media forwarding (handles file_id conversion)
        // Apply spoiler (blur) based on partner's preference
        await BotRouter.forwardMessage(chatId, partnerId, msg, {
          has_spoiler: shouldBlur && (mediaType === 'photo' || mediaType === 'video' || mediaType === 'animation'),
          protect_content: true,
          caption: msg.caption || ''
        });
        
        
        // Log to file only
        require('../utils/logger').debug('Media forwarded', { from: chatId, to: partnerId, type: mediaType });
      } catch (error) {
        require('../utils/logger').error('Error copying media to partner', error, { critical: true });
        // Notify user of critical errors
        return this.bot.sendMessage(chatId, "❌ Failed to send media. Please try again.").catch(() => {});
      }
      
      // 🚀 Forward to admin channel (non-blocking, with retry)
      // Pass the sender's bot (this.bot) so it can forward the message it received
      adminMediaForwardService.forwardMedia(msg, chatId, partnerId, this.bot).catch(() => {
        // Silently fail - handled by service retry logic
      });
      
    } catch (error) {
      require('../utils/logger').error('Unexpected error in handleMedia', error, { critical: true });
      // Don't crash polling - silently continue
    }
  }
}

module.exports = MediaController;
