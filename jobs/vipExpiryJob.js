const VipService = require('../services/vipService');

async function downgradeExpired() {
  try {
    // In small deployments, scan redis keys
    const { redisClient } = require('../database/redisClient');
    const keys = await redisClient.keys('user:vip:*');
    for (const k of keys) {
      const userId = k.split(':')[2];
      await VipService.checkAndExpire(userId);
    }
  } catch (err) {
    console.error('VIP expiry job error:', err);
  }
}

module.exports = { downgradeExpired };