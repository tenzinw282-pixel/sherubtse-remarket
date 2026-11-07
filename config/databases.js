const { Pool } = require('pg');
const mongoose = require('mongoose');

function databaseFailure(service, error) {
  const codes = [error?.code, ...(error?.errors || []).map(item => item.code)];
  let hint = `Check ${service === 'PostgreSQL' ? 'DATABASE_URL' : 'MONGODB_URI'}, database availability, TLS and network access.`;
  if (codes.includes('28P01') || error?.code === 18) hint = 'Database authentication failed. Check the database username and password in .env.';
  else if (codes.some(code => ['EACCES', 'EPERM'].includes(code))) hint = 'Network access was denied. Allow this Node.js process through the sandbox or firewall.';
  else if (codes.includes('ENOTFOUND')) hint = 'Database hostname could not be resolved. Check the connection hostname and DNS access.';
  else if (codes.some(code => ['ECONNREFUSED', 'ETIMEDOUT'].includes(code))) hint = 'Database connection was refused or timed out. Check availability, network access and the database allowlist.';
  const failure = new Error(`${service}: ${hint}`);
  failure.name = 'DatabaseStartupError';
  return failure;
}

function createPool(connectionString) {
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000, options: '-c timezone=UTC' });
  pool.on('error', () => console.error('PostgreSQL pool connection error'));
  return pool;
}
async function connectDatabases(config) {
  const pool = createPool(config.DATABASE_URL);
  let service = 'PostgreSQL';
  try {
    await pool.query('SELECT 1');
    const schema = await pool.query(`SELECT to_regclass('public.sessions') IS NOT NULL AS sessions,
      to_regclass('public.email_verifications') IS NOT NULL AS verification`);
    if (!schema.rows[0].sessions || !schema.rows[0].verification) {
      const error = new Error('PostgreSQL schema is missing. Run npm.cmd run migrate, then restart the server.');
      error.name = 'DatabaseStartupError';
      throw error;
    }
    service = 'MongoDB';
    await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
    return { pool, mongoose, close: async () => {
      await Promise.allSettled([pool.end(), mongoose.disconnect()]);
    } };
  } catch (error) {
    await Promise.allSettled([pool.end(), mongoose.disconnect()]);
    throw error.name === 'DatabaseStartupError' ? error : databaseFailure(service, error);
  }
}
module.exports = { createPool, connectDatabases, databaseFailure };
