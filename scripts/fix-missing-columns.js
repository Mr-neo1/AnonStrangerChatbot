#!/usr/bin/env node
/**
 * Fix missing columns in PostgreSQL database
 * This script adds columns that were missing from the initial schema
 */
const { Sequelize, DataTypes } = require('sequelize');
const config = require('../config/config');
const { sequelize } = require('../database/connectionPool');

async function addColumnIfNotExists(queryInterface, tableName, columnName, definition) {
  try {
    // Check if column exists
    const [results] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = '${tableName}' AND column_name = '${columnName}'
    `);
    
    if (results.length > 0) {
      console.log(`  ✓ Column ${tableName}.${columnName} already exists`);
      return false;
    }
    
    await queryInterface.addColumn(tableName, columnName, definition);
    console.log(`  ✅ Added column ${tableName}.${columnName}`);
    return true;
  } catch (error) {
    console.error(`  ❌ Error adding ${tableName}.${columnName}:`, error.message);
    return false;
  }
}

async function main() {
  if (!config.POSTGRES_URI) {
    console.error('❌ POSTGRES_URI not set. This script is for PostgreSQL only.');
    process.exit(2);
  }

  try {
    await sequelize.authenticate();
    console.log('✅ Connected to PostgreSQL');
  } catch (err) {
    console.error('❌ Failed to connect to PostgreSQL:', err.message);
    process.exit(1);
  }

  const qi = sequelize.getQueryInterface();
  console.log('\n🔧 Adding missing columns to User table...');

  // Add missing columns to User table
  await addColumnIfNotExists(qi, 'User', 'username', {
    type: DataTypes.STRING(255),
    allowNull: true
  });

  await addColumnIfNotExists(qi, 'User', 'firstName', {
    type: DataTypes.STRING(255),
    allowNull: true
  });

  await addColumnIfNotExists(qi, 'User', 'lastName', {
    type: DataTypes.STRING(255),
    allowNull: true
  });

  await addColumnIfNotExists(qi, 'User', 'vipAgeMin', {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null
  });

  await addColumnIfNotExists(qi, 'User', 'vipAgeMax', {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null
  });

  console.log('\n✅ Database schema fix complete!');
  console.log('\n📋 Next steps:');
  console.log('   1. Restart the bot: pm2 restart chatbot');
  console.log('   2. Check logs: pm2 logs --lines 30');
  
  await sequelize.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
