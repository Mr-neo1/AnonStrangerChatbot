(async () => {
  const path = require('path');
  const LockChatService = require(path.join('..','..','services','lockChatService'));
  const LockHistory = require(path.join('..','..','models','lockChatModel'));
  const { redisClient } = require(path.join('..','..','database','redisClient'));
  const EnhancedChatController = require(path.join('..','..','controllers','enhancedChatController'));

  // Fake bot to capture messages
  const messages = [];
  const fakeBot = {
    sendMessage: async (chatId, text, opts) => { messages.push({ chatId, text, opts }); },
    onText: () => {},
    on: () => {}
  };
  const controller = new EnhancedChatController(fakeBot);

  // Stubs
  let consumed = false;
  LockChatService.consumeLockMinutes = async (userId, minutesNeeded, opts = {}) => {
    consumed = true;
    return [{ id: 1, consumed: minutesNeeded }];
  };

  let created = null;
  LockHistory.create = async (obj, opts) => { created = obj; return obj; };

  try {
    // Ensure pair relationship
    await redisClient.set('pair:100', '600');
    await redisClient.set('pair:600', '100');

    // Activate lock via credits
    const rec = await LockChatService.activateLockFromCredits(100, 500, 600, 10, { botId: 'bot_0' });
    if (!consumed) { console.error('❌ consumeLockMinutes was not called'); process.exit(2); }
    if (!created || created.chatId !== 100) { console.error('❌ LockHistory.create was not called correctly', created); process.exit(2); }

    // Verify redis lock key exists
    const v = await redisClient.get('chat:locks:100:500');
    if (!v) { console.error('❌ Redis lock key missing'); process.exit(2); }

    const meta = await redisClient.get('lock:meta:100');
    if (!meta) { console.error('❌ lock meta missing'); process.exit(2); }

    // Partner (600) tries to stop chat -> should be blocked and abuse incremented
    messages.length = 0;
    await controller.stopChatInternal(600);
    const blockedMsg = messages.find(m => m.chatId === 600 && typeof m.text === 'string' && m.text.includes('locked'));
    if (!blockedMsg) { console.error('❌ Partner was not blocked from stopping the locked chat'); process.exit(2); }

    const abuseCount = await redisClient.get('lock:abuse:100:600');
    if (!abuseCount || Number(abuseCount) < 1) { console.error('❌ Abuse counter was not incremented', abuseCount); process.exit(2); }

    // Owner (500) stops chat -> should succeed and locks cleaned
    messages.length = 0;
    await controller.stopChatInternal(500);
    const ownerMsg = messages.find(m => m.chatId === 500 && m.text && m.text.includes('ended'));
    if (!ownerMsg) { console.error('❌ Owner could not stop the chat'); process.exit(2); }

    const lockKey = await redisClient.get('chat:locks:100:500');
    if (lockKey) { console.error('❌ Locks were not cleaned after owner stopped chat'); process.exit(2); }

    console.log('✅ Lock activation smoke tests passed');
    process.exit(0);
  } catch (err) {
    console.error('❌ Lock activation smoke tests failed', err);
    process.exit(2);
  }
})();