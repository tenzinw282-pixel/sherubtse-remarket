const dotenv = require('dotenv');
dotenv.config({ quiet: true });

function readConfig(env = process.env) {
  const required = ['DATABASE_URL', 'MONGODB_URI', 'SESSION_SECRET', 'APP_BASE_URL',
    'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const missing = required.filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  const nodeEnv = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('Invalid NODE_ENV');
  if (env.SESSION_SECRET.length < 32 || env.SESSION_SECRET.startsWith('replace-')) {
    throw new Error('SESSION_SECRET must contain at least 32 random characters');
  }
  const base = new URL(env.APP_BASE_URL);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('APP_BASE_URL must be HTTP(S)');
  if (nodeEnv === 'production' && base.protocol !== 'https:') throw new Error('Production requires HTTPS');
  if (!/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) throw new Error('Invalid DATABASE_URL');
  if (!/^mongodb(\+srv)?:\/\//.test(env.MONGODB_URI)) throw new Error('Invalid MONGODB_URI');
  function port(value, fallback) {
    const number = Number(value || fallback);
    if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error('Invalid port');
    return number;
  }
  return Object.freeze({ ...env, NODE_ENV: nodeEnv, PORT: port(env.PORT, 3000),
    SMTP_PORT: port(env.SMTP_PORT, 587), APP_BASE_URL: base.origin,
    ALLOWED_EMAIL_DOMAIN: (env.ALLOWED_EMAIL_DOMAIN || '').trim().toLowerCase() });
}
module.exports = { readConfig };
