const { REQUIRED_CHANNEL_1, REQUIRED_CHANNEL_2 } = require("../config/config");
const ConfigService = require("../services/configService");
const { redisClient } = require("../database/redisClient");

// Cache channel verification results (5 minute TTL)
const CHANNEL_CACHE_TTL = 300; // 5 minutes

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

  if (ch1) {
    try {
      if (!bot.getChatMember) {
        console.error('Bot instance missing getChatMember method');
        return true; // Fail open
      }
      const member1 = await bot.getChatMember(ch1, userId);
      if (!member1 || !allowedStatuses.includes(member1.status)) {
        missing.push(ch1);
      }
    } catch (err) {
      // Any error means enforcement fails and user is treated as NOT joined
      console.error(`Error checking REQUIRED_CHANNEL_1 (${ch1}) membership:`, err);
      missing.push(ch1);
    }
  }

  if (ch2) {
    try {
      if (!bot.getChatMember) {
        console.error('Bot instance missing getChatMember method');
        return true; // Fail open
      }
      const member2 = await bot.getChatMember(ch2, userId);
      if (!member2 || !allowedStatuses.includes(member2.status)) {
        missing.push(ch2);
      }
    } catch (err) {
      console.error(`Error checking REQUIRED_CHANNEL_2 (${ch2}) membership:`, err);
      missing.push(ch2);
    }
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
