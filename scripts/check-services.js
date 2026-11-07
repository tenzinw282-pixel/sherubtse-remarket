// Never print provider errors: they may contain credentials or SMTP message content.
require('dotenv').config({ quiet: true });
const { createServices } = require('../config/services');
const { connectionAdvice } = require('../services/service-errors');
async function main() {
  const config = { ...process.env, SMTP_PORT: Number(process.env.SMTP_PORT || 587) };
  const checks = [
    ['SMTP', ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'], async services => services.mail.verify()],
    ['Cloudinary', ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'], async services => services.images.api.ping()]
  ];
  const services = createServices(config);
  for (const [name, fields, check] of checks) {
    if (fields.some(key => !config[key] || /^(replace-me|smtp\.example\.com)$/.test(config[key]))) {
      console.error(`${name}: configuration incomplete. Set ${fields.join(', ')} in .env.`);
      process.exitCode = 1;
      continue;
    }
    try { await check(services); console.log(`${name}: connection and authentication successful.`); }
    catch (error) { console.error(`${name}: ${connectionAdvice(name, error)}`); process.exitCode = 1; }
  }
  services.mail.close();
}
main().catch(() => { console.error('Service checks failed. Review environment configuration.'); process.exitCode = 1; });
