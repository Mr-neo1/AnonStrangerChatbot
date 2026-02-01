/**
 * Import users from users_export.json into PostgreSQL
 */
require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.POSTGRES_URI 
});

async function importUsers() {
  console.log('📦 Loading users from users_export.json...');
  
  const jsonData = fs.readFileSync('./users_export.json', 'utf8');
  const users = JSON.parse(jsonData);
  
  console.log(`Found ${users.length} users to import`);
  
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const user of users) {
    try {
      // Check if user already exists
      const existing = await pool.query(
        'SELECT "telegramId" FROM "User" WHERE "telegramId" = $1',
        [user.telegramId || user.userId]
      );
      
      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }
      
      // Insert user
      await pool.query(`
        INSERT INTO "User" (
          "userId", "telegramId", "gender", "age", "banned", 
          "totalChats", "hasStarted", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        user.userId || user.telegramId,
        user.telegramId || user.userId,
        user.gender,
        user.age,
        user.banned || 0,
        user.totalChats || 0,
        true,
        user.createdAt || new Date().toISOString(),
        new Date().toISOString()
      ]);
      
      imported++;
      
      if (imported % 100 === 0) {
        console.log(`  Imported ${imported} users...`);
      }
    } catch (err) {
      errors++;
      if (errors <= 5) {
        console.error(`  Error importing user ${user.userId}: ${err.message}`);
      }
    }
  }
  
  console.log('\n=== Import Complete ===');
  console.log(`✅ Imported: ${imported}`);
  console.log(`⏭️  Skipped (already exists): ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  
  // Verify total
  const result = await pool.query('SELECT COUNT(*) as count FROM "User"');
  console.log(`\n📊 Total users in database: ${result.rows[0].count}`);
  
  await pool.end();
}

importUsers().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
