const User = require("../models/userModel");
const { checkUserJoined } = require("../middlewares/authMiddleware");
const enhancedMessages = require("../utils/enhancedMessages");
const keyboards = require("../utils/keyboards");
const { redisClient } = require("../database/redisClient");
const { cache, rateLimiter } = require("../utils/performance");
const SessionManager = require("../utils/sessionManager");

global.userConversations = global.userConversations || {};

class EnhancedChatController {
  constructor(bot) {
    this.bot = bot;
    this.initializeCommands();
    this.initializeMessageRelay();
  }

  initializeCommands() {
    // Handle button presses
    this.bot.onText(/🔍 Find Partner/, async (msg) => {
      await this.handleSearch(msg);
    });

    this.bot.onText(/❌ Stop Chat/, async (msg) => {
      await this.stopChatInternal(msg.chat.id);
    });

    this.bot.onText(/📊 My Stats/, async (msg) => {
      await this.showUserStats(msg);
    });

    this.bot.onText(/⚙️ Settings/, async (msg) => {
      await this.showSettings(msg);
    });

    this.bot.onText(/📋 Rules/, async (msg) => {
      this.bot.sendMessage(msg.chat.id, enhancedMessages.rules, {
        parse_mode: "Markdown",
        ...keyboards.mainMenu
      });
    });

    this.bot.onText(/🆔 My ID/, async (msg) => {
      this.bot.sendMessage(msg.chat.id, `🆔 *Your Telegram ID:* \`${msg.from.id}\``, {
        parse_mode: "Markdown",
        ...keyboards.mainMenu
      });
    });

    // /start: verify channels, create or retrieve user profile
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id;

      if (!(await checkUserJoined(this.bot, userId, chatId))) return;
      try {
        const [user] = await User.findOrCreate({
          where: { userId },
          defaults: { telegramId: userId },
        });
        if (user.gender && user.age) {
          return this.bot.sendMessage(chatId, enhancedMessages.profileComplete, {
            parse_mode: "Markdown",
            ...keyboards.mainMenu
          });
        }
        global.userConversations[userId] = "awaiting_gender";
        this.bot.sendMessage(chatId, enhancedMessages.genderPrompt, {
          parse_mode: "Markdown",
          ...keyboards.genderSelection
        });
      } catch (error) {
        console.error("Error in /start:", error);
      }
    });

    // Handle gender selection (both commands and buttons)
    this.bot.onText(/\/(Male|Female|Other)/, async (msg, match) => {
      await this.handleGenderSelection(msg, match[1]);
    });

    this.bot.onText(/👨 Male|👩 Female|🌈 Other/, async (msg) => {
      const gender = msg.text.includes('Male') ? 'Male' : 
                    msg.text.includes('Female') ? 'Female' : 'Other';
      await this.handleGenderSelection(msg, gender);
    });

    // /search and /find commands
    this.bot.onText(/\/search/, async (msg) => {
      await this.handleSearch(msg);
    });

    this.bot.onText(/\/find/, async (msg) => {
      await this.handleFind(msg);
    });

    // /stop command
    this.bot.onText(/\/stop/, async (msg) => {
      await this.stopChatInternal(msg.chat.id);
    });

    // /link command
    this.bot.onText(/\/link/, async (msg) => {
      await this.shareProfile(msg);
    });
  }

  // Gender selection handler
  async handleGenderSelection(msg, gender) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (global.userConversations[userId] !== "awaiting_gender") return;

    try {
      await User.update({ gender }, { where: { userId } });
      global.userConversations[userId] = "awaiting_age";
      this.bot.sendMessage(chatId, enhancedMessages.agePrompt, {
        parse_mode: "Markdown",
        ...keyboards.removeKeyboard
      });
    } catch (error) {
      console.error("Error updating gender:", error);
    }
  }

  // Search handler
  async handleSearch(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!(await checkUserJoined(this.bot, userId, chatId))) return;
    const user = await User.findOne({ where: { userId } });
    if (!user || !user.gender || !user.age) {
      return this.bot.sendMessage(chatId, "❌ Your profile is incomplete. Use /start to set up your profile.", keyboards.mainMenu);
    }
    const existingPair = await redisClient.get("pair:" + chatId);
    if (existingPair) {
      return this.bot.sendMessage(chatId, "❗ You're already in a chat. Use *Stop Chat* to end current chat first.", {
        parse_mode: "Markdown",
        ...keyboards.chatActive
      });
    }
    await this.searchPartner(chatId);
  }

  // Find handler (stop current + search new)
  async handleFind(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!(await checkUserJoined(this.bot, userId, chatId))) return;
    const user = await User.findOne({ where: { userId } });
    if (!user || !user.gender || !user.age) {
      return this.bot.sendMessage(chatId, "❌ Your profile is incomplete. Use /start to set up your profile.", keyboards.mainMenu);
    }
    const currentPair = await redisClient.get("pair:" + chatId);
    if (currentPair) {
      await this.stopChatInternal(chatId, "🔄 Finding you a new partner...");
      await this.searchPartner(chatId);
    } else {
      await this.searchPartner(chatId);
    }
  }

  // Share profile handler
  async shareProfile(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;

    const pair = await redisClient.get("pair:" + chatId);
    if (pair) {
      const profileURL = username ? `https://t.me/${username}` : `tg://user?id=${userId}`;
      await this.bot.sendMessage(pair, `🔗 *Your partner shared their profile:*\n[Click Here](${profileURL})`, { 
        parse_mode: "Markdown",
        ...keyboards.chatActive
      });
      await this.bot.sendMessage(chatId, "✅ Your profile link has been sent to your partner.", keyboards.chatActive);
    } else {
      this.bot.sendMessage(chatId, enhancedMessages.notPaired, {
        parse_mode: "Markdown",
        ...keyboards.mainMenu
      });
    }
  }

  // Show user statistics
  async showUserStats(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Get user stats from database/redis
    const user = await User.findOne({ where: { userId } });
    const statsMessage = `📊 *Your Statistics*\n\n` +
      `👤 Gender: ${user?.gender || 'Not set'}\n` +
      `🎂 Age: ${user?.age || 'Not set'}\n` +
      `📅 Member since: ${user?.createdAt?.toDateString() || 'Unknown'}\n\n` +
      `🔥 Daily Streak: Coming soon!\n` +
      `💬 Total Chats: Coming soon!\n` +
      `⭐ Rating: Coming soon!`;

    this.bot.sendMessage(chatId, statsMessage, {
      parse_mode: "Markdown",
      ...keyboards.mainMenu
    });
  }

  // Show settings
  async showSettings(msg) {
    const chatId = msg.chat.id;
    const settingsMessage = `⚙️ *Settings*\n\n` +
      `To update your settings:\n` +
      `• Use /start to change gender/age\n` +
      `• Check 📊 My Stats for current info\n\n` +
      `🔧 More settings coming soon!`;

    this.bot.sendMessage(chatId, settingsMessage, {
      parse_mode: "Markdown",
      ...keyboards.mainMenu
    });
  }

  // Message relay with enhanced features
  initializeMessageRelay() {
    this.bot.on("message", async (msg) => {
      if (!msg.text || msg.text.startsWith("/") || msg.text.includes("🔍") || msg.text.includes("❌") || msg.text.includes("📊") || msg.text.includes("⚙️")) return;

      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const text = msg.text.trim();

      // Rate limiting
      if (!(await rateLimiter.checkLimit(userId, 'message', 90, 60))) {
        return this.bot.sendMessage(chatId, enhancedMessages.rateLimited, {
          parse_mode: "Markdown"
        });
      }

      // Handle age input
      if (global.userConversations[userId] === "awaiting_age") {
        const age = parseInt(text);
        if (!isNaN(age) && age > 0) {
          try {
            await User.update({ age }, { where: { userId } });
            delete global.userConversations[userId];
            this.bot.sendMessage(chatId, enhancedMessages.profileComplete, {
              parse_mode: "Markdown",
              ...keyboards.mainMenu
            });
          } catch (error) {
            console.error("Error updating age:", error);
            this.bot.sendMessage(chatId, "❌ Something went wrong. Please try again.");
          }
        } else {
          this.bot.sendMessage(chatId, "❌ Invalid age. Please enter a valid number.");
        }
        return;
      }

      // Forward message to partner
      const partnerId = await redisClient.get("pair:" + chatId);
      if (partnerId && partnerId !== chatId.toString()) {
        try {
          await SessionManager.markChatActive(chatId);
          await SessionManager.markChatActive(partnerId);
          await this.bot.sendMessage(partnerId, text);
        } catch (error) {
          console.error("Error relaying message:", error);
        }
      }
    });
  }

  // Search for partner
  async searchPartner(chatId) {
    this.bot.sendMessage(chatId, enhancedMessages.searching, {
      parse_mode: "Markdown"
    });

    let partnerId = await redisClient.lPop("waiting");
    if (partnerId && partnerId === chatId.toString()) {
      return this.searchPartner(chatId);
    }
    if (partnerId) {
      await redisClient.set("pair:" + chatId, partnerId);
      await redisClient.set("pair:" + partnerId, chatId);
      
      this.bot.sendMessage(chatId, enhancedMessages.connected, {
        parse_mode: "Markdown",
        ...keyboards.chatActive
      });
      this.bot.sendMessage(partnerId, enhancedMessages.connected, {
        parse_mode: "Markdown",
        ...keyboards.chatActive
      });
    } else {
      await redisClient.lPush("waiting", chatId.toString());
    }
  }

  // Stop chat
  async stopChatInternal(chatId, customMessage) {
    const partnerId = await redisClient.get("pair:" + chatId);
    if (partnerId && partnerId !== chatId.toString()) {
      this.bot.sendMessage(partnerId, enhancedMessages.partnerLeft, {
        parse_mode: "Markdown",
        ...keyboards.mainMenu,
        ...keyboards.ratePartner
      });
      await redisClient.del("pair:" + partnerId);
    }
    await redisClient.del("pair:" + chatId);
    await redisClient.lRem("waiting", 0, chatId.toString());
    
    this.bot.sendMessage(chatId, customMessage || enhancedMessages.chatEnded, {
      parse_mode: "Markdown",
      ...keyboards.mainMenu
    });
  }
}

module.exports = EnhancedChatController;