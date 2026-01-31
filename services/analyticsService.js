/**
 * Analytics Service
 * Handles statistics aggregation and chart data generation
 */

const AnalyticsStats = require('../models/analyticsStatsModel');
const User = require('../models/userModel');
const VipSubscription = require('../models/vipSubscriptionModel');
const StarTransaction = require('../models/starTransactionModel');
const ChatRating = require('../models/chatRatingModel');
const { Op } = require('sequelize');
const { sequelize } = require('../database/connectionPool');

class AnalyticsService {
  /**
   * Get or create stats for a specific date
   */
  static async getOrCreateStats(date) {
    const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
    
    let stats = await AnalyticsStats.findOne({ where: { date: dateStr } });
    if (!stats) {
      stats = await AnalyticsStats.create({ date: dateStr });
    }
    return stats;
  }

  /**
   * Update daily statistics (call periodically or at end of day)
   */
  static async updateDailyStats(date = new Date()) {
    const dateStr = date.toISOString().split('T')[0];
    const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
    const endOfDay = new Date(dateStr + 'T23:59:59.999Z');

    try {
      // Gather all statistics
      const [
        newUsers,
        totalUsers,
        activeVipUsers,
        newVipSubscriptions,
        vipRevenue,
        lockRevenue
      ] = await Promise.all([
        // New users today
        User.count({
          where: { createdAt: { [Op.between]: [startOfDay, endOfDay] } }
        }),
        
        // Total users
        User.count(),
        
        // Active VIP users
        VipSubscription.count({
          where: { expiresAt: { [Op.gt]: new Date() } }
        }),
        
        // New VIP subscriptions today
        VipSubscription.count({
          where: { createdAt: { [Op.between]: [startOfDay, endOfDay] } }
        }),
        
        // VIP revenue today (Stars)
        StarTransaction.sum('amount', {
          where: {
            type: 'vip',
            createdAt: { [Op.between]: [startOfDay, endOfDay] }
          }
        }).then(sum => sum || 0),
        
        // Lock revenue today (Stars)
        StarTransaction.sum('amount', {
          where: {
            type: 'lock',
            createdAt: { [Op.between]: [startOfDay, endOfDay] }
          }
        }).then(sum => sum || 0)
      ]);

      // Get rating stats
      const ChatRatingService = require('./chatRatingService');
      const ratingStats = await ChatRatingService.getRatingStatsForDate(date);

      // Get ban stats
      const [newBans, unbans] = await Promise.all([
        User.count({
          where: {
            banned: true,
            updatedAt: { [Op.between]: [startOfDay, endOfDay] }
          }
        }),
        // This is approximate - would need audit log for accurate unbans
        0
      ]);

      // Update or create stats record
      const [stats, created] = await AnalyticsStats.upsert({
        date: dateStr,
        newUsers,
        totalUsers,
        activeVipUsers,
        newVipSubscriptions,
        vipRevenue: vipRevenue || 0,
        lockRevenue: lockRevenue || 0,
        positiveRatings: ratingStats.positiveRatings,
        negativeRatings: ratingStats.negativeRatings,
        totalReports: ratingStats.totalReports,
        newBans
      }, {
        returning: true
      });

      return stats;
    } catch (error) {
      console.error('Error updating daily stats:', error);
      throw error;
    }
  }

  /**
   * Get analytics data for date range (for charts)
   */
  static async getChartData(startDate, endDate, metrics = ['newUsers', 'activeUsers', 'totalChats', 'vipRevenue', 'lockRevenue', 'positiveRatings', 'negativeRatings']) {
    try {
      const stats = await AnalyticsStats.findAll({
        where: {
          date: { [Op.between]: [startDate, endDate] }
        },
        order: [['date', 'ASC']]
      });

      // Build chart data structure
      const chartData = {
        labels: [],
        datasets: {}
      };

      // Initialize datasets for each metric
      metrics.forEach(metric => {
        chartData.datasets[metric] = [];
      });

      // Fill in data
      stats.forEach(stat => {
        chartData.labels.push(stat.date);
        metrics.forEach(metric => {
          chartData.datasets[metric].push(stat[metric] || 0);
        });
      });

      // Fill gaps with zeros for missing dates
      const filledData = this._fillDateGaps(chartData, startDate, endDate, metrics);

      return filledData;
    } catch (error) {
      console.error('Error getting chart data:', error);
      return { labels: [], datasets: {} };
    }
  }

  /**
   * Fill gaps in date range with zeros
   */
  static _fillDateGaps(data, startDate, endDate, metrics) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const result = { labels: [], datasets: {} };
    
    metrics.forEach(metric => {
      result.datasets[metric] = [];
    });

    const existingData = new Map();
    data.labels.forEach((date, index) => {
      const values = {};
      metrics.forEach(metric => {
        values[metric] = data.datasets[metric][index];
      });
      existingData.set(date, values);
    });

    // Iterate through each day
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      result.labels.push(dateStr);
      
      const existing = existingData.get(dateStr);
      metrics.forEach(metric => {
        result.datasets[metric].push(existing ? existing[metric] : 0);
      });
    }

    return result;
  }

  /**
   * Get quick stats for dashboard
   */
  static async getDashboardStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    try {
      const [
        totalUsers,
        todayUsers,
        yesterdayUsers,
        activeVip,
        totalRevenue
      ] = await Promise.all([
        User.count(),
        User.count({ where: { createdAt: { [Op.gte]: today } } }),
        User.count({ 
          where: { 
            createdAt: { 
              [Op.gte]: yesterday, 
              [Op.lt]: today 
            } 
          } 
        }),
        VipSubscription.count({ where: { expiresAt: { [Op.gt]: new Date() } } }),
        StarTransaction.sum('amount').then(sum => sum || 0)
      ]);

      // Calculate growth percentage
      const growth = yesterdayUsers > 0 
        ? Math.round(((todayUsers - yesterdayUsers) / yesterdayUsers) * 100) 
        : (todayUsers > 0 ? 100 : 0);

      return {
        totalUsers,
        todayUsers,
        growth,
        activeVip,
        totalRevenue
      };
    } catch (error) {
      console.error('Error getting dashboard stats:', error);
      return {
        totalUsers: 0,
        todayUsers: 0,
        growth: 0,
        activeVip: 0,
        totalRevenue: 0
      };
    }
  }

  /**
   * Get VIP plan popularity stats
   */
  static async getVipPlanStats() {
    try {
      // This would need a planId field in VipSubscription or StarTransaction
      // For now, return mock data structure
      const transactions = await StarTransaction.findAll({
        where: { type: 'vip' },
        attributes: [
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          'details'
        ],
        group: ['details'],
        raw: true
      });

      return transactions.map(t => ({
        planId: t.details ? JSON.parse(t.details).planId : 'unknown',
        count: parseInt(t.count)
      }));
    } catch (error) {
      console.error('Error getting VIP plan stats:', error);
      return [];
    }
  }

  /**
   * Record a chat for analytics
   */
  static async recordChat(chatId, duration = 0, messageCount = 0) {
    try {
      const today = new Date().toISOString().split('T')[0];
      await AnalyticsStats.increment(
        { 
          totalChats: 1,
          totalMessages: messageCount
        },
        { where: { date: today } }
      );

      // Update average duration
      const stats = await this.getOrCreateStats(today);
      const currentAvg = stats.averageChatDuration || 0;
      const currentTotal = stats.totalChats || 1;
      const newAvg = ((currentAvg * (currentTotal - 1)) + duration) / currentTotal;
      
      await stats.update({ averageChatDuration: newAvg });
    } catch (error) {
      console.error('Error recording chat:', error);
    }
  }

  /**
   * Update peak concurrent users
   */
  static async updatePeakConcurrent(count) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const stats = await this.getOrCreateStats(today);
      
      if (count > (stats.peakConcurrentUsers || 0)) {
        await stats.update({ peakConcurrentUsers: count });
      }
    } catch (error) {
      console.error('Error updating peak concurrent:', error);
    }
  }
}

module.exports = AnalyticsService;
