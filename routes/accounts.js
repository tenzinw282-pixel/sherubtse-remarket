const express = require('express');
const { body, validationResult } = require('express-validator');
const { rateLimit } = require('express-rate-limit');
const bcrypt = require('bcrypt');
const { randomBytes } = require('node:crypto');
const { createAccounts, AccountError } = require('../services/accounts');

function accountRoutes({ pool, services, config }) {
  const router = express.Router();
  const accounts = createAccounts({ pool, mail: services.mail, config });
  const otpLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false,
    message: 'Too many email requests from this connection. Please try again in an hour.' });
  const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false });
  const attemptLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
  const show = (res, page, message = '', status = 200) => res.status(status).render(page, { title: page === 'register' ? 'Create account' : page === 'login' ? 'Log in' : 'Verify email', message });
  function problem(error, res, page) {
    if (error instanceof AccountError) return show(res, page, error.message, error.status);
    throw error;
  }
  router.get('/register', (req, res) => show(res, 'register'));
  router.post('/register', otpLimit, [
    body('fullName').isString().bail().trim().isLength({ min: 2, max: 120 }),
    body('email').isString().bail().trim().isEmail().isLength({ max: 254 }),
    body('studentId').optional({ values: 'falsy' }).isString().bail().trim().isLength({ max: 80 }),
    body('password').isString().bail().isLength({ min: 12 }).custom(value => Buffer.byteLength(value, 'utf8') <= 72),
    body('confirmPassword').custom((value, { req }) => value === req.body.password),
    body('terms').equals('on')
  ], async (req, res) => {
    if (!validationResult(req).isEmpty()) return show(res, 'register', 'Enter a name, valid email, matching passwords (12 characters minimum, 72 bytes maximum), and accept the terms.', 400);
    const email = req.body.email.toLowerCase();
    if (config.ALLOWED_EMAIL_DOMAIN && email.split('@')[1] !== config.ALLOWED_EMAIL_DOMAIN) return show(res, 'register', 'Use an email address from the configured college domain.', 400);
    try {
      const id = await accounts.register({ ...req.body, email });
      await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      req.session.csrfToken = res.locals.csrfToken = randomBytes(32).toString('hex');
      req.session.pendingUserId = id;
      await accounts.issueCode(id);
      res.redirect('/verify-email?sent=1');
    } catch (error) { problem(error, res, req.session.pendingUserId ? 'verify-email' : 'register'); }
  });
  router.get('/verify-email', (req, res) => {
    if (!req.session.pendingUserId) return res.redirect('/register');
    show(res, 'verify-email', req.query.sent === '1' ? 'Verification email accepted by the mail server. Check your inbox and spam folder.' : '');
  });
  router.post('/verify-email', attemptLimit, async (req, res) => {
    if (!req.session.pendingUserId) return res.redirect('/register');
    try {
      await accounts.verify(req.session.pendingUserId, req.body.code);
      delete req.session.pendingUserId;
      show(res, 'login', 'Email verified successfully. You can now log in.');
    } catch (error) { problem(error, res, 'verify-email'); }
  });
  router.post('/verify-email/resend', otpLimit, async (req, res) => {
    if (!req.session.pendingUserId) return res.redirect('/register');
    try { await accounts.issueCode(req.session.pendingUserId); res.redirect('/verify-email?sent=1'); }
    catch (error) { problem(error, res, 'verify-email'); }
  });
  router.get('/login', (req, res) => show(res, 'login'));
  router.post('/login', loginLimit, async (req, res) => {
    if (typeof req.body.email !== 'string' || typeof req.body.password !== 'string' || req.body.password.length > 1000) return show(res, 'login', 'Invalid email or password.', 401);
    const user = (await pool.query('SELECT * FROM users WHERE email = $1', [req.body.email.trim().toLowerCase()])).rows[0];
    // Compare against a dummy hash when absent to reduce timing-based enumeration.
    const hash = user?.password_hash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
    if (!await bcrypt.compare(req.body.password, hash) || !user || user.suspended_at) return show(res, 'login', 'Invalid email or password.', 401);
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    if (!user.email_verified_at) { req.session.pendingUserId = user.id; return res.redirect('/verify-email'); }
    req.session.userId = user.id;
    res.redirect(user.role==='admin'?'/admin':'/dashboard');
  });
  router.post('/logout', (req, res, next) => req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie('remarket.sid'); res.redirect('/login');
  }));
  return router;
}
module.exports = { accountRoutes };
