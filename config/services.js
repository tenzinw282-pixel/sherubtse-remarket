const nodemailer = require('nodemailer');
const cloudinary = require('cloudinary').v2;

function createResendMail(config) {
  return {
    async sendMail({ from, to, subject, text, html }) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ from, to, subject, text, html }),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        // Avoid logging email addresses, API keys or provider response bodies.
        const error = new Error('Email provider rejected the request.');
        error.code = 'EMAIL_API_FAILED';
        error.status = response.status;
        throw error;
      }
      return { accepted: [to] };
    },
    close() {}
  };
}

function createServices(config) {
  cloudinary.config({ cloud_name: config.CLOUDINARY_CLOUD_NAME,
    api_key: config.CLOUDINARY_API_KEY, api_secret: config.CLOUDINARY_API_SECRET,
    secure: true });
  const mail = config.RESEND_API_KEY
    ? createResendMail(config)
    : nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465, requireTLS: config.SMTP_PORT !== 465,
      logger: false, debug: false, connectionTimeout: 15000, greetingTimeout: 15000,
      socketTimeout: 20000, disableFileAccess: true, disableUrlAccess: true,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
      tls: { rejectUnauthorized: true } });
  return { mail, images: cloudinary };
}
module.exports = { createServices };
