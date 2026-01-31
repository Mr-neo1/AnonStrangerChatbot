/**
 * Centralized State Manager
 * Replaces global variables with proper state management
 * Provides memory-safe storage with automatic cleanup
 */

class StateManager {
  constructor() {
    // Search state (replacing global.searchIntervals and global.searchMessages)
    this.searchIntervals = new Map();
    this.searchMessages = new Map();
    
    // Conversation state (replacing global.userConversations)
    this.conversations = new Map();
    
    // Session tracking
    this.activeSessions = new Map();
    
    // Rating pending (users who need to rate after chat)
    this.pendingRatings = new Map();
    
    // Cleanup configuration
    this.cleanupConfig = {
      searchTimeout: 5 * 60 * 1000,      // 5 minutes
      conversationTimeout: 30 * 60 * 1000, // 30 minutes
      sessionTimeout: 60 * 60 * 1000,      // 1 hour
      ratingTimeout: 10 * 60 * 1000,       // 10 minutes
      cleanupInterval: 60 * 1000           // Run cleanup every minute
    };
    
    // Start cleanup interval
    this._startCleanup();
  }

  // ==================== SEARCH STATE ====================
  
  setSearchInterval(userId, intervalId) {
    this.clearSearchInterval(userId); // Clear existing first
    this.searchIntervals.set(String(userId), {
      intervalId,
      startTime: Date.now()
    });
  }

  getSearchInterval(userId) {
    const data = this.searchIntervals.get(String(userId));
    return data ? data.intervalId : null;
  }

  clearSearchInterval(userId) {
    const uid = String(userId);
    const data = this.searchIntervals.get(uid);
    if (data && data.intervalId) {
      clearInterval(data.intervalId);
    }
    this.searchIntervals.delete(uid);
    this.searchMessages.delete(uid);
    this.searchMessages.delete(`${uid}_msgId`);
  }

  setSearchMessage(userId, messageId) {
    this.searchMessages.set(`${String(userId)}_msgId`, messageId);
  }

  getSearchMessageId(userId) {
    return this.searchMessages.get(`${String(userId)}_msgId`);
  }

  isUserSearching(userId) {
    return this.searchIntervals.has(String(userId));
  }

  // ==================== CONVERSATION STATE ====================
  
  setConversationState(userId, state) {
    this.conversations.set(String(userId), {
      state,
      timestamp: Date.now()
    });
  }

  getConversationState(userId) {
    const data = this.conversations.get(String(userId));
    return data ? data.state : null;
  }

  clearConversationState(userId) {
    this.conversations.delete(String(userId));
  }

  hasConversationState(userId) {
    return this.conversations.has(String(userId));
  }

  // ==================== SESSION TRACKING ====================
  
  startSession(userId, data = {}) {
    this.activeSessions.set(String(userId), {
      ...data,
      startTime: Date.now(),
      lastActivity: Date.now()
    });
  }

  updateSessionActivity(userId) {
    const session = this.activeSessions.get(String(userId));
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  getSession(userId) {
    return this.activeSessions.get(String(userId));
  }

  endSession(userId) {
    this.activeSessions.delete(String(userId));
  }

  getActiveSessions() {
    return Array.from(this.activeSessions.entries()).map(([id, data]) => ({
      userId: id,
      ...data
    }));
  }

  // ==================== RATING SYSTEM ====================
  
  setPendingRating(userId, partnerData) {
    this.pendingRatings.set(String(userId), {
      partnerId: partnerData.partnerId,
      chatDuration: partnerData.chatDuration || 0,
      messageCount: partnerData.messageCount || 0,
      endedBy: partnerData.endedBy || 'unknown',
      timestamp: Date.now()
    });
  }

  getPendingRating(userId) {
    return this.pendingRatings.get(String(userId));
  }

  clearPendingRating(userId) {
    this.pendingRatings.delete(String(userId));
  }

  hasPendingRating(userId) {
    return this.pendingRatings.has(String(userId));
  }

  // ==================== CLEANUP ====================
  
  _startCleanup() {
    this._cleanupTimer = setInterval(() => {
      this._performCleanup();
    }, this.cleanupConfig.cleanupInterval);
    
    // Allow process to exit even if timer is running
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  _performCleanup() {
    const now = Date.now();
    let cleanedSearch = 0;
    let cleanedConversation = 0;
    let cleanedSession = 0;
    let cleanedRating = 0;

    // Cleanup stale search intervals
    for (const [userId, data] of this.searchIntervals.entries()) {
      if (now - data.startTime > this.cleanupConfig.searchTimeout) {
        this.clearSearchInterval(userId);
        cleanedSearch++;
      }
    }

    // Cleanup stale conversations
    for (const [userId, data] of this.conversations.entries()) {
      if (now - data.timestamp > this.cleanupConfig.conversationTimeout) {
        this.conversations.delete(userId);
        cleanedConversation++;
      }
    }

    // Cleanup stale sessions
    for (const [userId, data] of this.activeSessions.entries()) {
      if (now - data.lastActivity > this.cleanupConfig.sessionTimeout) {
        this.activeSessions.delete(userId);
        cleanedSession++;
      }
    }

    // Cleanup expired pending ratings
    for (const [userId, data] of this.pendingRatings.entries()) {
      if (now - data.timestamp > this.cleanupConfig.ratingTimeout) {
        this.pendingRatings.delete(userId);
        cleanedRating++;
      }
    }

    // Log cleanup stats (only if something was cleaned)
    if (cleanedSearch + cleanedConversation + cleanedSession + cleanedRating > 0) {
      console.log(`🧹 State cleanup: search=${cleanedSearch}, conv=${cleanedConversation}, session=${cleanedSession}, rating=${cleanedRating}`);
    }
  }

  // Get memory usage stats
  getStats() {
    return {
      searchIntervals: this.searchIntervals.size,
      searchMessages: this.searchMessages.size,
      conversations: this.conversations.size,
      activeSessions: this.activeSessions.size,
      pendingRatings: this.pendingRatings.size
    };
  }

  // Graceful shutdown
  shutdown() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
    }
    
    // Clear all intervals
    for (const [userId] of this.searchIntervals.entries()) {
      this.clearSearchInterval(userId);
    }
    
    // Clear all maps
    this.searchIntervals.clear();
    this.searchMessages.clear();
    this.conversations.clear();
    this.activeSessions.clear();
    this.pendingRatings.clear();
  }
}

// Singleton instance
const stateManager = new StateManager();

// Handle process shutdown
process.on('SIGINT', () => stateManager.shutdown());
process.on('SIGTERM', () => stateManager.shutdown());

module.exports = stateManager;
