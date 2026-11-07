const express = require('express');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const { rateLimit } = require('express-rate-limit');
const { requireVerified } = require('../middleware/auth');
const { createImages, ImageError, imageFormat } = require('../services/images');
const {createCatalog}=require('../services/catalog');
const {UserError,transaction,uuid,text,money}=require('../services/database');
function productRoutes({ pool, services }) {
  const router = express.Router();
  const images = createImages(services.images);
  const catalog=createCatalog(pool);
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
    const category = await pool.query('SELECT id FROM categories WHERE id = $1 AND active=true',[req.body.categoryId]);
    if (!category.rowCount) return res.status(400).json({ error:'Choose an available category.' });
    const uploaded = [];
    const sellingType=req.body.sellingType||'fixed';
    if(!['fixed','auction'].includes(sellingType))throw new UserError('Choose fixed-price or auction selling.');
    let startsAt,endsAt;
    if(sellingType==='auction'){
      money(req.body.increment);startsAt=new Date(req.body.startsAt);endsAt=new Date(req.body.endsAt);
      const databaseTime=(await pool.query('SELECT clock_timestamp() AS now')).rows[0].now;
      if(!Number.isFinite(startsAt.getTime())||!Number.isFinite(endsAt.getTime())||endsAt<=startsAt||endsAt<=new Date(databaseTime))throw new UserError('Choose valid auction dates, with an end time in the future.');
    }
    let client;
    try {
      req.files.forEach(file => imageFormat(file.buffer));
      for (const file of req.files) uploaded.push(await images.upload(file));
      client = await pool.connect();
      await client.query('BEGIN');
      const user = (await client.query('SELECT email_verified_at, suspended_at FROM users WHERE id = $1 FOR UPDATE',[req.user.id])).rows[0];
      if (!user?.email_verified_at || user.suspended_at) throw new ImageError('Your account is no longer permitted to create listings.',403);
      const product = (await client.query(`INSERT INTO products(seller_id,category_id,title,description,condition,selling_type,price)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[req.user.id,req.body.categoryId,req.body.title,req.body.description,req.body.condition,sellingType,req.body.price])).rows[0];
      if(sellingType==='auction')await client.query('INSERT INTO auctions(product_id,starting_price,minimum_increment,starts_at,ends_at) VALUES ($1,$2,$3,$4,$5)',[product.id,req.body.price,req.body.increment,startsAt,endsAt]);
      for (const [position,image] of uploaded.entries()) await client.query('INSERT INTO product_images(product_id,public_id,secure_url,position) VALUES ($1,$2,$3,$4)',[product.id,image.publicId,image.url,position]);
      await client.query('COMMIT');
      res.status(201).json({ message:'Images uploaded. Your listing is pending administrator approval.', redirect:`/products/${product.id}` });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      await images.remove(uploaded);
      res.status(error instanceof ImageError ? error.status : 503).json({ error: error instanceof ImageError ? error.message : 'Could not save the listing. Check database connectivity and migrations, then try again.' });
    } finally { client?.release(); }
  });
  router.get('/products/:id',async (req,res) => {
    const {product,photos}=await catalog.detail(req.params.id,req.user);
    const auction=product.auction_id?(await pool.query('SELECT * FROM auctions WHERE id=$1',[product.auction_id])).rows[0]:null;
    const favorite=req.user?(await pool.query('SELECT 1 FROM favorites WHERE user_id=$1 AND product_id=$2',[req.user.id,product.id])).rowCount>0:false;
    res.render('product',{ title:product.title,product,photos,auction,favorite,reported:req.query.reported==='1' });
  });
  router.get('/products/:id/edit',requireVerified,async(req,res)=>{
    const {product}=await catalog.detail(req.params.id,req.user);
    if(product.seller_id!==req.user.id)throw new UserError('Only the listing owner can edit it.',403);
    const auction=(await pool.query('SELECT * FROM auctions WHERE product_id=$1',[product.id])).rows[0]||null;
    res.render('edit-product',{title:'Edit listing',product,auction,categories:await catalog.categories()});
  });
  async function editable(client,id,userId){
    const p=(await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE',[uuid(id)])).rows[0];
    if(!p||p.seller_id!==userId)throw new UserError('Only the listing owner can modify it.',403);
    const commitments=await client.query(`SELECT 1 FROM transactions WHERE product_id=$1 AND status<>'cancelled'
      UNION ALL SELECT 1 FROM bids b JOIN auctions a ON a.id=b.auction_id WHERE a.product_id=$1 LIMIT 1`,[id]);
    if(commitments.rowCount||['reserved','sold'].includes(p.status))throw new UserError('Listings with bids or active transactions cannot be edited or withdrawn.');
    return p;
  }
  router.post('/products/:id/edit',requireVerified,async(req,res)=>{
    const title=text(req.body.title,3,160,'Title'),description=text(req.body.description,10,10000,'Description');money(req.body.price);
    if(!['New','Like New','Good','Fair','Used'].includes(req.body.condition))throw new UserError('Choose a condition.');
    await transaction(pool,async client=>{
      const p=await editable(client,req.params.id,req.user.id);
      if(!/^\d+$/.test(req.body.categoryId||'')||!(await client.query('SELECT id FROM categories WHERE id=$1 AND active=true',[req.body.categoryId])).rowCount)throw new UserError('Choose an active category.');
      if(p.selling_type==='auction'){
        money(req.body.increment);const start=new Date(req.body.startsAt),end=new Date(req.body.endsAt);
        const databaseTime=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
        if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start||end<=new Date(databaseTime))throw new UserError('Choose valid future auction dates.');
        await client.query("UPDATE auctions SET starting_price=$2,minimum_increment=$3,starts_at=$4,ends_at=$5,status='open',closed_at=NULL WHERE product_id=$1",[p.id,req.body.price,req.body.increment,start,end]);
      }
      await client.query("UPDATE products SET title=$2,description=$3,category_id=$4,condition=$5,price=$6,moderation_status='pending',moderation_reason='',reviewed_at=NULL,reviewed_by=NULL,status='available',updated_at=now() WHERE id=$1",[p.id,title,description,req.body.categoryId,req.body.condition,req.body.price]);
    });res.redirect(`/products/${req.params.id}`);
  });
  router.post('/products/:id/withdraw',requireVerified,async(req,res)=>{
    await transaction(pool,async client=>{
      const p=await editable(client,req.params.id,req.user.id);
      await client.query("UPDATE products SET status='removed',updated_at=now() WHERE id=$1",[p.id]);
      await client.query("UPDATE auctions SET status='cancelled',closed_at=now() WHERE product_id=$1",[p.id]);
    });res.redirect('/dashboard/listings');
  });
  return router;
}
module.exports = { productRoutes };
