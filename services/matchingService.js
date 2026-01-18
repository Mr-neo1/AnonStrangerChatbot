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
  static async isUserQueued(botId, userId) {
    const keys = require('../utils/redisKeys');
    const crossBotMode = process.env.ENABLE_CROSS_BOT_MATCHING === 'true';
    
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
      
      const uid = userId.toString();
      const checks = await Promise.all(
        globalKeys.map(key => redisClient.lRange(key, 0, -1).catch(() => []))
      );
      return checks.some(queue => queue && queue.includes(uid));
    } else {
      // Bot-scoped queues
      botId = botId || 'default';
      const allQueueKeys = keys.QUEUE_ALL_KEYS(botId);
      const checks = await Promise.all(
        allQueueKeys.map(key => redisClient.lRange(key, 0, -1).catch(() => []))
      );
      return checks.some(queue => queue && queue.includes(userId.toString()));
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
    
    // Pre-fetch user data
    const [currentUser, isVipUser] = await Promise.all([
      User.findOne({ where: { userId } }),
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

      if (forVipSearch && prefs && prefs.gender && prefs.gender !== 'Any') {
        if (candidateUser.gender !== prefs.gender) return false;
      }

      if (candidateIsVip && candidatePrefs && candidatePrefs.gender && candidatePrefs.gender !== 'Any') {
        if (!currentUser || currentUser.gender !== candidatePrefs.gender) return false;
      }

      return true;
    };

    // Remove candidate from queues
    const removeFromAllQueues = async (candidateId) => {
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
          try { await redisClient.lRem(k, 0, candidateId); } catch (e) { }
        }
      } else {
        const allKeys = keys.QUEUE_ALL_KEYS(botId);
        for (const k of allKeys) {
          try { await redisClient.lRem(k, 0, candidateId); } catch (e) { }
        }
      }
    };

    // Record match
    const recordMatch = async (cand) => {
      await removeFromAllQueues(cand);
    };

    // Batch fetch candidate data
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
          await redisClient.lPush(q, candidate);
          attempts++;
          candidate = await redisClient.lPop(q);
        }
      }

      // Try free queue (VIP ↔ Free)
      const freeQ = crossBotMode ? 'queue:free' : keys.QUEUE_FREE_KEY(botId);
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

      return null;
    }

    // Free user matching (try free queue, then general queue)
    const freeQ = crossBotMode ? 'queue:free' : keys.QUEUE_FREE_KEY(botId);
    const genQ = crossBotMode ? 'queue:general' : keys.QUEUE_GENERAL_KEY(botId);
    
    for (const q of [freeQ, genQ]) {
      const peeked = await redisClient.lRange(q, 0, 49).catch(() => []);
      if (peeked.length === 0) continue;
      
      const candidateData = await fetchCandidateData(peeked);
      let attempts = 0;
      let candidate = await redisClient.lPop(q);
      
      while (candidate && attempts < Math.min(50, peeked.length)) {
        const data = candidateData.get(candidate);
        if (data && await isCandidateSuitable(candidate, false, data.user, data.isVip, data.prefs)) {
          await recordMatch(candidate);
          return candidate;
        }
        await redisClient.lPush(q, candidate);
        attempts++;
        candidate = await redisClient.lPop(q);
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
