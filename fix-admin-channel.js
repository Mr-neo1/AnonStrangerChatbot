// Quick fix to update admin_media_channel in database
require('dotenv').config();
const { Sequelize } = require('sequelize');

async function fix() {
  const sequelize = new Sequelize(process.env.POSTGRES_URI, { logging: false });
  
  try {
    await sequelize.query(
      `UPDATE app_config SET value = :value WHERE key = 'admin_media_channel'`,
      { replacements: { value: '-1002355067849' } }
    );
    console.log('✅ Updated admin_media_channel to -1002355067849');
    
    // Verify
    const [rows] = await sequelize.query(
      `SELECT value FROM app_config WHERE key = 'admin_media_channel'`
    );
    console.log('Current value:', rows[0]?.value);
  } catch (e) {
    console.error('Error:', e.message);
  }
  
  await sequelize.close();
}

fix();
