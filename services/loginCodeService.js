const { sequelize } = require('../database/connectionPool');

const TABLE = 'admin_login_codes';

async function ensureTable() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      code TEXT PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      confirmed BOOLEAN DEFAULT FALSE,
      token TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function createCode(telegramId, code, ttlMs = 5 * 60 * 1000) {
  await ensureTable();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await sequelize.query(
    `INSERT INTO ${TABLE} (code, telegram_id, expires_at, confirmed, token)
     VALUES (:code, :telegramId, :expiresAt, FALSE, NULL)
     ON CONFLICT(code) DO UPDATE SET telegram_id = :telegramId, expires_at = :expiresAt, confirmed = FALSE, token = NULL;`,
    { replacements: { code, telegramId: String(telegramId), expiresAt } }
  );
}

async function getCode(code) {
  await ensureTable();
  const [rows] = await sequelize.query(
    `SELECT code, telegram_id AS "telegramId", expires_at AS "expiresAt", confirmed, token
     FROM ${TABLE}
     WHERE code = :code
     LIMIT 1;`,
    { replacements: { code } }
  );
  return rows[0] || null;
}

async function confirmCode(code, telegramId, token) {
  await ensureTable();
  await sequelize.query(
    `UPDATE ${TABLE}
     SET confirmed = TRUE, token = :token
     WHERE code = :code AND telegram_id = :telegramId;`,
    { replacements: { code, telegramId: String(telegramId), token } }
  );
}

async function deleteCode(code) {
  await ensureTable();
  await sequelize.query(`DELETE FROM ${TABLE} WHERE code = :code;`, { replacements: { code } });
}

async function cleanupExpired() {
  await ensureTable();
  await sequelize.query(`DELETE FROM ${TABLE} WHERE expires_at < CURRENT_TIMESTAMP;`);
}

module.exports = {
  createCode,
  getCode,
  confirmCode,
  deleteCode,
  cleanupExpired,
};
