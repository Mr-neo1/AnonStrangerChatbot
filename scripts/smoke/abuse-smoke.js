(async () => {
  const path = require('path');
  const AbuseService = require(path.join('..','..','services','abuseService'));
  const { redisClient } = require(path.join('..','..','database','redisClient'));
  const logger = require(path.join('..','..','utils','logger'));

  // AdminAlertService is already implemented, no stubbing needed

  // Capture logs
  const logs = [];
  const origAppend = logger.appendJsonLog;
  logger.appendJsonLog = (file, obj) => { logs.push(obj); origAppend(file, obj); };

  try {
    // Cleanup any existing keys
    await redisClient.del('lock:abuse:100:600');
    await redisClient.del('disconnect:abuse:700');

    // Lock abuse incremental checks
    let res = await AbuseService.recordLockAbuse({ chatId: 100, offenderId: 600, ownerId: 500, botId: 'bot_0' });
    if (res.count !== 1 || res.level !== 'NONE') { console.error('❌ LockAbuse step1 failed', res); process.exit(2); }
    const ttl1 = await redisClient.ttl('lock:abuse:100:600');
    if (!ttl1 || ttl1 <= 0) { console.error('❌ TTL not set for lock abuse key', ttl1); process.exit(2); }

    res = await AbuseService.recordLockAbuse({ chatId: 100, offenderId: 600, ownerId: 500, botId: 'bot_0' });
    if (res.count !== 2 || res.level !== 'NONE') { console.error('❌ LockAbuse step2 failed', res); process.exit(2); }

    res = await AbuseService.recordLockAbuse({ chatId: 100, offenderId: 600, ownerId: 500, botId: 'bot_0' });
    if (res.count !== 3 || res.level !== 'WARN') { console.error('❌ LockAbuse step3 failed', res); process.exit(2); }
    // log recorded
    const warnLog = logs.find(l => l && l.type === 'LOCK_ABUSE' && l.count === 3);
    if (!warnLog) { console.error('❌ Warn log missing for lock abuse', logs); process.exit(2); }

    res = await AbuseService.recordLockAbuse({ chatId: 100, offenderId: 600, ownerId: 500, botId: 'bot_0' });
    if (res.count !== 4 || res.level !== 'ALERT') { console.error('❌ LockAbuse step4 failed', res); process.exit(2); }
    const alertLog = logs.find(l => l && l.type === 'LOCK_ABUSE' && l.count === 4);
    if (!alertLog) { console.error('❌ Alert log missing for lock abuse', logs); process.exit(2); }

    // Disconnect abuse
    res = await AbuseService.recordDisconnectAbuse({ userId: 700, chatId: 101, botId: 'bot_0', duringLock: true });
    if (res.count !== 1 || res.level !== 'NONE') { console.error('❌ Disconnect step1 failed', res); process.exit(2); }

    res = await AbuseService.recordDisconnectAbuse({ userId: 700, chatId: 101, botId: 'bot_0', duringLock: true });
    if (res.count !== 2 || res.level !== 'NONE') { console.error('❌ Disconnect step2 failed', res); process.exit(2); }

    res = await AbuseService.recordDisconnectAbuse({ userId: 700, chatId: 101, botId: 'bot_0', duringLock: true });
    if (res.count !== 3 || res.level !== 'WARN') { console.error('❌ Disconnect step3 failed', res); process.exit(2); }
    const dWarnLog = logs.find(l => l && l.type === 'DISCONNECT_ABUSE' && l.count === 3);
    if (!dWarnLog) { console.error('❌ Warn log missing for disconnect abuse', logs); process.exit(2); }

    // bump to alert threshold
    await AbuseService.recordDisconnectAbuse({ userId: 700, chatId: 101, botId: 'bot_0' });
    const res5 = await AbuseService.recordDisconnectAbuse({ userId: 700, chatId: 101, botId: 'bot_0' });
    if (res5.count < 5 || res5.level !== 'ALERT') { console.error('❌ Disconnect alert threshold failed', res5); process.exit(2); }
    const dAlertLog = logs.find(l => l && l.type === 'DISCONNECT_ABUSE' && l.count >= 5);
    if (!dAlertLog) { console.error('❌ Alert log missing for disconnect abuse', logs); process.exit(2); }

    console.log('✅ Abuse smoke tests passed');
    process.exit(0);
  } catch (err) {
    console.error('❌ Abuse smoke tests failed', err);
    process.exit(2);
  } finally {
    logger.appendJsonLog = origAppend;
  }
})();