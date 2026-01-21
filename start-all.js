#!/usr/bin/env node

/**
 * Unified Startup Script
 * Starts both Telegram bot and admin dashboard Express server
 */

require('dotenv').config({ path: '.env.local' });
const logger = require('./utils/logger');

async function startAll() {
  try {
    logger.info('Starting Telegram bot and admin dashboard...');
    
    // 1. Start admin dashboard server first
    logger.info('Starting admin dashboard on port ' + (process.env.ADMIN_PORT || 3000));
    const { startServer } = require('./server');
    await startServer();
    
    // 2. Start Telegram bot (multi-bot support)
    logger.info('Starting Telegram bot...');
    const { initBots, startHealthCheck } = require('./bots');
    await initBots();
    startHealthCheck();
    
    logger.info('✅ All services started successfully');
    logger.info('Admin dashboard: http://localhost:' + (process.env.ADMIN_PORT || 3000) + '/admin/login');
    
  } catch (error) {
    logger.error('Failed to start services:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM. Shutting down gracefully...');
  process.exit(0);
});

// Start all services
if (require.main === module) {
  startAll();
}

module.exports = { startAll };
