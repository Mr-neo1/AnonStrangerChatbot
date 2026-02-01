require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.POSTGRES_URI });

(async () => {
  // Check bot tokens in database
  const result = await pool.query(
    "SELECT key, value FROM app_config WHERE key LIKE 'bot_token%'"
  );
  
  console.log('Bot tokens configured in database:\n');
  result.rows.forEach((row, i) => {
    // Show partial token for security
    const token = row.value;
    const partialToken = token.substring(0, 10) + '...' + token.substring(token.length - 5);
    console.log(`${row.key}: ${partialToken}`);
  });
  
  console.log('\n--- Checking which bot is @AnonStrangerChatbot ---\n');
  console.log('You need to add the bot token for @AnonStrangerChatbot to send broadcasts to those users.');
  console.log('\nTo get the token:');
  console.log('1. Go to @BotFather on Telegram');
  console.log('2. Send /mybots');
  console.log('3. Select @AnonStrangerChatbot');
  console.log('4. Click "API Token" to get the token');
  
  await pool.end();
})();
