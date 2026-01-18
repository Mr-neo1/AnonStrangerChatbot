(async () => {
  const path = require('path');
  process.env.ENABLE_STARS_PAYMENTS = 'true';
  // Ensure feature flags don't block routing
  process.env.ENABLE_VIP = 'true';
  process.env.ENABLE_LOCK_CHAT = 'true';

  // Minimal fake bot
  class FakeBot {
    constructor() { this.handlers = {}; this.messages = []; }
    on(event, cb) { this.handlers[event] = cb; }
    async sendMessage(chatId, text) { this.messages.push({ chatId, text }); }
  }

  const bot = new FakeBot();

  // Stubs for models and transaction
  const Referral = require(path.join('..','..','models','referralModel'));
  const AffiliateRewardCredit = require(path.join('..','..','models','affiliateRewardCreditModel'));
  const PaymentModel = require(path.join('..','..','models','starTransactionModel'));
  const sequelize = require(path.join('..','..','database','connectionPool')).sequelize;

  // Stub Referral.findOne to simulate an accepted referral
  let referralCalled = false;
  Referral.findOne = async (opts) => {
    referralCalled = true;
    return { id: 1, inviterId: 555, invitedId: 111, status: 'accepted' };
  };

  // Spy for affiliate create and stub findOne to avoid DB operations
  let createdRecord = null;
  AffiliateRewardCredit.findOne = async () => null;
  AffiliateRewardCredit.create = async (obj, opts) => { createdRecord = { obj, opts }; return { id: 42, ...obj }; };

  // Stub Payment model create and findOne
  PaymentModel.findOne = async () => null;
  PaymentModel.create = async (obj, opts) => ({ id: 'pay-123', ...obj });

  // Stub transaction to be a no-op object
  sequelize.transaction = async () => ({ commit: async () => {}, rollback: async () => {} });

  // Stub VipService to avoid DB interactions during this smoke test
  const VipService = require(path.join('..','..','services','vipService'));
  VipService.activateVip = async (userId, days, opts = {}) => {
    // Return fake expiry date
    return new Date(Date.now() + (days * 24 * 3600 * 1000));
  };
  VipService.setRedisVip = async () => {};

  const PaymentService = require(path.join('..','..','services','paymentService'));
  const svc = new PaymentService(bot);

  // Simulate successful_payment message for VIP (uses days=30 mapping -> 200 Stars expected)
  const fakeMsg = { from: { id: 111 }, message_id: 999, successful_payment: { provider_payment_charge_id: 'c1', telegram_payment_charge_id: 'c1', invoice_payload: JSON.stringify({ type: 'VIP', planId: 'PRO', days: 30 }), total_amount: 20000, currency: 'USD' } };

  // Call handler directly
  await svc.handleSuccessfulPayment(fakeMsg);

  if (!referralCalled) { console.error('Referral lookup was not performed'); process.exit(2); }
  if (!createdRecord) { console.error('Affiliate reward was not created'); process.exit(2); }
  const cr = createdRecord.obj;
  if (cr.referrerTelegramId !== 555) { console.error('referrer mismatch', cr); process.exit(2); }
  if (cr.rewardType !== 'VIP_DAYS') { console.error('rewardType mismatch', cr); process.exit(2); }
  if (typeof cr.rewardValue !== 'number' || cr.rewardValue <= 0) { console.error('rewardValue invalid', cr); process.exit(2); }

  console.log('AFFILIATE SMOKE PASS ✅', cr);
  process.exit(0);
})().catch(err => { console.error('AFFILIATE SMOKE FAIL ❌', err); process.exit(2); });