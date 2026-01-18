(async () => {
  const path = require('path');
  const MatchingService = require(path.join('..','..','services','matchingService'));
  const User = require(path.join('..','..','models','userModel'));
  const vipService = require(path.join('..','..','services','vipService'));
  const { redisClient } = require(path.join('..','..','database','redisClient'));
  const keys = require(path.join('..','..','utils','redisKeys'));

  // Clear queues
  const botId = 'default';
  for (const k of keys.QUEUE_ALL_KEYS(botId)) {
    try { await redisClient.del(k); } catch (e) {}
  }

  // Stubs
  const users = {
    101: { userId: 101, gender: 'Male', banned: false }, // VIP male, prefers female
    102: { userId: 102, gender: 'Female', banned: false }, // VIP female
    201: { userId: 201, gender: 'Female', banned: false }, // Free female
    301: { userId: 301, gender: 'Male', banned: false }, // Free male
    401: { userId: 401, gender: 'Female', banned: false }, // Free female 2
  };

  User.findOne = async (opts) => {
    const id = opts.where && opts.where.userId;
    return users[id] || null;
  };

  // VIP map
  const vipSet = new Set([101, 102]);
  vipService.isVip = async (id) => vipSet.has(Number(id));
  vipService.isVipActive = async (id) => vipSet.has(Number(id)); // Also stub isVipActive for matching service
  vipService.getVipPreferences = async (id) => {
    if (Number(id) === 101) return { gender: 'Female' };
    return { gender: 'Any' };
  };

  try {
    // Test 1: VIP↔VIP priority over Free
    await MatchingService.enqueueUser(botId, 201); // free female
    await MatchingService.enqueueUser(botId, 101); // vip male pref female
    await MatchingService.enqueueUser(botId, 102); // vip female

    const match = await MatchingService.matchNextUser(botId, 101, { gender: 'Female' });
    if (!match || Number(match) !== 102) { console.error('❌ VIP↔VIP priority failed - expected 102 got', match); process.exit(2); }

    // cleanup
    for (const k of keys.QUEUE_ALL_KEYS(botId)) { await redisClient.del(k); }

    // Test 2: VIP respects gender and matches free when no VIP
    await MatchingService.enqueueUser(botId, 201); // free female
    await MatchingService.enqueueUser(botId, 101); // vip male pref female

    const match2 = await MatchingService.matchNextUser(botId, 101);
    if (!match2 || Number(match2) !== 201) { console.error('❌ VIP↔Free matching failed - expected 201 got', match2); process.exit(2); }

    for (const k of keys.QUEUE_ALL_KEYS(botId)) { await redisClient.del(k); }

    // Test 3: Non-VIP random (free↔free)
    await MatchingService.enqueueUser(botId, 301); // free male
    await MatchingService.enqueueUser(botId, 401); // free female

    const match3 = await MatchingService.matchNextUser(botId, 301);
    if (!match3 || (Number(match3) !== 401)) { console.error('❌ Free↔Free matching failed - expected 401 got', match3); process.exit(2); }

    for (const k of keys.QUEUE_ALL_KEYS(botId)) { await redisClient.del(k); }

    // Test 4: No duplicate enqueue
    await MatchingService.enqueueUser(botId, 301);
    await MatchingService.enqueueUser(botId, 301);
    const list = await redisClient.lRange(keys.QUEUE_FREE_KEY(botId), 0, -1);
    if (!list || list.length !== 1) { console.error('❌ Duplicate enqueue detected', list); process.exit(2); }

    console.log('✅ VIP matching smoke tests passed');
    process.exit(0);
  } catch (err) {
    console.error('❌ VIP matching smoke tests failed', err);
    process.exit(2);
  }
})();