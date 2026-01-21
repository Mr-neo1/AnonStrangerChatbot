const express = require('express');
const router = express.Router();
const path = require('path');
const { requireAdmin, validateAdminId, createSession, checkRateLimit, isAdmin } = require('../middlewares/adminAuth');
const LoginCodeService = require('../services/loginCodeService');
const ConfigService = require('../services/configService');
const { enqueueBroadcast } = require('../services/queueService');
const { User, VipSubscription, StarTransaction, Chat, Referral, AffiliateReward } = require('../models');
const { Op, fn, col } = require('sequelize');

/**
 * Login page (public)
 */
router.get('/login', (req, res) => {
  const loginPath = path.join(__dirname, '../public/admin-login.html');
  res.sendFile(loginPath, (err) => {
    if (err) {
      console.error('Error serving admin login page:', err);
      res.status(500).send('Admin login page not found');
    }
  });
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
  const dashboardPath = path.join(__dirname, '../public/admin/dashboard.html');
  res.sendFile(dashboardPath, (err) => {
    if (err) {
      console.error('Error serving admin dashboard:', err);
      res.status(500).send('Admin dashboard not found');
    }
  });
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
      console.error('Login code creation failed:', err);
      res.status(500).json({ error: 'Failed to generate login code' });
    });
});

/**
 * API: Verify login code (called by bot after user sends /admin_login <code>)
 */
router.post('/api/verify-code', validateAdminId, async (req, res) => {
  try {
    const { telegramId, code } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

      const isValid = await LoginCodeService.verifyCode(telegramId, code);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    const token = await createSession(telegramId);

    await LoginCodeService.deleteCode(code);

    // Issue HttpOnly cookie so subsequent /admin/dashboard is authenticated
    res.cookie('adminToken', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/'
    });

    return res.json({ success: true, token });
  } catch (err) {
    console.error('Verify code failed', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * API: Check login status (polling endpoint for login page)
 * Called by frontend to check if user has completed login via bot
 */
router.post('/api/check-login', async (req, res) => {
  try {
  const { telegramId, code } = req.body;

  if (!telegramId || !code) {
    return res.json({ success: false, message: 'Missing parameters' });
  }

    // Check if code exists
    const codeData = await LoginCodeService.getCode(code);

    if (!codeData) {
      return res.json({ success: false, message: 'Code not found' });
    }

    // Check if code expired
    if (new Date(codeData.expiresAt) < new Date()) {
      await LoginCodeService.deleteCode(code);
      return res.json({ success: false, message: 'Code expired' });
    }

    // Check if code is confirmed (user sent OTP to bot)
    if (!codeData.confirmed) {
      return res.json({ success: false, message: 'Code not verified yet' });
    }
    
    // Code is confirmed - use existing token if available, otherwise create new session
    let token = codeData.token;
    
    if (!token) {
      // Create session only if token doesn't exist
      token = await createSession(telegramId);
      if (!token) {
        return res.status(500).json({ error: 'Failed to create session' });
      }
      // Store token in code data for subsequent polls
      await LoginCodeService.confirmCode(code, telegramId, token);
    }
    
    // Delete code after first successful response (prevent multiple sessions)
    await LoginCodeService.deleteCode(code);
    
    // Set cookie for subsequent requests
    res.cookie('adminToken', token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
      path: '/'
      });

      return res.json({ 
        success: true, 
      redirect: '/admin/dashboard',
      message: 'Login successful'
    });
  } catch (error) {
    console.error('Check login error:', error);
    return res.status(500).json({ error: 'Check login failed' });
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
 * API: Logout admin (clear cookie + token)
 */
router.post('/api/logout', async (req, res) => {
  try {
    const token = req.cookies?.adminToken;
    if (token) {
      const { destroySession } = require('../middlewares/adminAuth');
      if (destroySession) {
        await destroySession(token).catch(() => {});
      }
    }
    res.clearCookie('adminToken', { path: '/' });
    return res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.clearCookie('adminToken', { path: '/' });
    return res.json({ success: true });
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
      'vip_plan_basic_name': 'BASIC',
      'vip_plan_plus_stars': 200,
      'vip_plan_plus_days': 7,
      'vip_plan_plus_name': 'PLUS',
      'vip_plan_pro_stars': 300,
      'vip_plan_pro_days': 30,
      'vip_plan_pro_name': 'PRO',
      'vip_plan_half_year_stars': 900,
      'vip_plan_half_year_days': 182,
      'vip_plan_half_year_name': 'HALF_YEAR',
      'vip_plan_yearly_stars': 1500,
      'vip_plan_yearly_days': 365,
      'vip_plan_yearly_name': 'YEARLY',
      'vip_enabled': true,
      
      // Lock Chat Pricing
      'lock_chat_5min_price': 15,
      'lock_chat_10min_price': 25,
      'lock_chat_15min_price': 35,
      'lock_chat_enabled': true,
      
      // Required Channels (for promotions/revenue)
      'required_channel_enabled': false, // Default disabled - enable via admin panel
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
      'vip_plan_basic_name': (v) => typeof v === 'string' && v.length <= 50, // Allow empty string
      'vip_plan_plus_stars': (v) => Number(v) >= 0 && Number(v) <= 10000,
      'vip_plan_plus_days': (v) => Number(v) >= 1 && Number(v) <= 365,
      'vip_plan_plus_name': (v) => typeof v === 'string' && v.length <= 50,
      'vip_plan_pro_stars': (v) => Number(v) >= 0 && Number(v) <= 10000,
      'vip_plan_pro_days': (v) => Number(v) >= 1 && Number(v) <= 365,
      'vip_plan_pro_name': (v) => typeof v === 'string' && v.length <= 50,
      'vip_plan_half_year_stars': (v) => Number(v) >= 0 && Number(v) <= 10000,
      'vip_plan_half_year_days': (v) => Number(v) >= 1 && Number(v) <= 365,
      'vip_plan_half_year_name': (v) => typeof v === 'string' && v.length <= 50,
      'vip_plan_yearly_stars': (v) => Number(v) >= 0 && Number(v) <= 10000,
      'vip_plan_yearly_days': (v) => Number(v) >= 1 && Number(v) <= 365,
      'vip_plan_yearly_name': (v) => typeof v === 'string' && v.length <= 50,
      'vip_enabled': (v) => typeof v === 'boolean' || v === 'true' || v === 'false',
      
      // Lock Chat
      'lock_chat_5min_price': (v) => Number(v) >= 0 && Number(v) <= 1000,
      'lock_chat_10min_price': (v) => Number(v) >= 0 && Number(v) <= 1000,
      'lock_chat_15min_price': (v) => Number(v) >= 0 && Number(v) <= 1000,
      'lock_chat_enabled': (v) => typeof v === 'boolean' || v === 'true' || v === 'false',
      
      // Required Channels (for promotions/revenue)
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
      // OPTIMIZATION: Invalidate admin stats cache when config changes
      const AdminStatsCache = require('../services/adminStatsCache');
      AdminStatsCache.invalidate().catch(() => {});
      
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
 * API: Get required channel status (protected) - Enhanced for revenue/promotions
 */
router.get('/api/channels', requireAdmin, async (req, res) => {
  try {
    const config = await ConfigService.getMany({
      'required_channel_enabled': false,
      'required_channel_1': '',
      'required_channel_2': ''
    });
    
    res.json({ 
      success: true, 
      data: {
        enabled: config.required_channel_enabled === true || config.required_channel_enabled === 'true',
        channel1: config.required_channel_1 || '',
        channel2: config.required_channel_2 || '',
        note: 'Change required channels to promote partner channels (revenue source)'
      }
    });
  } catch (error) {
    console.error('Get channels error:', error);
    res.status(500).json({ error: 'Failed to fetch channel config' });
  }
});

/**
 * API: Update required channels (protected) - Enhanced for revenue/promotions
 */
router.post('/api/channels', requireAdmin, async (req, res) => {
  try {
    const { enabled, channel1, channel2 } = req.body;
    
    // Validate channels format
    const validateChannel = (ch) => {
      if (!ch || ch === '') return true; // Empty is allowed
      return ch.startsWith('@') || /^-?\d+$/.test(ch);
    };
    
    if (enabled !== undefined && typeof enabled !== 'boolean' && enabled !== 'true' && enabled !== 'false') {
      return res.status(400).json({ error: 'enabled must be boolean' });
    }
    
    if (channel1 !== undefined && !validateChannel(channel1)) {
      return res.status(400).json({ error: 'channel1 must be @channel_name or channel ID' });
    }
    
    if (channel2 !== undefined && !validateChannel(channel2)) {
      return res.status(400).json({ error: 'channel2 must be @channel_name or channel ID' });
    }
    
    // Update config
    const updates = [];
    if (enabled !== undefined) {
      updates.push(ConfigService.set('required_channel_enabled', enabled, req.admin.telegramId));
    }
    if (channel1 !== undefined) {
      updates.push(ConfigService.set('required_channel_1', channel1.trim(), req.admin.telegramId));
    }
    if (channel2 !== undefined) {
      updates.push(ConfigService.set('required_channel_2', channel2.trim(), req.admin.telegramId));
    }
    
    await Promise.all(updates);
    
    // Invalidate cache
    const AdminStatsCache = require('../services/adminStatsCache');
    AdminStatsCache.invalidate().catch(() => {});
    
    res.json({ 
      success: true, 
      message: 'Required channels updated. Changes apply immediately (no restart needed).',
      note: 'Use this feature to promote partner channels and generate revenue.'
    });
  } catch (error) {
    console.error('Update channels error:', error);
    res.status(500).json({ error: 'Failed to update channels' });
  }
});

/**
 * API: Overview metrics (protected) - OPTIMIZED with caching
 */
router.get('/api/overview', requireAdmin, async (_req, res) => {
  try {
    const AdminStatsCache = require('../services/adminStatsCache');
    const data = await AdminStatsCache.getOverview();
    res.json({ success: true, data });
  } catch (err) {
    console.error('Overview error:', err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

/**
 * API: User metrics (protected) - OPTIMIZED with caching
 */
router.get('/api/users', requireAdmin, async (_req, res) => {
  try {
    const AdminStatsCache = require('../services/adminStatsCache');
    const data = await AdminStatsCache.getUserMetrics();
    res.json({ success: true, data });
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
      // VIP Plans (named plans)
      'vip_plan_basic_stars': 100,
      'vip_plan_basic_days': 4,
      'vip_plan_basic_name': 'BASIC',
      'vip_plan_plus_stars': 200,
      'vip_plan_plus_days': 7,
      'vip_plan_plus_name': 'PLUS',
      'vip_plan_pro_stars': 300,
      'vip_plan_pro_days': 30,
      'vip_plan_pro_name': 'PRO',
      'vip_plan_half_year_stars': 900,
      'vip_plan_half_year_days': 182,
      'vip_plan_half_year_name': 'HALF_YEAR',
      'vip_plan_yearly_stars': 1500,
      'vip_plan_yearly_days': 365,
      'vip_plan_yearly_name': 'YEARLY',
      'vip_enabled': true,
      
      // Lock Chat Pricing
      'lock_chat_5min_price': 15,
      'lock_chat_10min_price': 25,
      'lock_chat_15min_price': 35,
      'lock_chat_enabled': true,
      
      // Required Channels (for promotions/revenue)
      'required_channel_enabled': false,
      'required_channel_1': process.env.REQUIRED_CHANNEL_1 || '',
      'required_channel_2': process.env.REQUIRED_CHANNEL_2 || '',
      
      // Affiliate & Referral
      'affiliate_commission': 0.8,
      'referral_vip_days': 10,
      'referral_enabled': true,
      
      // Admin Channels
      'admin_media_channel': process.env.ADMIN_MEDIA_CHANNEL_ID || '',
      'admin_abuse_channel': '',
      'admin_logs_channel': ''
    });
    res.json({ success: true, data: config });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * API: Get user list (protected)
 */
router.get('/api/user-list', requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const { count, rows } = await User.findAndCountAll({
      limit,
      offset,
      order: [['createdAt', 'DESC']],
      attributes: ['userId', 'telegramId', 'botId', 'gender', 'age', 'banned', 'totalChats', 'dailyStreak', 'createdAt']
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        page,
        limit,
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('User list error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * API: Search users (LITE - indexed query, cached)
 */
router.get('/api/users/search', requireAdmin, async (req, res) => {
  try {
    const query = req.query.q || '';
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50); // Max 50 per page
    const offset = (page - 1) * limit;
    const banned = req.query.banned === 'true' ? true : req.query.banned === 'false' ? false : undefined;
    
    // Cache key for this search
    const cacheKey = `admin:usersearch:${query}:${banned}:${page}:${limit}`;
    const { redisClient } = require('../database/redisClient');
    
    // Check cache (30 seconds)
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    } catch (e) {
      // Cache miss, continue
    }
    
    // Build query (indexed columns only for performance)
    const where = {};
    if (query) {
      // Search by Telegram ID (indexed)
      const telegramId = parseInt(query);
      if (!isNaN(telegramId)) {
        where.telegramId = telegramId;
      } else {
        // Partial match on userId (if string)
        where.userId = { [Op.like]: `%${query}%` };
      }
    }
    if (banned !== undefined) {
      where.banned = banned; // Indexed column
    }
    
    const { count, rows } = await User.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']],
      attributes: ['userId', 'telegramId', 'botId', 'gender', 'age', 'banned', 'totalChats', 'createdAt']
    });
    
    const result = {
      success: true,
      data: rows,
      pagination: {
        total: count,
        page,
        limit,
        pages: Math.ceil(count / limit)
      }
    };
    
    // Cache for 30 seconds
    redisClient.setEx(cacheKey, 30, JSON.stringify(result)).catch(() => {});
    
    res.json(result);
  } catch (error) {
    console.error('User search error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

/**
 * API: Get user details (LITE - essential info only)
 */
router.get('/api/users/:userId/details', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Cache key
    const cacheKey = `admin:userdetails:${userId}`;
    const { redisClient } = require('../database/redisClient');
    
    // Check cache (60 seconds)
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    } catch (e) {
      // Cache miss, continue
    }
    
    // Get user (indexed query)
    const user = await User.findOne({
      where: { userId },
      attributes: ['userId', 'telegramId', 'botId', 'gender', 'age', 'banned', 'totalChats', 'dailyStreak', 'createdAt']
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get VIP status (if exists)
    const vip = await VipSubscription.findOne({
      where: { userId },
      attributes: ['expiresAt']
    });
    
    // Get active chat count (from Redis - lightweight)
    const { scanKeys } = require('../utils/redisScanHelper');
    const pairKeys = await scanKeys(redisClient, `pair:*`, 100);
    let activeChats = 0;
    for (const key of pairKeys) {
      const pairData = await redisClient.get(key);
      if (pairData) {
        const pair = JSON.parse(pairData);
        if (pair.user1 === user.telegramId || pair.user2 === user.telegramId) {
          activeChats++;
        }
      }
    }
    
    // Get last 5 transactions (lightweight)
    const transactions = await StarTransaction.findAll({
      where: { userId: user.telegramId },
      limit: 5,
      order: [['createdAt', 'DESC']],
      attributes: ['amount', 'createdAt']
    });
    
    const result = {
      success: true,
      data: {
        user: user.toJSON(),
        vip: vip ? { expiresAt: vip.expiresAt, isActive: new Date(vip.expiresAt) > new Date() } : null,
        activeChats,
        recentTransactions: transactions.map(t => ({
          amount: t.amount,
          date: t.createdAt
        }))
      }
    };
    
    // Cache for 60 seconds
    redisClient.setEx(cacheKey, 60, JSON.stringify(result)).catch(() => {});
    
    res.json(result);
  } catch (error) {
    console.error('User details error:', error);
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
});

/**
 * API: Bulk user actions (LITE - batch operations)
 */
router.post('/api/users/bulk-action', requireAdmin, async (req, res) => {
  try {
    const { userIds, action, value } = req.body;
    
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds must be a non-empty array' });
    }
    
    if (userIds.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 users per bulk action' });
    }
    
    const UserCacheService = require('../services/userCacheService');
    const AdminStatsCache = require('../services/adminStatsCache');
    
    let updated = 0;
    
    switch (action) {
      case 'ban':
        await User.update({ banned: true }, { where: { userId: { [Op.in]: userIds } } });
        updated = userIds.length;
        // Invalidate cache for all users
        userIds.forEach(id => UserCacheService.invalidate(id).catch(() => {}));
        break;
        
      case 'unban':
        await User.update({ banned: false }, { where: { userId: { [Op.in]: userIds } } });
        updated = userIds.length;
        userIds.forEach(id => UserCacheService.invalidate(id).catch(() => {}));
        break;
        
      case 'grant-vip':
        if (!value || !Number.isInteger(parseInt(value))) {
          return res.status(400).json({ error: 'VIP days (value) required' });
        }
        const days = parseInt(value);
        const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        
        // Batch insert/update VIP
        for (const userId of userIds) {
          await VipSubscription.upsert({
            userId,
            expiresAt,
            source: 'admin_grant'
          });
        }
        updated = userIds.length;
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
    
    // Invalidate admin stats cache
    AdminStatsCache.invalidate().catch(() => {});
    
    res.json({ success: true, updated, message: `Bulk ${action} completed` });
  } catch (error) {
    console.error('Bulk action error:', error);
    res.status(500).json({ error: 'Failed to perform bulk action' });
  }
});

/**
 * API: Ban/Unban user (protected)
 */
router.post('/api/user/:userId/ban', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { banned } = req.body;

    if (typeof banned !== 'boolean') {
      return res.status(400).json({ error: 'banned must be boolean' });
    }

    await User.update({ banned }, { where: { userId } });
    
    // Invalidate cache
    const UserCacheService = require('../services/userCacheService');
    UserCacheService.invalidate(userId).catch(() => {});
    const AdminStatsCache = require('../services/adminStatsCache');
    AdminStatsCache.invalidate().catch(() => {});

    res.json({ success: true, message: `User ${banned ? 'banned' : 'unbanned'}` });
  } catch (error) {
    console.error('Ban user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * API: Grant VIP to user (protected)
 */
router.post('/api/user/:userId/grant-vip', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { days } = req.body;

    if (!days || !Number.isInteger(parseInt(days)) || parseInt(days) <= 0) {
      return res.status(400).json({ error: 'Valid days (positive integer) required' });
    }

    const vipDays = parseInt(days);
    const VipService = require('../services/vipService');
    
    // Grant VIP
    const expiresAt = await VipService.activateVip(userId, vipDays, { source: 'admin_grant' });
    
    // Invalidate cache
    const UserCacheService = require('../services/userCacheService');
    UserCacheService.invalidate(userId).catch(() => {});
    const AdminStatsCache = require('../services/adminStatsCache');
    AdminStatsCache.invalidate().catch(() => {});
    
    // Notify user (if bot available)
    try {
      const { getAllBots } = require('../bots');
      const bots = getAllBots();
      const bot = bots && bots.length > 0 ? bots[0] : null;
      if (bot) {
        const user = await User.findOne({ where: { userId }, attributes: ['telegramId'] });
        if (user) {
          await bot.sendMessage(user.telegramId, `🎉 You've been granted ${vipDays} days of VIP access by admin!`).catch(() => {});
        }
      }
    } catch (e) {
      // Notification failed, but VIP is granted
    }

    res.json({ 
      success: true, 
      message: `VIP granted for ${vipDays} days`,
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error('Grant VIP error:', error);
    res.status(500).json({ error: 'Failed to grant VIP' });
  }
});

/**
 * API: Referral control (stats + lists)
 */
router.get('/api/referrals', requireAdmin, async (_req, res) => {
  try {
    const enabledFlag = await ConfigService.get('referral_enabled', true);

    const [pending, accepted, invalid, total, rewardsVipDays, recentReferrals, rewardEntries, topInviters] = await Promise.all([
      Referral.count({ where: { status: 'pending' } }),
      Referral.count({ where: { status: 'accepted' } }),
      Referral.count({ where: { status: 'invalid' } }),
      Referral.count(),
      AffiliateReward.sum('vipDaysGranted'),
      Referral.findAll({
        order: [['createdAt', 'DESC']],
        limit: 50,
        attributes: ['id', 'inviterId', 'invitedId', 'status', 'createdAt']
      }),
      AffiliateReward.findAll({
        order: [['createdAt', 'DESC']],
        limit: 20,
        attributes: ['id', 'userId', 'vipDaysGranted', 'source', 'createdAt']
      }),
      Referral.findAll({
        attributes: ['inviterId', [fn('COUNT', col('id')), 'count']],
        where: { status: 'accepted' },
        group: ['inviterId'],
        order: [[fn('COUNT', col('id')), 'DESC']],
        limit: 5
      })
    ]);

    const data = {
      enabled: enabledFlag === true || enabledFlag === 'true',
      summary: {
        total: total || 0,
        pending: pending || 0,
        accepted: accepted || 0,
        invalid: invalid || 0,
        rewardsVipDays: rewardsVipDays || 0
      },
      topInviters: (topInviters || []).map((t) => ({
        inviterId: t.inviterId,
        count: parseInt(t.get ? t.get('count') : t.count, 10) || 0
      })),
      referrals: recentReferrals || [],
      rewards: rewardEntries || []
    };

    res.json({ success: true, data });
  } catch (error) {
    console.error('Referrals fetch error:', error);
    res.status(500).json({ error: 'Failed to load referrals' });
  }
});

/**
 * API: Toggle referral system on/off
 */
router.post('/api/referrals/toggle', requireAdmin, async (req, res) => {
  try {
    const { enabled } = req.body;
    if (enabled !== true && enabled !== false && enabled !== 'true' && enabled !== 'false') {
      return res.status(400).json({ error: 'enabled must be boolean' });
    }

    const enabledBool = enabled === true || enabled === 'true';
    await ConfigService.set('referral_enabled', enabledBool, req.admin.telegramId);

    res.json({ success: true, enabled: enabledBool });
  } catch (error) {
    console.error('Toggle referral error:', error);
    res.status(500).json({ error: 'Failed to update referral setting' });
  }
});

/**
 * API: Get active chats (LITE - Redis only, no DB)
 */
router.get('/api/chats/active', requireAdmin, async (req, res) => {
  try {
    const { redisClient } = require('../database/redisClient');
    const { scanKeys } = require('../utils/redisScanHelper');
    
    // Get all active chat pairs from Redis
    const pairKeys = await scanKeys(redisClient, 'pair:*', 100);
    const activeChats = [];
    
    // Get chat details (lightweight, from Redis)
    for (const key of pairKeys.slice(0, 50)) { // Limit to 50 for performance
      try {
        const pairData = await redisClient.get(key);
        if (pairData) {
          const pair = JSON.parse(pairData);
          const chatId = key.split(':')[1];
          
          // Get activity timestamp
          const activeKey = `active:${chatId}`;
          const activeTime = await redisClient.get(activeKey);
          
          // Calculate duration
          const startedAt = pair.startedAt || Date.now();
          const duration = Math.floor((Date.now() - startedAt) / 1000 / 60); // minutes
          
          activeChats.push({
            chatId,
            user1: pair.user1,
            user2: pair.user2,
            duration: `${duration} min`,
            lastActive: activeTime ? new Date(parseInt(activeTime)).toISOString() : null
          });
        }
      } catch (e) {
        // Skip invalid keys
      }
    }
    
    res.json({ 
      success: true, 
      data: activeChats,
      total: pairKeys.length
    });
  } catch (error) {
    console.error('Active chats error:', error);
    res.status(500).json({ error: 'Failed to fetch active chats' });
  }
});

/**
 * API: Disconnect chat (LITE - Redis operation)
 */
router.post('/api/chats/:chatId/disconnect', requireAdmin, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { redisClient } = require('../database/redisClient');
    
    // Get chat pair data
    const pairKey = `pair:${chatId}`;
    const pairData = await redisClient.get(pairKey);
    
    if (!pairData) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    const pair = JSON.parse(pairData);
    
    // Delete from Redis
    await redisClient.del(pairKey);
    await redisClient.del(`active:${chatId}`);
    
    // Notify users (if bot instances available)
    try {
      const { getAllBots } = require('../bots');
      const bots = getAllBots();
      const bot = bots && bots.length > 0 ? bots[0] : null;
      
      if (bot) {
        // Send disconnect message to both users
        const message = '👋 Chat disconnected by admin.';
        await Promise.all([
          bot.sendMessage(pair.user1, message).catch(() => {}),
          bot.sendMessage(pair.user2, message).catch(() => {})
        ]);
      }
    } catch (e) {
      // Bot notification failed, but chat is disconnected
    }
    
    // Update database (mark chat as inactive)
    await Chat.update(
      { active: false },
      { where: { id: chatId } }
    ).catch(() => {}); // Non-critical
    
    res.json({ success: true, message: 'Chat disconnected' });
  } catch (error) {
    console.error('Disconnect chat error:', error);
    res.status(500).json({ error: 'Failed to disconnect chat' });
    }
});

/**
 * API: Get system health (LITE - lightweight checks)
 */
router.get('/api/system/health', requireAdmin, async (req, res) => {
  try {
    const { redisClient } = require('../database/redisClient');
    const { sequelize } = require('../database/connectionPool');
    const { getAllBots } = require('../bots');
    
    // Check database
    let dbStatus = 'unknown';
    try {
      await sequelize.authenticate();
      dbStatus = 'connected';
    } catch (e) {
      dbStatus = 'disconnected';
    }
    
    // Check Redis
    let redisStatus = 'unknown';
    try {
      await redisClient.ping();
      redisStatus = 'connected';
    } catch (e) {
      redisStatus = 'disconnected';
    }
    
    // Check bots
    const bots = getAllBots();
    const botStatus = bots.map(bot => ({
      id: bot._meta?.botId || 'unknown',
      status: bot._pollingState?.active ? 'online' : 'offline'
    }));
    
    res.json({ 
      success: true, 
      data: {
        database: dbStatus,
        redis: redisStatus,
        bots: botStatus,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('System health error:', error);
    res.status(500).json({ error: 'Failed to check system health' });
  }
});

/**
 * API: Get dynamic VIP plans (protected)
 */
router.get('/api/vip-plans', requireAdmin, async (req, res) => {
  try {
    const plansConfig = await ConfigService.get('vip_plans_config', null);
    let plans = [];
    
    if (plansConfig) {
      try {
        plans = typeof plansConfig === 'string' ? JSON.parse(plansConfig) : plansConfig;
        if (!Array.isArray(plans)) plans = [];
      } catch (e) {
        console.error('Error parsing vip_plans_config:', e);
      }
    }
    
    // If no dynamic plans, migrate from legacy config
    if (plans.length === 0) {
      const starsPricing = require('../constants/starsPricing');
      const legacyPlans = await starsPricing.getVipPlans();
      plans = Object.keys(legacyPlans).map(key => {
        const plan = legacyPlans[key];
        return {
          id: plan.id || key.toLowerCase(),
          name: plan.name || key,
          stars: plan.stars || 0,
          days: plan.days || 0,
          enabled: true
        };
      });
      // Save migrated plans
      await ConfigService.set('vip_plans_config', JSON.stringify(plans), req.admin.telegramId);
    }
    
    res.json({ success: true, plans });
  } catch (error) {
    console.error('Get VIP plans error:', error);
    res.status(500).json({ error: 'Failed to fetch VIP plans' });
  }
});

/**
 * API: Update dynamic VIP plans (protected)
 */
router.post('/api/vip-plans', requireAdmin, async (req, res) => {
  try {
    const { plans } = req.body;
    
    if (!Array.isArray(plans)) {
      return res.status(400).json({ error: 'plans must be an array' });
    }
    
    if (plans.length < 2 || plans.length > 8) {
      return res.status(400).json({ error: 'Must have between 2 and 8 plans' });
    }
    
    // Validate each plan
    for (const plan of plans) {
      if (!plan.id || typeof plan.id !== 'string') {
        return res.status(400).json({ error: 'Each plan must have a valid id' });
      }
      if (typeof plan.stars !== 'number' || plan.stars < 0 || plan.stars > 10000) {
        return res.status(400).json({ error: 'Stars must be between 0 and 10000' });
      }
      if (typeof plan.days !== 'number' || plan.days < 1 || plan.days > 365) {
        return res.status(400).json({ error: 'Days must be between 1 and 365' });
      }
      if (plan.name && plan.name.length > 50) {
        return res.status(400).json({ error: 'Plan name must be 50 characters or less' });
      }
    }
    // Ensure unique IDs
    const ids = plans.map(p => p.id.trim().toLowerCase());
    const uniqueCount = new Set(ids).size;
    if (uniqueCount !== ids.length) {
      return res.status(400).json({ error: 'Plan IDs must be unique' });
    }
    
    // Save plans
    await ConfigService.set('vip_plans_config', JSON.stringify(plans), req.admin.telegramId);
    
    // Invalidate cache
    const AdminStatsCache = require('../services/adminStatsCache');
    AdminStatsCache.invalidate().catch(() => {});
    
    res.json({ success: true, message: 'VIP plans updated', plans });
  } catch (error) {
    console.error('Update VIP plans error:', error);
    res.status(500).json({ error: 'Failed to update VIP plans' });
  }
});

/**
 * API: Delete a VIP plan (protected)
 */
router.delete('/api/vip-plans/:planId', requireAdmin, async (req, res) => {
  try {
    const { planId } = req.params;
    const plansConfig = await ConfigService.get('vip_plans_config', null);
    
    if (!plansConfig) {
      return res.status(404).json({ error: 'No VIP plans configured' });
    }
    
    let plans = typeof plansConfig === 'string' ? JSON.parse(plansConfig) : plansConfig;
    if (!Array.isArray(plans)) {
      return res.status(400).json({ error: 'Invalid plans format' });
    }
    
    // Remove plan
    const filtered = plans.filter(p => p.id !== planId);
    
    if (filtered.length < 2) {
      return res.status(400).json({ error: 'Must have at least 2 plans' });
    }
    
    // Save updated plans
    await ConfigService.set('vip_plans_config', JSON.stringify(filtered), req.admin.telegramId);
    
    // Invalidate cache
    const AdminStatsCache = require('../services/adminStatsCache');
    AdminStatsCache.invalidate().catch(() => {});
    
    res.json({ success: true, message: 'Plan deleted', plans: filtered });
  } catch (error) {
    console.error('Delete VIP plan error:', error);
    res.status(500).json({ error: 'Failed to delete VIP plan' });
  }
});

/**
 * API: Emergency actions (LITE - quick control)
 */
router.post('/api/system/emergency', requireAdmin, async (req, res) => {
  try {
    const { action } = req.body;
    const { redisClient } = require('../database/redisClient');
    
    switch (action) {
      case 'clear-cache':
        // Clear admin cache only (not user cache)
        const keys = await redisClient.keys('admin:*').catch(() => []);
        if (keys.length > 0) {
          await redisClient.del(keys).catch(() => {});
        }
        res.json({ success: true, message: 'Admin cache cleared' });
        break;
        
      case 'stop-broadcasts':
        // Clear broadcast queue
        const broadcastKeys = await redisClient.keys('broadcast:*').catch(() => []);
        const bullKeys = await redisClient.keys('bull:broadcast-queue:*').catch(() => []);
        if (broadcastKeys.length > 0) {
          await redisClient.del(broadcastKeys).catch(() => {});
        }
        if (bullKeys.length > 0) {
          await redisClient.del(bullKeys).catch(() => {});
        }
        res.json({ success: true, message: 'Broadcast queue cleared' });
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Emergency action error:', error);
    res.status(500).json({ error: 'Failed to perform emergency action' });
  }
});

/**
 * API: Config presets - Save current config as preset (LITE)
 */
router.post('/api/config/preset', requireAdmin, async (req, res) => {
  try {
    const { name, config } = req.body;
    
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Preset name required' });
    }
    
    // Store preset in database (small JSON)
    const presetKey = `config_preset_${name}`;
    await ConfigService.set(presetKey, config, req.admin.telegramId);
    
    res.json({ success: true, message: 'Preset saved' });
  } catch (error) {
    console.error('Save preset error:', error);
    res.status(500).json({ error: 'Failed to save preset' });
  }
});

/**
 * API: Config presets - List all presets (LITE)
 */
router.get('/api/config/presets', requireAdmin, async (req, res) => {
  try {
    const { sequelize } = require('../database/connectionPool');
    const AppConfig = require('../models/appConfigModel');
    
    // Get all preset keys
    const presets = await AppConfig.findAll({
      where: {
        key: { [Op.like]: 'config_preset_%' }
      },
      attributes: ['key', 'value', 'updatedAt']
    });
    
    const presetList = presets.map(p => ({
      name: p.key.replace('config_preset_', ''),
      updatedAt: p.updatedAt
    }));
    
    res.json({ success: true, data: presetList });
  } catch (error) {
    console.error('List presets error:', error);
    res.status(500).json({ error: 'Failed to list presets' });
  }
});

/**
 * API: Config presets - Load preset (LITE)
 */
router.post('/api/config/preset/load', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Preset name required' });
    }
    
    const presetKey = `config_preset_${name}`;
    const preset = await ConfigService.get(presetKey, null);
    
    if (!preset) {
      return res.status(404).json({ error: 'Preset not found' });
    }
    
    res.json({ success: true, data: preset });
  } catch (error) {
    console.error('Load preset error:', error);
    res.status(500).json({ error: 'Failed to load preset' });
  }
});

/**
 * API: Get simple logs - Last 50 error lines (ULTRA-LITE)
 */
router.get('/api/logs/errors', requireAdmin, async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const logFile = path.join(__dirname, '..', 'logs', 'error.log');
    
    if (!fs.existsSync(logFile)) {
      return res.json({ success: true, data: [], message: 'No error log file found' });
    }
    
    // Read last 50 lines (lightweight)
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const last50 = lines.slice(-50).reverse(); // Most recent first
    
    // Parse JSON lines
    const errors = last50.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return { message: line, ts: new Date().toISOString() };
      }
    });
    
    res.json({ success: true, data: errors });
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

/**
 * API: Enhanced monitoring - Cached essential stats (ULTRA-LITE)
 */
router.get('/api/monitoring/stats', requireAdmin, async (req, res) => {
  try {
    const { redisClient } = require('../database/redisClient');
    const cacheKey = 'admin:monitoring:stats';
    
    // Check cache (60 seconds)
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    } catch (e) {
      // Cache miss, continue
    }
    
    // Get lightweight stats
    const [totalUsers, activeChats, vipCount] = await Promise.all([
      User.count().catch(() => 0),
      Chat.count({ where: { active: true } }).catch(() => 0),
      VipSubscription.count({ where: { expiresAt: { [Op.gt]: new Date() } } }).catch(() => 0)
    ]);
    
    // Get Redis queue sizes (lightweight)
    const { scanKeys } = require('../utils/redisScanHelper');
    const pairKeys = await scanKeys(redisClient, 'pair:*', 50).catch(() => []);
    const activeChatsRedis = pairKeys.length;
    
    const stats = {
      totalUsers,
      activeChats: Math.max(activeChats, activeChatsRedis),
      vipActive: vipCount,
      timestamp: new Date().toISOString()
    };
    
    // Cache for 60 seconds
    redisClient.setEx(cacheKey, 60, JSON.stringify({ success: true, data: stats })).catch(() => {});
    
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Monitoring stats error:', error);
    res.status(500).json({ error: 'Failed to get monitoring stats' });
  }
});

/**
 * API: Recommendations (lite, heuristic)
 */
router.get('/api/recommendations', requireAdmin, async (_req, res) => {
  try {
    const AdminStatsCache = require('../services/adminStatsCache');
    const overview = await AdminStatsCache.getOverview();
    const userMetrics = await AdminStatsCache.getUserMetrics();
    const config = await ConfigService.getMany({
      referral_enabled: true,
      required_channel_enabled: false,
      lock_chat_enabled: true,
      vip_enabled: true
    });

    const recs = [];
    const vipRate = (overview.vipActive || 0) / Math.max(overview.totalUsers || 0, 1);

    if (!config.vip_enabled) {
      recs.push({ title: 'Enable VIP', action: 'enable-vip', reason: 'VIP system is disabled', severity: 'high' });
    } else if (vipRate < 0.05) {
      recs.push({ title: 'Boost VIP uptake', action: 'review-vip-plans', reason: 'VIP penetration is under 5%', severity: 'medium' });
    }

    if (config.referral_enabled === false) {
      recs.push({ title: 'Turn on referrals', action: 'toggle-referral', reason: 'Referral system is off', severity: 'medium' });
    }

    if (config.required_channel_enabled === false) {
      recs.push({ title: 'Add required channels', action: 'open-channels', reason: 'No required channels configured', severity: 'low' });
    }

    if (config.lock_chat_enabled === false) {
      recs.push({ title: 'Enable lock chat', action: 'toggle-lock', reason: 'Lock chat monetization is off', severity: 'medium' });
    }

    if ((overview.activeChats || 0) < Math.max(3, Math.floor((overview.totalUsers || 0) / 50))) {
      recs.push({ title: 'Low active chats', action: 'check-health', reason: 'Active chats are below healthy threshold', severity: 'high' });
    }

    if ((userMetrics.today || 0) === 0 && (overview.totalUsers || 0) > 0) {
      recs.push({ title: 'Run a broadcast', action: 'open-broadcast', reason: 'No new users today', severity: 'low' });
    }

    res.json({ success: true, data: recs.slice(0, 8) });
  } catch (error) {
    console.error('Recommendations error:', error);
    res.status(500).json({ error: 'Failed to load recommendations' });
  }
});

/**
 * API: Broadcast message (protected) - Enhanced with targeting
 */
router.post('/api/broadcast', requireAdmin, async (req, res) => {
  try {
    const { message, audience, filters } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Build filters based on audience
    const broadcastFilters = filters || {};
    if (audience === 'vip') {
      broadcastFilters.vipOnly = true;
    } else if (audience === 'free') {
      broadcastFilters.freeOnly = true;
    }

    const result = await enqueueBroadcast({ message, audience: audience || 'all', meta: broadcastFilters });
    res.json({ success: true, message: 'Broadcast queued', jobId: result.id, impl: result.impl });
  } catch (error) {
    console.error('Broadcast error:', error);
    res.status(500).json({ error: 'Failed to queue broadcast' });
  }
});

/**
 * API: Get broadcast status (LITE - Redis read)
 */
router.get('/api/broadcast/status', requireAdmin, async (req, res) => {
  try {
    const { redisClient } = require('../database/redisClient');
    
    // Get broadcast queue status from Redis
    const queueKeys = await redisClient.keys('bull:broadcast-queue:*').catch(() => []);
    const activeJobs = queueKeys.length;
    
    res.json({
      success: true,
      data: {
        activeJobs,
        queueType: process.env.REDIS_URL?.startsWith('memory://') ? 'memory' : 'bull'
      }
    });
  } catch (error) {
    console.error('Broadcast status error:', error);
    res.status(500).json({ error: 'Failed to get broadcast status' });
  }
});

/**
 * API: List bot tokens (masked)
 */
router.get('/api/bots', requireAdmin, async (_req, res) => {
  try {
    const currentTokens = await ConfigService.get('bot_tokens', process.env.BOT_TOKENS || process.env.BOT_TOKEN || '');
    const tokens = currentTokens ? currentTokens.split(',').map(t => t.trim()).filter(Boolean) : [];
    const mask = (t) => t.length > 12 ? `${t.slice(0, 6)}...${t.slice(-4)}` : `${t.slice(0, 3)}***`;

    const bots = tokens.map((token, idx) => ({ id: `bot_${idx}`, token: mask(token) }));
    res.json({ success: true, bots, totalBots: bots.length });
  } catch (error) {
    console.error('List bots error:', error);
    res.status(500).json({ error: 'Failed to list bots' });
  }
});

/**
 * API: Add bot token (protected)
 */
// List bot tokens (masked)
router.get('/api/bots', requireAdmin, async (_req, res) => {
  try {
    const currentTokens = await ConfigService.get('bot_tokens', process.env.BOT_TOKENS || process.env.BOT_TOKEN || '');
    const tokens = (currentTokens || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    const masked = tokens.map((t, i) => ({
      id: `bot_${i}`,
      token: t.length > 12 ? `${t.slice(0, 6)}…${t.slice(-4)}` : '********'
    }));
    res.json({ success: true, bots: masked, total: tokens.length });
  } catch (error) {
    console.error('List bots error:', error);
    res.status(500).json({ error: 'Failed to list bots' });
  }
});

// Add bot token
router.post('/api/bots', requireAdmin, async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const currentTokens = await ConfigService.get('bot_tokens', process.env.BOT_TOKENS || process.env.BOT_TOKEN || '');
    const tokens = currentTokens ? currentTokens.split(',').map(t => t.trim()).filter(Boolean) : [];
    
    if (tokens.includes(token)) {
      return res.status(400).json({ error: 'Token already exists' });
    }

    tokens.push(token);
    await ConfigService.set('bot_tokens', tokens.join(','), req.admin.telegramId);

    res.json({ success: true, message: 'Bot token added. Restart required.', totalBots: tokens.length });
  } catch (error) {
    console.error('Add bot error:', error);
    res.status(500).json({ error: 'Failed to add bot' });
  }
});

/**
 * API: Remove bot token (DELETE variant for compatibility)
 */
router.delete('/api/bots/:index', requireAdmin, async (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);
    const currentTokens = await ConfigService.get('bot_tokens', process.env.BOT_TOKENS || process.env.BOT_TOKEN || '');
    const tokens = (currentTokens || '').split(',').map(t => t.trim()).filter(Boolean);
    if (Number.isNaN(index) || index < 0 || index >= tokens.length) {
      return res.status(400).json({ error: 'Invalid bot index' });
    }
    tokens.splice(index, 1);
    await ConfigService.set('bot_tokens', tokens.join(','), 'admin');
    res.json({ success: true, message: 'Bot token removed. Restart required.', totalBots: tokens.length });
  } catch (error) {
    console.error('Remove bot (DELETE) error:', error);
    res.status(500).json({ error: 'Failed to remove bot' });
  }
});

/**
 * API: Remove bot token (protected, DELETE)
 */
router.delete('/api/bots/:index', requireAdmin, async (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);

    const currentTokens = await ConfigService.get('bot_tokens', process.env.BOT_TOKENS || process.env.BOT_TOKEN || '');
    const tokens = currentTokens ? currentTokens.split(',').map(t => t.trim()).filter(Boolean) : [];
    
    if (Number.isNaN(index) || index < 0 || index >= tokens.length) {
      return res.status(400).json({ error: 'Invalid bot index' });
    }

    tokens.splice(index, 1);
    await ConfigService.set('bot_tokens', tokens.join(','), req.admin.telegramId);

    res.json({ success: true, message: 'Bot token removed. Restart required.', totalBots: tokens.length });
  } catch (error) {
    console.error('Remove bot error:', error);
    res.status(500).json({ error: 'Failed to remove bot' });
  }
});

// Backward compatible removal endpoint (POST)
router.post('/api/bots/:index/remove', requireAdmin, async (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);

    const currentTokens = await ConfigService.get('bot_tokens', process.env.BOT_TOKENS || process.env.BOT_TOKEN || '');
    const tokens = currentTokens ? currentTokens.split(',').map(t => t.trim()).filter(Boolean) : [];
    
    if (Number.isNaN(index) || index < 0 || index >= tokens.length) {
      return res.status(400).json({ error: 'Invalid bot index' });
    }

    tokens.splice(index, 1);
    await ConfigService.set('bot_tokens', tokens.join(','), req.admin.telegramId);

    res.json({ success: true, message: 'Bot token removed. Restart required.', totalBots: tokens.length });
  } catch (error) {
    console.error('Remove bot (POST) error:', error);
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
    
    // Invalidate cache after bulk update
    const AdminStatsCache = require('../services/adminStatsCache');
    AdminStatsCache.invalidate().catch(() => {});
    
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