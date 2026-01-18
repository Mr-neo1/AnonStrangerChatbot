require('dotenv').config();

const DEFAULTS = {
  ENABLE_STARS_PAYMENTS: false,
  ENABLE_VIP: false,
  ENABLE_LOCK_CHAT: false,
  ENABLE_REFERRALS: false,
  ENABLE_ADMIN_ALERTS: false,
};

function isFeatureEnabled(flag) {
  if (process.env.NODE_ENV === 'production') {
    return ['true', '1', 'yes'].includes((process.env[flag] || '').toLowerCase());
  }
  // In development default to false unless explicitly set
  return ['true', '1', 'yes'].includes((process.env[flag] || DEFAULTS[flag] ? String(DEFAULTS[flag]) : '').toLowerCase()) || ['true', '1', 'yes'].includes((process.env[flag] || '').toLowerCase());
}

module.exports = { isFeatureEnabled };
