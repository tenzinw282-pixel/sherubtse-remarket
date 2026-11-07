const { Pool } = require('pg');
const mongoose = require('mongoose');
const {startupError,errorCodes,logFailure}=require('./diagnostics');

function databaseFailure(service, error) {
  if(error?.publicDiagnostic)return error;
  const codes = errorCodes(error);
  let code='DATABASE_CONNECTION_FAILED';
  let hint = `Check ${service === 'PostgreSQL' ? 'DATABASE_URL' : 'MONGODB_URI'}, database availability, TLS and network access.`;
  if (codes.includes('28P01') || codes.includes('18') || (codes.includes('8000')&&/auth/i.test(error?.message||''))) {code='DATABASE_AUTH_FAILED';hint = 'Database authentication failed. Check DATABASE_URL or MONGODB_URI in Render Environment, including the correct database user and URL-encoded password.';}
  else if (codes.some(code => ['EACCES', 'EPERM'].includes(code))) hint = 'Network access was denied. Allow this Node.js process through the sandbox or firewall.';
  else if (codes.includes('ENOTFOUND')) hint = 'Database hostname could not be resolved. Check the connection hostname and DNS access.';
  else if(codes.some(code=>/CERT|TLS|SSL/.test(code))){code='DATABASE_TLS_FAILED';hint='TLS certificate or hostname validation failed. Check the database hostname, current CA trust and connection string; verification must remain enabled.';}
  else if (codes.some(code => ['ECONNREFUSED', 'ETIMEDOUT','ETIMEOUT'].includes(code))||error?.name==='MongooseServerSelectionError') {code='DATABASE_UNREACHABLE';hint = 'Database connection was refused or timed out. Check database availability, outbound network access and the Atlas/Neon network allowlist for Render.';}
  else if(codes.includes('08P01')){code='DATABASE_POOLER_OPTIONS';hint='The database rejected startup options. Use the direct Neon endpoint for migration/session-level operations.';}
  const failure = startupError(service==='MongoDB'?'mongodb':'postgresql',code,`${service}: ${hint}`,codes);
  failure.name = 'DatabaseStartupError';
  return failure;
}

function postgresUrl(connectionString,{direct=false}={}) {
  let url;
  try{url=new URL(connectionString);if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error();}
  catch{throw startupError('configuration','CONFIG_DATABASE_URL','Invalid PostgreSQL connection string. Check DATABASE_URL or DIRECT_DATABASE_URL; values are not logged.');}
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  // Remote databases always validate their certificate chain AND hostname.
  if(!local||['require','prefer','verify-ca','verify-full'].includes(url.searchParams.get('sslmode'))){
    url.searchParams.set('sslmode','verify-full');
    url.searchParams.delete('uselibpqcompat');
  }
  if(direct&&url.hostname.endsWith('.neon.tech'))url.hostname=url.hostname.replace('-pooler.','.');
  return url.toString();
}
function createPool(connectionString,{max=10,connectionTimeoutMillis=15000}={}) {
  const pool = new Pool({ connectionString:postgresUrl(connectionString), max, connectionTimeoutMillis,
    idleTimeoutMillis: 30000, options: '-c timezone=UTC' });
  pool.on('error', error => logFailure('postgresql-pool',databaseFailure('PostgreSQL',error)));
  return pool;
}
const requiredTables=['users','email_verifications','password_resets','sessions','products','product_images','categories','auctions','bids','transactions','favorites','reviews','reports','admin_actions','outbox','announcements','schema_migrations'];
async function verifySchema(pool){
  const result=await pool.query("SELECT name,to_regclass(format('public.%I',name)) AS relation FROM unnest($1::text[]) AS expected(name)",[requiredTables]);
  const missing=result.rows.filter(row=>!row.relation).map(row=>row.name);
  const columns=(await pool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[])",[['users','products','categories','email_verifications']])).rows;
  for(const [table,column] of [['users','bio'],['users','avatar_url'],['products','moderation_status'],['products','featured'],['categories','active'],['email_verifications','delivered_at']])if(!columns.some(row=>row.table_name===table&&row.column_name===column))missing.push(`${table}.${column}`);
  if(missing.length)throw startupError('schema','DATABASE_SCHEMA_MISSING',`Required schema is missing: ${missing.join(', ')}. Run npm run migrate against this DATABASE_URL. Startup migrations must complete before serving requests.`);
}
async function connectDatabases(config) {
  const pool = createPool(config.DATABASE_URL);
  let service = 'PostgreSQL';
  try {
    await pool.query('SELECT 1');
    await verifySchema(pool);
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
module.exports = { createPool, connectDatabases, databaseFailure, postgresUrl, verifySchema, requiredTables };
