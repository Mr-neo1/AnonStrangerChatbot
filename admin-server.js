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
        { telegramId: { [Op.like]: `%${search}%` } },
        { username: { [Op.like]: `%${search}%` } },
        { firstName: { [Op.like]: `%${search}%` } }
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
      attributes: ['userId', 'telegramId', 'username', 'firstName', 'lastName', 'gender', 'age', 'banned', 'totalChats', 'createdAt', 'botId']
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
    
    // Log audit
    const AuditService = require('./services/auditService');
    await AuditService.log({
      adminId: req.adminId,
      category: 'user',
      action: 'ban',
      targetType: 'user',
      targetId: userId,
      success: true
    });
    
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
    
    // Log audit
    const AuditService = require('./services/auditService');
    await AuditService.log({
      adminId: req.adminId,
      category: 'user',
      action: 'unban',
      targetType: 'user',
      targetId: userId,
      success: true
    });
    
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
    
    // Log audit
    const AuditService = require('./services/auditService');
    await AuditService.log({
      adminId: req.adminId,
      category: 'user',
      action: 'grant_vip',
      targetType: 'user',
      targetId: userId,
      newValue: `${days || 30} days`,
      success: true
    });
    
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

// Spy on chat - get recent messages between two users
app.post('/api/admin/spy-chat', requireAuth, async (req, res) => {
  try {
    const { userId, partnerId } = req.body;
    
    if (!userId || !partnerId) {
      return res.status(400).json({ error: 'userId and partnerId required' });
    }
    
    // Get recent chat messages from the Chat model
    const { Chat } = require('./models');
    const { Op } = require('sequelize');
    
    // Find active or recent chat between these users
    const chat = await Chat.findOne({
      where: {
        [Op.or]: [
          { user1: String(userId), user2: String(partnerId) },
          { user1: String(partnerId), user2: String(userId) }
        ]
      },
      order: [['createdAt', 'DESC']]
    });
    
    if (!chat) {
      return res.json({ recentMessages: [], chatId: null, note: 'No chat found between these users' });
    }
    
    // Try to get message history from Redis (if cached)
    const messagesKey = `chat:messages:${chat.id}`;
    let messages = [];
    
    try {
      const cachedMessages = await redisClient.lRange(messagesKey, -20, -1).catch(() => []);
      messages = (cachedMessages || []).map(m => {
        try { return JSON.parse(m); } catch { return null; }
      }).filter(Boolean);
    } catch (e) {
      // No cached messages
    }
    
    // If no cached messages, return chat info
    res.json({ 
      recentMessages: messages,
      chatId: chat.id,
      startedAt: chat.createdAt,
      active: chat.active,
      messageCount: chat.messageCount || 0,
      note: messages.length ? null : 'Message history not available (not cached)'
    });
    
  } catch (error) {
    console.error('Spy chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remove user from search queue
app.post('/api/admin/quick/remove-from-queue', requireAuth, async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    
    // Remove from all queues
    const queues = ['queue:vip', 'queue:free', 'queue:general', 'queue:vip:any'];
    let removed = false;
    
    for (const queue of queues) {
      const result = await redisClient.lRem(queue, 0, String(userId)).catch(() => 0);
      if (result > 0) removed = true;
    }
    
    // Also try with MatchingService
    try {
      const MatchingService = require('./services/matchingService');
      await MatchingService.dequeueUser('default', userId);
    } catch (e) {}
    
    res.json({ 
      success: true, 
      removed,
      message: removed ? 'User removed from queue' : 'User was not in any queue'
    });
  } catch (error) {
    console.error('Remove from queue error:', error);
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
    
    // Get user counts per bot and active chats
    const userCounts = await User.findAll({
      attributes: ['botId', [sequelize.fn('COUNT', sequelize.col('userId')), 'count']],
      group: ['botId'],
      raw: true
    }).catch(() => []);
    const countMap = {};
    for (const row of userCounts) {
      countMap[row.botId] = parseInt(row.count) || 0;
    }
    
    // Get today's chats per bot
    const { Chat } = require('./models');
    const { Op } = require('sequelize');
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const chatCounts = await sequelize.query(
      `SELECT u."botId", COUNT(c.id) as count FROM "Chats" c 
       JOIN "User" u ON c."user1" = u."userId" 
       WHERE c."createdAt" >= :todayStart
       GROUP BY u."botId"`,
      { replacements: { todayStart }, type: sequelize.QueryTypes.SELECT }
    ).catch(() => []);
    const chatMap = {};
    for (const row of chatCounts) {
      chatMap[row.botId] = parseInt(row.count) || 0;
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
        userCount: countMap[botId] || 0,
        todayChats: chatMap[botId] || 0
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
    const { message, audience, target, mediaType, botId } = req.body;
    const actualAudience = audience || target || 'all'; // Support both audience and target
    const mediaFile = req.file;
    
    if (!message && !mediaFile) {
      return res.status(400).json({ error: 'Message or media required' });
    }
    
    // Build broadcast data
    const broadcastData = {
      message: message || '',
      audience: actualAudience,
      botId: botId || null, // Filter by specific bot
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
    
    // Log audit
    const AuditService = require('./services/auditService');
    await AuditService.log({
      adminId: req.adminId,
      category: 'broadcast',
      action: 'send',
      targetType: 'audience',
      targetId: actualAudience,
      details: { botId: botId || 'all', hasMedia: !!mediaFile },
      success: true
    });
    
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
    
    const { User, VipSubscription, StarTransaction, Chat, LockHistory } = require('./models');
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
      
      const [newUsers, totalChats, vipRevenue, lockRevenue, activeUsers] = await Promise.all([
        // New users registered on this day
        User.count({
          where: { createdAt: { [Op.between]: [dayStart, dayEnd] } }
        }).catch(() => 0),
        
        // Total chats started on this day
        Chat.count({
          where: { createdAt: { [Op.between]: [dayStart, dayEnd] } }
        }).catch(() => 0),
        
        // VIP revenue (stars) - use payload to identify VIP payments
        StarTransaction.sum('amount', {
          where: {
            payload: { [Op.like]: '%vip%' },
            createdAt: { [Op.between]: [dayStart, dayEnd] }
          }
        }).then(sum => sum || 0).catch(() => 0),
        
        // Lock revenue (stars) - use payload to identify lock payments
        StarTransaction.sum('amount', {
          where: {
            payload: { [Op.like]: '%lock%' },
            createdAt: { [Op.between]: [dayStart, dayEnd] }
          }
        }).then(sum => sum || 0).catch(() => 0),
        
        // Active users (users who had chats on this day)
        Chat.count({
          where: { createdAt: { [Op.between]: [dayStart, dayEnd] } },
          col: 'user1',
          distinct: true
        }).catch(() => 0)
      ]);
      
      return {
        date: dateStr,
        newUsers,
        activeUsers,
        totalChats,
        vipRevenue,
        lockRevenue,
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

// Gender analytics
app.get('/api/admin/analytics/gender', requireAuth, async (req, res) => {
  try {
    const { User } = require('./models');
    const { sequelize } = require('./database/connectionPool');
    
    const results = await User.findAll({
      attributes: ['gender', [sequelize.fn('COUNT', sequelize.col('userId')), 'count']],
      group: ['gender'],
      raw: true
    }).catch(() => []);
    
    const counts = { male: 0, female: 0, other: 0 };
    for (const row of results) {
      const g = (row.gender || '').toLowerCase();
      if (g === 'male') counts.male = parseInt(row.count) || 0;
      else if (g === 'female') counts.female = parseInt(row.count) || 0;
      else counts.other += parseInt(row.count) || 0;
    }
    
    res.json(counts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bot usage analytics
app.get('/api/admin/analytics/bots', requireAuth, async (req, res) => {
  try {
    const { User } = require('./models');
    const { sequelize } = require('./database/connectionPool');
    
    const results = await User.findAll({
      attributes: ['botId', [sequelize.fn('COUNT', sequelize.col('userId')), 'count']],
      group: ['botId'],
      order: [[sequelize.fn('COUNT', sequelize.col('userId')), 'DESC']],
      raw: true
    }).catch(() => []);
    
    res.json(results.map(r => ({
      botId: r.botId || 'Unknown',
      count: parseInt(r.count) || 0
    })));
  } catch (error) {
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
    
    // Get user's bot preference
    const user = await User.findOne({ where: { userId }, attributes: ['botId'] });
    const userBotId = user?.botId;
    
    // Try to use the running bots first
    try {
      const { getAllBots } = require('./bots');
      const bots = getAllBots() || [];
      
      // Find the user's preferred bot or use first available
      let bot = null;
      if (userBotId && bots.length > 0) {
        bot = bots.find(b => b._meta?.botId === userBotId);
      }
      if (!bot && bots.length > 0) {
        bot = bots[0];
      }
      
      if (bot) {
        await bot.sendMessage(userId, `📢 *Admin Message*\n\n${message}`, { parse_mode: 'Markdown' });
        return res.json({ success: true, via: 'running_bot' });
      }
    } catch (e) {
      // Fall through to direct token
    }
    
    // Fallback: Try to use bot token directly
    const botTokens = (process.env.BOT_TOKENS || process.env.BOT_TOKEN || '').split(',').filter(Boolean);
    if (botTokens.length > 0) {
      const TelegramBot = require('node-telegram-bot-api');
      const tempBot = new TelegramBot(botTokens[0], { polling: false });
      await tempBot.sendMessage(userId, `📢 *Admin Message*\n\n${message}`, { parse_mode: 'Markdown' });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sync usernames from Telegram API
app.post('/api/admin/users/sync-usernames', requireAuth, async (req, res) => {
  try {
    const { limit = 500 } = req.body;
    
    // Get users without usernames (use Op.or for both null and empty string)
    const usersToSync = await User.findAll({
      where: { 
        [Op.or]: [
          { username: null },
          { username: '' }
        ]
      },
      limit: parseInt(limit),
      order: [['createdAt', 'DESC']],
      attributes: ['userId', 'telegramId']
    });
    
    if (usersToSync.length === 0) {
      return res.json({ success: true, updated: 0, message: 'All users already have usernames' });
    }
    
    // Get bot to fetch user info
    const { getAllBots } = require('./bots');
    const bots = getAllBots();
    
    if (!bots || bots.length === 0) {
      return res.status(503).json({ error: 'No bots available' });
    }
    
    const bot = bots[0];
    let updated = 0;
    let failed = 0;
    
    // Process in batches to avoid rate limits
    for (const user of usersToSync) {
      try {
        // Use telegramId if available, otherwise userId (they're typically the same)
        const tgId = user.telegramId || user.userId;
        const chat = await bot.getChat(tgId);
        if (chat.username || chat.first_name) {
          await User.update({
            username: chat.username || null,
            firstName: chat.first_name || null,
            lastName: chat.last_name || null
          }, { where: { userId: user.userId } });
          updated++;
        }
      } catch (e) {
        // User blocked bot or doesn't exist
        failed++;
      }
      
      // Rate limit: 100ms between requests
      await new Promise(r => setTimeout(r, 100));
    }
    
    res.json({ 
      success: true, 
      updated, 
      failed,
      total: usersToSync.length,
      message: `Synced ${updated} usernames (${failed} failed)`
    });
  } catch (error) {
    console.error('Sync usernames error:', error);
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

// ==================== MASS USER MANAGEMENT ====================

app.post('/api/admin/users/mass-unban', requireAuth, async (req, res) => {
  try {
    const AuditService = require('./services/auditService');
    const { userIds, all } = req.body;
    let count = 0;
    
    if (all === true) {
      // Unban all banned users
      const result = await User.update({ banned: false }, { where: { banned: true } });
      count = result[0];
    } else if (Array.isArray(userIds) && userIds.length > 0) {
      // Unban specific users
      const result = await User.update({ banned: false }, { where: { userId: { [Op.in]: userIds } } });
      count = result[0];
    } else {
      return res.status(400).json({ error: 'Provide userIds array or all=true' });
    }
    
    await AuditService.log({ adminId: req.adminId, category: 'user', action: all ? 'mass_unban_all' : 'mass_unban', details: { count }, success: true }).catch(() => {});
    res.json({ success: true, count });
  } catch (error) {
    console.error('Mass unban error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/users/mass-ban', requireAuth, async (req, res) => {
  try {
    const AuditService = require('./services/auditService');
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds array required' });
    }
    
    const result = await User.update({ banned: true }, { where: { userId: { [Op.in]: userIds } } });
    await AuditService.log({ adminId: req.adminId, category: 'user', action: 'mass_ban', details: { count: result[0] }, success: true }).catch(() => {});
    res.json({ success: true, count: result[0] });
  } catch (error) {
    console.error('Mass ban error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/users/mass-vip', requireAuth, async (req, res) => {
  try {
    const AuditService = require('./services/auditService');
    const { userIds, days } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0 || !days) {
      return res.status(400).json({ error: 'userIds array and days required' });
    }
    
    let count = 0;
    for (const userId of userIds) {
      try {
        await VipService.activateVip(userId, parseInt(days), { source: 'admin_mass_grant' });
        count++;
      } catch (err) {
        console.error(`Failed to grant VIP to ${userId}:`, err.message);
      }
    }
    
    await AuditService.logUserAction(req.adminId, 'mass_vip_grant', `Granted ${days} days VIP to ${count} users`, { count, days, userIds }, req);
    res.json({ success: true, count });
  } catch (error) {
    console.error('Mass VIP grant error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== REFERRAL MANAGEMENT ====================

app.get('/api/admin/referrals/stats', requireAuth, async (req, res) => {
  try {
    const { Referral } = require('./models');
    
    const total = await Referral.count();
    const accepted = await Referral.count({ where: { status: 'accepted' } });
    const pending = await Referral.count({ where: { status: 'pending' } });
    
    // Top inviters
    const topInviters = await sequelize.query(
      `SELECT "inviterId", COUNT(*) as count FROM "Referrals" WHERE status = 'accepted' GROUP BY "inviterId" ORDER BY count DESC LIMIT 10`,
      { type: sequelize.QueryTypes.SELECT }
    );
    
    // Enrich with user data
    const enriched = await Promise.all(topInviters.map(async (inv) => {
      const user = await User.findOne({ where: { userId: inv.inviterId }, attributes: ['userId', 'telegramId', 'username', 'firstName'] });
      return { ...inv, user: user ? user.toJSON() : null };
    }));
    
    res.json({ total, accepted, pending, topInviters: enriched });
  } catch (error) {
    console.error('Referral stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/referrals', requireAuth, async (req, res) => {
  try {
    const { Referral } = require('./models');
    const { status, limit = 100, offset = 0 } = req.query;
    
    const where = {};
    if (status) where.status = status;
    
    const referrals = await Referral.findAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']],
      include: [
        { model: User, as: 'inviter', attributes: ['userId', 'telegramId', 'username', 'firstName'] },
        { model: User, as: 'invited', attributes: ['userId', 'telegramId', 'username', 'firstName'] }
      ]
    });
    
    const total = await Referral.count({ where });
    res.json({ referrals, total });
  } catch (error) {
    console.error('Referrals list error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== USER ACTIVITY INSIGHTS ====================

app.get('/api/admin/users/:userId/activity', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { Chat, StarTransaction, VipSubscription, Referral } = require('./models');
    
    const user = await User.findOne({ where: { userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    // Chat stats
    const totalChats = await Chat.count({ where: { [Op.or]: [{ user1: userId }, { user2: userId }] } });
    
    // Payment history
    const payments = await StarTransaction.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit: 20
    });
    
    // VIP history
    const vipSubs = await VipSubscription.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit: 5
    });
    
    // Referrals made
    const referralsMade = await Referral.count({ where: { inviterId: userId, status: 'accepted' } });
    
    // Referred by
    const referredBy = await Referral.findOne({
      where: { invitedId: userId, status: 'accepted' },
      include: [{ model: User, as: 'inviter', attributes: ['userId', 'telegramId', 'username', 'firstName'] }]
    });
    
    res.json({
      user: user.toJSON(),
      totalChats,
      payments: payments.map(p => p.toJSON()),
      vipSubs: vipSubs.map(v => v.toJSON()),
      referralsMade,
      referredBy: referredBy ? referredBy.toJSON() : null
    });
  } catch (error) {
    console.error('User activity error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== LOCK CHAT ANALYTICS ====================

app.get('/api/admin/lock-chat/analytics', requireAuth, async (req, res) => {
  try {
    const LockChatService = require('./services/lockChatService');
    const LockHistory = require('./models/lockChatModel');
    const { StarTransaction } = require('./models');
    
    // Active locks
    const activeLocks = await LockChatService.getActiveLocks();
    
    // Total lock purchases
    const totalLocks = await LockHistory.count();
    
    // Revenue from locks (stars paid)
    const lockRevenue = await LockHistory.sum('starsPaid', {
      where: { starsPaid: { [Op.ne]: null } }
    }) || 0;
    
    // Locks by duration (from LockHistory table)
    const locksByDuration = await sequelize.query(
      `SELECT "durationMinutes", COUNT(*) as count FROM "Locks" WHERE "durationMinutes" IS NOT NULL GROUP BY "durationMinutes" ORDER BY "durationMinutes"`,
      { type: sequelize.QueryTypes.SELECT }
    ).catch(() => []);
    
    // Recent locks
    const recentLocks = await LockHistory.findAll({
      limit: 20,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'chatId', 'userId', 'durationMinutes', 'starsPaid', 'createdAt', 'expiresAt']
    });
    
    res.json({
      activeLocks: activeLocks.length,
      totalLocks,
      lockRevenue,
      locksByDuration,
      recentLocks: recentLocks.map(l => l.toJSON())
    });
  } catch (error) {
    console.error('Lock chat analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== REVENUE ANALYTICS ====================

app.get('/api/admin/analytics/revenue', requireAuth, async (req, res) => {
  try {
    const { StarTransaction, VipSubscription } = require('./models');
    const LockHistory = require('./models/lockChatModel');
    
    // Total revenue from stars (all transactions are considered successful once recorded)
    const totalStarsRevenue = await StarTransaction.sum('amount') || 0;
    
    // VIP revenue (use StarTransaction payload to identify VIP payments)
    const vipRevenue = await StarTransaction.sum('amount', {
      where: { payload: { [Op.like]: '%vip%' } }
    }) || 0;
    
    // Lock chat revenue (from Locks table starsPaid)
    const lockRevenue = await LockHistory.sum('starsPaid', {
      where: { starsPaid: { [Op.ne]: null } }
    }).catch(() => 0) || 0;
    
    // Revenue by bot
    const revenueByBot = await sequelize.query(
      `SELECT u."botId", COUNT(DISTINCT st.id) as transactions, SUM(st.amount) as revenue 
       FROM "StarTransactions" st 
       JOIN "User" u ON st."userId" = u."userId" 
       GROUP BY u."botId"`,
      { type: sequelize.QueryTypes.SELECT }
    );
    
    // Revenue trend (last 30 days)
    const revenueTrend = await sequelize.query(
      `SELECT DATE(st."createdAt") as date, SUM(st.amount) as revenue, COUNT(*) as transactions
       FROM "StarTransactions" st 
       WHERE st."createdAt" > NOW() - INTERVAL '30 days'
       GROUP BY DATE(st."createdAt") 
       ORDER BY date DESC`,
      { type: sequelize.QueryTypes.SELECT }
    );
    
    res.json({
      totalStarsRevenue,
      vipRevenue,
      lockRevenue,
      revenueByBot,
      revenueTrend
    });
  } catch (error) {
    console.error('Revenue analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== BOT ANALYTICS ====================

app.get('/api/admin/bots/:botId/stats', requireAuth, async (req, res) => {
  try {
    const { botId } = req.params;
    const { Chat, StarTransaction, VipSubscription } = require('./models');
    
    // User count
    const userCount = await User.count({ where: { botId } });
    
    // Chat count
    const chatCount = await Chat.count({
      where: {
        [Op.or]: [
          { '$firstUser.botId$': botId },
          { '$secondUser.botId$': botId }
        ]
      },
      include: [
        { model: User, as: 'firstUser', attributes: [] },
        { model: User, as: 'secondUser', attributes: [] }
      ]
    });
    
    // Revenue
    const revenue = await sequelize.query(
      `SELECT SUM(st.amount) as total FROM "StarTransactions" st 
       JOIN "User" u ON st."userId" = u."userId" 
       WHERE u."botId" = :botId`,
      { replacements: { botId }, type: sequelize.QueryTypes.SELECT }
    );
    
    res.json({
      botId,
      userCount,
      chatCount,
      revenue: revenue[0]?.total || 0
    });
  } catch (error) {
    console.error('Bot stats error:', error);
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

// ==================== MONITORING DASHBOARD ====================

app.get('/api/admin/monitoring/health', requireAuth, async (req, res) => {
  try {
    const memUsage = process.memoryUsage();
    const cpus = require('os').cpus();
    
    // Mock CPU usage (in production, use proper monitoring)
    const cpuUsage = Math.round(Math.random() * 40 + 20); // 20-60%
    
    // Get bot statuses
    const bots = [
      { name: 'Bot 1', isRunning: true, uptime: process.uptime(), requestCount: Math.floor(Math.random() * 10000) },
      { name: 'Bot 2', isRunning: true, uptime: process.uptime(), requestCount: Math.floor(Math.random() * 10000) },
      { name: 'Bot 3', isRunning: true, uptime: process.uptime(), requestCount: Math.floor(Math.random() * 10000) },
      { name: 'Bot 4', isRunning: true, uptime: process.uptime(), requestCount: Math.floor(Math.random() * 10000) },
      { name: 'Bot 5', isRunning: true, uptime: process.uptime(), requestCount: Math.floor(Math.random() * 10000) }
    ];
    
    // Generate mock metrics (in production, collect real metrics)
    const now = Date.now();
    const labels = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now - (11 - i) * 5 * 60 * 1000);
      return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    });
    
    const requestRate = {
      labels,
      values: Array.from({ length: 12 }, () => Math.floor(Math.random() * 50 + 10))
    };
    
    const responseTime = {
      labels,
      values: Array.from({ length: 12 }, () => Math.floor(Math.random() * 100 + 50))
    };
    
    // Get recent errors from admin audit log (if available)
    const recentErrors = [];
    
    // Get recent system activity
    const recentActivity = [
      { event: 'New user registered', details: 'User ID: 12345', timestamp: new Date(now - 5 * 60 * 1000) },
      { event: 'VIP subscription purchased', details: 'User ID: 67890', timestamp: new Date(now - 10 * 60 * 1000) },
      { event: 'Lock chat activated', details: 'Duration: 30 minutes', timestamp: new Date(now - 15 * 60 * 1000) }
    ];
    
    res.json({
      uptime: process.uptime(),
      memory: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024),
        total: Math.round(memUsage.heapTotal / 1024 / 1024),
        usedPercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
      },
      cpu: {
        usage: cpuUsage,
        cores: cpus.length
      },
      activeConnections: memorySessionsFallback.size,
      bots,
      metrics: {
        requestRate,
        responseTime
      },
      recentErrors,
      recentActivity
    });
  } catch (error) {
    console.error('Monitoring health error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== CSV BULK OPERATIONS ====================

// Export users to CSV
app.get('/api/admin/csv/export-users', requireAuth, async (req, res) => {
  try {
    const { status, botId } = req.query;
    const where = {};
    
    if (status) {
      if (status === 'banned') where.banned = true;
      else if (status === 'active') where.banned = false;
    }
    if (botId) where.botId = botId;
    
    const users = await User.findAll({ where, order: [['createdAt', 'DESC']] });
    
    // Get VIP status for each user
    const vipStatuses = await VipSubscription.findAll({
      where: { 
        userId: { [Op.in]: users.map(u => u.userId) },
        expiresAt: { [Op.gt]: new Date() }
      },
      attributes: ['userId']
    });
    const vipSet = new Set(vipStatuses.map(v => v.userId));
    
    // Generate CSV
    const csvHeader = 'Telegram ID,Username,Gender,Age,Bot ID,VIP,Banned,Created At,Last Active\n';
    const csvRows = users.map(u => 
      `${u.telegramId},"${u.username || ''}",${u.gender || ''},${u.age || ''},${u.botId},${vipSet.has(u.userId) ? 'Yes' : 'No'},${u.banned ? 'Yes' : 'No'},${u.createdAt.toISOString()},${u.lastActiveAt ? u.lastActiveAt.toISOString() : ''}`
    ).join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="users_export_${Date.now()}.csv"`);
    res.send(csvHeader + csvRows);
    
    // Log audit
    const AuditService = require('./services/auditService');
    await AuditService.log({
      adminId: req.adminId,
      category: 'export',
      action: 'export_csv',
      targetType: 'users',
      details: { count: users.length, status, botId },
      success: true
    }).catch(() => {});
  } catch (error) {
    console.error('CSV export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Import users from CSV (ban/unban operations)
app.post('/api/admin/csv/import-actions', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const { action } = req.body; // 'ban' or 'unban'
    const file = req.file;
    
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    if (!['ban', 'unban'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use "ban" or "unban"' });
    }
    
    // Parse CSV
    const csvText = file.buffer.toString('utf-8');
    const lines = csvText.split('\n').filter(line => line.trim());
    const telegramIds = [];
    
    // Skip header if exists
    const startIndex = lines[0].toLowerCase().includes('telegram') ? 1 : 0;
    
    for (let i = startIndex; i < lines.length; i++) {
      const parts = lines[i].split(',');
      const id = parts[0].trim().replace(/"/g, '');
      if (id && !isNaN(id)) telegramIds.push(id);
    }
    
    if (telegramIds.length === 0) {
      return res.status(400).json({ error: 'No valid Telegram IDs found in CSV' });
    }
    
    // Perform action
    const updated = await User.update(
      { banned: action === 'ban' },
      { where: { telegramId: { [Op.in]: telegramIds } } }
    );
    
    // Log audit
    const AuditService = require('./services/auditService');
    await AuditService.log({
      adminId: req.adminId,
      category: 'bulk_action',
      action: `csv_${action}`,
      targetType: 'users',
      details: { count: updated[0], totalIds: telegramIds.length },
      success: true
    }).catch(() => {});
    
    res.json({ success: true, updated: updated[0], total: telegramIds.length });
  } catch (error) {
    console.error('CSV import error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export analytics to CSV
app.get('/api/admin/csv/export-analytics', requireAuth, async (req, res) => {
  try {
    const { Chat, StarTransaction, VipSubscription } = require('./models');
    
    // Get aggregated data
    const [chatStats, starStats, vipStats] = await Promise.all([
      Chat.count({ where: { active: true } }),
      StarTransaction.sum('amount'),
      VipSubscription.count()
    ]);
    
    const totalRevenue = (starStats || 0) * 0.013; // Assuming 1 star = $0.013
    
    // Generate CSV
    const csvHeader = 'Metric,Value\n';
    const csvRows = [
      `Total Active Chats,${chatStats}`,
      `Total Star Transactions,${starStats || 0}`,
      `Total VIP Subscriptions,${vipStats}`,
      `Total Revenue (USD),${totalRevenue.toFixed(2)}`,
      `Export Date,${new Date().toISOString()}`
    ].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="analytics_export_${Date.now()}.csv"`);
    res.send(csvHeader + csvRows);
  } catch (error) {
    console.error('Analytics CSV export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== SCHEDULED BROADCASTS ====================

// In-memory scheduled broadcasts storage (in production, use database)
const scheduledBroadcasts = new Map();
let broadcastIdCounter = 1;

// Create scheduled broadcast
app.post('/api/admin/scheduled-broadcasts', requireAuth, upload.single('media'), async (req, res) => {
  try {
    const { message, audience, scheduledTime, recurring, recurringInterval, botId } = req.body;
    const mediaFile = req.file;
    
    if (!message && !mediaFile) {
      return res.status(400).json({ error: 'Message or media required' });
    }
    
    const scheduledDate = new Date(scheduledTime);
    if (scheduledDate <= new Date()) {
      return res.status(400).json({ error: 'Scheduled time must be in the future' });
    }
    
    const broadcast = {
      id: broadcastIdCounter++,
      message,
      audience: audience || 'all',
      botId: botId || null,
      scheduledTime: scheduledDate,
      recurring: recurring === 'true' || recurring === true,
      recurringInterval: recurring ? recurringInterval : null, // 'daily', 'weekly'
      status: 'pending',
      createdAt: new Date(),
      createdBy: req.adminId,
      media: mediaFile ? {
        buffer: mediaFile.buffer.toString('base64'),
        mimetype: mediaFile.mimetype,
        originalname: mediaFile.originalname
      } : null
    };
    
    scheduledBroadcasts.set(broadcast.id, broadcast);
    
    // Schedule execution
    schedulebroadcastExecution(broadcast);
    
    res.json({ success: true, broadcast: { ...broadcast, media: broadcast.media ? { name: mediaFile.originalname } : null } });
  } catch (error) {
    console.error('Schedule broadcast error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all scheduled broadcasts
app.get('/api/admin/scheduled-broadcasts', requireAuth, async (req, res) => {
  try {
    const broadcasts = Array.from(scheduledBroadcasts.values())
      .map(b => ({
        ...b,
        media: b.media ? { name: b.media.originalname, size: b.media.buffer.length } : null,
        buffer: undefined // Don't send buffer in list
      }))
      .sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));
    
    res.json({ broadcasts });
  } catch (error) {
    console.error('Get scheduled broadcasts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete scheduled broadcast
app.delete('/api/admin/scheduled-broadcasts/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const broadcast = scheduledBroadcasts.get(parseInt(id));
    
    if (!broadcast) {
      return res.status(404).json({ error: 'Broadcast not found' });
    }
    
    // Cancel timeout if exists
    if (broadcast.timeoutId) clearTimeout(broadcast.timeoutId);
    
    scheduledBroadcasts.delete(parseInt(id));
    res.json({ success: true });
  } catch (error) {
    console.error('Delete scheduled broadcast error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to schedule broadcast execution
function schedulebroadcastExecution(broadcast) {
  const delay = new Date(broadcast.scheduledTime) - new Date();
  
  if (delay > 0) {
    const timeoutId = setTimeout(async () => {
      try {
        // Execute broadcast
        const { enqueueBroadcast } = require('./services/queueService');
        
        const broadcastData = {
          message: broadcast.message,
          audience: broadcast.audience,
          botId: broadcast.botId,
          meta: { source: 'scheduled_broadcast', scheduledId: broadcast.id }
        };
        
        if (broadcast.media) {
          broadcastData.media = {
            buffer: broadcast.media.buffer,
            mimetype: broadcast.media.mimetype,
            originalname: broadcast.media.originalname,
            type: broadcast.media.mimetype.startsWith('image/') ? 'photo' : 
                  broadcast.media.mimetype.startsWith('video/') ? 'video' : 'document'
          };
        }
        
        await enqueueBroadcast(broadcastData);
        
        // Update status
        broadcast.status = 'sent';
        broadcast.sentAt = new Date();
        
        // If recurring, schedule next execution
        if (broadcast.recurring) {
          const nextTime = new Date(broadcast.scheduledTime);
          if (broadcast.recurringInterval === 'daily') {
            nextTime.setDate(nextTime.getDate() + 1);
          } else if (broadcast.recurringInterval === 'weekly') {
            nextTime.setDate(nextTime.getDate() + 7);
          }
          
          broadcast.scheduledTime = nextTime;
          broadcast.status = 'pending';
          schedulebroadcastExecution(broadcast);
        } else {
          // Remove non-recurring broadcast after 24 hours
          setTimeout(() => scheduledBroadcasts.delete(broadcast.id), 24 * 60 * 60 * 1000);
        }
      } catch (err) {
        console.error('Scheduled broadcast execution error:', err);
        broadcast.status = 'failed';
        broadcast.error = err.message;
      }
    }, delay);
    
    broadcast.timeoutId = timeoutId;
  }
}

// ==================== BOT CONTROLS ====================

// Get bot status
app.get('/api/admin/bots/status', requireAuth, async (req, res) => {
  try {
    // Get bot tokens from environment
    const botTokens = process.env.BOT_TOKENS ? process.env.BOT_TOKENS.split(',') : [process.env.BOT_TOKEN].filter(Boolean);
    
    const botStatus = botTokens.map((token, index) => ({
      id: index + 1,
      name: `Bot ${index + 1}`,
      token: token.substring(0, 10) + '...',
      isRunning: true, // In PM2 environment, assume running
      uptime: process.uptime(),
      requestCount: Math.floor(Math.random() * 10000)
    }));
    
    res.json({ bots: botStatus });
  } catch (error) {
    console.error('Bot status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Restart specific bot (requires PM2 integration)
app.post('/api/admin/bots/:botId/restart', requireAuth, async (req, res) => {
  try {
    const { botId } = req.params;
    
    // In a real implementation, you'd use PM2 API:
    // const pm2 = require('pm2');
    // pm2.restart('bot-name', callback);
    
    // For now, return success message
    res.json({ 
      success: true, 
      message: `Bot ${botId} restart requested (requires PM2 integration)`,
      note: 'Use PM2 commands: pm2 restart chatbot-system'
    });
  } catch (error) {
    console.error('Bot restart error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update bot configuration
app.put('/api/admin/bots/:botId/config', requireAuth, async (req, res) => {
  try {
    const { botId } = req.params;
    const { setting, value } = req.body;
    
    // Store bot-specific config in database
    const AppConfig = require('./models/appConfigModel');
    await AppConfig.upsert({
      key: `bot_${botId}_${setting}`,
      value: JSON.stringify(value),
      updatedAt: new Date()
    });
    
    res.json({ success: true, setting, value });
  } catch (error) {
    console.error('Bot config update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== ENHANCED ERROR LOGGING ====================

// In-memory error log (last 100 errors)
const errorLog = [];
const MAX_ERROR_LOG_SIZE = 100;

// Global error logger function
function logError(error, context = {}) {
  const errorEntry = {
    id: Date.now(),
    timestamp: new Date(),
    message: error.message,
    stack: error.stack,
    context,
    severity: error.severity || 'error'
  };
  
  errorLog.unshift(errorEntry);
  if (errorLog.length > MAX_ERROR_LOG_SIZE) {
    errorLog.pop();
  }
  
  console.error('Error logged:', errorEntry);
}

// Get error logs
app.get('/api/admin/errors', requireAuth, async (req, res) => {
  try {
    const { severity, limit = 50 } = req.query;
    
    let errors = errorLog;
    if (severity) {
      errors = errors.filter(e => e.severity === severity);
    }
    
    res.json({ errors: errors.slice(0, parseInt(limit)) });
  } catch (error) {
    console.error('Get errors error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear error logs
app.delete('/api/admin/errors', requireAuth, async (req, res) => {
  try {
    const clearedCount = errorLog.length;
    errorLog.length = 0;
    res.json({ success: true, cleared: clearedCount });
  } catch (error) {
    console.error('Clear errors error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export error logs to CSV
app.get('/api/admin/errors/export', requireAuth, async (req, res) => {
  try {
    const csvHeader = 'Timestamp,Severity,Message,Context\n';
    const csvRows = errorLog.map(e => 
      `"${e.timestamp.toISOString()}","${e.severity}","${e.message.replace(/"/g, '""')}","${JSON.stringify(e.context).replace(/"/g, '""')}"`
    ).join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="errors_export_${Date.now()}.csv"`);
    res.send(csvHeader + csvRows);
  } catch (error) {
    console.error('Error export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== FEATURE 1: USER SEARCH & PROFILE ====================
app.get('/api/admin/users/profile/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { Chat, StarTransaction, Referral, ChatRating } = require('./models');
    
    const user = await User.findOne({ where: { userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    // VIP
    const vip = await VipSubscription.findOne({ where: { userId } });
    
    // Transactions
    const transactions = await StarTransaction.findAll({ where: { userId }, order: [['createdAt', 'DESC']], limit: 20 });
    const totalSpent = await StarTransaction.sum('amount', { where: { userId } }) || 0;
    
    // Chats
    const totalChats = await Chat.count({ where: { [Op.or]: [{ user1: userId }, { user2: userId }] } });
    const activeChats = await Chat.count({ where: { [Op.or]: [{ user1: userId }, { user2: userId }], active: true } });
    
    // Referrals
    const referralsMade = await Referral.count({ where: { inviterId: userId } });
    const referredBy = await Referral.findOne({ where: { invitedId: userId, status: 'accepted' } });
    
    // Ratings
    const ratingsGiven = await ChatRating.count({ where: { raterId: userId } });
    const ratingsReceived = await ChatRating.count({ where: { ratedUserId: userId } });
    const positiveRatings = await ChatRating.count({ where: { ratedUserId: userId, ratingType: 'positive' } });
    const negativeRatings = await ChatRating.count({ where: { ratedUserId: userId, ratingType: 'negative' } });
    const reports = await ChatRating.count({ where: { ratedUserId: userId, reportReason: { [Op.ne]: 'none' } } });
    
    // Lock credits
    const { LockCredit } = require('./models');
    const lockCredits = await LockCredit.findAll({ where: { telegramId: userId } });
    const totalLockMinutes = lockCredits.reduce((sum, lc) => sum + (lc.minutes - lc.consumed), 0);
    
    // Ban history
    const { Bans } = require('./models');
    const banHistory = await Bans.findAll({ where: { userId }, order: [['createdAt', 'DESC']], limit: 10 });

    res.json({
      user: user.toJSON(),
      vip: vip ? vip.toJSON() : null,
      transactions: transactions.map(t => t.toJSON()),
      totalSpent,
      totalChats,
      activeChats,
      referralsMade,
      referredBy: referredBy ? referredBy.inviterId : null,
      ratings: { given: ratingsGiven, received: ratingsReceived, positive: positiveRatings, negative: negativeRatings, reports },
      lockCredits: totalLockMinutes,
      banHistory: banHistory.map(b => b.toJSON())
    });
  } catch (error) {
    console.error('User profile error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== FEATURE 2: CHAT LOGS VIEWER ====================
app.get('/api/admin/chatlogs', requireAuth, async (req, res) => {
  try {
    const { Chat } = require('./models');
    const { page = 1, limit = 25, status, userId, sortBy = 'startedAt', sortOrder = 'DESC' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const where = {};
    if (status === 'active') where.active = true;
    else if (status === 'ended') where.active = false;
    if (userId) where[Op.or] = [{ user1: userId }, { user2: userId }];
    
    const { count, rows } = await Chat.findAndCountAll({
      where,
      order: [[sortBy, sortOrder]],
      limit: parseInt(limit),
      offset,
      include: [
        { model: User, as: 'firstUser', attributes: ['userId', 'username', 'firstName', 'banned', 'botId'] },
        { model: User, as: 'secondUser', attributes: ['userId', 'username', 'firstName', 'banned', 'botId'] }
      ]
    });
    
    res.json({ chats: rows, total: count, page: parseInt(page), totalPages: Math.ceil(count / parseInt(limit)) });
  } catch (error) {
    console.error('Chat logs error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/chatlogs/stats', requireAuth, async (req, res) => {
  try {
    const { Chat } = require('./models');
    const totalChats = await Chat.count();
    const activeChats = await Chat.count({ where: { active: true } });
    const todayChats = await Chat.count({ where: { startedAt: { [Op.gte]: new Date(new Date().setHours(0,0,0,0)) } } });
    
    // Average duration of ended chats (raw SQL for performance)
    const [avgResult] = await sequelize.query(
      `SELECT AVG(EXTRACT(EPOCH FROM ("updatedAt" - "startedAt"))) as avg_seconds FROM "Chats" WHERE active = false AND "updatedAt" > "startedAt"`,
      { type: sequelize.QueryTypes.SELECT }
    );
    
    res.json({ totalChats, activeChats, todayChats, avgDurationSeconds: Math.round(avgResult?.avg_seconds || 0) });
  } catch (error) {
    console.error('Chat logs stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== FEATURE 3: ALERTS SYSTEM ====================
const adminAlerts = [];
const MAX_ALERTS = 200;

function addAlert(type, severity, message, details = {}) {
  adminAlerts.unshift({ id: Date.now(), type, severity, message, details, timestamp: new Date(), read: false });
  if (adminAlerts.length > MAX_ALERTS) adminAlerts.pop();
}

// Track error rates for auto-alerts  
let errorRateTracker = { count: 0, lastReset: Date.now() };
const origLogError = logError;
logError = function(error, context) {
  origLogError(error, context);
  errorRateTracker.count++;
  if (errorRateTracker.count > 10 && Date.now() - errorRateTracker.lastReset < 60000) {
    addAlert('error_spike', 'critical', `Error rate spike: ${errorRateTracker.count} errors in last minute`, { count: errorRateTracker.count });
  }
  if (Date.now() - errorRateTracker.lastReset > 60000) {
    errorRateTracker = { count: 0, lastReset: Date.now() };
  }
};

app.get('/api/admin/alerts', requireAuth, async (req, res) => {
  try {
    const unreadCount = adminAlerts.filter(a => !a.read).length;
    res.json({ alerts: adminAlerts.slice(0, 50), unreadCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/alerts/read', requireAuth, async (req, res) => {
  try {
    const { alertIds } = req.body;
    if (alertIds && Array.isArray(alertIds)) {
      alertIds.forEach(id => { const a = adminAlerts.find(a => a.id === id); if (a) a.read = true; });
    } else {
      adminAlerts.forEach(a => a.read = true);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/alerts/clear', requireAuth, async (req, res) => {
  try {
    adminAlerts.length = 0;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== FEATURE 4: BLACKLIST WITH REASONS & TEMP BANS ====================
app.post('/api/admin/users/:userId/ban-with-reason', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason, tempDays } = req.body;
    const { Bans } = require('./models');
    const AuditService = require('./services/auditService');
    
    const user = await User.findOne({ where: { userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    await user.update({ banned: true });
    await Bans.create({ userId, reason: reason || 'No reason provided' });
    
    // If temporary ban, schedule unban
    if (tempDays && tempDays > 0) {
      const unbanAt = new Date(Date.now() + tempDays * 86400000);
      // Store in AppConfig for the cleanup job
      const { AppConfig } = require('./models');
      const tempBans = JSON.parse(await AppConfig.getValue('temp_bans') || '[]');
      tempBans.push({ userId, unbanAt: unbanAt.toISOString(), reason });
      await AppConfig.setValue('temp_bans', JSON.stringify(tempBans));
    }
    
    await AuditService.log({ adminId: req.adminId, category: 'user', action: tempDays ? `temp_ban_${tempDays}d` : 'ban_with_reason', targetId: String(userId), details: { reason, tempDays }, success: true }).catch(() => {});
    addAlert('user_banned', 'info', `User ${userId} banned: ${reason}`, { userId, reason, tempDays });
    
    res.json({ success: true, message: tempDays ? `User banned for ${tempDays} days` : 'User banned permanently' });
  } catch (error) {
    console.error('Ban with reason error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/users/ban-history/:userId', requireAuth, async (req, res) => {
  try {
    const { Bans } = require('./models');
    const bans = await Bans.findAll({ where: { userId: req.params.userId }, order: [['createdAt', 'DESC']] });
    res.json({ bans });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Process temp bans - check and auto-unban
app.post('/api/admin/system/process-temp-bans', requireAuth, async (req, res) => {
  try {
    const { AppConfig } = require('./models');
    const tempBans = JSON.parse(await AppConfig.getValue('temp_bans') || '[]');
    const now = new Date();
    let unbanned = 0;
    
    const remaining = [];
    for (const ban of tempBans) {
      if (new Date(ban.unbanAt) <= now) {
        await User.update({ banned: false }, { where: { userId: ban.userId } });
        unbanned++;
      } else {
        remaining.push(ban);
      }
    }
    
    await AppConfig.setValue('temp_bans', JSON.stringify(remaining));
    res.json({ success: true, unbanned, remaining: remaining.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== FEATURE 5: REVENUE DEEP DIVE ====================
app.get('/api/admin/analytics/revenue-deep', requireAuth, async (req, res) => {
  try {
    const { StarTransaction, Chat } = require('./models');
    const { days = 30 } = req.query;
    const since = new Date(Date.now() - parseInt(days) * 86400000);
    
    // Daily revenue breakdown
    const dailyRevenue = await sequelize.query(
      `SELECT DATE("createdAt") as date, 
              SUM(amount) as revenue, 
              COUNT(*) as transactions,
              SUM(CASE WHEN payload LIKE '%vip%' THEN amount ELSE 0 END) as vip_revenue,
              SUM(CASE WHEN payload LIKE '%lock%' THEN amount ELSE 0 END) as lock_revenue
       FROM "StarTransactions" WHERE "createdAt" >= :since GROUP BY DATE("createdAt") ORDER BY date DESC`,
      { replacements: { since }, type: sequelize.QueryTypes.SELECT }
    );
    
    // ARPU (Average Revenue Per User)
    const [arpuResult] = await sequelize.query(
      `SELECT COUNT(DISTINCT "userId") as paying_users, SUM(amount) as total_revenue FROM "StarTransactions"`,
      { type: sequelize.QueryTypes.SELECT }
    );
    const arpu = arpuResult.paying_users > 0 ? (arpuResult.total_revenue / arpuResult.paying_users).toFixed(2) : 0;
    
    // Revenue by type (VIP vs Lock)
    const [revenueByType] = await sequelize.query(
      `SELECT 
        SUM(CASE WHEN payload LIKE '%vip%' THEN amount ELSE 0 END) as vip_total,
        SUM(CASE WHEN payload LIKE '%lock%' THEN amount ELSE 0 END) as lock_total,
        SUM(amount) as grand_total,
        COUNT(CASE WHEN payload LIKE '%vip%' THEN 1 END) as vip_count,
        COUNT(CASE WHEN payload LIKE '%lock%' THEN 1 END) as lock_count
       FROM "StarTransactions"`,
      { type: sequelize.QueryTypes.SELECT }
    );
    
    // Top spenders
    const topSpenders = await sequelize.query(
      `SELECT st."userId", SUM(st.amount) as total_spent, COUNT(*) as txn_count, u.username, u."firstName"
       FROM "StarTransactions" st LEFT JOIN "User" u ON st."userId" = u."userId"
       GROUP BY st."userId", u.username, u."firstName"
       ORDER BY total_spent DESC LIMIT 10`,
      { type: sequelize.QueryTypes.SELECT }
    );
    
    // Weekly comparison
    const thisWeek = await StarTransaction.sum('amount', { where: { createdAt: { [Op.gte]: new Date(Date.now() - 7 * 86400000) } } }) || 0;
    const lastWeek = await StarTransaction.sum('amount', { where: { createdAt: { [Op.between]: [new Date(Date.now() - 14 * 86400000), new Date(Date.now() - 7 * 86400000)] } } }) || 0;
    const weeklyChange = lastWeek > 0 ? (((thisWeek - lastWeek) / lastWeek) * 100).toFixed(1) : 0;
    
    res.json({ dailyRevenue, arpu, revenueByType, topSpenders, thisWeek, lastWeek, weeklyChange, payingUsers: parseInt(arpuResult.paying_users) || 0 });
  } catch (error) {
    console.error('Revenue deep dive error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== FEATURE 6: BROADCAST TARGETING ====================
app.get('/api/admin/broadcast/audience-count', requireAuth, async (req, res) => {
  try {
    const { target, botId, activeDays, minChats } = req.query;
    let where = { hasStarted: true };
    
    if (target === 'vip') {
      const vipUsers = await VipSubscription.findAll({ where: { expiresAt: { [Op.gte]: new Date() } }, attributes: ['userId'] });
      where.userId = { [Op.in]: vipUsers.map(v => v.userId) };
    } else if (target === 'non_vip') {
      const vipUsers = await VipSubscription.findAll({ where: { expiresAt: { [Op.gte]: new Date() } }, attributes: ['userId'] });
      where.userId = { [Op.notIn]: vipUsers.map(v => v.userId) };
    } else if (target === 'banned') {
      where.banned = true;
    } else if (target === 'active') {
      if (activeDays) {
        where.lastActiveDate = { [Op.gte]: new Date(Date.now() - parseInt(activeDays) * 86400000) };
      }
    }
    
    if (botId && botId !== 'all') where.botId = botId;
    if (minChats) where.totalChats = { [Op.gte]: parseInt(minChats) };
    
    const count = await User.count({ where });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/broadcast/targeted', requireAuth, async (req, res) => {
  try {
    const { message, target, botId, activeDays, minChats, mediaUrl } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    
    let where = { hasStarted: true };
    
    if (target === 'vip') {
      const vipUsers = await VipSubscription.findAll({ where: { expiresAt: { [Op.gte]: new Date() } }, attributes: ['userId'] });
      where.userId = { [Op.in]: vipUsers.map(v => v.userId) };
    } else if (target === 'non_vip') {
      const vipUsers = await VipSubscription.findAll({ where: { expiresAt: { [Op.gte]: new Date() } }, attributes: ['userId'] });
      where.userId = { [Op.notIn]: vipUsers.map(v => v.userId) };
    } else if (target === 'active') {
      if (activeDays) where.lastActiveDate = { [Op.gte]: new Date(Date.now() - parseInt(activeDays) * 86400000) };
    }
    
    if (botId && botId !== 'all') where.botId = botId;
    if (minChats) where.totalChats = { [Op.gte]: parseInt(minChats) };
    
    const users = await User.findAll({ where, attributes: ['userId', 'botId'] });
    
    const AuditService = require('./services/auditService');
    await AuditService.log({ adminId: req.adminId, category: 'broadcast', action: 'targeted_broadcast', details: { target, userCount: users.length, botId }, success: true }).catch(() => {});
    addAlert('broadcast', 'info', `Targeted broadcast sent to ${users.length} users (${target})`, { target, count: users.length });
    
    // Queue broadcast for each user through their bot  
    let sent = 0, failed = 0;
    const botInstances = global.botInstances || [];
    
    for (const user of users) {
      try {
        const botIndex = botInstances.findIndex(b => b && b.botInfo && String(b.botInfo.id) === String(user.botId));
        const bot = botIndex >= 0 ? botInstances[botIndex] : botInstances[0];
        if (bot) {
          await bot.telegram.sendMessage(user.userId, message, { parse_mode: 'HTML' }).catch(() => { failed++; });
          sent++;
        } else { failed++; }
        // Rate limiting
        if (sent % 25 === 0) await new Promise(r => setTimeout(r, 1000));
      } catch { failed++; }
    }
    
    res.json({ success: true, sent, failed, total: users.length });
  } catch (error) {
    console.error('Targeted broadcast error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== FEATURE 7: RATE LIMITING CONTROLS ====================
app.get('/api/admin/config/rate-limits', requireAuth, async (req, res) => {
  try {
    const { AppConfig } = require('./models');
    const limits = {
      maxMessagesPerMinute: parseInt(await AppConfig.getValue('rate_max_messages_per_min') || '30'),
      chatCooldownSeconds: parseInt(await AppConfig.getValue('rate_chat_cooldown_sec') || '5'),
      searchCooldownSeconds: parseInt(await AppConfig.getValue('rate_search_cooldown_sec') || '10'),
      broadcastDelayMs: parseInt(await AppConfig.getValue('rate_broadcast_delay_ms') || '50'),
      maxDailyChats: parseInt(await AppConfig.getValue('rate_max_daily_chats') || '100'),
      spamThreshold: parseInt(await AppConfig.getValue('rate_spam_threshold') || '5'),
      apiRateLimit: parseInt(await AppConfig.getValue('rate_api_limit') || '100'),
      apiRateWindowSec: parseInt(await AppConfig.getValue('rate_api_window_sec') || '60')
    };
    res.json(limits);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/config/rate-limits', requireAuth, async (req, res) => {
  try {
    const { AppConfig } = require('./models');
    const AuditService = require('./services/auditService');
    const fields = req.body;
    const mapping = {
      maxMessagesPerMinute: 'rate_max_messages_per_min',
      chatCooldownSeconds: 'rate_chat_cooldown_sec',
      searchCooldownSeconds: 'rate_search_cooldown_sec',
      broadcastDelayMs: 'rate_broadcast_delay_ms',
      maxDailyChats: 'rate_max_daily_chats',
      spamThreshold: 'rate_spam_threshold',
      apiRateLimit: 'rate_api_limit',
      apiRateWindowSec: 'rate_api_window_sec'
    };
    
    for (const [key, configKey] of Object.entries(mapping)) {
      if (fields[key] !== undefined) {
        await AppConfig.setValue(configKey, String(fields[key]));
      }
    }
    
    await AuditService.log({ adminId: req.adminId, category: 'config', action: 'update_rate_limits', details: fields, success: true }).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== FEATURE 8: A/B TESTING & FEATURE FLAGS UI ====================
app.get('/api/admin/feature-flags', requireAuth, async (req, res) => {
  try {
    const { AppConfig } = require('./models');
    const flags = [
      'ENABLE_STARS_PAYMENTS', 'ENABLE_VIP', 'ENABLE_LOCK_CHAT',
      'ENABLE_REFERRALS', 'ENABLE_ADMIN_ALERTS', 'ENABLE_CROSS_BOT_MATCHING',
      'ENABLE_AFFILIATE_SYSTEM', 'ENABLE_ABUSE_DETECTION', 'MAINTENANCE_MODE'
    ];
    
    const result = {};
    for (const flag of flags) {
      const val = await AppConfig.getValue(flag);
      result[flag] = val === 'true' || val === '1' || (val === null && process.env[flag] === 'true');
    }
    
    // A/B test configs
    const abTests = JSON.parse(await AppConfig.getValue('ab_tests') || '[]');
    
    res.json({ flags: result, abTests });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/feature-flags', requireAuth, async (req, res) => {
  try {
    const { AppConfig } = require('./models');
    const AuditService = require('./services/auditService');
    const { flag, value } = req.body;
    
    await AppConfig.setValue(flag, String(value));
    
    // Refresh feature flag cache
    const featureFlags = require('./config/featureFlags');
    if (featureFlags.invalidateCache) featureFlags.invalidateCache(flag);
    
    await AuditService.log({ adminId: req.adminId, category: 'config', action: 'toggle_feature_flag', details: { flag, value }, success: true }).catch(() => {});
    addAlert('config', 'info', `Feature flag ${flag} set to ${value}`, { flag, value });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/ab-tests', requireAuth, async (req, res) => {
  try {
    const { AppConfig } = require('./models');
    const AuditService = require('./services/auditService');
    const { name, flag, percentage, description } = req.body;
    
    const abTests = JSON.parse(await AppConfig.getValue('ab_tests') || '[]');
    abTests.push({ id: Date.now(), name, flag, percentage: parseInt(percentage), description, active: true, createdAt: new Date() });
    await AppConfig.setValue('ab_tests', JSON.stringify(abTests));
    
    await AuditService.log({ adminId: req.adminId, category: 'config', action: 'create_ab_test', details: { name, flag, percentage }, success: true }).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/ab-tests/:id', requireAuth, async (req, res) => {
  try {
    const { AppConfig } = require('./models');
    const abTests = JSON.parse(await AppConfig.getValue('ab_tests') || '[]');
    const filtered = abTests.filter(t => String(t.id) !== String(req.params.id));
    await AppConfig.setValue('ab_tests', JSON.stringify(filtered));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== FEATURE 9: CUSTOM BOT MESSAGES EDITOR ====================
app.get('/api/admin/bot-messages/all', requireAuth, async (req, res) => {
  try {
    const MessagesService = require('./services/messagesService');
    const messages = MessagesService.getAllMessages ? MessagesService.getAllMessages() : {};
    
    // Group messages by category
    const categories = {};
    for (const [key, value] of Object.entries(messages)) {
      const cat = key.split('_')[0] || 'general';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push({ key, value, category: cat });
    }
    
    res.json({ messages, categories });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/bot-messages/update', requireAuth, async (req, res) => {
  try {
    const { key, value } = req.body;
    const MessagesService = require('./services/messagesService');
    const AuditService = require('./services/auditService');
    
    if (MessagesService.setMessage) {
      await MessagesService.setMessage(key, value);
    } else if (MessagesService.updateMessage) {
      await MessagesService.updateMessage(key, value);
    }
    
    await AuditService.log({ adminId: req.adminId, category: 'config', action: 'update_bot_message', details: { key }, success: true }).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== FEATURE 10: AUTOMATED REPORTS ====================
app.get('/api/admin/reports/config', requireAuth, async (req, res) => {
  try {
    const { AppConfig } = require('./models');
    const config = {
      enabled: (await AppConfig.getValue('reports_enabled')) === 'true',
      frequency: await AppConfig.getValue('reports_frequency') || 'daily',
      telegramChatId: await AppConfig.getValue('reports_telegram_chat_id') || process.env.ADMIN_CHAT_ID || '',
      includeRevenue: (await AppConfig.getValue('reports_include_revenue') || 'true') === 'true',
      includeUsers: (await AppConfig.getValue('reports_include_users') || 'true') === 'true',
      includeChats: (await AppConfig.getValue('reports_include_chats') || 'true') === 'true',
      includeErrors: (await AppConfig.getValue('reports_include_errors') || 'true') === 'true',
      lastSentAt: await AppConfig.getValue('reports_last_sent') || null
    };
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/reports/config', requireAuth, async (req, res) => {
  try {
    const { AppConfig } = require('./models');
    const AuditService = require('./services/auditService');
    const { enabled, frequency, telegramChatId, includeRevenue, includeUsers, includeChats, includeErrors } = req.body;
    
    if (enabled !== undefined) await AppConfig.setValue('reports_enabled', String(enabled));
    if (frequency) await AppConfig.setValue('reports_frequency', frequency);
    if (telegramChatId) await AppConfig.setValue('reports_telegram_chat_id', telegramChatId);
    if (includeRevenue !== undefined) await AppConfig.setValue('reports_include_revenue', String(includeRevenue));
    if (includeUsers !== undefined) await AppConfig.setValue('reports_include_users', String(includeUsers));
    if (includeChats !== undefined) await AppConfig.setValue('reports_include_chats', String(includeChats));
    if (includeErrors !== undefined) await AppConfig.setValue('reports_include_errors', String(includeErrors));
    
    await AuditService.log({ adminId: req.adminId, category: 'config', action: 'update_report_config', details: req.body, success: true }).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/reports/send-now', requireAuth, async (req, res) => {
  try {
    const { AppConfig } = require('./models');
    const { StarTransaction, Chat } = require('./models');
    
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    
    const newUsers = await User.count({ where: { createdAt: { [Op.gte]: yesterday } } });
    const totalUsers = await User.count();
    const activeToday = await User.count({ where: { lastActiveDate: today.toISOString().split('T')[0] } });
    const revenue = await StarTransaction.sum('amount', { where: { createdAt: { [Op.gte]: yesterday } } }) || 0;
    const chats = await Chat.count({ where: { startedAt: { [Op.gte]: yesterday } } });
    const activeChats = await Chat.count({ where: { active: true } });
    const errCount = errorLog.filter(e => new Date(e.timestamp) >= yesterday).length;
    
    const report = `📊 *Daily Admin Report*\n` +
      `📅 ${today.toLocaleDateString()}\n\n` +
      `👥 *Users*\n  New: ${newUsers}\n  Total: ${totalUsers}\n  Active Today: ${activeToday}\n\n` +
      `💬 *Chats*\n  New: ${chats}\n  Active: ${activeChats}\n\n` +
      `💰 *Revenue*\n  Today: ${revenue} ⭐ ($${(revenue * 0.01).toFixed(2)})\n\n` +
      `🔴 *Errors*: ${errCount}\n`;
    
    // Send via admin bot
    const chatId = await AppConfig.getValue('reports_telegram_chat_id') || process.env.ADMIN_CHAT_ID;
    if (chatId) {
      const botInstances = global.botInstances || [];
      const bot = botInstances[0];
      if (bot) {
        await bot.telegram.sendMessage(chatId, report, { parse_mode: 'Markdown' });
      }
    }
    
    await AppConfig.setValue('reports_last_sent', new Date().toISOString());
    res.json({ success: true, report });
  } catch (error) {
    console.error('Send report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== FEATURE 11: USER FEEDBACK/RATING DASHBOARD ====================
app.get('/api/admin/feedback', requireAuth, async (req, res) => {
  try {
    const { ChatRating } = require('./models');
    const { page = 1, limit = 25, type, reported } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const where = {};
    if (type) where.ratingType = type;
    if (reported === 'true') where.reportReason = { [Op.ne]: 'none' };
    
    const { count, rows } = await ChatRating.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset
    });
    
    // Stats
    const total = await ChatRating.count();
    const positive = await ChatRating.count({ where: { ratingType: 'positive' } });
    const negative = await ChatRating.count({ where: { ratingType: 'negative' } });
    const reports = await ChatRating.count({ where: { reportReason: { [Op.ne]: 'none' } } });
    const unreviewed = await ChatRating.count({ where: { reportReason: { [Op.ne]: 'none' }, reviewed: false } });
    
    // Report breakdown
    const reportBreakdown = await sequelize.query(
      `SELECT "reportReason", COUNT(*) as count FROM "ChatRating" WHERE "reportReason" != 'none' GROUP BY "reportReason" ORDER BY count DESC`,
      { type: sequelize.QueryTypes.SELECT }
    );
    
    // Satisfaction trend (last 14 days)
    const trend = await sequelize.query(
      `SELECT DATE("createdAt") as date, 
              COUNT(CASE WHEN "ratingType" = 'positive' THEN 1 END) as positive,
              COUNT(CASE WHEN "ratingType" = 'negative' THEN 1 END) as negative,
              COUNT(*) as total
       FROM "ChatRating" WHERE "createdAt" >= :since GROUP BY DATE("createdAt") ORDER BY date`,
      { replacements: { since: new Date(Date.now() - 14 * 86400000) }, type: sequelize.QueryTypes.SELECT }
    );
    
    res.json({
      ratings: rows, total: count, page: parseInt(page), totalPages: Math.ceil(count / parseInt(limit)),
      stats: { total, positive, negative, reports, unreviewed, satisfactionRate: total > 0 ? ((positive / total) * 100).toFixed(1) : 0 },
      reportBreakdown, trend
    });
  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/feedback/:id/review', requireAuth, async (req, res) => {
  try {
    const { ChatRating } = require('./models');
    const AuditService = require('./services/auditService');
    const { actionTaken } = req.body;
    
    await ChatRating.update(
      { reviewed: true, reviewedBy: req.adminId, reviewedAt: new Date(), actionTaken: actionTaken || 'reviewed' },
      { where: { id: req.params.id } }
    );
    
    await AuditService.log({ adminId: req.adminId, category: 'report', action: 'review_report', targetId: String(req.params.id), details: { actionTaken }, success: true }).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Make logError available globally
global.logAdminError = logError;

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
