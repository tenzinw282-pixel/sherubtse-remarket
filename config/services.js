const nodemailer = require('nodemailer');
const cloudinary = require('cloudinary').v2;

function createServices(config) {
  cloudinary.config({ cloud_name: config.CLOUDINARY_CLOUD_NAME,
    api_key: config.CLOUDINARY_API_KEY, api_secret: config.CLOUDINARY_API_SECRET,
    secure: true });
  return {
    mail: nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465, requireTLS: config.SMTP_PORT !== 465,
      logger: false, debug: false, connectionTimeout: 15000, greetingTimeout: 15000,
      socketTimeout: 20000, disableFileAccess: true, disableUrlAccess: true,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
      tls: { rejectUnauthorized: true } }),
    images: cloudinary
  };
}
module.exports = { createServices };
