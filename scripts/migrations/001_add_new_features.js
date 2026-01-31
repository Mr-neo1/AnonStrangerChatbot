/**
 * Migration: Add new features tables
 * - ChatRating table for user ratings
 * - AdminAuditLog table for audit logs
 * - AnalyticsStats table for aggregated stats
 * - ScheduledMaintenance table for maintenance windows
 * - AdminLoginToken table for Telegram login
 * - User model updates (vipAgeMin, vipAgeMax)
 */

const { sequelize } = require('../../database/connectionPool');
const { QueryTypes, DataTypes } = require('sequelize');

async function up() {
  const queryInterface = sequelize.getQueryInterface();

  console.log('🔄 Running migration: 001_add_new_features');

  // First, sync all models to ensure base tables exist
  console.log('📦 Ensuring base tables exist...');
  try {
    // Import all models to register them with sequelize
    require('../../models');
    // Sync without force (won't drop existing tables)
    await sequelize.sync({ alter: false });
    console.log('✅ Base tables verified/created');
  } catch (syncErr) {
    console.log('⚠️ Sync warning (may be normal):', syncErr.message);
  }

  // Check if Users table exists before trying to add columns
  const tableExists = async (tableName) => {
    try {
      const [results] = await sequelize.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '${tableName}');`
      );
      return results[0].exists;
    } catch (e) {
      return false;
    }
  };

  // Add vipAgeMin and vipAgeMax to Users table (if table exists)
  if (await tableExists('Users')) {
    try {
      await queryInterface.addColumn('Users', 'vipAgeMin', {
        type: DataTypes.INTEGER,
        allowNull: true
      });
      console.log('✅ Added vipAgeMin column to Users');
    } catch (e) {
      if (e.message.includes('already exists') || e.message.includes('duplicate column')) {
        console.log('⏭️ vipAgeMin already exists');
      } else {
        console.log('⚠️ vipAgeMin error:', e.message);
      }
    }

    try {
      await queryInterface.addColumn('Users', 'vipAgeMax', {
        type: DataTypes.INTEGER,
        allowNull: true
      });
      console.log('✅ Added vipAgeMax column to Users');
    } catch (e) {
      if (e.message.includes('already exists') || e.message.includes('duplicate column')) {
        console.log('⏭️ vipAgeMax already exists');
      } else {
        console.log('⚠️ vipAgeMax error:', e.message);
      }
    }
  } else {
    console.log('⚠️ Users table not found - columns will be created with model sync');
  }

  // Create ChatRatings table
  try {
    await queryInterface.createTable('ChatRatings', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      raterId: {
        type: DataTypes.BIGINT,
        allowNull: false
      },
      ratedUserId: {
        type: DataTypes.BIGINT,
        allowNull: false
      },
      ratingType: {
        type: DataTypes.STRING(20),
        defaultValue: 'skipped'
      },
      reportReason: {
        type: DataTypes.STRING(30),
        defaultValue: 'none'
      },
      reviewed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      reviewedBy: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      },
      updatedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      }
    });
    console.log('✅ Created ChatRatings table');
  } catch (e) {
    if (e.message.includes('already exists') || e.message.includes('already exist')) {
      console.log('⏭️ ChatRatings table already exists');
    } else {
      console.log('⚠️ ChatRatings error:', e.message);
    }
  }

  // Create AdminAuditLogs table
  try {
    await queryInterface.createTable('AdminAuditLogs', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      adminId: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      category: {
        type: DataTypes.STRING(50),
        allowNull: false
      },
      action: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      targetType: {
        type: DataTypes.STRING(50),
        allowNull: true
      },
      targetId: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      previousValue: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      newValue: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      details: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      ipAddress: {
        type: DataTypes.STRING(45),
        allowNull: true
      },
      createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      }
    });
    console.log('✅ Created AdminAuditLogs table');
  } catch (e) {
    if (e.message.includes('already exists') || e.message.includes('already exist')) {
      console.log('⏭️ AdminAuditLogs table already exists');
    } else {
      console.log('⚠️ AdminAuditLogs error:', e.message);
    }
  }

  // Create AnalyticsStats table
  try {
    await queryInterface.createTable('AnalyticsStats', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        unique: true
      },
      newUsers: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      activeUsers: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      totalChats: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      vipRevenue: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      lockRevenue: {
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
      reports: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      bans: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      },
      updatedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      }
    });
    console.log('✅ Created AnalyticsStats table');
  } catch (e) {
    if (e.message.includes('already exists') || e.message.includes('already exist')) {
      console.log('⏭️ AnalyticsStats table already exists');
    } else {
      console.log('⚠️ AnalyticsStats error:', e.message);
    }
  }

  // Create ScheduledMaintenances table
  try {
    await queryInterface.createTable('ScheduledMaintenances', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false
      },
      startTime: {
        type: DataTypes.DATE,
        allowNull: false
      },
      endTime: {
        type: DataTypes.DATE,
        allowNull: false
      },
      notifyUsers: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
      },
      status: {
        type: DataTypes.STRING(20),
        defaultValue: 'scheduled'
      },
      createdBy: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      },
      updatedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      }
    });
    console.log('✅ Created ScheduledMaintenances table');
  } catch (e) {
    if (e.message.includes('already exists') || e.message.includes('already exist')) {
      console.log('⏭️ ScheduledMaintenances table already exists');
    } else {
      console.log('⚠️ ScheduledMaintenances error:', e.message);
    }
  }

  // Create AdminLoginTokens table
  try {
    await queryInterface.createTable('AdminLoginTokens', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      token: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true
      },
      telegramId: {
        type: DataTypes.BIGINT,
        allowNull: true
      },
      status: {
        type: DataTypes.STRING(20),
        defaultValue: 'pending'
      },
      sessionToken: {
        type: DataTypes.STRING(64),
        allowNull: true
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      },
      updatedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      }
    });
    console.log('✅ Created AdminLoginTokens table');
  } catch (e) {
    if (e.message.includes('already exists') || e.message.includes('already exist')) {
      console.log('⏭️ AdminLoginTokens table already exists');
    } else {
      console.log('⚠️ AdminLoginTokens error:', e.message);
    }
  }

  // Add indexes (with individual try-catch for each)
  const addIndex = async (table, columns, name) => {
    try {
      await queryInterface.addIndex(table, columns, { name });
      console.log(`✅ Added index: ${name}`);
    } catch (e) {
      // Ignore if exists
    }
  };

  await addIndex('ChatRatings', ['raterId'], 'idx_chatratings_rater');
  await addIndex('ChatRatings', ['ratedUserId'], 'idx_chatratings_rated');
  await addIndex('ChatRatings', ['createdAt'], 'idx_chatratings_created');
  await addIndex('AdminAuditLogs', ['adminId'], 'idx_auditlogs_admin');
  await addIndex('AdminAuditLogs', ['category'], 'idx_auditlogs_category');
  await addIndex('AdminAuditLogs', ['createdAt'], 'idx_auditlogs_created');

  console.log('✅ Migration 001_add_new_features completed');
}

async function down() {
  const queryInterface = sequelize.getQueryInterface();

  console.log('🔄 Rolling back migration: 001_add_new_features');

  // Remove columns from Users
  try {
    await queryInterface.removeColumn('Users', 'vipAgeMin');
    await queryInterface.removeColumn('Users', 'vipAgeMax');
  } catch (e) {
    console.log('⚠️ Could not remove columns from Users');
  }

  // Drop tables
  try {
    await queryInterface.dropTable('ChatRatings');
    await queryInterface.dropTable('AdminAuditLogs');
    await queryInterface.dropTable('AnalyticsStats');
    await queryInterface.dropTable('ScheduledMaintenances');
    await queryInterface.dropTable('AdminLoginTokens');
  } catch (e) {
    console.log('⚠️ Some tables could not be dropped');
  }

  console.log('✅ Rollback completed');
}

// Run if executed directly
if (require.main === module) {
  const action = process.argv[2] || 'up';
  
  (async () => {
    try {
      await sequelize.authenticate();
      if (action === 'down') {
        await down();
      } else {
        await up();
      }
      process.exit(0);
    } catch (error) {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    }
  })();
}

module.exports = { up, down };
