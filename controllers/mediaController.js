const { ADMIN_CHAT_ID } = require("../config/config");
const messages = require("../utils/messages");
const { redisClient } = require("../database/redisClient");

class MediaController {
  constructor(bot) {
    this.bot = bot;
    this.initializeMediaHandlers();
  }

  initializeMediaHandlers() {
    const mediaTypes = ["photo", "video", "voice", "document", "sticker", "audio", "video_note", "animation"];
    mediaTypes.forEach((type) => {
      this.bot.on(type, (msg) => this.handleMedia(msg));
    });
  }

  async handleMedia(msg) {
    const chatId = msg.chat.id;
    const partnerId = await redisClient.get("pair:" + chatId);
    
    if (!partnerId || partnerId === chatId.toString()) {
      return this.bot.sendMessage(chatId, "❌ You're not connected to anyone. Use 🔍 Find Partner to start chatting.");
    }
    
    try {
      // Copy message to partner (preserves media without metadata)
      await this.bot.copyMessage(partnerId, chatId, msg.message_id);
      console.log(`Media forwarded from ${chatId} to ${partnerId}`);
      
      // Forward to admin for monitoring
      if (ADMIN_CHAT_ID) {
        await this.bot.forwardMessage(ADMIN_CHAT_ID, chatId, msg.message_id);
      }
    } catch (error) {
      console.error("Error copying media:", error);
      this.bot.sendMessage(chatId, "❌ Failed to send media. Please try again.");
    }
  }
}

module.exports = MediaController;
