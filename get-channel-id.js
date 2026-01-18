#!/usr/bin/env node
/**
 * Quick utility to get your Telegram channel ID
 * Usage: node get-channel-id.js <your_channel_username>
 * 
 * This attempts to send a test message to your channel to discover its numeric ID.
 */

const TelegramBot = require('node-telegram-bot-api');
const readline = require('readline');
const dotenv = require('dotenv');

// Load env
dotenv.config({ path: '.env.local' });
dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function main() {
  console.log('\n📱 Telegram Channel ID Finder\n');
  
  // Get bot token from environment or prompt
  let token = process.env.BOT_TOKEN || process.env.BOT_TOKENS?.split(',')[0];
  
  if (!token) {
    token = await question('🔑 Enter your bot token: ');
  }
  
  if (!token || token.trim().length === 0) {
    console.error('❌ No bot token provided');
    rl.close();
    return;
  }

  // Get channel identifier
  let channel = process.argv[2];
  if (!channel) {
    channel = await question('📺 Enter your channel ID or @username (e.g., @MyChannel or -1001234567890): ');
  }

  if (!channel || channel.trim().length === 0) {
    console.error('❌ No channel identifier provided');
    rl.close();
    return;
  }

  channel = channel.trim();
  
  console.log('\n⏳ Sending test message to discover channel ID...\n');
  
  const bot = new TelegramBot(token, { polling: false });
  
  try {
    // Try sending a test message
    const msg = await bot.sendMessage(channel, '✅ Test message - bot can access this channel!');
    
    const chatId = msg.chat.id;
    const finalId = chatId < 0 ? chatId : `-100${chatId}`;
    
    console.log('✅ Success! Your channel ID is:');
    console.log(`\n   🔢 Numeric ID: ${chatId}`);
    console.log(`   🔢 Full ID (for supergroups): ${finalId}\n`);
    console.log('📝 Use in .env.local:\n');
    console.log(`   ADMIN_MEDIA_CHANNEL_ID=${finalId}\n`);
    
    // Try to delete the test message
    try {
      await bot.deleteMessage(channel, msg.message_id);
      console.log('🧹 Test message deleted\n');
    } catch (e) {
      console.log('⚠️ Could not delete test message (but bot can still access the channel)\n');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error('\n💡 Troubleshooting:');
    console.error('   • Make sure your bot token is correct');
    console.error('   • Make sure the bot is a member of this channel/group');
    console.error('   • For private channels, use the numeric ID format');
    console.error('   • Try using the channel username with @ prefix (e.g., @MyChannel)\n');
  }
  
  rl.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
