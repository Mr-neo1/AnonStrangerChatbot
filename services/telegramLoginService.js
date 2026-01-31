/**
 * Telegram Admin Login Service
 * Handles secure admin authentication via Telegram
 */

const crypto = require('crypto');
const AdminLoginToken = require('../models/adminLoginTokenModel');
const AuditService = require('./auditService');
const { Op } = require('sequelize');

class TelegramLoginService {
  // Token expiry time (5 minutes)
  static TOKEN_EXPIRY_MS = 5 * 60 * 1000;
  
  // Session expiry time (24 hours)
  static SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

  /**
   * Generate a login token for Telegram verification
   * Returns a token that should be sent to the user to verify via bot
   */
  static async generateLoginToken(ipAddress = null) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.TOKEN_EXPIRY_MS);

    try {
      await AdminLoginToken.create({
        token,
        telegramId: 0, // Will be set when verified
        status: 'pending',
        expiresAt,
        requestIp: ipAddress
      });

      return {
        success: true,
        token,
        expiresAt,
        expiresIn: this.TOKEN_EXPIRY_MS / 1000 // seconds
      };
    } catch (error) {
      console.error('Error generating login token:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify token from Telegram bot
   * Called when admin sends /verify <token> to bot
   */
  static async verifyToken(token, telegramUser, allowedAdminIds = []) {
    try {
      // Find pending token
      const loginToken = await AdminLoginToken.findOne({
        where: {
          token,
          status: 'pending',
          expiresAt: { [Op.gt]: new Date() }
        }
      });

      if (!loginToken) {
        return { success: false, error: 'Invalid or expired token' };
      }

      // Check if user is an allowed admin
      const telegramId = telegramUser.id;
      if (!allowedAdminIds.includes(String(telegramId))) {
        await loginToken.update({ status: 'expired' });
        return { success: false, error: 'Unauthorized. You are not an admin.' };
      }

      // Generate session token
      const sessionToken = crypto.randomBytes(32).toString('hex');

      // Update login token
      await loginToken.update({
        telegramId,
        username: telegramUser.username || null,
        firstName: telegramUser.first_name || null,
        status: 'verified',
        verifiedAt: new Date(),
        sessionToken
      });

      // Log the successful login
      await AuditService.logAuth(String(telegramId), 'telegram_login', {
        adminName: telegramUser.username || telegramUser.first_name || String(telegramId),
        method: 'telegram_widget'
      });

      return {
        success: true,
        sessionToken,
        user: {
          telegramId,
          username: telegramUser.username,
          firstName: telegramUser.first_name
        }
      };
    } catch (error) {
      console.error('Error verifying token:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check token status (polling from frontend)
   */
  static async checkTokenStatus(token) {
    try {
      const loginToken = await AdminLoginToken.findOne({
        where: { token }
      });

      if (!loginToken) {
        return { status: 'not_found' };
      }

      if (loginToken.status === 'verified' && loginToken.sessionToken) {
        // Mark as used
        await loginToken.update({ status: 'used' });
        
        return {
          status: 'verified',
          sessionToken: loginToken.sessionToken,
          user: {
            telegramId: loginToken.telegramId,
            username: loginToken.username,
            firstName: loginToken.firstName
          }
        };
      }

      if (loginToken.expiresAt < new Date()) {
        if (loginToken.status === 'pending') {
          await loginToken.update({ status: 'expired' });
        }
        return { status: 'expired' };
      }

      return { status: loginToken.status };
    } catch (error) {
      console.error('Error checking token status:', error);
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Validate session token for API requests
   */
  static async validateSession(sessionToken) {
    try {
      const loginToken = await AdminLoginToken.findOne({
        where: {
          sessionToken,
          status: 'used',
          verifiedAt: { 
            [Op.gt]: new Date(Date.now() - this.SESSION_EXPIRY_MS) 
          }
        }
      });

      if (!loginToken) {
        return { valid: false };
      }

      return {
        valid: true,
        adminId: String(loginToken.telegramId),
        adminName: loginToken.username || loginToken.firstName || String(loginToken.telegramId)
      };
    } catch (error) {
      console.error('Error validating session:', error);
      return { valid: false };
    }
  }

  /**
   * Invalidate session (logout)
   */
  static async invalidateSession(sessionToken) {
    try {
      const loginToken = await AdminLoginToken.findOne({
        where: { sessionToken }
      });

      if (loginToken) {
        await AuditService.logAuth(String(loginToken.telegramId), 'logout', {
          adminName: loginToken.username || loginToken.firstName
        });
        
        await loginToken.update({ 
          sessionToken: null, 
          status: 'expired' 
        });
      }

      return { success: true };
    } catch (error) {
      console.error('Error invalidating session:', error);
      return { success: false };
    }
  }

  /**
   * Cleanup expired tokens (run periodically)
   */
  static async cleanupExpiredTokens() {
    try {
      const deleted = await AdminLoginToken.destroy({
        where: {
          [Op.or]: [
            { 
              status: 'pending', 
              expiresAt: { [Op.lt]: new Date() } 
            },
            {
              status: 'expired',
              createdAt: { [Op.lt]: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            }
          ]
        }
      });

      if (deleted > 0) {
        console.log(`🧹 Cleaned up ${deleted} expired login tokens`);
      }

      return deleted;
    } catch (error) {
      console.error('Error cleaning up tokens:', error);
      return 0;
    }
  }

  /**
   * Generate deep link for Telegram bot verification
   */
  static generateDeepLink(botUsername, token) {
    return `https://t.me/${botUsername}?start=verify_${token}`;
  }

  /**
   * Parse verification token from /start command
   */
  static parseStartToken(startParam) {
    if (!startParam || !startParam.startsWith('verify_')) {
      return null;
    }
    return startParam.replace('verify_', '');
  }
}

// Cleanup expired tokens every hour
setInterval(() => {
  TelegramLoginService.cleanupExpiredTokens().catch(console.error);
}, 60 * 60 * 1000);

module.exports = TelegramLoginService;
