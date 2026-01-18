const crypto = require('crypto');
const { redisClient } = require('../database/redisClient');

/**
 * Admin Authentication Middleware
 * Uses Telegram-based authentication with temporary session tokens
 * Sessions stored in Redis for persistence across restarts
 */

// Hardcoded admin Telegram IDs (read from env)
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

// Rate limiting for login attempts
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minutes

/**
 * Generate a secure session token
 */
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Check if a Telegram ID is authorized as admin
 */
function isAdmin(telegramId) {
  return ADMIN_IDS.includes(String(telegramId));
}

/**
 * Create a session for an admin (stored in Redis)
 */
async function createSession(telegramId) {
  const token = generateSessionToken();
  const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
  
  const sessionData = {
    telegramId: String(telegramId),
    createdAt: Date.now(),
    expiresAt
  };
  
  // Store in Redis with TTL (24 hours)
  const key = `admin:session:${token}`;
  try {
    await redisClient.setEx(key, 24 * 60 * 60, JSON.stringify(sessionData));
    console.log(`[AdminAuth] Session created for user ${telegramId}, token: ${token.substring(0, 8)}...`);
  } catch (err) {
    console.error('[AdminAuth] Failed to store admin session in Redis:', err.message);
    throw new Error('Failed to create session');
  }

  return token;
}

/**
 * Validate a session token (from Redis)
 */
async function validateSession(token) {
  try {
    if (!token) return null;
    
    const key = `admin:session:${token}`;
    const sessionData = await redisClient.get(key).catch(err => {
      console.error('Redis get error in validateSession:', err.message);
      return null;
    });
    
    if (!sessionData) {
      console.log(`[AdminAuth] Session not found in Redis for token: ${token.substring(0, 8)}...`);
      return null;
    }
    
    const session = JSON.parse(sessionData);
    
    // Double-check expiration
    if (Date.now() > session.expiresAt) {
      await redisClient.del(key).catch(() => {});
      console.log(`[AdminAuth] Session expired for token: ${token.substring(0, 8)}...`);
      return null;
    }
    
    return session;
  } catch (err) {
    console.error('[AdminAuth] Session validation error:', err.message);
    return null;
  }
}

/**
 * Check rate limiting for login attempts
 */
function checkRateLimit(identifier) {
  const attempts = loginAttempts.get(identifier) || { count: 0, firstAttempt: Date.now() };
  
  // Reset if window expired
  if (Date.now() - attempts.firstAttempt > ATTEMPT_WINDOW) {
    loginAttempts.set(identifier, { count: 1, firstAttempt: Date.now() });
    return true;
  }
  
  // Check if exceeded
  if (attempts.count >= MAX_ATTEMPTS) {
    return false;
  }
  
  // Increment
  attempts.count++;
  loginAttempts.set(identifier, attempts);
  return true;
}

/**
 * Middleware: Require admin authentication
 */
async function requireAdmin(req, res, next) {
  // Check for session token in cookie or header
  const token = req.cookies?.adminToken || req.headers['x-admin-token'];
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const session = await validateSession(token);
  if (!session) {
    // Clear invalid cookie
    res.clearCookie('adminToken', { path: '/' });
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  
  // Attach admin info to request
  req.admin = {
    telegramId: session.telegramId
  };
  
  next();
}

/**
 * Middleware: Validate admin Telegram ID
 */
function validateAdminId(req, res, next) {
  const { telegramId } = req.body;
  
  if (!telegramId) {
    return res.status(400).json({ error: 'Telegram ID required' });
  }
  
  if (!isAdmin(telegramId)) {
    console.warn(`[AdminAuth] Unauthorized access attempt from Telegram ID: ${telegramId}`);
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  next();
}

module.exports = {
  isAdmin,
  createSession,
  validateSession,
  checkRateLimit,
  requireAdmin,
  validateAdminId
};
