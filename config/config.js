require("dotenv").config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN?.trim(),
  POSTGRES_URI: process.env.DATABASE_URL?.trim(), // Use Railway's DATABASE_URL
  ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID?.trim(),
  REQUIRED_CHANNEL_1: process.env.REQUIRED_CHANNEL_1?.trim(),
  REQUIRED_CHANNEL_2: process.env.REQUIRED_CHANNEL_2?.trim(),
  REDIS_URL: process.env.REDIS_URL?.trim(),
};
