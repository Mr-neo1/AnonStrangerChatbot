#!/usr/bin/env node

/**
 * Unified Startup Script
 * Starts both Telegram bot and admin dashboard Express server
 */

// Suppress known deprecation warnings from dependencies (not our code)
// These come from node-telegram-bot-api internals and cannot be fixed without patching the library
process.env.NTBA_FIX_319 = '1'; // Fixes the filename deprecation
process.env.NTBA_FIX_350 = '1'; // Fixes the content-type deprecation

// Suppress util.isArray deprecation (comes from node-telegram-bot-api using old Node.js APIs)
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  // Suppress specific deprecation warnings from dependencies
  if (typeof warning === 'string' && warning.includes('util.isArray')) {
    return; // Suppress this specific warning
  }
  return originalEmitWarning.call(process, warning, ...args);
};

// Load .env.local first if exists, then fallback to .env
const fs = require('fs');
if (fs.existsSync('.env.local')) {
  require('dotenv').config({ path: '.env.local' });
} else {
  require('dotenv').config(); // loads .env by default
}

const logger = require('./utils/logger');
const { registerShutdownHandlers, onShutdown } = require('./utils/shutdownHandler');

async function startAll() {
  try {
    logger.info('Starting Telegram bot and admin dashboard...');
    
    // 1. Start admin dashboard server first
    const adminPort = process.env.ADMIN_PANEL_PORT || 4000;
    logger.info('Starting admin dashboard on port ' + adminPort);
    const { startAdminServer, stopAdminServer } = require('./admin-server');
    await startAdminServer();
    
    // Register admin server for graceful shutdown
    onShutdown(async () => {
      logger.info('Stopping admin server...');
      await stopAdminServer();
    });
    
    // 2. Start Telegram bot (multi-bot support)
    logger.info('Starting Telegram bot...');
    const { initBots, startHealthCheck, stopAllBots } = require('./bots');
    await initBots();
    startHealthCheck();
    
    // Register bots for graceful shutdown
    onShutdown(async () => {
      logger.info('Stopping Telegram bots...');
      await stopAllBots();
    });
    
    // 3. Register centralized shutdown handlers
    registerShutdownHandlers();
    
    logger.info('✅ All services started successfully');
    logger.info('Admin dashboard: http://localhost:' + adminPort + '/admin');
    
  } catch (error) {
    logger.error('Failed to start services:', error);
    process.exit(1);
  }
}

// Handle unhandled rejections and uncaught exceptions
process.on('unhandledRejection', (reason, promise) => {
  logger.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - let the app try to recover
});

process.on('uncaughtException', (error) => {
  logger.error('❌ Uncaught Exception:', error);
  // Don't exit immediately - log the error first
});

// NOTE: SIGINT/SIGTERM handlers are now in shutdownHandler.js
// and are registered via registerShutdownHandlers() in startAll()

// Start all services
if (require.main === module) {
  startAll().catch(err => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}

module.exports = { startAll };
