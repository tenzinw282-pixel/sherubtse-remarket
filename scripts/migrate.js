const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createPool,postgresUrl,databaseFailure } = require('../config/databases');
const {startupError,logFailure,logStage,errorCodes}=require('../config/diagnostics');
require('dotenv').config({ quiet: true });

const LOCK_ID=74623190;
const digest=value=>createHash('sha256').update(value).digest('hex');
function migrationFile(name,sql){
  if(!/^\d+[a-zA-Z0-9_.-]*\.sql$/.test(name))throw startupError('migrations','MIGRATION_FILENAME_INVALID','Migration filenames must start with a numeric dependency-order prefix and end in .sql.');
  const normalized=sql.replace(/\r\n/g,'\n');
  return {name,sql:normalized,checksum:digest(normalized),acceptedChecksums:new Set([digest(sql),digest(normalized),digest(normalized.replace(/\n/g,'\r\n'))])};
}
async function loadMigrations(){
  const directory=path.join(__dirname,'../migrations');
  const names=(await fs.readdir(directory)).filter(name=>/^\d+.*\.sql$/.test(name));
  return Promise.all(names.map(async name=>migrationFile(name,await fs.readFile(path.join(directory,name),'utf8'))));
}
function ordered(files){
  const sorted=[...files].sort((a,b)=>Number.parseInt(a.name,10)-Number.parseInt(b.name,10)||a.name.localeCompare(b.name));
  const ids=new Set();
  if(!sorted.length)throw startupError('migrations','MIGRATION_FILES_MISSING','No migration SQL files are present. Ensure the migrations directory is committed and included in the deployment.');
  for(const file of sorted){const id=Number.parseInt(file.name,10);if(ids.has(id))throw startupError('migrations','MIGRATION_ORDER_DUPLICATE','Multiple migration files share a numeric order prefix. Assign each new migration a unique number.');ids.add(id);}
  return sorted;
}
function migrationFailure(error,phase,name){
  if(error?.publicDiagnostic)return error;
  const codes=errorCodes(error),where=`Migration ${phase}${name?' ('+name+')':''}`;
  // pg/pg-pool sometimes raise these without an error.code (confirmed in their source).
  if(phase==='connect'&&/connection timeout|timeout expired/i.test(error?.message||''))return startupError('migrations','MIGRATION_CONNECT_TIMEOUT',`${where}: the direct PostgreSQL connection timed out. Check DIRECT_DATABASE_URL, Neon endpoint availability, DNS and Render network access. MIGRATION_CONNECT_TIMEOUT_MS controls this wait.`,codes);
  if(/Connection terminated unexpectedly/i.test(error?.message||''))return startupError('migrations','MIGRATION_CONNECTION_LOST',`${where}: PostgreSQL closed the connection unexpectedly. Check the direct endpoint, TLS and network availability; unfinished SQL transactions are not recorded as applied.`,codes);
  const explanations={
    '3D000':['MIGRATION_DATABASE_NOT_FOUND','The configured database does not exist. Check the database name in DATABASE_URL and DIRECT_DATABASE_URL.'],
    '28000':['MIGRATION_AUTHORIZATION_FAILED','Database login is not authorized. Check the migration user and the Neon project/network access policy.'],
    '42501':['MIGRATION_PERMISSION_DENIED','Database permissions are insufficient. The migration user needs schema USAGE/CREATE, ownership or ALTER rights on existing application objects, and SELECT/INSERT on schema_migrations.'],
    '42601':['MIGRATION_SQL_SYNTAX','SQL syntax is invalid. Check the named migration; do not edit already-applied migration files.'],
    '42P01':['MIGRATION_DEPENDENCY_MISSING','A required relation is missing. Check migration history, dependency order and the configured database/schema.'],
    '42P07':['MIGRATION_OBJECT_EXISTS','An object already exists without matching migration history. Inspect the database and history; do not drop tables or reset records.'],
    '42701':['MIGRATION_OBJECT_EXISTS','A column already exists without matching migration history. Inspect history; do not reset the database.'],
    '57014':['MIGRATION_STATEMENT_TIMEOUT','PostgreSQL cancelled a statement after its configured timeout. Inspect lock contention or the named migration before raising MIGRATION_STATEMENT_TIMEOUT_MS.'],
    '55P03':['MIGRATION_LOCK_TIMEOUT','A PostgreSQL object lock could not be acquired in time. Check active database transactions; do not terminate sessions blindly.'],
    '40P01':['MIGRATION_DEADLOCK','PostgreSQL detected a deadlock. The transaction was rolled back; inspect concurrent migrations before retrying.'],
    'ENOENT':['MIGRATION_FILES_MISSING','A required migration file is missing from the deployment.']
  };
  for(const code of codes)if(explanations[code])return startupError('migrations',explanations[code][0],`${where}: ${explanations[code][1]}`,codes);
  const database=databaseFailure('PostgreSQL',error);
  return startupError('migrations',database.code,`${where}: ${database.message}`,database.providerCodes);
}
function recordFailure(error){logFailure('migrations',error,{synchronous:true});error.migrationLogged=true;}
async function migrate(pool,{migrations,lockTimeoutMs=15000,statementTimeoutMs=60000,pollMs=250,schema,lockId=LOCK_ID,onProgress=()=>{}}={}){
  let client,locked=false,inTransaction=false,primary,phase='files',currentFile;
  function progress(next,name,message){phase=next;currentFile=name;onProgress({phase,name});logStage(`migration-${next}`,message);}
  try{
    const files=ordered(migrations||await loadMigrations());
    progress('connect',null,'Opening the migration connection.');
    client=await pool.connect();
    progress('settings',null,'Connected; configuring bounded statement and lock waits.');
    await client.query("SELECT set_config('statement_timeout',$1,false),set_config('lock_timeout',$2,false)",[String(statementTimeoutMs),String(lockTimeoutMs)]);
    if(schema)await client.query("SELECT set_config('search_path',$1,false)",[schema]);
    progress('lock',null,'Acquiring the migration advisory lock.');
    const deadline=Date.now()+lockTimeoutMs;
    while(!(locked=(await client.query('SELECT pg_try_advisory_lock($1) AS acquired',[lockId])).rows[0].acquired)){
      if(Date.now()>=deadline)throw startupError('migrations','MIGRATION_LOCK_TIMEOUT',`Another migration session holds the advisory lock. Waited ${lockTimeoutMs}ms. Inspect migration sessions; no existing database records were changed.`);
      await new Promise(resolve=>setTimeout(resolve,Math.min(pollMs,Math.max(1,deadline-Date.now()))));
    }
    progress('history',null,'Migration lock acquired; checking history and all checksums before applying SQL.');
    const historyExists=(await client.query("SELECT to_regclass('schema_migrations') AS relation")).rows?.[0]?.relation;
    if(!historyExists)await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const history=(await client.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;
    const known=new Map(files.map(file=>[file.name,file]));
    for(const record of history)if(!known.has(record.name))throw startupError('migrations','MIGRATION_SOURCE_MISSING','An applied migration has no matching source file. Restore the original migration files from version control; do not remove history entries.');
    const applied=new Map(history.map(record=>[record.name,record.checksum]));let pending=false;
    for(const file of files){
      if(!applied.has(file.name)){pending=true;continue;}
      if(pending)throw startupError('migrations','MIGRATION_HISTORY_GAP',`Migration history is missing a dependency before ${file.name}. Inspect the configured database and restore its migration history safely.`);
      if(!file.acceptedChecksums.has(applied.get(file.name)))throw startupError('migrations','MIGRATION_CHECKSUM_CHANGED',`Applied migration changed: ${file.name}. Restore its original SQL and add a new numbered migration; existing data and history must not be reset.`);
      logStage('migration-checksum',`Verified ${file.name}; stored history is unchanged.`);
    }
    let count=0;
    for(const file of files){
      if(applied.has(file.name))continue;
      progress('sql',file.name,`Applying ${file.name} in a transaction.`);
      await client.query('BEGIN');inTransaction=true;
      await client.query(file.sql);
      phase='history-record';onProgress({phase,name:file.name});
      await client.query('INSERT INTO schema_migrations(name,checksum) VALUES ($1,$2)',[file.name,file.checksum]);
      phase='commit';onProgress({phase,name:file.name});await client.query('COMMIT');inTransaction=false;count++;
      logStage('migration-applied',`Committed ${file.name}.`);
    }
    logStage('migrations',`Migration verification complete: ${files.length} files checked, ${count} newly applied.`);
  }catch(error){primary=migrationFailure(error,phase,currentFile);recordFailure(primary);}
  finally{
    if(client){
      if(inTransaction)try{await client.query('ROLLBACK');}catch(error){recordFailure(migrationFailure(error,'rollback',currentFile));}
      if(locked)try{await client.query('SELECT pg_advisory_unlock($1)',[lockId]);}catch(error){const cleanup=migrationFailure(error,'unlock',currentFile);recordFailure(cleanup);if(!primary)primary=cleanup;}
      // Destroy errored migration connections so cleanup cannot poison the pool.
      try{client.release(!!primary);}catch(error){const cleanup=migrationFailure(error,'release',currentFile);recordFailure(cleanup);if(!primary)primary=cleanup;}
    }
  }
  if(primary)throw primary;
}
function milliseconds(value,fallback,name){
  const result=value===undefined||value===''?fallback:Number(value);
  if(!Number.isInteger(result)||result<1||result>600000)throw startupError('migrations','MIGRATION_TIMEOUT_INVALID',`${name} must be an integer from 1 to 600000 milliseconds.`);
  return result;
}
function migrationTarget(config){
  const runtime=new URL(postgresUrl(config.DATABASE_URL,{direct:true}));
  const override=config.DIRECT_DATABASE_URL?.trim();
  const target=new URL(postgresUrl(override||config.DATABASE_URL,{direct:true}));
  if(target.pathname!==runtime.pathname || (target.hostname.endsWith('.neon.tech')&&runtime.hostname.endsWith('.neon.tech')&&target.hostname!==runtime.hostname))throw startupError('migrations','MIGRATION_DATABASE_MISMATCH','DIRECT_DATABASE_URL must point to the same Neon endpoint/branch and database as DATABASE_URL. Correct or remove the override in Render Environment; no SQL has been executed.');
  return {connectionString:target.toString(),source:override?'DIRECT_DATABASE_URL':'DATABASE_URL (direct endpoint)',directNeon:target.hostname.endsWith('.neon.tech')&&!target.hostname.includes('-pooler.')};
}
async function runMigrations(config,{poolFactory=createPool,hardTimeoutMs}={}){
  let pool,failure,progress={phase:'configuration'};
  const totalTimeout=hardTimeoutMs??milliseconds(config.MIGRATION_TIMEOUT_MS,90000,'MIGRATION_TIMEOUT_MS');
  const watchdog=setTimeout(()=>{
    recordFailure(startupError('migrations','MIGRATION_TOTAL_TIMEOUT',`Migration startup exceeded ${totalTimeout}ms during ${progress.phase}${progress.name?' ('+progress.name+')':''}. Check the direct connection and database locks; PostgreSQL rolls back unfinished transactions when the process exits.`));
    process.exit(1);
  },totalTimeout);
  try{
    const target=migrationTarget(config);
    logStage('migration-source',`Connection source: ${target.source}; direct Neon: ${target.directNeon}; database identity matches runtime configuration.`);
    pool=poolFactory(target.connectionString,{max:1,connectionTimeoutMillis:milliseconds(config.MIGRATION_CONNECT_TIMEOUT_MS,30000,'MIGRATION_CONNECT_TIMEOUT_MS')});
    await migrate(pool,{schema:'public',lockTimeoutMs:milliseconds(config.MIGRATION_LOCK_TIMEOUT_MS,15000,'MIGRATION_LOCK_TIMEOUT_MS'),statementTimeoutMs:milliseconds(config.MIGRATION_STATEMENT_TIMEOUT_MS,60000,'MIGRATION_STATEMENT_TIMEOUT_MS'),onProgress:state=>{progress=state;}});
  }catch(error){failure=migrationFailure(error,progress.phase,progress.name);if(!failure.migrationLogged)recordFailure(failure);}
  finally{
    progress={phase:'pool-close'};
    if(pool)try{await pool.end();}catch(error){const cleanup=migrationFailure(error,'pool-close');recordFailure(cleanup);if(!failure)failure=cleanup;}
    clearTimeout(watchdog);
  }
  if(failure)throw failure;
}
if (require.main === module) {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exitCode = 1;
  } else {
    runMigrations(process.env).catch(error=>{logFailure('migrations',error);process.exitCode=1;});
  }
}
module.exports = { migrate,runMigrations,migrationFile,migrationTarget,migrationFailure,ordered,loadMigrations };
