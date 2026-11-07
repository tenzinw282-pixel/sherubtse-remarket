const http = require('node:http');
const { Server } = require('socket.io');
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
  const io = new Server(server, { serveClient: false });
  io.engine.use(sessionMiddleware);
  // No rooms or events are exposed until authenticated features are implemented.
  io.use((socket, next) => next(new Error('Real-time features are not available yet')));
  server.listen(config.PORT, '0.0.0.0', () => console.log(`Sherubtse ReMarket listening on port ${config.PORT}`));
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    io.close();
    server.close(async () => { await databases.close(); clearTimeout(deadline); });
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
start().catch(error => {
  console.error('Startup failed. Check configuration, migrations, and service connectivity.', { type: error.name });
  process.exitCode = 1;
});
