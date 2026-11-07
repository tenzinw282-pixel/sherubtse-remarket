const express=require('express');
const {rateLimit}=require('express-rate-limit');
const {requireVerified}=require('../middleware/auth');
const {UserError,uuid,text,money,amount,transaction}=require('../services/database');
const {createCatalog}=require('../services/catalog');
function commerceRoutes({pool,commerce}){
  const router=express.Router();const catalog=createCatalog(pool);
  const bidLimit=rateLimit({windowMs:60000,limit:30,standardHeaders:'draft-8',legacyHeaders:false});
  router.post('/products/:id/buy',requireVerified,async(req,res)=>{await commerce.purchase(req.params.id,req.user.id);res.redirect('/dashboard/purchases');});
  router.post('/auctions/:id/bids',requireVerified,bidLimit,async(req,res)=>{await commerce.bid(req.params.id,req.user.id,req.body.amount);res.json({message:'Bid accepted.'});});
  router.get('/api/auctions/:id',async(req,res)=>{
    const auction=(await pool.query('SELECT * FROM auctions WHERE id=$1',[uuid(req.params.id)])).rows[0];
    if(!auction)throw new UserError('Auction not found.',404);
    await catalog.detail(auction.product_id,req.user);
    const history=(await pool.query(`SELECT b.id,b.amount,b.created_at,b.bidder_id,u.full_name FROM bids b JOIN users u ON u.id=b.bidder_id WHERE b.auction_id=$1 ORDER BY b.amount DESC,b.created_at LIMIT 50`,[auction.id])).rows;
    const high=history[0];const count=(await pool.query('SELECT count(*)::int AS count FROM bids WHERE auction_id=$1',[auction.id])).rows[0].count;
    const now=(await pool.query('SELECT clock_timestamp() AS now')).rows[0].now;
    res.json({id:auction.id,status:auction.status,startsAt:auction.starts_at,endsAt:auction.ends_at,now,
      current:high?.amount||auction.starting_price,minimum:high?amount(money(high.amount)+money(auction.minimum_increment)):auction.starting_price,count,
      highestBidder:!!req.user&&high?.bidder_id===req.user.id,history:history.map(({bidder_id,...bid})=>({...bid,isYou:bidder_id===req.user?.id}))});
  });
  router.post('/transactions/:id/review',requireVerified,async(req,res)=>{
    const comment=text(req.body.comment,1,2000,'Review');if(!/^[1-5]$/.test(req.body.rating||''))throw new UserError('Choose a rating from 1 to 5.');
    await transaction(pool,async client=>{
      const sale=(await client.query('SELECT * FROM transactions WHERE id=$1 FOR SHARE',[uuid(req.params.id)])).rows[0];
      if(!sale||sale.status!=='completed'||![sale.buyer_id,sale.seller_id].includes(req.user.id))throw new UserError('Only completed transaction participants can leave reviews.',403);
      await client.query('INSERT INTO reviews(transaction_id,author_id,rating,comment) VALUES ($1,$2,$3,$4) ON CONFLICT(transaction_id,author_id) DO UPDATE SET rating=$3,comment=$4',[sale.id,req.user.id,req.body.rating,comment]);
    });res.redirect('/dashboard/purchases');
  });
  router.post('/transactions/:id/:action',requireVerified,async(req,res)=>{await commerce.transition(req.params.id,req.user.id,req.params.action);res.redirect(req.params.action==='handover'?'/dashboard/sales':'/dashboard/purchases');});
  return router;
}
module.exports={commerceRoutes};
