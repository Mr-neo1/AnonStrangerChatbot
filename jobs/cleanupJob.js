const { redisClient } = require('../database/redisClient');
const LockChatService = require('../services/lockChatService');
const { auditReferrals } = require('./referralAuditJob');

async function cleanup() {
  try {
    // cleanup abandoned sessions (delegated to SessionManager if available)
    await LockChatService.cleanupExpired && await LockChatService.cleanupExpired();

    // Audit referrals (mark pending referrals older than threshold invalid)
    await auditReferrals(7);

    // Example: remove stale queues duplicates handled elsewhere
  } catch (err) {
    console.error('Cleanup job error:', err);
  }
}

module.exports = { cleanup };