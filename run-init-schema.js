#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

(async function main() {
  try {
    // Resolve DB path
    const dbPath = process.env.SQLITE_DB_PATH || path.join(process.cwd(), 'chatbot.db');

    if (!fs.existsSync(dbPath)) {
      console.error(`Database file not found at ${dbPath}. Aborting.`);
      process.exit(2);
    }

    const sqlFile = path.join(process.cwd(), 'init_schema.sql');
    if (!fs.existsSync(sqlFile)) {
      console.error('init_schema.sql not found in project root. Aborting.');
      process.exit(2);
    }

    const sql = fs.readFileSync(sqlFile, 'utf8');

    // Find CREATE TABLE IF NOT EXISTS blocks and execute them individually
    const createRe = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s*\(([\s\S]*?)\);/ig;
    let m;

    const db = new sqlite3.Database(dbPath);

    const tableExists = (table) => new Promise((resolve, reject) => {
      db.get('SELECT name FROM sqlite_master WHERE type = "table" AND name = ?', [table], (err, row) => {
        if (err) return reject(err);
        resolve(Boolean(row));
      });
    });

    const execStmt = (stmt) => new Promise((resolve, reject) => {
      db.exec(stmt, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Execute create table blocks
    while ((m = createRe.exec(sql)) !== null) {
      const table = m[1];
      const stmt = `CREATE TABLE IF NOT EXISTS ${table} (${m[2]});`;
      const exists = await tableExists(table);
      if (exists) {
        console.log(`Table already exists: ${table}`);
        continue;
      }
      await execStmt(stmt);
      console.log(`Created table ${table}`);
    }

    // Execute remaining SQL (indexes etc.) safely
    const remaining = sql.replace(/CREATE\s+TABLE[\s\S]*?\);/ig, '').trim();
    if (remaining) {
      await execStmt(remaining);
      // Note: individual index creation messages are optional; we just confirm execution
      console.log('Executed additional SQL statements (indexes, etc.)');
    }

    console.log('Schema initialization complete.');
    db.close(() => process.exit(0));
  } catch (err) {
    console.error('Schema initialization failed:', err);
    process.exit(1);
  }
})();
