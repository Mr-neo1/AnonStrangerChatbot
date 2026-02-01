require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.POSTGRES_URI });

(async () => {
  // Update all imported users to use bot_0 (which will be @AnonStrangerChatbot now)
  const result = await pool.query(
    'UPDATE "User" SET "botId" = $1',
    ['bot_0']
  );
  console.log('Updated', result.rowCount, 'users to bot_0 (@AnonStrangerChatbot)');
  await pool.end();
})();
