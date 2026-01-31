const { REQUIRED_CHANNEL_1, REQUIRED_CHANNEL_2 } = require("../config/config");
const ConfigService = require("../services/configService");
const { redisClient } = require("../database/redisClient");

// Cache channel verification results
// OPTIMIZED: Increased from 5 to 30 minutes for verified users (fewer Redis reads)
const CHANNEL_CACHE_TTL = 1800; // 30 minutes (user unlikely to leave channel frequently)

const checkUserJoined = async (bot, userId, chatId) => {
  // Get bot instance - fallback if not provided
  if (!bot) {
    try {
      const { getAllBots } = require('../bots');
      const bots = getAllBots();
      bot = bots && bots.length > 0 ? bots[0] : null;
    } catch (err) {
      console.error('Error getting bot instance:', err);
      // If no bot available, allow access (fail open)
      return true;
    }
  }
  
  if (!bot) {
    // No bot instance available - allow access (fail open to prevent blocking)
    return true;
  }
  
  // Check cache first (performance optimization)
  const cacheKey = `channel:verified:${userId}`;
  const cached = await redisClient.get(cacheKey).catch(() => null);
  if (cached === 'true') {
    return true; // User verified recently, skip check
  }

  // Get dynamic config from database (for promotions/changes)
  const channelEnabled = await ConfigService.get('required_channel_enabled', false);
  const dynamicChannel1 = await ConfigService.get('required_channel_1', '');
  const dynamicChannel2 = await ConfigService.get('required_channel_2', '');
  
  // Helper function to validate channel handle
  const isValidChannel = (channel) => {
    if (!channel) return false;
    const trimmed = String(channel).trim();
    // Must have content beyond just @ or whitespace
    return trimmed.length > 1 && trimmed !== '@' && trimmed !== '';
  };
  
  // Use dynamic config if enabled, otherwise fall back to env vars
  let ch1 = null;
  let ch2 = null;
  
  // Only check channels if channel verification is explicitly enabled
  if (channelEnabled) {
    // Use dynamic channels from database - validate they're not empty/invalid
    if (isValidChannel(dynamicChannel1)) {
      ch1 = String(dynamicChannel1).trim();
    }
    if (isValidChannel(dynamicChannel2)) {
      ch2 = String(dynamicChannel2).trim();
    }
  } else {
    // Fall back to environment variables - validate they're not empty/invalid
    if (isValidChannel(REQUIRED_CHANNEL_1)) {
      ch1 = String(REQUIRED_CHANNEL_1).trim();
    }
    if (isValidChannel(REQUIRED_CHANNEL_2)) {
      ch2 = String(REQUIRED_CHANNEL_2).trim();
    }
  }

  // MANDATORY: If channels are configured, enforce them
  // Only allow access if no channels are configured (for initial setup)
  if (!ch1 && !ch2) {
    // No channels configured - allow access (admin can configure later)
    return true;
  }

  const missing = [];
  const allowedStatuses = ["member", "administrator", "creator"];

  // Track channels where bot is not admin (config error)
  const botNotAdminChannels = [];

  if (ch1) {
    try {
      if (!bot.getChatMember) {
        console.error('Bot instance missing getChatMember method');
        botNotAdminChannels.push(ch1);
      } else {
        const member1 = await bot.getChatMember(ch1, userId);
        if (!member1 || !allowedStatuses.includes(member1.status)) {
          missing.push(ch1);
        }
      }
    } catch (err) {
      // Check if it's a "member list is inaccessible" error (bot not admin in channel)
      const errMsg = err?.message || err?.response?.body?.description || '';
      if (errMsg.includes('member list is inaccessible') || errMsg.includes('chat not found') || errMsg.includes('bot is not a member')) {
        // Bot doesn't have admin access to this channel - BLOCK ACCESS
        console.error(`🚫 CONFIGURATION ERROR: Bot is not admin in channel ${ch1}. Users will be blocked until this is fixed.`);
        botNotAdminChannels.push(ch1);
      } else {
        // Other errors - user treated as NOT joined
        console.error(`Error checking channel ${ch1} membership:`, errMsg);
        missing.push(ch1);
      }
    }
  }

  if (ch2) {
    try {
      if (!bot.getChatMember) {
        console.error('Bot instance missing getChatMember method');
        botNotAdminChannels.push(ch2);
      } else {
        const member2 = await bot.getChatMember(ch2, userId);
        if (!member2 || !allowedStatuses.includes(member2.status)) {
          missing.push(ch2);
        }
      }
    } catch (err) {
      // Check if it's a "member list is inaccessible" error (bot not admin in channel)
      const errMsg = err?.message || err?.response?.body?.description || '';
      if (errMsg.includes('member list is inaccessible') || errMsg.includes('chat not found') || errMsg.includes('bot is not a member')) {
        // Bot doesn't have admin access to this channel - BLOCK ACCESS
        console.error(`🚫 CONFIGURATION ERROR: Bot is not admin in channel ${ch2}. Users will be blocked until this is fixed.`);
        botNotAdminChannels.push(ch2);
      } else {
        // Other errors - user treated as NOT joined
        console.error(`Error checking channel ${ch2} membership:`, errMsg);
        missing.push(ch2);
      }
    }
  }

  // CRITICAL: If bot is not admin in any channel, block user and show admin error
  if (botNotAdminChannels.length > 0) {
    try {
      const adminErrorMsg = `⚠️ *Bot Configuration Error*\n\nThe bot cannot verify channel membership because it is not added as an admin to the required channel(s):\n\n${botNotAdminChannels.map(c => `• ${c}`).join('\n')}\n\n*Please contact the bot administrator to fix this issue.*`;
      await bot.sendMessage(chatId, adminErrorMsg, { parse_mode: 'Markdown' }).catch(() => {});
    } catch (e) {
      console.error('Error sending bot config error message:', e);
    }
    return false; // BLOCK access until admin fixes configuration
  }

  if (missing.length > 0) {
    try {
      if (!bot.sendMessage) {
        console.error('Bot instance missing sendMessage method');
        return true; // Fail open
      }
    const inline_keyboard = missing.map((handle) => ([{ text: `Join ${handle}`, url: `https://t.me/${handle.replace("@", "")}` }]));

    await bot.sendMessage(chatId, "❌ You must join the required channels to use this bot:", {
      reply_markup: { inline_keyboard }
      }).catch(() => {});

      await bot.sendMessage(chatId, "After joining, use /start to verify.").catch(() => {});
    return false;
    } catch (err) {
      console.error('Error sending channel requirement message:', err);
      // Fail open - allow access if we can't send message
      return true;
    }
  }

  // Cache successful verification (5 minutes)
  await redisClient.setEx(cacheKey, CHANNEL_CACHE_TTL, 'true').catch(() => {});
  return true;
};

module.exports = { checkUserJoined };
