/**
 * Dynamic Messages Service
 * Provides customizable bot messages that can be updated via admin panel
 * Falls back to default messages if not configured
 */

const ConfigService = require('./configService');

// Default messages (fallback)
const defaultMessages = {
  msg_welcome: "🎉 *Welcome to Anonymous Chat!*\n\n" +
    "Connect with strangers worldwide! 🌍\n\n" +
    "📝 *Quick Setup:*\n" +
    "1️⃣ Select your gender\n" +
    "2️⃣ Enter your age\n" +
    "3️⃣ Start chatting!\n\n" +
    "✨ _Let's get started!_",

  msg_searching: "� Looking for a partner...\n\n" +
    "/stop — stop searching",

  msg_connected: "✅ Partner found, let's chat!\n\n" +
    "/stop — end the dialogue\n" +
    "/next — find a new partner",

  msg_partner_left: "💬 Your partner has stopped the chat.\n\n" +
    "/next — find a new partner\n" +
    "/report — send a complaint",

  msg_chat_ended: "💬 You stopped the chat\n\n" +
    "/next — find a new partner\n" +
    "/report — send a complaint",

  msg_chat_ended_next: "💬 You stopped the chat\n\n" +
    "🔎 Looking for a new partner...\n\n" +
    "/stop — stop searching",

  msg_not_paired: "❗️ You are not in a dialogue\n\n" +
    "Use 🎲 Find a partner to start chatting.",

  msg_in_dialogue: "❗️ You are in a dialogue\n\n" +
    "To end the dialog, use the /stop command.",

  msg_banned_user: "🚫 You have been banned from using this bot.\n\n" +
    "If you believe this is a mistake, please contact support.",

  msg_maintenance: "🔧 *Maintenance Mode*\n\n" +
    "The bot is currently under maintenance.\n" +
    "Please try again later. We apologize for the inconvenience.",

  msg_rate_limited: "⏰ Please slow down. Wait a moment before sending another message.",

  msg_rules: "📋 *Chat Rules*\n\n" +
    "You will be blocked if you violate our rules!\n\n" +
    "1️⃣ Be respectful to everyone\n" +
    "2️⃣ No spam or advertising\n" +
    "3️⃣ No sharing personal information\n" +
    "4️⃣ No inappropriate content\n" +
    "5️⃣ Report abusive users"
};

// In-memory cache for messages (refreshed every 60 seconds)
let messageCache = {};
let lastCacheTime = 0;
const CACHE_TTL = 60000; // 60 seconds

class MessagesService {
  /**
   * Get a specific message by key
   * @param {string} key - Message key (e.g., 'msg_welcome')
   * @returns {Promise<string>} The message text
   */
  static async get(key) {
    await this.refreshCacheIfNeeded();
    return messageCache[key] || defaultMessages[key] || '';
  }

  /**
   * Get all messages
   * @returns {Promise<Object>} All messages
   */
  static async getAll() {
    await this.refreshCacheIfNeeded();
    return { ...defaultMessages, ...messageCache };
  }

  /**
   * Refresh cache if expired
   */
  static async refreshCacheIfNeeded() {
    const now = Date.now();
    if (now - lastCacheTime < CACHE_TTL && Object.keys(messageCache).length > 0) {
      return;
    }

    try {
      const messages = await ConfigService.getMany(
        Object.fromEntries(Object.keys(defaultMessages).map(k => [k, null]))
      );
      
      // Only cache non-null values
      messageCache = {};
      for (const [key, value] of Object.entries(messages)) {
        if (value !== null && value !== undefined && value !== '') {
          messageCache[key] = value;
        }
      }
      lastCacheTime = now;
    } catch (err) {
      console.error('MessagesService cache refresh error:', err.message);
      // Keep existing cache on error
    }
  }

  /**
   * Clear the cache (call when messages are updated)
   */
  static clearCache() {
    messageCache = {};
    lastCacheTime = 0;
  }

  /**
   * Get welcome message
   */
  static async getWelcome() {
    return this.get('msg_welcome');
  }

  /**
   * Get searching message
   */
  static async getSearching() {
    return this.get('msg_searching');
  }

  /**
   * Get connected message
   */
  static async getConnected() {
    return this.get('msg_connected');
  }

  /**
   * Get partner left message
   */
  static async getPartnerLeft() {
    return this.get('msg_partner_left');
  }

  /**
   * Get chat ended message (when user stops chat)
   */
  static async getChatEnded() {
    return this.get('msg_chat_ended');
  }

  /**
   * Get chat ended with next search message (when user uses /next)
   */
  static async getChatEndedNext() {
    return this.get('msg_chat_ended_next');
  }

  /**
   * Get "in dialogue" message (when user tries command while chatting)
   */
  static async getInDialogue() {
    return this.get('msg_in_dialogue');
  }

  /**
   * Get not paired message
   */
  static async getNotPaired() {
    return this.get('msg_not_paired');
  }

  /**
   * Get banned user message
   */
  static async getBanned() {
    return this.get('msg_banned_user');
  }

  /**
   * Get maintenance message
   */
  static async getMaintenance() {
    return this.get('msg_maintenance');
  }

  /**
   * Get rate limited message
   */
  static async getRateLimited() {
    return this.get('msg_rate_limited');
  }

  /**
   * Get rules message
   */
  static async getRules() {
    return this.get('msg_rules');
  }
}

module.exports = MessagesService;
