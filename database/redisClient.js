const config = require("../config/config");

// Use memory Redis for local development
if (config.REDIS_URL.startsWith('memory://')) {
  const { redisClient } = require('./memoryRedis');
  module.exports = { redisClient };
} else {
  // Use real Redis for production
  const { createClient } = require("redis");
  
  const redisClient = createClient({
    url: config.REDIS_URL,
  });
  
  redisClient.on("error", (err) => console.error("Redis Error:", err));
  
  redisClient.connect()
    .then(() => console.log("✅ Redis Connected"))
    .catch((err) => console.error("❌ Redis Connection Error:", err));
  
  module.exports = { redisClient };
}
