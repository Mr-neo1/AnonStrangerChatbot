const { Sequelize } = require('sequelize');
const fs = require('fs');

const POSTGRES_URI = 'postgresql://postgres:Rk2212%40@localhost:5432/chatbot_production';

async function importData() {
  if (!fs.existsSync('full_data_export.json')) {
    console.error('❌ full_data_export.json not found!');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync('full_data_export.json', 'utf8'));
  const sequelize = new Sequelize(POSTGRES_URI, { logging: false });

  try {
    await sequelize.authenticate();
    console.log('✅ Connected to PostgreSQL');

    for (const [table, rows] of Object.entries(data)) {
      if (!rows || rows.length === 0) {
        console.log(`  ⏭️ ${table}: 0 rows (skipped)`);
        continue;
      }

      let imported = 0;
      let skipped = 0;

      for (const row of rows) {
        try {
          const columns = Object.keys(row);
          const values = Object.values(row);
          
          const colStr = columns.map(c => `"${c}"`).join(', ');
          const valStr = values.map(v => {
            if (v === null) return 'NULL';
            if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
            if (typeof v === 'number') return v;
            if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
            return `'${String(v).replace(/'/g, "''")}'`;
          }).join(', ');

          await sequelize.query(
            `INSERT INTO "${table}" (${colStr}) VALUES (${valStr}) ON CONFLICT DO NOTHING`
          );
          imported++;
        } catch (e) {
          skipped++;
        }
      }

      console.log(`  ✅ ${table}: ${imported} imported, ${skipped} skipped`);
    }

    console.log('\n✅ Import complete!');
    await sequelize.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

importData();
