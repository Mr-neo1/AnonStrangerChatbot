(async () => {
  // Simple smoke tests that do not require network or DB access.
  // They stub critical services to keep behavior deterministic and safe.
  const path = require('path');
  const MatchingService = require(path.join('..', '..', 'services', 'matchingService'));
  const VipService = require(path.join('..', '..', 'services', 'vipService'));
  const auth = require(path.join('..', '..', 'middlewares', 'authMiddleware'));
  const User = require(path.join('..', '..', 'models', 'userModel'));

  // Stubs that must be in place BEFORE the controller module is loaded
  auth.checkUserJoined = async () => true; // always allow for these UI tests

  const Enhanced = require(path.join('..', '..', 'controllers', 'enhancedChatController'));

  // Additional stubs
  MatchingService.matchNextUser = async () => null; // no partner available
  let enqueueCalled = false;
  MatchingService.enqueueUser = async (botId, userId) => { enqueueCalled = true; };
  MatchingService.isUserQueued = async () => false;
  VipService.isVip = async () => false;
  User.findOne = async () => ({ userId: 999, gender: 'Male', age: 25 });

  // Fake bot that records messages and registers handlers
  class FakeBot {
    constructor() {
      this.onTextHandlers = [];
      this.onHandlers = {};
      this.messages = [];
    }
    onText(regex, cb) { this.onTextHandlers.push({ regex, cb }); }
    on(event, cb) { this.onHandlers[event] = cb; }
    async sendMessage(chatId, text, opts) {
      this.messages.push({ chatId: String(chatId), text, opts });
      return { message_id: Date.now() };
    }
    async editMessageText() { return true; }
    async deleteMessage() { return true; }
    // Minimal getChatMember stub to satisfy auth checks if invoked
    async getChatMember(handle, userId) { return { status: 'member' }; }
  }

  const bot = new FakeBot();
  // instantiate controller which registers handlers on our fake bot
  new Enhanced(bot);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const findHandler = (matchText) => {
    for (const h of bot.onTextHandlers) {
      try {
        if (h.regex && h.regex.test && h.regex.test(matchText)) return h.cb;
      } catch (e) {
        // ignore
      }
    }
    return null;
  };

  // Test 1: Menu flow shows '⭐ Buy Premium' and Back restores main keyboard
  const menuHandler = findHandler('☰ Menu');
  if (!menuHandler) throw new Error('Menu handler not found');
  await menuHandler({ chat: { id: 2000 }, from: { id: 2000 }, text: '☰ Menu' });
  await sleep(20);

  const lastMenuMsg = bot.messages[bot.messages.length - 1];
  if (!lastMenuMsg) throw new Error('No message after pressing Menu');
  if (!lastMenuMsg.opts || !lastMenuMsg.opts.reply_markup) throw new Error('Menu reply markup missing');
  const menuKeys = JSON.stringify(lastMenuMsg.opts.reply_markup.keyboard);
  if (!menuKeys.includes('Buy Premium') && !menuKeys.includes('\u2B50 Buy Premium')) throw new Error('Buy Premium not present in Menu keyboard');

  // Press Buy Premium
  const buyHandler = findHandler('⭐ Buy Premium');
  if (!buyHandler) throw new Error('Buy Premium handler not found');
  await buyHandler({ chat: { id: 2000 }, from: { id: 2000 }, text: '⭐ Buy Premium' });
  await sleep(10);
  const buyMsg = bot.messages[bot.messages.length - 1];
  if (!buyMsg.text || !String(buyMsg.text).includes('coming soon')) throw new Error('Buy Premium stub message incorrect');

  // Press Back -> should restore main keyboard
  const backHandler = findHandler('🔙 Back');
  if (!backHandler) throw new Error('Back handler not found');
  await backHandler({ chat: { id: 2000 }, from: { id: 2000 }, text: '🔙 Back' });
  await sleep(10);
  const backMsg = bot.messages[bot.messages.length - 1];
  if (!backMsg.opts || !backMsg.opts.reply_markup) throw new Error('Back did not send keyboard');
  const mainKeys = JSON.stringify(backMsg.opts.reply_markup.keyboard);
  if (!mainKeys.includes('Find Partner')) throw new Error('Main keyboard does not contain Find Partner');

  // Test 2: Single-shot Looking for partner message
  const searchHandler = findHandler('🔍 Find Partner') || findHandler('/search');
  if (!searchHandler) throw new Error('Search handler not found');

  // First search - user not queued
  await searchHandler({ chat: { id: 3000 }, from: { id: 3000 }, text: '🔍 Find Partner' });
  await sleep(20);
  const lookMsgs = bot.messages.filter(m => typeof m.text === 'string' && m.text.includes('Looking for partner'));
  if (lookMsgs.length !== 1) throw new Error('Expected exactly one Looking for partner message on first search');
  if (!enqueueCalled) throw new Error('Expected enqueue to be called on first search');

  // Simulate user already queued and search again (should NOT send duplicate)
  MatchingService.isUserQueued = async () => true;
  enqueueCalled = false;
  await searchHandler({ chat: { id: 3000 }, from: { id: 3000 }, text: '🔍 Find Partner' });
  await sleep(20);
  const lookMsgsAfter = bot.messages.filter(m => typeof m.text === 'string' && m.text.includes('Looking for partner'));
  if (lookMsgsAfter.length !== 1) throw new Error('Duplicate Looking for partner message was sent when user already queued');
  if (enqueueCalled) throw new Error('enqueue should not be called when user already queued');

  console.log('SMOKE TESTS PASS ✅');
  process.exit(0);
})().catch((err) => {
  console.error('SMOKE TESTS FAIL ❌', err);
  process.exit(2);
});