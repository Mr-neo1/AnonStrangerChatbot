const { isFeatureEnabled } = require('../config/featureFlags');

module.exports = function featureEnabledOrReply(flag, bot, chatId, msg = 'This feature is currently disabled.') {
  if (!isFeatureEnabled(flag)) {
    bot.sendMessage(chatId, msg);
    return false;
  }
  return true;
};