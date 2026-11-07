const http = require('node:http');
const {logStage,logFailure,startupError}=require('./config/diagnostics');

async function start() {
  let stage='configuration',databases,server,io,jobs,stopping=false;
  const interrupted=signal=>{
    logFailure('startup',startupError('startup','STARTUP_INTERRUPTED',`Process received ${signal} before readiness during ${stage}. Check platform deploy cancellation, migration connection and lock diagnostics.`),{synchronous:true});
    process.exit(1);
  };
  const onStartupTerm=()=>interrupted('SIGTERM'),onStartupInt=()=>interrupted('SIGINT');
  process.once('SIGTERM',onStartupTerm);process.once('SIGINT',onStartupInt);
  function removeStartupSignals(){process.removeListener('SIGTERM',onStartupTerm);process.removeListener('SIGINT',onStartupInt);}
  async function shutdown(){
    if(stopping)return;stopping=true;
    const deadline=setTimeout(()=>process.exit(1),10000);deadline.unref();
    try{
      await jobs?.stop();
      if(io)await new Promise(resolve=>io.close(resolve));
      else if(server?.listening)await new Promise(resolve=>server.close(resolve));
    }finally{await databases?.close();clearTimeout(deadline);}
  }
  try{
    // Load application dependencies inside this boundary so import failures are logged too.
    const {readConfig}=require('./config/env');
    const config=readConfig();
    logStage(stage,`Validated ${config.NODE_ENV} configuration; origin source ${config.APP_BASE_URL_SOURCE}; Node ${process.version}.`);
    if(config.APP_URL)console.warn('APP_URL is ignored. APP_BASE_URL is the canonical public origin setting.');
    const {existingServer,reportExisting}=require('./config/runtime');
    if(config.NODE_ENV==='development'){
      const existing=await existingServer(config.PORT);
      if(existing){removeStartupSignals();reportExisting(config.PORT,existing);return;}
    }
    stage='migrations';logStage(stage,'Checking locked, checksum-verified PostgreSQL migrations using a direct connection.');
    await require('./scripts/migrate').runMigrations(config);
    stage='databases';
    databases=await require('./config/databases').connectDatabases(config);
    logStage(stage,'PostgreSQL schema and MongoDB connection verified.');
    stage='mongodb-indexes';await require('./scripts/sync-mongo-indexes').createMongoIndexes();
    logStage(stage,'MongoDB indexes verified.');
    stage='application';
    const {app,sessionMiddleware}=require('./app').createApp({config,pool:databases.pool,mongo:databases.mongoose});
    server=http.createServer(app);
    io=require('./services/realtime').createRealtime({server,sessionMiddleware,pool:databases.pool,baseUrl:config.APP_BASE_URL});
    const publish=(room,event,data)=>io.to(room).emit(event,data);app.locals.publish=publish;
    app.locals.disconnectUser=id=>io.in(`user:${id}`).disconnectSockets(true);
    stage='listen';
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(config.PORT,'0.0.0.0',()=>{server.removeListener('error',reject);resolve();});
    });
    jobs=require('./jobs/marketplace').startJobs({pool:databases.pool,commerce:app.locals.commerce,publish});
    stage='ready';removeStartupSignals();
    logStage('ready',`Listening on 0.0.0.0:${config.PORT}; public origin ${config.APP_BASE_URL}.`);
    server.on('error',error=>{logFailure('http-runtime',error);process.exitCode=1;void shutdown().catch(failure=>logFailure('shutdown',failure));});
    const onSignal=()=>void shutdown().catch(error=>{logFailure('shutdown',error);process.exitCode=1;});
    process.once('SIGTERM',onSignal);process.once('SIGINT',onSignal);
    return {server,app,shutdown};
  }catch(error){
    removeStartupSignals();
    if(!error.migrationLogged)logFailure(stage,error,{synchronous:true});
    if(error.code==='EADDRINUSE')console.error('The configured PORT is already in use. Stop the duplicate process or configure another PORT.');
    try{await shutdown();}catch(failure){logFailure('shutdown',failure);}
    process.exitCode=1;
    return null;
  }
}
if(require.main===module)start().catch(error => {
  logFailure('bootstrap',error);
  process.exitCode = 1;
});
module.exports={start};
