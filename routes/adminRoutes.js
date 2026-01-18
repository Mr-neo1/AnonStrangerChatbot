const express = require('express');
const router = express.Router();
const path = require('path');
const { requireAdmin, validateAdminId, createSession, checkRateLimit, isAdmin } = require('../middlewares/adminAuth');
const LoginCodeService = require('../services/loginCodeService');
const ConfigService = require('../services/configService');
const { enqueueBroadcast } = require('../services/queueService');
const { User, VipSubscription, StarTransaction, Chat } = require('../models');
const { Op, fn, col } = require('sequelize');

/**
 * Login page (public)
 */
router.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-login.html'));
});

/**
 * API: Check admin configuration (for debugging)
 */
router.get('/api/check-config', (req, res) => {
  const adminIds = (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  res.json({
    adminIdsConfigured: adminIds.length > 0,
    adminIds: adminIds.length > 0 ? adminIds.map(id => id.substring(0, 3) + '***') : [],
    redisType: process.env.REDIS_URL?.startsWith('memory://') || !process.env.REDIS_URL ? 'memory' : 'real',
    botRunning: 'Check if bot process is running',
    message: adminIds.length === 0 ? '⚠️ ADMIN_TELEGRAM_IDS not configured!' : '✅ Configuration OK'
  });
});

/**
 * Dashboard page (protected)
 */
router.get('/dashboard', async (req, res, next) => {
  // Check authentication first
  const token = req.cookies?.adminToken || req.headers['x-admin-token'];
  
  if (!token) {
    return res.redirect('/admin/login');
  }
  
  const { validateSession } = require('../middlewares/adminAuth');
  const session = await validateSession(token);
  
  if (!session) {
    res.clearCookie('adminToken', { path: '/' });
    return res.redirect('/admin/login');
  }
  
  // Attach admin info and continue
  req.admin = { telegramId: session.telegramId };
  res.sendFile(path.join(__dirname, '../public/admin/dashboard.html'));
});

/**
 * API: Request login (generates one-time code)
 * Frontend calls this, then shows code to send to bot
 */
router.post('/api/request-login', (req, res) => {
  const { telegramId } = req.body;

  // Basic validation
  if (!telegramId) {
    return res.status(400).json({ error: 'Telegram ID is required' });
  }

  // Check if ADMIN_TELEGRAM_IDS is configured
  const adminIds = (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  if (adminIds.length === 0) {
    return res.status(500).json({ 
      error: 'ADMIN_TELEGRAM_IDS not configured. Please set it in environment variables.' 
    });
  }

  // Only allow configured admins to request a code
  if (!isAdmin(telegramId)) {
    return res.status(403).json({ 
      error: `Unauthorized admin ID. Your ID (${telegramId}) is not in ADMIN_TELEGRAM_IDS. Configured IDs: ${adminIds.map(id => id.substring(0, 3) + '***').join(', ')}` 
    });
  }
  
  // Rate limiting
  if (!checkRateLimit(telegramId)) {
    return res.status(429).json({ 
      error: 'Too many login attempts. Please try again later.' 
    });
  }
  
  // Generate a one-time code
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  LoginCodeService.createCode(telegramId, code)
    .then(() => {
      res.json({ 
        success: true, 
        code,
        message: `Send this command to the bot: /admin_login ${code}`
      });
    })
    .catch((err) => {
      console.error('Login code creation failed', err);
      res.status(500).json({ error: 'Failed to generate code' });
    });
});

/**
 * API: Check login status (polling endpoint for auto-login)
 */
router.post('/api/check-login', async (req, res) => {
  const { telegramId, code } = req.body;

  if (!telegramId || !code) {
    return res.json({ success: false, message: 'Missing parameters' });
  }

  try {
    const loginData = await LoginCodeService.getCode(code);

    if (!loginData) {
      return res.json({ success: false, message: 'Code not found' });
    }

    // Check if expired
    if (new Date(loginData.expiresAt).getTime() < Date.now()) {
      await LoginCodeService.deleteCode(code);
      return res.json({ success: false, message: 'Code expired' });
    }

    // Check if confirmed by bot
    if (loginData.confirmed && loginData.token) {
      await LoginCodeService.deleteCode(code);

      // Verify session exists in Redis before setting cookie
      const { validateSession } = require('../middlewares/adminAuth');
      const session = await validateSession(loginData.token);
      
      if (!session) {
        console.error(`[AdminAuth] Session not found after confirmation for token: ${loginData.token.substring(0, 8)}...`);
        return res.json({ 
          success: false, 
          message: 'Session creation failed. Please try logging in again.' 
        });
      }

      // Issue HttpOnly cookie
      res.cookie('adminToken', loginData.token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/',
        secure: false // Set to true in production with HTTPS
      });

      return res.json({ 
        success: true, 
        message: 'Login successful',
        redirect: '/admin/dashboard'
      });
    }

    // Not confirmed yet - keep polling
    return res.json({ success: false, message: 'Waiting for confirmation' });
    
  } catch (err) {
    console.error('Check login failed', err);
    return res.json({ success: false, message: 'Error checking status' });
  }
});

/**
 * API: Verify code and return session token (after bot confirmation)
 * DEPRECATED: Kept for backwards compatibility
 */
router.post('/api/verify-code', async (req, res) => {
  const { telegramId, code } = req.body;

  if (!telegramId || !code) {
    return res.status(400).json({ error: 'Telegram ID and code are required' });
  }

  try {
    const loginData = await LoginCodeService.getCode(code);

    if (!loginData) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    if (new Date(loginData.expiresAt).getTime() < Date.now()) {
      await LoginCodeService.deleteCode(code);
      return res.status(400).json({ error: 'Code expired. Request a new one.' });
    }

    if (String(loginData.telegramId) !== String(telegramId)) {
      return res.status(403).json({ error: 'Code does not match this Telegram ID' });
    }

    if (!loginData.confirmed || !loginData.token) {
      return res.status(401).json({ error: 'Code not confirmed yet. Please send /admin_login <code> to the bot.' });
    }

    await LoginCodeService.deleteCode(code);

    // Issue HttpOnly cookie so subsequent /admin/dashboard is authenticated
    res.cookie('adminToken', loginData.token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/'
    });

    return res.json({ success: true, token: loginData.token });
  } catch (err) {
    console.error('Verify code failed', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * API: Complete login (called after bot verifies code)
 * Bot will call this endpoint when user sends /admin_login <code>
 */
router.post('/api/complete-login', validateAdminId, async (req, res) => {
  try {
    const { telegramId } = req.body;
    
    // Create session (async)
    const token = await createSession(telegramId);
    
    res.json({ 
      success: true, 
      token,
      message: 'Login successful'
    });
  } catch (error) {
    console.error('Complete login error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

/**
 * API: Get all config values (protected)
 */
router.get('/api/config', requireAdmin, async (req, res) => {
  try {
    const config = await ConfigService.getMany({
      // VIP Plans (named plans)
      'vip_plan_basic_stars': 100,
      'vip_plan_basic_days': 4,
      'vip_plan_plus_stars': 200,
      'vip_plan_plus_days': 7,
      'vip_plan_pro_stars': 300,
      'vip_plan_pro_days': 30,
      'vip_plan_half_year_stars': 900,
      'vip_plan_half_year_days': 182,
      'vip_plan_yearly_stars': 1500,
      'vip_plan_yearly_days': 365,
      'vip_enabled': true,
      
      // Lock Chat Pricing
      'lock_chat_5min_price': 15,
      'lock_chat_10min_price': 25,
      'lock_chat_15min_price': 35,
      'lock_chat_enabled': true,
      
      // Required Channels (for promotions)
      'required_channel_enabled': true,
      'required_channel_1': process.env.REQUIRED_CHANNEL_1 || '',
      'required_channel_2': process.env.REQUIRED_CHANNEL_2 || '',
      
      // Affiliate & Referral
      'affiliate_commission': 0.8,
      'referral_vip_days': 10,
      'referral_enabled': true,
      
      // Admin Channels
      'admin_media_channel': process.env.ADMIN_MEDIA_CHANNEL_ID || '',
      'admin_abuse_channel': '',
      'admin_logs_channel': '',
      
      // Bot Management
      'bot_tokens': process.env.BOT_TOKENS || process.env.BOT_TOKEN || ''
    });
    
    res.json({ success: true, config });
  } catch (error) {
    console.error('Get config error:', error);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

/**
 * API: Update config value (protected)
 */
router.post('/api/config', requireAdmin, async (req, res) => {
  try {
    const { key, value } = req.body;
    
    if (!key) {
      return res.status(400).json({ error: 'Key is required' });
    }
    
    // Validation rules
    const validations = {
      // VIP Plans
      'vip_plan_basic_stars': (v) => Number(v) >= 0 && Number(v) <= 10000,
      'vip_plan_basic_days': (v) => Number(v) >= 1 && Number(v) <= 365,
      'vip_plan_plus_stars': (v) => Number(v) >= 0 && Number(v) <= 10000,
      'vip_plan_plus_days': (v) => Number(v) >= 1 && Number(v) <= 365,
      'vip_plan_pro_stars': (v) => Number(v) >= 0 && Number(v) <= 10000,
      'vip_plan_pro_days': (v) => Number(v) >= 1 && Number(v) <= 365,
      'vip_plan_half_year_stars': (v) => Number(v) >= 0 && Number(v) <= 10000,
      'vip_plan_half_year_days': (v) => Number(v) >= 1 && Number(v) <= 365,
      'vip_plan_yearly_stars': (v) => Number(v) >= 0 && Number(v) <= 10000,
      'vip_plan_yearly_days': (v) => Number(v) >= 1 && Number(v) <= 365,
      'vip_enabled': (v) => typeof v === 'boolean' || v === 'true' || v === 'false',
      
      // Lock Chat
      'lock_chat_5min_price': (v) => Number(v) >= 0 && Number(v) <= 1000,
      'lock_chat_10min_price': (v) => Number(v) >= 0 && Number(v) <= 1000,
      'lock_chat_15min_price': (v) => Number(v) >= 0 && Number(v) <= 1000,
      'lock_chat_enabled': (v) => typeof v === 'boolean' || v === 'true' || v === 'false',
      
      // Required Channels
      'required_channel_enabled': (v) => typeof v === 'boolean' || v === 'true' || v === 'false',
      'required_channel_1': (v) => typeof v === 'string' && (v === '' || v.startsWith('@') || /^-?\d+$/.test(v)),
      'required_channel_2': (v) => typeof v === 'string' && (v === '' || v.startsWith('@') || /^-?\d+$/.test(v)),
      
      // Affiliate & Referral
      'affiliate_commission': (v) => Number(v) >= 0 && Number(v) <= 1,
      'referral_vip_days': (v) => Number(v) >= 0 && Number(v) <= 365,
      'referral_enabled': (v) => typeof v === 'boolean' || v === 'true' || v === 'false',
      
      // Admin Channels
      'admin_media_channel': (v) => typeof v === 'string',
      'admin_abuse_channel': (v) => typeof v === 'string',
      'admin_logs_channel': (v) => typeof v === 'string',
    };
    
    // Validate if rule exists
    if (validations[key] && !validations[key](value)) {
      return res.status(400).json({ error: 'Invalid value for this key' });
    }
    
    const success = await ConfigService.set(key, value, req.admin.telegramId);
    
    if (success) {
      res.json({ success: true, message: 'Config updated' });
    } else {
      res.status(500).json({ error: 'Failed to update config' });
    }
  } catch (error) {
    console.error('Update config error:', error);
    res.status(500).json({ error: 'Failed to update config' });
  }
});

/**
 * API: Overview metrics (protected)
 */
router.get('/api/overview', requireAdmin, async (_req, res) => {
  try {
    const [totalUsers, vipActive, activeChats, starsSum] = await Promise.all([
      User.count(),
      VipSubscription.count({ where: { expiresAt: { [Op.gt]: new Date() } } }),
      Chat.count({ where: { active: true } }),
      StarTransaction.sum('amount')
    ]);
    res.json({ success: true, data: {
      totalUsers: totalUsers || 0,
      vipActive: vipActive || 0,
      activeChats: activeChats || 0,
      totalStars: starsSum || 0
    }});
  } catch (err) {
    console.error('Overview error:', err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

/**
 * API: User metrics (protected)
 */
router.get('/api/users', requireAdmin, async (_req, res) => {
  try {
    const today = new Date();
    today.setHours(0,0,0,0);
    const weekAhead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [total, vip, activeChats, todayNew] = await Promise.all([
      User.count(),
      VipSubscription.count({ where: { expiresAt: { [Op.gt]: new Date() } } }),
      Chat.count({ where: { active: true } }),
      User.count({ where: { createdAt: { [Op.gte]: today } } })
    ]);

    const expiring = await VipSubscription.count({ where: { expiresAt: { [Op.lte]: weekAhead, [Op.gt]: new Date() } } });

    res.json({ success: true, data: {
      total: total || 0,
      vip: vip || 0,
      activeChats: activeChats || 0,
      today: todayNew || 0,
      expiring: expiring || 0,
      referrals: 0,
      lock: 0
    }});
  } catch (err) {
    console.error('Users metrics error:', err);
    res.status(500).json({ error: 'Failed to load users metrics' });
  }
});

/**
 * API: Settings (protected)
 */
router.get('/api/settings', requireAdmin, async (_req, res) => {
  try {
    const config = await ConfigService.getMany({
      'vip_price_299': 299,
      'vip_price_399': 399,
      'vip_price_499': 499,
      'vip_duration_days': 30,
      'vip_enabled': true,
      'lock_chat_5min_price': 50,
      'lock_chat_10min_price': 90,
      'lock_chat_15min_price': 120,
      'lock_chat_enabled': true,
      'affiliate_commission': 0.8,
      'referral_vip_days': 10,
      'referral_enabled': true,
      'admin_media_channel': '',
      'admin_abuse_channel': '',
      'admin_logs_channel': ''
    });
    res.json({ success: true, data: config });
  } catch (err) {
    console.error('Settings load error:', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

/**
 * API: Broadcast enqueue (protected)
 */
router.post('/api/broadcast', requireAdmin, async (req, res) => {
  try {
    const { message, audience } = req.body || {};
    if (!message || String(message).trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }
    const job = await enqueueBroadcast({ message: String(message).trim(), audience: audience || 'all', meta: { requestedBy: req.admin.telegramId } });
    res.json({ success: true, jobId: job.id, impl: job.impl || 'queue' });
  } catch (err) {
    console.error('Broadcast enqueue error:', err);
    res.status(500).json({ error: 'Failed to enqueue broadcast' });
  }
});

/**
 * API: Logout (protected)
 */
router.post('/api/logout', requireAdmin, (req, res) => {
  // Clear cookie
  res.clearCookie('adminToken', { path: '/' });
  res.json({ success: true, message: 'Logged out' });
});

/**
 * API: Get bot tokens list (protected)
 */
router.get('/api/bots', requireAdmin, async (req, res) => {
  try {
    const botTokensConfig = await ConfigService.get('bot_tokens', process.env.BOT_TOKENS || process.env.BOT_TOKEN || '');
    const tokens = botTokensConfig ? botTokensConfig.split(',').map(t => t.trim()).filter(Boolean) : [];
    
    // Mask tokens for security (show only first 10 and last 4 chars)
    const masked = tokens.map(token => {
      if (token.length > 14) {
        return token.substring(0, 10) + '...' + token.substring(token.length - 4);
      }
      return '***';
    });
    
    res.json({ success: true, bots: tokens.map((token, idx) => ({
      id: `bot_${idx}`,
      token: masked[idx],
      status: 'active' // Could check actual bot status
    })) });
  } catch (error) {
    console.error('Get bots error:', error);
    res.status(500).json({ error: 'Failed to fetch bots' });
  }
});

/**
 * API: Add bot token (protected)
 */
router.post('/api/bots', requireAdmin, async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token || typeof token !== 'string' || token.trim().length < 20) {
      return res.status(400).json({ error: 'Invalid bot token' });
    }
    
    const currentTokens = await ConfigService.get('bot_tokens', process.env.BOT_TOKENS || process.env.BOT_TOKEN || '');
    const tokens = currentTokens ? currentTokens.split(',').map(t => t.trim()).filter(Boolean) : [];
    
    // Check if token already exists
    if (tokens.includes(token.trim())) {
      return res.status(400).json({ error: 'Bot token already exists' });
    }
    
    // Add new token
    tokens.push(token.trim());
    const newTokens = tokens.join(',');
    
    await ConfigService.set('bot_tokens', newTokens, req.admin.telegramId);
    
    res.json({ 
      success: true, 
      message: 'Bot token added. Restart the bot to apply changes.',
      totalBots: tokens.length
    });
  } catch (error) {
    console.error('Add bot error:', error);
    res.status(500).json({ error: 'Failed to add bot' });
  }
});

/**
 * API: Remove bot token (protected)
 */
router.delete('/api/bots/:index', requireAdmin, async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    
    if (isNaN(index) || index < 0) {
      return res.status(400).json({ error: 'Invalid bot index' });
    }
    
    const currentTokens = await ConfigService.get('bot_tokens', process.env.BOT_TOKENS || process.env.BOT_TOKEN || '');
    const tokens = currentTokens ? currentTokens.split(',').map(t => t.trim()).filter(Boolean) : [];
    
    if (index >= tokens.length) {
      return res.status(400).json({ error: 'Bot index out of range' });
    }
    
    // Remove token
    tokens.splice(index, 1);
    const newTokens = tokens.join(',');
    
    await ConfigService.set('bot_tokens', newTokens, req.admin.telegramId);
    
    res.json({ 
      success: true, 
      message: 'Bot token removed. Restart the bot to apply changes.',
      totalBots: tokens.length
    });
  } catch (error) {
    console.error('Remove bot error:', error);
    res.status(500).json({ error: 'Failed to remove bot' });
  }
});

/**
 * API: Update multiple config values at once (protected)
 */
router.post('/api/config/bulk', requireAdmin, async (req, res) => {
  try {
    const { config: configUpdates } = req.body;
    
    if (!configUpdates || typeof configUpdates !== 'object') {
      return res.status(400).json({ error: 'Config object is required' });
    }
    
    const results = {};
    const errors = [];
    
    for (const [key, value] of Object.entries(configUpdates)) {
      try {
        const success = await ConfigService.set(key, value, req.admin.telegramId);
        results[key] = success;
        if (!success) {
          errors.push(key);
        }
      } catch (err) {
        errors.push(key);
        results[key] = false;
      }
    }
    
    if (errors.length > 0) {
      return res.status(400).json({ 
        success: false, 
        error: `Failed to update: ${errors.join(', ')}`,
        results 
      });
    }
    
    res.json({ success: true, message: 'All config values updated', results });
  } catch (error) {
    console.error('Bulk config update error:', error);
    res.status(500).json({ error: 'Failed to update config' });
  }
});

module.exports = router;
