(async () => {
  const path = require('path');
  // No env changes; test must be self-contained and stubbed.

  const AffiliateService = require(path.join('..','..','services','affiliateService'));
  const AffiliateRewardCredit = require(path.join('..','..','models','affiliateRewardCreditModel'));
  const Referral = require(path.join('..','..','models','referralModel'));

  // Counters for assertions
  let findOneCalls = 0;
  let createCalls = 0;

  // Stub Referral.findOne to simulate an accepted referral
  Referral.findOne = async (opts) => {
    return { id: 1, inviterId: 555, invitedId: 111, status: 'accepted' };
  };

  // Test inputs (same for both calls)
  const buyerTelegramId = 111;
  const sourcePaymentId = 'source-abc-123';
  const paidStars = 300; // example
  const paymentType = 'VIP';

  // Stub AffiliateRewardCredit.findOne to return null first, then non-null
  AffiliateRewardCredit.findOne = async (opts) => {
    findOneCalls++;
    // If called first time, simulate "not exists" by returning null; subsequent calls simulate existing record
    if (findOneCalls === 1) return null;
    return { id: 999, referrerTelegramId: 555, sourcePaymentId, rewardType: 'VIP_DAYS', rewardValue: 10, status: 'AVAILABLE' };
  };

  // Stub create to increment counter if invoked
  AffiliateRewardCredit.create = async (obj, opts) => {
    createCalls++;
    return { id: 42, ...obj };
  };

  // Capture logs (search for skip message)
  const logs = [];
  const logger = require(path.join('..','..','utils','logger'));
  const origAppend = logger.appendJsonLog;
  logger.appendJsonLog = (file, obj) => { logs.push(obj); origAppend(file, obj); };

  try {
    // First attempt: should create
    const r1 = await AffiliateService.creditAffiliate(buyerTelegramId, sourcePaymentId, paidStars, paymentType, {});

    // Second attempt: should detect existing and skip
    const r2 = await AffiliateService.creditAffiliate(buyerTelegramId, sourcePaymentId, paidStars, paymentType, {});

    // Assertions
    if (createCalls !== 1) {
      console.error('❌ Affiliate idempotency violation detected (createCalls !== 1) -', createCalls);
      process.exit(2);
    }

    // Verify logs include skip reason
    const skipLog = logs.find(l => l.action && l.action.includes('skip_already_exists'));
    if (!skipLog) {
      console.error('❌ Affiliate idempotency violation detected (skip log not found) - logs:', logs);
      process.exit(2);
    }

    console.log('✅ Affiliate idempotency smoke test passed');
    process.exit(0);
  } catch (err) {
    console.error('❌ Affiliate idempotency violation detected', err);
    process.exit(2);
  } finally {
    // restore logger
    logger.appendJsonLog = origAppend;
  }
})().catch(err => { console.error('❌ Affiliate idempotency violation detected', err); process.exit(2); });