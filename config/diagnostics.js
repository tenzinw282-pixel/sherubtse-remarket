// Log controlled guidance and error codes, never provider messages, URLs or stacks.
function errorCodes(error, depth=0, seen=new Set()) {
  if(!error || typeof error!=='object' || depth>4 || seen.has(error))return [];
  seen.add(error);
  const own=String(error.code||error.errorResponse?.code||'');
  const children=[error.cause,error.reason,...(Array.isArray(error.errors)?error.errors:[])];
  if(error.servers instanceof Map)for(const server of error.servers.values())children.push(server.error);
  return [...(own && /^[A-Za-z0-9_]{1,40}$/.test(own)?[own]:[]),...children.flatMap(child=>errorCodes(child,depth+1,seen))];
}
function startupError(stage, code, message, providerCodes=[]) {
  const error=new Error(message);
  error.name='StartupError';error.stage=stage;error.code=code;error.providerCodes=[...new Set(providerCodes)];error.publicDiagnostic=true;
  return error;
}
function logFailure(stage,error) {
  const record={stage:error?.publicDiagnostic?error.stage:stage,
    code:error?.publicDiagnostic?error.code:'UNEXPECTED_ERROR',
    providerCodes:error?.publicDiagnostic?error.providerCodes:errorCodes(error),
    message:error?.publicDiagnostic?error.message:error?.code==='MODULE_NOT_FOUND'?'A required module is missing. Run npm ci with the pinned Node 22 runtime and ensure all required source files are committed.':'Unexpected failure. Check dependency installation, configuration and the preceding startup stage.'};
  console.error(JSON.stringify({level:'error',...record}));
}
function logStage(stage,message) { console.log(JSON.stringify({level:'info',stage,message})); }
module.exports={errorCodes,startupError,logFailure,logStage};
