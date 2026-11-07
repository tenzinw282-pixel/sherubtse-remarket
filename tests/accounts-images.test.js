const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const request = require('supertest');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { createAccounts, otpDigest } = require('../services/accounts');
const { createImages, imageFormat } = require('../services/images');
const { connectionAdvice } = require('../services/service-errors');
const { createApp } = require('../app');
const config = { NODE_ENV:'test',SESSION_SECRET:'a-long-test-secret-at-least-32-characters',EMAIL_FROM:'sender@example.test',ALLOWED_EMAIL_DOMAIN:'' };
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const productId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9l8AAAAASUVORK5CYII=','base64');
function fixture(options={}) {
  const state = { user:{ id:userId,email:'student@example.test' }, challenges:[], mail:[], calls:[], released:0 };
  async function query(sql, params=[]) {
    state.calls.push(sql);
    if (sql.includes('FROM users')) return { rows:[state.user] };
    if (sql.includes('count(*)::int')) return { rows:[{ count:options.count || 0,cooling:options.cooling || false }] };
    if (sql.startsWith('INSERT INTO users')) {
      state.passwordHash=params[3];
      if (options.duplicate) throw Object.assign(new Error('private detail'),{ code:'23505' });
      state.user.full_name=params[0]; state.user.password_hash=params[3];
      return { rows:[{ id:userId }] };
    }
    if (sql.startsWith('INSERT INTO email_verifications')) state.challenges.push({ id:params[0],user_id:params[1],email:params[2],code_hash:params[3],attempts:0 });
    if (sql.startsWith('SELECT *, expires_at')) return { rows:state.challenges.filter(c=>!c.consumed_at) };
    if (sql.includes('SET delivered_at')) state.challenges.find(c=>c.id===params[0]).delivered_at=new Date();
    if (sql.includes('SET consumed_at')) {
      for (const c of state.challenges) if (c.id===params[0] || c.user_id===params[0]) c.consumed_at=new Date();
    }
    if (sql.includes('SET attempts')) state.challenges.find(c=>c.id===params[0]).attempts++;
    if (sql.startsWith('UPDATE users SET email_verified_at')) state.user.email_verified_at=new Date();
    return { rows:[],rowCount:1 };
  }
  const pool = { query,connect:async()=>({ query,release:()=>state.released++ }) };
  const mail = { sendMail:async message=>{
    state.mail.push(message);
    if (options.mailFailure) throw Object.assign(new Error('sensitive provider response'),{ code:'EAUTH' });
    return { accepted:['student@example.test'] };
  } };
  return { state,pool,mail,accounts:createAccounts({ pool,mail,config }) };
}
// Captured codes remain only in test memory and are never printed as assertion values.
function capturedCode(state) { return state.mail[0].text.match(/code is (\d{6})/)[1]; }
test('registration hashes passwords and stores no plaintext',async()=>{
  const {accounts,state}=fixture();
  assert.equal(await accounts.register({ fullName:'Test Student',email:'student@example.test',password:'a-secure-password' }),userId);
  assert.ok(await bcrypt.compare('a-secure-password',state.passwordHash));
});
test('registration reports duplicate email safely',async()=>{
  const {accounts}=fixture({ duplicate:true });
  await assert.rejects(accounts.register({fullName:'Student',email:'student@example.test',password:'a-secure-password'}),{ status:409 });
});
test('OTP mail contains six digits; database stores only HMAC and delivery timestamp',async()=>{
  const {accounts,state}=fixture(); await accounts.issueCode(userId);
  const code=capturedCode(state); assert.ok(/^\d{6}$/.test(code));
  assert.ok(state.challenges[0].code_hash!==code);
  assert.ok(state.challenges[0].code_hash===otpDigest(config.SESSION_SECRET,state.challenges[0].id,code));
  assert.ok(state.challenges[0].delivered_at);
  assert.ok(state.mail[0].html.includes('Do not share'));
});
test('correct OTP verifies email and consumes challenge; reuse fails',async()=>{
  const {accounts,state}=fixture(); await accounts.issueCode(userId);
  await accounts.verify(userId,capturedCode(state));
  assert.ok(state.user.email_verified_at); assert.ok(state.challenges[0].consumed_at);
  await assert.rejects(accounts.verify(userId,capturedCode(state)),/No delivered code/);
});
test('incorrect OTP increments attempts and commits; fifth attempt locks challenge',async()=>{
  const {accounts,state}=fixture(); await accounts.issueCode(userId);
  const wrong=capturedCode(state)==='000000'?'111111':'000000';
  for(let i=0;i<5;i++) await assert.rejects(accounts.verify(userId,wrong),/Incorrect/);
  assert.equal(state.challenges[0].attempts,5);
  await assert.rejects(accounts.verify(userId,capturedCode(state)),/Too many/);
  assert.equal(state.user.email_verified_at,undefined);
  assert.ok(state.calls.includes('COMMIT'));
});
test('expired or undelivered OTP cannot verify an account',async()=>{
  for (const property of ['expired','delivered_at']) {
    const {accounts,state}=fixture(); await accounts.issueCode(userId);
    state.challenges[0][property]=property==='expired'?true:null;
    await assert.rejects(accounts.verify(userId,capturedCode(state)),/expired|No delivered/);
    assert.equal(state.user.email_verified_at,undefined);
  }
});
test('resend cooldown and per-account hourly limit prevent mail sending',async()=>{
  for (const options of [{ cooling:true },{ count:5 }]) {
    const {accounts,state}=fixture(options); await assert.rejects(accounts.issueCode(userId),{ status:429 });
    assert.equal(state.mail.length,0); assert.ok(state.calls.includes('ROLLBACK'));
  }
});
test('resending invalidates earlier OTP',async()=>{
  const {accounts,state}=fixture(); await accounts.issueCode(userId); await accounts.issueCode(userId);
  assert.ok(state.challenges[0].consumed_at); assert.equal(state.challenges[1].consumed_at,undefined);
});
test('SMTP delivery failure invalidates code and never verifies account',async()=>{
  const {accounts,state}=fixture({ mailFailure:true });
  await assert.rejects(accounts.issueCode(userId),error=>error.status===502&&!error.message.includes('sensitive provider response'));
  assert.ok(state.challenges[0].consumed_at); assert.equal(state.user.email_verified_at,undefined);
});
function cloudMock({fail=false}={}) {
  const state={uploads:0,removed:[],options:[]};
  return { state,cloud:{ uploader:{ upload_stream:(options,callback)=>{
    state.options.push(options);
    return new Writable({ write(chunk,encoding,next){next();},final(next){
      state.uploads++;
      if (fail) callback({http_code:401,message:'private-provider-detail'});
      else callback(null,{public_id:`asset-${state.uploads}`,secure_url:`https://res.cloudinary.com/test/image/upload/${state.uploads}.webp`});
      next();
    } });
  },destroy:async id=>{state.removed.push(id);return {result:'ok'};} } } };
}
test('Cloudinary uploads validated images and requests safe re-encoding',async()=>{
  const {cloud,state}=cloudMock(); const images=createImages(cloud);
  const result=await images.upload({buffer:png,mimetype:'image/png'});
  assert.ok(result.url.startsWith('https://')); assert.equal(state.options[0].resource_type,'image');
  assert.equal(state.options[0].format,'webp'); await images.remove([result]); assert.equal(state.removed.length,1);
});
test('forged, mismatched and oversized image uploads are rejected before provider calls',async()=>{
  const {cloud,state}=cloudMock(); const images=createImages(cloud);
  assert.throws(()=>imageFormat(Buffer.from('<svg/>')),/Only valid/);
  await assert.rejects(images.upload({buffer:png,mimetype:'image/jpeg'}),/do not match/);
  const large=Buffer.concat([png,Buffer.alloc(5*1024*1024)]);
  await assert.rejects(images.upload({buffer:large,mimetype:'image/png'}),/5 MB/);
  assert.equal(state.uploads,0);
});
test('Cloudinary failures return useful guidance without provider contents',async()=>{
  const {cloud}=cloudMock({fail:true});
  await assert.rejects(createImages(cloud).upload({buffer:png,mimetype:'image/png'}),e=>e.status===502&&e.message.includes('authentication failed')&&!e.message.includes('private-provider'));
  assert.ok(!connectionAdvice('SMTP',{code:'EAUTH',message:'secret'}).includes('secret'));
});
function httpFixture({verified=true,failSave=false}={}) {
  const {cloud,state}=cloudMock();
  const store=new session.MemoryStore();
  const user={id:userId,full_name:'Student',email:'student@example.test',email_verified_at:verified?new Date():null};
  const calls=[];
  const query=async(sql,params)=>{
    calls.push(sql);
    if(sql.includes('FROM users'))return {rows:[user]};
    if(sql.includes('FROM categories'))return {rows:[{id:1,name:'Textbooks'}],rowCount:1};
    if(sql.startsWith('INSERT INTO products')){if(failSave)throw new Error('database private');return {rows:[{id:productId}]};}
    return {rows:[],rowCount:1};
  };
  const app=createApp({config,pool:{query,connect:async()=>({query,release(){}})},mongo:{},sessionStore:store,services:{mail:{},images:cloud}}).app;
  return {app,store,state,calls};
}
async function authenticated(fixture) {
  const agent=request.agent(fixture.app); const response=await agent.get('/login');
  const token=response.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const sessions=await new Promise((resolve,reject)=>fixture.store.all((error,values)=>error?reject(error):resolve(values)));
  const [id]=Object.keys(sessions); const sess=sessions[id]; sess.userId=userId;
  await new Promise((resolve,reject)=>fixture.store.set(id,sess,error=>error?reject(error):resolve()));
  return {agent,token};
}
function sendProduct(agent,token,buffer=png) {
  return agent.post('/sell').set('X-CSRF-Token',token).field('title','Calculus textbook').field('description','A useful textbook in good condition.').field('categoryId','1').field('condition','Good').field('price','100.50').attach('images',buffer,{filename:'book.png',contentType:'image/png'});
}
test('upload route requires login and verification',async()=>{
  const anon=httpFixture(); const agent=request.agent(anon.app); const response=await agent.get('/login');
  const token=response.text.match(/name="_csrf" value="([^"]+)"/)[1];
  await sendProduct(agent,token).expect(401); assert.equal(anon.state.uploads,0);
  const unverified=httpFixture({verified:false});const auth=await authenticated(unverified);
  await sendProduct(auth.agent,auth.token).expect(403);assert.equal(unverified.state.uploads,0);
});
test('authenticated listing persists Cloudinary references transactionally',async()=>{
  const fixture=httpFixture();const {agent,token}=await authenticated(fixture);
  const response=await sendProduct(agent,token).expect(201);
  assert.equal(response.body.redirect,`/products/${productId}`);assert.equal(fixture.state.uploads,1);
  assert.ok(fixture.calls.some(sql=>sql.startsWith('INSERT INTO product_images')));assert.ok(fixture.calls.includes('COMMIT'));
});
test('listing save failure rolls back and removes uploaded assets',async()=>{
  const fixture=httpFixture({failSave:true});const {agent,token}=await authenticated(fixture);
  const response=await sendProduct(agent,token).expect(503);
  assert.ok(!response.text.includes('database private'));assert.ok(fixture.calls.includes('ROLLBACK'));assert.equal(fixture.state.removed.length,1);
});
test('HTTP upload rejects forged images and missing CSRF before uploading',async()=>{
  const fixture=httpFixture();const {agent,token}=await authenticated(fixture);
  await sendProduct(agent,token,Buffer.from('not an image')).expect(400);
  await sendProduct(agent,'invalid').expect(403);assert.equal(fixture.state.uploads,0);
});
test('registration rejects invalid fields and pages render forms',async()=>{
  const fixture=httpFixture();const agent=request.agent(fixture.app);
  const page=await agent.get('/register').expect(200);const token=page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  await agent.post('/register').type('form').send({_csrf:token,email:'bad',password:'short'}).expect(400);
  await agent.get('/terms').expect(200);await agent.get('/sell').expect(401);
});
test('registration, email verification, login and logout work through HTTP with test adapters',async()=>{
  const fixture=fixtureForAccountHttp(); const {state,app}=fixture;
  const agent=request.agent(app);
  const tokenFrom=response=>response.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const register=await agent.get('/register').expect(200);
  await agent.post('/register').type('form').send({_csrf:tokenFrom(register),fullName:'Test Student',email:'student@example.test',password:'secure-student-password',confirmPassword:'secure-student-password',terms:'on'}).expect(302).expect('Location','/verify-email?sent=1');
  assert.equal(state.mail.length,1);
  const verify=await agent.get('/verify-email').expect(200);
  assert.ok(!verify.text.includes(capturedCode(state)));
  const response=await agent.post('/verify-email').type('form').send({_csrf:tokenFrom(verify),code:capturedCode(state)}).expect(200);
  assert.ok(response.text.includes('Email verified successfully'));
  await agent.post('/login').type('form').send({_csrf:tokenFrom(response),email:'student@example.test',password:'secure-student-password'}).expect(302).expect('Location','/sell');
  const sell=await agent.get('/sell').expect(200);
  await agent.post('/logout').type('form').send({_csrf:tokenFrom(sell)}).expect(302);
  await agent.get('/sell').expect(401);
});
function fixtureForAccountHttp(options={}) {
  const setup=fixture(options);const {cloud}=cloudMock();
  const query=setup.pool.query;
  setup.pool.query=async(sql,params)=>sql.includes('FROM categories')?{rows:[{id:1,name:'Textbooks'}]}:query(sql,params);
  const app=createApp({config,pool:setup.pool,mongo:{},sessionStore:new session.MemoryStore(),services:{mail:setup.mail,images:cloud}}).app;
  return {...setup,app};
}
test('registration SMTP failure shows redacted retry guidance with a usable session token',async()=>{
  const {app,state}=fixtureForAccountHttp({mailFailure:true});const agent=request.agent(app);
  const page=await agent.get('/register');const token=page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const response=await agent.post('/register').type('form').send({_csrf:token,fullName:'Test Student',email:'student@example.test',password:'secure-student-password',confirmPassword:'secure-student-password',terms:'on'}).expect(502);
  assert.ok(response.text.includes('account remains unverified'));assert.ok(!response.text.includes('sensitive provider'));
  const nextToken=response.text.match(/name="_csrf" value="([^"]+)"/)[1];
  assert.notEqual(nextToken,token); assert.equal(state.user.email_verified_at,undefined);
  await agent.post('/verify-email/resend').type('form').send({_csrf:nextToken}).expect(502);
});
test('registration email request limit applies per IP',async()=>{
  const {app}=fixtureForAccountHttp();const agent=request.agent(app);
  const page=await agent.get('/register');const token=page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  for(let i=0;i<15;i++) await agent.post('/register').type('form').send({_csrf:token}).expect(400);
  await agent.post('/register').type('form').send({_csrf:token}).expect(429);
});
test('HTTP image size limits run before Cloudinary',async()=>{
  const fixture=httpFixture();const {agent,token}=await authenticated(fixture);
  await sendProduct(agent,token,Buffer.concat([png,Buffer.alloc(5*1024*1024)])).expect(400);
  assert.equal(fixture.state.uploads,0);
});
