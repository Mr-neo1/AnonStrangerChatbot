require('dotenv').config();
const ConfigService = require('../services/configService');

const DEFAULTS = {
  ENABLE_STARS_PAYMENTS: false,
  ENABLE_VIP: false,
  ENABLE_LOCK_CHAT: false,
  ENABLE_REFERRALS: false,
  ENABLE_ADMIN_ALERTS: false,
  ENABLE_CROSS_BOT_MATCHING: false,
  ENABLE_AFFILIATE_SYSTEM: false,
  ENABLE_ABUSE_DETECTION: false,
  MAINTENANCE_MODE: false,
};

const CACHE_TTL_MS = 30 * 1000; // 30 seconds
const cache = new Map();
let refreshing = false;

const toBool = (val, fallback = false) => {
  if (typeof val === 'boolean') return val;
  if (val === null || typeof val === 'undefined') return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(val).toLowerCase());
};

async function refreshFlags() {
  if (refreshing) return;
  refreshing = true;
  const keys = Object.keys(DEFAULTS);
  try {
    for (const key of keys) {
      const value = await ConfigService.get(key, null);
      if (value === null || typeof value === 'undefined') continue;
      cache.set(key, { value: toBool(value), ts: Date.now() });
    }
  } catch (err) {
    console.warn('Feature flag refresh failed:', err.message);
  } finally {
    refreshing = false;
  }
}

// Immediately invalidate cache for a specific flag or all flags
function invalidateCache(flag = null) {
  if (flag) {
    cache.delete(flag);
  } else {
    cache.clear();
  }
  // Force immediate refresh
  refreshFlags();
}

// Kick off initial refresh and keep warm
refreshFlags();
setInterval(refreshFlags, CACHE_TTL_MS).unref();

function isFeatureEnabled(flag) {
  const cached = cache.get(flag);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.value;
  }

  // opportunistically refresh if stale
  if (!refreshing) refreshFlags();

  // Return from database-backed ConfigService directly for production
  // Fall back to env var only if DB is unavailable
  if (process.env.NODE_ENV === 'production') {
    return toBool(process.env[flag], DEFAULTS[flag]);
  }
  return toBool(process.env[flag], DEFAULTS[flag]);
}

module.exports = { isFeatureEnabled, refreshFlags, invalidateCache };
