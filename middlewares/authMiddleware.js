const { REQUIRED_CHANNEL_1, REQUIRED_CHANNEL_2 } = require("../config/config");
const ConfigService = require("../services/configService");

const checkUserJoined = async (bot, userId, chatId) => {
  // Get dynamic config from database (for promotions/changes)
  const channelEnabled = await ConfigService.get('required_channel_enabled', false);
  const dynamicChannel1 = await ConfigService.get('required_channel_1', '');
  const dynamicChannel2 = await ConfigService.get('required_channel_2', '');
  
  // Use dynamic config if enabled, otherwise fall back to env vars
  let ch1 = null;
  let ch2 = null;
  
  if (channelEnabled) {
    // Use dynamic channels from database
    ch1 = dynamicChannel1 ? String(dynamicChannel1).trim() : null;
    ch2 = dynamicChannel2 ? String(dynamicChannel2).trim() : null;
  } else {
    // Fall back to environment variables
    ch1 = REQUIRED_CHANNEL_1 ? String(REQUIRED_CHANNEL_1).trim() : null;
    ch2 = REQUIRED_CHANNEL_2 ? String(REQUIRED_CHANNEL_2).trim() : null;
  }

  if (!ch1 && !ch2) return true; // Nothing to enforce

  const missing = [];
  const allowedStatuses = ["member", "administrator", "creator"];

  if (ch1) {
    try {
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
    const inline_keyboard = missing.map((handle) => ([{ text: `Join ${handle}`, url: `https://t.me/${handle.replace("@", "")}` }]));

    await bot.sendMessage(chatId, "❌ You must join the required channels to use this bot:", {
      reply_markup: { inline_keyboard }
    });

    await bot.sendMessage(chatId, "After joining, use /start to verify.");
    return false;
  }

  return true;
};

module.exports = { checkUserJoined };
