/**
 * WebSocket Service for Real-time Admin Dashboard Updates
 */

const { Server } = require('socket.io');
const { redisClient } = require('../database/redisClient');
const { scanKeys } = require('../utils/redisScanHelper');
const TelegramLoginService = require('./telegramLoginService');
const User = require('../models/userModel');
const VipSubscription = require('../models/vipSubscriptionModel');
const { Op } = require('sequelize');

class WebSocketService {
  constructor() {
    this.io = null;
    this.updateInterval = null;
    this.connectedClients = new Set();
  }

  /**
   * Initialize WebSocket server
   */
  initialize(httpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      },
      path: '/ws'
    });

    // Authentication middleware
    this.io.use(async (socket, next) => {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication required'));
      }

      // Validate session token
      const session = await TelegramLoginService.validateSession(token);
      
      if (!session.valid) {
        return next(new Error('Invalid session'));
      }

      socket.adminId = session.adminId;
      socket.adminName = session.adminName;
      next();
    });

    // Connection handler
    this.io.on('connection', (socket) => {
      console.log(`📡 Admin connected: ${socket.adminName}`);
      this.connectedClients.add(socket.id);

      // Send initial stats
      this._sendStatsToClient(socket);

      // Handle manual refresh request
      socket.on('requestStats', () => {
        this._sendStatsToClient(socket);
      });

      // Handle subscription to specific updates
      socket.on('subscribe', (channel) => {
        socket.join(channel);
      });

      socket.on('unsubscribe', (channel) => {
        socket.leave(channel);
      });

      // Disconnect handler
      socket.on('disconnect', () => {
        console.log(`📡 Admin disconnected: ${socket.adminName}`);
        this.connectedClients.delete(socket.id);
      });
    });

    // Start periodic updates
    this._startPeriodicUpdates();

    console.log('✅ WebSocket service initialized');
  }

  /**
   * Start periodic stats updates
   */
  _startPeriodicUpdates() {
    // Update every 5 seconds
    this.updateInterval = setInterval(async () => {
      if (this.connectedClients.size > 0) {
        await this._broadcastStats();
      }
    }, 5000);

    // Allow process to exit
    if (this.updateInterval.unref) {
      this.updateInterval.unref();
    }
  }

  /**
   * Send stats to a specific client
   */
  async _sendStatsToClient(socket) {
    try {
      const stats = await this._gatherStats();
      socket.emit('stats', stats);
    } catch (error) {
      console.error('Error sending stats:', error);
    }
  }

  /**
   * Broadcast stats to all connected clients
   */
  async _broadcastStats() {
    try {
      const stats = await this._gatherStats();
      this.io.emit('stats', stats);
    } catch (error) {
      console.error('Error broadcasting stats:', error);
    }
  }

  /**
   * Gather current statistics
   */
  async _gatherStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      const [totalUsers, vipActive, todayUsers, bannedUsers] = await Promise.all([
        User.count(),
        VipSubscription.count({ where: { expiresAt: { [Op.gt]: new Date() } } }),
        User.count({ where: { createdAt: { [Op.gte]: today } } }),
        User.count({ where: { banned: true } })
      ]);

      // Get active chats from Redis
      let activeChats = 0;
      let activeUserIds = [];
      try {
        const keys = await scanKeys('pair:*');
        activeChats = Math.floor((keys?.length || 0) / 2);
        activeUserIds = keys.map(k => k.replace('pair:', ''));
      } catch (e) {}

      // Get queue sizes
      let queueSize = 0;
      let queueUsers = [];
      try {
        const queuePatterns = ['queue:vip', 'queue:free', 'queue:general', 'queue:vip:any'];
        for (const pattern of queuePatterns) {
          const len = await redisClient.lLen(pattern).catch(() => 0);
          queueSize += len || 0;
          if (len > 0) {
            const users = await redisClient.lRange(pattern, 0, -1).catch(() => []);
            queueUsers.push(...(users || []));
          }
        }
      } catch (e) {}

      // Calculate online users
      const onlineUsers = new Set([...activeUserIds, ...queueUsers]).size;

      return {
        totalUsers,
        vipActive,
        todayUsers,
        bannedUsers,
        activeChats,
        queueSize,
        onlineUsers,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error gathering stats:', error);
      return {
        totalUsers: 0,
        vipActive: 0,
        todayUsers: 0,
        bannedUsers: 0,
        activeChats: 0,
        queueSize: 0,
        onlineUsers: 0,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Broadcast a specific event
   */
  broadcast(event, data) {
    if (this.io) {
      this.io.emit(event, { ...data, timestamp: Date.now() });
    }
  }

  /**
   * Broadcast to specific channel
   */
  broadcastToChannel(channel, event, data) {
    if (this.io) {
      this.io.to(channel).emit(event, { ...data, timestamp: Date.now() });
    }
  }

  /**
   * Send notification to all admins
   */
  notifyAdmins(type, message, data = {}) {
    this.broadcast('notification', {
      type, // 'info', 'warning', 'error', 'success'
      message,
      ...data
    });
  }

  /**
   * Notify about new user
   */
  notifyNewUser(user) {
    this.broadcast('newUser', {
      userId: user.userId,
      gender: user.gender,
      botId: user.botId
    });
  }

  /**
   * Notify about new report
   */
  notifyNewReport(report) {
    this.broadcast('newReport', {
      reportId: report.id,
      reportReason: report.reportReason,
      ratedUserId: report.ratedUserId
    });
  }

  /**
   * Notify about new VIP subscription
   */
  notifyNewVip(userId, planName) {
    this.broadcast('newVip', {
      userId,
      planName
    });
  }

  /**
   * Get connected client count
   */
  getConnectedCount() {
    return this.connectedClients.size;
  }

  /**
   * Shutdown service
   */
  shutdown() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    if (this.io) {
      this.io.close();
    }
  }
}

// Singleton instance
const webSocketService = new WebSocketService();

module.exports = webSocketService;
