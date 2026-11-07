require('dotenv').config({quiet:true});
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Writable}=require('node:stream');
const http=require('node:http');
const {Pool}=require('pg');
const mongoose=require('mongoose');
const request=require('supertest');
const {io:connectSocket}=require('socket.io-client');
const {migrate}=require('../scripts/migrate');
const {readConfig}=require('../config/env');
const {createApp}=require('../app');
const {createRealtime}=require('../services/realtime');
const {startJobs}=require('../jobs/marketplace');
const documents=require('../models/documents');
const {createCatalog}=require('../services/catalog');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9l8AAAAASUVORK5CYII=','base64');

test('real PostgreSQL and MongoDB marketplace integration', {timeout:360000}, async t=>{
  const config={...readConfig(),NODE_ENV:'test'};
  const schema=`remarket_test_${randomUUID().replaceAll('-','')}`;
  const databaseUrl=new URL(process.env.TEST_DATABASE_URL||config.DATABASE_URL);
  // Neon transaction-pooler endpoints cannot retain test search_path settings.
  // The direct endpoint is the same configured Neon database, not a new database.
  if(databaseUrl.hostname.endsWith('.neon.tech'))databaseUrl.hostname=databaseUrl.hostname.replace('-pooler.','.');
  const ownerPool=new Pool({connectionString:databaseUrl.toString(),max:2});
  const pool=new Pool({connectionString:databaseUrl.toString(),options:`-c search_path=${schema} -c timezone=UTC`,max:10});
  const mongoUrl=new URL(process.env.TEST_MONGODB_URI||config.MONGODB_URI);const dbName=`remarket_test_${randomUUID().replaceAll('-','').slice(0,20)}`;mongoUrl.pathname=`/${dbName}`;
  const mails=[];const services={mail:{sendMail:async message=>{mails.push(message);return {accepted:[message.to]};}},images:{uploader:{upload_stream:(options,callback)=>new Writable({write(chunk,encoding,done){done();},final(done){callback(null,{public_id:`test/${randomUUID()}`,secure_url:'https://res.cloudinary.com/test/image/upload/test.webp'});done();}}),destroy:async()=>({result:'ok'})}}};
  let server,io,jobs,socket,schemaCreated=false,mongoConnected=false,stage='PostgreSQL setup';
  const token=response=>response.text.match(/name="_csrf" value="([^"]+)"/)[1];
  try{
    await ownerPool.query(`CREATE SCHEMA "${schema}"`);schemaCreated=true;
    await migrate(pool);
    assert.equal((await pool.query('SELECT current_schema() AS name')).rows[0].name,schema);
    stage='MongoDB connection';
    await mongoose.connect(mongoUrl.toString(),{serverSelectionTimeoutMS:15000,autoIndex:false});mongoConnected=true;
    stage='MongoDB index creation';for(const model of Object.values(documents))await model.createIndexes();
    stage='HTTP composition';
    const composed=createApp({config,pool,mongo:mongoose,services});server=http.createServer(composed.app);
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    io=createRealtime({server,sessionMiddleware:composed.sessionMiddleware,pool,baseUrl:origin});
    const publish=(room,event,data)=>io.to(room).emit(event,data);composed.app.locals.publish=publish;
    composed.app.locals.disconnectUser=id=>io.in(`user:${id}`).disconnectSockets(true);
    async function student(name){
      const agent=request.agent(origin),email=`${name.toLowerCase()}@example.test`,password='a-strong-test-password';
      const form=await agent.get('/register').expect(200);
      await agent.post('/register').type('form').send({_csrf:token(form),fullName:`${name} Student`,email,password,confirmPassword:password,terms:'on',role:'admin'}).expect(302);
      const page=await agent.get('/verify-email').expect(200);const code=mails.findLast(message=>message.to===email).text.match(/code is (\d{6})/)[1];
      await agent.post('/verify-email').type('form').send({_csrf:token(page),code}).expect(200);
      const loginForm=await agent.get('/login');const login=await agent.post('/login').type('form').send({_csrf:token(loginForm),email,password}).expect(302);
      const user=(await pool.query('SELECT * FROM users WHERE email=$1',[email])).rows[0];
      return {agent,id:user.id,email,password,csrf:token(await agent.get('/profile')),cookie:login.headers['set-cookie'][0].split(';')[0]};
    }
    let seller,buyer,other,admin,fixedId,auctionId,auction;
    stage='workflow tests';
    await t.test('registration, OTP and student login use real PostgreSQL; role injection is ignored',async()=>{
      [seller,buyer,other,admin]=await Promise.all(['Seller','Buyer','Other','Administrator'].map(student));
      assert.equal((await pool.query('SELECT role FROM users WHERE id=$1',[seller.id])).rows[0].role,'student');
      await pool.query("UPDATE users SET role='admin' WHERE id=$1",[admin.id]);
      const form=await admin.agent.get('/login');await admin.agent.post('/login').type('form').send({_csrf:token(form),email:admin.email,password:admin.password}).expect(302).expect('Location','/admin');admin.csrf=token(await admin.agent.get('/admin'));
    });
    await t.test('profile text and avatar upload persist; private identity is not public',async()=>{
      await seller.agent.post('/profile').set('X-CSRF-Token',seller.csrf).field('fullName','Seller Updated').field('bio','I pass on useful student essentials.').field('studentId','private-student-id').attach('avatar',png,{filename:'avatar.png',contentType:'image/png'}).expect(200);
      const publicPage=await request(origin).get(`/users/${seller.id}`).expect(200);assert.ok(publicPage.text.includes('Seller Updated'));assert.ok(!publicPage.text.includes('private-student-id'));assert.ok(!publicPage.text.includes(seller.email));
    });
    async function listing(type='fixed'){
      const req=seller.agent.post('/sell').set('X-CSRF-Token',seller.csrf).field('title',type==='fixed'?'Integration textbook':'Integration headphones').field('description','A synthetic listing isolated from all application records.').field('categoryId','1').field('condition','Good').field('price','100.00').field('sellingType',type);
      if(type==='auction'){const now=new Date((await pool.query('SELECT clock_timestamp() AS now')).rows[0].now).getTime();req.field('increment','10.00').field('startsAt',new Date(now-60000).toISOString()).field('endsAt',new Date(now+600000).toISOString());}
      const response=await req.attach('images',png,{filename:'item.png',contentType:'image/png'}).expect(201);return response.body.redirect.split('/').at(-1);
    }
    await t.test('product upload creates pending review and hides details from other students',async()=>{
      fixedId=await listing();assert.equal((await pool.query('SELECT moderation_status FROM products WHERE id=$1',[fixedId])).rows[0].moderation_status,'pending');
      await seller.agent.get(`/products/${fixedId}`).expect(200);await buyer.agent.get(`/products/${fixedId}`).expect(404);
      assert.ok(!(await request(origin).get('/')).text.includes('Integration textbook'));
    });
    await t.test('student admin access is denied; verified admin approves with audit and durable notice',async()=>{
      await seller.agent.get('/admin').expect(403);
      await seller.agent.post(`/admin/products/${fixedId}/approve`).type('form').send({_csrf:seller.csrf,reason:'Trying unauthorized action'}).expect(403);
      await admin.agent.post(`/admin/products/${fixedId}/approve`).type('form').send({_csrf:admin.csrf,reason:'Approved for integration testing'}).expect(302);
      assert.ok((await request(origin).get('/marketplace')).text.includes('Integration textbook'));
      assert.ok((await pool.query('SELECT 1 FROM admin_actions WHERE target_id=$1',[fixedId])).rowCount>0);
      assert.ok((await pool.query("SELECT 1 FROM outbox WHERE payload->>'userId'=$1",[seller.id])).rowCount>0);
    });
    await t.test('marketplace search, category, price filters and owner permissions work',async()=>{
      assert.ok((await request(origin).get('/marketplace?q=textbook&category=1&min=90&max=110')).text.includes('Integration textbook'));
      assert.ok(!(await request(origin).get('/marketplace?q=not-found')).text.includes('Integration textbook'));
      await buyer.agent.post(`/products/${fixedId}/edit`).type('form').send({_csrf:buyer.csrf,title:'Unauthorized title',description:'An unauthorized edit to a listing.',categoryId:'1',condition:'Good',price:'99.00'}).expect(403);
      await buyer.agent.post(`/products/${fixedId}/withdraw`).type('form').send({_csrf:buyer.csrf}).expect(403);
      await buyer.agent.post(`/products/${fixedId}/favorite`).type('form').send({_csrf:buyer.csrf}).expect(302);assert.ok((await buyer.agent.get('/dashboard/favorites')).text.includes('Integration textbook'));
    });
    await t.test('simultaneous purchases reserve exactly one transaction',async()=>{
      const results=await Promise.all([buyer,other].map(person=>person.agent.post(`/products/${fixedId}/buy`).type('form').send({_csrf:person.csrf})));
      assert.equal(results.filter(r=>r.status===302).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM transactions WHERE product_id=$1',[fixedId])).rows[0].count,1);
    });
    await t.test('handover and buyer receipt complete the transaction; review and dashboards work',async()=>{
      const sale=(await pool.query('SELECT * FROM transactions WHERE product_id=$1',[fixedId])).rows[0];const winner=[buyer,other].find(person=>person.id===sale.buyer_id);
      await seller.agent.post(`/transactions/${sale.id}/handover`).type('form').send({_csrf:seller.csrf}).expect(302);
      await winner.agent.post(`/transactions/${sale.id}/receive`).type('form').send({_csrf:winner.csrf}).expect(302);
      assert.equal((await pool.query('SELECT status FROM transactions WHERE id=$1',[sale.id])).rows[0].status,'completed');
      await winner.agent.post(`/transactions/${sale.id}/review`).type('form').send({_csrf:winner.csrf,rating:'5',comment:'A clear handover.'}).expect(302);
      await winner.agent.get('/dashboard/purchases').expect(200);await seller.agent.get('/dashboard/sales').expect(200);
    });
    await t.test('pending auctions reject bids; approved auctions enforce self-bid and increments',async()=>{
      auctionId=await listing('auction');auction=(await pool.query('SELECT * FROM auctions WHERE product_id=$1',[auctionId])).rows[0];
      await buyer.agent.post(`/auctions/${auction.id}/bids`).set('X-CSRF-Token',buyer.csrf).send({amount:'100.00'}).expect(400);
      await admin.agent.post(`/admin/products/${auctionId}/approve`).type('form').send({_csrf:admin.csrf,reason:'Approved auction testing'}).expect(302);
      await seller.agent.post(`/auctions/${auction.id}/bids`).set('X-CSRF-Token',seller.csrf).send({amount:'100.00'}).expect(400);
      const simultaneous=await Promise.all([buyer,other].map(person=>person.agent.post(`/auctions/${auction.id}/bids`).set('X-CSRF-Token',person.csrf).send({amount:'100.00'})));
      assert.equal(simultaneous.filter(r=>r.status===200).length,1,JSON.stringify(simultaneous.map(r=>({status:r.status,error:r.body.error}))));assert.equal(simultaneous.filter(r=>r.status===400).length,1);
    });
    await t.test('authenticated Socket.IO clients receive committed real bids',async()=>{
      socket=connectSocket(origin,{extraHeaders:{Cookie:buyer.cookie},transports:['websocket'],reconnection:false});
      await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});socket.emit('join-auction',auction.id);
      for(let tries=0;tries<40&&!io.sockets.adapter.rooms.has(`auction:${auction.id}`);tries++)await new Promise(resolve=>setTimeout(resolve,50));
      assert.ok(io.sockets.adapter.rooms.has(`auction:${auction.id}`));
      const event=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Committed bid broadcast missing')),5000);socket.once('bid',data=>{clearTimeout(timeout);resolve(data);});});
      event.catch(()=>{});
      await buyer.agent.post(`/auctions/${auction.id}/bids`).set('X-CSRF-Token',buyer.csrf).send({amount:'120.00'}).expect(200);
      const committed=await event;assert.equal((await pool.query('SELECT amount FROM bids WHERE id=$1',[committed.id])).rows[0].amount,'120.00');
    });
    await t.test('expired auctions reject bids; reconciliation chooses winner once without online users',async()=>{
      socket.disconnect();await pool.query("UPDATE auctions SET starts_at=clock_timestamp()-interval '2 minutes',ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[auction.id]);
      await other.agent.post(`/auctions/${auction.id}/bids`).set('X-CSRF-Token',other.csrf).send({amount:'140.00'}).expect(400);
      await Promise.all([composed.app.locals.commerce.close(auction.id),composed.app.locals.commerce.close(auction.id)]);
      const sales=(await pool.query('SELECT * FROM transactions WHERE auction_id=$1',[auction.id])).rows;assert.equal(sales.length,1);assert.equal(sales[0].buyer_id,buyer.id);assert.equal(sales[0].amount,'120.00');
      assert.ok((await buyer.agent.get('/dashboard/won-auctions')).text.includes('Integration headphones'));
    });
    await t.test('messages persist in Atlas and unrelated students cannot access them',async()=>{
      const contact=await buyer.agent.post(`/products/${fixedId}/contact`).type('form').send({_csrf:buyer.csrf}).expect(302);const href=contact.headers.location;
      socket=connectSocket(origin,{extraHeaders:{Cookie:seller.cookie},transports:['websocket'],reconnection:false});await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
      const conversationId=href.split('/').at(-1);socket.emit('join-conversation',conversationId);
      for(let tries=0;tries<40&&!io.sockets.adapter.rooms.has(`conversation:${conversationId}`);tries++)await new Promise(resolve=>setTimeout(resolve,50));
      assert.ok(io.sockets.adapter.rooms.has(`conversation:${conversationId}`));
      const delivery=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Message event missing')),5000);socket.once('message',event=>{clearTimeout(timer);resolve(event);});});delivery.catch(()=>{});
      await buyer.agent.post(href).set('X-CSRF-Token',buyer.csrf).send({body:'Can we arrange collection after class?'}).expect(200);
      assert.equal((await delivery).conversationId,conversationId);socket.disconnect();
      await seller.agent.get(href).expect(200);await other.agent.get(href).expect(404);
      const id=href.split('/').at(-1);const messages=await seller.agent.get(`/api/conversations/${id}/messages`).expect(200);assert.equal(messages.body.messages.length,1);
      await other.agent.post(href).set('X-CSRF-Token',other.csrf).send({body:'Unauthorized message'}).expect(404);
    });
    await t.test('outbox notifications deliver idempotently and mark-read is private',async()=>{
      jobs=startJobs({pool,commerce:composed.app.locals.commerce,publish});await jobs.tick();
      for(let i=0;i<100&&(await pool.query('SELECT 1 FROM outbox WHERE processed_at IS NULL')).rowCount;i++){await new Promise(resolve=>setTimeout(resolve,100));await jobs.tick();}
      const before=await documents.Notification.countDocuments({userId:seller.id});assert.ok(before>0);await jobs.tick();assert.equal(await documents.Notification.countDocuments({userId:seller.id}),before);
      await seller.agent.get('/notifications').expect(200);await seller.agent.post('/notifications/read-all').type('form').send({_csrf:seller.csrf}).expect(302);
      assert.equal((await seller.agent.get('/api/notifications/unread')).body.count,0);
    });
    await t.test('reports, user suspension and all admin management pages work',async()=>{
      await other.agent.post(`/products/${auctionId}/report`).type('form').send({_csrf:other.csrf,reason:'Suspicious bidding for review'}).expect(302);
      for(const route of ['/admin','/admin/users','/admin/approvals','/admin/products','/admin/auctions','/admin/transactions','/admin/reports','/admin/categories','/admin/announcements','/admin/audit'])await admin.agent.get(route).expect(200);
      await admin.agent.post(`/admin/users/${other.id}/suspend`).type('form').send({_csrf:admin.csrf,reason:'Testing account suspension controls'}).expect(302);
      await other.agent.get('/dashboard').expect(401);
      await admin.agent.post(`/admin/users/${other.id}/reactivate`).type('form').send({_csrf:admin.csrf,reason:'Testing restored account access'}).expect(302);await other.agent.get('/dashboard').expect(200);
    });
    await t.test('eligible listing edits require reapproval, rejected items stay hidden, withdrawals preserve records',async()=>{
      const id=await listing();await admin.agent.post(`/admin/products/${id}/reject`).type('form').send({_csrf:admin.csrf,reason:'Please improve the description'}).expect(302);await buyer.agent.get(`/products/${id}`).expect(404);
      await seller.agent.post(`/products/${id}/edit`).type('form').send({_csrf:seller.csrf,title:'Edited textbook',description:'A clarified description for administrator review.',categoryId:'1',condition:'Good',price:'90.00'}).expect(302);
      assert.equal((await pool.query('SELECT moderation_status FROM products WHERE id=$1',[id])).rows[0].moderation_status,'pending');
      await seller.agent.post(`/products/${id}/withdraw`).type('form').send({_csrf:seller.csrf}).expect(302);assert.equal((await pool.query('SELECT status FROM products WHERE id=$1',[id])).rows[0].status,'removed');
    });
    await t.test('category management, announcements and report resolution persist with audits',async()=>{
      await admin.agent.post('/admin/categories').type('form').send({_csrf:admin.csrf,name:'Test category'}).expect(302);
      const category=(await pool.query('SELECT id FROM categories WHERE name=$1',['Test category'])).rows[0];
      await admin.agent.post(`/admin/categories/${category.id}`).type('form').send({_csrf:admin.csrf,name:'Archived test category'}).expect(302);
      assert.equal((await pool.query('SELECT active FROM categories WHERE id=$1',[category.id])).rows[0].active,false);
      await admin.agent.post('/admin/announcements').type('form').send({_csrf:admin.csrf,title:'Test collection guidance',body:'Arrange collection during the agreed time.'}).expect(302);
      assert.ok((await request(origin).get('/')).text.includes('Test collection guidance'));
      const announcement=(await pool.query('SELECT id FROM announcements LIMIT 1')).rows[0];await admin.agent.post(`/admin/announcements/${announcement.id}/hide`).type('form').send({_csrf:admin.csrf}).expect(302);
      assert.ok(!(await request(origin).get('/')).text.includes('Test collection guidance'));
      const report=(await pool.query('SELECT id FROM reports LIMIT 1')).rows[0];await admin.agent.post(`/admin/reports/${report.id}/resolve`).type('form').send({_csrf:admin.csrf,decision:'resolved',reason:'Bidding reviewed and legitimate'}).expect(302);
      assert.equal((await pool.query('SELECT status FROM reports WHERE id=$1',[report.id])).rows[0].status,'resolved');
    });
    await t.test('empty auction expiry and administrator cancellation never create phantom winners',async()=>{
      const id=await listing('auction'),a=(await pool.query('SELECT id FROM auctions WHERE product_id=$1',[id])).rows[0];
      await admin.agent.post(`/admin/products/${id}/approve`).type('form').send({_csrf:admin.csrf,reason:'Approved empty-auction check'}).expect(302);
      await pool.query("UPDATE auctions SET starts_at=clock_timestamp()-interval '2 minutes',ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[a.id]);
      await composed.app.locals.commerce.closeDue();assert.equal((await pool.query('SELECT count(*)::int AS count FROM transactions WHERE auction_id=$1',[a.id])).rows[0].count,0);
      const cancelled=await listing('auction'),c=(await pool.query('SELECT id FROM auctions WHERE product_id=$1',[cancelled])).rows[0];
      await admin.agent.post(`/admin/products/${cancelled}/approve`).type('form').send({_csrf:admin.csrf,reason:'Approved cancellation check'}).expect(302);
      await admin.agent.post(`/admin/auctions/${c.id}/cancel`).type('form').send({_csrf:admin.csrf,reason:'Cancelled by moderation for testing'}).expect(302);
      await buyer.agent.post(`/auctions/${c.id}/bids`).set('X-CSRF-Token',buyer.csrf).send({amount:'100.00'}).expect(400);
      assert.equal((await pool.query('SELECT status FROM auctions WHERE id=$1',[c.id])).rows[0].status,'cancelled');
    });
    await t.test('anonymous sockets and unauthorized auction room joins are rejected',async()=>{
      const anonymous=connectSocket(origin,{transports:['websocket'],reconnection:false});try{const failed=await new Promise(resolve=>{anonymous.once('connect_error',()=>resolve(true));anonymous.once('connect',()=>resolve(false));});assert.equal(failed,true);}finally{anonymous.disconnect();}
      socket=connectSocket(origin,{extraHeaders:{Cookie:other.cookie},transports:['websocket'],reconnection:false});await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
      const unavailable='00000000-0000-0000-0000-000000000000';socket.emit('join-auction',unavailable);await new Promise(resolve=>setTimeout(resolve,500));assert.equal(io.sockets.adapter.rooms.has(`auction:${unavailable}`),false);socket.disconnect();
    });
  } catch(error){
    t.diagnostic(`Failure stage: ${stage}; type: ${error.name}; code: ${error.code || 'none'}`);
    throw error;
  } finally {
    await jobs?.stop();socket?.disconnect();
    if(io)await new Promise(resolve=>io.close(resolve));
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    try{if(mongoConnected){if(!mongoose.connection.name.startsWith('remarket_test_'))throw new Error('Refusing unsafe MongoDB test cleanup');await mongoose.connection.dropDatabase();}}
    finally{
      await mongoose.disconnect();await pool.end();
      try{if(schemaCreated){if(!/^remarket_test_[0-9a-f]{32}$/.test(schema))throw new Error('Refusing unsafe test schema cleanup');await ownerPool.query(`DROP SCHEMA "${schema}" CASCADE`);}}
      finally{await ownerPool.end();}
    }
  }
});
