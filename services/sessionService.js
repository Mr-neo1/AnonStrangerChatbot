const SessionManager = require('../utils/sessionManager');

class SessionService {
  static markChatActive(chatId) {
    return SessionManager.markChatActive(chatId);
  }

  static isChatActive(chatId) {
    return SessionManager.isChatActive(chatId);
  }
}

module.exports = SessionService;