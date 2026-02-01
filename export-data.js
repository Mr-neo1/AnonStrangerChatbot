const { Sequelize } = require('sequelize');
const fs = require('fs');

const POSTGRES_URI = 'postgresql://postgres:Rk2212%40@localhost:5432/chatbot_production';

async function exportData() {
  const sequelize = new Sequelize(POSTGRES_URI, { logging: false });
  
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to PostgreSQL');
    
    // Export all tables
    const tables = ['User', 'Chats', 'Locks', 'VipSubscriptions', 'StarTransactions', 
                    'Referrals', 'AffiliateRewards', 'AffiliateRewardCredits', 'Bans', 
                    'LockCredits', 'app_config'];
    
    const exportData = {};
    
    for (const table of tables) {
      try {
        const [rows] = await sequelize.query(`SELECT * FROM "${table}"`);
        exportData[table] = rows;
        console.log(`  ✅ ${table}: ${rows.length} rows`);
      } catch (e) {
        console.log(`  ⚠️ ${table}: ${e.message}`);
        exportData[table] = [];
      }
    }
    
    fs.writeFileSync('full_data_export.json', JSON.stringify(exportData, null, 2));
    console.log('\n✅ Exported to full_data_export.json');
    
    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

exportData();
