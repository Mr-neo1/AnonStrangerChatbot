require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.POSTGRES_URI });

(async () => {
  const result = await pool.query('SELECT * FROM "User" ORDER BY "createdAt" DESC');
  
  fs.writeFileSync('users_export.json', JSON.stringify(result.rows, null, 2));
  console.log('✅ Exported', result.rows.length, 'users with usernames to users_export.json');
  
  // Show sample
  console.log('\nSample (first 5):');
  result.rows.slice(0, 5).forEach((u, i) => {
    console.log(`  ${i+1}. @${u.username || 'N/A'} - ${u.firstName || 'N/A'} (ID: ${u.telegramId})`);
  });
  
  await pool.end();
})();
