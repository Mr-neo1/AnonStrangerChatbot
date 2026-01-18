// Quick smoke test to start bots (safe to run locally; bots will connect and log)
require('dotenv').config();
const { initBots } = require('../bots');

(async () => {
  try {
    const bots = await initBots();
    console.log(`Started ${bots.length} bots (smoke test).`);
    // Keep process alive briefly to let bots initialize
    setTimeout(() => process.exit(0), 3000);
  } catch (err) {
    console.error('Smoke test failed:', err);
    process.exit(1);
  }
})();
