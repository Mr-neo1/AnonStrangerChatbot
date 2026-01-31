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
const ConfigService = require('./services/configService');

let bots = [];
let botsById = new Map();
let isRestarting = false;
let isInitializing = false; // Prevents restart during initial startup

/**
 * Gracefully stop all bots and clean up resources
 */
async function stopAllBots() {
  console.log('\n🛑 Shutting down bots...');
  
  const stopPromises = [];
  
  for (const b of bots) {
    try {
      if (b.stopPolling) {
        const cleanupPromise = (async () => {
          try {
            // Stop polling first with cancel flag to abort pending requests
            await b.stopPolling({ cancel: true });
            
            // Then delete webhook with drop_pending_updates to force Telegram to release the connection
            await b.deleteWebHook({ drop_pending_updates: true }).catch(() => {});
            
            // Also try to close the bot instance completely
            if (b.closeBot) {
              await b.closeBot().catch(() => {});
            }
            
            if (b._meta) {
              console.log(`  ✅ Stopped polling for ${b._meta.botId}`);
            }
          } catch (e) {
            console.log(`  ⚠️ Cleanup error for ${b._meta?.botId || 'unknown'}: ${e.message}`);
          }
        })();
        
        stopPromises.push(cleanupPromise);
      }
    } catch (err) {
      console.error(`  ⚠️ Error stopping bot:`, err.message);
    }
  }
  
  // Wait for all stop operations to complete
  if (stopPromises.length > 0) {
    await Promise.allSettled(stopPromises);
  }
  
  // Clear arrays
  bots = [];
  botsById.clear();
  
  console.log('✅ All bots stopped');
}

/**
 * Restart all bots without exiting the process
 * Stops all current bots, reloads config, starts new bots
 */
async function restartAllBots() {
  if (isRestarting) {
    console.log('⚠️ Restart already in progress...');
    return { success: false, message: 'Restart already in progress' };
  }
  
  if (isInitializing) {
    console.log('⚠️ Cannot restart while bots are still initializing...');
    return { success: false, message: 'Bots are still initializing. Please wait 30 seconds.' };
  }
  
  isRestarting = true;
  global._botRestartInProgress = true;
  console.log('\n🔄 Restarting all bots...');
  
  try {
    // Step 1: Stop all current bots
    await stopAllBots();
    
    // Step 2: Wait for Telegram to release long-polling connections
    // Telegram long-polling has a default timeout of ~30 seconds
    // node-telegram-bot-api default polling interval is 300ms with 10s timeout
    // We wait 20 seconds to ensure all connections are fully closed
    console.log('⏳ Waiting for Telegram connections to fully close (20s)...');
    await new Promise(resolve => setTimeout(resolve, 20000));
    
    // Step 2.5: Double-check no bots are still running
    if (bots.length > 0 || botsById.size > 0) {
      console.log('⚠️ Cleaning up lingering bot references...');
      bots = [];
      botsById.clear();
    }
    
    // Step 3: Reinitialize bots with fresh config
    await initBots(true); // true = skip lock check (we already have it)
    
    // Allow a moment for polling to stabilize, then clear the flag
    setTimeout(() => {
      global._botRestartInProgress = false;
    }, 15000);
    
    console.log('✅ All bots restarted successfully!');
    isRestarting = false;
    return { success: true, message: 'All bots restarted successfully' };
  } catch (err) {
    console.error('❌ Restart failed:', err.message);
    isRestarting = false;
    global._botRestartInProgress = false;
    return { success: false, message: err.message };
  }
}

async function initBots(skipLock = false) {
  // Set initializing flag to prevent restarts during startup
  isInitializing = true;
  
  // Validate required exports
  if (typeof bot.createBotWithControllers !== 'function') {
    isInitializing = false;
    throw new Error('FATAL: createBotWithControllers is not exported from ./bot');
  }
  
  try {
    // Ensure DB is connected and safe migrations have run
    await bot.initApp();

    // Seed defaults if missing
    await ConfigService.initializeDefaults().catch(() => {});

    // Try to load tokens from ConfigService first (admin panel managed), then fallback to env
    let tokens = [];
    
    try {
      const overrideTokens = await ConfigService.get('bot:tokens:override', null);
      if (overrideTokens && Array.isArray(overrideTokens) && overrideTokens.length) {
        tokens = overrideTokens.filter(Boolean).map(t => String(t).trim()).filter(Boolean);
        console.log(`📦 Loaded ${tokens.length} bot token(s) from admin override config`);
      }

      if (tokens.length === 0) {
        const dbTokens = await ConfigService.get('bot_tokens', null);
        if (dbTokens && typeof dbTokens === 'string' && dbTokens.trim()) {
          tokens = dbTokens.split(',').map(t => t.trim()).filter(Boolean);
          console.log(`📦 Loaded ${tokens.length} bot token(s) from database config`);
        } else if (Array.isArray(dbTokens) && dbTokens.length) {
          tokens = dbTokens.map(t => String(t).trim()).filter(Boolean);
          console.log(`📦 Loaded ${tokens.length} bot token(s) from database array config`);
        }
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

    // Acquire process lock to prevent multiple instances (auto-kills old processes)
    // Skip if this is a restart (we already have the lock)
    if (!skipLock) {
      const lockAcquired = ProcessLock.acquire(true);
      if (!lockAcquired) {
        isInitializing = false;
        throw new Error('Could not acquire bot lock. Another instance may be running.');
      }
    }

    console.log(`🚀 Starting ${tokens.length} bots...`);

    for (let idx = 0; idx < tokens.length; idx++) {
      const token = tokens[idx];
      const botId = `bot_${idx}`;
      console.log(`📍 Initializing ${botId}...`);
      try {
        const disabledFlag = await ConfigService.get(`bot:${botId}:disabled`, 'false').catch(() => 'false');
        if (String(disabledFlag) === 'true') {
          console.warn(`⏸️  Skipping ${botId} (disabled via admin panel)`);
          continue;
        }
        const isAdmin = config.ADMIN_BOT_TOKEN && config.ADMIN_BOT_TOKEN === token;

        // createBotWithControllers is now async - it clears webhooks before starting
        const botInstance = await bot.createBotWithControllers(token, { botId, isAdmin });
        bots.push(botInstance);
        botsById.set(botId, botInstance);
        botInstance._meta = { botId, index: idx, isAdmin };
        console.log(`🤖 Started bot ${botId} (isAdmin=${isAdmin})`);
      } catch (err) {
        console.error(`❌ Failed to start ${botId}:`, err.message);
        console.error(err.stack);
      }
    }

    // Clear initializing flag after a delay to allow polling to stabilize
    setTimeout(() => {
      isInitializing = false;
      console.log('✅ Bot initialization complete - restarts now allowed');
    }, 10000); // 10 second grace period

    return bots;
  } catch (err) {
    isInitializing = false;
    throw err;
  }
}

function getBotById(botId) {
  return botsById.get(botId);
}

function getAllBots() {
  return bots.slice();
}

/**
 * Stop a single bot by its ID
 */
async function stopSingleBot(botId) {
  const botInstance = botsById.get(botId);
  if (!botInstance) {
    console.log(`⚠️ Bot ${botId} not found in running bots (count: ${bots.length})`);
    // List available bots for debugging
    console.log(`   Available bots: ${Array.from(botsById.keys()).join(', ') || 'none'}`);
    return { success: false, message: 'Bot not found or already stopped' };
  }
  
  try {
    console.log(`🛑 Stopping ${botId}...`);
    
    // Step 1: Delete webhook to signal Telegram to stop sending updates
    try {
      await botInstance.deleteWebHook({ drop_pending_updates: true });
      console.log(`   ✅ Webhook deleted for ${botId}`);
    } catch (e) {
      console.log(`   ⚠️ Webhook delete error: ${e.message}`);
    }
    
    // Step 2: Stop polling - this cancels the long-polling request
    try {
      await botInstance.stopPolling({ cancel: true });
      console.log(`   ✅ Polling stopped for ${botId}`);
    } catch (e) {
      console.log(`   ⚠️ StopPolling error: ${e.message}`);
    }
    
    // Step 3: Close any active HTTP connections (for node-telegram-bot-api)
    try {
      if (botInstance._polling) {
        botInstance._polling.abort = true;
      }
      // Clear all listeners to prevent ghost responses
      botInstance.removeAllListeners();
      console.log(`   ✅ Listeners removed for ${botId}`);
    } catch (e) {}
    
    // Step 4: Remove from arrays
    const idx = bots.findIndex(b => b._meta?.botId === botId);
    if (idx !== -1) {
      bots.splice(idx, 1);
      console.log(`   ✅ Removed from bots array (now ${bots.length} bots)`);
    }
    botsById.delete(botId);
    
    console.log(`✅ Stopped ${botId} successfully`);
    return { success: true, message: `Bot ${botId} stopped` };
  } catch (err) {
    console.error(`❌ Error stopping ${botId}:`, err.message);
    return { success: false, message: err.message };
  }
}

/**
 * Start a single bot by its index
 */
async function startSingleBot(index) {
  const botId = `bot_${index}`;
  
  // Check if already running
  if (botsById.has(botId)) {
    console.log(`⚠️ Bot ${botId} is already running`);
    return { success: false, message: 'Bot already running' };
  }
  
  try {
    // Get tokens
    let tokens = [];
    try {
      const dbTokens = await ConfigService.get('bot_tokens', null);
      if (dbTokens && typeof dbTokens === 'string' && dbTokens.trim()) {
        tokens = dbTokens.split(',').map(t => t.trim()).filter(Boolean);
      }
    } catch (e) {}
    
    if (tokens.length === 0) {
      const config = require('./config/config');
      tokens = config.BOT_TOKENS || [];
      if (tokens.length === 0 && config.BOT_TOKEN) {
        tokens.push(config.BOT_TOKEN);
      }
    }
    
    if (index >= tokens.length) {
      return { success: false, message: `Bot index ${index} out of range` };
    }
    
    const token = tokens[index];
    console.log(`📍 Starting ${botId}...`);
    
    // Clear webhook first
    const TelegramBot = require('node-telegram-bot-api');
    const tempBot = new TelegramBot(token, { polling: false });
    await tempBot.deleteWebHook({ drop_pending_updates: true });
    
    // Wait a moment for Telegram to process
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const config = require('./config/config');
    const isAdmin = config.ADMIN_BOT_TOKEN && config.ADMIN_BOT_TOKEN === token;
    
    const botInstance = await bot.createBotWithControllers(token, { botId, isAdmin });
    bots.push(botInstance);
    botsById.set(botId, botInstance);
    botInstance._meta = { botId, index, isAdmin };
    
    console.log(`✅ Started ${botId}`);
    return { success: true, message: `Bot ${botId} started` };
  } catch (err) {
    console.error(`❌ Error starting ${botId}:`, err.message);
    return { success: false, message: err.message };
  }
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

module.exports = { initBots, getBotById, getAllBots, startHealthCheck, stopAllBots, restartAllBots, stopSingleBot, startSingleBot };

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
