const path=require('node:path');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
// Identify this checkout without exposing its filesystem path or any credentials.
const workspaceId=createHash('sha256').update(process.platform==='win32'?root.toLowerCase():root).digest('hex').slice(0,16);
async function existingServer(port){
  try{
    const response=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(5000)});
    const sameWorkspace=response.headers.get('X-ReMarket-Workspace')===workspaceId;
    await response.arrayBuffer();
    return sameWorkspace?{healthy:response.ok}:null;
  }catch{return null;}
}
function reportExisting(port,server){
  console.log(`Sherubtse ReMarket is already running: http://localhost:${port}`);
  if(!server.healthy)console.error('The existing server reports a database connection problem. Check its terminal output.');
  console.log('Use the running website. To restart it, press Ctrl+C in its original terminal, then run npm.cmd run dev once.');
}
module.exports={root,workspaceId,existingServer,reportExisting};
