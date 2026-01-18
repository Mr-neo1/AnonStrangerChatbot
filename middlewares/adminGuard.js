const config = require('../config/config');

module.exports = function isAdmin(chatId) {
  const adminId = config.ADMIN_CONTROL_CHAT_ID || config.ADMIN_CHAT_ID;
  if (!adminId) return false;
  return String(chatId) === String(adminId);
};