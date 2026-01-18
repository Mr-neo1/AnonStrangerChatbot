/**
 * Redis Optimization Utilities
 * Provides pipelining, batching, and connection pooling optimizations
 */

const { redisClient } = require('../database/redisClient');

class RedisOptimizer {
  /**
   * Execute multiple Redis commands in a pipeline (faster than sequential)
   * @param {Array<{command: string, args: Array}>} commands - Array of command objects
   * @returns {Promise<Array>} Results array
   */
  static async pipeline(commands) {
    if (!redisClient || typeof redisClient.multi !== 'function') {
      // Fallback for memory Redis or non-pipeline support
      const results = [];
      for (const cmd of commands) {
        try {
          const result = await redisClient[cmd.command](...cmd.args);
          results.push([null, result]);
        } catch (err) {
          results.push([err, null]);
        }
      }
      return results;
    }

    try {
      const pipeline = redisClient.multi();
      
      for (const cmd of commands) {
        pipeline[cmd.command](...cmd.args);
      }
      
      const results = await pipeline.exec();
      return results || [];
    } catch (err) {
      console.error('Redis pipeline error:', err.message);
      // Fallback to sequential execution
      const results = [];
      for (const cmd of commands) {
        try {
          const result = await redisClient[cmd.command](...cmd.args);
          results.push([null, result]);
        } catch (err) {
          results.push([err, null]);
        }
      }
      return results;
    }
  }

  /**
   * Batch get multiple keys efficiently
   * @param {Array<string>} keys - Array of Redis keys
   * @returns {Promise<Array>} Array of values (null if not found)
   */
  static async mGet(keys) {
    if (!keys || keys.length === 0) return [];
    
    try {
      // Use MGET if available (faster than multiple GETs)
      if (typeof redisClient.mGet === 'function') {
        return await redisClient.mGet(keys);
      }
      
      // Fallback: parallel GETs
      const promises = keys.map(key => 
        redisClient.get(key).catch(() => null)
      );
      return await Promise.all(promises);
    } catch (err) {
      console.error('Redis mGet error:', err.message);
      // Fallback: return nulls
      return new Array(keys.length).fill(null);
    }
  }

  /**
   * Batch set multiple key-value pairs efficiently
   * @param {Array<{key: string, value: string, ttl?: number}>} pairs - Array of key-value pairs
   * @returns {Promise<boolean>} Success status
   */
  static async mSet(pairs) {
    if (!pairs || pairs.length === 0) return true;
    
    try {
      // Use pipeline for batch operations
      const commands = pairs.map(pair => ({
        command: pair.ttl ? 'setEx' : 'set',
        args: pair.ttl 
          ? [pair.key, pair.ttl, pair.value]
          : [pair.key, pair.value]
      }));
      
      const results = await this.pipeline(commands);
      // Check if all succeeded
      return results.every(([err]) => err === null);
    } catch (err) {
      console.error('Redis mSet error:', err.message);
      return false;
    }
  }

  /**
   * Delete multiple keys efficiently
   * @param {Array<string>} keys - Array of Redis keys to delete
   * @returns {Promise<number>} Number of keys deleted
   */
  static async mDel(keys) {
    if (!keys || keys.length === 0) return 0;
    
    try {
      // Use DEL with multiple keys if available
      if (keys.length === 1) {
        const result = await redisClient.del(keys[0]);
        return result || 0;
      }
      
      // Use pipeline for multiple deletes
      const commands = keys.map(key => ({
        command: 'del',
        args: [key]
      }));
      
      const results = await this.pipeline(commands);
      return results.filter(([err, result]) => !err && result).length;
    } catch (err) {
      console.error('Redis mDel error:', err.message);
      return 0;
    }
  }

  /**
   * Get multiple hash fields efficiently
   * @param {string} key - Redis hash key
   * @param {Array<string>} fields - Array of field names
   * @returns {Promise<Object>} Object with field-value pairs
   */
  static async hMGet(key, fields) {
    if (!fields || fields.length === 0) return {};
    
    try {
      if (typeof redisClient.hGetAll === 'function') {
        // If we need all fields, use hGetAll (faster)
        if (fields.length > 10) {
          const all = await redisClient.hGetAll(key);
          const result = {};
          for (const field of fields) {
            result[field] = all[field] || null;
          }
          return result;
        }
      }
      
      // Use HMGET if available
      if (typeof redisClient.hMGet === 'function') {
        const values = await redisClient.hMGet(key, fields);
        const result = {};
        fields.forEach((field, idx) => {
          result[field] = values[idx] || null;
        });
        return result;
      }
      
      // Fallback: parallel hGet
      const promises = fields.map(field => 
        redisClient.hGet(key, field).catch(() => null)
      );
      const values = await Promise.all(promises);
      const result = {};
      fields.forEach((field, idx) => {
        result[field] = values[idx];
      });
      return result;
    } catch (err) {
      console.error('Redis hMGet error:', err.message);
      return {};
    }
  }
}

module.exports = RedisOptimizer;
