const { randomBytes, timingSafeEqual } = require('node:crypto');

function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const supplied = req.body?._csrf || req.get('X-CSRF-Token');
  const expected = Buffer.from(req.session.csrfToken);
  if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== expected.length ||
      !timingSafeEqual(Buffer.from(supplied), expected)) {
    return res.status(403).render('error', { title: 'Request rejected',
      message: 'Your form expired. Reload the page and try again.' });
  }
  next();
}
module.exports = { csrfProtection };
