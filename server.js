const http = require('node:http');
const {createRealtime}=require('./services/realtime');
const {startJobs}=require('./jobs/marketplace');
const { readConfig } = require('./config/env');
const { connectDatabases } = require('./config/databases');
const { createApp } = require('./app');

async function start() {
  let config;
  try { config = readConfig(); }
  catch (error) {
    // Configuration errors name fields only; connection errors below remain redacted.
    console.error('Configuration error:', error.message);
    process.exitCode = 1;
    return;
  }
  const databases = await connectDatabases(config);
  const { app, sessionMiddleware } = createApp({ config, pool: databases.pool, mongo: databases.mongoose });
  const server = http.createServer(app);
  const io=createRealtime({server,sessionMiddleware,pool:databases.pool,baseUrl:config.APP_BASE_URL});
  const publish=(room,event,data)=>io.to(room).emit(event,data);app.locals.publish=publish;
  app.locals.disconnectUser=id=>io.in(`user:${id}`).disconnectSockets(true);
  let jobs;
  server.on('error', async error => {
    await jobs?.stop();io.close();
    if (error.code === 'EADDRINUSE') console.error(`Port ${config.PORT} is already in use. Open http://localhost:${config.PORT} if ReMarket is already running, or stop the duplicate server before restarting.`);
    else console.error('HTTP server could not start. Check the port and local network permissions.');
    await databases.close();
    process.exitCode = 1;
  });
  server.listen(config.PORT, '0.0.0.0', () => {
    jobs=startJobs({pool:databases.pool,commerce:app.locals.commerce,publish});
    console.log(`Sherubtse ReMarket: http://localhost:${config.PORT}`);
  });
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    await jobs?.stop();
    await new Promise(resolve=>io.close(resolve));
    await databases.close();
    clearTimeout(deadline);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
start().catch(error => {
  console.error(error.name === 'DatabaseStartupError' ? error.message : 'Startup failed. Check configuration, migrations, and service connectivity.');
  process.exitCode = 1;
});
