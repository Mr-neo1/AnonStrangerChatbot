const { redisClient } = require("../database/redisClient");
const config = require("../config/config");
const logger = require("../utils/logger");

class AdminAlertService {
  // Cache of bad admin channels to avoid repeated failed attempts
  static badAdminChannels = new Set();

  // Validate admin channel ID format (similar to mediaController pattern)
  static isValidAdminChannelId(channelId) {
    if (!channelId) return false;
    const idStr = String(channelId).trim();
    // Support formats: @channel_name, -100XXXXX (with/without negative), numeric
    if (idStr.startsWith('@')) return true; // @channel format
    if (idStr.startsWith('-100')) return /^-100\d+$/.test(idStr); // Telegram private channel format
    return /^\d+$/.test(idStr); // Numeric format
  }

  static async notify(payload) {
    if (!payload) return;
    try {
      const { type, botId, offenderId, userId, chatId, ownerId, count, duringLock, timestamp } = payload;
      const adminChatId = config.ADMIN_ALERT_CHAT_ID || config.ADMIN_CONTROL_CHAT_ID || config.ADMIN_CHAT_ID;
      
      if (!adminChatId) {
        try { logger.appendJsonLog("admin-alert.log", { action: "SKIPPED", reason: "no_admin_chat_configured", payload }); } catch (e) {}
        return;
      }

      // Check if this channel was previously marked as bad (permanent failure)
      if (this.badAdminChannels.has(adminChatId)) {
        try { logger.appendJsonLog("admin-alert.log", { action: "SKIPPED", reason: "channel_permanently_failed", chatId: adminChatId, payload }); } catch (e) {}
        return;
      }

      // Validate channel ID format
      if (!this.isValidAdminChannelId(adminChatId)) {
        this.badAdminChannels.add(adminChatId);
        try { logger.appendJsonLog("admin-alert.log", { action: "FAILED", reason: "invalid_channel_format", chatId: adminChatId, payload }); } catch (e) {}
        return;
      }

      let bot;
      try {
        const bots = require("../bots");
        bot = bots.getBotById(botId);
        if (!bot) {
          try { logger.appendJsonLog("admin-alert.log", { action: "SKIPPED", reason: "bot_not_found", botId, payload }); } catch (e) {}
          return;
        }
      } catch (err) {
        try { logger.appendJsonLog("admin-alert.log", { action: "FAILED", reason: "bot_resolution_error", botId, err: err.message, payload }); } catch (e) {}
        return;
      }

      const offenderKey = (offenderId || userId);
      const rateLimitKey = "admin:alert:sent:" + type + ":" + offenderKey;
      
      try {
        const rateLimited = await redisClient.get(rateLimitKey);
        if (rateLimited) {
          try { logger.appendJsonLog("admin-alert.log", { action: "SKIPPED", reason: "rate_limited", rateLimitKey, payload }); } catch (e) {}
          return;
        }
      } catch (err) {
        try { logger.appendJsonLog("admin-alert.log", { action: "FAILED", reason: "rate_limit_check_error", rateLimitKey, err: err.message, payload }); } catch (e) {}
      }

      let message = "";
      if (type === "LOCK_ABUSE") {
        message = "🔒 LOCK ABUSE ALERT\n\nBot: " + botId + "\nChat ID: " + chatId + "\nLock Owner: " + ownerId + "\nOffender: " + offenderId + "\nAttempts: " + count + "\nTime: " + timestamp;
      } else if (type === "DISCONNECT_ABUSE") {
        message = "⚠️ DISCONNECT ABUSE ALERT\n\nBot: " + botId + "\nChat ID: " + chatId + "\nUser: " + userId + "\nAttempts: " + count + "\nDuring Lock: " + (duringLock ? "YES" : "NO") + "\nTime: " + timestamp;
      } else {
        try { logger.appendJsonLog("admin-alert.log", { action: "SKIPPED", reason: "unknown_alert_type", type, payload }); } catch (e) {}
        return;
      }

      // Send message with error type detection (similar to mediaController pattern)
      try {
        await bot.sendMessage(adminChatId, message);
        try { await redisClient.setEx(rateLimitKey, 600, "1"); } catch (e) {}
        try { logger.appendJsonLog("admin-alert.log", { action: "SENT", type, offenderId: offenderKey, chatId: adminChatId }); } catch (e) {}
      } catch (sendErr) {
        // Determine error type: permanent vs temporary
        const errorMessage = String(sendErr?.message || '');
        const errorCode = sendErr?.response?.statusCode || sendErr?.statusCode;
        
        // PERMANENT errors: channel doesn't exist, access denied, invalid format
        if (errorCode === 400 || errorCode === 403 || errorMessage.includes('chat not found') || errorMessage.includes('CHAT_FORWARDS_RESTRICTED')) {
          this.badAdminChannels.add(adminChatId);
          try { logger.appendJsonLog("admin-alert.log", { 
            action: "FAILED", 
            reason: "PERMANENT_CHANNEL_ERROR", 
            chatId: adminChatId, 
            errorCode, 
            errorMessage 
          }); } catch (e) {}
        } else {
          // TEMPORARY errors: network issues, rate limit, etc.
          try { logger.appendJsonLog("admin-alert.log", { 
            action: "FAILED", 
            reason: "TEMPORARY_SEND_ERROR", 
            chatId: adminChatId, 
            errorCode, 
            errorMessage 
          }); } catch (e) {}
        }
      }
    } catch (err) {
      try { logger.appendJsonLog("admin-alert.log", { action: "FAILED", reason: "unexpected_error", err: err.message, payload }); } catch (e) {}
    }
  }
}

module.exports = AdminAlertService;
