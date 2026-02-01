require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.POSTGRES_URI });

(async () => {
  // Get bot tokens from .env
  const botTokens = process.env.BOT_TOKENS;
  
  if (!botTokens) {
    console.error('BOT_TOKENS not found in .env');
    process.exit(1);
  }
  
  console.log('Updating database with tokens from .env...');
  console.log('Tokens:', botTokens.split(',').length, 'bots');
  
  // Update or insert bot_tokens in app_config
  const result = await pool.query(`
    INSERT INTO app_config (key, value)
    VALUES ('bot_tokens', $1)
    ON CONFLICT (key) DO UPDATE SET value = $1
  `, [botTokens]);
  
  console.log('✅ Database updated with new bot tokens');
  console.log('\nRestart the bot with: npm run all');
  
  await pool.end();
})();
