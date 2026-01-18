#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

(async function main() {
  try {
    const config = require('../config/config');
    const dbPath = config.SQLITE_DB_PATH || process.env.SQLITE_DB_PATH || path.join(process.cwd(), 'chatbot.db');

    if (!fs.existsSync(dbPath)) {
      console.error(`Database file not found at ${dbPath}. Aborting.`);
      process.exit(2);
    }

    const sqlFile = path.join(__dirname, 'init_schema.sql');
    if (!fs.existsSync(sqlFile)) {
      console.error('init_schema.sql not found at', sqlFile);
      process.exit(2);
    }

    const sql = fs.readFileSync(sqlFile, 'utf8');

    // Extract CREATE TABLE statements keyed by table name
    const createStmts = new Map();
    const re = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s*\(([\s\S]*?)\);/ig;
    let m;
    while ((m = re.exec(sql)) !== null) {
      const table = m[1];
      const stmt = `CREATE TABLE IF NOT EXISTS ${table} (${m[2]});`;
      createStmts.set(table, stmt);
    }

    if (createStmts.size === 0) {
      console.error('No CREATE TABLE statements found in init_schema.sql');
      process.exit(2);
    }

    const db = new sqlite3.Database(dbPath);

    const checkTable = (table) => new Promise((resolve, reject) => {
      db.get('SELECT name FROM sqlite_master WHERE type = "table" AND name = ?', [table], (err, row) => {
        if (err) return reject(err);
        resolve(Boolean(row));
      });
    });

    const runStmt = (stmt) => new Promise((resolve, reject) => {
      db.exec(stmt, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    console.log('Initializing schema on DB:', dbPath);

    for (const [table, stmt] of createStmts) {
      const exists = await checkTable(table);
      if (exists) {
        console.log(`- Table already exists: ${table}`);
        continue;
      }
      console.log(`- Creating table: ${table}`);
      await runStmt(stmt);
      console.log(`  ✅ Created ${table}`);
    }

    // Run index statements (execute remaining SQL beyond create table blocks)
    // We will execute any remaining statements in the SQL file that are not CREATE TABLE
    const remainingSql = sql.replace(/CREATE\s+TABLE[\s\S]*?\);/ig, '').trim();
    if (remainingSql) {
      console.log('Executing additional statements (indexes, etc.)');
      await runStmt(remainingSql);
      console.log('  ✅ Additional statements executed');
    }

    console.log('Schema initialization complete.');
    db.close(() => process.exit(0));
  } catch (err) {
    console.error('Schema initialization failed:', err);
    process.exit(1);
  }
})();
