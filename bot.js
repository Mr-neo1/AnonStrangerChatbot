require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { sequelize } = require("./database/connectionPool");
const { redisClient } = require("./database/redisClient");
const EnhancedChatController = require("./controllers/enhancedChatController");
const MediaController = require("./controllers/mediaController");
const AdminController = require("./controllers/adminController");

async function init() {
  try {
    // Connect to SQL
    await sequelize.authenticate();
    console.log("✅ SQL Database Connected");
    await sequelize.sync();

    // Redis is connected in redisClient.js
    // We skip an extra .connect() call to avoid “Socket already opened”

    // Initialize bot
    const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

    // Instantiate controllers
    new EnhancedChatController(bot);
    new MediaController(bot);
    new AdminController(bot);

    console.log("🤖 Bot is running...");
  } catch (error) {
    console.error("Initialization error:", error);
  }
}

init();
