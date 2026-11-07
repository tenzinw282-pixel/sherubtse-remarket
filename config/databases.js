const { Pool } = require('pg');
const mongoose = require('mongoose');

function createPool(connectionString) {
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000, options: '-c timezone=UTC' });
  pool.on('error', () => console.error('PostgreSQL pool connection error'));
  return pool;
}
async function connectDatabases(config) {
  const pool = createPool(config.DATABASE_URL);
  try {
    await pool.query('SELECT 1');
    await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
    return { pool, mongoose, close: async () => {
      await Promise.allSettled([pool.end(), mongoose.disconnect()]);
    } };
  } catch (error) {
    await Promise.allSettled([pool.end(), mongoose.disconnect()]);
    throw error;
  }
}
module.exports = { createPool, connectDatabases };
