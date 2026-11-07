require('dotenv').config({ quiet: true });
const { createServices } = require('../config/services');
const { createImages } = require('../services/images');
async function main() {
  const config = { ...process.env, SMTP_PORT: Number(process.env.SMTP_PORT || 587) };
  const services = createServices(config);
  // A disposable one-pixel PNG, never a seeded marketplace product.
  const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9l8AAAAASUVORK5CYII=', 'base64');
  try {
    const image = await createImages(services.images).upload({ buffer, mimetype: 'image/png' });
    console.log('Cloudinary: real image upload successful.');
    const result = await services.images.uploader.destroy(image.publicId, { resource_type: 'image', invalidate: true });
    if (result.result !== 'ok') throw new Error('Cleanup failed');
    console.log('Cloudinary: temporary test image deleted successfully.');
  } finally { services.mail.close(); }
}
main().catch(() => { console.error('Cloudinary upload/delete check failed. Check credentials, image restrictions and network connectivity; inspect remarket/products for a temporary test asset.'); process.exitCode = 1; });
