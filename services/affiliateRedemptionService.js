const AffiliateRewardCredit = require('../models/affiliateRewardCreditModel');
const VipService = require('./vipService');
const LockCredit = require('../models/lockCreditModel');
const { sequelize } = require('../database/connectionPool');
const logger = require('../utils/logger');

class AffiliateRedemptionService {
  // Returns available credits grouped by type (FIFO)
  static async getAvailableCredits(telegramId) {
    const credits = await AffiliateRewardCredit.findAll({ where: { referrerTelegramId: telegramId, status: 'AVAILABLE' }, order: [['createdAt', 'ASC']] });
    // Group by rewardType
    const grouped = credits.reduce((acc, c) => {
      acc[c.rewardType] = acc[c.rewardType] || [];
      acc[c.rewardType].push(c);
      return acc;
    }, {});
    return grouped;
  }

  // Redeem a single credit atomically. Runs inside transaction provided in opts.transaction when possible.
  // Returns { success: bool, reason?: string, rewardType?, rewardValue? }
  static async redeemCredit({ creditId, telegramId }, opts = {}) {
    const externalTransaction = opts.transaction;
    const txProvided = Boolean(externalTransaction);

    const doRedeem = async (t) => {
      // Fetch credit with transaction
      const credit = await AffiliateRewardCredit.findOne({ where: { id: creditId }, transaction: t, lock: t.LOCK ? t.LOCK.UPDATE : undefined });
      if (!credit) {
        logger.appendJsonLog('affiliate_redemptions.log', { ts: new Date().toISOString(), telegramId, creditId, status: 'FAILED', reason: 'not_found' });
        return { success: false, reason: 'not_found' };
      }
      if (String(credit.referrerTelegramId) !== String(telegramId)) {
        logger.appendJsonLog('affiliate_redemptions.log', { ts: new Date().toISOString(), telegramId, creditId, status: 'FAILED', reason: 'not_owner' });
        return { success: false, reason: 'not_owner' };
      }
      if (credit.status !== 'AVAILABLE') {
        logger.appendJsonLog('affiliate_redemptions.log', { ts: new Date().toISOString(), telegramId, creditId, status: 'SKIPPED', reason: 'skip_already_redeemed' });
        return { success: false, reason: 'already_redeemed' };
      }

      // Now perform the action depending on rewardType
      if (credit.rewardType === 'VIP_DAYS') {
        try {
          await VipService.activateVip(telegramId, credit.rewardValue, { transaction: t });
        } catch (err) {
          logger.appendJsonLog('affiliate_redemptions.log', { ts: new Date().toISOString(), telegramId, creditId, status: 'FAILED', reason: 'vip_activation_failed', error: String(err) });
          return { success: false, reason: 'vip_activation_failed' };
        }
      } else if (credit.rewardType === 'LOCK_MINUTES') {
        try {
          // Create a LockCredit record to add minutes to user's balance
          await LockCredit.create({ userId: telegramId, minutes: credit.rewardValue, remainingMinutes: credit.rewardValue, source: 'affiliate_reward' }, { transaction: t });
        } catch (err) {
          logger.appendJsonLog('affiliate_redemptions.log', { ts: new Date().toISOString(), telegramId, creditId, status: 'FAILED', reason: 'lock_credit_failed', error: String(err) });
          return { success: false, reason: 'lock_credit_failed' };
        }
      } else {
        logger.appendJsonLog('affiliate_redemptions.log', { ts: new Date().toISOString(), telegramId, creditId, status: 'FAILED', reason: 'unsupported_reward_type' });
        return { success: false, reason: 'unsupported_reward_type' };
      }

      // Mark credit as redeemed and record metadata if possible
      const updateFields = { status: 'REDEEMED' };
      if (AffiliateRewardCredit.rawAttributes && AffiliateRewardCredit.rawAttributes.redeemedAt) updateFields.redeemedAt = new Date();
      if (AffiliateRewardCredit.rawAttributes && AffiliateRewardCredit.rawAttributes.redeemedByAction) updateFields.redeemedByAction = 'MANUAL';
      await AffiliateRewardCredit.update(updateFields, { where: { id: creditId }, transaction: t });

      logger.appendJsonLog('affiliate_redemptions.log', { ts: new Date().toISOString(), telegramId, creditId, rewardType: credit.rewardType, rewardValue: credit.rewardValue, status: 'SUCCESS' });
      return { success: true, rewardType: credit.rewardType, rewardValue: credit.rewardValue };
    };

    if (txProvided) {
      return doRedeem(externalTransaction);
    }

    // Start our own transaction
    const t = await sequelize.transaction();
    try {
      const res = await doRedeem(t);
      await t.commit();
      return res;
    } catch (err) {
      await t.rollback();
      logger.appendJsonLog('affiliate_redemptions.log', { ts: new Date().toISOString(), telegramId, creditId, status: 'FAILED', reason: 'exception', error: String(err) });
      return { success: false, reason: 'exception' };
    }
  }
}

module.exports = AffiliateRedemptionService;