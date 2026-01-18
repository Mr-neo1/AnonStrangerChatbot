const { redisClient } = require('../database/redisClient');
const User = require('../models/userModel');
const vipService = require('./vipService');

// Redis keys:
// queue:vip (list), queue:general (list)
// user:recentPartners:{userId} (list)

class MatchingService {
  // Return whether the user is already present in any queue for this bot (optimized - checks all queues)
  static async isUserQueued(botId, userId) {
    const keys = require('../utils/redisKeys');
    botId = botId || 'default';
    const uid = userId.toString();
    
    // Check all possible queue keys
    const allQueueKeys = keys.QUEUE_ALL_KEYS(botId);
    const checks = await Promise.all(
      allQueueKeys.map(key => redisClient.lRange(key, 0, -1).catch(() => []))
    );
    
    // Check if user exists in any queue
    return checks.some(queue => queue && queue.includes(uid));
  }

  // Enqueue user to the appropriate queue (idempotent)
  static async enqueueUser(botId, userId) {
    const keys = require('../utils/redisKeys');
    botId = botId || 'default';

    // Do not enqueue duplicates across all known queues
    const alreadyQueued = await MatchingService.isUserQueued(botId, userId);
    if (alreadyQueued) return;

    // Validate VIP at enqueue/search time only (DB is source of truth)
    const isVipUser = await vipService.isVipActive(userId);
    const uid = userId.toString();

    if (isVipUser) {
      // Determine VIP preference and put into specific queue(s)
      const prefs = await vipService.getVipPreferences(userId) || {};
      const genderPref = (prefs.gender || 'Any');
      const keysToPush = [];

      // Push into both legacy VIP queue (for admin cleanup compatibility) and prioritized queues
      keysToPush.push(keys.QUEUE_VIP_KEY(botId));

      if (genderPref && genderPref !== 'Any') {
        keysToPush.push(keys.QUEUE_VIP_GENDER_KEY(botId, genderPref));
      } else {
        keysToPush.push(keys.QUEUE_VIP_ANY_KEY(botId));
      }

      // push to all determined keys
      for (const k of keysToPush) {
        await redisClient.lPush(k, uid);
      }
    } else {
      // Non-VIP goes into free queue and legacy general queue
      await redisClient.lPush(keys.QUEUE_GENERAL_KEY(botId), uid);
      await redisClient.lPush(keys.QUEUE_FREE_KEY(botId), uid);
    }
  }

  // Try to find a match for userId given optional preferences (OPTIMIZED)
  static async matchNextUser(botId, userId, preferences = {}) {
    botId = botId || 'default';
    const keys = require('../utils/redisKeys');

    const userIdStr = userId.toString();
    
    // Pre-fetch user data and VIP status (cache for this matching session)
    const [currentUser, isVipUser, recentPartners] = await Promise.all([
      User.findOne({ where: { userId } }),
      vipService.isVipActive(userId),
      redisClient.lRange(`user:recentPartners:${userIdStr}`, 0, -1).catch(() => [])
    ]);
    
    if (!currentUser || currentUser.banned) return null;
    
    // Get preferences once
    const prefs = isVipUser && (!preferences || !Object.keys(preferences).length) 
      ? (await vipService.getVipPreferences(userId) || {}) 
      : preferences;

    // Helper: check candidate suitability (OPTIMIZED - uses cached data, batch operations)
    const isCandidateSuitable = async (candidateId, forVipSearch, candidateUser, candidateIsVip, candidatePrefs) => {
      if (!candidateId || candidateId === userIdStr) return false;
      if (!candidateUser || candidateUser.banned) return false;
      
      // Recent partner check (already fetched)
      if (recentPartners && recentPartners.includes(candidateId)) return false;

      // If searching VIP pools, respect searcher's preference
      if (forVipSearch && prefs && prefs.gender && prefs.gender !== 'Any') {
        if (candidateUser.gender !== prefs.gender) return false;
      }

      // If candidate is VIP and has prefs, ensure mutual satisfaction
      if (candidateIsVip && candidatePrefs && candidatePrefs.gender && candidatePrefs.gender !== 'Any') {
        if (!currentUser || currentUser.gender !== candidatePrefs.gender) return false;
      }

      return true;
    };

    // Helper to remove candidate's entries from all queues to avoid duplicates
    const removeFromAllQueues = async (candidateId) => {
      const allKeys = keys.QUEUE_ALL_KEYS(botId);
      for (const k of allKeys) {
        try { await redisClient.lRem(k, 0, candidateId); } catch (e) { }
      }
    };

    // Helper to record match and recent partners (20 minute cooldown)
    const recordMatch = async (cand) => {
      await redisClient.lPush(`user:recentPartners:${userIdStr}`, cand);
      await redisClient.lPush(`user:recentPartners:${cand}`, userIdStr);
      await redisClient.expire(`user:recentPartners:${userIdStr}`, 1200); // 20 minutes
      await redisClient.expire(`user:recentPartners:${cand}`, 1200); // 20 minutes

      // Remove candidate from all queues to avoid duplicates
      await removeFromAllQueues(cand);
    };

    // Batch fetch candidate data to reduce DB queries (OPTIMIZATION)
    const fetchCandidateData = async (candidateIds) => {
      if (!candidateIds || candidateIds.length === 0) return new Map();
      
      const { Op } = require('sequelize');
      const [users, vipStatuses, vipPrefs] = await Promise.all([
        User.findAll({ where: { userId: { [Op.in]: candidateIds } } }),
        Promise.all(candidateIds.map(id => vipService.isVipActive(id))),
        Promise.all(candidateIds.map(id => vipService.getVipPreferences(id).catch(() => ({}))))
      ]);
      
      const dataMap = new Map();
      candidateIds.forEach((id, idx) => {
        const userIdStr = id.toString();
        dataMap.set(id, {
          user: users.find(u => u.userId.toString() === userIdStr),
          isVip: vipStatuses[idx],
          prefs: vipPrefs[idx] || {}
        });
      });
      
      return dataMap;
    };

    // If user is VIP: first try VIP↔VIP (gender-compatible), then VIP↔Free
    if (isVipUser) {
      // 1) VIP↔VIP: Try gender-specific queue first (if preference specified), then any VIP
      const vipQueueCandidates = [];
      if (prefs.gender && prefs.gender !== 'Any') vipQueueCandidates.push(keys.QUEUE_VIP_GENDER_KEY(botId, prefs.gender));
      vipQueueCandidates.push(keys.QUEUE_VIP_ANY_KEY(botId));

      for (const q of vipQueueCandidates) {
        // Peek at first 50 candidates to batch fetch data
        const peeked = await redisClient.lRange(q, 0, 49).catch(() => []);
        if (peeked.length === 0) continue;
        
        const candidateData = await fetchCandidateData(peeked);
        let attempts = 0;
        let candidate = await redisClient.lPop(q);
        
        while (candidate && attempts < Math.min(50, peeked.length)) {
          const data = candidateData.get(candidate);
          if (data && data.isVip && await isCandidateSuitable(candidate, true, data.user, data.isVip, data.prefs)) {
            await recordMatch(candidate);
            return candidate;
          }
          // push back to tail
          await redisClient.lPush(q, candidate);
          attempts++;
          candidate = await redisClient.lPop(q);
        }
      }

      // 2) VIP↔Free: try free queue, ensure candidate is not VIP
      const freeQ = keys.QUEUE_FREE_KEY(botId);
      const peekedFree = await redisClient.lRange(freeQ, 0, 49).catch(() => []);
      if (peekedFree.length > 0) {
        const candidateData = await fetchCandidateData(peekedFree);
        let attempts = 0;
        let candidate = await redisClient.lPop(freeQ);
        
        while (candidate && attempts < Math.min(50, peekedFree.length)) {
          const data = candidateData.get(candidate);
          if (data && !data.isVip && await isCandidateSuitable(candidate, false, data.user, false, {})) {
            await recordMatch(candidate);
            return candidate;
          }
          await redisClient.lPush(freeQ, candidate);
          attempts++;
          candidate = await redisClient.lPop(freeQ);
        }
      }

      // No match found for VIP
      return null;
    }

    // If user is not VIP: only match with Free↔Free
    const freeQueue = keys.QUEUE_FREE_KEY(botId);
    const peeked = await redisClient.lRange(freeQueue, 0, 49).catch(() => []);
    if (peeked.length > 0) {
      const candidateData = await fetchCandidateData(peeked);
      let attempts = 0;
      let candidate = await redisClient.lPop(freeQueue);
      
      while (candidate && attempts < Math.min(50, peeked.length)) {
        const data = candidateData.get(candidate);
        if (data && !data.isVip && await isCandidateSuitable(candidate, false, data.user, false, {})) {
          await recordMatch(candidate);
          return candidate;
        }
        await redisClient.lPush(freeQueue, candidate);
        attempts++;
        candidate = await redisClient.lPop(freeQueue);
      }
    }

    return null;
  }}

module.exports = MatchingService;
