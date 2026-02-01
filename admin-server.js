/**
 * Lightweight Admin Panel Server
 * Minimal Express server for admin dashboard
 * Runs on separate port to not affect bot performance
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { sequelize } = require('./database/connectionPool');
const ConfigService = require('./services/configService');
const User = require('./models/userModel');
const VipSubscription = require('./models/vipSubscriptionModel');
const { redisClient } = require('./database/redisClient');
const { Op } = require('sequelize');
const { scanKeys } = require('./utils/redisScanHelper');

const app = express();
const PORT = process.env.ADMIN_PANEL_PORT || 4000;

// ==================== SECURITY HEADERS ====================
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Enable XSS filter
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Content Security Policy
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self';"
  );
  next();
});

// Lightweight middleware
app.use(express.json({ limit: '100kb' })); // Small payload limit
app.use(express.static(path.join(__dirname, 'public')));

// ==================== RATE LIMITING ====================
// In-memory rate limiter for login attempts (prevents brute force)
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 5;

function checkRateLimit(ip) {
  const now = Date.now();
  const key = `login:${ip}`;
  const record = loginAttempts.get(key);
  
  if (!record) {
    loginAttempts.set(key, { count: 1, firstAttempt: now });
    return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS - 1 };
  }
  
  // Reset if window has passed
  if (now - record.firstAttempt > RATE_LIMIT_WINDOW) {
    loginAttempts.set(key, { count: 1, firstAttempt: now });
    return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS - 1 };
  }
  
  // Check if limit exceeded
  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW - (now - record.firstAttempt)) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }
  
  record.count++;
  return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS - record.count };
}

function resetRateLimit(ip) {
  loginAttempts.delete(`login:${ip}`);
}

// Cleanup old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of loginAttempts.entries()) {
    if (now - record.firstAttempt > RATE_LIMIT_WINDOW) {
      loginAttempts.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ==================== SESSION MANAGEMENT (Redis-backed) ====================
const SESSION_TTL = 24 * 60 * 60; // 24 hours in seconds
const SESSION_PREFIX = 'admin:session:';

// Fallback in-memory sessions if Redis unavailable
const memorySessionsFallback = new Map();

async function createSession(adminId, meta = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const sessionData = {
    adminId,
    createdAt: Date.now(),
    ...meta
  };
  
  try {
    await redisClient.setEx(
      SESSION_PREFIX + token,
      SESSION_TTL,
      JSON.stringify(sessionData)
    );
  } catch (err) {
    // Fallback to memory if Redis fails
    console.warn('Redis session storage failed, using memory fallback');
    memorySessionsFallback.set(token, sessionData);
  }
  
  return token;
}

async function getSession(token) {
  if (!token) return null;
  
  try {
    const data = await redisClient.get(SESSION_PREFIX + token);
    if (data) {
      return JSON.parse(data);
    }
  } catch (err) {
    // Try memory fallback
  }
  
  return memorySessionsFallback.get(token) || null;
}

async function deleteSession(token) {
  try {
    await redisClient.del(SESSION_PREFIX + token);
  } catch (err) {
    // Ignore
  }
  memorySessionsFallback.delete(token);
}

// Cleanup memory fallback sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of memorySessionsFallback.entries()) {
    if (now - session.createdAt > SESSION_TTL * 1000) {
      memorySessionsFallback.delete(token);
    }
  }
}, 60000);

// Admin credentials from env - REQUIRE in production
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_TELEGRAM_IDS = (process.env.ADMIN_TELEGRAM_IDS || '').split(',').filter(Boolean);

// Security check: Don't allow default/missing password in production
if (!ADMIN_PASSWORD || ADMIN_PASSWORD === 'changeme123') {
  if (process.env.NODE_ENV === 'production') {
    console.error('\n❌ FATAL: ADMIN_PASSWORD must be set in production!\n');
    console.error('Set a strong password in your .env file:\n  ADMIN_PASSWORD=your_strong_password_here\n');
    process.exit(1);
  } else {
    console.warn('\n⚠️  WARNING: Using default admin password. Set ADMIN_PASSWORD in .env for production!\n');
  }
}

// Use default only in development
const EFFECTIVE_ADMIN_PASSWORD = ADMIN_PASSWORD || 'changeme123';

// ==================== API RATE LIMITING ====================
// Rate limiter for all authenticated API endpoints (prevents abuse)
const apiRateLimits = new Map();
const API_RATE_WINDOW = 60 * 1000; // 1 minute
const API_RATE_MAX = 120; // 120 requests per minute per admin

function checkApiRateLimit(adminId) {
  const now = Date.now();
  const key = `api:${adminId}`;
  const record = apiRateLimits.get(key);
  
  if (!record || now - record.windowStart > API_RATE_WINDOW) {
    apiRateLimits.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: API_RATE_MAX - 1 };
  }
  
  if (record.count >= API_RATE_MAX) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((API_RATE_WINDOW - (now - record.windowStart)) / 1000) };
  }
  
  record.count++;
  return { allowed: true, remaining: API_RATE_MAX - record.count };
}

// Cleanup API rate limits every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of apiRateLimits.entries()) {
    if (now - record.windowStart > API_RATE_WINDOW) {
      apiRateLimits.delete(key);
    }
  }
}, 60000);

// Auth middleware with rate limiting
async function requireAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const session = await getSession(token);
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  
  // Check session age
  if (Date.now() - session.createdAt > SESSION_TTL * 1000) {
    await deleteSession(token);
    return res.status(401).json({ error: 'Session expired' });
  }
  
  // Apply API rate limiting for authenticated requests
  const rateCheck = checkApiRateLimit(session.adminId);
  if (!rateCheck.allowed) {
    res.set('Retry-After', rateCheck.retryAfter);
    return res.status(429).json({ 
      error: 'Too many requests', 
      retryAfter: rateCheck.retryAfter 
    });
  }
  res.set('X-RateLimit-Remaining', rateCheck.remaining);
  
  req.adminId = session.adminId;
  req.sessionToken = token;
  next();
}

// ==================== AUTH ROUTES ====================

app.post('/api/admin/login', async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  
  // Check rate limit
  const rateLimit = checkRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return res.status(429).json({ 
      error: `Too many login attempts. Please try again in ${rateLimit.retryAfter} seconds.`,
      retryAfter: rateLimit.retryAfter
    });
  }
  
  const { username, password } = req.body;
  
  if (username === ADMIN_USERNAME && password === EFFECTIVE_ADMIN_PASSWORD) {
    // Success - reset rate limit
    resetRateLimit(clientIp);
    
    const token = await createSession(username, { 
      ip: clientIp,
      userAgent: req.headers['user-agent']
    });
    return res.json({ success: true, token });
  }
  
  res.status(401).json({ 
    error: 'Invalid credentials',
    attemptsRemaining: rateLimit.remaining
  });
});

app.post('/api/admin/logout', requireAuth, async (req, res) => {
  await deleteSession(req.sessionToken);
  res.json({ success: true });
});

// ==================== TELEGRAM LOGIN ROUTES ====================

// Store for pending Telegram login codes
const telegramLoginCodes = new Map();
const TELEGRAM_CODE_TTL = 5 * 60 * 1000; // 5 minutes

// Cleanup expired codes
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of telegramLoginCodes.entries()) {
    if (now - data.createdAt > TELEGRAM_CODE_TTL) {
      telegramLoginCodes.delete(code);
    }
  }
}, 30000); // Every 30 seconds

// Initialize Telegram login - generate a code
app.post('/api/admin/telegram-login/init', (req, res) => {
  // Generate a unique token for this login attempt
  const pendingToken = crypto.randomBytes(16).toString('hex');
  // Generate a 6-digit code for the user to send to the bot
  const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
  
  telegramLoginCodes.set(verifyCode, {
    pendingToken,
    createdAt: Date.now(),
    verified: false,
    telegramId: null,
    username: null
  });
  
  res.json({
    success: true,
    pendingToken,
    verifyCode,
    expiresIn: TELEGRAM_CODE_TTL / 1000
  });
});

// Check if Telegram login has been verified
app.get('/api/admin/telegram-login/check/:token', async (req, res) => {
  const { token } = req.params;
  
  // Find the code entry with this pending token
  let foundEntry = null;
  let foundCode = null;
  for (const [code, data] of telegramLoginCodes.entries()) {
    if (data.pendingToken === token) {
      foundEntry = data;
      foundCode = code;
      break;
    }
  }
  
  if (!foundEntry) {
    return res.json({ verified: false, expired: true });
  }
  
  if (Date.now() - foundEntry.createdAt > TELEGRAM_CODE_TTL) {
    telegramLoginCodes.delete(foundCode);
    return res.json({ verified: false, expired: true });
  }
  
  if (foundEntry.verified && foundEntry.telegramId) {
    // Check if this Telegram ID is an admin
    if (ADMIN_TELEGRAM_IDS.includes(foundEntry.telegramId.toString())) {
      // Create session using Redis-backed session system
      const sessionToken = await createSession(`telegram:${foundEntry.telegramId}`, {
        username: foundEntry.username,
        telegramId: foundEntry.telegramId
      });
      
      // Clean up the code
      telegramLoginCodes.delete(foundCode);
      
      return res.json({
        verified: true,
        token: sessionToken,
        username: foundEntry.username
      });
    } else {
      // Not authorized - clean up
      telegramLoginCodes.delete(foundCode);
      return res.json({ 
        verified: false, 
        error: 'Your Telegram ID is not authorized as admin' 
      });
    }
  }
  
  res.json({ verified: false, expired: false });
});

// Endpoint for bot to verify a code (called internally by the bot)
app.post('/api/admin/telegram-login/verify', (req, res) => {
  const { code, telegramId, username, botSecret } = req.body;
  
  // Verify this request is from our bot (simple shared secret)
  const expectedSecret = process.env.BOT_ADMIN_SECRET || 'default-bot-secret';
  if (botSecret !== expectedSecret) {
    return res.status(403).json({ error: 'Invalid bot secret' });
  }
  
  if (!telegramLoginCodes.has(code)) {
    return res.json({ success: false, error: 'Invalid or expired code' });
  }
  
  const entry = telegramLoginCodes.get(code);
  if (Date.now() - entry.createdAt > TELEGRAM_CODE_TTL) {
    telegramLoginCodes.delete(code);
    return res.json({ success: false, error: 'Code expired' });
  }
  
  // Mark as verified
  entry.verified = true;
  entry.telegramId = telegramId;
  entry.username = username || `User ${telegramId}`;
  
  res.json({ success: true });
});

// ==================== OTP LOGIN ROUTES ====================

// Store for pending OTPs
const otpCodes = new Map();
const OTP_TTL = 5 * 60 * 1000; // 5 minutes

// Cleanup expired OTPs
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of otpCodes.entries()) {
    if (now - data.createdAt > OTP_TTL) {
      otpCodes.delete(id);
    }
  }
}, 30000);

// Request OTP - sends a code to user's Telegram
app.post('/api/admin/otp/request', async (req, res) => {
  const { telegramId } = req.body;
  
  if (!telegramId) {
    return res.status(400).json({ error: 'Telegram ID is required' });
  }
  
  // Check if this Telegram ID is an admin
  if (!ADMIN_TELEGRAM_IDS.includes(telegramId.toString())) {
    return res.json({ success: false, error: 'This Telegram ID is not authorized as admin' });
  }
  
  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Store OTP
  otpCodes.set(telegramId.toString(), {
    otp,
    createdAt: Date.now(),
    attempts: 0
  });
  
  // Send OTP to user via Telegram bot
  try {
    // Try to get a bot instance to send the message
    let botSent = false;
    
    // Try using the first available bot token from env
    const botTokens = (process.env.BOT_TOKENS || process.env.BOT_TOKEN || '').split(',').filter(Boolean);
    if (botTokens.length > 0) {
      const TelegramBot = require('node-telegram-bot-api');
      // Create a temporary bot instance just for sending
      const tempBot = new TelegramBot(botTokens[0], { polling: false });
      
      await tempBot.sendMessage(telegramId, 
        `🔐 *Admin Panel Login OTP*\n\n` +
        `Your one-time password is:\n\n` +
        `\`${otp}\`\n\n` +
        `⏰ This code expires in 5 minutes.\n` +
        `⚠️ Don't share this code with anyone!`,
        { parse_mode: 'Markdown' }
      );
      botSent = true;
    }
    
    if (!botSent) {
      return res.json({ success: false, error: 'Could not send OTP - no bot configured' });
    }
    
    res.json({ success: true, message: 'OTP sent to your Telegram' });
  } catch (error) {
    console.error('Failed to send OTP:', error.message);
    res.json({ success: false, error: 'Failed to send OTP. Make sure you have started a chat with the bot.' });
  }
});

// Verify OTP
app.post('/api/admin/otp/verify', async (req, res) => {
  const { telegramId, otp } = req.body;
  
  if (!telegramId || !otp) {
    return res.status(400).json({ error: 'Telegram ID and OTP are required' });
  }
  
  const stored = otpCodes.get(telegramId.toString());
  
  if (!stored) {
    return res.json({ success: false, error: 'No OTP found. Please request a new one.' });
  }
  
  // Check expiry
  if (Date.now() - stored.createdAt > OTP_TTL) {
    otpCodes.delete(telegramId.toString());
    return res.json({ success: false, error: 'OTP expired. Please request a new one.' });
  }
  
  // Check attempts (max 3)
  if (stored.attempts >= 3) {
    otpCodes.delete(telegramId.toString());
    return res.json({ success: false, error: 'Too many attempts. Please request a new OTP.' });
  }
  
  stored.attempts++;
  
  // Verify OTP
  if (stored.otp !== otp) {
    return res.json({ success: false, error: `Invalid OTP. ${3 - stored.attempts} attempts remaining.` });
  }
  
  // OTP verified - create session using Redis-backed system
  otpCodes.delete(telegramId.toString());
  
  const sessionToken = await createSession(`telegram:${telegramId}`, {
    username: `Admin ${telegramId}`,
    telegramId
  });
  
  res.json({ 
    success: true, 
    token: sessionToken,
    username: `Admin ${telegramId}`
  });
});

// ==================== STATS ROUTES ====================

app.get('/api/admin/stats', requireAuth, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [totalUsers, vipActive, todayUsers, bannedUsers] = await Promise.all([
      User.count(),
      VipSubscription.count({ where: { expiresAt: { [Op.gt]: new Date() } } }),
      User.count({ where: { createdAt: { [Op.gte]: today } } }),
      User.count({ where: { banned: true } })
    ]);
    
    // Get active chats from Redis (using SCAN instead of KEYS for production)
    let activeChats = 0;
    let activeUserIds = [];
    try {
      const keys = await scanKeys(redisClient, 'pair:*', 100);
      activeChats = Math.floor((keys?.length || 0) / 2);
      // Extract user IDs from pair keys
      activeUserIds = keys.map(k => k.replace('pair:', ''));
    } catch (e) {}
    
    // Get queue sizes (check multiple queue patterns)
    let queueSize = 0;
    let queueUsers = [];
    try {
      // Check various queue keys
      const queuePatterns = ['queue:vip', 'queue:free', 'queue:general', 'queue:vip:any'];
      for (const pattern of queuePatterns) {
        const len = await redisClient.lLen(pattern).catch(() => 0);
        queueSize += len || 0;
        if (len > 0) {
          const users = await redisClient.lRange(pattern, 0, -1).catch(() => []);
          queueUsers.push(...(users || []));
        }
      }
      // Also check bot-specific queues
      for (let i = 0; i < 10; i++) {
        const botQueues = [`queue:bot_${i}:vip`, `queue:bot_${i}:free`, `queue:bot_${i}:general`];
        for (const q of botQueues) {
          const len = await redisClient.lLen(q).catch(() => 0);
          if (len > 0) {
            queueSize += len;
            const users = await redisClient.lRange(q, 0, -1).catch(() => []);
            queueUsers.push(...(users || []));
          }
        }
      }
    } catch (e) {}
    
    // Calculate online users (in chat + in queue)
    const onlineUsers = new Set([...activeUserIds, ...queueUsers]).size;
    
    res.json({
      totalUsers,
      vipActive,
      todayUsers,
      bannedUsers,
      activeChats,
      queueSize,
      onlineUsers
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get live active users with details
app.get('/api/admin/active-users', requireAuth, async (req, res) => {
  try {
    const activeUsers = [];
    const userIds = new Set();
    const processedPairs = new Set(); // Track processed pairs to avoid duplicates
    
    // Get users in active chats (using SCAN instead of KEYS)
    const pairKeys = await scanKeys(redisClient, 'pair:*', 100).catch(() => []);
    for (const key of pairKeys) {
      const odUserId = key.replace('pair:', '');
      const partnerId = await redisClient.get(key).catch(() => null);
      
      // Create a unique pair key (sorted to ensure consistency)
      const pairKey = [odUserId, partnerId].sort().join('-');
      
      // Skip if we've already processed this pair
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);
      
      if (!userIds.has(odUserId)) {
        userIds.add(odUserId);
        activeUsers.push({
          odUserId: odUserId,
          status: 'chatting',
          partnerId
        });
      }
      // Also add partnerId to userIds set for enrichment
      if (partnerId) userIds.add(partnerId);
    }
    
    // Get users in queue
    const queuePatterns = ['queue:vip', 'queue:free', 'queue:general', 'queue:vip:any'];
    for (const pattern of queuePatterns) {
      const users = await redisClient.lRange(pattern, 0, -1).catch(() => []);
      for (const odUserId of (users || [])) {
        if (!userIds.has(odUserId)) {
          userIds.add(odUserId);
          activeUsers.push({
            odUserId: odUserId,
            status: 'searching',
            queue: pattern.replace('queue:', '')
          });
        }
      }
    }
    
    // Fetch user details from database for all active users
    if (activeUsers.length > 0) {
      const User = require('./models/userModel');
      const userDetails = await User.findAll({
        where: { telegramId: Array.from(userIds).map(id => String(id)) },
        attributes: ['telegramId', 'username', 'firstName', 'gender', 'age', 'botId'],
        raw: true
      }).catch(() => []);
      
      // Create lookup map
      const userMap = {};
      for (const u of userDetails) {
        userMap[String(u.telegramId)] = u;
      }
      
      // Enrich active users with details
      for (const au of activeUsers) {
        const details = userMap[String(au.odUserId)] || {};
        au.username = details.username || null;
        au.firstName = details.firstName || null;
        au.gender = details.gender || null;
        au.age = details.age || null;
        au.botId = details.botId || null;
        
        // Add partner details if chatting
        if (au.partnerId && userMap[String(au.partnerId)]) {
          const partnerDetails = userMap[String(au.partnerId)];
          au.partnerUsername = partnerDetails.username || null;
          au.partnerFirstName = partnerDetails.firstName || null;
        }
      }
    }
    
    res.json({ activeUsers, count: activeUsers.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== MESSAGES MANAGEMENT ====================

app.get('/api/admin/messages', requireAuth, async (req, res) => {
  try {
    const messages = await ConfigService.getMany({
      // Core Messages
      'msg_welcome': '🎉 *Welcome to Anonymous Chat!*\n\nConnect with strangers worldwide! 🌍',
      'msg_searching': '� Looking for a partner...\n\n/stop — stop searching',
      'msg_connected': '✅ Partner found, let\'s chat!\n\n/stop — end the dialogue\n/next — find a new partner',
      'msg_partner_left': '💬 Your partner has stopped the chat.\n\n/next — find a new partner\n/report — send a complaint',
      'msg_chat_ended': '💬 You stopped the chat\n\n/next — find a new partner\n/report — send a complaint',
      'msg_chat_ended_next': '💬 You stopped the chat\n\n🔎 Looking for a new partner...\n\n/stop — stop searching',
      // Status Messages
      'msg_not_paired': '❗️ You are not in a dialogue\n\nUse 🎲 Find a partner to start chatting.',
      'msg_in_dialogue': '❗️ You are in a dialogue\n\nTo end the dialog, use the /stop command.',
      'msg_already_searching': '🔎 Already searching for a partner...',
      'msg_already_paired': '💬 You are already in a chat. End it first to find a new partner.',
      'msg_banned_user': '🚫 You have been banned from using this bot.',
      // VIP Messages
      'msg_vip_welcome': '⭐ Welcome VIP! Enjoy your premium features.',
      'msg_vip_expired': '⏰ Your VIP subscription has expired.',
      'msg_vip_benefits': '✨ VIP Benefits: Gender filter, priority matching, no ads!',
      'msg_gender_filter_vip': '⭐ Gender filter is a VIP feature. Upgrade to use it!',
      // Rules & System
      'msg_rules': '📋 *Chat Rules*\n\nYou will be blocked if you violate our rules!',
      'msg_maintenance': '🔧 Bot is under maintenance. Please try again later.',
      'msg_rate_limited': '⏰ Please slow down. Wait a moment before sending another message.',
      'msg_error': '❌ An error occurred. Please try again.',
      'msg_channel_join': '📢 Please join our channel to use this bot.',
      // Profile Messages
      'msg_gender_prompt': '👤 Please select your gender:',
      'msg_age_prompt': '🎂 Please enter your age:',
      'msg_profile_complete': '✅ Profile setup complete!',
      'msg_profile_updated': '✅ Profile updated successfully!',
      // Chat Messages
      'msg_partner_typing': '✍️ Partner is typing...',
      'msg_partner_media': '📎 Partner sent media.',
      'msg_report_received': '✅ Report received. Thank you!',
      'msg_rating_prompt': '⭐ How was your chat? Rate your partner:',
      // Notification Messages
      'msg_referral_bonus': '🎁 You received a referral bonus!',
      'msg_daily_bonus': '🎁 Daily bonus claimed!',
      'msg_achievement_unlocked': '🏆 Achievement unlocked!'
    });
    
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/messages', requireAuth, async (req, res) => {
  try {
    const body = req.body;
    
    // Support single key-value pair format: { key: 'msg_...', value: '...' }
    if (body.key && body.value !== undefined) {
      if (!body.key.startsWith('msg_')) {
        return res.status(400).json({ error: 'Invalid message key' });
      }
      await ConfigService.set(body.key, body.value, req.adminId);
    }
    // Support bulk update format: { msg_welcome: '...', msg_rules: '...', ... }
    else {
      const keys = Object.keys(body);
      if (keys.length === 0) {
        return res.status(400).json({ error: 'No messages to update' });
      }
      
      // Validate all keys start with msg_
      const invalidKeys = keys.filter(k => !k.startsWith('msg_'));
      if (invalidKeys.length > 0) {
        return res.status(400).json({ error: `Invalid message keys: ${invalidKeys.join(', ')}` });
      }
      
      // Save all messages
      for (const [key, value] of Object.entries(body)) {
        await ConfigService.set(key, value, req.adminId);
      }
    }
    
    // Clear messages cache so bots pick up new messages immediately
    try {
      const MessagesService = require('./services/messagesService');
      MessagesService.clearCache();
    } catch (e) {}
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== CONFIG ROUTES ====================

app.get('/api/admin/config', requireAuth, async (req, res) => {
  try {
    const config = await ConfigService.getMany({
      // VIP Plans
      'vip_plans_config': '[]',
      'vip_enabled': true,
      
      // Lock Chat
      'lock_chat_5min_price': 15,
      'lock_chat_10min_price': 25,
      'lock_chat_15min_price': 35,
      'lock_chat_enabled': true,
      
      // Channels
      'required_channel_enabled': false,
      'required_channel_1': '',
      'required_channel_2': '',
      'admin_media_channel': '',
      
      // Bot tokens
      'bot_tokens': '',
      
      // Feature flags
      'ENABLE_STARS_PAYMENTS': false,
      'ENABLE_VIP': false,
      'ENABLE_LOCK_CHAT': false,
      'ENABLE_REFERRALS': false,
      'ENABLE_ADMIN_ALERTS': false,
      'ENABLE_CROSS_BOT_MATCHING': false,
      'ENABLE_AFFILIATE_SYSTEM': false,
      'ENABLE_ABUSE_DETECTION': false,
      'MAINTENANCE_MODE': false,
      
      // Referral
      'referral_vip_days': 10,
      'affiliate_commission': 0.8
    });
    
    // Parse VIP plans if string
    if (typeof config.vip_plans_config === 'string') {
      try {
        config.vip_plans_config = JSON.parse(config.vip_plans_config);
      } catch { config.vip_plans_config = []; }
    }
    
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/config', requireAuth, async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) {
      return res.status(400).json({ error: 'Key required' });
    }
    
    await ConfigService.set(key, value, req.adminId);
    
    // Invalidate feature flag cache for immediate effect
    try {
      const { invalidateCache } = require('./config/featureFlags');
      if (key.startsWith('ENABLE_') || key === 'MAINTENANCE_MODE') {
        invalidateCache(key);
      }
    } catch (e) {
      console.warn('Feature flag cache invalidation failed:', e.message);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/config/bulk', requireAuth, async (req, res) => {
  try {
    const { configs } = req.body;
    if (!configs || !Array.isArray(configs)) {
      return res.status(400).json({ error: 'configs array required' });
    }
    
    for (const { key, value } of configs) {
      await ConfigService.set(key, value, req.adminId);
    }
    
    // Invalidate all feature flag cache for immediate effect
    try {
      const { invalidateCache } = require('./config/featureFlags');
      invalidateCache(); // Clear all flags
    } catch (e) {
      console.warn('Feature flag cache invalidation failed:', e.message);
    }
    
    res.json({ success: true, updated: configs.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== USER ROUTES ====================

app.get('/api/admin/users', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, search = '', filter = 'all' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const where = {};
    
    if (search) {
      where[Op.or] = [
        { userId: { [Op.like]: `%${search}%` } },
        { telegramId: { [Op.like]: `%${search}%` } }
      ];
    }
    
    if (filter === 'banned') {
      where.banned = true;
    } else if (filter === 'vip') {
      // Get VIP user IDs first
      const vipSubs = await VipSubscription.findAll({
        where: { expiresAt: { [Op.gt]: new Date() } },
        attributes: ['userId']
      });
      where.userId = { [Op.in]: vipSubs.map(v => v.userId) };
    }
    
    const { count, rows } = await User.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset,
      order: [['createdAt', 'DESC']],
      attributes: ['userId', 'telegramId', 'username', 'firstName', 'gender', 'age', 'banned', 'totalChats', 'createdAt', 'botId']
    });
    
    // Get VIP status for each user
    const vipStatuses = await VipSubscription.findAll({
      where: { 
        userId: { [Op.in]: rows.map(u => u.userId) },
        expiresAt: { [Op.gt]: new Date() }
      },
      attributes: ['userId', 'expiresAt']
    });
    const vipMap = new Map(vipStatuses.map(v => [v.userId, v.expiresAt]));
    
    const users = rows.map(u => ({
      ...u.toJSON(),
      isVip: vipMap.has(u.userId),
      vipExpiry: vipMap.get(u.userId) || null
    }));
    
    res.json({ users, total: count, page: parseInt(page), pages: Math.ceil(count / parseInt(limit)) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/users/:userId/ban', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    await User.update({ banned: true }, { where: { userId } });
    
    // Invalidate user cache so matching service sees the ban immediately
    const UserCacheService = require('./services/userCacheService');
    await UserCacheService.invalidate(userId);
    
    // Remove from all queues so they can't match with anyone
    const MatchingService = require('./services/matchingService');
    await MatchingService.dequeueUser('default', userId);
    
    // If user is in an active chat, disconnect them
    try {
      const partner = await redisClient.get('pair:' + userId);
      if (partner) {
        await redisClient.del('pair:' + partner);
        await redisClient.del('pair:' + userId);
      }
    } catch (e) {}
    
    res.json({ success: true, message: 'User banned, cache cleared, removed from queues' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/users/:userId/unban', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    await User.update({ banned: false }, { where: { userId } });
    
    // Invalidate user cache so matching service sees the unban immediately
    const UserCacheService = require('./services/userCacheService');
    await UserCacheService.invalidate(userId);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/users/:userId/vip', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { days } = req.body;
    
    const VipService = require('./services/vipService');
    const expiry = await VipService.activateVip(userId, days || 30, { source: 'admin_grant' });
    
    res.json({ success: true, expiresAt: expiry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== QUICK ACTIONS ====================

// Get user info by ID (including username, current partner, status)
app.get('/api/admin/quick/user/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get user from database
    const user = await User.findOne({ where: { userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found in database' });
    }
    
    // Try to get Telegram user info (username) via bot
    let telegramInfo = null;
    try {
      const { getAllBots } = require('./bots');
      const bots = getAllBots();
      if (bots && bots.length > 0) {
        const bot = bots[0];
        const chat = await bot.getChat(userId).catch(() => null);
        if (chat) {
          telegramInfo = {
            username: chat.username || null,
            firstName: chat.first_name || null,
            lastName: chat.last_name || null,
            bio: chat.bio || null
          };
        }
      }
    } catch (e) {
      console.log('Could not fetch Telegram info for user:', e.message);
    }
    
    // Get current partner
    const partnerId = await redisClient.get('pair:' + userId);
    let partnerInfo = null;
    if (partnerId) {
      const partnerUser = await User.findOne({ where: { userId: partnerId } });
      if (partnerUser) {
        partnerInfo = {
          userId: partnerId,
          gender: partnerUser.gender,
          age: partnerUser.age
        };
        // Try to get partner's telegram info
        try {
          const { getAllBots } = require('./bots');
          const bots = getAllBots();
          if (bots && bots.length > 0) {
            const chat = await bots[0].getChat(partnerId).catch(() => null);
            if (chat) {
              partnerInfo.username = chat.username || null;
              partnerInfo.firstName = chat.first_name || null;
            }
          }
        } catch (e) {}
      }
    }
    
    // Check if user is in queue
    const MatchingService = require('./services/matchingService');
    const isInQueue = await MatchingService.isUserQueued('default', userId);
    
    // Get VIP status
    const vipSub = await VipSubscription.findOne({
      where: { userId, expiresAt: { [Op.gt]: new Date() } }
    });
    
    res.json({
      user: {
        userId: user.userId,
        telegramId: user.telegramId,
        gender: user.gender,
        age: user.age,
        banned: user.banned,
        totalChats: user.totalChats,
        createdAt: user.createdAt,
        botId: user.botId
      },
      telegram: telegramInfo,
      partner: partnerInfo,
      isInQueue,
      isVip: !!vipSub,
      vipExpiry: vipSub?.expiresAt || null,
      status: partnerId ? 'chatting' : isInQueue ? 'searching' : 'idle'
    });
  } catch (error) {
    console.error('Quick user lookup error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send direct message to user (disconnects from current partner first)
app.post('/api/admin/quick/message', requireAuth, async (req, res) => {
  try {
    const { userId, message, disconnectFirst = true } = req.body;
    
    if (!userId || !message) {
      return res.status(400).json({ error: 'userId and message required' });
    }
    
    const { getAllBots } = require('./bots');
    const bots = getAllBots();
    if (!bots || bots.length === 0) {
      return res.status(503).json({ error: 'No bots available' });
    }
    
    // Use first available bot or user's assigned bot
    const user = await User.findOne({ where: { userId } });
    let bot = bots[0];
    if (user?.botId) {
      const userBot = bots.find(b => b._meta?.botId === user.botId);
      if (userBot) bot = userBot;
    }
    
    // Disconnect from current partner if requested
    if (disconnectFirst) {
      const partnerId = await redisClient.get('pair:' + userId);
      if (partnerId) {
        // Notify partner
        try {
          await bot.sendMessage(partnerId, '👋 Your partner has been disconnected by admin.', {
            reply_markup: {
              keyboard: [[{ text: '🔍 Find Partner' }], [{ text: '👤 Menu' }]],
              resize_keyboard: true
            }
          });
        } catch (e) {}
        
        // Clear pair data
        await redisClient.del('pair:' + partnerId);
        await redisClient.del('pair:' + userId);
        
        console.log(`Admin disconnected user ${userId} from partner ${partnerId}`);
      }
    }
    
    // Send admin message to user
    const adminMessage = `📢 *Message from Admin:*\n\n${message}`;
    await bot.sendMessage(userId, adminMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [[{ text: '🔍 Find Partner' }], [{ text: '👤 Menu' }]],
        resize_keyboard: true
      }
    });
    
    console.log(`Admin sent message to user ${userId}: ${message.substring(0, 50)}...`);
    
    res.json({ 
      success: true, 
      message: 'Message sent',
      disconnected: disconnectFirst && !!(await redisClient.get('pair:' + userId) === null)
    });
  } catch (error) {
    console.error('Admin message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Force disconnect a specific user
app.post('/api/admin/quick/disconnect', requireAuth, async (req, res) => {
  try {
    const { userId, reason = 'Admin action' } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    
    const partnerId = await redisClient.get('pair:' + userId);
    
    if (!partnerId) {
      return res.json({ success: true, message: 'User was not in a chat', wasConnected: false });
    }
    
    const { getAllBots } = require('./bots');
    const bots = getAllBots();
    const bot = bots && bots.length > 0 ? bots[0] : null;
    
    // Notify both users
    if (bot) {
      try {
        await bot.sendMessage(userId, `❌ You have been disconnected.\n\n_Reason: ${reason}_`, {
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [[{ text: '🔍 Find Partner' }], [{ text: '👤 Menu' }]],
            resize_keyboard: true
          }
        });
      } catch (e) {}
      
      try {
        await bot.sendMessage(partnerId, '👋 Your partner has been disconnected.', {
          reply_markup: {
            keyboard: [[{ text: '🔍 Find Partner' }], [{ text: '👤 Menu' }]],
            resize_keyboard: true
          }
        });
      } catch (e) {}
    }
    
    // Clear pair data
    await redisClient.del('pair:' + userId);
    await redisClient.del('pair:' + partnerId);
    
    // Also remove from queue if present
    const MatchingService = require('./services/matchingService');
    await MatchingService.dequeueUser('default', userId);
    
    console.log(`Admin force disconnected user ${userId} from partner ${partnerId}. Reason: ${reason}`);
    
    res.json({ 
      success: true, 
      message: 'User disconnected',
      wasConnected: true,
      partnerId
    });
  } catch (error) {
    console.error('Force disconnect error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user's current partner
app.get('/api/admin/quick/partner/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const partnerId = await redisClient.get('pair:' + userId);
    
    if (!partnerId) {
      return res.json({ hasPartner: false, partner: null });
    }
    
    // Get partner details
    const partnerUser = await User.findOne({ where: { userId: partnerId } });
    
    // Try to get Telegram info
    let telegramInfo = null;
    try {
      const { getAllBots } = require('./bots');
      const bots = getAllBots();
      if (bots && bots.length > 0) {
        const chat = await bots[0].getChat(partnerId).catch(() => null);
        if (chat) {
          telegramInfo = {
            username: chat.username || null,
            firstName: chat.first_name || null,
            lastName: chat.last_name || null
          };
        }
      }
    } catch (e) {}
    
    res.json({
      hasPartner: true,
      partner: {
        userId: partnerId,
        gender: partnerUser?.gender,
        age: partnerUser?.age,
        totalChats: partnerUser?.totalChats,
        ...telegramInfo
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Lookup username by Telegram ID
app.get('/api/admin/quick/username/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const { getAllBots } = require('./bots');
    const bots = getAllBots();
    
    if (!bots || bots.length === 0) {
      return res.status(503).json({ error: 'No bots available to lookup username' });
    }
    
    const chat = await bots[0].getChat(userId).catch(err => {
      throw new Error('Could not fetch user info: ' + err.message);
    });
    
    res.json({
      userId: userId,
      username: chat.username || null,
      firstName: chat.first_name || null,
      lastName: chat.last_name || null,
      bio: chat.bio || null,
      type: chat.type
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== BOT MANAGEMENT ====================

app.get('/api/admin/bots', requireAuth, async (req, res) => {
  try {
    const tokensStr = await ConfigService.get('bot_tokens', '');
    const tokens = tokensStr ? tokensStr.split(',').filter(Boolean) : [];
    
    // Get running bots from bots.js
    let runningBots = [];
    try {
      const { getAllBots } = require('./bots');
      runningBots = getAllBots() || [];
    } catch (e) {
      // Bots module not available
    }
    
    const bots = [];
    for (let i = 0; i < tokens.length; i++) {
      const botId = `bot_${i}`;
      const disabled = await ConfigService.get(`bot:${botId}:disabled`, false);
      
      // Mask token for security
      const token = tokens[i];
      const maskedToken = token.substring(0, 10) + '...' + token.substring(token.length - 5);
      
      // Check if this bot is running and get its info
      const runningBot = runningBots.find(b => b._meta?.botId === botId || b._meta?.index === i);
      let username = null;
      let isRunning = false;
      let activeUsers = 0;
      
      if (runningBot) {
        isRunning = runningBot._pollingState?.active !== false;
        // Try to get username from cached getMe result
        try {
          if (runningBot._meInfo) {
            username = runningBot._meInfo.username;
          }
        } catch (e) {}
      }
      
      bots.push({
        id: botId,
        index: i,
        token: maskedToken,
        username: username ? `@${username}` : `Bot ${i}`,
        status: isRunning ? 'running' : 'stopped',
        disabled: disabled === true || disabled === 'true',
        activeUsers: activeUsers
      });
    }
    
    res.json({ bots });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/bots/add', requireAuth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || token.length < 30) {
      return res.status(400).json({ error: 'Invalid bot token' });
    }
    
    // Validate token format (basic check)
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
      return res.status(400).json({ error: 'Invalid token format. Should be like: 123456789:ABC-DEF...' });
    }
    
    // Get existing tokens
    const tokensStr = await ConfigService.get('bot_tokens', '');
    const tokens = tokensStr ? tokensStr.split(',').filter(Boolean) : [];
    
    // Check for duplicate
    if (tokens.includes(token)) {
      return res.status(400).json({ error: 'Bot token already exists' });
    }
    
    // Add new token
    tokens.push(token);
    await ConfigService.set('bot_tokens', tokens.join(','));
    
    res.json({ success: true, message: 'Bot added. Restart the server to activate.', botCount: tokens.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/bots/:index/remove', requireAuth, async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    
    // Get existing tokens
    const tokensStr = await ConfigService.get('bot_tokens', '');
    const tokens = tokensStr ? tokensStr.split(',').filter(Boolean) : [];
    
    if (index < 0 || index >= tokens.length) {
      return res.status(400).json({ error: 'Invalid bot index' });
    }
    
    // Remove token at index
    tokens.splice(index, 1);
    await ConfigService.set('bot_tokens', tokens.join(','));
    
    res.json({ success: true, message: 'Bot removed. Restart the server to apply.', botCount: tokens.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/bots/:botId/toggle', requireAuth, async (req, res) => {
  try {
    const { botId } = req.params;
    const current = await ConfigService.get(`bot:${botId}:disabled`, false);
    const newValue = !(current === true || current === 'true');
    await ConfigService.set(`bot:${botId}:disabled`, newValue);
    
    res.json({ success: true, disabled: newValue });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== RESTART BOTS ====================

app.post('/api/admin/bots/restart', requireAuth, async (req, res) => {
  try {
    const { restartAllBots } = require('./bots');
    
    // Perform in-process restart (doesn't exit the server)
    const result = await restartAllBots();
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: result.message || 'All bots restarted successfully!'
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: result.message || 'Restart failed' 
      });
    }
  } catch (error) {
    console.error('Restart error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== BROADCAST ====================

// Configure multer for file uploads
const multer = require('multer');
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

app.post('/api/admin/broadcast', requireAuth, upload.single('media'), async (req, res) => {
  try {
    const { message, audience, target, mediaType } = req.body;
    const actualAudience = audience || target || 'all'; // Support both audience and target
    const mediaFile = req.file;
    
    if (!message && !mediaFile) {
      return res.status(400).json({ error: 'Message or media required' });
    }
    
    // Build broadcast data
    const broadcastData = {
      message: message || '',
      audience: actualAudience,
      meta: { source: 'admin_panel' }
    };
    
    // If media is included, add it to broadcast data
    if (mediaFile) {
      broadcastData.media = {
        buffer: mediaFile.buffer.toString('base64'), // Base64 encode for queue
        mimetype: mediaFile.mimetype,
        originalname: mediaFile.originalname,
        type: mediaType || (mediaFile.mimetype.startsWith('image/') ? 'photo' : 
                           mediaFile.mimetype.startsWith('video/') ? 'video' : 'document')
      };
    }
    
    // Queue broadcast (don't block - return immediately)
    const { enqueueBroadcast } = require('./services/queueService');
    await enqueueBroadcast(broadcastData);
    
    res.json({ success: true, queued: true, hasMedia: !!mediaFile });
  } catch (error) {
    console.error('Broadcast error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== ANALYTICS ====================

app.get('/api/admin/analytics', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    
    const { User, VipSubscription, StarTransaction } = require('./models');
    const { Op } = require('sequelize');
    
    // Generate date range
    const start = new Date(startDate);
    const end = new Date(endDate);
    const dates = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(new Date(d).toISOString().split('T')[0]);
    }
    
    // Build analytics data for each date
    const data = await Promise.all(dates.map(async (dateStr) => {
      const dayStart = new Date(dateStr + 'T00:00:00.000Z');
      const dayEnd = new Date(dateStr + 'T23:59:59.999Z');
      
      const [newUsers, totalChats, vipRevenue] = await Promise.all([
        User.count({
          where: { createdAt: { [Op.between]: [dayStart, dayEnd] } }
        }).catch(() => 0),
        
        // Approximate chats from user activity
        User.count({
          where: { lastActiveAt: { [Op.between]: [dayStart, dayEnd] } }
        }).catch(() => 0),
        
        StarTransaction.sum('amount', {
          where: {
            type: 'vip',
            createdAt: { [Op.between]: [dayStart, dayEnd] }
          }
        }).then(sum => sum || 0).catch(() => 0)
      ]);
      
      return {
        date: dateStr,
        newUsers,
        activeUsers: totalChats,
        totalChats,
        vipRevenue,
        lockRevenue: 0,
        positiveRatings: 0,
        negativeRatings: 0
      };
    }));
    
    res.json(data);
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== AUDIT LOGS ====================

app.get('/api/admin/audit-logs', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, category } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const { AdminAuditLog } = require('./models');
    const where = category ? { category } : {};
    
    const logs = await AdminAuditLog.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset
    });
    
    res.json({ logs });
  } catch (error) {
    console.error('Audit logs error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== DATA EXPORT ====================

app.get('/api/admin/export', requireAuth, async (req, res) => {
  try {
    const { table, format = 'csv', limit } = req.query;
    
    if (!table) {
      return res.status(400).json({ error: 'table parameter required' });
    }
    
    const ExportService = require('./services/exportService');
    const AuditService = require('./services/auditService');
    
    const result = await ExportService.exportTable(table, format, {
      limit: limit ? parseInt(limit) : null
    });
    
    // Log the export action
    await AuditService.logExport(req.adminId, table, format, result.recordCount || 0);
    
    // Set appropriate headers based on result
    res.setHeader('Content-Type', result.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${table}_export.${result.extension || 'txt'}"`);
    res.send(result.content);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== MAINTENANCE ====================

app.get('/api/admin/maintenance/status', requireAuth, async (req, res) => {
  try {
    const { AppConfig } = require('./models');
    const { ScheduledMaintenance } = require('./models');
    
    // Get current maintenance status
    const maintenanceConfig = await AppConfig.findOne({ where: { key: 'maintenance_mode' } });
    const enabled = maintenanceConfig ? maintenanceConfig.value === 'true' : false;
    
    // Get scheduled maintenance windows
    const scheduled = await ScheduledMaintenance.findAll({
      where: { status: ['scheduled', 'active'] },
      order: [['startTime', 'ASC']]
    });
    
    res.json({ enabled, scheduled });
  } catch (error) {
    console.error('Maintenance status error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/maintenance/toggle', requireAuth, async (req, res) => {
  try {
    const { enabled } = req.body;
    const { AppConfig } = require('./models');
    const AuditService = require('./services/auditService');
    
    await AppConfig.upsert({
      key: 'maintenance_mode',
      value: String(enabled)
    });
    
    // Log the action
    await AuditService.logMaintenance(req.adminId, enabled ? 'enable' : 'disable');
    
    res.json({ success: true, enabled });
  } catch (error) {
    console.error('Maintenance toggle error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/maintenance/schedule', requireAuth, async (req, res) => {
  try {
    const { title, startTime, endTime, notifyUsers = true } = req.body;
    const { ScheduledMaintenance } = require('./models');
    const AuditService = require('./services/auditService');
    
    const maintenance = await ScheduledMaintenance.create({
      title,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      notifyUsers,
      status: 'scheduled',
      createdBy: req.adminId
    });
    
    // Log the action
    await AuditService.logMaintenance(req.adminId, 'schedule', { title, startTime, endTime });
    
    res.json({ success: true, maintenance });
  } catch (error) {
    console.error('Schedule maintenance error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/maintenance/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { ScheduledMaintenance } = require('./models');
    const AuditService = require('./services/auditService');
    
    const maintenance = await ScheduledMaintenance.findByPk(id);
    if (!maintenance) {
      return res.status(404).json({ error: 'Maintenance window not found' });
    }
    
    await maintenance.update({ status: 'cancelled' });
    
    // Log the action
    await AuditService.logMaintenance(req.adminId, 'cancel', { id, title: maintenance.title });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Cancel maintenance error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== ADDITIONAL USER ENDPOINTS ====================

// Simplified endpoint for banning users
app.post('/api/admin/users/ban', requireAuth, async (req, res) => {
  try {
    const { userId } = req.body;
    await User.update({ banned: true }, { where: { userId } });
    
    const UserCacheService = require('./services/userCacheService');
    await UserCacheService.invalidate(userId);
    
    const MatchingService = require('./services/matchingService');
    await MatchingService.dequeueUser('default', userId);
    
    try {
      const partner = await redisClient.get('pair:' + userId);
      if (partner) {
        await redisClient.del('pair:' + partner);
        await redisClient.del('pair:' + userId);
      }
    } catch (e) {}
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Simplified endpoint for unbanning users
app.post('/api/admin/users/unban', requireAuth, async (req, res) => {
  try {
    const { userId } = req.body;
    await User.update({ banned: false }, { where: { userId } });
    
    const UserCacheService = require('./services/userCacheService');
    await UserCacheService.invalidate(userId);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Give VIP to user
app.post('/api/admin/users/vip', requireAuth, async (req, res) => {
  try {
    const { userId, duration } = req.body;
    const VipService = require('./services/vipService');
    
    let days = 30;
    if (duration === 'lifetime') {
      days = 36500; // ~100 years
    } else {
      days = parseInt(duration) || 30;
    }
    
    const expiry = await VipService.activateVip(userId, days, { source: 'admin_grant' });
    res.json({ success: true, expiresAt: expiry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove VIP from user
app.post('/api/admin/users/vip/remove', requireAuth, async (req, res) => {
  try {
    const { userId } = req.body;
    await VipSubscription.destroy({ where: { userId } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send message to user
app.post('/api/admin/users/message', requireAuth, async (req, res) => {
  try {
    const { userId, message } = req.body;
    
    // Try to get a bot to send the message
    const botTokens = (process.env.BOT_TOKENS || process.env.BOT_TOKEN || '').split(',').filter(Boolean);
    if (botTokens.length > 0) {
      const TelegramBot = require('node-telegram-bot-api');
      const tempBot = new TelegramBot(botTokens[0], { polling: false });
      await tempBot.sendMessage(userId, message, { parse_mode: 'Markdown' });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== BOT REFRESH ENDPOINT ====================

app.post('/api/admin/bots/refresh', requireAuth, async (req, res) => {
  try {
    const { restartAllBots } = require('./bots');
    const result = await restartAllBots();
    if (!result.success) {
      return res.status(429).json({ success: false, error: result.message || 'Cannot restart bots now' });
    }
    res.json({ success: result.success, message: result.message || 'Bots refreshed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/bots/:index/restart', requireAuth, async (req, res) => {
  try {
    const { index } = req.params;
    const botId = `bot_${index}`;
    
    // Toggle disabled off to ensure it starts
    await ConfigService.set(`bot:${botId}:disabled`, 'false');
    
    // Stop then start the single bot
    const { stopSingleBot, startSingleBot } = require('./bots');
    
    await stopSingleBot(botId);
    
    // Wait for Telegram to release connection
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const result = await startSingleBot(parseInt(index));
    
    res.json({ success: result.success, message: result.message || `Bot ${index} restarted` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/bots/:index/start', requireAuth, async (req, res) => {
  try {
    const { index } = req.params;
    const botId = `bot_${index}`;
    
    // Enable the bot
    await ConfigService.set(`bot:${botId}:disabled`, 'false');
    
    // Start just this bot
    const { startSingleBot } = require('./bots');
    const result = await startSingleBot(parseInt(index));
    
    res.json({ success: result.success, message: result.message || `Bot ${index} started` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/bots/:index/stop', requireAuth, async (req, res) => {
  try {
    const { index } = req.params;
    const botId = `bot_${index}`;
    
    console.log(`\n📍 Admin request: Stop ${botId}`);
    
    // Disable the bot in config first
    await ConfigService.set(`bot:${botId}:disabled`, 'true');
    console.log(`   ✅ Config set: ${botId} disabled`);
    
    // Stop just this bot
    const { stopSingleBot, getAllBots } = require('./bots');
    
    // Debug: Log current running bots
    const currentBots = getAllBots();
    console.log(`   📊 Currently running bots: ${currentBots.map(b => b._meta?.botId).join(', ') || 'none'}`);
    
    const result = await stopSingleBot(botId);
    
    // Also try to get the token and delete webhook directly as backup
    try {
      let tokens = [];
      const dbTokens = await ConfigService.get('bot_tokens', null);
      if (dbTokens && typeof dbTokens === 'string') {
        tokens = dbTokens.split(',').map(t => t.trim()).filter(Boolean);
      }
      
      if (tokens[parseInt(index)]) {
        const TelegramBot = require('node-telegram-bot-api');
        const tempBot = new TelegramBot(tokens[parseInt(index)], { polling: false });
        await tempBot.deleteWebHook({ drop_pending_updates: true });
        // Get updates with offset -1 to clear any pending
        try {
          await tempBot.getUpdates({ offset: -1, limit: 1 });
        } catch (e) {}
        console.log(`   ✅ Direct webhook cleanup done for ${botId}`);
      }
    } catch (e) {
      console.log(`   ⚠️ Direct cleanup error: ${e.message}`);
    }
    
    res.json({ success: result.success, message: result.message || `Bot ${index} stopped` });
  } catch (error) {
    console.error(`   ❌ Stop error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== VIP PLANS MANAGEMENT ====================

app.get('/api/admin/vip-plans', requireAuth, async (req, res) => {
  try {
    // Try vip_plans_config first (used by starsPricing.js), fallback to vip_plans
    let plansJson = await ConfigService.get('vip_plans_config', null);
    if (!plansJson) {
      plansJson = await ConfigService.get('vip_plans', null);
    }
    
    let plans = [];
    if (plansJson) {
      try {
        const parsed = typeof plansJson === 'string' ? JSON.parse(plansJson) : plansJson;
        if (Array.isArray(parsed)) {
          // Normalize array format
          plans = parsed.map(p => ({
            id: p.id || String(Date.now()),
            name: p.name || 'VIP Plan',
            duration: p.days || p.duration || 7,
            price: p.stars || p.price || 100,
            features: p.features || [],
            active: p.active !== false && p.enabled !== false
          }));
        }
      } catch (e) {
        console.error('Error parsing VIP plans:', e);
      }
    }
    
    // If no plans found, return defaults
    if (plans.length === 0) {
      plans = [
        { id: 'basic', name: 'Basic', duration: 4, price: 100, features: ['Gender filter', 'Priority matching'], active: true },
        { id: 'plus', name: 'Plus', duration: 7, price: 200, features: ['Gender filter', 'Priority matching', 'Ad-free'], active: true },
        { id: 'pro', name: 'Pro', duration: 30, price: 300, features: ['All features', 'Premium badge'], active: true },
        { id: 'half_year', name: 'Half Year', duration: 182, price: 900, features: ['All features', '6 months'], active: true },
        { id: 'yearly', name: 'Yearly', duration: 365, price: 1500, features: ['All features', '1 year', 'Best value'], active: true }
      ];
    }
    
    res.json({ plans });
  } catch (error) {
    console.error('VIP plans error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/vip-plans/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    let plansJson = await ConfigService.get('vip_plans_config', null);
    if (!plansJson) plansJson = await ConfigService.get('vip_plans', '[]');
    
    const parsed = typeof plansJson === 'string' ? JSON.parse(plansJson) : plansJson;
    const plans = Array.isArray(parsed) ? parsed : [];
    const plan = plans.find(p => p.id === id);
    
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    
    // Normalize response
    res.json({
      id: plan.id,
      name: plan.name,
      duration: plan.days || plan.duration,
      price: plan.stars || plan.price,
      features: plan.features || [],
      active: plan.enabled !== false && plan.active !== false
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/vip-plans', requireAuth, async (req, res) => {
  try {
    const { name, duration, price, features, active } = req.body;
    
    // Get existing plans
    let plansJson = await ConfigService.get('vip_plans_config', null);
    let plans = [];
    if (plansJson) {
      try {
        const parsed = typeof plansJson === 'string' ? JSON.parse(plansJson) : plansJson;
        if (Array.isArray(parsed)) plans = parsed;
      } catch (e) {}
    }
    
    const newPlan = {
      id: name.toLowerCase().replace(/\s+/g, '_'),
      name,
      days: duration,
      stars: price,
      features: features || [],
      enabled: active !== false
    };
    
    plans.push(newPlan);
    
    // Save to vip_plans_config (used by starsPricing.js)
    await ConfigService.set('vip_plans_config', JSON.stringify(plans));
    
    res.json({ success: true, plan: { ...newPlan, duration: newPlan.days, price: newPlan.stars, active: newPlan.enabled } });
  } catch (error) {
    console.error('Create VIP plan error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/vip-plans/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, duration, price, features, active } = req.body;
    
    let plansJson = await ConfigService.get('vip_plans_config', null);
    if (!plansJson) plansJson = await ConfigService.get('vip_plans', '[]');
    
    const parsed = typeof plansJson === 'string' ? JSON.parse(plansJson) : plansJson;
    const plans = Array.isArray(parsed) ? parsed : [];
    
    const planIndex = plans.findIndex(p => p.id === id);
    if (planIndex === -1) return res.status(404).json({ error: 'Plan not found' });
    
    // Update with normalized format for starsPricing.js
    plans[planIndex] = {
      id,
      name,
      days: duration,
      stars: price,
      features: features || [],
      enabled: active !== false
    };
    
    await ConfigService.set('vip_plans_config', JSON.stringify(plans));
    
    res.json({ success: true, plan: { ...plans[planIndex], duration, price, active: plans[planIndex].enabled } });
  } catch (error) {
    console.error('Update VIP plan error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/vip-plans/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    let plansJson = await ConfigService.get('vip_plans_config', null);
    if (!plansJson) plansJson = await ConfigService.get('vip_plans', '[]');
    
    const parsed = typeof plansJson === 'string' ? JSON.parse(plansJson) : plansJson;
    const plans = (Array.isArray(parsed) ? parsed : []).filter(p => p.id !== id);
    
    await ConfigService.set('vip_plans_config', JSON.stringify(plans));
    res.json({ success: true });
  } catch (error) {
    console.error('Delete VIP plan error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== MAINTENANCE WITH NOTIFICATION ====================

app.post('/api/admin/maintenance', requireAuth, async (req, res) => {
  try {
    const { enabled, message, notifyUsers } = req.body;
    const { AppConfig } = require('./models');
    
    await AppConfig.upsert({ key: 'maintenance_mode', value: String(enabled) });
    
    if (message) {
      await ConfigService.set('msg_maintenance', message);
    }
    
    // Notify all online users if enabled
    if (enabled && notifyUsers) {
      try {
        const botTokens = (process.env.BOT_TOKENS || process.env.BOT_TOKEN || '').split(',').filter(Boolean);
        if (botTokens.length > 0) {
          const TelegramBot = require('node-telegram-bot-api');
          const tempBot = new TelegramBot(botTokens[0], { polling: false });
          
          // Get users in active chats and queue (using SCAN)
          const pairKeys = await scanKeys(redisClient, 'pair:*', 100).catch(() => []);
          const userIds = new Set(pairKeys.map(k => k.replace('pair:', '')));
          
          const maintenanceMsg = message || '🔧 Bot is under maintenance. Please try again later.';
          
          for (const userId of userIds) {
            try {
              await tempBot.sendMessage(userId, maintenanceMsg, { parse_mode: 'Markdown' });
            } catch (e) {}
          }
        }
      } catch (e) {
        console.error('Failed to notify users:', e.message);
      }
    }
    
    res.json({ success: true, enabled });
  } catch (error) {
    console.error('Maintenance error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== SYSTEM ACTIONS ====================

// Helper function to scan Redis keys (non-blocking alternative to KEYS)
async function scanRedisKeys(pattern) {
  try {
    return await scanKeys(redisClient, pattern, 100);
  } catch (e) {
    console.error(`Error scanning keys for pattern ${pattern}:`, e.message);
    return [];
  }
}

app.post('/api/admin/system/clear-queues', requireAuth, async (req, res) => {
  try {
    console.log('🗑️ Admin action: Clearing all queues');
    let totalDeleted = 0;
    
    // Clear queue keys
    const queueKeys = await scanRedisKeys('queue:*');
    for (const key of queueKeys) {
      await redisClient.del(key).catch(() => {});
      totalDeleted++;
    }
    
    // Also clear any bot-specific queue keys
    const vipQueueKeys = await scanRedisKeys('*:queue:vip');
    const generalQueueKeys = await scanRedisKeys('*:queue:general');
    for (const key of [...vipQueueKeys, ...generalQueueKeys]) {
      await redisClient.del(key).catch(() => {});
      totalDeleted++;
    }
    
    console.log(`✅ Cleared ${totalDeleted} queue keys`);
    res.json({ success: true, deleted: totalDeleted });
  } catch (error) {
    console.error('Clear queues error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/system/disconnect-all', requireAuth, async (req, res) => {
  try {
    console.log('❌ Admin action: Disconnecting all chats');
    const pairKeys = await scanRedisKeys('pair:*');
    const disconnected = Math.floor(pairKeys.length / 2);
    
    for (const key of pairKeys) {
      await redisClient.del(key).catch(() => {});
    }
    
    console.log(`✅ Disconnected ${disconnected} pairs (${pairKeys.length} keys)`);
    res.json({ success: true, disconnected });
  } catch (error) {
    console.error('Disconnect all error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/system/clear-cache', requireAuth, async (req, res) => {
  try {
    console.log('🧹 Admin action: Clearing cache');
    let totalDeleted = 0;
    
    // Clear user cache keys
    const cacheKeys = await scanRedisKeys('cache:*');
    for (const key of cacheKeys) {
      await redisClient.del(key).catch(() => {});
      totalDeleted++;
    }
    
    // Also clear channel verification cache
    const channelKeys = await scanRedisKeys('channel:*');
    for (const key of channelKeys) {
      await redisClient.del(key).catch(() => {});
      totalDeleted++;
    }
    
    // Clear user cache keys in UserCacheService format
    const userCacheKeys = await scanRedisKeys('user:*');
    for (const key of userCacheKeys) {
      await redisClient.del(key).catch(() => {});
      totalDeleted++;
    }
    
    console.log(`✅ Cleared ${totalDeleted} cache keys`);
    res.json({ success: true, deleted: totalDeleted });
  } catch (error) {
    console.error('Clear cache error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== LOCK CHAT MANAGEMENT ====================

app.get('/api/admin/lock-chat/stats', requireAuth, async (req, res) => {
  try {
    const LockChatService = require('./services/lockChatService');
    const LockHistory = require('./models/lockChatModel');
    const { Op } = require('sequelize');
    
    // Get active locks from Redis
    const activeLocks = await LockChatService.getActiveLocks();
    
    // Get locks created today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const locksToday = await LockHistory.count({
      where: {
        createdAt: { [Op.gte]: today }
      }
    });
    
    // Get recent history
    const recentHistory = await LockHistory.findAll({
      order: [['createdAt', 'DESC']],
      limit: 20
    });
    
    res.json({
      activeLocks: activeLocks.length,
      activeLocksDetail: activeLocks,
      locksToday,
      recentHistory: recentHistory.map(h => h.toJSON())
    });
  } catch (error) {
    console.error('Lock chat stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/lock-chat/grant-credits', requireAuth, async (req, res) => {
  try {
    const { telegramId, minutes } = req.body;
    if (!telegramId || !minutes) {
      return res.status(400).json({ error: 'telegramId and minutes required' });
    }
    
    const LockCredit = require('./models/lockCreditModel');
    const credit = await LockCredit.create({
      telegramId: BigInt(telegramId),
      minutes: parseInt(minutes),
      consumed: 0
    });
    
    res.json({ success: true, credit: { id: credit.id.toString(), minutes: credit.minutes } });
  } catch (error) {
    console.error('Grant lock credits error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/lock-chat/credits/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const LockCredit = require('./models/lockCreditModel');
    const { Op } = require('sequelize');
    const { sequelize } = require('./database/connectionPool');
    
    // Get all credits where consumed < minutes
    const credits = await LockCredit.findAll({
      where: {
        telegramId: BigInt(userId),
        consumed: { [Op.lt]: sequelize.col('minutes') }
      }
    });
    
    const totalMinutes = credits.reduce((sum, c) => sum + (c.minutes - c.consumed), 0);
    
    res.json({
      userId,
      totalMinutes,
      credits: credits.map(c => ({
        id: c.id.toString(),
        minutes: c.minutes,
        consumed: c.consumed,
        available: c.minutes - c.consumed
      }))
    });
  } catch (error) {
    console.error('Check credits error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/lock-chat/remove', requireAuth, async (req, res) => {
  try {
    const { chatId, userId } = req.body;
    if (!chatId || !userId) {
      return res.status(400).json({ error: 'chatId and userId required' });
    }
    
    // Remove from Redis
    const key = `chat:locks:${chatId}:${userId}`;
    await redisClient.del(key).catch(() => {});
    await redisClient.del(`lock:timer:${chatId}:${userId}`).catch(() => {});
    
    res.json({ success: true });
  } catch (error) {
    console.error('Remove lock error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== AUDIT LOGS ====================

app.get('/api/admin/audit-logs', requireAuth, async (req, res) => {
  try {
    const { category, limit = 50 } = req.query;
    
    // Try to get from AuditLog model, or return empty
    try {
      const { AuditLog } = require('./models');
      const where = category ? { category } : {};
      const logs = await AuditLog.findAll({
        where,
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit)
      });
      res.json({ logs });
    } catch (e) {
      // Model might not exist, return empty
      res.json({ logs: [] });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== SERVE ADMIN PANEL ====================

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// ==================== HEALTH CHECK ENDPOINT ====================

app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    checks: {}
  };
  
  // Check database connection
  try {
    await sequelize.authenticate();
    health.checks.database = { status: 'ok', type: process.env.POSTGRES_URI ? 'postgresql' : 'sqlite' };
  } catch (err) {
    health.checks.database = { status: 'error', message: err.message };
    health.status = 'degraded';
  }
  
  // Check Redis connection
  try {
    await redisClient.ping();
    health.checks.redis = { status: 'ok' };
  } catch (err) {
    health.checks.redis = { status: 'error', message: err.message || 'Connection failed' };
    health.status = 'degraded';
  }
  
  // Get pool stats if available
  try {
    const pool = sequelize.connectionManager.pool;
    if (pool) {
      health.checks.connectionPool = {
        size: pool.size || 0,
        available: pool.available || 0,
        pending: pool.pending || 0,
        max: pool.max || 100
      };
    }
  } catch (e) {
    // Pool stats not available
  }
  
  // Active sessions count (using SCAN)
  try {
    const sessionKeys = await scanKeys(redisClient, SESSION_PREFIX + '*', 50).catch(() => []);
    health.checks.activeSessions = sessionKeys.length + memorySessionsFallback.size;
  } catch (e) {
    health.checks.activeSessions = memorySessionsFallback.size;
  }
  
  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Detailed health for internal monitoring
app.get('/health/detailed', requireAuth, async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    memory: {
      ...process.memoryUsage(),
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024)
    },
    checks: {}
  };
  
  // Database health with more detail
  try {
    const start = Date.now();
    await sequelize.authenticate();
    const latency = Date.now() - start;
    
    const pool = sequelize.connectionManager.pool;
    health.checks.database = {
      status: 'ok',
      type: process.env.POSTGRES_URI ? 'postgresql' : 'sqlite',
      latencyMs: latency,
      pool: pool ? {
        size: pool.size || 0,
        available: pool.available || 0,
        pending: pool.pending || 0,
        max: pool.max || 100,
        utilizationPercent: pool.size ? Math.round((pool.size - (pool.available || 0)) / pool.size * 100) : 0
      } : null
    };
  } catch (err) {
    health.checks.database = { status: 'error', message: err.message };
    health.status = 'degraded';
  }
  
  // Redis health
  try {
    const start = Date.now();
    await redisClient.ping();
    const latency = Date.now() - start;
    
    // Get some stats
    let queueSize = 0;
    try {
      const queuePatterns = ['queue:vip', 'queue:free', 'queue:general'];
      for (const q of queuePatterns) {
        queueSize += await redisClient.lLen(q).catch(() => 0) || 0;
      }
    } catch (e) {}
    
    health.checks.redis = {
      status: 'ok',
      latencyMs: latency,
      queueSize
    };
  } catch (err) {
    health.checks.redis = { status: 'error', message: err.message || 'Connection failed' };
    health.status = 'degraded';
  }
  
  // User stats
  try {
    const [totalUsers, activeToday] = await Promise.all([
      User.count(),
      User.count({ where: { lastActiveAt: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }).catch(() => 0)
    ]);
    health.checks.users = { total: totalUsers, activeToday };
  } catch (e) {
    health.checks.users = { error: e.message };
  }
  
  // Rate limiting stats
  health.checks.rateLimiting = {
    blockedIPs: loginAttempts.size,
    memorySessionsFallback: memorySessionsFallback.size
  };
  
  res.json(health);
});

// ==================== START SERVER ====================

let server = null;

async function startAdminServer() {
  try {
    await sequelize.authenticate();
    console.log('✅ Admin Panel DB Connected');
    
    return new Promise((resolve, reject) => {
      server = app.listen(PORT, () => {
        console.log(`🔐 Admin Panel running at http://localhost:${PORT}/admin`);
        resolve(server);
      });
      
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`⚠️ Port ${PORT} already in use. Admin panel may already be running.`);
          // Don't reject/exit - just log and continue (bots can still work)
          resolve(null);
        } else {
          console.error('❌ Admin Panel server error:', err);
          reject(err);
        }
      });
    });
  } catch (error) {
    console.error('❌ Admin Panel DB connection failed:', error);
    throw error;
  }
}

async function stopAdminServer() {
  if (server) {
    return new Promise((resolve) => {
      server.close((err) => {
        if (err) {
          console.error('Error closing admin server:', err);
        } else {
          console.log('✅ Admin Panel server stopped');
        }
        server = null;
        resolve();
      });
    });
  }
}

// ==================== GLOBAL ERROR HANDLER ====================
// Catch-all error handler to prevent crashes from unhandled errors
app.use((err, req, res, next) => {
  console.error('❌ Unhandled Express error:', err.message);
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Handle unhandled promise rejections in Express context
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection in admin-server:', reason);
});

// Only start if run directly
if (require.main === module) {
  startAdminServer();
}

module.exports = { app, startAdminServer, stopAdminServer };
