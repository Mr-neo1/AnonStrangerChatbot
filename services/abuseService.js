const { redisClient } = require('../database/redisClient');
const logger = require('../utils/logger');

class AbuseService {
  // Record lock abuse: non-owner tries to stop/skip while a lock is active
  // Returns { count, level }
  static async recordLockAbuse({ chatId, offenderId, ownerId, botId }) {
    const key = `lock:abuse:${chatId}:${offenderId}`;
    const ttl = 3600; // 1 hour

    try {
      const count = await redisClient.incr(key);
      if (count === 1) {
        try { await redisClient.expire(key, ttl); } catch (e) { /* ignore */ }
      }

      let level = 'NONE';
      if (count >= 4) level = 'ALERT';
      else if (count === 3) level = 'WARN';

      // Log on WARN or ALERT
      if (level === 'WARN' || level === 'ALERT') {
        const payload = {
          type: 'LOCK_ABUSE',
          chatId, offenderId, ownerId, count, timestamp: new Date().toISOString(), botId
        };
        try { logger.appendJsonLog('abuse.log', payload); } catch (e) { /* ignore logging errors */ }

        if (level === 'ALERT') {
          try {
            const AdminAlertService = require('./adminAlertService');
            if (AdminAlertService && typeof AdminAlertService.notify === 'function') {
              AdminAlertService.notify(payload).catch(() => {});
            }
          } catch (e) {
            // AdminAlertService not implemented yet: ignore
          }
        }
      }

      return { count, level };
    } catch (err) {
      // On error, be safe: return NONE with zero count
      return { count: 0, level: 'NONE' };
    }
  }

  // Record disconnect abuse: repeated disconnects or disconnects during lock
  static async recordDisconnectAbuse({ userId, chatId = null, botId = null, duringLock = false }) {
    const key = `disconnect:abuse:${userId}`;
    const ttl = 86400; // 24 hours

    try {
      const count = await redisClient.incr(key);
      if (count === 1) {
        try { await redisClient.expire(key, ttl); } catch (e) { /* ignore */ }
      }

      let level = 'NONE';
      if (count >= 5) level = 'ALERT';
      else if (count === 3) level = 'WARN';

      if (level === 'WARN' || level === 'ALERT') {
        const payload = {
          type: 'DISCONNECT_ABUSE',
          userId, chatId, duringLock, count, timestamp: new Date().toISOString(), botId
        };
        try { logger.appendJsonLog('abuse.log', payload); } catch (e) { /* ignore */ }

        if (level === 'ALERT') {
          try {
            const AdminAlertService = require('./adminAlertService');
            if (AdminAlertService && typeof AdminAlertService.notify === 'function') {
              AdminAlertService.notify(payload).catch(() => {});
            }
          } catch (e) {
            // AdminAlertService not implemented yet: ignore
          }
        }
      }

      return { count, level };
    } catch (err) {
      return { count: 0, level: 'NONE' };
    }
  }
}

module.exports = AbuseService;
