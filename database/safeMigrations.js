// REMOVED: safe migrations disabled to enforce ZERO runtime schema changes.
// This file previously executed PRAGMA and created an additive `bots` table on startup.
// To guarantee no schema changes on startup, `runSafeMigrations` is now a no-op.

module.exports.runSafeMigrations = async function (sequelize) {
  console.warn('Safe migrations are disabled by configuration: no runtime DDL will be executed.');
  return;
};
