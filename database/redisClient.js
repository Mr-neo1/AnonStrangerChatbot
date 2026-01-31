const config = require("../config/config");

// Use memory Redis for local development
if (!config.REDIS_URL || config.REDIS_URL === '') {
  console.warn('⚠️ REDIS_URL not set - falling back to in-memory Redis (development mode)');
  const { redisClient } = require('./memoryRedis');
  module.exports = { redisClient };
} else if (config.REDIS_URL.startsWith('memory://')) {
  const { redisClient } = require('./memoryRedis');
  module.exports = { redisClient };
} else {
  // Use real Redis for production
  const { createClient } = require("redis");
  
  const redisClient = createClient({
    url: config.REDIS_URL,
    socket: {
        connectTimeout: 10000,
        keepAlive: 5000,
        noDelay: true, // Disable Nagle's algorithm for lower latency
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          console.error("❌ Redis: Max reconnection attempts reached");
          return new Error("Max reconnection attempts reached");
        }
        const delay = Math.min(retries * 100, 3000);
        console.log(`⚠️ Redis: Reconnecting in ${delay}ms (attempt ${retries})...`);
        return delay;
      }
    },
    // Enable pipelining for better throughput (10-15k DAU)
    commandsQueueMaxLength: 10000,
  });
  
  let isConnected = false;
  
  redisClient.on("error", (err) => {
    console.error("Redis Error:", err.message);
    isConnected = false;
  });
  
  redisClient.on("connect", () => {
    console.log("🔄 Redis: Connecting...");
  });
  
  redisClient.on("ready", () => {
    console.log("✅ Redis Connected");
    isConnected = true;
  });
  
  redisClient.on("reconnecting", () => {
    console.log("🔄 Redis: Reconnecting...");
    isConnected = false;
  });
  
  // Wrap Redis operations to handle disconnections gracefully
  const originalRedisClient = redisClient;
  const wrappedRedisClient = new Proxy(redisClient, {
    get(target, prop) {
      const originalMethod = target[prop];
      if (typeof originalMethod === 'function') {
        return async function(...args) {
          try {
            if (!isConnected && prop !== 'connect' && prop !== 'disconnect') {
              // Try to reconnect if not connected
              if (!target.isOpen) {
                await target.connect().catch(() => {});
              }
            }
            return await originalMethod.apply(target, args);
          } catch (err) {
            // If connection lost, try to reconnect once
            if (err.message && (err.message.includes('Connection') || err.message.includes('closed'))) {
              try {
                if (!target.isOpen) {
                  await target.connect().catch(() => {});
                  return await originalMethod.apply(target, args);
                }
              } catch (reconnectErr) {
                // Fallback: return null/empty for get operations, false for others
                if (prop === 'get' || prop === 'lRange' || prop === 'keys') {
                  return prop === 'keys' ? [] : null;
                }
                throw reconnectErr;
              }
            }
            throw err;
          }
        };
      }
      return originalMethod;
    }
  });
  
  redisClient.connect()
    .then(() => {
      console.log("✅ Redis Connected");
      isConnected = true;
    })
    .catch((err) => {
      console.error("❌ Redis Connection Error:", err.message);
      console.log("⚠️ Redis operations will fail until connection is restored");
    });
  
  module.exports = { redisClient: wrappedRedisClient };
}
