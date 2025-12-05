// Quick test script to verify bot functionality
require("dotenv").config();
const { sequelize } = require("./database/connectionPool");
const { redisClient } = require("./database/redisClient");
const User = require("./models/userModel");

async function testConnections() {
  console.log("🧪 Testing Bot Connections...\n");
  
  try {
    // Test PostgreSQL
    await sequelize.authenticate();
    console.log("✅ PostgreSQL: Connected");
    
    // Test Redis
    await redisClient.ping();
    console.log("✅ Redis: Connected");
    
    // Test User model
    const testUser = await User.findOrCreate({
      where: { userId: 999999999 },
      defaults: { telegramId: 999999999, gender: 'Male', age: 25 }
    });
    console.log("✅ User Model: Working");
    
    // Cleanup test user
    await User.destroy({ where: { userId: 999999999 } });
    
    // Test Redis operations
    await redisClient.set('test:key', 'test:value', { EX: 10 });
    const testValue = await redisClient.get('test:key');
    console.log("✅ Redis Operations: Working");
    
    console.log("\n🎉 All systems operational!");
    console.log("Ready to start bot with: npm start");
    
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.log("\n🔧 Setup required:");
    console.log("1. Install PostgreSQL locally");
    console.log("2. Run: npm run setup-db");
    console.log("3. Install Redis locally");
  } finally {
    await sequelize.close();
    await redisClient.quit();
    process.exit(0);
  }
}

testConnections();