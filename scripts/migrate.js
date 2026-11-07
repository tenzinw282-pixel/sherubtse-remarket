const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createPool } = require('../config/databases');
require('dotenv').config({ quiet: true });

async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(74623190)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const directory = path.join(__dirname, '../migrations');
    const files = (await fs.readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort();
    for (const name of files) {
      const sql = await fs.readFile(path.join(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prior = await client.query('SELECT checksum FROM schema_migrations WHERE name = $1', [name]);
      if (prior.rowCount) {
        if (prior.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
        console.log(`Applied ${name}`);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(74623190)'); }
    finally { client.release(); }
  }
}
if (require.main === module) {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exitCode = 1;
  } else {
    const pool = createPool(process.env.DATABASE_URL);
    migrate(pool).catch(error => { console.error('Migration failed:', error.message); process.exitCode = 1; })
      .finally(() => pool.end());
  }
}
module.exports = { migrate };
