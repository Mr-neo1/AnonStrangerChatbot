/**
 * Spam Detection Service
 * Detects and handles spam including Telegram channel/group promotions
 */

const { redisClient } = require('../database/redisClient');
const BanModel = require('../models/banModel');
const User = require('../models/userModel');
const config = require('../config/config');

// Spam patterns to detect
const SPAM_PATTERNS = {
  // Telegram links (t.me/username, telegram.me/username)
  telegramLinks: /(?:t\.me|telegram\.me)\/[\w_]+/gi,
  
  // Telegram deep links (tg://user?id=, tg://resolve?domain=)
  telegramDeepLinks: /tg:\/\/(?:user\?id=|resolve\?domain=)[\w_]+/gi,
  
  // ANY @ mentions (block all channel/user mentions - must use /link to share)
  atMentions: /@[\w_]{3,}/gi,
  
  // Common spam phrases
  spamPhrases: /(?:join\s+(?:my|our|this)\s+(?:channel|group)|subscribe\s+to|check\s+out\s+@|follow\s+@|link\s+in\s+bio)/gi,
  
  // Crypto/financial spam
  cryptoSpam: /(?:earn\s+\$?\d+|free\s+(?:crypto|bitcoin|money)|investment\s+opportunity|dm\s+(?:me|for)\s+(?:details|more))/gi
};

// Whitelist patterns (allowed links)
const WHITELIST_PATTERNS = [];

class SpamDetectionService {
  /**
   * Check if a message contains spam
   * @param {string} text - Message text to check
   * @param {object} options - Options like allowedChannels
   * @returns {object} { isSpam: boolean, reason: string, matches: string[] }
   */
  static checkMessage(text, options = {}) {
    if (!text || typeof text !== 'string') {
      return { isSpam: false, reason: null, matches: [] };
    }

    const allowedChannels = options.allowedChannels || [];
    const matches = [];
    let reason = null;

    // Check for Telegram links
    const telegramLinks = text.match(SPAM_PATTERNS.telegramLinks) || [];
    for (const link of telegramLinks) {
      // Check if it's an allowed channel (like required join channel)
      const username = link.replace(/^(?:t\.me|telegram\.me)\//, '').toLowerCase();
      if (!allowedChannels.some(ch => ch.toLowerCase().replace('@', '') === username)) {
        matches.push(link);
        reason = 'telegram_link';
      }
    }

    // Check for Telegram deep links
    const deepLinks = text.match(SPAM_PATTERNS.telegramDeepLinks) || [];
    if (deepLinks.length > 0) {
      matches.push(...deepLinks);
      reason = reason || 'telegram_deeplink';
    }

    // Check for @ mentions (block ALL @username mentions)
    const atMentions = text.match(SPAM_PATTERNS.atMentions) || [];
    for (const mention of atMentions) {
      const username = mention.replace('@', '').toLowerCase();
      // Allow mentioning the required channel only
      if (!allowedChannels.some(ch => ch.toLowerCase().replace('@', '') === username)) {
        matches.push(mention);
        reason = reason || 'username_mention';
      }
    }

    // Check for spam phrases
    const spamPhrases = text.match(SPAM_PATTERNS.spamPhrases) || [];
    if (spamPhrases.length > 0) {
      matches.push(...spamPhrases);
      reason = reason || 'spam_phrase';
    }

    // Check for crypto spam
    const cryptoSpam = text.match(SPAM_PATTERNS.cryptoSpam) || [];
    if (cryptoSpam.length > 0) {
      matches.push(...cryptoSpam);
      reason = reason || 'crypto_spam';
    }

    return {
      isSpam: matches.length > 0,
      reason,
      matches
    };
  }

  /**
   * Get user's spam warning count
   * @param {number|string} userId 
   * @returns {Promise<number>}
   */
  static async getWarningCount(userId) {
    try {
      const count = await redisClient.get(`spam:warnings:${userId}`);
      return parseInt(count) || 0;
    } catch (err) {
      return 0;
    }
  }

  /**
   * Increment user's spam warning count
   * @param {number|string} userId 
   * @returns {Promise<number>} New warning count
   */
  static async incrementWarning(userId) {
    try {
      const key = `spam:warnings:${userId}`;
      const count = await redisClient.incr(key);
      // Warnings expire after 30 days
      await redisClient.expire(key, 30 * 24 * 60 * 60);
      return count;
    } catch (err) {
      return 1;
    }
  }

  /**
   * Handle spam detection result - warn or ban user
   * @param {number|string} userId 
   * @param {object} spamResult - Result from checkMessage
   * @returns {Promise<object>} { action: 'warn'|'temp_ban', message: string }
   */
  static async handleSpam(userId, spamResult) {
    if (!spamResult.isSpam) {
      return { action: 'none', message: null };
    }

    const warningCount = await this.incrementWarning(userId);

    // Progressive punishment - escalating temp bans
    if (warningCount >= 2) {
      // 2nd offense onwards: Temp ban with escalating duration
      // 2nd = 1 hour, 3rd = 1.5 hours, 4th = 2 hours, etc. (+30 min each)
      const banMinutes = 30 + (warningCount - 1) * 30; // 60, 90, 120, 150...
      const banHours = banMinutes / 60;
      const expiresAt = new Date(Date.now() + banMinutes * 60 * 1000);
      
      // Create ban record in database
      try {
        await BanModel.create({
          userId: String(userId),
          reason: `Spam/channel promotion (offense #${warningCount})`
        });
      } catch (err) {
        console.error('Error creating ban record:', err);
      }
      
      // Store ban expiry in Redis for fast lookup
      await redisClient.setEx(`spam:ban:${userId}`, banMinutes * 60, expiresAt.toISOString());
      
      const timeStr = banMinutes >= 60 
        ? `${banHours} hour${banHours > 1 ? 's' : ''}` 
        : `${banMinutes} minutes`;
      
      return {
        action: 'temp_ban',
        message: `⏰ *You have been banned for ${timeStr}* for promoting channels/links.\n\n⚠️ Each additional offense increases ban duration by 30 minutes.\n\n_Offense count: ${warningCount}_`
      };
    } else {
      // 1st offense: Warning only
      return {
        action: 'warn',
        message: '⚠️ *Warning:* Promoting Telegram channels, groups, or links is not allowed.\n\n🚫 Continuing this behavior will result in a temporary ban.\n\n_Warnings: 1_'
      };
    }
  }

  /**
   * Check if user is currently spam-banned (uses Redis for temp bans)
   * @param {number|string} userId 
   * @returns {Promise<boolean>}
   */
  static async isUserBanned(userId) {
    try {
      // Check Redis for active temp ban
      const banExpiry = await redisClient.get(`spam:ban:${userId}`);
      if (banExpiry) {
        const expiresAt = new Date(banExpiry);
        if (expiresAt > new Date()) {
          return true; // Still banned
        }
        // Ban expired, clean up
        await redisClient.del(`spam:ban:${userId}`);
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  /**
   * Get remaining ban time in minutes
   * @param {number|string} userId 
   * @returns {Promise<number>} Minutes remaining, 0 if not banned
   */
  static async getBanTimeRemaining(userId) {
    try {
      const banExpiry = await redisClient.get(`spam:ban:${userId}`);
      if (banExpiry) {
        const expiresAt = new Date(banExpiry);
        const remaining = Math.max(0, Math.ceil((expiresAt - new Date()) / 60000));
        return remaining;
      }
      return 0;
    } catch (err) {
      return 0;
    }
  }

  /**
   * Reset user's warning count (for admin use)
   * @param {number|string} userId 
   */
  static async resetWarnings(userId) {
    try {
      await redisClient.del(`spam:warnings:${userId}`);
      await redisClient.del(`spam:ban:${userId}`);
    } catch (err) {
      // Ignore
    }
  }

  /**
   * Check if text contains only a profile share via /link (allowed)
   * @param {string} text 
   * @returns {boolean}
   */
  static isLinkCommand(text) {
    return /^\/link\b/i.test(text.trim());
  }
}

module.exports = SpamDetectionService;
