/**
 * Profile Handlers Module
 * Handles user profile management (gender, age, settings)
 */

const User = require('../../models/userModel');
const keyboards = require('../../utils/keyboards');
const enhancedMessages = require('../../utils/enhancedMessages');
const UserCacheService = require('../../services/userCacheService');
const VipService = require('../../services/vipService');
const stateManager = require('../../utils/stateManager');

class ProfileHandlers {
  constructor(bot, controller) {
    this.bot = bot;
    this.controller = controller;
  }

  /**
   * Handle gender selection
   */
  async handleGenderSelection(msg, gender) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userState = stateManager.getConversationState(userId);

    if (userState !== 'awaiting_gender' && userState !== 'updating_gender') return;

    try {
      await User.update({ gender }, { where: { userId } });
      await UserCacheService.invalidate(userId);

      if (userState === 'awaiting_gender') {
        stateManager.setConversationState(userId, 'awaiting_age');
        this.bot.sendMessage(chatId, enhancedMessages.agePrompt, {
          parse_mode: 'Markdown',
          ...keyboards.removeKeyboard
        });
      } else {
        stateManager.clearConversationState(userId);
        this.bot.sendMessage(chatId, `✅ *Gender updated to ${gender}!*`, {
          parse_mode: 'Markdown',
          ...keyboards.getMainKeyboard()
        });
      }
    } catch (error) {
      console.error('Error updating gender:', error);
    }
  }

  /**
   * Handle age input
   */
  async handleAgeInput(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userState = stateManager.getConversationState(userId);

    if (userState !== 'awaiting_age' && userState !== 'updating_age') return false;

    const age = parseInt(msg.text, 10);

    if (isNaN(age) || age < 13 || age > 99) {
      this.bot.sendMessage(chatId, '❌ Please enter a valid age between 13 and 99.', keyboards.removeKeyboard);
      return true;
    }

    try {
      await User.update({ age }, { where: { userId } });
      await UserCacheService.invalidate(userId);
      stateManager.clearConversationState(userId);

      this.bot.sendMessage(chatId, enhancedMessages.profileComplete, {
        parse_mode: 'Markdown',
        ...keyboards.getMainKeyboard()
      });
    } catch (error) {
      console.error('Error updating age:', error);
    }

    return true;
  }

  /**
   * Handle VIP gender preference selection
   */
  async handleVipGenderPreferenceSelection(msg, gender) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userState = stateManager.getConversationState(userId);

    if (userState !== 'updating_vip_gender') return;

    // Verify VIP status
    if (!(await VipService.isVipActive(userId))) {
      stateManager.clearConversationState(userId);
      return this.bot.sendMessage(chatId, '❌ Your VIP subscription has expired.', {
        parse_mode: 'Markdown',
        ...keyboards.getMainKeyboard()
      });
    }

    try {
      await User.update({ vipGender: gender }, { where: { userId } });
      stateManager.clearConversationState(userId);

      const genderDisplay = gender === 'Any' ? 'Any (no preference)' : gender;
      this.bot.sendMessage(chatId, 
        `✅ *Partner Gender Preference updated to ${genderDisplay}!*\n\n` +
        `You will now be matched with ${genderDisplay === 'Any' ? 'any gender' : gender.toLowerCase()} partners.`, {
        parse_mode: 'Markdown',
        ...keyboards.getMainKeyboard()
      });
    } catch (error) {
      console.error('Error updating VIP gender preference:', error);
      stateManager.clearConversationState(userId);
      this.bot.sendMessage(chatId, '❌ Failed to update preference.', keyboards.getMainKeyboard());
    }
  }

  /**
   * Handle VIP age preference selection
   */
  async handleVipAgePreferenceSelection(msg, minAge, maxAge) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Verify VIP status
    if (!(await VipService.isVipActive(userId))) {
      return this.bot.sendMessage(chatId, '❌ This feature requires VIP subscription.', keyboards.getMainKeyboard());
    }

    try {
      await User.update({ 
        vipAgeMin: minAge, 
        vipAgeMax: maxAge 
      }, { where: { userId } });
      
      await UserCacheService.invalidate(userId);
      stateManager.clearConversationState(userId);

      const rangeText = minAge && maxAge ? `${minAge}-${maxAge} years` : 'Any age';
      this.bot.sendMessage(chatId, 
        `✅ *Partner Age Preference updated to ${rangeText}!*`, {
        parse_mode: 'Markdown',
        ...keyboards.getMainKeyboard()
      });
    } catch (error) {
      console.error('Error updating VIP age preference:', error);
      this.bot.sendMessage(chatId, '❌ Failed to update preference.', keyboards.getMainKeyboard());
    }
  }

  /**
   * Show user profile
   */
  async showUserProfile(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const firstName = msg.from.first_name || '';
    const lastName = msg.from.last_name || '';
    const username = msg.from.username || null;

    try {
      const user = await UserCacheService.getUser(userId);
      const isVip = await VipService.isVipActive(userId);

      const fullName = firstName + (lastName ? ' ' + lastName : '');
      let profileMessage = `👤 *Your Profile*\n\n` +
        `📝 *Name:* ${fullName || 'Not set'}\n` +
        `🔗 *Username:* ${username ? '@' + username : 'Not set'}\n` +
        `🆔 *Telegram ID:* \`${userId}\`\n\n` +
        `👤 *Gender:* ${user?.gender || '❌ Not set'}\n` +
        `🎂 *Age:* ${user?.age || '❌ Not set'}\n` +
        `📅 *Member since:* ${user?.createdAt?.toDateString() || 'Unknown'}\n\n` +
        `🔥 *Daily Streak:* ${user?.dailyStreak || 0} days\n` +
        `💬 *Total Chats:* ${user?.totalChats || 0} conversations\n`;

      if (isVip) {
        profileMessage += `\n⭐ *VIP Status:* Active\n`;
        profileMessage += `👥 *Partner Preference:* ${user?.vipGender || 'Any'}\n`;
        if (user?.vipAgeMin && user?.vipAgeMax) {
          profileMessage += `🎂 *Age Preference:* ${user.vipAgeMin}-${user.vipAgeMax}\n`;
        }
      }

      profileMessage += `\n⚙️ _Use Settings to update your profile_`;

      this.bot.sendMessage(chatId, profileMessage, {
        parse_mode: 'Markdown',
        ...keyboards.getMainKeyboard()
      });
    } catch (error) {
      console.error('Error showing profile:', error);
      this.bot.sendMessage(chatId, '❌ Error loading profile.');
    }
  }

  /**
   * Show user stats
   */
  async showUserStats(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const user = await UserCacheService.getUser(userId);
      
      // Get rating stats
      const ChatRatingService = require('../../services/chatRatingService');
      const ratingStats = await ChatRatingService.getUserRatingStats(userId);

      const statsMessage = `📊 *Your Statistics*\n\n` +
        `👤 Gender: ${user?.gender || 'Not set'}\n` +
        `🎂 Age: ${user?.age || 'Not set'}\n` +
        `📅 Member since: ${user?.createdAt?.toDateString() || 'Unknown'}\n\n` +
        `🔥 Daily Streak: ${user?.dailyStreak || 0} days\n` +
        `💬 Total Chats: ${user?.totalChats || 0} conversations\n\n` +
        `⭐ *Rating Score:* ${ratingStats.score}%\n` +
        `👍 Positive: ${ratingStats.positive} | 👎 Negative: ${ratingStats.negative}\n\n` +
        `🎆 _Keep chatting to increase your stats!_`;

      this.bot.sendMessage(chatId, statsMessage, {
        parse_mode: 'Markdown',
        ...keyboards.getMainKeyboard()
      });
    } catch (error) {
      console.error('Error showing stats:', error);
      this.bot.sendMessage(chatId, '❌ Error loading statistics.');
    }
  }

  /**
   * Show settings menu
   */
  async showSettings(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const isVip = await VipService.isVipActive(userId);
      const user = await UserCacheService.getUser(userId);
      const currentVipPreference = user?.vipGender || 'Any';

      let settingsMessage = `⚙️ *Settings Menu*\n\n` +
        `Update your profile information:\n` +
        `• 👤 Change your gender\n` +
        `• 🎂 Update your age\n`;

      if (isVip) {
        settingsMessage += `• ⭐ Partner Gender Preference: ${currentVipPreference}\n`;
        const ageRange = user?.vipAgeMin && user?.vipAgeMax 
          ? `${user.vipAgeMin}-${user.vipAgeMax}` 
          : 'Any';
        settingsMessage += `• 🎯 Partner Age Preference: ${ageRange}\n`;
      }

      settingsMessage += `• 📊 View your statistics\n\n` +
        `👇 _Choose an option below:_`;

      this.bot.sendMessage(chatId, settingsMessage, {
        parse_mode: 'Markdown',
        ...keyboards.getSettingsKeyboard(isVip)
      });
    } catch (error) {
      console.error('Error showing settings:', error);
      this.bot.sendMessage(chatId, '❌ Error loading settings.');
    }
  }

  /**
   * Start updating gender
   */
  async updateGender(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    stateManager.setConversationState(userId, 'updating_gender');
    this.bot.sendMessage(chatId, enhancedMessages.genderPrompt, {
      parse_mode: 'Markdown',
      ...keyboards.genderSelection
    });
  }

  /**
   * Start updating age
   */
  async updateAge(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    stateManager.setConversationState(userId, 'updating_age');
    this.bot.sendMessage(chatId, enhancedMessages.agePrompt, {
      parse_mode: 'Markdown',
      ...keyboards.removeKeyboard
    });
  }

  /**
   * Start updating VIP gender preference
   */
  async updateVipGenderPreference(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Check VIP status
    if (!(await VipService.isVipActive(userId))) {
      return this.bot.sendMessage(chatId, 
        '⭐ *VIP Feature*\n\n' +
        'Partner gender preference is a VIP-only feature.\n' +
        'Subscribe to VIP to unlock this and other premium features!', {
        parse_mode: 'Markdown',
        ...keyboards.getMainKeyboard()
      });
    }

    stateManager.setConversationState(userId, 'updating_vip_gender');
    this.bot.sendMessage(chatId, 
      '⭐ *Partner Gender Preference*\n\n' +
      'Choose which gender you prefer to be matched with:', {
      parse_mode: 'Markdown',
      ...keyboards.getVipGenderSelection()
    });
  }

  /**
   * Start updating VIP age preference
   */
  async updateVipAgePreference(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Check VIP status
    if (!(await VipService.isVipActive(userId))) {
      return this.bot.sendMessage(chatId, 
        '⭐ *VIP Feature*\n\n' +
        'Partner age preference is a VIP-only feature.\n' +
        'Subscribe to VIP to unlock this and other premium features!', {
        parse_mode: 'Markdown',
        ...keyboards.getMainKeyboard()
      });
    }

    stateManager.setConversationState(userId, 'updating_vip_age');
    this.bot.sendMessage(chatId, 
      '⭐ *Partner Age Preference*\n\n' +
      'Choose your preferred partner age range:', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '18-25', callback_data: 'VIP_AGE:18:25' }, { text: '25-35', callback_data: 'VIP_AGE:25:35' }],
          [{ text: '35-45', callback_data: 'VIP_AGE:35:45' }, { text: '45+', callback_data: 'VIP_AGE:45:99' }],
          [{ text: '🌐 Any Age', callback_data: 'VIP_AGE:0:0' }],
          [{ text: '🔙 Back', callback_data: 'MENU_BACK' }]
        ]
      }
    });
  }
}

module.exports = ProfileHandlers;
