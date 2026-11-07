// Read-only migration audit, except a nonblocking lock probe immediately released.
require('dotenv').config({quiet:true});
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {createPool,postgresUrl,databaseFailure}=require('../config/databases');
const {logFailure,startupError}=require('../config/diagnostics');
const hash=value=>createHash('sha256').update(value).digest('hex');
async function diagnose(config=process.env){
  const runtime=new URL(postgresUrl(config.DATABASE_URL));
  const direct=new URL(postgresUrl(config.DIRECT_DATABASE_URL?.trim()||config.DATABASE_URL,{direct:true}));
  const runtimeIdentity=new URL(postgresUrl(config.DATABASE_URL,{direct:true}));
  console.log(JSON.stringify({stage:'migration-audit',directOverrideConfigured:!!config.DIRECT_DATABASE_URL?.trim(),runtimeUsesNeonPooler:runtime.hostname.includes('-pooler.'),migrationUsesNeonPooler:direct.hostname.includes('-pooler.'),sameEndpointAndDatabase:direct.hostname===runtimeIdentity.hostname&&direct.port===runtimeIdentity.port&&direct.pathname===runtimeIdentity.pathname,sameUser:direct.username===runtimeIdentity.username}));
  const pool=createPool(direct.toString());let client,locked=false;
  try{
    client=await pool.connect();
    const info=(await client.query(`SELECT current_database() AS database,
      current_setting('search_path') AS search_path,
      has_schema_privilege(current_user,'public','USAGE') AS can_use_schema,
      has_schema_privilege(current_user,'public','CREATE') AS can_create_schema_objects,
      to_regclass('public.schema_migrations') IS NOT NULL AS history_exists`)).rows[0];
    console.log(JSON.stringify({stage:'migration-audit',...info,tlsAuthorized:client.connection.stream.authorized===true}));
    if(info.history_exists){
      const permissions=(await client.query("SELECT has_table_privilege(current_user,'public.schema_migrations','SELECT') AS can_read,has_table_privilege(current_user,'public.schema_migrations','INSERT') AS can_record" )).rows[0];
      console.log(JSON.stringify({stage:'migration-history-permissions',...permissions}));
      const applied=(await client.query('SELECT name,checksum FROM public.schema_migrations ORDER BY name')).rows;
      for(const record of applied){
        if(!/^\d+[a-zA-Z0-9_.-]*\.sql$/.test(record.name)){console.log(JSON.stringify({stage:'migration-checksum',status:'INVALID_HISTORY_FILENAME'}));continue;}
        let source;
        try{source=await fs.readFile(path.join(__dirname,'../migrations',record.name),'utf8');}
        catch(error){if(error.code==='ENOENT'){console.log(JSON.stringify({stage:'migration-checksum',migration:record.name,status:'MISSING_SOURCE'}));continue;}throw error;}
        const lf=source.replace(/\r\n/g,'\n');
        let gitMatches=null;
        try{gitMatches=hash(execFileSync('git',['show',`HEAD:migrations/${record.name}`],{cwd:path.join(__dirname,'..'),encoding:'utf8',stdio:['ignore','pipe','ignore']}))===record.checksum;}catch{}
        console.log(JSON.stringify({stage:'migration-checksum',migration:record.name,exactMatch:hash(source)===record.checksum,gitMatch:gitMatches,lfMatch:hash(lf)===record.checksum,crlfMatch:hash(lf.replace(/\n/g,'\r\n'))===record.checksum}));
      }
    }
    locked=(await client.query('SELECT pg_try_advisory_lock(74623190) AS acquired')).rows[0].acquired;
    console.log(JSON.stringify({stage:'migration-lock-audit',lockImmediatelyAvailable:locked}));
  }catch(error){
    const failure=databaseFailure('PostgreSQL',error);
    logFailure('migration-audit',failure,{synchronous:true});failure.migrationAuditLogged=true;throw failure;
  }finally{
    if(client){try{if(locked)await client.query('SELECT pg_advisory_unlock(74623190)');}finally{client.release();}}
    await pool.end();
  }
}
if(require.main===module){
  const deadline=setTimeout(()=>{logFailure('migration-audit',startupError('migration-audit','MIGRATION_AUDIT_TIMEOUT','Migration audit exceeded 45 seconds. Check its last connection/lock diagnostic; no migration SQL was executed.'),{synchronous:true});process.exit(1);},45000);
  diagnose().catch(error=>{if(!error.migrationAuditLogged)logFailure('migration-audit',databaseFailure('PostgreSQL',error),{synchronous:true});process.exitCode=1;}).finally(()=>clearTimeout(deadline));
}
module.exports={diagnose};
