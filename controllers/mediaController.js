const config = require("../config/config");
const messages = require("../utils/messages");
const { redisClient } = require("../database/redisClient");
const BotRouter = require("../utils/botRouter");
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
    this.badAdminChannels = new Set(); // Cache invalid channels to prevent repeated errors
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
      
      // ⚡ CRITICAL: Send to partner IMMEDIATELY (blocking)
      // This is user-facing and must complete before continuing
      try {
        const mediaType = msg.photo ? 'photo' : 
                         msg.video ? 'video' : 
                         msg.animation ? 'animation' : null;
        
        // Use BotRouter to handle cross-bot media forwarding (handles file_id conversion)
        await BotRouter.forwardMessage(chatId, partnerId, msg, {
          has_spoiler: mediaType === 'photo' || mediaType === 'video' || mediaType === 'animation',
          protect_content: true,
          caption: msg.caption || ''
        });
        
        // Send privacy warning for sensitive media (fire and forget)
        if (mediaType === 'photo' || mediaType === 'video' || mediaType === 'animation') {
          const partnerBot = await BotRouter.getBotForUser(partnerId);
          partnerBot.sendMessage(partnerId, '⚠️ *Privacy Notice*\n\nScreenshots cannot be fully prevented on Telegram. Please respect privacy.', {
            parse_mode: 'Markdown'
          }).catch(() => {});
        }
        
        console.log(`✅ Media forwarded from ${chatId} to ${partnerId} (type: ${mediaType || 'other'})`);
      } catch (error) {
        console.error("❌ Error copying media to partner:", error.message);
        // Notify user of critical errors
        return this.bot.sendMessage(chatId, "❌ Failed to send media. Please try again.").catch(() => {});
      }
      
      // 🚀 NON-BLOCKING: Forward to admin channel in background (never block user experience)
      // This runs asynchronously and won't delay the above operations
      this.forwardToAdminChannelAsync(msg, chatId, partnerId).catch(err => {
        console.error("Background admin forwarding error:", err.message);
      });
      
    } catch (error) {
      console.error('CRITICAL: Unexpected error in handleMedia:', error);
      // Don't crash polling - silently continue
    }
  }

  // Async admin forwarding that doesn't block user experience
  async forwardToAdminChannelAsync(msg, chatId, partnerId) {
    const adminMediaId = config.ADMIN_MEDIA_CHANNEL_ID;
    
    if (!adminMediaId) {
      return; // Silently skip if not configured
    }
    
    // Check if this channel was already marked as bad
    if (this.badAdminChannels.has(String(adminMediaId))) {
      return; // Skip bad channels
    }
    
    // Validate format
    if (!this.isValidAdminChannelId(adminMediaId)) {
      console.warn(`ADMIN_MEDIA_CHANNEL_ID has invalid format: ${adminMediaId}`);
      this.badAdminChannels.add(String(adminMediaId));
      return;
    }

    try {
      const userIdMeta = (msg.from && msg.from.id) ? msg.from.id : 'unknown';
      let detailsText = '';
      
      try {
        const User = require('../models/userModel');
        const [senderUser, receiverUser] = await Promise.all([
          User.findOne({ where: { userId: userIdMeta }, attributes: ['userId', 'gender', 'name', 'username'] }).catch(() => null),
          User.findOne({ where: { userId: partnerId }, attributes: ['userId', 'gender', 'name', 'username'] }).catch(() => null)
        ]);
        
        // Build details text
        if (senderUser) {
          const forwardFromName = senderUser.name || senderUser.username || `User ${userIdMeta}`;
          detailsText = `👤 ${forwardFromName}`;
          if (senderUser.gender) detailsText += ` (${senderUser.gender})`;
          detailsText += `\n📱 ID: ${userIdMeta}`;
        } else {
          detailsText = `📱 Sender ID: ${userIdMeta}`;
        }
        
        if (receiverUser) {
          const receiverName = receiverUser.name || receiverUser.username || `User ${partnerId}`;
          detailsText += `\n👥 To: ${receiverName}`;
          if (receiverUser.gender) detailsText += ` (${receiverUser.gender})`;
          detailsText += `\n📱 ID: ${partnerId}`;
        } else {
          detailsText += `\n📱 Receiver ID: ${partnerId}`;
        }
        
        detailsText += `\n🕒 ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: true })}`;
      } catch (e) {
        detailsText = `📱 ${userIdMeta} → ${partnerId}\n🕒 ${new Date().toISOString()}`;
      }
      
      // Forward message with caption
      await this.bot.forwardMessage(adminMediaId, chatId, msg.message_id).catch(async () => {
        // Fallback to copyMessage if forward fails
        await this.bot.copyMessage(adminMediaId, chatId, msg.message_id, { 
          caption: detailsText 
        });
      });
      
      // Send details in separate message
      await this.bot.sendMessage(adminMediaId, detailsText, { parse_mode: 'HTML' }).catch(() => {});
      
    } catch (err) {
      const errorMsg = String(err.message || err);
      
      if (err.statusCode === 400 || errorMsg.includes('chat not found') || errorMsg.includes('channel not found')) {
        console.error(`❌ Admin channel not found: ${adminMediaId}`);
        this.badAdminChannels.add(String(adminMediaId));
      } else if (err.statusCode === 403) {
        console.error(`❌ Bot lacks permission for admin channel: ${adminMediaId}`);
        this.badAdminChannels.add(String(adminMediaId));
      }
      // Silently fail - never crash polling
    }
  }
}

module.exports = MediaController;
