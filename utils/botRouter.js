/**
 * Bot Router - Cross-bot message routing
 * 
 * When users from different bots are matched together,
 * we need to send messages via the correct bot instance.
 */

const { redisClient } = require('../database/redisClient');
const User = require('../models/userModel');
const RedisOptimizer = require('./redisOptimizer');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// File cache for cross-bot transfers (prevents re-downloads)
const fileCache = new Map();
const FILE_CACHE_TTL = 300000; // 5 minutes

class BotRouter {
  /**
   * Get bots dynamically to avoid circular dependency
   */
  static getBots() {
    try {
      const { getBotById, getAllBots } = require('../bots');
      return { getBotById, getAllBots };
    } catch (e) {
      return { getBotById: () => null, getAllBots: () => [] };
    }
  }

  /**
   * Store which bot a user is currently using
   * @param {number|string} userId - Telegram user ID
   * @param {string} botId - Bot identifier (e.g., 'bot_0', 'bot_1')
   */
  static async setUserBot(userId, botId) {
    await redisClient.set(`user:bot:${userId}`, botId, { EX: 86400 }); // 24 hour expiry
    // Also update User model
    await User.update({ botId }, { where: { userId } }).catch(() => {});
  }

  /**
   * Get which bot a user is using
   * @param {number|string} userId - Telegram user ID
   * @returns {Promise<string|null>} Bot ID or null
   */
  static async getUserBot(userId) {
    // Try Redis first (fast)
    let botId = await redisClient.get(`user:bot:${userId}`).catch(() => null);
    
    // Fallback to database
    if (!botId) {
      const user = await User.findOne({ where: { userId } }).catch(() => null);
      botId = user?.botId || null;
      
      // Cache it
      if (botId) {
        await redisClient.set(`user:bot:${userId}`, botId, { EX: 86400 }).catch(() => {});
      }
    }
    
    return botId || 'bot_0'; // Default to first bot
  }

  /**
   * Get the bot instance for a user
   * @param {number|string} userId - Telegram user ID
   * @returns {Promise<object>} Telegram bot instance
   */
  static async getBotForUser(userId) {
    const botId = await BotRouter.getUserBot(userId);
    const { getBotById, getAllBots } = BotRouter.getBots();
    let bot = getBotById(botId);
    
    // Fallback to first available bot
    if (!bot) {
      const allBots = getAllBots();
      if (allBots && allBots.length > 0) {
      bot = allBots[0];
        console.log(`⚠️  Bot ${botId} not found for user ${userId}, using fallback ${bot.botId || 'first bot'}`);
    } else {
        // Last resort: try to get bot by 'default' or 'bot_0'
        bot = getBotById('default') || getBotById('bot_0');
        if (!bot) {
          throw new Error(`No bot instances available. User: ${userId}, Requested botId: ${botId}`);
        }
        console.log(`⚠️  Bot ${botId} not found for user ${userId}, using fallback ${bot.botId}`);
      }
    }
    
    if (!bot || typeof bot.sendMessage !== 'function') {
      throw new Error(`Invalid bot instance for user ${userId}. BotId: ${botId}, Bot: ${bot}`);
    }
    
    return bot;
  }

  /**
   * Send a message to a user via their bot
   * @param {number|string} userId - Recipient user ID
   * @param {string} text - Message text
   * @param {object} options - Telegram send options
   */
  static async sendMessage(userId, text, options = {}) {
    try {
      const bot = await BotRouter.getBotForUser(userId);
      return await bot.sendMessage(userId, text, options);
    } catch (error) {
      // Handle 403 Forbidden (user blocked bot)
      if (error.code === 'ETELEGRAM' && error.response?.body?.error_code === 403) {
        console.log(`User ${userId} blocked the bot - skipping message`);
        return null;
      }
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Forward media/messages between users on different bots
   * @param {number|string} fromUserId - Sender user ID
   * @param {number|string} toUserId - Recipient user ID
   * @param {object} message - Telegram message object
   * @param {object} options - Additional options (has_spoiler, protect_content, caption)
   */
  static async forwardMessage(fromUserId, toUserId, message, options = {}) {
    // ⚡ OPTIMIZATION: Parallelize bot lookups and file ID extraction
    const [senderBot, recipientBot, senderBotId, recipientBotId] = await Promise.all([
      BotRouter.getBotForUser(fromUserId),
      BotRouter.getBotForUser(toUserId),
      BotRouter.getUserBot(fromUserId),
      BotRouter.getUserBot(toUserId)
    ]);
    
    // Merge default options
    const sendOptions = {
      caption: options.caption || message.caption || '',
      has_spoiler: options.has_spoiler || false,
      protect_content: options.protect_content || false,
      parse_mode: message.caption && message.entities ? undefined : 'HTML'
    };
    
    if (senderBotId === recipientBotId) {
      // Same bot - use file_id directly (fast)
      if (message.photo) {
        const photo = message.photo[message.photo.length - 1];
        return recipientBot.sendPhoto(toUserId, photo.file_id, sendOptions);
      } else if (message.video) {
        return recipientBot.sendVideo(toUserId, message.video.file_id, sendOptions);
      } else if (message.audio) {
        return recipientBot.sendAudio(toUserId, message.audio.file_id, sendOptions);
      } else if (message.voice) {
        return recipientBot.sendVoice(toUserId, message.voice.file_id);
      } else if (message.document) {
        return recipientBot.sendDocument(toUserId, message.document.file_id, sendOptions);
      } else if (message.sticker) {
        return recipientBot.sendSticker(toUserId, message.sticker.file_id);
      } else if (message.animation) {
        return recipientBot.sendAnimation(toUserId, message.animation.file_id, sendOptions);
      } else if (message.video_note) {
        return recipientBot.sendVideoNote(toUserId, message.video_note.file_id);
      }
    } else {
      // Different bots - download as buffer and re-upload (optimized with caching)
      try {
        // Get file ID and type
        let fileId, mediaType;
        if (message.photo) {
          fileId = message.photo[message.photo.length - 1].file_id;
          mediaType = 'photo';
        } else if (message.video) {
          fileId = message.video.file_id;
          mediaType = 'video';
        } else if (message.audio) {
          fileId = message.audio.file_id;
          mediaType = 'audio';
        } else if (message.voice) {
          fileId = message.voice.file_id;
          mediaType = 'voice';
        } else if (message.document) {
          fileId = message.document.file_id;
          mediaType = 'document';
        } else if (message.sticker) {
          fileId = message.sticker.file_id;
          mediaType = 'sticker';
        } else if (message.animation) {
          fileId = message.animation.file_id;
          mediaType = 'animation';
        } else if (message.video_note) {
          fileId = message.video_note.file_id;
          mediaType = 'video_note';
        }
        
        if (!fileId) return null;
        
        // ⚡ OPTIMIZATION: Get file URL and start download immediately
        // This parallelizes the file URL fetch with any other operations
        const fileUrlPromise = senderBot.getFileLink(fileId);
        const fileUrl = await fileUrlPromise;
        
        // Download with optimized caching and timeout
        const buffer = await BotRouter.downloadFileAsBuffer(fileUrl);
        
        // Send buffer to recipient bot (non-blocking for user)
        const sendPromise = (() => {
          if (mediaType === 'photo') {
            return recipientBot.sendPhoto(toUserId, buffer, sendOptions);
          } else if (mediaType === 'video') {
            return recipientBot.sendVideo(toUserId, buffer, sendOptions);
          } else if (mediaType === 'audio') {
            return recipientBot.sendAudio(toUserId, buffer, sendOptions);
          } else if (mediaType === 'voice') {
            return recipientBot.sendVoice(toUserId, buffer);
          } else if (mediaType === 'document') {
            return recipientBot.sendDocument(toUserId, buffer, sendOptions);
          } else if (mediaType === 'sticker') {
            return recipientBot.sendSticker(toUserId, buffer);
          } else if (mediaType === 'animation') {
            return recipientBot.sendAnimation(toUserId, buffer, sendOptions);
          } else if (mediaType === 'video_note') {
            return recipientBot.sendVideoNote(toUserId, buffer);
          }
          return Promise.resolve(null);
        })();
        
        // Don't wait for admin forwarding - return immediately
        return sendPromise;
      } catch (error) {
        console.error('❌ Cross-bot transfer failed:', error.message);
        throw error;
      }
    }
    
    return null;
  }

  /**
   * Download file from URL as buffer (in-memory, faster than disk)
   * Uses caching to avoid re-downloading same files
   * Optimized with streaming and timeout
   */
  static async downloadFileAsBuffer(url) {
    // Create cache key from URL
    const cacheKey = crypto.createHash('md5').update(url).digest('hex');
    const cached = fileCache.get(cacheKey);
    
    // Return cached buffer if available and not expired
    if (cached && Date.now() - cached.time < FILE_CACHE_TTL) {
      return cached.buffer;
    }
    
    // Download file with timeout and streaming optimization
    const buffer = await new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const timeout = 10000; // 10 second timeout
      
      const request = protocol.get(url, {
        timeout,
        // Optimize for speed
        headers: {
          'Connection': 'keep-alive',
          'Accept-Encoding': 'gzip, deflate'
        }
      }, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        
        // Stream directly into buffer chunks for faster processing
        const chunks = [];
        let totalLength = 0;
        
        // Set max size limit (50MB) to prevent memory issues
        const MAX_SIZE = 50 * 1024 * 1024;
        
        response.on('data', (chunk) => {
          totalLength += chunk.length;
          if (totalLength > MAX_SIZE) {
            response.destroy();
            reject(new Error('File too large'));
            return;
          }
          chunks.push(chunk);
        });
        
        response.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
        
        response.on('error', reject);
      });
      
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Download timeout'));
      });
      
      request.on('error', reject);
    });
    
    // Cache the buffer
    fileCache.set(cacheKey, { buffer, time: Date.now() });
    
    // Cleanup old cache entries periodically
    if (fileCache.size > 100) {
      const now = Date.now();
      for (const [key, value] of fileCache.entries()) {
        if (now - value.time > FILE_CACHE_TTL) {
          fileCache.delete(key);
        }
      }
    }
    
    return buffer;
  }
}

module.exports = BotRouter;
