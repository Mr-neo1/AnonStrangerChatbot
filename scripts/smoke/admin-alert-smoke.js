const path = require('path');

// Stub out required modules before loading AdminAlertService
const originalRequire = require.cache[require.resolve(path.join(__dirname, '..', '..', 'services', 'adminAlertService'))];
delete require.cache[require.resolve(path.join(__dirname, '..', '..', 'services', 'adminAlertService'))];

(async () => {
  const logger = require(path.join(__dirname, '..', '..', 'utils', 'logger'));
  const config = require(path.join(__dirname, '..', '..', 'config', 'config'));
  const { redisClient } = require(path.join(__dirname, '..', '..', 'database', 'redisClient'));

  // Track logged messages
  const logs = [];
  const origAppend = logger.appendJsonLog;
  logger.appendJsonLog = (file, obj) => {
    logs.push({ file, obj });
    return origAppend(file, obj).catch(() => {});
  };

  // Mock bots module
  const sentMessages = [];
  const mockBot = {
    sendMessage: async (chatId, message) => {
      sentMessages.push({ chatId, message });
      return true;
    }
  };

  const mockBots = {
    getBotById: (botId) => botId ? mockBot : null
  };

  // Clear cache and inject mock
  delete require.cache[require.resolve(path.join(__dirname, '..', '..', 'bots'))];
  require.cache[require.resolve(path.join(__dirname, '..', '..', 'bots'))] = {
    exports: mockBots,
    id: require.resolve(path.join(__dirname, '..', '..', 'bots'))
  };

  // Now load AdminAlertService
  const AdminAlertService = require(path.join(__dirname, '..', '..', 'services', 'adminAlertService'));

  try {
    // Setup: Save original config
    const origAdminChatId = config.ADMIN_ALERT_CHAT_ID;
    config.ADMIN_ALERT_CHAT_ID = 999999;

    // TEST 1: Send LOCK_ABUSE alert
    logs.length = 0;
    sentMessages.length = 0;
    await AdminAlertService.notify({
      type: 'LOCK_ABUSE',
      botId: 'bot_0',
      chatId: 100,
      offenderId: 600,
      ownerId: 500,
      count: 4,
      timestamp: new Date().toISOString()
    });

    if (sentMessages.length !== 1) {
      console.error('❌ LOCK_ABUSE alert not sent', sentMessages);
      process.exit(2);
    }
    const lockSent = logs.find(l => l.obj && l.obj.action === 'SENT' && l.obj.type === 'LOCK_ABUSE');
    if (!lockSent) {
      console.error('❌ LOCK_ABUSE SENT log missing', logs);
      process.exit(2);
    }

    // TEST 2: Send DISCONNECT_ABUSE alert
    logs.length = 0;
    sentMessages.length = 0;
    await AdminAlertService.notify({
      type: 'DISCONNECT_ABUSE',
      botId: 'bot_1',
      chatId: 200,
      userId: 700,
      count: 5,
      duringLock: true,
      timestamp: new Date().toISOString()
    });

    if (sentMessages.length !== 1) {
      console.error('❌ DISCONNECT_ABUSE alert not sent', sentMessages);
      process.exit(2);
    }
    const discSent = logs.find(l => l.obj && l.obj.action === 'SENT' && l.obj.type === 'DISCONNECT_ABUSE');
    if (!discSent) {
      console.error('❌ DISCONNECT_ABUSE SENT log missing', logs);
      process.exit(2);
    }

    // TEST 3: Rate limiting (second LOCK_ABUSE from same offender is skipped)
    logs.length = 0;
    sentMessages.length = 0;
    await AdminAlertService.notify({
      type: 'LOCK_ABUSE',
      botId: 'bot_0',
      chatId: 100,
      offenderId: 600,
      ownerId: 500,
      count: 5,
      timestamp: new Date().toISOString()
    });

    if (sentMessages.length !== 0) {
      console.error('❌ Rate limit did not block alert', sentMessages);
      process.exit(2);
    }
    const rateLimited = logs.find(l => l.obj && l.obj.reason === 'rate_limited');
    if (!rateLimited) {
      console.error('❌ SKIPPED (rate_limited) log missing', logs);
      process.exit(2);
    }

    // TEST 4: No admin chat configured (silent fail)
    config.ADMIN_ALERT_CHAT_ID = null;
    config.ADMIN_CONTROL_CHAT_ID = null;
    config.ADMIN_CHAT_ID = null;

    logs.length = 0;
    sentMessages.length = 0;
    await AdminAlertService.notify({
      type: 'LOCK_ABUSE',
      botId: 'bot_0',
      chatId: 100,
      offenderId: 600,
      ownerId: 500,
      count: 4,
      timestamp: new Date().toISOString()
    });

    if (sentMessages.length !== 0) {
      console.error('❌ Alert sent when no admin chat configured', sentMessages);
      process.exit(2);
    }
    const noConfig = logs.find(l => l.obj && l.obj.reason === 'no_admin_chat_configured');
    if (!noConfig) {
      console.error('❌ no_admin_chat_configured log missing', logs);
      process.exit(2);
    }

    // TEST 5: Null payload (silent fail)
    logs.length = 0;
    sentMessages.length = 0;
    config.ADMIN_ALERT_CHAT_ID = 999999;

    await AdminAlertService.notify(null);

    if (sentMessages.length !== 0) {
      console.error('❌ Alert sent for null payload', sentMessages);
      process.exit(2);
    }

    console.log('✅ Admin alert smoke tests passed');
    process.exit(0);
  } catch (err) {
    console.error('❌ Admin alert smoke tests failed', err);
    process.exit(2);
  } finally {
    // Cleanup
    logger.appendJsonLog = origAppend;
    if (originalRequire) {
      require.cache[require.resolve(path.join(__dirname, '..', '..', 'services', 'adminAlertService'))] = originalRequire;
    }
  }
})();
