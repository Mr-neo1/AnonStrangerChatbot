require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { sequelize } = require("./database/connectionPool");
const { redisClient } = require("./database/redisClient");
const EnhancedChatController = require("./controllers/enhancedChatController");
const MediaController = require("./controllers/mediaController");
const AdminController = require("./controllers/adminController");

// Create a bot instance and register controllers
function createBotWithControllers(token, options = {}) {
  // Create bot without auto-polling so we can start it explicitly and log after start
  const bot = new TelegramBot(token, { polling: false });
  const config = require('./config/config');
  bot.botId = (options && options.botId) ? String(options.botId) : (config.BOT_ID || 'default');

  // Track polling state for recovery
  bot._pollingState = {
    active: false,
    retryCount: 0,
    maxRetries: 10,
    retryDelayMs: 2000,
    errorCache: []
  };

  // Attach controllers which register handlers on the bot instance
  new EnhancedChatController(bot);
  new MediaController(bot);
  new AdminController(bot);

  const PaymentController = require('./controllers/paymentController');
  const ReferralController = require('./controllers/referralController');
  const AdminLoginController = require('./controllers/adminLoginController');
  new PaymentController(bot);
  new ReferralController(bot);
  new AdminLoginController(bot);

  // Polling lifecycle: start polling explicitly and log success or errors
  try {
    // Begin polling (keeps process alive)
    bot.startPolling();
    bot._pollingState.active = true;
    bot._pollingState.retryCount = 0;

    // Register handler for polling errors with recovery
    bot.on('polling_error', (err) => {
      const errorMsg = (err && err.message) ? err.message : String(err);
      const errorCode = err && err.code;
      const httpStatus = (err && (err.response && err.response.statusCode)) || (err && err.response && err.response.status);
      
      // Track error for deduplication
      const now = Date.now();
      bot._pollingState.errorCache = bot._pollingState.errorCache.filter(e => now - e.ts < 60000); // Keep last 60s
      bot._pollingState.errorCache.push({ msg: errorMsg, ts: now });
      
      // Distinguish error types
      const isNetworkError = errorCode === 'ECONNRESET' || errorCode === 'ENOTFOUND' || 
                             errorCode === 'ETIMEDOUT' || errorCode === 'EHOSTUNREACH' ||
                             errorMsg.includes('socket hang up') || errorMsg.includes('getaddrinfo');
      
      const isAuthError = errorCode === 400 || errorMsg.includes('Unauthorized');
      const isConflict409 = (httpStatus === 409) || /409\s*Conflict/i.test(errorMsg) || errorMsg.includes('terminated by other getUpdates request');
      
      if (isAuthError) {
        // Permanent: invalid token
        console.error(`❌ FATAL: Auth error for bot ${bot.botId}: ${errorMsg}. Token invalid?`);
        bot._pollingState.active = false;
        // Don't retry - token is bad
        return;
      }
      
      if (isConflict409) {
        // Another process is polling with the same token. Do NOT loop restarts.
        console.error(`❌ 409 Conflict for bot ${bot.botId}: another process is polling getUpdates for this token.`);
        console.error('   Resolution: Stop other instances (PM2/Node), or run a single instance.');
        console.error('   Tip: On Windows, run: taskkill /IM node.exe /F');
        bot._pollingState.active = false;
        return;
      }
      
      if (isNetworkError) {
        // Temporary: network issue - attempt recovery
        bot._pollingState.retryCount += 1;
        const retryWaitMs = Math.min(bot._pollingState.retryDelayMs * Math.pow(2, bot._pollingState.retryCount - 1), 60000);
        
        console.warn(`⚠️ Network error (${errorCode}) for bot ${bot.botId} [attempt ${bot._pollingState.retryCount}/${bot._pollingState.maxRetries}]: ${errorMsg}`);
        
        if (bot._pollingState.retryCount <= bot._pollingState.maxRetries) {
          console.log(`   → Restarting polling in ${retryWaitMs}ms...`);
          setTimeout(() => {
            try {
              bot._pollingState.active = true;
              bot.startPolling();
              console.log(`✅ Polling restarted for bot ${bot.botId}`);
            } catch (restartErr) {
              console.error(`❌ Failed to restart polling for bot ${bot.botId}:`, restartErr && restartErr.message);
            }
          }, retryWaitMs);
        } else {
          console.error(`❌ Polling failed after ${bot._pollingState.maxRetries} retries for bot ${bot.botId}. Giving up.`);
          bot._pollingState.active = false;
          // Alert admin
          const { notifyAdmin } = require('./controllers/adminController');
          if (notifyAdmin) {
            notifyAdmin(`❌ Bot ${bot.botId} polling unrecoverable after ${bot._pollingState.maxRetries} retries`).catch(() => {});
          }
        }
      } else {
        // Unknown error type - log but try recovery once
        console.error(`❌ Unexpected polling error for bot ${bot.botId}: ${errorMsg}`);
        if (bot._pollingState.retryCount === 0) {
          bot._pollingState.retryCount = 1;
          setTimeout(() => {
            try {
              bot._pollingState.active = true;
              bot.startPolling();
              console.log(`✅ Polling restarted for bot ${bot.botId}`);
            } catch (restartErr) {
              console.error(`❌ Failed to restart polling for bot ${bot.botId}:`, restartErr && restartErr.message);
            }
          }, 3000);
        }
      }
    });

    // Confirm bot identity with getMe and then log startup message
    bot.getMe()
      .then((me) => {
        const display = me && me.username ? `@${me.username}` : '(unknown)';
        console.log(`🤖 Started bot ${bot.botId} (polling enabled) ${display}`);
      })
      .catch((err) => {
        console.warn(`⚠️ Bot ${bot.botId} polling started but getMe failed: ${err && err.message ? err.message : String(err)}`);
        console.log(`🤖 Started bot ${bot.botId} (polling enabled)`);
      });
  } catch (err) {
    console.error(`❌ Failed to start polling for bot ${bot.botId}:`, err && err.message ? err.message : err);
  }

  return bot;
}

/**
 * Initialize application-level resources (DB connection, PRAGMAs, safe migrations,
 * and global process-level handlers). Non-destructive and idempotent.
 */
async function initApp() {
  try {
    // Connect to SQL
    await sequelize.authenticate();
    console.log("✅ SQL Database Connected");
    
    // Create LockCredits table if it doesn't exist (fix for lock chat feature)
    const { createLockCreditsTable } = require('./database/createLockCreditsTable');
    await createLockCreditsTable().catch(err => {
      console.warn('⚠️  Could not create LockCredits table (may already exist):', err.message);
    });

    // Validate admin channel configuration (non-blocking)
    const { validateAdminChannels } = require('./config/config');
    const adminValidation = validateAdminChannels();
    
    console.log('\n📋 Admin Channel Configuration:');
    if (adminValidation.isValid || adminValidation.warnings.length > 0) {
      console.log('✅ Configuration status: OK');
      if (adminValidation.errors.length > 0) {
        adminValidation.errors.forEach(e => console.error(e));
      }
      if (adminValidation.warnings.length > 0) {
        adminValidation.warnings.forEach(w => console.warn(w));
      }
      if (adminValidation.recommendations.length > 0) {
        adminValidation.recommendations.forEach(r => console.log(r));
      }
    } else {
      console.error('❌ Configuration has errors:');
      adminValidation.errors.forEach(e => console.error(e));
      if (adminValidation.recommendations.length > 0) {
        console.log('→ Recommendations:');
        adminValidation.recommendations.forEach(r => console.log(r));
      }
    }
    console.log('');

    // Runtime PRAGMA and migrations disabled to enforce ZERO schema changes at startup.
    // No PRAGMA or CREATE TABLE will be executed by this process. All DB schema updates must be
    // performed manually via offline migration tooling and tested prior to deployment.
    // (Previously this code tuned PRAGMA and ran an additive `bots` table migration.)

    // Setup global process-level handlers for uncaught errors and promise rejections
    const logger = require('./utils/logger');
    const { notifyAdmin } = require('./controllers/adminController');
    const config = require('./config/config');

    process.on('uncaughtException', async (err) => {
      try {
        logger.appendErrorLog(err, { phase: 'uncaughtException' });
        if (config.ADMIN_CONTROL_CHAT_ID || config.ADMIN_CHAT_ID) {
          try { await notifyAdmin && notifyAdmin(`❌ Uncaught exception: ${err.message}`); } catch (e) { console.error('notifyAdmin failed', e); }
        }
      } catch (e) { console.error('Error handling uncaughtException:', e); }
      // Give a moment for logs/alerts before exiting
      setTimeout(() => process.exit(1), 1000);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      try {
        const err = reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'UnhandledRejection');
        logger.appendErrorLog(err, { phase: 'unhandledRejection', promise: String(promise) });
        if (config.ADMIN_CONTROL_CHAT_ID || config.ADMIN_CHAT_ID) {
          try { await notifyAdmin && notifyAdmin(`❌ Unhandled rejection: ${err.message}`); } catch (e) { console.error('notifyAdmin failed', e); }
        }
      } catch (e) { console.error('Error handling unhandledRejection:', e); }
      // Give a moment for logs/alerts before exiting
      setTimeout(() => process.exit(1), 1000);
    });

  } catch (error) {
    console.error('Initialization error (initApp):', error);
    throw error;
  }
}

async function main() {
  try {
    // Prevent duplicate bot runners in single-instance mode using a file lock
    const ProcessLock = require('./utils/processLock');
    const isClusterMode = process.env.CLUSTER_MODE === 'true' || process.env.NODE_APP_INSTANCE !== undefined;

    if (!isClusterMode) {
      if (!ProcessLock.acquire()) {
        // Another instance is already running; exit gracefully.
        process.exit(1);
      }

      // Release lock on exit
      const release = () => {
        try { ProcessLock.release(); } catch (_) {}
      };
      process.on('SIGINT', release);
      process.on('SIGTERM', release);
      process.on('exit', release);
    }

    await initApp();

    const config = require('./config/config');
    const primaryToken = (config.BOT_TOKENS && config.BOT_TOKENS[0]) || config.BOT_TOKEN;
    if (!primaryToken) {
      console.error('❌ Missing BOT_TOKENS/BOT_TOKEN in environment. Exiting.');
      process.exit(1);
    }

    createBotWithControllers(primaryToken, { botId: config.BOT_ID });
    console.log('🤖 Bot (legacy) is running...');
  } catch (error) {
    console.error('Initialization error:', error);
    process.exit(1);
  }
}

// Export core helpers immediately so modules that require this file get access synchronously
module.exports.createBotWithControllers = createBotWithControllers;
module.exports.initApp = initApp;
module.exports.main = main;

if (require.main === module) {
  main();
}
