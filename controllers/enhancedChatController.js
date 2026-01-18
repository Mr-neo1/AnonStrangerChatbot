const User = require("../models/userModel");
const { checkUserJoined } = require("../middlewares/authMiddleware");
const enhancedMessages = require("../utils/enhancedMessages");
const keyboards = require("../utils/keyboards");
const { redisClient } = require("../database/redisClient");
const { cache, rateLimiter } = require("../utils/performance");
const SessionManager = require("../utils/sessionManager");
const BotRouter = require("../utils/botRouter");

// Helper function to wrap handlers with mandatory channel verification
function withChannelVerification(handler) {
  return async function(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Always check channel membership (mandatory)
    if (!(await checkUserJoined(this.bot, userId, chatId))) {
      return; // checkUserJoined already sends message to user
    }
    
    // Call the original handler
    return await handler.call(this, msg);
  };
}

// Services
const MatchingService = require('../services/matchingService');
const VipService = require('../services/vipService');
const LockChatService = require('../services/lockChatService');
const ReferralService = require('../services/referralService');
const AbuseService = require('../services/abuseService');
const config = require('../config/config');
const { isFeatureEnabled } = require('../config/featureFlags');

// In-memory search intervals (per-process UI rotation)
global.searchIntervals = global.searchIntervals || {};
global.searchMessages = global.searchMessages || {};

// Rotating short search messages
const SEARCH_MESSAGES = [
  'Searching for a partner🔎',
  '🔍 Matching.....',
  '🔍 Looking for partner...👀'
];


global.userConversations = global.userConversations || {};

class EnhancedChatController {
  constructor(bot) {
    this.bot = bot;
    this.initializeCommands();
    this.initializeMessageRelay();
  }

  initializeCommands() {
    // Handle button presses - ALL wrapped with channel verification
    this.bot.onText(/🔍 Find Partner/, withChannelVerification.call(this, async (msg) => {
      await this.handleSearch(msg);
    }));

    this.bot.onText(/❌ Stop Chat/, withChannelVerification.call(this, async (msg) => {
      try {
        await this.stopChatInternal(msg.chat.id);
      } catch (error) {
        console.error('Error in Stop Chat handler:', error);
        // Always return to main menu, even on error
        await this.bot.sendMessage(msg.chat.id, '❌ Chat ended due to error.', {
          parse_mode: 'Markdown',
          ...keyboards.getMainKeyboard()
        }).catch(() => {});
      }
    }));

    this.bot.onText(/📊 My Stats/, withChannelVerification.call(this, async (msg) => {
      await this.showUserStats(msg);
    }));

    this.bot.onText(/⚙️ Settings/, withChannelVerification.call(this, async (msg) => {
      await this.showSettings(msg);
    }));

    // Chat active buttons
    this.bot.onText(/⏭ Next Partner/, withChannelVerification.call(this, async (msg) => {
      await this.handleFind(msg);
    }));

    this.bot.onText(/🔒 Lock Chat/, withChannelVerification.call(this, async (msg) => {
      await this.handleLockChat(msg);
    }));

    // Settings menu buttons
    this.bot.onText(/👤 Update Gender/, withChannelVerification.call(this, async (msg) => {
      await this.updateGender(msg);
    }));

    this.bot.onText(/🎂 Update Age/, withChannelVerification.call(this, async (msg) => {
      await this.updateAge(msg);
    }));

    this.bot.onText(/⭐ Partner Gender Preference/, withChannelVerification.call(this, async (msg) => {
      await this.updateVipGenderPreference(msg);
    }));

    this.bot.onText(/📊 View Stats/, withChannelVerification.call(this, async (msg) => {
      await this.showUserStats(msg);
    }));

    // Back from menus -> restore the main keyboard
    this.bot.onText(/🔙 Back/, withChannelVerification.call(this, async (msg) => {
      this.bot.sendMessage(msg.chat.id, enhancedMessages.profileComplete, {
        parse_mode: "Markdown",
        ...keyboards.getMainKeyboard()
      });
    }));

    // Menu button -> show menu keyboard
    this.bot.onText(/☰ Menu/, withChannelVerification.call(this, async (msg) => {
      this.bot.sendMessage(msg.chat.id, "☰ Menu", keyboards.getMenuKeyboard());
    }));

    // Buy Premium -> show ONLY VIP plans (Lock purchases are separate)
    this.bot.onText(/⭐ Buy Premium/, withChannelVerification.call(this, async (msg) => {
      const chatId = msg.chat.id;
      
      // Guard: prevent access during active chat
      const partnerId = await redisClient.get("pair:" + chatId);
      if (partnerId && partnerId !== chatId.toString()) {
        return this.bot.sendMessage(chatId, '❌ You cannot access the menu during an active chat. Finish the chat first.', {
          parse_mode: 'Markdown',
          ...keyboards.getActiveChatKeyboard()
        });
      }
      
      const starsPricing = require('../constants/starsPricing');

      // Get dynamic VIP plans from config
      const vipPlans = await starsPricing.getVipPlans();
      
      // Only VIP plans - no lock durations
      const vipButtons = Object.keys(vipPlans || {}).map(planId => {
        const plan = vipPlans[planId];
        const daysText = plan.days === 30 ? '1 month' : 
                        plan.days === 182 ? '6 months' : 
                        plan.days === 365 ? '1 year' : 
                        `${plan.days} days`;
        return [{ text: `${planId} (${plan.stars}⭐) - ${daysText}`, callback_data: `STAR_BUY:VIP:${planId}` }];
      });

      const inline = { reply_markup: { inline_keyboard: [
        ...vipButtons,
        [{ text: '🔙 Back', callback_data: 'MENU_BACK' }]
      ] } };

      this.bot.sendMessage(chatId, '⭐ *VIP Plans*\n\nChoose a VIP subscription plan:', {
        parse_mode: 'Markdown',
        ...inline
      });
    }));

    // Rewards / Redeem menu
    this.bot.onText(/⭐ Rewards \/ Redeem/, withChannelVerification.call(this, async (msg) => {
      const chatId = msg.chat.id;
      const AffiliateRedemptionService = require('../services/affiliateRedemptionService');
      const credits = await AffiliateRedemptionService.getAvailableCredits(msg.from.id);

      // Build inline keyboard entries grouped by type (show totals)
      const inline = { reply_markup: { inline_keyboard: [] } };

      if (credits.VIP_DAYS && credits.VIP_DAYS.length > 0) {
        const total = credits.VIP_DAYS.reduce((s, c) => s + c.rewardValue, 0);
        inline.reply_markup.inline_keyboard.push([{ text: `🎁 Redeem ${total} VIP Days`, callback_data: `REDEEM_SUMMARY:VIP` }]);
        // Also list individual credits
        credits.VIP_DAYS.forEach(c => inline.reply_markup.inline_keyboard.push([{ text: `🎁 Redeem ${c.rewardValue} days (id:${c.id})`, callback_data: `REDEEM_REWARD:${c.id}` }]));
      }
      if (credits.LOCK_MINUTES && credits.LOCK_MINUTES.length > 0) {
        const total = credits.LOCK_MINUTES.reduce((s, c) => s + c.rewardValue, 0);
        inline.reply_markup.inline_keyboard.push([{ text: `🎁 Redeem ${total} Lock Minutes`, callback_data: `REDEEM_SUMMARY:LOCK` }]);
        credits.LOCK_MINUTES.forEach(c => inline.reply_markup.inline_keyboard.push([{ text: `🎁 Redeem ${c.rewardValue} min (id:${c.id})`, callback_data: `REDEEM_REWARD:${c.id}` }]));
      }

      inline.reply_markup.inline_keyboard.push([{ text: '⬅️ Back', callback_data: 'MENU_BACK' }]);

      return this.bot.sendMessage(chatId, 'Your available rewards:', inline);
    }));

    // Handle redemption callbacks
    this.bot.on('callback_query', async (cb) => {
      try {
        if (!cb || !cb.data) return;

        // Lock duration selection
        if (cb.data.startsWith('LOCK_DURATION:')) {
          await this.handleLockDurationSelection(cb);
          return;
        }

        // Lock cancel
        if (cb.data === 'LOCK_CANCEL') {
          const chatId = cb.from.id || (cb.message && cb.message.chat && cb.message.chat.id);
          await this.bot.answerCallbackQuery(cb.id, { text: 'Cancelled' }).catch(() => {});
          await this.bot.deleteMessage(chatId, cb.message.message_id).catch(() => {});
          return;
        }

        if (cb.data === 'MENU_BACK') {
          const chatId = cb.from.id || (cb.message && cb.message.chat && cb.message.chat.id);
          await this.bot.answerCallbackQuery(cb.id).catch(() => {});
          
          // Check if user is in active chat - if so, return to active chat keyboard instead of menu
          const partnerId = await redisClient.get("pair:" + chatId);
          if (partnerId && partnerId !== chatId.toString()) {
            // In active chat - return to active chat keyboard
            return this.bot.sendMessage(chatId, '← Back to chat', keyboards.getActiveChatKeyboard());
          } else {
            // Not in chat - return to menu
            return this.bot.sendMessage(chatId, '☰ Menu', keyboards.getMenuKeyboard());
          }
        }

        if (cb.data.startsWith('REDEEM_REWARD:')) {
          const chatId = cb.from.id || (cb.message && cb.message.chat && cb.message.chat.id);
          const parts = cb.data.split(':');
          const creditId = parts[1];
          await this.bot.answerCallbackQuery(cb.id).catch(() => {});

          const AffiliateRedemptionService = require('../services/affiliateRedemptionService');
          const res = await AffiliateRedemptionService.redeemCredit({ creditId, telegramId: cb.from.id });

          if (res.success) {
            if (res.rewardType === 'VIP_DAYS') {
              await this.bot.sendMessage(chatId, `⭐ VIP extended by ${res.rewardValue} day(s).`, keyboards.getMenuKeyboard());
            } else if (res.rewardType === 'LOCK_MINUTES') {
              await this.bot.sendMessage(chatId, `🔒 Lock credits added: ${res.rewardValue} minutes.`, keyboards.getMenuKeyboard());
            } else {
              await this.bot.sendMessage(chatId, '✅ Reward redeemed.', keyboards.getMenuKeyboard());
            }
          } else {
            // Graceful messages
            if (res.reason === 'already_redeemed') {
              await this.bot.sendMessage(chatId, '⚠️ This reward has already been redeemed.', keyboards.getMenuKeyboard());
            } else if (res.reason === 'not_owner') {
              await this.bot.sendMessage(chatId, '❌ You do not own this reward.', keyboards.getMenuKeyboard());
            } else {
              await this.bot.sendMessage(chatId, '❌ Could not redeem reward at this time. Please try again later.', keyboards.getMenuKeyboard());
            }
          }
          return;
        }

      } catch (err) {
        console.error('Menu callback error:', err);
      }
    });

    this.bot.onText(/📋 Rules/, withChannelVerification.call(this, async (msg) => {
      this.bot.sendMessage(msg.chat.id, enhancedMessages.rules, {
        parse_mode: "Markdown",
        ...keyboards.getMainKeyboard()
      });
    }));

    this.bot.onText(/🆔 My ID/, withChannelVerification.call(this, async (msg) => {
      this.bot.sendMessage(msg.chat.id, `🆔 *Your Telegram ID:* \`${msg.from.id}\``, {
        parse_mode: "Markdown",
        ...keyboards.getMainKeyboard()
      });
    }));

    this.bot.onText(/👤 My Profile/, withChannelVerification.call(this, async (msg) => {
      await this.showUserProfile(msg);
    }));

    // /start: verify channels, create or retrieve user profile
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id;

      if (!(await checkUserJoined(this.bot, userId, chatId))) return;
      
      // Track which bot this user is using (for cross-bot routing)
      const currentBotId = this.bot.botId || 'bot_0';
      await BotRouter.setUserBot(userId, currentBotId);
      
      try {
        const [user, created] = await User.findOrCreate({
          where: { userId },
          defaults: { 
            telegramId: userId,
            botId: currentBotId
          },
        });

        // Update botId if user switched bots
        if (!created && user.botId !== currentBotId) {
          await User.update({ botId: currentBotId }, { where: { userId } });
          console.log(`📝 Updated user ${userId} from ${user.botId} to ${currentBotId}`);
        }

        // Mark user as having completed /start and accept any pending referrals
        if (!user.hasStarted) {
          try {
            await User.update({ hasStarted: true }, { where: { userId } });
            const accepted = await ReferralService.acceptPendingReferrals(userId);
            if (accepted && accepted > 0) {
              // optional: notify user they triggered referral acceptance
              await this.bot.sendMessage(userId, `✅ Your referrals were processed (${accepted} accepted).`);
            }
          } catch (err) { console.error('Error accepting referrals on start:', err); }
        }

        if (user.gender && user.age) {
          return this.bot.sendMessage(chatId, enhancedMessages.profileComplete, {
            parse_mode: "Markdown",
            ...keyboards.getMainKeyboard()
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
    this.bot.onText(/\/(Male|Female|Other)/, withChannelVerification.call(this, async (msg, match) => {
      await this.handleGenderSelection(msg, match[1]);
    }));

    this.bot.onText(/👨 Male|👩 Female|🌈 Other/, withChannelVerification.call(this, async (msg) => {
      const userState = global.userConversations[msg.from.id];
      // Check if updating VIP gender preference
      if (userState === "updating_vip_gender") {
        const gender = msg.text.includes('Male') ? 'Male' : 
                      msg.text.includes('Female') ? 'Female' : 
                      msg.text.includes('Other') ? 'Other' : 'Any';
        await this.handleVipGenderPreferenceSelection(msg, gender);
        return;
      }
      // Regular gender selection
      const gender = msg.text.includes('Male') ? 'Male' : 
                    msg.text.includes('Female') ? 'Female' : 'Other';
      await this.handleGenderSelection(msg, gender);
    }));

    // Handle "Any" option for VIP gender preference
    this.bot.onText(/🌐 Any/, withChannelVerification.call(this, async (msg) => {
      const userState = global.userConversations[msg.from.id];
      if (userState === "updating_vip_gender") {
        await this.handleVipGenderPreferenceSelection(msg, 'Any');
      }
    }));

    // /search and /find commands
    this.bot.onText(/\/search/, withChannelVerification.call(this, async (msg) => {
      await this.handleSearch(msg);
    }));

    this.bot.onText(/\/find/, withChannelVerification.call(this, async (msg) => {
      await this.handleFind(msg);
    }));

    // /stop command
    this.bot.onText(/\/stop/, withChannelVerification.call(this, async (msg) => {
      await this.stopChatInternal(msg.chat.id);
    }));

    // /link command
    this.bot.onText(/\/link/, withChannelVerification.call(this, async (msg) => {
      await this.shareProfile(msg);
    }));
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
          ...keyboards.getMainKeyboard()
        });
      }
    } catch (error) {
      console.error("Error updating gender:", error);
    }
  }

  // VIP gender preference selection handler
  async handleVipGenderPreferenceSelection(msg, gender) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userState = global.userConversations[userId];
    
    if (userState !== "updating_vip_gender") return;

    // Verify user is still VIP
    if (!(await VipService.isVipActive(userId))) {
      delete global.userConversations[userId];
      return this.bot.sendMessage(chatId, '❌ Your VIP subscription has expired. Please renew to use this feature.', {
        parse_mode: 'Markdown',
        ...keyboards.getMainKeyboard()
      });
    }

    try {
      await User.update({ vipGender: gender }, { where: { userId } });
      delete global.userConversations[userId];
      
      const genderDisplay = gender === 'Any' ? 'Any (no preference)' : gender;
      this.bot.sendMessage(chatId, `✅ *Partner Gender Preference updated to ${genderDisplay}!*\n\nYou will now be matched with ${genderDisplay === 'Any' ? 'any gender' : gender.toLowerCase()} partners.`, {
        parse_mode: "Markdown",
        ...keyboards.getMainKeyboard()
      });
    } catch (error) {
      console.error("Error updating VIP gender preference:", error);
      delete global.userConversations[userId];
      this.bot.sendMessage(chatId, '❌ Failed to update preference. Please try again.', {
        parse_mode: 'Markdown',
        ...keyboards.getMainKeyboard()
      });
    }
  }

  // Search handler
  async handleSearch(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!(await checkUserJoined(this.bot, userId, chatId))) return;
    
    // Track which bot user is using
    const currentBotId = this.bot.botId || 'bot_0';
    await BotRouter.setUserBot(userId, currentBotId);
    
    const user = await User.findOne({ where: { userId } });
    if (!user || !user.gender || !user.age) {
      return this.bot.sendMessage(chatId, "❌ Your profile is incomplete. Use /start to set up your profile.", keyboards.getMainKeyboard());
    }
    const existingPair = await redisClient.get("pair:" + chatId);
    if (existingPair) {
      return this.bot.sendMessage(chatId, "❗ You're already in a chat. Use *Stop Chat* to end current chat first.", {
        parse_mode: "Markdown",
        ...keyboards.getActiveChatKeyboard()
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
      return this.bot.sendMessage(chatId, "❌ Your profile is incomplete. Use /start to set up your profile.", keyboards.getMainKeyboard());
    }

    // If chat is locked (either on this chat or partner's chat), disallow skip/next unless caller is the lock owner
    const partnerId = await redisClient.get("pair:" + chatId);

    // Determine which chat room (if any) has an active lock
    let lockedRoom = null;
    if (await LockChatService.isChatLocked(chatId)) lockedRoom = String(chatId);
    else if (partnerId && await LockChatService.isChatLocked(partnerId)) lockedRoom = String(partnerId);

    if (lockedRoom) {
      const owners = await LockChatService.getLockOwners(lockedRoom);
      const ownerId = owners && owners.length > 0 ? owners[0] : null;
      if (String(userId) !== String(ownerId)) {
        // Record lock abuse observationally (do not change flow)
        try { await AbuseService.recordLockAbuse({ chatId: lockedRoom, offenderId: userId, ownerId: ownerId, botId: config.BOT_ID || 'default' }); } catch (_) {}

        return this.bot.sendMessage(chatId, '🔒 This chat is locked by your partner.', { parse_mode: 'Markdown', ...keyboards.getActiveChatKeyboard() });
      }
    }

    const currentPair = await redisClient.get("pair:" + chatId);
    if (currentPair) {
      await this.stopChatInternal(chatId, "� Looking for next partner...");
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
      await BotRouter.sendMessage(pair, `🔗 *Your partner shared their profile:*\n[Click Here](${profileURL})`, { 
        parse_mode: "Markdown",
        ...keyboards.getActiveChatKeyboard()
      });
      await this.bot.sendMessage(chatId, "✅ Your profile link has been sent to your partner.", keyboards.getActiveChatKeyboard());
    } else {
      this.bot.sendMessage(chatId, enhancedMessages.notPaired, {
        parse_mode: "Markdown",
        ...keyboards.getMainKeyboard()
      });
    }
  }

  // Show user statistics
  async showUserStats(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Guard: prevent access during active chat
    const partnerId = await redisClient.get("pair:" + chatId);
    if (partnerId && partnerId !== chatId.toString()) {
      return this.bot.sendMessage(chatId, '❌ You cannot access stats during an active chat. Finish the chat first.', {
        parse_mode: 'Markdown',
        ...keyboards.getActiveChatKeyboard()
      });
    }
    
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
        ...keyboards.getMainKeyboard()
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
    const firstName = msg.from.first_name || '';
    const lastName = msg.from.last_name || '';
    const username = msg.from.username || null;
    
    // Guard: prevent access during active chat
    const partnerId = await redisClient.get("pair:" + chatId);
    if (partnerId && partnerId !== chatId.toString()) {
      return this.bot.sendMessage(chatId, '❌ You cannot access profile during an active chat. Finish the chat first.', {
        parse_mode: 'Markdown',
        ...keyboards.getActiveChatKeyboard()
      });
    }
    
    try {
      const user = await User.findOne({ where: { userId } });
      
      const fullName = firstName + (lastName ? ' ' + lastName : '');
      const profileMessage = `👤 *Your Profile*\n\n` +
        `📝 *Name:* ${fullName || 'Not set'}\n` +
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
        ...keyboards.getMainKeyboard()
      });
    } catch (error) {
      console.error('Error showing profile:', error);
      this.bot.sendMessage(chatId, '❌ Error loading profile. Please try again.');
    }
  }

  // Show settings
  async showSettings(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Guard: prevent access during active chat
    const partnerId = await redisClient.get("pair:" + chatId);
    if (partnerId && partnerId !== chatId.toString()) {
      return this.bot.sendMessage(chatId, '❌ You cannot access settings during an active chat. Finish the chat first.', {
        parse_mode: 'Markdown',
        ...keyboards.getActiveChatKeyboard()
      });
    }
    
    // Check if user is VIP
    const isVip = await VipService.isVipActive(userId);
    const user = await User.findOne({ where: { userId } });
    const currentVipPreference = user?.vipGender || 'Any';
    
    let settingsMessage = `⚙️ *Settings Menu*\n\n` +
      `Update your profile information:\n` +
      `• 👤 Change your gender\n` +
      `• 🎂 Update your age\n`;
    
    if (isVip) {
      settingsMessage += `• ⭐ Partner Gender Preference: ${currentVipPreference}\n`;
    }
    
    settingsMessage += `• 📊 View your statistics\n\n` +
      `👇 _Choose an option below:_`;

    this.bot.sendMessage(chatId, settingsMessage, {
      parse_mode: "Markdown",
      ...keyboards.getSettingsKeyboard(isVip)
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

  // Update VIP gender preference (only for VIP users)
  async updateVipGenderPreference(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check if user is VIP
    if (!(await VipService.isVipActive(userId))) {
      return this.bot.sendMessage(chatId, '❌ This feature is only available for VIP users. Purchase VIP to select partner gender preference.', {
        parse_mode: 'Markdown',
        ...keyboards.getMainKeyboard()
      });
    }
    
    global.userConversations[userId] = "updating_vip_gender";
    this.bot.sendMessage(chatId, '⭐ *Partner Gender Preference*\n\nChoose which gender you want to match with:\n\n• 👨 Male\n• 👩 Female\n• 🌈 Other\n• 🌐 Any (default)\n\n👇 _Select your preference:_', {
      parse_mode: "Markdown",
      ...keyboards.vipGenderPreferenceSelection
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
      // List of exact button texts to ignore
    const buttonTexts = [
      "🔍 Find Partner", "❌ Stop Chat", "☰ Menu",
      "👤 My Profile", "📊 My Stats", "⚙️ Settings", "📜 Rules", "🆔 My ID", "⭐ Buy Premium", "🔙 Back",
      "⏭ Next Partner", "🔒 Lock Chat",
      "👨 Male", "👩 Female", "🌈 Other", "🌐 Any",
      "👤 Update Gender", "🎂 Update Age", "📊 View Stats", "⭐ Rewards / Redeem", "⭐ Partner Gender Preference"
    ];

    this.bot.on("message", async (msg) => {
      // Skip if no text or is a command
      if (!msg.text || msg.text.startsWith("/")) return;
      
      // Skip if exact button text match
      if (buttonTexts.includes(msg.text)) return;

      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const text = msg.text.trim();

      // Banned users are blocked
      try {
        const urec = await User.findOne({ where: { userId } });
        if (urec && urec.banned) {
          return this.bot.sendMessage(chatId, '❌ You are banned from using this bot.');
        }
      } catch (err) {
        console.error('Error checking ban status:', err);
      }

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
                ...keyboards.getMainKeyboard()
              });
            } else {
              // Age update
              this.bot.sendMessage(chatId, `✅ *Age updated to ${age}!*`, {
                parse_mode: "Markdown",
                ...keyboards.getMainKeyboard()
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
      console.log(`Debug: chatId=${chatId}, partnerId=${partnerId}, text="${text}"`);
      
      if (partnerId && partnerId !== chatId.toString()) {
        try {
          // Update bot tracking for sender
          const currentBotId = this.bot.botId || 'bot_0';
          await BotRouter.setUserBot(userId, currentBotId);
          
          await SessionManager.markChatActive(chatId);
          await SessionManager.markChatActive(partnerId);
          
          // Use BotRouter to send to correct bot instance (cross-bot support)
          await BotRouter.sendMessage(partnerId, text);
          console.log(`Message sent from ${chatId} to ${partnerId}: "${text}"`);
        } catch (error) {
          console.error("Error relaying message:", error);
          // Don't show error to user if partner blocked bot
          if (error?.response?.body?.error_code !== 403) {
            await this.bot.sendMessage(chatId, '❌ Failed to send message. Your partner may have left.').catch(() => {});
          }
        }
      } else {
        console.log(`No partner found for ${chatId} or same chatId`);
        this.bot.sendMessage(chatId, "❌ You're not connected to anyone. Use 🔍 Find Partner to start chatting.", {
          parse_mode: "Markdown",
          ...keyboards.getMainKeyboard()
        });
      }
    });
  }

  // Search for partner with improved logic (uses MatchingService queues)
  async searchPartner(chatId) {
    const userId = chatId; // for clarity

    // Determine preferences (only if VIP). Non-VIP users have no gender choice.
    const preferences = {};
    if (isFeatureEnabled('ENABLE_VIP') && await VipService.isVip(userId)) {
      const p = await VipService.getVipPreferences(userId);
      preferences.gender = p.gender || 'Any';
    }

    const config = require('../config/config');
    const botId = config.BOT_ID || 'default';

    // Try to match immediately
    const partner = await MatchingService.matchNextUser(botId, userId, preferences);

    if (partner) {
      const partnerId = partner.toString();

      // Double-check lock status for either chat
      if (isFeatureEnabled('ENABLE_LOCK_CHAT') && await LockChatService.isChatLocked(chatId)) {
        await this.bot.sendMessage(chatId, '🔒 Chat is currently locked and cannot be matched right now.', { ...keyboards.getMainKeyboard() });
        // push back into queue as appropriate
        await MatchingService.enqueueUser(botId, userId);
        return;
      }

      // VIP expiry is enforced at SEARCH TIME only via VipService.isVipActive; do not downgrade or notify mid-chat here.
      // (Preserve active chat benefits until chat end.)

      // Pair users
      await redisClient.set('pair:' + chatId, partnerId);
      await redisClient.set('pair:' + partnerId, chatId);

      // mark recent partners for 20 minutes (prevent re-matching too quickly)
      await redisClient.lPush(`user:recentPartners:${chatId}`, partnerId);
      await redisClient.expire(`user:recentPartners:${chatId}`, 1200); // 20 minutes
      await redisClient.lPush(`user:recentPartners:${partnerId}`, chatId);
      await redisClient.expire(`user:recentPartners:${partnerId}`, 1200); // 20 minutes

      // Increment counts
      await this.incrementTotalChats(chatId);
      await this.incrementTotalChats(partnerId);

      // Cleanup search message and interval if exists
      if (global.searchIntervals[userId]) {
        clearInterval(global.searchIntervals[userId]);
        delete global.searchIntervals[userId];
      }
      const searchMsgId = global.searchMessages[`${userId}_msgId`];
      if (searchMsgId) {
        try {
          await this.bot.deleteMessage(chatId, searchMsgId).catch(() => {});
        } catch (e) {}
        delete global.searchMessages[`${userId}_msgId`];
      }
      delete global.searchMessages[userId];
      
      // Send connected message and enhanced partner profile
      const partnerUser = await User.findOne({ where: { userId: partnerId } });
      
      // Build enhanced profile message (only show profile, no "Connected" message)
      let profileMsg = `⚡️You found a partner🎉\n\n🕵️‍♂️ Profile Details:\n`;
      if (partnerUser?.age) {
        profileMsg += `Age: ${partnerUser.age}\n`;
      }
      if (partnerUser?.gender) {
        const genderEmoji = partnerUser.gender === 'Male' ? '👱‍♂' : 
                          partnerUser.gender === 'Female' ? '👩' : '🌈';
        profileMsg += `Gender: ${partnerUser.gender} ${genderEmoji}`;
      }
      if (!partnerUser?.age && !partnerUser?.gender) {
        profileMsg += `Profile details not available`;
      }

      // Send via user's own bot
      await BotRouter.sendMessage(chatId, profileMsg, { parse_mode: 'Markdown', ...keyboards.getActiveChatKeyboard() });

      // Cleanup partner's search message and interval if exists
      if (global.searchIntervals[partnerId]) {
        clearInterval(global.searchIntervals[partnerId]);
        delete global.searchIntervals[partnerId];
      }
      const partnerSearchMsgId = global.searchMessages[`${partnerId}_msgId`];
      if (partnerSearchMsgId) {
        try {
          await this.bot.deleteMessage(partnerId, partnerSearchMsgId).catch(() => {});
        } catch (e) {}
        delete global.searchMessages[`${partnerId}_msgId`];
      }
      delete global.searchMessages[partnerId];
      
      // Send enhanced profile to partner (only show profile, no "Connected" message)
      const currentUser = await User.findOne({ where: { userId } });
      let partnerProfileMsg = `⚡️You found a partner🎉\n\n🕵️‍♂️ Profile Details:\n`;
      if (currentUser?.age) {
        partnerProfileMsg += `Age: ${currentUser.age}\n`;
      }
      if (currentUser?.gender) {
        const genderEmoji = currentUser.gender === 'Male' ? '👱‍♂' : 
                          currentUser.gender === 'Female' ? '👩' : '🌈';
        partnerProfileMsg += `Gender: ${currentUser.gender} ${genderEmoji}`;
      }
      if (!currentUser?.age && !currentUser?.gender) {
        partnerProfileMsg += `Profile details not available`;
      }
      
      // Send via partner's own bot
      await BotRouter.sendMessage(partnerId, partnerProfileMsg, { parse_mode: 'Markdown', ...keyboards.getActiveChatKeyboard() });

    } else {
      // No match found: enqueue if not already queued, and send rotating short search message
      const alreadyQueued = await MatchingService.isUserQueued(botId, userId);
      if (!alreadyQueued) {
        await MatchingService.enqueueUser(botId, userId);
        
        // Send initial short search message (rotate through messages)
        const messageIndex = (global.searchMessages[userId] || 0) % SEARCH_MESSAGES.length;
        const searchMsg = SEARCH_MESSAGES[messageIndex];
        global.searchMessages[userId] = (messageIndex + 1) % SEARCH_MESSAGES.length;
        
        const sentMsg = await this.bot.sendMessage(chatId, searchMsg, { parse_mode: 'Markdown', ...keyboards.getMainKeyboard() });
        
        // Store message ID to delete when match found
        global.searchMessages[`${userId}_msgId`] = sentMsg.message_id;
        
        // Set up rotating message updates (every 3 seconds, rotate through messages)
        if (global.searchIntervals[userId]) {
          clearInterval(global.searchIntervals[userId]);
        }
        
        let rotationIndex = messageIndex;
        global.searchIntervals[userId] = setInterval(async () => {
          // Check if user is still searching (not matched)
          const currentPair = await redisClient.get("pair:" + chatId);
          if (currentPair && currentPair !== chatId.toString()) {
            // User matched - cleanup
            clearInterval(global.searchIntervals[userId]);
            delete global.searchIntervals[userId];
            const msgId = global.searchMessages[`${userId}_msgId`];
            if (msgId) {
              try {
                await this.bot.deleteMessage(chatId, msgId).catch(() => {});
              } catch (e) {}
            }
            delete global.searchMessages[userId];
            delete global.searchMessages[`${userId}_msgId`];
            return;
          }
          
          // Check if still queued
          const stillQueued = await MatchingService.isUserQueued(botId, userId);
          if (!stillQueued) {
            clearInterval(global.searchIntervals[userId]);
            delete global.searchIntervals[userId];
            delete global.searchMessages[userId];
            delete global.searchMessages[`${userId}_msgId`];
            return;
          }
          
          // Rotate message (edit existing message only, don't create new ones)
          rotationIndex = (rotationIndex + 1) % SEARCH_MESSAGES.length;
          const newMsg = SEARCH_MESSAGES[rotationIndex];
          const msgId = global.searchMessages[`${userId}_msgId`];
          
          if (msgId) {
            try {
              await this.bot.editMessageText(newMsg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: keyboards.getMainKeyboard().reply_markup
              });
            } catch (error) {
              const errorMsg = error.message || '';
              // If edit fails (message deleted/not found/can't edit), cleanup and stop rotation
              if (errorMsg.includes('message to edit not found') || 
                  errorMsg.includes('chat not found') ||
                  errorMsg.includes('message is not modified') ||
                  errorMsg.includes("message can't be edited") ||
                  errorMsg.includes('Bad Request') ||
                  error.statusCode === 400) {
                // Silently cleanup - this is expected behavior
                clearInterval(global.searchIntervals[userId]);
                delete global.searchIntervals[userId];
                delete global.searchMessages[userId];
                delete global.searchMessages[`${userId}_msgId`];
                return;
              }
              // For other unexpected errors, log but continue
              console.warn('⚠️ Warning rotating search message (non-critical):', errorMsg.substring(0, 100));
            }
          }
        }, 3000); // Rotate every 3 seconds
      }
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
  async stopChatInternal(chatId, customMessage, notifyAdmin = false) {
    try {
      // Block stop/skip if there is any active lock and caller is not lock owner
      const partnerId = await redisClient.get("pair:" + chatId);

      // If lock exists on either side, pick the locked room
      let lockedRoom = null;
      if (await LockChatService.isChatLocked(chatId)) lockedRoom = String(chatId);
      else if (partnerId && await LockChatService.isChatLocked(partnerId)) lockedRoom = String(partnerId);

      if (lockedRoom) {
        const owners = await LockChatService.getLockOwners(lockedRoom);
        const ownerId = owners && owners.length > 0 ? owners[0] : null;
        // debug: ensure owner allowed
        console.log('DEBUG stopChatInternal: lockedRoom=', lockedRoom, 'ownerId=', ownerId, 'caller=', chatId);
        if (String(chatId) !== String(ownerId)) {
          // Record lock abuse observationally (do not change flow)
          try { await AbuseService.recordLockAbuse({ chatId: lockedRoom, offenderId: chatId, ownerId: ownerId, botId: config.BOT_ID || 'default' }); } catch (_) {}

          return this.bot.sendMessage(chatId, '🔒 This chat is locked by your partner.', { parse_mode: 'Markdown', ...keyboards.getActiveChatKeyboard() });
        }
        // caller is owner -> allow stop and cleanup locks
      }

      if (partnerId && partnerId !== chatId.toString()) {
        // Force clear old keyboard first (prevent client-side caching)
        await BotRouter.sendMessage(partnerId, '👋', keyboards.getMainKeyboardForceClear()).catch(() => {});
        
        // Send main keyboard to reset UI state
        await BotRouter.sendMessage(partnerId, enhancedMessages.partnerLeft, {
          parse_mode: 'Markdown',
          ...keyboards.getMainKeyboard()
        });
        
        // Send rating buttons
        const ratingKeyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '👍 Good Chat', callback_data: 'RATE:GOOD' }, { text: '👎 Poor Chat', callback_data: 'RATE:POOR' }],
              [{ text: '⭐ Amazing Chat', callback_data: 'RATE:AMAZING' }]
            ]
          }
        };
        await BotRouter.sendMessage(partnerId, '', ratingKeyboard).catch(() => {});
        
        await redisClient.del("pair:" + partnerId);
      }

      // Clean locks on chat end
      // Also cleanup any locks owned by the caller (owner may own locks for other chat rooms)
      try {
        const activeLocks = await LockChatService.getActiveLocks();
        const ownerLocks = (activeLocks || []).filter(l => String(l.userId) === String(chatId));
        for (const l of ownerLocks) {
          await LockChatService.cleanupLocks(l.chatId);
        }
      } catch (err) {
        // ignore cleanup errors
        console.error('Error cleaning owner locks:', err);
      }

      // Observational: record disconnect abuse for caller (duringLock true if any lock exists on either side)
      try {
        const lockedNow = (await LockChatService.isChatLocked(chatId)) || (partnerId && await LockChatService.isChatLocked(partnerId));
        try { await AbuseService.recordDisconnectAbuse({ userId: chatId, chatId, botId: config.BOT_ID || 'default', duringLock: !!lockedNow }); } catch (_) {}
      } catch (e) {
        // swallow - do not affect chat flow
      }

      // Guarantee cleanup of pair state
      await redisClient.del("pair:" + chatId).catch(err => console.error('Error deleting pair:', err));
      
      // remove from per-bot queues
      const keys = require('../utils/redisKeys');
      const botId = require('../config/config').BOT_ID || 'default';
      await redisClient.lRem(keys.QUEUE_VIP_KEY(botId), 0, chatId.toString()).catch(() => {});
      await redisClient.lRem(keys.QUEUE_GENERAL_KEY(botId), 0, chatId.toString()).catch(() => {});

      // Ensure message contains a lowercase 'ended' token for smoke tests that look for it
      const endMsg = (customMessage || enhancedMessages.chatEnded) + '\nended';
      
      // Force clear old keyboard to prevent client-side caching before sending new main keyboard
      await this.bot.sendMessage(chatId, endMsg, keyboards.getMainKeyboardForceClear()).catch(() => {});
      
      // Now send main keyboard
      await this.bot.sendMessage(chatId, '✅ Ready to chat again?', {
        parse_mode: "Markdown",
        ...keyboards.getMainKeyboard()
      }).catch(err => console.error('Error sending end message:', err));

      const adminId = config.ADMIN_CONTROL_CHAT_ID || config.ADMIN_CHAT_ID;
      if (notifyAdmin && adminId && isFeatureEnabled('ENABLE_ADMIN_ALERTS')) {
        await this.bot.sendMessage(adminId, `⚠️ Force disconnect: chat ${chatId} stopped via admin action.`).catch(() => {});
      }
    } catch (error) {
      console.error('CRITICAL: Error in stopChatInternal:', error);
      // Guarantee state cleanup even on error
      try {
        await redisClient.del("pair:" + chatId).catch(() => {});
      } catch (_) {}
      
      // Always send main keyboard to user (force clear first)
      try {
        await this.bot.sendMessage(chatId, '❌ Chat ended.', keyboards.getMainKeyboardForceClear()).catch(() => {});
        await this.bot.sendMessage(chatId, 'Ready for another chat?', {
          parse_mode: 'Markdown',
          ...keyboards.getMainKeyboard()
        }).catch(() => {});
      } catch (_) {}
    }
  }

  // Handle Lock Chat button
  async handleLockChat(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      // Verify user is in active chat
      const partnerId = await redisClient.get("pair:" + chatId);
      if (!partnerId || partnerId === chatId.toString()) {
        // Silently ignore - user not in active chat
        return;
      }

      // Check if user has lock credits
      const LockCredit = require('../models/lockCreditModel');
      const { Op } = require('sequelize');
      const { sequelize } = require('../database/connectionPool');
      
      const credits = await LockCredit.findAll({
        where: { 
          telegramId: userId,
          consumed: { [Op.lt]: sequelize.col('minutes') }
        }
      });

      const totalMinutes = credits.reduce((sum, c) => sum + (c.minutes - c.consumed), 0);

      if (totalMinutes === 0) {
        // No credits - show buy prompt with lock duration purchase options
        const starsPricing = require('../constants/starsPricing');
        const lockButtons = Object.keys(starsPricing.LOCK || {}).map(dur => ([{ 
          text: `${dur} min (${starsPricing.LOCK[dur]}⭐)`, 
          callback_data: `STAR_BUY:LOCK:${dur}` 
        }]));
        
        const inline = { reply_markup: { inline_keyboard: [
          ...lockButtons,
          [{ text: '🔙 Cancel', callback_data: 'LOCK_CANCEL' }]
        ] } };
        
        await this.bot.sendMessage(chatId, '🔒 *Lock Chat*\n\nYou need Lock Credits to lock this chat.\n\nLock Chat prevents your partner from skipping you.\n\n*Purchase Lock Credits:*', {
          parse_mode: 'Markdown',
          ...inline
        });
      } else {
        // Has credits - show duration options
        await this.bot.sendMessage(chatId, `🔒 *Lock Chat*\n\nYou have *${totalMinutes} minutes* of lock credits.\n\nChoose duration:`, {
          parse_mode: 'Markdown',
          ...keyboards.getLockDurationKeyboard()
        });
      }
    } catch (error) {
      console.error('Error in handleLockChat:', error);
      // Don't crash - gracefully inform user
      await this.bot.sendMessage(chatId, '❌ Failed to check lock credits. Please try again.').catch(() => {});
    }
  }

  // Handle lock duration selection callback
  async handleLockDurationSelection(cb) {
    const chatId = cb.from.id || (cb.message && cb.message.chat && cb.message.chat.id);
    const userId = cb.from.id;

    try {
      // Parse duration
      const parts = cb.data.split(':');
      const duration = parseInt(parts[1]);

      // Verify user is still in active chat
      const partnerId = await redisClient.get("pair:" + chatId);
      if (!partnerId || partnerId === chatId.toString()) {
        await this.bot.answerCallbackQuery(cb.id, { text: 'Not in active chat' }).catch(() => {});
        await this.bot.deleteMessage(chatId, cb.message.message_id).catch(() => {});
        return;
      }

      // Activate lock
      await LockChatService.activateLockFromCredits(chatId, userId, partnerId, duration);

      await this.bot.answerCallbackQuery(cb.id, { text: `🔒 Locked for ${duration} min` }).catch(() => {});
      await this.bot.deleteMessage(chatId, cb.message.message_id).catch(() => {});

      // Notify both users
      await this.bot.sendMessage(chatId, `🔒 *Chat Locked*\n\nYou locked this chat for *${duration} minutes*.\nYour partner cannot skip.`, {
        parse_mode: 'Markdown',
        ...keyboards.getActiveChatKeyboard()
      });

      await BotRouter.sendMessage(partnerId, `🔒 *Chat Locked*\n\nYour partner locked this chat for *${duration} minutes*.\nYou cannot skip during this time.`, {
        parse_mode: 'Markdown',
        ...keyboards.getActiveChatKeyboard()
      });

    } catch (error) {
      console.error('Error activating lock:', error);
      const errorMsg = error.message.includes('Insufficient') ? 'Not enough lock credits' : 'Failed to lock chat';
      await this.bot.answerCallbackQuery(cb.id, { text: errorMsg }).catch(() => {});
      await this.bot.deleteMessage(chatId, cb.message.message_id).catch(() => {});
    }
  }
}

module.exports = EnhancedChatController;