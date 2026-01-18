const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables with precedence rules:
// 1. Load .env (if present) - this is the default behavior of dotenv
// 2. If .env.local exists, merge it (and in development, allow it to override .env)
// This allows local developers to use .env.local while preserving production PM2 env vars.
try {
  dotenv.config(); // load .env first

  if (fs.existsSync('.env.local')) {
    const envLocal = dotenv.parse(fs.readFileSync('.env.local'));
    // Determine effective NODE_ENV (either pre-set or from .env.local)
    const effectiveNodeEnv = (process.env.NODE_ENV || envLocal.NODE_ENV || '').toLowerCase();

    if (effectiveNodeEnv === 'development') {
      // In development, prefer values from .env.local (override existing values)
      Object.assign(process.env, envLocal);
    } else {
      // In non-development, only set variables that are not already present
      for (const [k, v] of Object.entries(envLocal)) {
        if (!(k in process.env)) process.env[k] = v;
      }
    }
  }
} catch (err) {
  // Fall back to default dotenv behavior if anything goes wrong
  try { dotenv.config(); } catch (e) { /* ignore */ }
}

// DEV-only debug: confirm presence of BOT_TOKENS/BOT_TOKEN (masked) - gated to avoid leaking secrets
if (((process.env.NODE_ENV || '').toLowerCase()) === 'development') {
  const hasBotTokens = Object.prototype.hasOwnProperty.call(process.env, 'BOT_TOKENS');
  const hasBotToken = Object.prototype.hasOwnProperty.call(process.env, 'BOT_TOKEN');
  if (!hasBotTokens && !hasBotToken) {
    console.warn('⚠️ [DEV] WARNING: No BOT_TOKENS or BOT_TOKEN configured');
  }
}

// BOT_TOKENS: optional comma-separated list. Backwards compatible with single BOT_TOKEN.
const BOT_TOKENS = (process.env.BOT_TOKENS || process.env.BOT_TOKEN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const BOT_TOKEN = BOT_TOKENS[0] || process.env.BOT_TOKEN?.trim();

// Database: prefer explicit POSTGRES_URI, fall back to DATABASE_URL for hosts like Railway.
const POSTGRES_URI = process.env.POSTGRES_URI?.trim() || process.env.DATABASE_URL?.trim();

// Normalize optional channel env vars: trim and convert empty string => null
function normEnv(name) {
  const val = process.env[name];
  if (typeof val === 'undefined' || val === null) return null;
  const t = String(val).trim();
  return t === '' ? null : t;
}
const REQUIRED_CHANNEL_1 = normEnv('REQUIRED_CHANNEL_1');
const REQUIRED_CHANNEL_2 = normEnv('REQUIRED_CHANNEL_2');

module.exports = {
  // Multi-bot support
  BOT_TOKENS,
  BOT_TOKEN, // legacy alias (first token)
  DEFAULT_BOT_TOKEN: BOT_TOKEN,
  ADMIN_BOT_TOKEN: process.env.ADMIN_BOT_TOKEN?.trim(),

  // Other configs
  POSTGRES_URI,
  // Backwards-compatible: prefer new separate control/media vars, fall back to ADMIN_CHAT_ID for compatibility
  ADMIN_CONTROL_CHAT_ID: (process.env.ADMIN_CONTROL_CHAT_ID || process.env.ADMIN_CHAT_ID)?.trim(),
  ADMIN_MEDIA_CHANNEL_ID: process.env.ADMIN_MEDIA_CHANNEL_ID?.trim(),
  REQUIRED_CHANNEL_1,
  REQUIRED_CHANNEL_2,
  REDIS_URL: process.env.REDIS_URL?.trim(),
  BOT_ID: process.env.BOT_ID?.trim() || 'default',
  PAYMENT_PROVIDER_TOKEN: process.env.PAYMENT_PROVIDER_TOKEN?.trim() || null,
};

/**
 * Validates admin channel configuration
 * Returns object with validation status and recommendations
 */
function validateAdminChannels() {
  const result = {
    isValid: false,
    errors: [],
    warnings: [],
    recommendations: []
  };

  const controlChatId = module.exports.ADMIN_CONTROL_CHAT_ID;
  const mediaChatId = module.exports.ADMIN_MEDIA_CHANNEL_ID;

  // Check if any admin channels are configured
  if (!controlChatId && !mediaChatId) {
    result.warnings.push('⚠️ No admin channels configured (ADMIN_CONTROL_CHAT_ID, ADMIN_MEDIA_CHANNEL_ID)');
    result.recommendations.push('→ Admin alerts will be silently skipped');
  } else {
    result.isValid = true;
  }

  // Validate format of control chat ID if present
  if (controlChatId) {
    const isValidFormat = (typeof controlChatId === 'string' &&
      (controlChatId.startsWith('@') || controlChatId.startsWith('-') || /^\d+$/.test(controlChatId)));
    
    if (!isValidFormat) {
      result.errors.push(`❌ ADMIN_CONTROL_CHAT_ID has invalid format: "${controlChatId}"`);
      result.recommendations.push('→ Use format: @channel_name, -100XXXXX, or numeric ID');
      result.isValid = false;
    }
  }

  // Validate format of media chat ID if present
  if (mediaChatId) {
    const isValidFormat = (typeof mediaChatId === 'string' &&
      (mediaChatId.startsWith('@') || mediaChatId.startsWith('-') || /^\d+$/.test(mediaChatId)));
    
    if (!isValidFormat) {
      result.errors.push(`❌ ADMIN_MEDIA_CHANNEL_ID has invalid format: "${mediaChatId}"`);
      result.recommendations.push('→ Use format: @channel_name, -100XXXXX, or numeric ID');
      result.isValid = false;
    }
  }

  return result;
}

module.exports.validateAdminChannels = validateAdminChannels;
