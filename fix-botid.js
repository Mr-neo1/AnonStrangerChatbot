require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.POSTGRES_URI });

(async () => {
  const result = await pool.query(
    'UPDATE "User" SET "botId" = $1 WHERE "botId" = $2',
    ['bot_0', 'default']
  );
  console.log('Updated', result.rowCount, 'users to bot_0');
  await pool.end();
})();
