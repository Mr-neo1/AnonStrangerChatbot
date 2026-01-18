const { createSession, isAdmin } = require('../middlewares/adminAuth');
const LoginCodeService = require('../services/loginCodeService');

class AdminLoginController {
  constructor(bot) {
    this.bot = bot;
    this.setupHandlers();
  }

  setupHandlers() {
    // Handle /admin_login command
    this.bot.onText(/\/admin_login(?:\s+(\d{6}))?/, async (msg, match) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const code = match[1];

      // Check if user is an authorized admin
      if (!isAdmin(userId)) {
        await this.bot.sendMessage(chatId, '❌ Unauthorized. You are not an admin.');
        return;
      }

      // If no code provided, show instructions
      if (!code) {
        await this.bot.sendMessage(
          chatId,
          '🔐 *Admin Login*\n\n' +
          'To login to the admin dashboard:\n' +
          '1. Go to the admin dashboard login page\n' +
          '2. Enter your Telegram ID\n' +
          '3. Get a 6-digit code\n' +
          '4. Send: `/admin_login <code>`\n\n' +
          'Example: `/admin_login 123456`',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Verify code via persistent store
      const loginData = await LoginCodeService.getCode(code);

      if (!loginData) {
        await this.bot.sendMessage(chatId, '❌ Invalid or expired code. Please try again.');
        return;
      }

      if (new Date(loginData.expiresAt).getTime() < Date.now()) {
        await LoginCodeService.deleteCode(code);
        await this.bot.sendMessage(chatId, '❌ Code expired. Please request a new one.');
        return;
      }

      if (String(loginData.telegramId) !== String(userId)) {
        await this.bot.sendMessage(chatId, '❌ This code was not generated for your Telegram ID.');
        return;
      }

      // Create session and auto-complete login (async)
      try {
        const token = await createSession(userId);
        
        if (!token) {
          throw new Error('Failed to create session token');
        }
        
        // Verify session was created
        const { validateSession } = require('../middlewares/adminAuth');
        const session = await validateSession(token);
        
        if (!session) {
          throw new Error('Session validation failed after creation');
        }
        
        await LoginCodeService.confirmCode(code, userId, token);

        // Auto-login - notify admin they're logged in
        await this.bot.sendMessage(
          chatId,
          '✅ *Login Successful!*\n\n' +
          'You are now logged in to the admin dashboard.\n' +
          'Go to your browser to access the dashboard.',
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('[AdminLogin] Session creation error:', error);
        await this.bot.sendMessage(
          chatId,
          '❌ *Login Failed*\n\n' +
          'Failed to create session. Please try again.\n' +
          'Error: ' + error.message,
          { parse_mode: 'Markdown' }
        );
      }
    });
  }
}

module.exports = AdminLoginController;
