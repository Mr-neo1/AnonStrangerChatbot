(async () => {
  const path = require('path');
  const AffiliateRedemptionService = require(path.join('..','..','services','affiliateRedemptionService'));
  const AffiliateRewardCredit = require(path.join('..','..','models','affiliateRewardCreditModel'));
  const VipService = require(path.join('..','..','services','vipService'));
  const LockCredit = require(path.join('..','..','models','lockCreditModel'));
  const logger = require(path.join('..','..','utils','logger'));

  // Stubs
  let findOneCalls = 0;
  let updateCalled = 0;
  let vipCalled = false;
  let lockCreated = null;

  // Credit owned by user 500
  const creditRecord = { id: 10, referrerTelegramId: 500, rewardType: 'VIP_DAYS', rewardValue: 3, status: 'AVAILABLE', createdAt: new Date() };

  // Stub findOne for AffiliateRewardCredit
  AffiliateRewardCredit.findOne = async (opts) => {
    findOneCalls++;
    if (opts.where && opts.where.id === creditRecord.id) return creditRecord;
    if (opts.where && opts.where.id === 9999) return { id: 9999, referrerTelegramId: 777, rewardType: 'LOCK_MINUTES', rewardValue: 15, status: 'AVAILABLE' };
    return null;
  };

  AffiliateRewardCredit.update = async (fields, opts) => {
    updateCalled++;
    // mutate the stub
    if (opts.where.id === creditRecord.id) { creditRecord.status = fields.status; }
    return [1];
  };

  VipService.activateVip = async (telegramId, days, opts = {}) => { vipCalled = true; return new Date(Date.now() + days * 24 * 3600 * 1000); };
  LockCredit.create = async (obj, opts) => { lockCreated = obj; return obj; };

  // Capture logs
  const logs = [];
  const origAppend = logger.appendJsonLog;
  logger.appendJsonLog = (file, obj) => { logs.push(obj); origAppend(file, obj); };

  try {
    // Test 1: Redeem AVAILABLE credit -> success
    let res = await AffiliateRedemptionService.redeemCredit({ creditId: creditRecord.id, telegramId: 500 });
    if (!res.success || !vipCalled) { console.error('❌ Redeem AVAILABLE credit failed', res); process.exit(2); }

    // Test 2: Redeem same credit twice -> skipped
    res = await AffiliateRedemptionService.redeemCredit({ creditId: creditRecord.id, telegramId: 500 });
    if (res.success) { console.error('❌ Duplicate redeem should be skipped but returned success'); process.exit(2); }
    const skipLog = logs.find(l => l && l.reason && l.reason === 'skip_already_redeemed' || (l.action && l.action === 'skip_already_redeemed'));
    if (!skipLog) { console.error('❌ Skip log missing', logs); process.exit(2); }

    // Test 3: Credit belongs to another user -> rejected
    res = await AffiliateRedemptionService.redeemCredit({ creditId: 9999, telegramId: 500 });
    if (res.success || res.reason !== 'not_owner') { console.error('❌ Redeem by wrong user should be rejected', res); process.exit(2); }

    // Test 4: LOCK_MINUTES redeem -> create LockCredit
    // stub a lock credit
    AffiliateRewardCredit.findOne = async (opts) => ({ id: 42, referrerTelegramId: 500, rewardType: 'LOCK_MINUTES', rewardValue: 12, status: 'AVAILABLE' });
    res = await AffiliateRedemptionService.redeemCredit({ creditId: 42, telegramId: 500 });
    if (!res.success || !lockCreated || lockCreated.minutes !== 12) { console.error('❌ Lock redeem failed', res, lockCreated); process.exit(2); }

    console.log('✅ Redeem smoke tests passed');
    process.exit(0);
  } catch (err) {
    console.error('❌ Redeem smoke tests failed', err);
    process.exit(2);
  } finally {
    logger.appendJsonLog = origAppend;
  }
})();