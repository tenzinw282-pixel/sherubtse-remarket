const dotenv = require('dotenv');
const path=require('node:path');
const {isIP}=require('node:net');
const {startupError}=require('./diagnostics');
dotenv.config({ path:path.join(__dirname,'../.env'),quiet:true });

function readConfig(env = process.env) {
  const required = ['DATABASE_URL', 'MONGODB_URI', 'SESSION_SECRET',
    'EMAIL_FROM', 'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  if (!env.RESEND_API_KEY?.trim()) required.push('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS');
  const fail=(code,message)=>{throw startupError('configuration',code,message);};
  const missing = required.filter(key => typeof env[key]!=='string'||!env[key].trim());
  if (missing.length) fail('CONFIG_MISSING',`Missing environment variables: ${missing.join(', ')}. Configure these in Render > service > Environment.`);
  const nodeEnv = env.NODE_ENV || (env.RENDER==='true'?'production':'development');
  if (!['development', 'test', 'production'].includes(nodeEnv)) fail('CONFIG_NODE_ENV','Invalid NODE_ENV; use development, test or production.');
  if(env.RENDER==='true'&&nodeEnv!=='production')fail('CONFIG_RENDER_ENV','Set NODE_ENV=production in Render Environment so proxy trust and secure cookies are enabled.');
  if (env.SESSION_SECRET.length < 32 || env.SESSION_SECRET.startsWith('replace-')) {
    fail('CONFIG_SESSION_SECRET','SESSION_SECRET must contain at least 32 random characters. Configure a private generated value in Render Environment.');
  }
  const configuredBase=env.APP_BASE_URL?.trim()||env.RENDER_EXTERNAL_URL?.trim();
  if(!configuredBase)fail('CONFIG_APP_BASE_URL','Missing APP_BASE_URL. Set it to the real public HTTPS origin in Render Environment, or use Render\'s RENDER_EXTERNAL_URL. APP_URL is not read by this application.');
  let base;
  try{base=new URL(configuredBase);}catch{fail('CONFIG_APP_BASE_URL','APP_BASE_URL must be a valid public HTTP(S) origin. Do not include quotes or credentials.');}
  if (!['http:', 'https:'].includes(base.protocol)||base.username||base.password||base.pathname!=='/'||base.search||base.hash) fail('CONFIG_APP_BASE_URL','APP_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment.');
  if (nodeEnv === 'production'){
    if(env.NODE_TLS_REJECT_UNAUTHORIZED==='0')fail('CONFIG_TLS_OVERRIDE','NODE_TLS_REJECT_UNAUTHORIZED=0 is forbidden in production. Restore certificate verification.');
    if(base.protocol!=='https:')fail('CONFIG_HTTPS','Production requires HTTPS: set APP_BASE_URL to your real https://SERVICE.onrender.com origin or verified custom domain in Render Environment. Express uses Render\'s HTTPS proxy; do not change this to HTTP.');
    const host=base.hostname.replace(/\.$/,'').replace(/^\[|\]$/g,'');
    if(isIP(host)||!host.includes('.')||['localhost','example.com','example.org','example.net','your-service.onrender.com','your-app.onrender.com'].includes(host)||/\.(localhost|local|internal|invalid|test|example)$/.test(host))fail('CONFIG_PUBLIC_ORIGIN','Production APP_BASE_URL must be the real public Render HTTPS domain or verified custom domain; localhost and placeholders are not valid.');
  }
  try{const url=new URL(env.DATABASE_URL);if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error();}catch{fail('CONFIG_DATABASE_URL','Invalid DATABASE_URL. Use the PostgreSQL connection string from Neon; no value is logged.');}
  if (!/^mongodb(\+srv)?:\/\//.test(env.MONGODB_URI)) fail('CONFIG_MONGODB_URI','Invalid MONGODB_URI. Use the MongoDB Atlas application connection string.');
  if(nodeEnv==='production'&&/[?&](?:tls|ssl)=false(?:&|$)|[?&](?:tlsInsecure|tlsAllowInvalidCertificates|tlsAllowInvalidHostnames)=true(?:&|$)/i.test(env.MONGODB_URI))fail('CONFIG_MONGODB_TLS','MONGODB_URI must not disable TLS or certificate/hostname verification in production.');
  function port(value, fallback) {
    const number = Number(value || fallback);
    if (!Number.isInteger(number) || number < 1 || number > 65535) fail('CONFIG_PORT','Invalid port: PORT and SMTP_PORT must be integers from 1 to 65535.');
    return number;
  }
  return Object.freeze({ ...env, NODE_ENV: nodeEnv, PORT: port(env.PORT, 3000),
    SMTP_PORT: port(env.SMTP_PORT, 587), APP_BASE_URL: base.origin,
    APP_BASE_URL_SOURCE:env.APP_BASE_URL?.trim()?'APP_BASE_URL':'RENDER_EXTERNAL_URL',
    ALLOWED_EMAIL_DOMAIN: (env.ALLOWED_EMAIL_DOMAIN || '').trim().toLowerCase() });
}
module.exports = { readConfig };
