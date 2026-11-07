const { randomUUID } = require('node:crypto');
const { connectionAdvice } = require('./service-errors');
class ImageError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.safe=true; }
}
function imageFormat(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP') return 'webp';
  throw new ImageError('Only valid JPEG, PNG and WebP images are allowed.');
}
function createImages(cloudinary) {
  async function upload(file) {
    const format = imageFormat(file.buffer);
    if (file.mimetype !== `image/${format}`) throw new ImageError('Image contents do not match the declared file type.');
    if (file.buffer.length > 5 * 1024 * 1024) throw new ImageError('Each image must be 5 MB or smaller.');
    try {
      return await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ resource_type: 'image', folder: 'remarket/products', public_id: randomUUID(),
          allowed_formats: ['jpg','jpeg','png','webp'], format: 'webp',
          transformation: [{ width: 1600, height: 1600, crop: 'limit' }], timeout: 30000
        }, (error, result) => {
          if (error) return reject(error);
          if (!result?.public_id || !result.secure_url?.startsWith('https://')) return reject(new Error('Invalid upload response'));
          resolve({ publicId: result.public_id, url: result.secure_url });
        });
        stream.on('error', reject);
        stream.end(file.buffer);
      });
    } catch (error) { throw new ImageError(`Image upload failed. ${connectionAdvice('Cloudinary', error)}`, 502); }
  }
  async function remove(images) {
    const results = await Promise.allSettled(images.map(image => cloudinary.uploader.destroy(image.publicId, { resource_type: 'image', invalidate: true })));
    if (results.some(result => result.status === 'rejected' || !['ok','not found'].includes(result.value?.result))) console.error('Cloudinary cleanup incomplete; inspect unused assets in remarket/products.');
  }
  return { upload, remove };
}
module.exports = { createImages, ImageError, imageFormat };
