// Explicit opt-in integration check. Requires an isolated, disposable test database.
const assert = require('node:assert/strict');
const { createPool } = require('../config/databases');
const { migrate } = require('./migrate');
require('dotenv').config({ quiet: true });
async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL to a separate disposable PostgreSQL database');
  const target = new URL(url);
  if (!/test/i.test(target.pathname)) throw new Error('Test database name must contain "test"');
  if (process.env.DATABASE_URL) {
    const app = new URL(process.env.DATABASE_URL);
    if (app.hostname === target.hostname && app.pathname === target.pathname) {
      throw new Error('Test database must differ from application database');
    }
  }
  const pool = createPool(url);
  try {
    await migrate(pool);
    await migrate(pool);
    const categories = await pool.query('SELECT count(*)::integer AS count FROM categories');
    assert.equal(categories.rows[0].count, 9);
    const tables = await pool.query("SELECT to_regclass('transactions') AS name");
    assert.equal(tables.rows[0].name, 'transactions');
    console.log('Database migration and repeat-run checks passed');
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
