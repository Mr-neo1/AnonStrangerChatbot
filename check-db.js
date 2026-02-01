require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.POSTGRES_URI 
});

(async () => {
  try {
    // Check existing tables
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('Existing tables in database:');
    if (tables.rows.length === 0) {
      console.log('  (No tables found - database is empty)');
    } else {
      tables.rows.forEach(row => console.log('  -', row.table_name));
    }

    // Try to count users if table exists
    try {
      const result = await pool.query('SELECT COUNT(*) as count FROM "User"');
      console.log('\nTotal users:', result.rows[0].count);
      
      const recent = await pool.query(`SELECT * FROM "User" ORDER BY "createdAt" DESC LIMIT 10`);
      console.log('\nRecent 10 users:');
      recent.rows.forEach((u, i) => {
        console.log(`${i+1}. ID: ${u.telegramId || u.telegram_id}, Username: @${u.username || 'N/A'}, Name: ${u.firstName || u.first_name || 'N/A'}, Created: ${u.createdAt || u.created_at}`);
      });
    } catch (e) {
      console.log('\nError querying users:', e.message);
    }
  } catch(e) { 
    console.error('Database Error:', e.message); 
  }
  await pool.end();
  process.exit(0);
})();
