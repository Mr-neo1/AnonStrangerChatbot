const { redisClient } = require('../database/redisClient');
const config = require('../config/config');
const LockHistory = require('../models/lockChatModel');
const { scanKeys } = require('../utils/redisScanHelper');
const starsPricing = require('../constants/starsPricing');

class LockChatService {
  // Get dynamic durations from config
  static async getDurations() {
    return await starsPricing.getLockPricing();
  }
  
  // Static fallback for backwards compatibility
  static get durations() {
    return { 5: 15, 10: 25, 15: 35 };
  }

  // Create lock for chatId by userId for durationMinutes
  static async createLock(chatId, userId, durationMinutes, starsPaid = null) {
    const durations = await LockChatService.getDurations();
    if (!durations[durationMinutes]) throw new Error('Invalid lock duration');

    // Simple anti-spam: limit lock creations per hour (VIP vs non-VIP)
    const VipService = require('./vipService');
    const isVip = await VipService.isVip(userId);
    const limit = isVip ? 5 : 1; // per hour
    const counterKey = `lock:count:${userId}`;
    const current = parseInt(await redisClient.get(counterKey) || '0');
    if (current >= limit) {
      // Log and alert admin about rate-limited lock attempt (do not change enforcement logic)
      try {
        const logger = require('../utils/logger');
        const config = require('../config/config');
        const { isFeatureEnabled } = require('../config/featureFlags');

        const payload = { ts: new Date().toISOString(), userId, chatId, durationMinutes, reason: 'rate_limit' };
        logger.appendJsonLog('locks.log', payload);

        const adminId = config.ADMIN_CONTROL_CHAT_ID || config.ADMIN_CHAT_ID;
        if (adminId && isFeatureEnabled('ENABLE_ADMIN_ALERTS')) {
          try {
            const bots = require('../bots');
            const bot = bots.getDefaultBot();
            if (bot) {
              await bot.sendMessage(adminId, `🔒 Lock abuse detected: user=${userId}, chat=${chatId}, duration=${durationMinutes}, reason=rate_limit`);
            }
          } catch (err) {
            console.error('Failed to send lock abuse alert to admin:', err?.message);
          }
        }
      } catch (err) {
        console.error('Error logging/alerting lock abuse:', err);
      }

      throw new Error('Lock creation limit reached. Try later.');
    }
    await redisClient.incr(counterKey);
    if (current === 0) await redisClient.expire(counterKey, 3600);

    // Create DB record and set Redis lock
    const record = await LockHistory.create({ chatId, userId, durationMinutes, expiresAt: new Date(Date.now() + durationMinutes * 60 * 1000), starsPaid });

    const ttl = durationMinutes * 60;
    const key = `chat:locks:${chatId}:${userId}`;
    await redisClient.setEx(key, ttl, '1');
    await redisClient.setEx(`lock:timer:${chatId}:${userId}`, ttl, String(Date.now()));

    return { key, expiresAt: record.expiresAt };
  }

  // Create DB-only lock record (useful inside transactions). Does NOT touch Redis.
  static async createLockRecord(chatId, userId, durationMinutes, starsPaid = null, opts = {}) {
    const durations = await LockChatService.getDurations();
    if (!durations[durationMinutes]) throw new Error('Invalid lock duration');
    const transaction = opts.transaction;
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);
    const record = await LockHistory.create({ chatId, userId, durationMinutes, expiresAt, starsPaid }, { transaction });
    return record;
  }

  // Set Redis keys for lock (call after DB transaction commit)
  static async setRedisLock(chatId, userId, durationMinutes) {
    const ttl = durationMinutes * 60;
    const key = `chat:locks:${chatId}:${userId}`;
    await redisClient.setEx(key, ttl, '1');
    await redisClient.setEx(`lock:timer:${chatId}:${userId}`, ttl, String(Date.now()));
  }

  // Check if any lock exists for chat
  static async isChatLocked(chatId) {
    // Use SCAN instead of KEYS for better performance (non-blocking)
    const pattern = `chat:locks:${chatId}:*`;
    const keys = await scanKeys(redisClient, pattern, 100);
    if (keys && keys.length > 0) return true;

    // Lazy expiry handling: if metadata exists but active key missing (e.g., due to expiry on memory Redis without pubsub), handle expiry
    const metaKey = `lock:meta:${chatId}`;
    const meta = await redisClient.get(metaKey);
    if (meta) {
      // Perform expiry handling asynchronously but don't block caller
      LockChatService.handleLockExpiry(chatId).catch(err => console.error('Error handling lock expiry:', err));
    }

    return false;
  }

  static async isUserLocked(chatId, userId) {
    const key = `chat:locks:${chatId}:${userId}`;
    const v = await redisClient.get(key);
    return Boolean(v);
  }

  // Cleanup locks for chat (when chat ends)
  static async cleanupLocks(chatId) {
    // Use SCAN instead of KEYS for better performance
    const pattern = `chat:locks:${chatId}:*`;
    const keysToDelete = await scanKeys(redisClient, pattern, 100);
    
    if (keysToDelete.length > 0) {
      // Delete in batches to avoid too many arguments
      const batchSize = 100;
      for (let i = 0; i < keysToDelete.length; i += batchSize) {
        const batch = keysToDelete.slice(i, i + batchSize);
        await redisClient.del(...batch).catch(() => {});
      }
    }
    // Also delete any meta or expired-handled markers
    await redisClient.del(`lock:meta:${chatId}`);
    await redisClient.del(`lock:expired:handled:${chatId}`);
  }

  // For admin monitoring
  static async getActiveLocks() {
    const pattern = 'chat:locks:*';
    const keys = await scanKeys(redisClient, pattern, 100);
    const locks = [];
    
    for (const key of keys) {
      try {
        const parts = key.split(':');
        const chatId = parts[2];
        const userId = parts[3];
        const ttl = await redisClient.ttl(key);
        locks.push({ chatId, userId, ttl });
      } catch (e) {
        // Skip invalid keys
      }
    }
    
    return locks;
  }

  // Consume user's LockCredits to cover minutesNeeded. Returns details of consumption.
  static async consumeLockMinutes(userId, minutesNeeded, opts = {}) {
    const { sequelize } = require('../database/connectionPool');
    const LockCredit = require('../models/lockCreditModel');
    const { Op } = require('sequelize');

    const transactionProvided = Boolean(opts.transaction);
    const t = opts.transaction || await sequelize.transaction();

    try {
      // Fetch available credits (FIFO) - where consumed < minutes
      const credits = await LockCredit.findAll({ 
        where: { 
          telegramId: userId, 
          consumed: { [Op.lt]: sequelize.col('minutes') }
        }, 
        order: [['createdAt', 'ASC']], 
        transaction: t, 
        lock: t.LOCK.UPDATE 
      });
      let remaining = minutesNeeded;
      const used = [];

      for (const c of credits) {
        if (remaining <= 0) break;
        const available = c.minutes - c.consumed;
        const take = Math.min(available, remaining);
        c.consumed = c.consumed + take;
        remaining -= take;
        used.push({ id: c.id, consumed: take, remainingMinutes: c.minutes - c.consumed });
        await c.save({ transaction: t });
      }

      if (remaining > 0) {
        if (!transactionProvided) await t.rollback();
        throw new Error('Insufficient lock minutes');
      }

      if (!transactionProvided) await t.commit();
      return used;
    } catch (err) {
      if (!transactionProvided) {
        try { await t.rollback(); } catch (e) {}
      }
      throw err;
    }
  }

  // Activate lock by consuming user's credits atomically and setting Redis lock/meta
  static async activateLockFromCredits(chatId, ownerId, partnerId, durationMinutes, opts = {}) {
    const durations = await LockChatService.getDurations();
    if (!durations[durationMinutes]) throw new Error('Invalid lock duration');
    const { sequelize } = require('../database/connectionPool');

    const transactionProvided = Boolean(opts.transaction);
    const t = opts.transaction || await sequelize.transaction();

    try {
      // Consume minutes
      await LockChatService.consumeLockMinutes(ownerId, durationMinutes, { transaction: t });

      // Create DB record
      const record = await LockChatService.createLockRecord(chatId, ownerId, durationMinutes, null, { transaction: t });

      if (!transactionProvided) await t.commit();

      // Set redis lock and meta (meta survives lock expiry slightly longer to allow expiry handlers to read)
      await LockChatService.setRedisLock(chatId, ownerId, durationMinutes);
      const meta = { ownerId, partnerId, durationMinutes, expiresAt: record.expiresAt.toISOString(), botId: opts.botId || config.BOT_ID || 'default' };
      const metaTtl = durationMinutes * 60 + 60; // extra buffer
      await redisClient.setEx(`lock:meta:${chatId}`, metaTtl, JSON.stringify(meta));

      return record;
    } catch (err) {
      if (!transactionProvided) {
        try { await t.rollback(); } catch (e) {}
      }
      throw err;
    }
  }

  // Return owner userIds (strings) for given chat
  static async getLockOwners(chatId) {
    const keys = await scanKeys(`chat:locks:${chatId}:*`);
    return keys.map(k => k.split(':')[3]);
  }

  // Report abuse attempt when non-owner tries to break a lock
  static async reportLockAbuse(chatId, offenderId) {
    try {
      const key = `lock:abuse:${chatId}:${offenderId}`;
      const count = await redisClient.incr(key);
      if (count === 1) await redisClient.expire(key, 3600);

      const logger = require('../utils/logger');
      logger.appendJsonLog('locks.log', { ts: new Date().toISOString(), chatId, offenderId, action: 'attempt_break_lock', count });

      // Escalate if repeated
      if (count >= 3) {
        const { isFeatureEnabled } = require('../config/featureFlags');
        const adminId = config.ADMIN_CONTROL_CHAT_ID || config.ADMIN_CHAT_ID;
        if (adminId && isFeatureEnabled('ENABLE_ADMIN_ALERTS')) {
          try {
            const bots = require('../bots');
            const bot = bots.getDefaultBot();
            if (bot) {
              await bot.sendMessage(adminId, `🔒 Repeated lock-break attempts: user=${offenderId}, chat=${chatId}, count=${count}`);
            }
          } catch (err) {
            console.error('Failed to send lock abuse escalation to admin:', err?.message);
          }
        }
      }

      return count;
    } catch (err) {
      console.error('Error reporting lock abuse:', err);
      return 0;
    }
  }

  // Handle lock expiry notifications (best-effort using meta key)
  static async handleLockExpiry(chatId) {
    const metaKey = `lock:meta:${chatId}`;
    const raw = await redisClient.get(metaKey);
    if (!raw) return;

    let meta;
    try { meta = JSON.parse(raw); } catch (err) { meta = null; }
    // Mark handled so tests and callers can observe
    await redisClient.setEx(`lock:expired:handled:${chatId}`, 60, '1');

    // Attempt to notify participants (best-effort)
    try {
      const bots = require('../bots');
      const BotRouter = require('../utils/botRouter');
      const bot = (meta && meta.botId) ? bots.getBotById(meta.botId) : null;
      const targets = [];
      if (meta && meta.ownerId) targets.push(meta.ownerId);
      if (meta && meta.partnerId) targets.push(meta.partnerId);

      const message = '🔓 Lock expired. You can now skip or end the chat.';
      if (bot) {
        // Use the specific bot that was used to create the lock
        for (const t of targets) {
          try { await bot.sendMessage(t, message, { parse_mode: 'Markdown', ...require('../utils/keyboards').getActiveChatKeyboard() }); } catch (e) { }
        }
      } else {
        // Fallback: Use BotRouter which intelligently routes to the correct bot
        for (const t of targets) {
          try { await BotRouter.sendMessage(t, message, { parse_mode: 'Markdown', ...require('../utils/keyboards').getActiveChatKeyboard() }); } catch (e) { }
        }
      }
    } catch (err) {
      // Ignore send errors
    }

    // cleanup meta key
    try { await redisClient.del(metaKey); } catch (e) { }
  }
}

module.exports = LockChatService;
module.exports = LockChatService;
