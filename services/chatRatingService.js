/**
 * Chat Rating Service
 * Handles user feedback and reporting after chat sessions
 */

const ChatRating = require('../models/chatRatingModel');
const User = require('../models/userModel');
const stateManager = require('../utils/stateManager');
const { Op } = require('sequelize');

class ChatRatingService {
  /**
   * Get the rating keyboard for post-chat feedback
   * @returns {Object} Telegram inline keyboard markup
   */
  static getRatingKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: '👍 Good Chat', callback_data: 'rate_positive' },
          { text: '👎 Bad Chat', callback_data: 'rate_negative' }
        ],
        [
          { text: '⚠️ Report User', callback_data: 'rate_report' },
          { text: '⏭️ Skip', callback_data: 'rate_skip' }
        ]
      ]
    };
  }

  /**
   * Get the report reason keyboard
   * @returns {Object} Telegram inline keyboard markup
   */
  static getReportReasonsKeyboard() {
    return {
      inline_keyboard: [
        [{ text: '🔞 Inappropriate Content', callback_data: 'report_inappropriate' }],
        [{ text: '😡 Harassment/Bullying', callback_data: 'report_harassment' }],
        [{ text: '📧 Spam/Advertising', callback_data: 'report_spam' }],
        [{ text: '🤖 Bot/Fake Account', callback_data: 'report_bot' }],
        [{ text: '⬅️ Go Back', callback_data: 'report_cancel' }]
      ]
    };
  }

  /**
   * Create a pending rating request after chat ends
   */
  static setPendingRating(userId, partnerData) {
    stateManager.setPendingRating(userId, partnerData);
  }

  /**
   * Check if user has pending rating
   */
  static hasPendingRating(userId) {
    return stateManager.hasPendingRating(userId);
  }

  /**
   * Get pending rating data
   */
  static getPendingRating(userId) {
    return stateManager.getPendingRating(userId);
  }

  /**
   * Submit a rating
   */
  static async submitRating(raterId, ratingType, reportReason = 'none', reportDetails = null, botId = null) {
    const pendingData = stateManager.getPendingRating(raterId);
    
    if (!pendingData) {
      return { success: false, error: 'No pending rating found' };
    }

    try {
      const rating = await ChatRating.create({
        raterId,
        ratedUserId: pendingData.partnerId,
        ratingType,
        reportReason,
        reportDetails,
        chatDuration: pendingData.chatDuration,
        messageCount: pendingData.messageCount,
        endedBy: pendingData.endedBy,
        botId
      });

      // Clear pending rating
      stateManager.clearPendingRating(raterId);

      // If it's a report, check if user should be auto-banned
      if (reportReason !== 'none' && reportReason !== 'skipped') {
        await this._checkAutoModeration(pendingData.partnerId, reportReason);
      }

      return { success: true, rating };
    } catch (error) {
      console.error('Error submitting rating:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Skip rating (user chose not to rate)
   */
  static async skipRating(raterId, botId = null) {
    return this.submitRating(raterId, 'skipped', 'none', null, botId);
  }

  /**
   * Submit positive rating (thumbs up)
   */
  static async submitPositiveRating(raterId, botId = null) {
    return this.submitRating(raterId, 'positive', 'none', null, botId);
  }

  /**
   * Submit negative rating with report
   */
  static async submitNegativeRating(raterId, reportReason, reportDetails = null, botId = null) {
    return this.submitRating(raterId, 'negative', reportReason, reportDetails, botId);
  }

  /**
   * Check if user should be auto-moderated based on reports
   */
  static async _checkAutoModeration(userId, reportReason) {
    try {
      const recentReports = await ChatRating.count({
        where: {
          ratedUserId: userId,
          reportReason: { [Op.ne]: 'none' },
          createdAt: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
        }
      });

      // Auto-ban threshold: 5 reports in 24 hours
      if (recentReports >= 5) {
        await User.update({ banned: true }, { where: { userId } });
        
        // Log the auto-ban
        const AuditService = require('./auditService');
        await AuditService.log({
          adminId: 'SYSTEM',
          adminName: 'Auto-Moderation',
          category: 'user',
          action: 'auto_ban',
          targetType: 'user',
          targetId: String(userId),
          details: { reason: 'Exceeded report threshold', reportCount: recentReports }
        });

        return true;
      }
    } catch (error) {
      console.error('Auto-moderation check error:', error);
    }
    return false;
  }

  /**
   * Get user's rating stats
   */
  static async getUserRatingStats(userId) {
    try {
      const [positive, negative, totalReceived] = await Promise.all([
        ChatRating.count({ where: { ratedUserId: userId, ratingType: 'positive' } }),
        ChatRating.count({ where: { ratedUserId: userId, ratingType: 'negative' } }),
        ChatRating.count({ where: { ratedUserId: userId, ratingType: { [Op.ne]: 'skipped' } } })
      ]);

      const score = totalReceived > 0 ? Math.round((positive / totalReceived) * 100) : 100;

      return {
        positive,
        negative,
        total: totalReceived,
        score // Percentage of positive ratings
      };
    } catch (error) {
      console.error('Error getting rating stats:', error);
      return { positive: 0, negative: 0, total: 0, score: 100 };
    }
  }

  /**
   * Get unreviewed reports for admin
   */
  static async getUnreviewedReports(limit = 50, offset = 0) {
    try {
      return await ChatRating.findAndCountAll({
        where: {
          reportReason: { [Op.ne]: 'none' },
          reviewed: false
        },
        order: [['createdAt', 'DESC']],
        limit,
        offset
      });
    } catch (error) {
      console.error('Error getting unreviewed reports:', error);
      return { count: 0, rows: [] };
    }
  }

  /**
   * Mark report as reviewed
   */
  static async markReviewed(ratingId, adminId, actionTaken = null) {
    try {
      await ChatRating.update({
        reviewed: true,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        actionTaken
      }, {
        where: { id: ratingId }
      });
      return { success: true };
    } catch (error) {
      console.error('Error marking report reviewed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get rating statistics for analytics
   */
  static async getRatingStatsForDate(date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    try {
      const [positive, negative, reports] = await Promise.all([
        ChatRating.count({
          where: {
            ratingType: 'positive',
            createdAt: { [Op.between]: [startOfDay, endOfDay] }
          }
        }),
        ChatRating.count({
          where: {
            ratingType: 'negative',
            createdAt: { [Op.between]: [startOfDay, endOfDay] }
          }
        }),
        ChatRating.count({
          where: {
            reportReason: { [Op.ne]: 'none' },
            createdAt: { [Op.between]: [startOfDay, endOfDay] }
          }
        })
      ]);

      return { positiveRatings: positive, negativeRatings: negative, totalReports: reports };
    } catch (error) {
      console.error('Error getting rating stats for date:', error);
      return { positiveRatings: 0, negativeRatings: 0, totalReports: 0 };
    }
  }

  /**
   * Get report keyboard for bot
   */
  static getReportKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: '👍', callback_data: 'RATE:positive' },
          { text: '👎', callback_data: 'RATE:negative' }
        ],
        [
          { text: '📵 VCS Spam', callback_data: 'REPORT:vcs_spam' }
        ],
        [
          { text: '❌ Vulgar partner', callback_data: 'REPORT:vulgar' }
        ],
        [
          { text: '⚠️ Report →', callback_data: 'REPORT:menu' }
        ]
      ]
    };
  }

  /**
   * Get detailed report menu keyboard
   */
  static getDetailedReportKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: '📵 VCS Spam', callback_data: 'REPORT:vcs_spam' }
        ],
        [
          { text: '❌ Vulgar/Inappropriate', callback_data: 'REPORT:vulgar' }
        ],
        [
          { text: '🚫 Harassment', callback_data: 'REPORT:harassment' }
        ],
        [
          { text: '⚠️ Underage', callback_data: 'REPORT:underage' }
        ],
        [
          { text: '📝 Other (describe)', callback_data: 'REPORT:other' }
        ],
        [
          { text: '🔙 Back', callback_data: 'REPORT:back' }
        ]
      ]
    };
  }
}

module.exports = ChatRatingService;
