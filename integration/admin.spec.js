require('dotenv').config({quiet:true});
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {Pool}=require('pg');
const bcrypt=require('bcrypt');
const {migrate}=require('../scripts/migrate');
test('administrator CLI requires explicit promotion, preserves account data and is idempotent',{timeout:90000},async()=>{
  const schema=`remarket_test_${randomUUID().replaceAll('-','')}`;
  const uri=new URL(process.env.TEST_DATABASE_URL||process.env.DATABASE_URL);if(uri.hostname.endsWith('.neon.tech'))uri.hostname=uri.hostname.replace('-pooler.','.');
  const owner=new Pool({connectionString:uri.toString()});uri.searchParams.set('options',`-c search_path=${schema}`);
  const pool=new Pool({connectionString:uri.toString()});let created=false;
  try{
    await owner.query(`CREATE SCHEMA "${schema}"`);created=true;await migrate(pool);
    const email='admin-cli@example.test',hash=await bcrypt.hash('test-only-strong-password',4);
    const user=(await pool.query('INSERT INTO users(full_name,email,password_hash,email_verified_at,bio) VALUES ($1,$2,$3,now(),$4) RETURNING id',['CLI Test Student',email,hash,'Profile must survive promotion.'])).rows[0];
    const product=(await pool.query("INSERT INTO products(seller_id,category_id,title,description,condition,selling_type,price) VALUES ($1,1,'Preserved listing','Listing attached to the existing student account','Good','fixed',10) RETURNING id",[user.id])).rows[0];
    const env={...process.env,NODE_ENV:'test',DATABASE_URL:uri.toString(),ADMIN_EMAIL:email,ADMIN_CONFIRM_PROMOTION:'NO'};
    await assert.rejects(promisify(execFile)(process.execPath,['scripts/create-admin.js'],{cwd:process.cwd(),env,timeout:20000}),error=>error.code===1);
    assert.equal((await pool.query('SELECT role FROM users WHERE id=$1',[user.id])).rows[0].role,'student');
    env.ADMIN_CONFIRM_PROMOTION='PROMOTE';await promisify(execFile)(process.execPath,['scripts/create-admin.js'],{cwd:process.cwd(),env,timeout:20000});
    const promoted=(await pool.query('SELECT * FROM users WHERE id=$1',[user.id])).rows[0];assert.equal(promoted.role,'admin');assert.equal(promoted.password_hash,hash);assert.equal(promoted.bio,'Profile must survive promotion.');
    assert.equal((await pool.query('SELECT seller_id FROM products WHERE id=$1',[product.id])).rows[0].seller_id,user.id);
    await promisify(execFile)(process.execPath,['scripts/create-admin.js'],{cwd:process.cwd(),env,timeout:20000});
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM users WHERE email=$1',[email])).rows[0].count,1);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM admin_actions WHERE action='admin_bootstrap'")).rows[0].count,1);
  }finally{await pool.end();try{if(created&&/^remarket_test_[0-9a-f]{32}$/.test(schema))await owner.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await owner.end();}}
});
