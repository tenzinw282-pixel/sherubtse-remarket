const express = require('express');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const { rateLimit } = require('express-rate-limit');
const { requireVerified } = require('../middleware/auth');
const { createImages, ImageError, imageFormat } = require('../services/images');
function productRoutes({ pool, services }) {
  const router = express.Router();
  const images = createImages(services.images);
  const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5*1024*1024, files: 5, fields: 12, parts: 18 },
    fileFilter: (req, file, done) => ['image/jpeg','image/png','image/webp'].includes(file.mimetype) ? done(null, true) : done(new ImageError('Only JPEG, PNG and WebP images are allowed.')) }).array('images',5);
  const limit = rateLimit({ windowMs: 15*60*1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
  const upload = (req,res,next) => parse(req,res,error => {
    if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 5 MB or smaller.' : 'Use up to five JPEG, PNG or WebP images and keep text fields short.' });
    next();
  });
  router.get('/sell', requireVerified, async (req,res) => {
    const categories = (await pool.query('SELECT id, name FROM categories ORDER BY id')).rows;
    res.render('sell', { title: 'Sell an item', categories });
  });
  router.post('/sell', requireVerified, limit, upload, [
    body('title').trim().isLength({ min:3,max:160 }), body('description').trim().isLength({ min:10,max:10000 }),
    body('categoryId').isInt({ min:1,max:32767 }), body('condition').isIn(['New','Like New','Good','Fair','Used']),
    body('price').matches(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/).custom(value => /[1-9]/.test(value))
  ], async (req,res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).json({ error:'Enter a title (3–160 characters), description (10–10000), category, condition and positive price with up to two decimals.' });
    if (!req.files?.length) return res.status(400).json({ error:'Add one to five JPEG, PNG or WebP images.' });
    const category = await pool.query('SELECT id FROM categories WHERE id = $1',[req.body.categoryId]);
    if (!category.rowCount) return res.status(400).json({ error:'Choose an available category.' });
    const uploaded = [];
    let client;
    try {
      req.files.forEach(file => imageFormat(file.buffer));
      for (const file of req.files) uploaded.push(await images.upload(file));
      client = await pool.connect();
      await client.query('BEGIN');
      const user = (await client.query('SELECT email_verified_at, suspended_at FROM users WHERE id = $1 FOR UPDATE',[req.user.id])).rows[0];
      if (!user?.email_verified_at || user.suspended_at) throw new ImageError('Your account is no longer permitted to create listings.',403);
      const product = (await client.query(`INSERT INTO products(seller_id,category_id,title,description,condition,selling_type,price)
        VALUES ($1,$2,$3,$4,$5,'fixed',$6) RETURNING id`,[req.user.id,req.body.categoryId,req.body.title,req.body.description,req.body.condition,req.body.price])).rows[0];
      for (const [position,image] of uploaded.entries()) await client.query('INSERT INTO product_images(product_id,public_id,secure_url,position) VALUES ($1,$2,$3,$4)',[product.id,image.publicId,image.url,position]);
      await client.query('COMMIT');
      res.status(201).json({ message:'Product created and images uploaded successfully.', redirect:`/products/${product.id}` });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      await images.remove(uploaded);
      res.status(error instanceof ImageError ? error.status : 503).json({ error: error instanceof ImageError ? error.message : 'Could not save the listing. Check database connectivity and migrations, then try again.' });
    } finally { client?.release(); }
  });
  router.get('/products/:id',async (req,res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).render('error',{ title:'Not found',message:'Product not found.' });
    const product = (await pool.query(`SELECT p.*,u.full_name AS seller_name FROM products p JOIN users u ON u.id=p.seller_id
      WHERE p.id=$1 AND p.status='available'`,[req.params.id])).rows[0];
    if (!product) return res.status(404).render('error',{ title:'Not found',message:'Product not found.' });
    const photos = (await pool.query('SELECT secure_url FROM product_images WHERE product_id=$1 ORDER BY position',[product.id])).rows;
    res.render('product',{ title:product.title,product,photos });
  });
  return router;
}
module.exports = { productRoutes };
