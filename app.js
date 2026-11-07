const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const path = require('node:path');
const { csrfProtection } = require('./middleware/csrf');
const { createServices } = require('./config/services');
const { loadUser } = require('./middleware/auth');
const { accountRoutes } = require('./routes/accounts');
const { productRoutes } = require('./routes/products');
const { marketplaceRoutes } = require('./routes/marketplace');
const { studentRoutes } = require('./routes/students');
const {adminRoutes}=require('./routes/admin');
const {commerceRoutes}=require('./routes/commerce');
const {createCommerce}=require('./services/commerce');
const {communityRoutes}=require('./routes/community');

function createApp({ config, pool, mongo, sessionStore, services = createServices(config), communityModels }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(helmet({ strictTransportSecurity: config.NODE_ENV === 'production' ? undefined : false,
    contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'https://res.cloudinary.com'],
      upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null } } }));
  app.use('/assets', express.static(path.join(__dirname, 'public')));
  app.use('/vendor/bootstrap', express.static(path.join(__dirname, 'node_modules/bootstrap/dist')));
  app.use('/vendor/icons', express.static(path.join(__dirname, 'node_modules/bootstrap-icons/font')));
  app.use('/vendor/inter', express.static(path.join(__dirname, 'node_modules/@fontsource-variable/inter/files')));
  app.get('/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      if (mongo.connection.readyState !== 1) throw new Error('MongoDB unavailable');
      await mongo.connection.db.admin().ping();
      res.json({ status: 'ok' });
    } catch { res.status(503).json({ status: 'unavailable' }); }
  });
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(express.json({ limit: '32kb' }));
  const sessionMiddleware = session({ name: 'remarket.sid',
    store: sessionStore || new PgSession({ pool, tableName: 'sessions', createTableIfMissing: false }),
    secret: config.SESSION_SECRET, resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7 } });
  app.use(sessionMiddleware);
  app.use(csrfProtection);
  app.use(loadUser(pool));
  app.locals.services = services;
  const commerce=createCommerce(pool,(...args)=>app.locals.publish?.(...args));app.locals.commerce=commerce;
  app.use(accountRoutes({ config, pool, services }));
  app.use(productRoutes({ pool, services }));
  app.use(studentRoutes({ pool, services }));
  app.use(adminRoutes({pool}));
  app.use(commerceRoutes({pool,commerce}));
  app.use(communityRoutes({pool,models:communityModels,publish:(...args)=>app.locals.publish?.(...args)}));
  app.use(marketplaceRoutes({ pool }));
  app.get('/terms', (req, res) => res.render('terms', { title: 'Terms and privacy' }));
  app.use((req, res) => res.status(404).render('error', { title: 'Page not found',
    message: 'This page is not available.' }));
  app.use((error, req, res, next) => {
    console.error('Request failed', { type: error.name });
    if (res.headersSent) return next(error);
    const status=error.safe?error.status:400===error.status?400:500;
    const message=error.safe?error.message:'We could not complete your request. Please try again.';
    if(req.get('X-CSRF-Token'))return res.status(status).json({error:message});
    res.status(status).render('error', {title:status===404?'Not found':'Request failed',message});
  });
  return { app, sessionMiddleware };
}
module.exports = { createApp };
