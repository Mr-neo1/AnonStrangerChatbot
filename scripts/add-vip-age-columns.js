/**
 * Add vipAgeMin and vipAgeMax columns to User table
 */

const { sequelize } = require('../database/connectionPool');

async function addColumns() {
  try {
    console.log('Adding vipAgeMin and vipAgeMax columns to User table...');
    
    await sequelize.query(`
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "vipAgeMin" INTEGER DEFAULT NULL;
    `);
    console.log('✓ Added vipAgeMin column');
    
    await sequelize.query(`
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "vipAgeMax" INTEGER DEFAULT NULL;
    `);
    console.log('✓ Added vipAgeMax column');
    
    console.log('\n✅ Migration completed successfully!');
  } catch (error) {
    console.error('Migration error:', error.message);
  } finally {
    await sequelize.close();
    process.exit(0);
  }
}

addColumns();
