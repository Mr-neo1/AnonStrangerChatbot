/*
 Centralized bots bootstrap
 - Reads tokens from `config.BOT_TOKENS` (array)
 - Initializes one Telegram bot instance per token
 - Registers existing controllers for each bot
 - Exports helpers to access bots by id/index
*/

const config = require('./config/config');
const bot = require('./bot');
const ProcessLock = require('./utils/processLock');

const bots = [];
const botsById = new Map();

/**
 * Gracefully stop all bots and clean up resources
 */
async function stopAllBots() {
  console.log('\n🛑 Shutting down bots...');
  
  for (const bot of bots) {
    try {
      if (bot.stopPolling) {
        bot.stopPolling();
        if (bot._meta) {
          console.log(`  ✅ Stopped polling for ${bot._meta.botId}`);
        }
      }
    } catch (err) {
      console.error(`  ⚠️ Error stopping bot:`, err.message);
    }
  }
  
  // Release lock
  ProcessLock.release();
  console.log('✅ Shutdown complete');
}

async function initBots() {
  // Validate required exports
  if (typeof bot.createBotWithControllers !== 'function') {
    throw new Error('FATAL: createBotWithControllers is not exported from ./bot');
  }
  
  // Ensure DB is connected and safe migrations have run
  await bot.initApp();

  // Try to load tokens from ConfigService first (admin panel managed), then fallback to env
  const ConfigService = require('./services/configService');
  let tokens = [];
  
  try {
    const dbTokens = await ConfigService.get('bot_tokens', null);
    if (dbTokens && typeof dbTokens === 'string' && dbTokens.trim()) {
      tokens = dbTokens.split(',').map(t => t.trim()).filter(Boolean);
      console.log(`📦 Loaded ${tokens.length} bot token(s) from database config`);
    }
  } catch (err) {
    console.warn('⚠️ Failed to load bot_tokens from ConfigService, using env vars:', err.message);
  }
  
  // Fallback to environment variables if database has no tokens
  if (tokens.length === 0) {
    tokens = config.BOT_TOKENS || [];
    if (tokens.length === 0) {
      console.warn('⚠️ No BOT_TOKENS found in DB or env; falling back to single BOT_TOKEN (compat)');
      if (config.BOT_TOKEN) tokens.push(config.BOT_TOKEN);
    } else {
      console.log(`📦 Loaded ${tokens.length} bot token(s) from environment variables`);
    }
  }

  const { sequelize } = require('./database/connectionPool');
  const crypto = require('crypto');

  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx];
    const botId = `bot_${idx}`;
    const isAdmin = config.ADMIN_BOT_TOKEN && config.ADMIN_BOT_TOKEN === token;

    const botInstance = bot.createBotWithControllers(token, { botId, isAdmin });
    bots.push(botInstance);
    botsById.set(botId, botInstance);
    botInstance._meta = { botId, index: idx, isAdmin };
    console.log(`🤖 Started bot ${botId} (isAdmin=${isAdmin})`);
  }

  return bots;
}

function getBotById(botId) {
  return botsById.get(botId);
}

function getAllBots() {
  return bots.slice();
}

// Health check: monitor polling state of all bots
function startHealthCheck() {
  // Health monitoring
  setInterval(() => {
    bots.forEach((bot) => {
      if (!bot._pollingState) return;
      
      const { active, retryCount, maxRetries } = bot._pollingState;
      
      if (!active && retryCount > maxRetries) {
        console.error(`🚨 HEALTH CHECK: Bot ${bot.botId} polling is DEAD (retries exhausted)`);
        // Alert admin
        const config = require('./config/config');
        const { notifyAdmin } = require('./controllers/adminController');
        if (notifyAdmin && (config.ADMIN_CONTROL_CHAT_ID || config.ADMIN_CHAT_ID)) {
          notifyAdmin(`🚨 Bot ${bot.botId} polling has failed and cannot recover`).catch(() => {});
        }
      }
    });
  }, 60000); // Check every 60 seconds

  // Cleanup caches every 5 minutes to prevent memory leaks
  setInterval(() => {
    try {
      const MediaController = require('./controllers/mediaController');
      // Create dummy instance just to call cleanup
      const dummy = new MediaController({ on: () => {} });
      dummy.cleanupCaches();
      console.log('✅ Cache cleanup completed');
    } catch (err) {
      console.error('Cache cleanup error:', err.message);
    }
  }, 300000); // 5 minutes
}

module.exports = { initBots, getBotById, getAllBots, startHealthCheck };

// If this module is run directly, initialize bots and keep the process alive (failsafe for Windows)
if (require.main === module) {
  // Skip process lock when running in PM2 cluster mode (multiple instances expected)
  const isClusterMode = process.env.CLUSTER_MODE === 'true' || process.env.NODE_APP_INSTANCE !== undefined;
  const instanceId = process.env.NODE_APP_INSTANCE || process.env.INSTANCE_ID || '0';
  
  if (isClusterMode) {
    console.log(`🚀 Starting in CLUSTER MODE - Instance #${instanceId}`);
  } else {
    // Attempt to acquire process lock BEFORE doing anything else (single instance mode only)
    if (!ProcessLock.acquire()) {
      console.error('\n❌ Cannot start bot: another instance is already running');
      console.error('   Options:');
      console.error('   1. Stop the existing instance with Ctrl+C');
      console.error('   2. Or run: taskkill /IM node.exe /F');
      console.error(`   3. Or delete the lock file: .bot.lock`);
      console.error(`   4. Or use PM2 cluster mode: pm2 start ecosystem.config.js`);
      process.exit(1);
    }
  }

  // Register shutdown handlers to ensure lock is released
  process.on('SIGINT', async () => {
    console.log('\n📍 SIGINT received (Ctrl+C)');
    await stopAllBots();
    if (!isClusterMode) ProcessLock.release();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n📍 SIGTERM received');
    await stopAllBots();
    if (!isClusterMode) ProcessLock.release();
    process.exit(0);
  });

  process.on('exit', () => {
    if (!isClusterMode) ProcessLock.release();
  });

  initBots()
    .then(() => {
      const mode = isClusterMode ? `Cluster Instance #${instanceId}` : 'Single Instance';
      console.log(`🚀 All bots initialized - ${mode}`);
      startHealthCheck(); // Start health monitoring
      
      // Signal PM2 that app is ready (if running in PM2)
      if (process.send) {
        process.send('ready');
      }
    })
    .catch((err) => {
      console.error('Fatal init error', err);
      if (!isClusterMode) ProcessLock.release();
      process.exit(1);
    });

  // Keep Node's event loop alive (prevents immediate exit on Windows where polling alone may not)
  setInterval(() => {}, 1 << 30);
}
