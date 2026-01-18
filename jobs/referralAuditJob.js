const Referral = require('../models/referralModel');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { notifyAdmin } = require('../controllers/adminController') || {};
const config = require('../config/config');
const { isFeatureEnabled } = require('../config/featureFlags');

// Mark referrals that are still pending after thresholdDays as invalid
async function auditReferrals(thresholdDays = 7) {
  try {
    const cutoff = new Date(Date.now() - thresholdDays * 24 * 3600 * 1000);
    const stale = await Referral.findAll({ where: { status: 'pending', createdAt: { [Op.lt]: cutoff } } });
    if (!stale || stale.length === 0) return { updated: 0 };

    for (const r of stale) {
      try {
        await Referral.update({ status: 'invalid' }, { where: { id: r.id } });
        const payload = { ts: new Date().toISOString(), referralId: r.id, inviterId: r.inviterId, invitedId: r.invitedId, reason: 'no_start', createdAt: r.createdAt };
        logger.appendJsonLog('referrals.log', payload);
        const adminId = config.ADMIN_CONTROL_CHAT_ID || config.ADMIN_CHAT_ID;
        if (adminId && isFeatureEnabled('ENABLE_ADMIN_ALERTS') && notifyAdmin) {
          await notifyAdmin(`⚠️ Referral expired: inviter=${r.inviterId}, invited=${r.invitedId}, referralId=${r.id}`);
        }
      } catch (err) {
        console.error('Error marking referral invalid:', err);
      }
    }

    return { updated: stale.length };
  } catch (err) {
    console.error('Referral audit job error:', err);
    return { error: err.message };
  }
}

module.exports = { auditReferrals };