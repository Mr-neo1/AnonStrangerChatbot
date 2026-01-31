/**
 * Help Command Handler
 * Provides comprehensive help information to users
 */

const keyboards = require('../../utils/keyboards');
const VipService = require('../../services/vipService');
const { isFeatureEnabled } = require('../../config/featureFlags');

class HelpHandler {
  constructor(bot) {
    this.bot = bot;
  }

  /**
   * Show comprehensive help menu
   */
  async showHelp(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const isVip = await VipService.isVipActive(userId);

    let helpText = `📖 *Help & Commands*\n\n`;

    // Basic Commands Section
    helpText += `*🔹 Basic Commands:*\n`;
    helpText += `• /start - Start the bot & set up profile\n`;
    helpText += `• /search or 🔍 Find Partner - Find a chat partner\n`;
    helpText += `• /stop or ❌ Stop Chat - End current chat\n`;
    helpText += `• /find or ⏭ Next Partner - Skip to next partner\n`;
    helpText += `• /link - Share your profile with partner\n`;
    helpText += `• /help - Show this help message\n\n`;

    // Profile & Stats Section
    helpText += `*🔹 Profile & Stats:*\n`;
    helpText += `• 👤 My Profile - View your profile\n`;
    helpText += `• 📊 My Stats - View your statistics\n`;
    helpText += `• ⚙️ Settings - Update your profile\n`;
    helpText += `• 🆔 My ID - Get your Telegram ID\n\n`;

    // Chat Features Section
    helpText += `*🔹 Chat Features:*\n`;
    helpText += `• 🔒 Lock Chat - Lock chat (prevents partner from leaving)\n`;
    helpText += `• 📷 Send Media - Photos, videos, voice messages\n`;
    helpText += `• 👍/👎 Rate Partner - After chat ends, rate your partner\n\n`;

    // VIP Features Section
    if (isFeatureEnabled('ENABLE_VIP')) {
      helpText += `*⭐ VIP Features:*\n`;
      if (isVip) {
        helpText += `✅ You have VIP access!\n`;
      } else {
        helpText += `🔒 Subscribe to VIP for:\n`;
      }
      helpText += `• 👥 Choose partner gender preference\n`;
      helpText += `• 🎯 Choose partner age range\n`;
      helpText += `• ⚡ Priority matching queue\n`;
      helpText += `• 🔒 More lock chat credits\n`;
      helpText += `• ⭐ No ads\n\n`;
    }

    // Referral Section
    if (isFeatureEnabled('ENABLE_REFERRALS')) {
      helpText += `*🎁 Referral Program:*\n`;
      helpText += `• Invite friends using your referral link\n`;
      helpText += `• Earn VIP days for each successful referral\n`;
      helpText += `• Every 5 referrals = 15 bonus VIP days\n\n`;
    }

    // Safety Section
    helpText += `*🛡️ Safety & Reporting:*\n`;
    helpText += `• Report inappropriate behavior after chat\n`;
    helpText += `• Block users who violate rules\n`;
    helpText += `• Your identity stays anonymous\n\n`;

    // Rules Section
    helpText += `*📋 Rules:*\n`;
    helpText += `• Be respectful to all users\n`;
    helpText += `• No spam or advertising\n`;
    helpText += `• No inappropriate content to minors\n`;
    helpText += `• Age 13+ required\n\n`;

    helpText += `_Need more help? Contact @YourSupportBot_`;

    await this.bot.sendMessage(chatId, helpText, {
      parse_mode: 'Markdown',
      ...keyboards.getMainKeyboard()
    });
  }

  /**
   * Show VIP-specific help
   */
  async showVipHelp(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const isVip = await VipService.isVipActive(userId);

    let vipHelpText = `⭐ *VIP Features Guide*\n\n`;

    vipHelpText += `*Partner Preferences:*\n`;
    vipHelpText += `As a VIP member, you can choose:\n`;
    vipHelpText += `• 👥 *Gender Preference* - Match with specific gender\n`;
    vipHelpText += `• 🎯 *Age Range* - Match within age range\n\n`;

    vipHelpText += `*How to Set Preferences:*\n`;
    vipHelpText += `1. Go to ⚙️ Settings\n`;
    vipHelpText += `2. Select "Partner Gender Preference"\n`;
    vipHelpText += `3. Choose Male, Female, or Any\n`;
    vipHelpText += `4. For age, select "Partner Age Preference"\n\n`;

    vipHelpText += `*Priority Matching:*\n`;
    vipHelpText += `• VIP users are matched first\n`;
    vipHelpText += `• Shorter wait times\n`;
    vipHelpText += `• Better quality matches\n\n`;

    vipHelpText += `*Lock Chat:*\n`;
    vipHelpText += `• VIP users get 5 locks per hour\n`;
    vipHelpText += `• Free users get 1 lock per hour\n\n`;

    if (!isVip) {
      vipHelpText += `*Get VIP:*\n`;
      vipHelpText += `Use ⭐ Buy Premium in the menu to subscribe!\n`;
    } else {
      vipHelpText += `✅ *You are currently a VIP member!*\n`;
    }

    await this.bot.sendMessage(chatId, vipHelpText, {
      parse_mode: 'Markdown',
      ...keyboards.getMainKeyboard()
    });
  }

  /**
   * Show commands list (for BotFather)
   */
  getCommandsList() {
    return [
      { command: 'start', description: 'Start the bot and set up profile' },
      { command: 'search', description: 'Find a chat partner' },
      { command: 'stop', description: 'End current chat' },
      { command: 'find', description: 'Skip to next partner' },
      { command: 'link', description: 'Share your profile with partner' },
      { command: 'help', description: 'Show help and commands' },
      { command: 'stats', description: 'View your statistics' },
      { command: 'settings', description: 'Update your profile settings' }
    ];
  }
}

module.exports = HelpHandler;
