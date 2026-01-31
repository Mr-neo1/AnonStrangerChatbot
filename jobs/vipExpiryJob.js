const VipService = require('../services/vipService');
const { scanKeys } = require('../utils/redisScanHelper');

async function downgradeExpired() {
  try {
    // Use SCAN instead of KEYS for better performance (non-blocking)
    const { redisClient } = require('../database/redisClient');
    const keys = await scanKeys(redisClient, 'user:vip:*', 500);
    
    // Process in batches to avoid blocking
    const batchSize = 50;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      await Promise.all(batch.map(async (k) => {
        const userId = k.split(':')[2];
        try {
          await VipService.checkAndExpire(userId);
        } catch (err) {
          console.error(`VIP expiry check failed for ${userId}:`, err.message);
        }
      }));
    }
    
    console.log(`[VIP Expiry Job] Checked ${keys.length} VIP users`);
  } catch (err) {
    console.error('VIP expiry job error:', err);
  }
}

module.exports = { downgradeExpired };