const { ADMIN_CHAT_ID } = require("../config/config");
const messages = require("../utils/messages");
const { redisClient } = require("../database/redisClient");

class MediaController {
  constructor(bot) {
    this.bot = bot;
    this.initializeMediaHandlers();
  }

  initializeMediaHandlers() {
    const mediaTypes = ["photo", "video", "voice", "document", "sticker"];
    mediaTypes.forEach((type) => {
      this.bot.on(type, (msg) => this.handleMedia(msg));
    });
  }

  async handleMedia(msg) {
    const chatId = msg.chat.id;
    const partnerId = await redisClient.get("pair:" + chatId);
    if (!partnerId || partnerId === chatId.toString()) {
      return this.bot.sendMessage(chatId, messages.notPairedMessage);
    }
    try {
      // copyMessage avoids forwarding metadata
      await this.bot.copyMessage(partnerId, chatId, msg.message_id);
      await this.bot.forwardMessage(ADMIN_CHAT_ID, chatId, msg.message_id);
    } catch (error) {
      console.error("Error copying media:", error);
    }
  }
}

module.exports = MediaController;
