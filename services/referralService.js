const VipService = require('./vipService');
const Referral = require('../models/referralModel');
const AffiliateReward = require('../models/affiliateRewardModel');
const AffiliateService = require('./affiliateService');

class ReferralService {
  // Track referral
  static async createReferral(inviterId, invitedId) {
    if (inviterId === invitedId) throw new Error('Self-referral not allowed');
    // check if referral exists
    const exists = await Referral.findOne({ where: { inviterId, invitedId } });
    if (exists) return null;
    // Create as pending until invited user completes /start
    return await Referral.create({ inviterId, invitedId, status: 'pending' });
  }

  // Called after a paid action to check rewards
  static async processReferralForPayment(userId, payment, opts = {}) {
    const transaction = opts.transaction;
    // Only consider referrals that were accepted (invited user completed /start)
    const referral = await Referral.findOne({ where: { invitedId: userId, status: 'accepted' }, transaction });
    if (!referral) return [];

    const inviterId = referral.inviterId;
    const postActions = [];

    // 1) Affiliate reward based on paid amount (applies to all paid actions)
    try {
      // For Telegram Stars (XTR), total_amount is in Stars directly (not multiplied by 100)
      const amountStars = (payment && payment.total_amount) ? 
        (payment.currency === 'XTR' ? payment.total_amount : Math.round(payment.total_amount/100)) : 0;
      const vipDays = AffiliateService.convertStarsToVipDays(amountStars);
      if (vipDays > 0) {
        // Record the affiliate reward (auditable)
        await AffiliateReward.create({ userId: inviterId, vipDaysGranted: vipDays, source: 'affiliate_payment' }, { transaction });
        // Apply DB-side VIP (defer Redis set until after commit)
        const expiry = await VipService.activateVip(inviterId, vipDays, { source: 'affiliate', transaction, deferSetRedis: true });
        // Schedule Redis set after transaction commit
        postActions.push(async () => { try { await VipService.setRedisVip(inviterId, expiry); } catch (err) { console.error('Affiliate post-action error:', err); } });
      }
    } catch (err) {
      console.error('Affiliate reward processing error:', err);
      // Do not fail the payment flow due to affiliate bookkeeping
    }

    // 2) Referral milestone grants (every 5 invites => configurable VIP days)
    try {
      const ConfigService = require('./configService');
      // Get referral VIP days from admin config (default 15)
      const referralVipDays = await ConfigService.get('referral_vip_days', 15);
      
      // count real referrals for inviter (unique invitedId)
      const count = await Referral.count({ where: { inviterId, status: 'accepted' }, transaction });
      // For every 5 referrals grant VIP days
      const grants = Math.floor(count / 5);

      // Count how many rewards previously granted (using AffiliateReward as record)
      // Track by counting milestone rewards
      const prevMilestoneRewards = await AffiliateReward.count({ 
        where: { userId: inviterId, source: 'referral_milestone' }, 
        transaction 
      });
      const milestoneGrants = Math.max(0, grants - prevMilestoneRewards);
      if (milestoneGrants > 0) {
        const daysToGrant = milestoneGrants * referralVipDays;
        await AffiliateReward.create({ userId: inviterId, vipDaysGranted: daysToGrant, source: 'referral_milestone' }, { transaction });
        const expiry = await VipService.activateVip(inviterId, daysToGrant, { source: 'referral', transaction, deferSetRedis: true });
        postActions.push(async () => { try { await VipService.setRedisVip(inviterId, expiry); } catch (err) { console.error('Referral milestone post-action error:', err); } });
      }
    } catch (err) {
      console.error('Referral milestone processing error:', err);
    }

    return postActions;
  }

  // Accept any pending referrals when an invited user completes /start
  static async acceptPendingReferrals(invitedId) {
    try {
      const pending = await Referral.findAll({ where: { invitedId, status: 'pending' } });
      if (!pending || pending.length === 0) return 0;
      const logger = require('../utils/logger');
      const { notifyAdmin } = require('../controllers/adminController') || {};
      const config = require('../config/config');
      const { isFeatureEnabled } = require('../config/featureFlags');

      for (const r of pending) {
        try {
          await Referral.update({ status: 'accepted' }, { where: { id: r.id } });
          logger.appendJsonLog('referrals.log', { ts: new Date().toISOString(), referralId: r.id, inviterId: r.inviterId, invitedId: r.invitedId, action: 'accepted' });
          const adminId = config.ADMIN_CONTROL_CHAT_ID || config.ADMIN_CHAT_ID;
          if (adminId && isFeatureEnabled('ENABLE_ADMIN_ALERTS') && notifyAdmin) {
            try {
              await notifyAdmin(`✅ Referral accepted: inviter=${r.inviterId}, invited=${r.invitedId}`);
            } catch (err) {
              console.error('Failed to send referral acceptance notification to admin:', err?.message);
            }
          }
        } catch (err) {
          console.error('Error accepting referral:', err);
        }
      }

      return pending.length;
    } catch (err) {
      console.error('acceptPendingReferrals error:', err);
      return 0;
    }
  }
}

module.exports = ReferralService;
