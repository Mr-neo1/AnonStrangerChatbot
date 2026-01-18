(async () => {
  const path = require('path');
  const MatchingService = require(path.join('..','..','services','matchingService'));
  const VipService = require(path.join('..','..','services','vipService'));
  const VipSubscription = require(path.join('..','..','models','vipSubscriptionModel'));
  const User = require(path.join('..','..','models','userModel'));
  const { redisClient } = require(path.join('..','..','database','redisClient'));
  const keys = require(path.join('..','..','utils','redisKeys'));
  const logger = require(path.join('..','..','utils','logger'));

  // stub logger to capture logs
  const logs = [];
  const origAppend = logger.appendJsonLog;
  logger.appendJsonLog = (file, obj) => { logs.push(obj); origAppend(file, obj); };

  const botId = 'default';
  try {
    // Clear queues
    for (const k of keys.QUEUE_ALL_KEYS(botId)) {
      try { await redisClient.del(k); } catch (e) {}
    }

    // Stub users
    const users = {
      101: { userId: 101, gender: 'Male', vipGender: 'Female' },
      102: { userId: 102, gender: 'Female' },
    };
    User.findOne = async (opts) => users[opts.where.userId] || null;

    // Test 1: VIP valid -> VIP queue
    VipSubscription.findOne = async (opts) => {
      if (opts.where.userId === 101) return { userId: 101, expiresAt: new Date(Date.now() + 3600 * 1000) };
      return null;
    };
    VipSubscription.destroy = async (opts) => { /* no-op */ };

    await MatchingService.enqueueUser(botId, 101);
    // check VIP presence
    const v1 = await redisClient.lRange(keys.QUEUE_VIP_ANY_KEY(botId), 0, -1);
    const legacyV = await redisClient.lRange(keys.QUEUE_VIP_KEY(botId), 0, -1);
    if ((!v1 || !v1.includes('101')) && (!legacyV || !legacyV.includes('101'))) {
      console.error('❌ VIP valid was not enqueued to VIP queues', { v1, legacyV }); process.exit(2);
    }

    // cleanup
    for (const k of keys.QUEUE_ALL_KEYS(botId)) { await redisClient.del(k); }

    // Test 2: VIP expired -> treated as FREE and cache cleared
    // Pre-set redis cache to simulate stale cache
    await redisClient.setEx(`user:vip:102`, 3600, '1');
    VipSubscription.findOne = async (opts) => {
      if (opts.where.userId === 102) return { userId: 102, expiresAt: new Date(Date.now() - 1000) };
      return null;
    };

    await MatchingService.enqueueUser(botId, 102);

    const freeList = await redisClient.lRange(keys.QUEUE_FREE_KEY(botId), 0, -1);
    if (!freeList || !freeList.includes('102')) { console.error('❌ Expired VIP was not downgraded to free queue', freeList); process.exit(2); }

    // Redis cache should be cleared
    const cacheVal = await redisClient.get(`user:vip:102`);
    if (cacheVal) { console.error('❌ Redis VIP cache not cleared on expiry', cacheVal); process.exit(2); }

    // Ensure log recorded
    const log = logs.find(l => l && l.action === 'downgraded_at_search' && l.userId === 102);
    if (!log) { console.error('❌ Downgrade log missing', logs); process.exit(2); }

    // cleanup
    for (const k of keys.QUEUE_ALL_KEYS(botId)) { await redisClient.del(k); }
    logs.length = 0;

    // Test 3: VIP expires mid-chat -> no effect on active pair
    // Simulate 101 matched with 201
    await redisClient.set('pair:101', '201');
    await redisClient.set('pair:201', '101');

    // Now simulate 101 expiry in DB
    VipSubscription.findOne = async (opts) => {
      if (opts.where.userId === 101) return { userId: 101, expiresAt: new Date(Date.now() - 1000) };
      return null;
    };

    // Trigger expiry check (search-time check would downgrade but we are mid-chat)
    const activeBefore = await redisClient.get('pair:101');
    await VipService.isVipActive(101); // should clear cache but not the active pair
    const activeAfter = await redisClient.get('pair:101');
    if (!activeBefore || !activeAfter || activeBefore !== activeAfter) {
      console.error('❌ Active chat was affected by VIP expiry mid-chat', activeBefore, activeAfter); process.exit(2);
    }

    console.log('✅ VIP expiry smoke tests passed');
    process.exit(0);
  } catch (err) {
    console.error('❌ VIP expiry smoke tests failed', err);
    process.exit(2);
  } finally {
    logger.appendJsonLog = origAppend;
  }
})();