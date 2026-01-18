const PaymentService = require('../services/paymentService');

class PaymentController {
  constructor(bot) {
    this.bot = bot;
    // PaymentService also listens for successful_payment events; keep controller light
    this.paymentService = new PaymentService(bot);
  }
}

module.exports = PaymentController;