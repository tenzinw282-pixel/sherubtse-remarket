const express=require('express');
const multer=require('multer');
const {requireVerified}=require('../middleware/auth');
const {UserError,transaction,uuid,text,notify}=require('../services/database');
const {createImages}=require('../services/images');
const {createCatalog,select}=require('../services/catalog');
function studentRoutes({pool,services}){
  const router=express.Router();const images=createImages(services.images);const catalog=createCatalog(pool);
  const avatar=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:5}}).single('avatar');
  router.get('/users/:id',async(req,res)=>{
    const user=(await pool.query('SELECT id,full_name,bio,avatar_url,created_at,email_verified_at FROM users WHERE id=$1 AND suspended_at IS NULL',[uuid(req.params.id)])).rows[0];
    if(!user)throw new UserError('Student profile not found.',404);
    const results=await catalog.browse({seller:user.id});res.render('student-profile',{title:user.full_name,student:user,products:results.products});
  });
  router.get('/profile',requireVerified,(req,res)=>res.render('profile',{title:'Profile settings'}));
  router.post('/profile',requireVerified,(req,res,next)=>avatar(req,res,error=>error?next(new UserError('Choose one JPEG, PNG or WebP image, up to 5 MB.')):next()),async(req,res)=>{
    const fullName=text(req.body.fullName,2,120,'Full name'),bio=text(req.body.bio||'',0,1000,'Bio'),studentId=text(req.body.studentId||'',0,80,'Student ID');
    let uploaded;
    try{
      if(req.file)uploaded=await images.upload(req.file);
      const previous=(await pool.query('SELECT avatar_public_id FROM users WHERE id=$1',[req.user.id])).rows[0];
      await pool.query(`UPDATE users SET full_name=$2,bio=$3,student_id=$4,avatar_url=coalesce($5,avatar_url),avatar_public_id=coalesce($6,avatar_public_id),updated_at=now() WHERE id=$1`,[req.user.id,fullName,bio,studentId||null,uploaded?.url||null,uploaded?.publicId||null]);
      if(uploaded&&previous?.avatar_public_id)await images.remove([{publicId:previous.avatar_public_id}]);
      res.json({message:'Profile updated successfully.',redirect:'/profile'});
    }catch(error){if(uploaded)await images.remove([uploaded]);throw error;}
  });
  router.get(['/dashboard','/dashboard/:section'],requireVerified,async(req,res)=>{
    const section=req.params.section||'overview';
    if(!['overview','listings','purchases','sales','bids','won-auctions','favorites'].includes(section))throw new UserError('Dashboard section not found.',404);
    const stats=(await pool.query(`SELECT
      (SELECT count(*) FROM products WHERE seller_id=$1) AS listings,
      (SELECT count(*) FROM products WHERE seller_id=$1 AND status='available' AND moderation_status='approved') AS active,
      (SELECT count(*) FROM products WHERE seller_id=$1 AND status='sold') AS sold,
      (SELECT count(DISTINCT b.auction_id) FROM bids b JOIN auctions a ON a.id=b.auction_id WHERE b.bidder_id=$1 AND a.status='open') AS bids,
      (SELECT count(*) FROM transactions WHERE buyer_id=$1 AND auction_id IS NOT NULL) AS won`,[req.user.id])).rows[0]||{};
    let products=[],sales=[],bids=[];
    if(['overview','listings','favorites'].includes(section))products=(await pool.query(`${select} WHERE ${section==='favorites'?"p.id IN (SELECT product_id FROM favorites WHERE user_id=$1) AND p.moderation_status='approved' AND p.status<>'removed'":"p.seller_id=$1"} ORDER BY p.created_at DESC LIMIT 100`,[req.user.id])).rows;
    if(['purchases','sales','won-auctions'].includes(section))sales=(await pool.query(`SELECT t.*,p.title,u.full_name AS counterpart FROM transactions t JOIN products p ON p.id=t.product_id JOIN users u ON u.id=${section==='sales'?'t.buyer_id':'t.seller_id'} WHERE ${section==='sales'?'t.seller_id':'t.buyer_id'}=$1 ${section==='won-auctions'?'AND t.auction_id IS NOT NULL':''} ORDER BY t.created_at DESC LIMIT 100`,[req.user.id])).rows;
    if(section==='bids')bids=(await pool.query(`SELECT b.*,a.product_id,a.status,a.ends_at,a.highest_bid_id,p.title FROM bids b JOIN auctions a ON a.id=b.auction_id JOIN products p ON p.id=a.product_id WHERE b.bidder_id=$1 ORDER BY b.created_at DESC LIMIT 100`,[req.user.id])).rows;
    res.render('dashboard',{title:section==='overview'?'Your dashboard':section.replaceAll('-',' '),section,stats,products,sales,bids});
  });
  router.post('/products/:id/favorite',requireVerified,async(req,res)=>{
    const id=uuid(req.params.id);await catalog.detail(id,req.user);
    await transaction(pool,async client=>{const prior=await client.query('DELETE FROM favorites WHERE user_id=$1 AND product_id=$2 RETURNING product_id',[req.user.id,id]);if(!prior.rowCount)await client.query('INSERT INTO favorites(user_id,product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[req.user.id,id]);});res.redirect(`/products/${id}`);
  });
  router.post('/products/:id/report',requireVerified,async(req,res)=>{
    const id=uuid(req.params.id);await catalog.detail(id,req.user);const reason=text(req.body.reason,5,2000,'Report reason');
    await transaction(pool,async client=>{
      const report=(await client.query('INSERT INTO reports(product_id,reporter_id,reason) VALUES ($1,$2,$3) RETURNING id',[id,req.user.id,reason])).rows[0];
      const admins=(await client.query("SELECT id FROM users WHERE role='admin' AND suspended_at IS NULL")).rows;
      for(const admin of admins)await notify(client,admin.id,`report:${report.id}:${admin.id}`,'product_reported','A listing has been reported.','/admin/reports');
    });res.redirect(`/products/${id}?reported=1`);
  });
  return router;
}
module.exports={studentRoutes};
