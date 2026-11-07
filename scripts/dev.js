require('dotenv').config({quiet:true});
const {spawn}=require('node:child_process');
const {root,existingServer,reportExisting}=require('../config/runtime');
async function main(){
  const port=Number(process.env.PORT||3000);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be an integer between 1 and 65535.');
  const existing=await existingServer(port);
  if(existing){reportExisting(port,existing);return;}
  const child=spawn(process.execPath,['--watch', 'server.js'],{cwd:root,stdio:'inherit',env:process.env});
  child.on('error',()=>{console.error('Could not launch Node.js development server.');process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code||0;});
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
