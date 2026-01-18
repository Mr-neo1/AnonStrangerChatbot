// Map bot tokens to bot IDs (supports multiple bots)
require('dotenv').config();

module.exports = {
  bots: {
    default: process.env.BOT_TOKEN || null,
    // Add more as BOT_TOKEN_{ID}
  }
};