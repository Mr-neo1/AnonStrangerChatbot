const ReferralService = require('../services/referralService');

class ReferralController {
  constructor(bot) {
    this.bot = bot;
    this.initialize();
  }

  initialize() {
    // Example: /invite <code>
    this.bot.onText(/\/invite (\d+)/, async (msg, match) => {
      const inviterId = msg.from.id;
      const invitedId = match[1];
      try {
        await ReferralService.createReferral(inviterId, invitedId);
        this.bot.sendMessage(inviterId, '✅ Referral recorded and pending — it will be counted once the invited user completes /start');
      } catch (err) {
        this.bot.sendMessage(inviterId, '❌ Could not record referral');
      }
    });
  }
}

module.exports = ReferralController;