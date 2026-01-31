/**
 * User Migration Script
 * Migrates users from old SQLite database to new PostgreSQL database
 * 
 * Usage: node deploy/migrate-users.js /path/to/old/chatbot.db
 */

const path = require('path');
const fs = require('fs');

// Check for SQLite file argument
const oldDbPath = process.argv[2];

if (!oldDbPath) {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║              User Migration Script                             ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  Usage: node deploy/migrate-users.js /path/to/old/chatbot.db   ║
║                                                                ║
║  This script will:                                             ║
║  1. Read users from old SQLite database                        ║
║  2. Insert them into new PostgreSQL database                   ║
║  3. Preserve userId, gender, age, totalChats                   ║
║                                                                ║
║  Steps:                                                        ║
║  1. Upload old chatbot.db to /opt/chatbot/old_data/            ║
║  2. Run: node deploy/migrate-users.js old_data/chatbot.db      ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `);
  process.exit(1);
}

// Check if file exists
if (!fs.existsSync(oldDbPath)) {
  console.error(`❌ File not found: ${oldDbPath}`);
  process.exit(1);
}

console.log('📦 Loading dependencies...');

// Load environment
require('dotenv').config();

const { Sequelize, DataTypes } = require('sequelize');

// ===========================================
// Connect to OLD SQLite Database
// ===========================================
console.log(`\n📂 Connecting to old SQLite database: ${oldDbPath}`);

const oldDb = new Sequelize({
  dialect: 'sqlite',
  storage: oldDbPath,
  logging: false
});

// ===========================================
// Connect to NEW PostgreSQL Database
// ===========================================
console.log('🐘 Connecting to new PostgreSQL database...');

const newDb = new Sequelize(process.env.POSTGRES_URI, {
  logging: false,
  dialectOptions: {
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  }
});

// ===========================================
// Define User Model for NEW database
// ===========================================
const User = newDb.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.BIGINT,
    unique: true,
    allowNull: false
  },
  telegramId: {
    type: DataTypes.BIGINT,
    unique: true,
    allowNull: true
  },
  username: {
    type: DataTypes.STRING,
    allowNull: true
  },
  gender: {
    type: DataTypes.STRING,
    allowNull: true
  },
  age: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  vipGenderPreference: {
    type: DataTypes.STRING,
    allowNull: true
  },
  vipMinAge: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  vipMaxAge: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  totalChats: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  positiveRatings: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  negativeRatings: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  referralCode: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: true
  },
  referredBy: {
    type: DataTypes.BIGINT,
    allowNull: true
  },
  referralCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  banned: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  banReason: {
    type: DataTypes.STRING,
    allowNull: true
  },
  botId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  lastActive: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'Users',
  timestamps: true
});

// ===========================================
// Migration Function
// ===========================================
async function migrateUsers() {
  try {
    // Test connections
    await oldDb.authenticate();
    console.log('✅ Connected to old SQLite database');
    
    await newDb.authenticate();
    console.log('✅ Connected to new PostgreSQL database');

    // Sync new database (create tables if not exist)
    await User.sync();
    console.log('✅ User table ready in PostgreSQL');

    // ===========================================
    // Read users from old database
    // ===========================================
    console.log('\n📖 Reading users from old database...');
    
    // Try different possible table names
    let oldUsers = [];
    const possibleTables = ['Users', 'users', 'User', 'user'];
    
    for (const tableName of possibleTables) {
      try {
        const [results] = await oldDb.query(`SELECT * FROM "${tableName}"`);
        if (results && results.length > 0) {
          oldUsers = results;
          console.log(`✅ Found ${oldUsers.length} users in table "${tableName}"`);
          break;
        }
      } catch (e) {
        // Table doesn't exist, try next
      }
    }

    if (oldUsers.length === 0) {
      // Try to list all tables
      const [tables] = await oldDb.query("SELECT name FROM sqlite_master WHERE type='table'");
      console.log('📋 Available tables in old database:', tables.map(t => t.name).join(', '));
      console.log('❌ No users found in old database');
      process.exit(1);
    }

    // ===========================================
    // Show sample data
    // ===========================================
    console.log('\n📊 Sample user data from old database:');
    console.log(JSON.stringify(oldUsers[0], null, 2));

    // ===========================================
    // Migrate users
    // ===========================================
    console.log('\n🔄 Starting migration...');
    
    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const oldUser of oldUsers) {
      try {
        // Map old fields to new fields
        // Adjust these mappings based on your old database structure
        const userData = {
          userId: oldUser.userId || oldUser.user_id || oldUser.id || oldUser.telegram_id,
          telegramId: oldUser.telegramId || oldUser.telegram_id || oldUser.userId || oldUser.user_id,
          username: oldUser.username || null,
          gender: oldUser.gender || null,
          age: oldUser.age ? parseInt(oldUser.age) : null,
          totalChats: oldUser.totalChats || oldUser.total_chats || oldUser.chats || 0,
          positiveRatings: oldUser.positiveRatings || oldUser.positive_ratings || 0,
          negativeRatings: oldUser.negativeRatings || oldUser.negative_ratings || 0,
          banned: oldUser.banned === true || oldUser.banned === 1 || oldUser.is_banned === true,
          banReason: oldUser.banReason || oldUser.ban_reason || null,
          referralCode: oldUser.referralCode || oldUser.referral_code || null,
          referredBy: oldUser.referredBy || oldUser.referred_by || null,
          referralCount: oldUser.referralCount || oldUser.referral_count || 0,
          vipGenderPreference: oldUser.vipGenderPreference || oldUser.vip_gender_preference || null,
          botId: oldUser.botId || oldUser.bot_id || 'bot_0',
          lastActive: oldUser.lastActive || oldUser.last_active || oldUser.updatedAt || new Date()
        };

        // Skip if no valid userId
        if (!userData.userId) {
          console.log(`⚠️ Skipping user without userId:`, oldUser);
          skipped++;
          continue;
        }

        // Check if user already exists
        const existing = await User.findOne({ where: { userId: userData.userId } });
        if (existing) {
          skipped++;
          continue;
        }

        // Create user
        await User.create(userData);
        migrated++;

        // Progress indicator
        if (migrated % 100 === 0) {
          console.log(`   Migrated ${migrated} users...`);
        }
      } catch (err) {
        errors++;
        if (errors <= 5) {
          console.error(`❌ Error migrating user:`, err.message);
        }
      }
    }

    // ===========================================
    // Summary
    // ===========================================
    console.log('\n========================================');
    console.log('✅ Migration Complete!');
    console.log('========================================');
    console.log(`   Total in old DB: ${oldUsers.length}`);
    console.log(`   Migrated:        ${migrated}`);
    console.log(`   Skipped:         ${skipped} (already exist or invalid)`);
    console.log(`   Errors:          ${errors}`);
    console.log('========================================');

    // Verify
    const count = await User.count();
    console.log(`\n📊 Total users in new PostgreSQL database: ${count}`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await oldDb.close();
    await newDb.close();
  }
}

// Run migration
migrateUsers();
