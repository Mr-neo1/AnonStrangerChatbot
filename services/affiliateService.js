const Referral = require('../models/referralModel');
const AffiliateRewardCredit = require('../models/affiliateRewardCreditModel');
const logger = require('../utils/logger');

class AffiliateService {
  // Legacy helper - kept for backwards compatibility
  static convertStarsToVipDays(starsAmount) {
    const base = Math.floor(starsAmount / 10);
    return Math.max(0, Math.floor(base * 0.8));
  }

  // creditAffiliate: inside existing transaction, idempotent. Returns { created: bool, reason }
  static async creditAffiliate(buyerTelegramId, sourcePaymentId, paidStars, paymentType, opts = {}) {
    const transaction = opts.transaction;
    try {
      // Resolve active referral: invitedId === buyerTelegramId and status = 'accepted'
      const referral = await Referral.findOne({ where: { invitedId: buyerTelegramId, status: 'accepted' }, transaction });
      if (!referral) {
        logger.appendJsonLog('affiliate.log', { ts: new Date().toISOString(), action: 'skip_no_referrer', buyerTelegramId, sourcePaymentId, paidStars, paymentType });
        return { created: false, reason: 'no_referrer' };
      }

      const referrerId = referral.inviterId;
      if (referrerId === buyerTelegramId) {
        logger.appendJsonLog('affiliate.log', { ts: new Date().toISOString(), action: 'skip_self_referral', buyerTelegramId, referrerId, sourcePaymentId });
        return { created: false, reason: 'self_referral' };
      }

      // Idempotency: check existing reward for this payment
      const existing = await AffiliateRewardCredit.findOne({ where: { sourcePaymentId }, transaction });
      if (existing) {
        logger.appendJsonLog('affiliate.log', { ts: new Date().toISOString(), action: 'skip_already_exists', buyerTelegramId, referrerId, sourcePaymentId });
        return { created: false, reason: 'already_exists' };
      }

      // Compute affiliateStars and reward depending on paymentType (50% commission)
      const affiliateStars = Math.floor(paidStars * 0.5);
      let rewardType = null;
      let rewardValue = 0;

      if (paymentType === 'VIP') {
        rewardType = 'VIP_DAYS';
        rewardValue = Math.floor(affiliateStars / 10);
      } else if (paymentType === 'LOCK') {
        rewardType = 'LOCK_MINUTES';
        rewardValue = Math.floor(affiliateStars / 3);
      } else {
        logger.appendJsonLog('affiliate.log', { ts: new Date().toISOString(), action: 'skip_unknown_paymentType', buyerTelegramId, sourcePaymentId, paymentType });
        return { created: false, reason: 'unsupported_type' };
      }

      if (!rewardValue || rewardValue <= 0) {
        logger.appendJsonLog('affiliate.log', { ts: new Date().toISOString(), action: 'skip_zero_reward', buyerTelegramId, referrerId, sourcePaymentId, rewardType, rewardValue });
        return { created: false, reason: 'zero_value' };
      }

      // Create AffiliateRewardCredit record inside transaction
      await AffiliateRewardCredit.create({ referrerTelegramId: referrerId, sourcePaymentId: String(sourcePaymentId), rewardType, rewardValue, status: 'AVAILABLE' }, { transaction });

      logger.appendJsonLog('affiliate.log', { ts: new Date().toISOString(), action: 'created', referrerId, buyerTelegramId, sourcePaymentId, rewardType, rewardValue });
      return { created: true, referrerId, rewardType, rewardValue };
    } catch (err) {
      console.error('AffiliateService.creditAffiliate error:', err);
      // Do not throw - payment flow must not fail due to affiliate errors
      logger.appendJsonLog('affiliate.log', { ts: new Date().toISOString(), action: 'error', error: String(err), buyerTelegramId, sourcePaymentId });
      return { created: false, reason: 'error' };
    }
  }
}

module.exports = AffiliateService;