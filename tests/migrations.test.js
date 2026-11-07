const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {migrate,runMigrations,migrationFile,migrationTarget}=require('../scripts/migrate');
const sha=value=>createHash('sha256').update(value).digest('hex');
const sql='CREATE TABLE fixture_widget (id integer);\n';
function fixture({history=[],lock=true,sqlError,rollbackFailure=false,unlockFailure=false,connectFailure,historyExists=false}={}){
  const calls=[];let destroyed=false,connected=0;
  const client={query:async(query,params=[])=>{
    calls.push({query,params});
    if(query.startsWith('SELECT pg_try_advisory_lock'))return {rows:[{acquired:lock}]};
    if(query.startsWith('SELECT name,checksum'))return {rows:history.map(row=>({...row}))};
    if(query.startsWith('SELECT to_regclass'))return {rows:[{relation:historyExists?'schema_migrations':null}]};
    if(historyExists&&query.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations'))throw Object.assign(new Error('Unnecessary DDL forbidden'),{code:'42501'});
    if(query.startsWith('CREATE TABLE fixture_')&&sqlError)throw sqlError;
    if(query==='ROLLBACK'&&rollbackFailure)throw Object.assign(new Error('private cleanup response'),{code:'ECONNRESET'});
    if(query.startsWith('SELECT pg_advisory_unlock')&&unlockFailure)throw Object.assign(new Error('private unlock response'),{code:'ECONNRESET'});
    if(query.startsWith('INSERT INTO schema_migrations'))history.push({name:params[0],checksum:params[1]});
    return {rows:[],rowCount:0};
  },release:discard=>{destroyed=discard;}};
  return {calls,history,get destroyed(){return destroyed;},get connected(){return connected;},pool:{connect:async()=>{connected++;if(connectFailure)throw connectFailure;return client;},end:async()=>{}}};
}
test('LF/CRLF variants verify without rewriting applied history or reapplying SQL',async()=>{
  for(const stored of [sha(sql),sha(sql.replace(/\n/g,'\r\n'))]){
    const setup=fixture({history:[{name:'001_fixture.sql',checksum:stored}]});
    const before=JSON.stringify(setup.history);
    await migrate(setup.pool,{migrations:[migrationFile('001_fixture.sql',sql.replace(/\n/g,'\r\n'))]});
    assert.equal(JSON.stringify(setup.history),before);
    assert.ok(!setup.calls.some(call=>call.query==='BEGIN'||call.query.startsWith('INSERT INTO schema_migrations')||call.query.startsWith('UPDATE')));
  }
});
test('substantive SQL checksum mismatch is fatal before any migration transaction',async()=>{
  const setup=fixture({history:[{name:'001_fixture.sql',checksum:sha(sql)}]});
  await assert.rejects(migrate(setup.pool,{migrations:[migrationFile('001_fixture.sql',sql.replace('integer','text'))]}),{code:'MIGRATION_CHECKSUM_CHANGED'});
  assert.ok(!setup.calls.some(call=>call.query==='BEGIN'));assert.equal(setup.history[0].checksum,sha(sql));
});
test('an existing history table is verified without requiring unnecessary CREATE permission',async()=>{
  const setup=fixture({historyExists:true,history:[{name:'001_fixture.sql',checksum:sha(sql)}]});
  await migrate(setup.pool,{migrations:[migrationFile('001_fixture.sql',sql)]});
  assert.ok(!setup.calls.some(call=>call.query.startsWith('CREATE TABLE')||call.query==='BEGIN'));
});
test('new migrations execute in numeric dependency order and record LF checksums atomically',async()=>{
  const setup=fixture();const first='CREATE TABLE fixture_first (id integer);\n',later='CREATE TABLE fixture_later (id integer);\n';
  await migrate(setup.pool,{migrations:[migrationFile('10_later.sql',later),migrationFile('2_first.sql',first.replace(/\n/g,'\r\n'))]});
  assert.deepEqual(setup.history.map(row=>row.name),['2_first.sql','10_later.sql']);assert.equal(setup.history[0].checksum,sha(first));
  assert.equal(setup.calls.filter(call=>call.query==='BEGIN').length,2);assert.equal(setup.calls.filter(call=>call.query==='COMMIT').length,2);
});
test('duplicate order numbers are rejected before opening a database connection',async()=>{
  const setup=fixture();await assert.rejects(migrate(setup.pool,{migrations:[migrationFile('001_a.sql',sql),migrationFile('1_b.sql',sql)]}),{code:'MIGRATION_ORDER_DUPLICATE'});assert.equal(setup.connected,0);
});
test('missing applied source files and history gaps are rejected without resetting history',async()=>{
  const missing=fixture({history:[{name:'000_deleted.sql',checksum:sha(sql)}]});
  await assert.rejects(migrate(missing.pool,{migrations:[migrationFile('001_fixture.sql',sql)]}),{code:'MIGRATION_SOURCE_MISSING'});
  const gap=fixture({history:[{name:'002_fixture.sql',checksum:sha(sql)}]});
  await assert.rejects(migrate(gap.pool,{migrations:[migrationFile('001_fixture.sql',sql),migrationFile('002_fixture.sql',sql)]}),{code:'MIGRATION_HISTORY_GAP'});
  assert.ok(!gap.calls.some(call=>call.query==='BEGIN'));
});
test('migration lock contention has a bounded wait and leaves SQL/history untouched',async()=>{
  const setup=fixture({lock:false});const started=Date.now();
  await assert.rejects(migrate(setup.pool,{migrations:[migrationFile('001_fixture.sql',sql)],lockTimeoutMs:20,pollMs:2}),{code:'MIGRATION_LOCK_TIMEOUT'});
  assert.ok(Date.now()-started<2000);assert.ok(!setup.calls.some(call=>call.query==='BEGIN'));assert.equal(setup.history.length,0);assert.equal(setup.destroyed,true);
});
test('SQL permission failure survives rollback and unlock failures without leaking provider text',async()=>{
  const setup=fixture({sqlError:Object.assign(new Error('private provider secret'),{code:'42501'}),rollbackFailure:true,unlockFailure:true});
  await assert.rejects(migrate(setup.pool,{migrations:[migrationFile('001_fixture.sql',sql)]}),error=>error.code==='MIGRATION_PERMISSION_DENIED'&&error.providerCodes.includes('42501')&&!error.message.includes('private provider secret'));
  assert.equal(setup.history.length,0);assert.equal(setup.destroyed,true);assert.ok(setup.calls.some(call=>call.query==='ROLLBACK'));
});
test('SQL syntax failures identify the migration and SQLSTATE safely',async()=>{
  const setup=fixture({sqlError:Object.assign(new Error('SQL may contain private values'),{code:'42601'})});
  await assert.rejects(migrate(setup.pool,{migrations:[migrationFile('001_fixture.sql',sql)]}),error=>error.code==='MIGRATION_SQL_SYNTAX'&&error.message.includes('001_fixture.sql')&&!error.message.includes('private values'));
});
test('connection failures retain the original safe authentication code',async()=>{
  const setup=fixture({connectFailure:Object.assign(new Error('private auth response'),{code:'28P01'})});
  await assert.rejects(migrate(setup.pool,{migrations:[migrationFile('001_fixture.sql',sql)]}),error=>error.code==='DATABASE_AUTH_FAILED'&&error.providerCodes.includes('28P01'));
});
test('pg connection-timeout messages without error codes are classified without leaking the message',async()=>{
  const setup=fixture({connectFailure:new Error('Connection terminated due to connection timeout; private driver content')});
  await assert.rejects(migrate(setup.pool,{migrations:[migrationFile('001_fixture.sql',sql)]}),error=>error.code==='MIGRATION_CONNECT_TIMEOUT'&&!error.message.includes('private driver content'));
});
test('direct Neon target preserves database identity and rejects a mismatched override before connecting',async()=>{
  const config={DATABASE_URL:'postgresql://fixture:fixture@ep-test-pooler.eu-central-1.aws.neon.tech/application?sslmode=require'};
  const target=migrationTarget(config);assert.equal(new URL(target.connectionString).hostname,'ep-test.eu-central-1.aws.neon.tech');assert.equal(new URL(target.connectionString).searchParams.get('sslmode'),'verify-full');
  let created=false;
  await assert.rejects(runMigrations({...config,DIRECT_DATABASE_URL:'postgresql://fixture:fixture@ep-other.eu-central-1.aws.neon.tech/wrong'},{poolFactory:()=>{created=true;throw new Error();}}),{code:'MIGRATION_DATABASE_MISMATCH'});assert.equal(created,false);
});
test('a stalled migration keeps a watchdog alive and flushes its fatal diagnostic before exit',async()=>{
  const source="require('./scripts/migrate').runMigrations({DATABASE_URL:'postgresql://localhost/fixture'},{hardTimeoutMs:50,poolFactory:()=>({connect:()=>new Promise(()=>{}),end:async()=>{}})}).catch(()=>{});";
  await assert.rejects(promisify(execFile)(process.execPath,['-e',source],{cwd:process.cwd(),timeout:5000}),error=>error.code===1&&error.stderr.includes('MIGRATION_TOTAL_TIMEOUT')&&error.stderr.includes('connect'));
});
test('the primary error is flushed even when pool cleanup never resolves',async()=>{
  const source="require('./scripts/migrate').runMigrations({DATABASE_URL:'postgresql://localhost/fixture'},{hardTimeoutMs:100,poolFactory:()=>({connect:async()=>({query:async sql=>{if(sql.startsWith('SELECT pg_try_advisory_lock'))return {rows:[{acquired:true}]};if(sql.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations'))throw Object.assign(new Error('private provider text'),{code:'42501'});return {rows:[]};},release(){}}),end:()=>new Promise(()=>{})})}).catch(()=>{});";
  await assert.rejects(promisify(execFile)(process.execPath,['-e',source],{cwd:process.cwd(),timeout:5000}),error=>error.code===1&&error.stderr.includes('MIGRATION_PERMISSION_DENIED')&&error.stderr.includes('MIGRATION_TOTAL_TIMEOUT')&&error.stderr.includes('pool-close')&&!error.stderr.includes('private provider text'));
});
test('Render termination during startup is diagnosed before exit',async()=>{
  const source="require('./scripts/migrate').runMigrations=async()=>{setTimeout(()=>process.emit('SIGTERM'),10);return new Promise(()=>{});};require('./server').start();";
  const config={...process.env,NODE_ENV:'production',APP_BASE_URL:'https://sherubtse-remarket.onrender.com',DATABASE_URL:'postgresql://localhost/fixture',MONGODB_URI:'mongodb://localhost/fixture',SESSION_SECRET:'a-fixture-session-secret-at-least-32-characters',SMTP_HOST:'localhost',SMTP_USER:'fixture',SMTP_PASS:'fixture',EMAIL_FROM:'fixture@example.test',CLOUDINARY_CLOUD_NAME:'fixture',CLOUDINARY_API_KEY:'fixture',CLOUDINARY_API_SECRET:'fixture'};
  await assert.rejects(promisify(execFile)(process.execPath,['-e',source],{cwd:process.cwd(),env:config,timeout:5000}),error=>error.code===1&&error.stderr.includes('STARTUP_INTERRUPTED')&&error.stderr.includes('migrations'));
});
