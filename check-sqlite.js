const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Check both SQLite databases
const dbFiles = ['chatbot.db', 'chatbot.db.bak'];

dbFiles.forEach(dbFile => {
  const dbPath = path.join(__dirname, dbFile);
  console.log(`\n=== Checking ${dbFile} ===`);
  
  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
      console.log(`Cannot open ${dbFile}:`, err.message);
      return;
    }
    
    // Get all tables
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
      if (err) {
        console.log('Error getting tables:', err.message);
        db.close();
        return;
      }
      
      console.log('Tables found:', tables.map(t => t.name).join(', '));
      
      // Try to count users from various possible table names
      const possibleTables = ['users', 'Users', 'User', 'user'];
      
      possibleTables.forEach(tableName => {
        db.get(`SELECT COUNT(*) as count FROM ${tableName}`, (err, row) => {
          if (!err && row) {
            console.log(`Found ${row.count} users in table "${tableName}"`);
            
            // Show sample users
            db.all(`SELECT * FROM ${tableName} LIMIT 5`, (err, users) => {
              if (!err && users.length > 0) {
                console.log('Sample users:');
                users.forEach((u, i) => {
                  console.log(`  ${i+1}. ${JSON.stringify(u)}`);
                });
              }
            });
          }
        });
      });
    });
  });
});

// Keep process alive for async callbacks
setTimeout(() => process.exit(0), 3000);
