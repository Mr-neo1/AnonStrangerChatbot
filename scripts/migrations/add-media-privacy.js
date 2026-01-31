#!/usr/bin/env node
/**
 * Migration: Add allowMedia column to User table
 * Adds media privacy control feature
 */
const { DataTypes } = require('sequelize');
const config = require('../../config/config');
const { sequelize } = require('../../database/connectionPool');

async function addMediaPrivacyColumn() {
  if (!config.POSTGRES_URI) {
    console.error('❌ This migration is for PostgreSQL only.');
    process.exit(2);
  }

  try {
    await sequelize.authenticate();
    console.log('✅ Connected to PostgreSQL');

    const qi = sequelize.getQueryInterface();
    
    // Check if column already exists
    const tableDescription = await qi.describeTable('User');
    
    if (tableDescription.allowMedia) {
      console.log('✅ Column allowMedia already exists - skipping');
      process.exit(0);
    }
    
    // Add the column
    console.log('Adding allowMedia column to User table...');
    await qi.addColumn('User', 'allowMedia', {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false
    });
    
    console.log('✅ Migration complete: allowMedia column added');
    console.log('   Default value: true (media enabled for all existing users)');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

addMediaPrivacyColumn();
