/**
 * Data Export Service
 * Exports database tables to CSV, JSON, and Excel formats
 * With pagination support for large datasets
 */

const { sequelize } = require('../database/connectionPool');
const User = require('../models/userModel');
const VipSubscription = require('../models/vipSubscriptionModel');
const StarTransaction = require('../models/starTransactionModel');
const ChatRating = require('../models/chatRatingModel');
const AdminAuditLog = require('../models/adminAuditLogModel');
const AnalyticsStats = require('../models/analyticsStatsModel');
const Referral = require('../models/referralModel');
const { Op } = require('sequelize');

// Default pagination settings
const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGE_SIZE = 10000;

class ExportService {
  // Available tables for export
  static TABLES = {
    users: { model: User, name: 'Users' },
    vip_subscriptions: { model: VipSubscription, name: 'VIP Subscriptions' },
    transactions: { model: StarTransaction, name: 'Star Transactions' },
    chat_ratings: { model: ChatRating, name: 'Chat Ratings' },
    audit_logs: { model: AdminAuditLog, name: 'Admin Audit Logs' },
    analytics: { model: AnalyticsStats, name: 'Analytics Stats' },
    referrals: { model: Referral, name: 'Referrals' }
  };

  /**
   * Get list of available tables for export
   */
  static getAvailableTables() {
    return Object.entries(this.TABLES).map(([key, val]) => ({
      id: key,
      name: val.name
    }));
  }

  /**
   * Export table data with pagination support
   * @param {string} tableName - Table to export
   * @param {string} format - Output format (json, csv, excel)
   * @param {Object} filters - Filter options including pagination
   */
  static async exportTable(tableName, format = 'json', filters = {}) {
    const tableConfig = this.TABLES[tableName];
    if (!tableConfig) {
      throw new Error(`Unknown table: ${tableName}`);
    }

    const { model } = tableConfig;
    const where = this._buildWhereClause(filters);
    
    // Pagination settings
    const page = parseInt(filters.page) || 1;
    const pageSize = Math.min(parseInt(filters.pageSize) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;
    const usePagination = filters.paginated !== false;

    try {
      let queryOptions = {
        where,
        order: [['createdAt', 'DESC']],
        raw: true
      };
      
      // Apply pagination if not explicitly disabled
      if (usePagination) {
        queryOptions.limit = pageSize;
        queryOptions.offset = offset;
      } else if (filters.limit) {
        // Legacy limit support
        queryOptions.limit = parseInt(filters.limit);
      }
      
      // Get total count for pagination info
      const totalCount = await model.count({ where });
      const data = await model.findAll(queryOptions);
      const recordCount = data.length;
      const totalPages = Math.ceil(totalCount / pageSize);

      let result;
      switch (format.toLowerCase()) {
        case 'csv':
          result = this._toCSV(data);
          break;
        case 'json':
          result = this._toJSON(data);
          break;
        case 'excel':
          result = this._toExcel(data, tableConfig.name);
          break;
        default:
          throw new Error(`Unsupported format: ${format}`);
      }
      
      return { 
        ...result, 
        recordCount,
        pagination: usePagination ? {
          page,
          pageSize,
          totalCount,
          totalPages,
          hasMore: page < totalPages
        } : null
      };
    } catch (error) {
      console.error(`Export error for ${tableName}:`, error);
      throw error;
    }
  }

  /**
   * Stream export for large datasets (memory efficient)
   * Returns an async generator
   */
  static async *streamExport(tableName, format = 'json', filters = {}) {
    const tableConfig = this.TABLES[tableName];
    if (!tableConfig) {
      throw new Error(`Unknown table: ${tableName}`);
    }

    const { model } = tableConfig;
    const where = this._buildWhereClause(filters);
    const batchSize = 500;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const batch = await model.findAll({
        where,
        order: [['createdAt', 'DESC']],
        limit: batchSize,
        offset,
        raw: true
      });

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      yield batch;
      offset += batchSize;
      hasMore = batch.length === batchSize;
    }
  }

  /**
   * Build WHERE clause from filters
   */
  static _buildWhereClause(filters) {
    const where = {};

    if (filters.startDate && filters.endDate) {
      where.createdAt = {
        [Op.between]: [new Date(filters.startDate), new Date(filters.endDate)]
      };
    } else if (filters.startDate) {
      where.createdAt = { [Op.gte]: new Date(filters.startDate) };
    } else if (filters.endDate) {
      where.createdAt = { [Op.lte]: new Date(filters.endDate) };
    }

    // Add custom filters
    if (filters.userId) {
      where.userId = filters.userId;
    }

    if (filters.banned !== undefined) {
      where.banned = filters.banned;
    }

    return where;
  }

  /**
   * Convert to CSV format
   */
  static _toCSV(data) {
    if (!data || data.length === 0) {
      return { content: '', mimeType: 'text/csv', extension: 'csv' };
    }

    // Get headers from first row
    const headers = Object.keys(data[0]);
    
    // Build CSV rows
    const rows = [headers.join(',')];
    
    data.forEach(row => {
      const values = headers.map(header => {
        let value = row[header];
        
        // Handle null/undefined
        if (value === null || value === undefined) {
          return '';
        }
        
        // Handle dates
        if (value instanceof Date) {
          value = value.toISOString();
        }
        
        // Handle objects
        if (typeof value === 'object') {
          value = JSON.stringify(value);
        }
        
        // Convert to string and escape
        value = String(value);
        
        // Escape quotes and wrap in quotes if contains comma, newline, or quote
        if (value.includes(',') || value.includes('\n') || value.includes('"')) {
          value = `"${value.replace(/"/g, '""')}"`;
        }
        
        return value;
      });
      rows.push(values.join(','));
    });

    return {
      content: rows.join('\n'),
      mimeType: 'text/csv',
      extension: 'csv'
    };
  }

  /**
   * Convert to JSON format
   */
  static _toJSON(data) {
    return {
      content: JSON.stringify(data, null, 2),
      mimeType: 'application/json',
      extension: 'json'
    };
  }

  /**
   * Convert to Excel format (XLSX)
   * Note: For proper Excel support, you'd need the 'xlsx' package
   * This creates a simple HTML table that Excel can open
   */
  static _toExcel(data, sheetName = 'Sheet1') {
    if (!data || data.length === 0) {
      return { 
        content: '<table></table>', 
        mimeType: 'application/vnd.ms-excel', 
        extension: 'xls' 
      };
    }

    const headers = Object.keys(data[0]);
    
    let html = `
      <html xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head>
        <meta charset="UTF-8">
        <style>
          table { border-collapse: collapse; }
          th, td { border: 1px solid #000; padding: 5px; }
          th { background-color: #4472C4; color: white; font-weight: bold; }
        </style>
      </head>
      <body>
        <table>
          <tr>${headers.map(h => `<th>${this._escapeHtml(h)}</th>`).join('')}</tr>
    `;

    data.forEach(row => {
      html += '<tr>';
      headers.forEach(header => {
        let value = row[header];
        if (value === null || value === undefined) value = '';
        if (value instanceof Date) value = value.toISOString();
        if (typeof value === 'object') value = JSON.stringify(value);
        html += `<td>${this._escapeHtml(String(value))}</td>`;
      });
      html += '</tr>';
    });

    html += '</table></body></html>';

    return {
      content: html,
      mimeType: 'application/vnd.ms-excel',
      extension: 'xls'
    };
  }

  /**
   * Escape HTML entities
   */
  static _escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Get record count for a table
   */
  static async getTableCount(tableName) {
    const tableConfig = this.TABLES[tableName];
    if (!tableConfig) {
      return 0;
    }
    
    try {
      return await tableConfig.model.count();
    } catch (error) {
      console.error(`Count error for ${tableName}:`, error);
      return 0;
    }
  }

  /**
   * Get all table counts
   */
  static async getAllTableCounts() {
    const counts = {};
    
    for (const [key, config] of Object.entries(this.TABLES)) {
      try {
        counts[key] = await config.model.count();
      } catch {
        counts[key] = 0;
      }
    }
    
    return counts;
  }

  /**
   * Export multiple tables as a ZIP file
   * Note: Would need 'archiver' package for actual ZIP support
   */
  static async exportAllTables(format = 'json') {
    const exports = {};
    
    for (const tableName of Object.keys(this.TABLES)) {
      try {
        exports[tableName] = await this.exportTable(tableName, format);
      } catch (error) {
        exports[tableName] = { error: error.message };
      }
    }
    
    return exports;
  }
}

module.exports = ExportService;
