/**
 * Add username/firstName columns and fetch from Telegram
 */
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.POSTGRES_URI });

// Use the first bot token (AnonStrangerChatbot)
const botToken = process.env.BOT_TOKEN || process.env.BOT_TOKENS.split(',')[0];
const bot = new TelegramBot(botToken);

async function addColumnsAndFetch() {
  console.log('📦 Adding username columns to User table...');
  
  // Add columns if they don't exist
  try {
    await pool.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" VARCHAR(255)`);
    await pool.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "firstName" VARCHAR(255)`);
    await pool.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastName" VARCHAR(255)`);
    console.log('✅ Columns added/verified');
  } catch (err) {
    console.log('Columns may already exist:', err.message);
  }
  
  // Get all users
  const result = await pool.query(`
    SELECT "telegramId" FROM "User" ORDER BY "createdAt" DESC
  `);
  
  const users = result.rows;
  console.log(`\n📡 Fetching usernames for ${users.length} users from Telegram...\n`);
  
  let updated = 0;
  let notReachable = 0;
  
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    
    try {
      // Get chat info from Telegram
      const chat = await bot.getChat(user.telegramId);
      
      const username = chat.username || null;
      const firstName = chat.first_name || null;
      const lastName = chat.last_name || null;
      
      await pool.query(`
        UPDATE "User" 
        SET "username" = $1, "firstName" = $2, "lastName" = $3
        WHERE "telegramId" = $4
      `, [username, firstName, lastName, user.telegramId]);
      
      updated++;
      const displayName = username ? `@${username}` : firstName || user.telegramId;
      
      if (updated % 50 === 0 || updated <= 10) {
        console.log(`✅ ${updated}/${users.length}: ${displayName}`);
      }
      
      // Rate limit: ~25 requests per second
      if (i % 25 === 0 && i > 0) {
        await new Promise(r => setTimeout(r, 1000));
      }
      
    } catch (err) {
      notReachable++;
      // Silent fail for unreachable users
    }
  }
  
  console.log('\n=== Complete ===');
  console.log(`✅ Updated with usernames: ${updated}`);
  console.log(`⚠️ Not reachable (blocked/deleted): ${notReachable}`);
  
  // Show sample of updated users
  const sample = await pool.query(`
    SELECT "telegramId", "username", "firstName" 
    FROM "User" 
    WHERE "username" IS NOT NULL 
    LIMIT 10
  `);
  
  console.log('\nSample users with usernames:');
  sample.rows.forEach((u, i) => {
    console.log(`  ${i+1}. @${u.username} (${u.firstName || 'N/A'}) - ID: ${u.telegramId}`);
  });
  
  await pool.end();
  process.exit(0);
}

addColumnsAndFetch().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
