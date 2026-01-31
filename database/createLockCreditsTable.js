/**
 * Create LockCredits table if it doesn't exist
 * This fixes the "no such table: LockCredits" error
 */

const { sequelize } = require('./connectionPool');
const { DataTypes } = require('sequelize');

async function createLockCreditsTable() {
  try {
    const queryInterface = sequelize.getQueryInterface();
    const tableName = 'LockCredits';
    
    // Check if table exists
    const tableExists = await queryInterface.showAllTables().then(tables => 
      tables.includes(tableName)
    );
    
    if (tableExists) {
      console.log('✅ LockCredits table already exists');
      return;
    }
    
    // Create table with correct schema matching the model
    await queryInterface.createTable(tableName, {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      telegramId: {
        type: DataTypes.BIGINT,
        allowNull: false
      },
      minutes: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      consumed: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize.literal('CURRENT_TIMESTAMP')
      }
    });
    
    // Create index
    await queryInterface.addIndex(tableName, ['telegramId'], {
      name: 'idx_lockcredits_telegramId'
    });
    
    console.log('✅ LockCredits table created successfully');
  } catch (error) {
    console.error('❌ Error creating LockCredits table:', error);
    throw error;
  }
}

module.exports = { createLockCreditsTable };

// Auto-run if called directly
if (require.main === module) {
  createLockCreditsTable()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
