/**
 * Admin Audit Service
 * Logs all admin actions for accountability and compliance
 */

const AdminAuditLog = require('../models/adminAuditLogModel');
const { Op } = require('sequelize');

class AuditService {
  /**
   * Log an admin action
   */
  static async log(params) {
    const {
      adminId,
      adminName = null,
      category,
      action,
      targetType = null,
      targetId = null,
      previousValue = null,
      newValue = null,
      details = null,
      ipAddress = null,
      userAgent = null,
      success = true,
      errorMessage = null
    } = params;

    try {
      return await AdminAuditLog.create({
        adminId: String(adminId),
        adminName,
        category,
        action,
        targetType,
        targetId: targetId ? String(targetId) : null,
        previousValue: previousValue ? String(previousValue) : null,
        newValue: newValue !== undefined ? String(newValue) : null,
        details,
        ipAddress,
        userAgent,
        success,
        errorMessage
      });
    } catch (error) {
      console.error('Failed to log audit entry:', error);
      // Don't throw - audit logging should not break main functionality
      return null;
    }
  }

  /**
   * Log authentication events
   */
  static async logAuth(adminId, action, details = {}, req = null) {
    return this.log({
      adminId,
      adminName: details.adminName,
      category: 'auth',
      action,
      details,
      ipAddress: req ? this._getIpAddress(req) : null,
      userAgent: req ? req.headers['user-agent'] : null
    });
  }

  /**
   * Log user management actions
   */
  static async logUserAction(adminId, action, userId, details = {}, req = null) {
    return this.log({
      adminId,
      adminName: details.adminName,
      category: 'user',
      action,
      targetType: 'user',
      targetId: userId,
      details,
      ipAddress: req ? this._getIpAddress(req) : null,
      userAgent: req ? req.headers['user-agent'] : null
    });
  }

  /**
   * Log configuration changes
   */
  static async logConfigChange(adminId, configKey, previousValue, newValue, req = null) {
    return this.log({
      adminId,
      category: 'config',
      action: 'update',
      targetType: 'config',
      targetId: configKey,
      previousValue,
      newValue,
      ipAddress: req ? this._getIpAddress(req) : null,
      userAgent: req ? req.headers['user-agent'] : null
    });
  }

  /**
   * Log broadcast messages
   */
  static async logBroadcast(adminId, audience, messagePreview, details = {}, req = null) {
    return this.log({
      adminId,
      category: 'broadcast',
      action: 'send',
      details: {
        audience,
        messagePreview: messagePreview.substring(0, 200),
        ...details
      },
      ipAddress: req ? this._getIpAddress(req) : null,
      userAgent: req ? req.headers['user-agent'] : null
    });
  }

  /**
   * Log bot management actions
   */
  static async logBotAction(adminId, action, botId, details = {}, req = null) {
    return this.log({
      adminId,
      category: 'bot',
      action,
      targetType: 'bot',
      targetId: botId,
      details,
      ipAddress: req ? this._getIpAddress(req) : null,
      userAgent: req ? req.headers['user-agent'] : null
    });
  }

  /**
   * Log data exports
   */
  static async logExport(adminId, tableName, format, recordCount, req = null) {
    return this.log({
      adminId,
      category: 'export',
      action: 'download',
      targetType: 'table',
      targetId: tableName,
      details: { format, recordCount },
      ipAddress: req ? this._getIpAddress(req) : null,
      userAgent: req ? req.headers['user-agent'] : null
    });
  }

  /**
   * Log maintenance mode changes
   */
  static async logMaintenance(adminId, action, details = {}, req = null) {
    return this.log({
      adminId,
      category: 'maintenance',
      action,
      details,
      ipAddress: req ? this._getIpAddress(req) : null,
      userAgent: req ? req.headers['user-agent'] : null
    });
  }

  /**
   * Log report reviews
   */
  static async logReportReview(adminId, reportId, actionTaken, req = null) {
    return this.log({
      adminId,
      category: 'report',
      action: 'review',
      targetType: 'report',
      targetId: reportId,
      details: { actionTaken },
      ipAddress: req ? this._getIpAddress(req) : null,
      userAgent: req ? req.headers['user-agent'] : null
    });
  }

  /**
   * Get audit logs with filters
   */
  static async getLogs(filters = {}, limit = 100, offset = 0) {
    const where = {};

    if (filters.adminId) {
      where.adminId = filters.adminId;
    }

    if (filters.category) {
      where.category = filters.category;
    }

    if (filters.action) {
      where.action = filters.action;
    }

    if (filters.targetType) {
      where.targetType = filters.targetType;
    }

    if (filters.targetId) {
      where.targetId = filters.targetId;
    }

    if (filters.startDate && filters.endDate) {
      where.createdAt = {
        [Op.between]: [new Date(filters.startDate), new Date(filters.endDate)]
      };
    } else if (filters.startDate) {
      where.createdAt = { [Op.gte]: new Date(filters.startDate) };
    } else if (filters.endDate) {
      where.createdAt = { [Op.lte]: new Date(filters.endDate) };
    }

    try {
      return await AdminAuditLog.findAndCountAll({
        where,
        order: [['createdAt', 'DESC']],
        limit,
        offset
      });
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      return { count: 0, rows: [] };
    }
  }

  /**
   * Get logs for a specific admin
   */
  static async getAdminLogs(adminId, limit = 50) {
    return this.getLogs({ adminId }, limit, 0);
  }

  /**
   * Get logs for a specific user (as target)
   */
  static async getUserLogs(userId, limit = 50) {
    return this.getLogs({ targetType: 'user', targetId: userId }, limit, 0);
  }

  /**
   * Get recent activity summary
   */
  static async getRecentSummary(hours = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    try {
      const logs = await AdminAuditLog.findAll({
        where: { createdAt: { [Op.gte]: since } },
        attributes: ['category', 'action'],
        raw: true
      });

      const summary = {};
      logs.forEach(log => {
        const key = `${log.category}:${log.action}`;
        summary[key] = (summary[key] || 0) + 1;
      });

      return summary;
    } catch (error) {
      console.error('Error getting audit summary:', error);
      return {};
    }
  }

  /**
   * Extract IP address from request
   */
  static _getIpAddress(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           req.ip ||
           null;
  }
}

module.exports = AuditService;
