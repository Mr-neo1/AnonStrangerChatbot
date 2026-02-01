require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.POSTGRES_URI });

(async () => {
  // Check botId distribution
  const botIdResult = await pool.query(`
    SELECT "botId", COUNT(*) as count 
    FROM "User" 
    GROUP BY "botId" 
    ORDER BY count DESC
  `);
  console.log('Users by botId:');
  console.table(botIdResult.rows);

  // Check hasStarted distribution
  const startedResult = await pool.query(`
    SELECT "hasStarted", COUNT(*) as count 
    FROM "User" 
    GROUP BY "hasStarted"
  `);
  console.log('\nUsers by hasStarted status:');
  console.table(startedResult.rows);

  await pool.end();
})();
