const { redisClient } = require('../database/redisClient');
const User = require('../models/userModel');
const vipService = require('./vipService');

/**
 * Multi-bot Matching Service
 * 
 * Supports both:
 * 1. Single-bot matching (botId scoped to that bot only)
 * 2. Cross-bot matching (botId = 'global' for federation mode)
 * 
 * When ENABLE_CROSS_BOT_MATCHING=true, users from different bots can match with each other
 */

class MatchingService {
  // Return whether the user is already present in any queue
  // OPTIMIZED: Use LPOS to check membership without fetching entire lists (6x less data transfer)
  static async isUserQueued(botId, userId) {
    const keys = require('../utils/redisKeys');
    const crossBotMode = process.env.ENABLE_CROSS_BOT_MATCHING === 'true';
    const uid = userId.toString();
    
    // Helper: Check if user exists in queue using LPOS (O(N) but no data transfer)
    const checkQueue = async (key) => {
      try {
        // LPOS returns index if found, null if not found (Redis 6.0.6+)
        if (typeof redisClient.lPos === 'function') {
          const pos = await redisClient.lPos(key, uid);
          return pos !== null;
        }
        // Fallback for older Redis: use lRange but limit to first 100
        const items = await redisClient.lRange(key, 0, 99).catch(() => []);
        return items && items.includes(uid);
      } catch (err) {
        return false;
      }
    };
    
    if (crossBotMode) {
      // Global queues (bot-agnostic)
      const globalKeys = [
        'queue:vip',
        'queue:vip:gender:male',
        'queue:vip:gender:female',
        'queue:vip:any',
        'queue:free',
        'queue:general'
      ];
      
      const checks = await Promise.all(globalKeys.map(checkQueue));
      return checks.some(found => found);
    } else {
      // Bot-scoped queues
      botId = botId || 'default';
      const allQueueKeys = keys.QUEUE_ALL_KEYS(botId);
      const checks = await Promise.all(allQueueKeys.map(checkQueue));
      return checks.some(found => found);
    }
  }

  // Enqueue user to appropriate queue
  static async enqueueUser(botId, userId) {
    const keys = require('../utils/redisKeys');
    botId = botId || 'default';
    const crossBotMode = process.env.ENABLE_CROSS_BOT_MATCHING === 'true';

    // Do not enqueue duplicates
    const alreadyQueued = await MatchingService.isUserQueued(botId, userId);
    if (alreadyQueued) return;

    const isVipUser = await vipService.isVipActive(userId);
    const uid = userId.toString();

    if (isVipUser) {
      const prefs = await vipService.getVipPreferences(userId) || {};
      const genderPref = (prefs.gender || 'Any');

      if (crossBotMode) {
        // Global VIP queues
        await redisClient.lPush('queue:vip', uid);
        if (genderPref && genderPref !== 'Any') {
          await redisClient.lPush(`queue:vip:gender:${genderPref.toLowerCase()}`, uid);
        } else {
          await redisClient.lPush('queue:vip:any', uid);
        }
      } else {
        // Bot-scoped VIP queues
        await redisClient.lPush(keys.QUEUE_VIP_KEY(botId), uid);
        if (genderPref && genderPref !== 'Any') {
          await redisClient.lPush(keys.QUEUE_VIP_GENDER_KEY(botId, genderPref), uid);
        } else {
          await redisClient.lPush(keys.QUEUE_VIP_ANY_KEY(botId), uid);
        }
      }
    } else {
      // Non-VIP (free users)
      if (crossBotMode) {
        await redisClient.lPush('queue:general', uid);
        await redisClient.lPush('queue:free', uid);
      } else {
        await redisClient.lPush(keys.QUEUE_GENERAL_KEY(botId), uid);
        await redisClient.lPush(keys.QUEUE_FREE_KEY(botId), uid);
      }
    }
  }

  // Try to find a match for userId
  static async matchNextUser(botId, userId, preferences = {}) {
    botId = botId || 'default';
    const keys = require('../utils/redisKeys');
    const crossBotMode = process.env.ENABLE_CROSS_BOT_MATCHING === 'true';

    const userIdStr = userId.toString();
    
    // Pre-fetch user data (optimized with cache)
    const UserCacheService = require('./userCacheService');
    const [currentUser, isVipUser] = await Promise.all([
      UserCacheService.getUser(userId),
      vipService.isVipActive(userId)
    ]);
    
    if (!currentUser || currentUser.banned) return null;
    
    const prefs = isVipUser && (!preferences || !Object.keys(preferences).length) 
      ? (await vipService.getVipPreferences(userId) || {}) 
      : preferences;

    // Check if candidate is suitable
    const isCandidateSuitable = async (candidateId, forVipSearch, candidateUser, candidateIsVip, candidatePrefs) => {
      if (!candidateId || candidateId === userIdStr) return false;
      if (!candidateUser || candidateUser.banned) return false;

      // VIP Gender preference check
      if (forVipSearch && prefs && prefs.gender && prefs.gender !== 'Any') {
        if (candidateUser.gender !== prefs.gender) return false;
      }

      if (candidateIsVip && candidatePrefs && candidatePrefs.gender && candidatePrefs.gender !== 'Any') {
        if (!currentUser || currentUser.gender !== candidatePrefs.gender) return false;
      }

      // VIP Age preference check (new feature)
      if (forVipSearch && currentUser) {
        // Check if current VIP user has age preferences
        if (currentUser.vipAgeMin && currentUser.vipAgeMax && currentUser.vipAgeMin > 0) {
          const candidateAge = candidateUser.age;
          if (candidateAge && (candidateAge < currentUser.vipAgeMin || candidateAge > currentUser.vipAgeMax)) {
            return false;
          }
        }
      }

      // Check if candidate (if VIP) has age preferences
      if (candidateIsVip && candidateUser.vipAgeMin && candidateUser.vipAgeMax && candidateUser.vipAgeMin > 0) {
        const currentAge = currentUser?.age;
        if (currentAge && (currentAge < candidateUser.vipAgeMin || currentAge > candidateUser.vipAgeMax)) {
          return false;
        }
      }

      return true;
    };

    // Remove candidate from queues - Use parallel operations for compatibility
    const removeFromAllQueues = async (candidateId) => {
      try {
        let queueKeys = [];
        if (crossBotMode) {
          queueKeys = [
            'queue:vip',
            'queue:vip:gender:male',
            'queue:vip:gender:female',
            'queue:vip:any',
            'queue:free',
            'queue:general'
          ];
        } else {
          queueKeys = keys.QUEUE_ALL_KEYS(botId);
        }

        // Use parallel operations for better compatibility with all Redis clients
        await Promise.all(
          queueKeys.map(k => redisClient.lRem(k, 0, candidateId).catch(() => {}))
        );
      } catch (e) {
        // Ignore errors - non-critical operation
      }
    };

    // Record match
    const recordMatch = async (cand) => {
      await removeFromAllQueues(cand);
    };

    // Batch fetch candidate data (optimized with cache)
    const fetchCandidateData = async (candidateIds) => {
      if (!candidateIds || candidateIds.length === 0) return new Map();
      
      const UserCacheService = require('./userCacheService');
      // Use cached user data (much faster)
      const users = await UserCacheService.getUser(candidateIds);
      const usersArray = Array.isArray(users) ? users : [users].filter(Boolean);
      const usersMap = new Map(usersArray.map(u => [String(u.userId), u]));
      
      // Parallel fetch VIP status and preferences
      const [vipStatuses, vipPrefs] = await Promise.all([
        Promise.all(candidateIds.map(id => vipService.isVipActive(id))),
        Promise.all(candidateIds.map(id => vipService.getVipPreferences(id).catch(() => ({}))))
      ]);
      
      const dataMap = new Map();
      candidateIds.forEach((id, idx) => {
        const userIdStr = String(id);
        dataMap.set(id, {
          user: usersMap.get(userIdStr) || null,
          isVip: vipStatuses[idx],
          prefs: vipPrefs[idx] || {}
        });
      });
      
      return dataMap;
    };

    // VIP matching
    if (isVipUser) {
      // Try gender-specific VIP queue first
      const vipQueues = [];
      if (crossBotMode) {
        if (prefs.gender && prefs.gender !== 'Any') {
          vipQueues.push(`queue:vip:gender:${prefs.gender.toLowerCase()}`);
        }
        vipQueues.push('queue:vip:any');
      } else {
        if (prefs.gender && prefs.gender !== 'Any') {
          vipQueues.push(keys.QUEUE_VIP_GENDER_KEY(botId, prefs.gender));
        }
        vipQueues.push(keys.QUEUE_VIP_ANY_KEY(botId));
      }

      for (const q of vipQueues) {
        const peeked = await redisClient.lRange(q, 0, 149).catch(() => []);
        if (peeked.length === 0) continue;
        
        // Filter out self from candidates
        const filteredPeeked = peeked.filter(id => id !== userIdStr);
        if (filteredPeeked.length === 0) continue;
        
        const candidateData = await fetchCandidateData(filteredPeeked);
        
        // Find first suitable VIP candidate without pop-push rotation
        for (const candidateId of filteredPeeked) {
          const data = candidateData.get(candidateId);
          if (data && data.isVip && data.user && !data.user.banned && await isCandidateSuitable(candidateId, true, data.user, data.isVip, data.prefs)) {
            await recordMatch(candidateId);
            return candidateId;
          }
        }
      }

      // Try free queue (VIP ↔ Free)
      const freeQ = crossBotMode ? 'queue:free' : keys.QUEUE_FREE_KEY(botId);
      const peekedFree = await redisClient.lRange(freeQ, 0, 149).catch(() => []);
      if (peekedFree.length > 0) {
        // Filter out self from candidates
        const filteredFree = peekedFree.filter(id => id !== userIdStr);
        if (filteredFree.length > 0) {
          const candidateData = await fetchCandidateData(filteredFree);
          
          // Find first suitable free candidate
          for (const candidateId of filteredFree) {
            const data = candidateData.get(candidateId);
            if (data && !data.isVip && data.user && !data.user.banned && await isCandidateSuitable(candidateId, false, data.user, false, {})) {
              await recordMatch(candidateId);
              return candidateId;
            }
          }
        }
      }

      return null;
    }

    // Free user matching (try free queue, then general queue)
    const freeQ = crossBotMode ? 'queue:free' : keys.QUEUE_FREE_KEY(botId);
    const genQ = crossBotMode ? 'queue:general' : keys.QUEUE_GENERAL_KEY(botId);
    
    for (const q of [freeQ, genQ]) {
      const peeked = await redisClient.lRange(q, 0, 149).catch(() => []);
      if (peeked.length === 0) continue;
      
      // Filter out self from peeked list before fetching data
      const filteredPeeked = peeked.filter(id => id !== userIdStr);
      if (filteredPeeked.length === 0) continue;
      
      const candidateData = await fetchCandidateData(filteredPeeked);
      
      // Find first suitable candidate without pop-push rotation (more reliable)
      for (const candidateId of filteredPeeked) {
        const data = candidateData.get(candidateId);
        if (data && data.user && !data.user.banned && await isCandidateSuitable(candidateId, false, data.user, data.isVip, data.prefs)) {
          // Found suitable candidate - remove from all queues
          await recordMatch(candidateId);
          return candidateId;
        }
      }
    }

    return null;
  }

  // Dequeue user from all queues
  static async dequeueUser(botId, userId) {
    const keys = require('../utils/redisKeys');
    botId = botId || 'default';
    const crossBotMode = process.env.ENABLE_CROSS_BOT_MATCHING === 'true';
    
    const uid = userId.toString();

    if (crossBotMode) {
      const globalKeys = [
        'queue:vip',
        'queue:vip:gender:male',
        'queue:vip:gender:female',
        'queue:vip:any',
        'queue:free',
        'queue:general'
      ];
      
      for (const k of globalKeys) {
        try { await redisClient.lRem(k, 0, uid); } catch (e) { }
      }
    } else {
      const allKeys = keys.QUEUE_ALL_KEYS(botId);
      for (const k of allKeys) {
        try { await redisClient.lRem(k, 0, uid); } catch (e) { }
      }
    }
  }
}

module.exports = MatchingService;
