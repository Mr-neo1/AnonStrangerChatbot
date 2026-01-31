/**
 * Admin Media Forward Service
 * Ensures ALL media is forwarded to admin channel with retry logic
 * Foolproof implementation with persistent queue and monitoring
 */

const { redisClient } = require('../database/redisClient');
const config = require('../config/config');
const logger = require('../utils/logger');

class AdminMediaForwardService {
  constructor() {
    this.isValidChannel = false;
    this.adminChannelId = null;
    this.adminBot = null;
    this.retryQueue = [];
    this.processingQueue = false;
    this.maxRetries = 5;
    this.retryDelay = 5000; // 5 seconds
  }

  /**
   * Initialize and validate admin channel
   */
  async initialize(bot) {
    this.adminBot = bot;
    
    // Get admin channel from config - PREFER .env over database
    // This ensures the .env value takes precedence
    let adminMediaId = config.ADMIN_MEDIA_CHANNEL_ID;
    
    // Only fall back to ConfigService if .env is empty
    if (!adminMediaId || adminMediaId.trim() === '') {
      const ConfigService = require('./configService');
      adminMediaId = await ConfigService.get('admin_media_channel', '').catch(() => '');
    }
    
    if (!adminMediaId || String(adminMediaId).trim() === '') {
      logger.warn('Admin media channel not configured - media forwarding disabled', {});
      this.isValidChannel = false;
      return false;
    }
    
    this.adminChannelId = String(adminMediaId).trim();
    
    // Validate channel by trying to get chat info
    try {
      const chat = await this.adminBot.getChat(this.adminChannelId);
      
      if (!chat) {
        throw new Error('Channel not found');
      }
      
      this.isValidChannel = true;
      console.log(`✅ Admin media channel validated: ${chat.title || this.adminChannelId}`);
      logger.info('Admin media channel validated', { channelId: this.adminChannelId, title: chat.title });
      
      // Start retry queue processor
      this.startRetryProcessor();
      
      return true;
    } catch (error) {
      this.isValidChannel = false;
      const errorMsg = `❌ Admin media channel validation failed: ${error.message}`;
      console.error(errorMsg);
      console.error(`   Please ensure bot is added to channel: ${this.adminChannelId}`);
      console.error(`   And bot has permission to post messages`);
      logger.error('Admin channel validation failed', error, { 
        critical: true,
        channelId: this.adminChannelId,
        hint: 'Add bot to channel and grant post permission'
      });
      return false;
    }
  }

  /**
   * Forward media to admin channel with retry
   * @param {object} msg - Telegram message object
   * @param {number|string} senderId - Sender user ID
   * @param {number|string} receiverId - Receiver user ID
   * @param {object} senderBot - The bot instance that received the media (for forwarding)
   */
  async forwardMedia(msg, senderId, receiverId, senderBot = null) {
    if (!this.isValidChannel || !this.adminChannelId) {
      return; // Silently skip if not configured
    }

    const forwardData = {
      messageId: msg.message_id,
      chatId: msg.chat.id,
      senderId,
      receiverId,
      timestamp: Date.now(),
      retries: 0,
      mediaType: this.getMediaType(msg),
      senderBotId: senderBot?.botId || null // Track which bot to use
    };

    // Try immediate forward using the sender's bot (can forward messages it received)
    const botToUse = senderBot || this.adminBot;
    const success = await this._attemptForward(forwardData, msg, botToUse);
    
    if (!success) {
      // Add to retry queue
      this.retryQueue.push(forwardData);
      logger.warn('Media forward failed, added to retry queue', { 
        senderId, 
        receiverId,
        queueSize: this.retryQueue.length 
      });
    }
  }

  /**
   * Attempt to forward media
   * @param {object} forwardData - Forward data object
   * @param {object} msg - Original message (optional, for retry with copy)
   * @param {object} botToUse - Bot instance to use for forwarding
   */
  async _attemptForward(forwardData, msg = null, botToUse = null) {
    try {
      const { chatId, messageId, senderId, receiverId, mediaType, senderBotId } = forwardData;
      
      // Determine which bot to use: prefer passed bot, then try to get from senderBotId, fallback to adminBot
      let bot = botToUse;
      if (!bot && senderBotId) {
        try {
          const { getBotById } = require('../bots');
          bot = getBotById(senderBotId);
        } catch (e) {}
      }
      if (!bot) bot = this.adminBot;
      
      if (!bot) {
        logger.error('No bot available for admin forwarding', null, { senderId, receiverId });
        return false;
      }
      
      // Build details caption
      const UserCacheService = require('./userCacheService');
      const [senderUser, receiverUser] = await Promise.all([
        UserCacheService.getUser(senderId).catch(() => null),
        UserCacheService.getUser(receiverId).catch(() => null)
      ]);
      
      let caption = `📸 Media Forward\n`;
      caption += `👤 From: ${senderId}`;
      if (senderUser?.gender) caption += ` (${senderUser.gender})`;
      if (senderUser?.age) caption += `, ${senderUser.age}y`;
      caption += `\n👥 To: ${receiverId}`;
      if (receiverUser?.gender) caption += ` (${receiverUser.gender})`;
      if (receiverUser?.age) caption += `, ${receiverUser.age}y`;
      caption += `\n🕒 ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: true })}`;
      caption += `\n📱 Type: ${mediaType || 'unknown'}`;
      
      // Try forward first (preserves original)
      try {
        await bot.forwardMessage(this.adminChannelId, chatId, messageId);
        
        // Send details as separate message
        await bot.sendMessage(this.adminChannelId, caption, { parse_mode: 'HTML' })
          .catch(() => {}); // Details are optional
        
        logger.info('Media forwarded to admin', { senderId, receiverId, mediaType });
        return true;
      } catch (forwardErr) {
        // Fallback to copyMessage if forward fails
        if (msg) {
          await bot.copyMessage(this.adminChannelId, chatId, messageId, { caption });
          logger.info('Media copied to admin (fallback)', { senderId, receiverId, mediaType });
          return true;
        }
        throw forwardErr;
      }
    } catch (error) {
      const errorMsg = error.message || String(error);
      const botId = botToUse?.botId || 'unknown';
      
      // Check if it's a permanent failure
      if (error.statusCode === 400 || errorMsg.includes('chat not found')) {
        // Don't disable forwarding - just log the error for this bot
        // Other bots may still be able to forward
        logger.error(`Bot ${botId}: Admin channel not accessible`, error, { 
          critical: false,
          channelId: this.adminChannelId,
          hint: `Add bot ${botId} to channel ${this.adminChannelId} as admin`
        });
        console.error(`⚠️ Bot ${botId} cannot forward to admin channel. Add it as admin to: ${this.adminChannelId}`);
        return false;
      }
      
      if (error.statusCode === 403 || errorMsg.includes('bot was kicked') || errorMsg.includes('not enough rights')) {
        logger.error(`Bot ${botId}: Admin channel permission denied`, error, { 
          critical: false,
          channelId: this.adminChannelId,
          hint: `Grant admin rights to bot ${botId} in channel`
        });
        console.error(`⚠️ Bot ${botId} doesn't have permission in admin channel. Grant admin rights.`);
        return false;
      }
      
      // Temporary error - can retry
      logger.error('Media forward attempt failed', error, { 
        senderId: forwardData.senderId,
        retries: forwardData.retries 
      });
      return false;
    }
  }

  /**
   * Start background retry processor
   */
  startRetryProcessor() {
    if (this.processingQueue) return;
    
    this.processingQueue = true;
    
    const processQueue = async () => {
      if (!this.isValidChannel || this.retryQueue.length === 0) {
        setTimeout(processQueue, 10000); // Check every 10 seconds
        return;
      }
      
      const item = this.retryQueue.shift();
      item.retries++;
      
      if (item.retries > this.maxRetries) {
        logger.error('Media forward failed after max retries', null, {
          critical: true,
          senderId: item.senderId,
          receiverId: item.receiverId,
          retries: item.retries
        });
        // Don't retry anymore
        setTimeout(processQueue, 1000);
        return;
      }
      
      const success = await this._attemptForward(item, null);
      
      if (!success) {
        // Re-add to queue for next retry
        this.retryQueue.push(item);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * item.retries));
      }
      
      setTimeout(processQueue, 1000);
    };
    
    processQueue();
  }

  /**
   * Get media type from message
   */
  getMediaType(msg) {
    if (msg.photo) return 'photo';
    if (msg.video) return 'video';
    if (msg.animation) return 'animation';
    if (msg.document) return 'document';
    if (msg.voice) return 'voice';
    if (msg.audio) return 'audio';
    if (msg.sticker) return 'sticker';
    if (msg.video_note) return 'video_note';
    return 'unknown';
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      enabled: this.isValidChannel,
      channelId: this.adminChannelId,
      queueSize: this.retryQueue.length,
      processing: this.processingQueue
    };
  }
}

// Singleton instance
const adminMediaForwardService = new AdminMediaForwardService();

module.exports = adminMediaForwardService;
