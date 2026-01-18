(async () => {
  const path = require('path');

  // Ensure payments are enabled for smoke BEFORE requiring modules that read config
  process.env.ENABLE_STARS_PAYMENTS = 'true';
  process.env.PAYMENT_PROVIDER_TOKEN = 'fake-token';

  const PaymentService = require(path.join('..','..','services','paymentService'));
  const config = require(path.join('..','..','config','config'));


  // Fake bot - capture sendInvoice, answerPreCheckoutQuery and message sends
  class FakeBot {
    constructor() {
      this.handlers = {};
      this.sentInvoices = [];
      this.preCheckoutAnswered = [];
      this.messages = [];
    }
    on(event, cb) { this.handlers[event] = cb; }
    async sendInvoice(chatId, title, description, payload, providerToken, startParam, currency, prices, opts) {
      this.sentInvoices.push({ chatId, title, description, payload: payload || '', providerToken, currency, prices, opts });
      return { invoice: true };
    }
    async answerPreCheckoutQuery(id, ok, msg) { this.preCheckoutAnswered.push({ id, ok, msg }); }
    async answerCallbackQuery(id) { /* noop */ }
    async sendMessage(chatId, text) { this.messages.push({ chatId, text }); }
  }

  const bot = new FakeBot();

  // Instantiate PaymentService with the fake bot
  const svc = new PaymentService(bot);

  // Simulate a callback_query to buy PRO VIP
  const cb = { id: 'cb1', data: 'STAR_BUY:VIP:PRO', from: { id: 1001 }, message: { chat: { id: 1001 } } };
  await svc.bot.handlers['callback_query'](cb);

  if (bot.sentInvoices.length !== 1) {
    console.error('Expected 1 invoice to be sent'); process.exit(2);
  }
  const inv = bot.sentInvoices[0];
  const payload = JSON.parse(inv.payload);
  if (payload.type !== 'VIP' || payload.planId !== 'PRO') { console.error('Invoice payload mismatch', payload); process.exit(2); }

  // Simulate pre_checkout_query that matches invoice
  const pre = { id: 'pre1', invoice_payload: inv.payload, total_amount: inv.prices[0].amount };
  await svc.bot.handlers['pre_checkout_query'](pre);
  if (bot.preCheckoutAnswered.length !== 1 || bot.preCheckoutAnswered[0].ok !== true) { console.error('pre_checkout_query not approved'); process.exit(2); }

  console.log('PAYMENT SMOKE PASS ✅'); process.exit(0);
})().catch((err) => { console.error('PAYMENT SMOKE FAIL ❌', err); process.exit(2); });