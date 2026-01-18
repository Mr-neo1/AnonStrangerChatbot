/**
 * Redis SCAN Helper
 * Provides a unified SCAN interface that works with both Redis v4 and memory Redis
 */

/**
 * Scan Redis keys matching a pattern
 * @param {object} redisClient - Redis client instance
 * @param {string} pattern - Pattern to match (e.g., 'pair:*')
 * @param {number} count - Number of keys to fetch per iteration
 * @returns {Promise<string[]>} Array of matching keys
 */
async function scanKeys(redisClient, pattern, count = 100) {
  const keys = [];
  
  // Check if this is memory Redis (doesn't have scan method)
  if (!redisClient.scan || typeof redisClient.scan !== 'function') {
    // Fallback to keys() for memory Redis
    try {
      const allKeys = await redisClient.keys(pattern);
      return allKeys || [];
    } catch (err) {
      return [];
    }
  }
  
  let cursor = 0;
  
  do {
    try {
      // Redis v4 API: scan(cursor, { MATCH, COUNT })
      const result = await redisClient.scan(cursor, { 
        MATCH: pattern, 
        COUNT: count 
      });
      
      // Handle different response formats
      if (Array.isArray(result)) {
        // Redis v4 returns [cursor, keys[]]
        cursor = parseInt(result[0]) || 0;
        const batchKeys = result[1] || [];
        keys.push(...batchKeys);
      } else if (result && typeof result === 'object') {
        // Some clients return { cursor, keys }
        cursor = parseInt(result.cursor) || 0;
        const batchKeys = result.keys || [];
        keys.push(...batchKeys);
      } else {
        break;
      }
      
      // Stop if cursor is 0 (scan complete)
      if (cursor === 0) break;
      
    } catch (err) {
      // Fallback to KEYS if SCAN fails
      try {
        const fallbackKeys = await redisClient.keys(pattern).catch(() => []);
        return fallbackKeys || [];
      } catch (e) {
        return keys; // Return what we have so far
      }
    }
  } while (cursor !== 0);
  
  return keys;
}

module.exports = { scanKeys };
