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

    // Chat active buttons
    this.bot.onText(/🔄 Next Partner/, async (msg) => {
      await this.handleFind(msg);
    });

    this.bot.onText(/🔗 Share Profile/, async (msg) => {
      await this.shareProfile(msg);
    });

    // Settings menu buttons
    this.bot.onText(/👤 Update Gender/, async (msg) => {
      await this.updateGender(msg);
    });

    this.bot.onText(/🎂 Update Age/, async (msg) => {
      await this.updateAge(msg);
    });

    this.bot.onText(/📊 View Stats/, async (msg) => {
      await this.showUserStats(msg);
    });

    this.bot.onText(/🔙 Back to Menu/, async (msg) => {
      this.bot.sendMessage(msg.chat.id, enhancedMessages.profileComplete, {
        parse_mode: "Markdown",
        ...keyboards.mainMenu
      });
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

    this.bot.onText(/👤 My Profile/, async (msg) => {
      await this.showUserProfile(msg);
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
    const userState = global.userConversations[userId];
    
    if (userState !== "awaiting_gender" && userState !== "updating_gender") return;

    try {
      await User.update({ gender }, { where: { userId } });
      
      if (userState === "awaiting_gender") {
        // New user setup
        global.userConversations[userId] = "awaiting_age";
        this.bot.sendMessage(chatId, enhancedMessages.agePrompt, {
          parse_mode: "Markdown",
          ...keyboards.removeKeyboard
        });
      } else {
        // Updating existing user
        delete global.userConversations[userId];
        this.bot.sendMessage(chatId, `✅ *Gender updated to ${gender}!*`, {
          parse_mode: "Markdown",
          ...keyboards.mainMenu
        });
      }
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
    
    try {
      // Update daily streak first
      await this.updateDailyStreak(userId);
      
      // Get updated user stats
      const user = await User.findOne({ where: { userId } });
      const statsMessage = `📊 *Your Statistics*\n\n` +
        `👤 Gender: ${user?.gender || 'Not set'}\n` +
        `🎂 Age: ${user?.age || 'Not set'}\n` +
        `📅 Member since: ${user?.createdAt?.toDateString() || 'Unknown'}\n\n` +
        `🔥 Daily Streak: ${user?.dailyStreak || 0} days\n` +
        `💬 Total Chats: ${user?.totalChats || 0} conversations\n\n` +
        `🎆 _Keep chatting to increase your stats!_`;

      this.bot.sendMessage(chatId, statsMessage, {
        parse_mode: "Markdown",
        ...keyboards.mainMenu
      });
    } catch (error) {
      console.error('Error showing stats:', error);
      this.bot.sendMessage(chatId, '❌ Error loading statistics. Please try again.');
    }
  }

  // Show user profile
  async showUserProfile(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name;
    const lastName = msg.from.last_name;
    
    try {
      const user = await User.findOne({ where: { userId } });
      
      const profileMessage = `👤 *Your Profile*\n\n` +
        `📝 *Name:* ${firstName}${lastName ? ' ' + lastName : ''}\n` +
        `🔗 *Username:* ${username ? '@' + username : 'Not set'}\n` +
        `🆔 *Telegram ID:* \`${userId}\`\n\n` +
        `👤 *Gender:* ${user?.gender || '❌ Not set'}\n` +
        `🎂 *Age:* ${user?.age || '❌ Not set'}\n` +
        `📅 *Member since:* ${user?.createdAt?.toDateString() || 'Unknown'}\n\n` +
        `🔥 *Daily Streak:* ${user?.dailyStreak || 0} days\n` +
        `💬 *Total Chats:* ${user?.totalChats || 0} conversations\n\n` +
        `⚙️ _Use Settings to update your profile_`;

      this.bot.sendMessage(chatId, profileMessage, {
        parse_mode: "Markdown",
        ...keyboards.mainMenu
      });
    } catch (error) {
      console.error('Error showing profile:', error);
      this.bot.sendMessage(chatId, '❌ Error loading profile. Please try again.');
    }
  }

  // Show settings
  async showSettings(msg) {
    const chatId = msg.chat.id;
    const settingsMessage = `⚙️ *Settings Menu*\n\n` +
      `Update your profile information:\n` +
      `• 👤 Change your gender\n` +
      `• 🎂 Update your age\n` +
      `• 📊 View your statistics\n\n` +
      `👇 _Choose an option below:_`;

    this.bot.sendMessage(chatId, settingsMessage, {
      parse_mode: "Markdown",
      ...keyboards.settingsMenu
    });
  }

  // Update gender
  async updateGender(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    global.userConversations[userId] = "updating_gender";
    this.bot.sendMessage(chatId, enhancedMessages.genderPrompt, {
      parse_mode: "Markdown",
      ...keyboards.genderSelection
    });
  }

  // Update age
  async updateAge(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    global.userConversations[userId] = "updating_age";
    this.bot.sendMessage(chatId, enhancedMessages.agePrompt, {
      parse_mode: "Markdown",
      ...keyboards.removeKeyboard
    });
  }

  // Update daily streak
  async updateDailyStreak(userId) {
    try {
      const user = await User.findOne({ where: { userId } });
      if (!user) return;

      const today = new Date().toISOString().split('T')[0];
      const lastActive = user.lastActiveDate;
      
      if (!lastActive) {
        // First time user
        await User.update({ 
          dailyStreak: 1, 
          lastActiveDate: today 
        }, { where: { userId } });
      } else {
        const lastActiveDate = new Date(lastActive);
        const todayDate = new Date(today);
        const diffTime = todayDate - lastActiveDate;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
          // Consecutive day - increment streak
          await User.update({ 
            dailyStreak: user.dailyStreak + 1, 
            lastActiveDate: today 
          }, { where: { userId } });
        } else if (diffDays > 1) {
          // Streak broken - reset to 1
          await User.update({ 
            dailyStreak: 1, 
            lastActiveDate: today 
          }, { where: { userId } });
        }
        // If diffDays === 0, same day - no update needed
      }
    } catch (error) {
      console.error('Error updating daily streak:', error);
    }
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

      // Handle age input (new user or update)
      const userState = global.userConversations[userId];
      if (userState === "awaiting_age" || userState === "updating_age") {
        const age = parseInt(text);
        if (!isNaN(age) && age > 0 && age < 120) {
          try {
            await User.update({ age }, { where: { userId } });
            delete global.userConversations[userId];
            
            if (userState === "awaiting_age") {
              // New user setup complete
              await this.updateDailyStreak(userId);
              this.bot.sendMessage(chatId, enhancedMessages.profileComplete, {
                parse_mode: "Markdown",
                ...keyboards.mainMenu
              });
            } else {
              // Age update
              this.bot.sendMessage(chatId, `✅ *Age updated to ${age}!*`, {
                parse_mode: "Markdown",
                ...keyboards.mainMenu
              });
            }
          } catch (error) {
            console.error("Error updating age:", error);
            this.bot.sendMessage(chatId, "❌ Something went wrong. Please try again.");
          }
        } else {
          this.bot.sendMessage(chatId, "❌ Invalid age. Please enter a number between 1-119.");
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

  // Search for partner with improved logic
  async searchPartner(chatId) {
    this.bot.sendMessage(chatId, enhancedMessages.searching, {
      parse_mode: "Markdown"
    });

    let partnerId = await redisClient.lPop("waiting");
    let attempts = 0;
    const maxAttempts = 10;
    
    // Prevent self-connection and recent partner matching
    while (partnerId && attempts < maxAttempts) {
      if (partnerId === chatId.toString()) {
        // Self-connection, try next
        partnerId = await redisClient.lPop("waiting");
        attempts++;
        continue;
      }
      
      // Check if recently chatted (optional - can be enhanced later)
      const recentPartner = await redisClient.get(`recent:${chatId}:${partnerId}`);
      if (recentPartner) {
        // Recently chatted, try next
        await redisClient.lPush("waiting", partnerId); // Put back in queue
        partnerId = await redisClient.lPop("waiting");
        attempts++;
        continue;
      }
      
      break; // Found valid partner
    }
    
    if (partnerId && partnerId !== chatId.toString()) {
      // Valid partner found
      await redisClient.set("pair:" + chatId, partnerId);
      await redisClient.set("pair:" + partnerId, chatId);
      
      // Mark as recent partners (expires in 1 hour)
      await redisClient.setEx(`recent:${chatId}:${partnerId}`, 3600, "1");
      await redisClient.setEx(`recent:${partnerId}:${chatId}`, 3600, "1");
      
      // Increment total chats for both users
      await this.incrementTotalChats(chatId);
      await this.incrementTotalChats(partnerId);
      
      this.bot.sendMessage(chatId, enhancedMessages.connected, {
        parse_mode: "Markdown",
        ...keyboards.chatActive
      });
      this.bot.sendMessage(partnerId, enhancedMessages.connected, {
        parse_mode: "Markdown",
        ...keyboards.chatActive
      });
    } else {
      // No valid partner found, add to waiting queue
      await redisClient.lPush("waiting", chatId.toString());
    }
  }
  
  // Increment total chats counter
  async incrementTotalChats(chatId) {
    try {
      const userId = chatId; // Assuming chatId is userId
      await User.increment('totalChats', { where: { userId } });
    } catch (error) {
      console.error('Error incrementing total chats:', error);
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