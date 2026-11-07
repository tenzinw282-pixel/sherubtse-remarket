const {test}=require('node:test');
const assert=require('node:assert/strict');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const request=require('supertest');
const session=require('express-session');
const {Client}=require('pg');
const {readConfig}=require('../config/env');
const {postgresUrl,databaseFailure,verifySchema,requiredTables}=require('../config/databases');
const {logFailure}=require('../config/diagnostics');
const {createApp}=require('../app');
const {findingsFor}=require('../scripts/check-secrets');
function env(overrides={}){return {NODE_ENV:'production',PORT:'10000',APP_BASE_URL:'https://sherubtse-remarket.onrender.com',DATABASE_URL:'postgresql://fixture:fixture@ep-fixture-pooler.eu-central-1.aws.neon.tech/fixture?sslmode=require',MONGODB_URI:'mongodb+srv://fixture:fixture@fixture.mongodb.net/fixture',SESSION_SECRET:'a-fixture-session-secret-of-at-least-32-characters',SMTP_HOST:'smtp.gmail.com',SMTP_PORT:'587',SMTP_USER:'fixture@example.test',SMTP_PASS:'fixture-not-a-real-password',EMAIL_FROM:'Fixture <fixture@example.test>',CLOUDINARY_CLOUD_NAME:'fixture',CLOUDINARY_API_KEY:'fixture',CLOUDINARY_API_SECRET:'fixture-not-a-real-secret',...overrides};}
test('production requires a public HTTPS origin and names the correct Render variable',()=>{
  assert.equal(readConfig(env()).PORT,10000);
  for(const origin of ['http://sherubtse-remarket.onrender.com','https://localhost:3000','https://127.0.0.1','https://[::1]','https://localhost.','https://example.com','https://your-service.onrender.com'])assert.throws(()=>readConfig(env({APP_BASE_URL:origin})),error=>error.code==='CONFIG_HTTPS'||error.code==='CONFIG_PUBLIC_ORIGIN');
  assert.throws(()=>readConfig(env({APP_BASE_URL:'https://user:private@sherubtse-remarket.onrender.com'})),error=>!error.message.includes('private')&&error.code==='CONFIG_APP_BASE_URL');
  assert.throws(()=>readConfig(env({APP_BASE_URL:''})),/APP_BASE_URL/);
  assert.throws(()=>readConfig(env({APP_BASE_URL:'',APP_URL:'https://sherubtse-remarket.onrender.com'})),/APP_URL is not read/);
});
test('Render external URL is a safe fallback; explicitly invalid APP_BASE_URL is never bypassed',()=>{
  const config=readConfig(env({APP_BASE_URL:'',RENDER_EXTERNAL_URL:'https://sherubtse-remarket.onrender.com'}));
  assert.equal(config.APP_BASE_URL_SOURCE,'RENDER_EXTERNAL_URL');assert.equal(config.APP_BASE_URL,'https://sherubtse-remarket.onrender.com');
  assert.throws(()=>readConfig(env({APP_BASE_URL:'http://localhost:3000',RENDER_EXTERNAL_URL:'https://sherubtse-remarket.onrender.com'})),/HTTPS/);
});
test('Render defaults to production and rejects an explicit development deployment',()=>{
  assert.equal(readConfig(env({NODE_ENV:undefined,RENDER:'true'})).NODE_ENV,'production');
  assert.throws(()=>readConfig(env({NODE_ENV:'development',RENDER:'true'})),error=>error.code==='CONFIG_RENDER_ENV');
});
test('production rejects global TLS bypass and insecure Atlas flags',()=>{
  assert.throws(()=>readConfig(env({NODE_TLS_REJECT_UNAUTHORIZED:'0'})),/forbidden/);
  for(const flag of ['tls=false','ssl=false','tlsAllowInvalidCertificates=true','tlsAllowInvalidHostnames=true','tlsInsecure=true'])assert.throws(()=>readConfig(env({MONGODB_URI:env().MONGODB_URI+'?'+flag})),/must not disable/);
});
test('all remote PostgreSQL SSL modes retain certificate and hostname verification',async()=>{
  for(const mode of ['require','prefer','verify-ca','verify-full','no-verify','disable']){
    const normalized=postgresUrl(env().DATABASE_URL.replace('sslmode=require',`sslmode=${mode}&uselibpqcompat=true`));
    assert.equal(new URL(normalized).searchParams.get('sslmode'),'verify-full');
    const client=new Client({connectionString:normalized});
    assert.ok(client.connectionParameters.ssl);assert.notEqual(client.connectionParameters.ssl.rejectUnauthorized,false);
    assert.equal(client.connectionParameters.ssl.checkServerIdentity,undefined);
    await client.end();
  }
});
test('migrations use the direct endpoint of the same Neon database',()=>{
  const pooled=new URL(postgresUrl(env().DATABASE_URL));const direct=new URL(postgresUrl(env().DATABASE_URL,{direct:true}));
  assert.ok(pooled.hostname.includes('-pooler.'));assert.ok(!direct.hostname.includes('-pooler.'));
  assert.ok(pooled.pathname===direct.pathname&&pooled.username===direct.username&&pooled.password===direct.password);
  assert.equal(new URL(postgresUrl('postgresql://localhost/local_test')).searchParams.get('sslmode'),null);
});
const columns=[['users','bio'],['users','avatar_url'],['products','moderation_status'],['products','featured'],['categories','active'],['email_verifications','delivered_at']].map(([table_name,column_name])=>({table_name,column_name}));
test('readiness verifies the complete marketplace schema, not only account/session tables',async()=>{
  const fixture=(missing)=>({query:async sql=>sql.includes('information_schema')?{rows:columns}:{rows:requiredTables.map(name=>({name,relation:name===missing?null:name}))}});
  await verifySchema(fixture());
  await assert.rejects(verifySchema(fixture('announcements')),error=>error.code==='DATABASE_SCHEMA_MISSING'&&error.message.includes('announcements'));
  await assert.rejects(verifySchema({query:async sql=>sql.includes('information_schema')?{rows:[]}:{rows:requiredTables.map(name=>({name,relation:name}))}}),/products.moderation_status/);
});
test('nested Atlas TLS failures retain safe actionable codes without provider secrets',()=>{
  const privateText='private-provider-content-must-not-appear';
  const cause={name:'MongooseServerSelectionError',message:privateText,reason:{servers:new Map([['fixture',{error:{code:'ERR_TLS_CERT_ALTNAME_INVALID',message:privateText}}]])}};
  const failure=databaseFailure('MongoDB',cause);assert.equal(failure.code,'DATABASE_TLS_FAILED');
  const captured=[];const original=console.error;console.error=value=>captured.push(value);
  try{logFailure('startup',failure);logFailure('startup',new Error(privateText));}finally{console.error=original;}
  assert.ok(captured.every(line=>!line.includes(privateText)));assert.ok(captured[0].includes('ERR_TLS_CERT_ALTNAME_INVALID'));
});
test('production trusts Render proxy and issues only secure HTTP-only SameSite session cookies',async()=>{
  const {app}=createApp({config:readConfig(env()),pool:{query:async()=>({rows:[],rowCount:0})},mongo:{},sessionStore:new session.MemoryStore(),services:{mail:{},images:{}}});
  assert.equal(app.get('trust proxy'),1);
  const secure=await request(app).get('/login').set('X-Forwarded-Proto','https').expect(200);
  const cookie=secure.headers['set-cookie']?.[0]||'';assert.match(cookie,/; Secure/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);
  assert.ok(secure.headers['strict-transport-security']);
  const insecure=await request(app).get('/login').expect(200);assert.equal(insecure.headers['set-cookie'],undefined);
});
test('invalid production HTTPS exits with a specific sanitized diagnostic before database access',async()=>{
  await assert.rejects(promisify(execFile)(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,...env({APP_BASE_URL:'http://localhost:3000'})},timeout:10000}),error=>{
    assert.equal(error.code,1);assert.ok(error.stderr.includes('CONFIG_HTTPS'));assert.ok(error.stderr.includes('configuration'));
    assert.ok(!error.stderr.includes(env().SMTP_PASS));assert.ok(!error.stderr.includes(env().DATABASE_URL));assert.ok(!error.stdout.includes('Checking locked'));
    return true;
  });
});
test('secret gate identifies configured values and private key/token markers without returning their contents',()=>{
  const marker='fixture-private-marker-value';
  assert.deepEqual(findingsFor(`config=${marker}`,[marker]),['configured credential value']);
  const keyMarker=['-----BEGIN','PRIVATE KEY-----'].join(' ');
  assert.deepEqual(findingsFor(keyMarker,[]),['private key']);
  assert.deepEqual(findingsFor('SMTP_PASS=fixture-private-do-not-publish',[]),['non-placeholder environment credential']);
  assert.deepEqual(findingsFor('SMTP_PASS=replace-me',['different-fixture-secret']),[]);
  assert.deepEqual(findingsFor('DIRECT_DATABASE_URL=\n# Migration timeout bounds',[]),[]);
});
