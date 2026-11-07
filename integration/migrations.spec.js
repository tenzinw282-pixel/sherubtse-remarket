require('dotenv').config({quiet:true});
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,randomInt}=require('node:crypto');
const {createPool,postgresUrl}=require('../config/databases');
const {migrate,loadMigrations,migrationFile}=require('../scripts/migrate');
test('real PostgreSQL migration order, history preservation, rollback and concurrent locking',{timeout:90000},async t=>{
  const schema=`remarket_test_${randomUUID().replaceAll('-','')}`,lockId=randomInt(100000000,2000000000);
  const url=new URL(postgresUrl(process.env.TEST_DATABASE_URL||process.env.DATABASE_URL,{direct:true}));
  const owner=createPool(url.toString(),{max:2});url.searchParams.set('options',`-c search_path=${schema}`);
  const first=createPool(url.toString(),{max:1}),second=createPool(url.toString(),{max:1});let created=false;
  const files=await loadMigrations();
  try{
    await owner.query(`CREATE SCHEMA "${schema}"`);created=true;
    let before;
    await t.test('actual migrations apply in dependency order and repeat without altering data or history',async()=>{
      await migrate(first,{lockId});
      assert.equal((await first.query('SELECT current_schema() AS name')).rows[0].name,schema);
      await first.query('INSERT INTO categories(name) VALUES ($1)',['Preserved test record']);
      before=(await first.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
      await migrate(first,{lockId});
      assert.deepEqual((await first.query('SELECT * FROM schema_migrations ORDER BY name')).rows,before);
      assert.equal((await first.query('SELECT count(*)::int AS count FROM categories')).rows[0].count,10);
    });
    await t.test('real SQL syntax failure rolls back and leaves migration history unchanged',async()=>{
      await assert.rejects(migrate(first,{lockId,migrations:[...files,migrationFile('004_failure.sql','CREAT TABLE fixture_invalid (id integer);')]}),{code:'MIGRATION_SQL_SYNTAX'});
      assert.deepEqual((await first.query('SELECT * FROM schema_migrations ORDER BY name')).rows,before);
    });
    await t.test('real advisory lock contention times out without affecting application migration locks',async()=>{
      const holder=await owner.connect();
      try{
        await holder.query('SELECT pg_advisory_lock($1)',[lockId]);
        await assert.rejects(migrate(first,{lockId,lockTimeoutMs:50,pollMs:5}),{code:'MIGRATION_LOCK_TIMEOUT'});
      }finally{await holder.query('SELECT pg_advisory_unlock($1)',[lockId]);holder.release();}
      assert.deepEqual((await first.query('SELECT * FROM schema_migrations ORDER BY name')).rows,before);
    });
    await t.test('PostgreSQL statement timeouts roll back safely and retain their SQLSTATE',async()=>{
      await assert.rejects(migrate(first,{lockId,statementTimeoutMs:30,migrations:[...files,migrationFile('004_timeout.sql','SELECT pg_sleep(0.2);')]}),error=>error.code==='MIGRATION_STATEMENT_TIMEOUT'&&error.providerCodes.includes('57014'));
      assert.deepEqual((await first.query('SELECT * FROM schema_migrations ORDER BY name')).rows,before);
    });
    await t.test('two migrators apply a pending file exactly once, without changing prior history',async()=>{
      const all=[...files,migrationFile('004_probe.sql','CREATE TABLE fixture_probe (id integer PRIMARY KEY); INSERT INTO fixture_probe VALUES (1);')];
      await Promise.all([migrate(first,{lockId,migrations:all}),migrate(second,{lockId,migrations:all})]);
      assert.equal((await first.query('SELECT count(*)::int AS count FROM fixture_probe')).rows[0].count,1);
      assert.equal((await first.query('SELECT count(*)::int AS count FROM schema_migrations')).rows[0].count,4);
      assert.deepEqual((await first.query("SELECT * FROM schema_migrations WHERE name<>'004_probe.sql' ORDER BY name")).rows,before);
      assert.equal((await first.query('SELECT count(*)::int AS count FROM categories')).rows[0].count,10);
    });
  }finally{
    await Promise.all([first.end(),second.end()]);
    try{if(created&&/^remarket_test_[0-9a-f]{32}$/.test(schema))await owner.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await owner.end();}
  }
});
