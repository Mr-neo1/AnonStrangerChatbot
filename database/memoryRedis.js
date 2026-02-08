// In-memory Redis replacement for local development
class MemoryRedis {
  constructor() {
    this.data = new Map();
    this.lists = new Map();
    this.expirations = new Map(); // Stores expiration timestamp (Date.now() + seconds*1000)
    this.timers = new Map(); // Store timeout references for cleanup
    console.log("✅ Memory Redis Connected");
  }

  // Basic key-value operations
  async set(key, value, options = {}) {
    this.data.set(key, value);
    if (options.EX) {
      const expiresAt = Date.now() + options.EX * 1000;
      this.expirations.set(key, expiresAt);
      // Clear existing timer if any
      if (this.timers.has(key)) clearTimeout(this.timers.get(key));
      const timer = setTimeout(() => {
        this.data.delete(key);
        this.expirations.delete(key);
        this.timers.delete(key);
      }, options.EX * 1000);
      this.timers.set(key, timer);
    }
    return "OK";
  }

  async setEx(key, seconds, value) {
    return this.set(key, value, { EX: seconds });
  }

  async get(key) {
    return this.data.get(key) || null;
  }

  async del(...keys) {
    let deleted = 0;
    keys.forEach(key => {
      if (this.data.delete(key)) deleted++;
      this.lists.delete(key);
      this.expirations.delete(key);
      // Clean up timer if exists
      if (this.timers.has(key)) {
        clearTimeout(this.timers.get(key));
        this.timers.delete(key);
      }
    });
    return deleted;
  }

  async incr(key) {
    const current = parseInt(this.data.get(key) || "0");
    const newValue = current + 1;
    this.data.set(key, newValue.toString());
    return newValue;
  }

  async expire(key, seconds) {
    if (this.data.has(key)) {
      const expiresAt = Date.now() + seconds * 1000;
      this.expirations.set(key, expiresAt);
      // Clear existing timer if any
      if (this.timers.has(key)) clearTimeout(this.timers.get(key));
      const timer = setTimeout(() => {
        this.data.delete(key);
        this.expirations.delete(key);
        this.timers.delete(key);
      }, seconds * 1000);
      this.timers.set(key, timer);
      return 1;
    }
    return 0;
  }

  async ttl(key) {
    if (!this.expirations.has(key)) return -2; // Key doesn't exist
    const expiresAt = this.expirations.get(key);
    const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2; // Expired
  }

  // List operations
  async lPush(key, ...values) {
    if (!this.lists.has(key)) {
      this.lists.set(key, []);
    }
    const list = this.lists.get(key);
    list.unshift(...values);
    return list.length;
  }

  async lPop(key) {
    const list = this.lists.get(key);
    if (!list || list.length === 0) return null;
    return list.shift();
  }

  async lRange(key, start, stop) {
    const list = this.lists.get(key) || [];
    if (stop === -1) stop = list.length - 1;
    return list.slice(start, stop + 1);
  }

  async lRem(key, count, element) {
    const list = this.lists.get(key);
    if (!list) return 0;
    
    let removed = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] === element) {
        list.splice(i, 1);
        removed++;
        if (count > 0 && removed >= count) break;
      }
    }
    return removed;
  }

  // Utility operations
  async keys(pattern) {
    // Combine keys from both data and lists maps
    const allKeys = new Set([
      ...Array.from(this.data.keys()),
      ...Array.from(this.lists.keys())
    ]);
    const keys = Array.from(allKeys);
    
    if (pattern === "*") return keys;
    
    // Simple pattern matching for "prefix:*"
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      return keys.filter(key => key.startsWith(prefix));
    }
    
    return keys.filter(key => key === pattern);
  }

  async ping() {
    return "PONG";
  }

  // Multi/pipeline operations (simplified)
  multi() {
    const commands = [];
    return {
      set: (key, value) => { commands.push(['set', key, value]); return this; },
      expire: (key, seconds) => { commands.push(['expire', key, seconds]); return this; },
      exec: async () => {
        const results = [];
        for (const [cmd, ...args] of commands) {
          results.push(await memoryRedis[cmd](...args));
        }
        return results;
      }
    };
  }

  // Connection methods (no-op for memory)
  async connect() { return this; }
  async quit() { return "OK"; }
}

const memoryRedis = new MemoryRedis();
module.exports = { redisClient: memoryRedis };