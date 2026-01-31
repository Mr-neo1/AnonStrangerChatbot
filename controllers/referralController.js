const ReferralService = require('../services/referralService');
const Referral = require('../models/referralModel');
const { isFeatureEnabled } = require('../config/featureFlags');
const ConfigService = require('../services/configService');

class ReferralController {
  constructor(bot) {
    this.bot = bot;
    this.initialize();
  }

  initialize() {
    // /referral or /invite - Show referral link and stats
    this.bot.onText(/^\/(referral|invite)$/i, async (msg) => {
      const userId = msg.from.id;
      const chatId = msg.chat.id;
      
      try {
        // Check if referral system is enabled
        if (!isFeatureEnabled('ENABLE_REFERRALS') && !isFeatureEnabled('ENABLE_AFFILIATE_SYSTEM')) {
          return this.bot.sendMessage(chatId, '❌ Referral system is currently disabled.');
        }
        
        // Get referral VIP days from admin config
        const referralVipDays = await ConfigService.get('referral_vip_days', 15);
        
        // Get bot username for referral link
        const botInfo = await this.bot.getMe();
        const botUsername = botInfo.username;
        
        // Generate referral link with user's ID as start parameter
        const referralLink = `https://t.me/${botUsername}?start=ref_${userId}`;
        
        // Get referral stats
        const totalReferrals = await Referral.count({ 
          where: { inviterId: userId, status: 'accepted' } 
        });
        const pendingReferrals = await Referral.count({ 
          where: { inviterId: userId, status: 'pending' } 
        });
        
        // Calculate rewards earned
        const milestones = Math.floor(totalReferrals / 5);
        const vipDaysEarned = milestones * referralVipDays;
        const nextMilestone = 5 - (totalReferrals % 5);
        
        const message = `🎁 *Your Referral Program*\n\n` +
          `📎 *Your Referral Link:*\n\`${referralLink}\`\n\n` +
          `📊 *Your Stats:*\n` +
          `✅ Successful Referrals: ${totalReferrals}\n` +
          `⏳ Pending Referrals: ${pendingReferrals}\n` +
          `🎯 VIP Days Earned: ${vipDaysEarned}\n\n` +
          `🚀 *How it works:*\n` +
          `• Share your link with friends\n` +
          `• When they join and start chatting, you earn rewards!\n` +
          `• Every 5 referrals = ${referralVipDays} VIP days FREE! 🎉\n\n` +
          `📈 *Next Milestone:* ${nextMilestone} more referral${nextMilestone !== 1 ? 's' : ''} for +${referralVipDays} VIP days!`;
        
        await this.bot.sendMessage(chatId, message, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });
        
      } catch (err) {
        console.error('Error showing referral info:', err);
        this.bot.sendMessage(chatId, '❌ Failed to load referral info. Please try again.');
      }
    });
    
    // /invite <code> - Old format for recording referrals manually
    this.bot.onText(/\/invite (\d+)/, async (msg, match) => {
      const inviterId = msg.from.id;
      const invitedId = match[1];
      try {
        await ReferralService.createReferral(inviterId, invitedId);
        this.bot.sendMessage(inviterId, '✅ Referral recorded and pending — it will be counted once the invited user completes /start');
      } catch (err) {
        this.bot.sendMessage(inviterId, '❌ Could not record referral');
      }
    });
  }
}

module.exports = ReferralController;