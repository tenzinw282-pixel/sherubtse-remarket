require('dotenv').config({quiet:true});
const readline=require('node:readline');
const {Writable}=require('node:stream');
const bcrypt=require('bcrypt');
const {isEmail}=require('validator');
const {readConfig}=require('../config/env');
const {createPool}=require('../config/databases');
const {createServices}=require('../config/services');
const {createAccounts}=require('../services/accounts');
const {transaction,audit}=require('../services/database');
function inputError(message){const error=new Error(message);error.safe=true;return error;}
async function ask(label,hidden=false){
  if(!process.stdin.isTTY)throw inputError('Interactive input unavailable. Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD securely in your shell environment.');
  let muted=false;const output=new Writable({write(chunk,encoding,done){if(!muted)process.stdout.write(chunk);done();}});
  const input=readline.createInterface({input:process.stdin,output,terminal:true});process.stdout.write(label);muted=hidden;
  try{return await new Promise(resolve=>input.question('',resolve));}finally{input.close();if(hidden)process.stdout.write('\n');}
}
async function main(){
  const config=readConfig();const pool=createPool(config.DATABASE_URL);const services=createServices(config);
  try{
    const email=(process.env.ADMIN_EMAIL||await ask('Administrator email: ')).trim().toLowerCase();
    if(!isEmail(email))throw inputError('Provide a valid administrator email.');
    const existing=(await pool.query('SELECT id,role FROM users WHERE email=$1',[email])).rows[0];let id;
    if(existing){
      if(existing.role==='admin'){console.log('This account is already an administrator. No changes made.');return;}
      const confirmation=process.env.ADMIN_CONFIRM_PROMOTION||await ask('Type PROMOTE to grant administrator access to the existing account: ');
      if(confirmation!=='PROMOTE')throw inputError('Promotion cancelled. No account changes made.');id=existing.id;
    }else{
      const fullName=(process.env.ADMIN_NAME||await ask('Administrator full name: ')).trim();
      const password=process.env.ADMIN_PASSWORD||await ask('Strong password (hidden): ',true);
      if(fullName.length<2||fullName.length>120||password.length<12||Buffer.byteLength(password)>72)throw inputError('Use a name of 2–120 characters and a password of at least 12 characters, at most 72 UTF-8 bytes.');
      const hash=await bcrypt.hash(password,12);
      id=(await pool.query('INSERT INTO users(full_name,email,password_hash) VALUES ($1,$2,$3) RETURNING id',[fullName,email,hash])).rows[0].id;
    }
    await transaction(pool,async client=>{await client.query("UPDATE users SET role='admin',updated_at=now() WHERE id=$1",[id]);await audit(client,id,'admin_bootstrap',id,existing?'Explicitly confirmed existing-account promotion via protected CLI':'Administrator created via protected CLI; email verification still required');});
    if(!existing)await createAccounts({pool,mail:services.mail,config}).issueCode(id);
    console.log('Administrator access configured. Log in normally; unverified accounts must complete email verification before entering /admin.');
  }finally{services.mail.close();await pool.end();}
}
main().catch(error=>{console.error(error.safe||['AccountError'].includes(error.name)?error.message:'Administrator setup failed. Check input, database migrations and environment configuration; no credentials are logged.');process.exitCode=1;});
