const express=require('express');
const {requireAdmin}=require('../middleware/auth');
const {UserError,transaction,uuid,text,audit,activeUser}=require('../services/database');
const {createApprovals}=require('../services/approvals');
function adminRoutes({pool}){
  const router=express.Router();const moderate=createApprovals(pool);router.use('/admin',requireAdmin);
  router.get(['/admin','/admin/:section'],async(req,res)=>{
    const section=req.params.section||'overview';let rows=[];const q=typeof req.query.q==='string'?req.query.q.slice(0,100):'';
    const stats=(await pool.query(`SELECT (SELECT count(*) FROM users) AS users,(SELECT count(*) FROM users WHERE email_verified_at IS NOT NULL) AS verified,
      (SELECT count(*) FROM users WHERE suspended_at IS NOT NULL) AS suspended,(SELECT count(*) FROM products WHERE status='available') AS active,
      (SELECT count(*) FROM products WHERE status='sold') AS sold,(SELECT count(*) FROM products WHERE moderation_status='pending') AS pending,
      (SELECT count(*) FROM auctions WHERE status='open' AND ends_at>now()) AS auctions,(SELECT count(*) FROM transactions WHERE status='completed') AS completed,
      (SELECT count(*) FROM reports WHERE status='open') AS reports`)).rows[0]||{};
    const searches={
      users:[`SELECT id,full_name,email,role,email_verified_at,suspended_at,created_at FROM users WHERE (full_name ILIKE $1 OR email ILIKE $1) ${req.query.filter==='suspended'?'AND suspended_at IS NOT NULL':req.query.filter==='unverified'?'AND email_verified_at IS NULL':''} ORDER BY created_at DESC LIMIT 100`,[`%${q}%`]],
      approvals:["SELECT p.*,u.full_name AS seller_name FROM products p JOIN users u ON u.id=p.seller_id WHERE p.moderation_status='pending' AND p.status='available' ORDER BY p.created_at LIMIT 100",[]],
      products:['SELECT p.*,u.full_name AS seller_name FROM products p JOIN users u ON u.id=p.seller_id WHERE p.title ILIKE $1 ORDER BY p.created_at DESC LIMIT 100',[`%${q}%`]],
      auctions:[`SELECT a.*,p.title,p.moderation_status,(SELECT count(*) FROM bids WHERE auction_id=a.id) AS bid_count FROM auctions a JOIN products p ON p.id=a.product_id ORDER BY a.created_at DESC LIMIT 100`,[]],
      transactions:['SELECT t.*,p.title FROM transactions t JOIN products p ON p.id=t.product_id ORDER BY t.created_at DESC LIMIT 100',[]],
      reports:['SELECT r.*,p.title FROM reports r JOIN products p ON p.id=r.product_id ORDER BY r.created_at DESC LIMIT 100',[]],
      categories:['SELECT * FROM categories ORDER BY id',[]],announcements:['SELECT * FROM announcements ORDER BY created_at DESC LIMIT 100',[]],
      audit:['SELECT a.*,u.full_name FROM admin_actions a JOIN users u ON u.id=a.admin_id ORDER BY a.created_at DESC LIMIT 100',[]]
    };
    if(section!=='overview'){if(!searches[section])throw new UserError('Admin section not found.',404);rows=(await pool.query(...searches[section])).rows;}
    res.render('admin',{title:'Administration',section,rows,stats,q});
  });
  router.post('/admin/products/:id/:decision',async(req,res)=>{
    if(req.params.decision==='feature-toggle'){
      const reason=text(req.body.reason,3,2000,'Reason');await transaction(pool,async client=>{await client.query("UPDATE products SET featured=NOT featured WHERE id=$1 AND moderation_status='approved'",[uuid(req.params.id)]);await audit(client,req.user.id,'feature_toggled',req.params.id,reason);});return res.redirect('/admin/products');
    }
    await moderate(req.user.id,req.params.id,req.params.decision,req.body.reason);res.redirect('/admin/approvals');
  });
  router.post('/admin/users/:id/:action',async(req,res)=>{
    const id=uuid(req.params.id),reason=text(req.body.reason,3,2000,'Reason');if(id===req.user.id)throw new UserError('You cannot suspend your own account.');if(!['suspend','reactivate'].includes(req.params.action))throw new UserError('Invalid action.');
    await transaction(pool,async client=>{await client.query(`UPDATE users SET suspended_at=${req.params.action==='suspend'?'now()':'NULL'},updated_at=now() WHERE id=$1`,[id]);await audit(client,req.user.id,`user_${req.params.action}`,id,reason);});
    if(req.params.action==='suspend')req.app.locals.disconnectUser?.(id);res.redirect('/admin/users');
  });
  router.post('/admin/reports/:id/resolve',async(req,res)=>{
    const reason=text(req.body.reason,3,2000,'Decision reason');if(!['resolved','dismissed'].includes(req.body.decision))throw new UserError('Choose a report decision.');
    await transaction(pool,async client=>{await client.query('UPDATE reports SET status=$2,resolved_by=$3,resolved_at=now() WHERE id=$1',[uuid(req.params.id),req.body.decision,req.user.id]);await audit(client,req.user.id,`report_${req.body.decision}`,req.params.id,reason);});res.redirect('/admin/reports');
  });
  router.post('/admin/auctions/:id/cancel',async(req,res)=>{
    const reason=text(req.body.reason,3,2000,'Reason');const ref=(await pool.query('SELECT product_id FROM auctions WHERE id=$1',[uuid(req.params.id)])).rows[0];if(!ref)throw new UserError('Auction not found.',404);
    await moderate(req.user.id,ref.product_id,'remove',reason);res.redirect('/admin/auctions');
  });
  router.post('/admin/transactions/:id/resolve',async(req,res)=>{
    const reason=text(req.body.reason,3,2000,'Decision reason');if(!['cancel','resume'].includes(req.body.decision))throw new UserError('Choose a dispute decision.');
    await transaction(pool,async client=>{
      const ref=(await client.query('SELECT product_id FROM transactions WHERE id=$1',[uuid(req.params.id)])).rows[0];if(!ref)throw new UserError('Transaction not found.',404);
      await client.query('SELECT id FROM products WHERE id=$1 FOR UPDATE',[ref.product_id]);
      const sale=(await client.query("SELECT * FROM transactions WHERE id=$1 AND status='disputed' FOR UPDATE",[req.params.id])).rows[0];if(!sale)throw new UserError('Only disputed transactions can be moderated here.');
      await client.query('UPDATE transactions SET status=$2,updated_at=now() WHERE id=$1',[sale.id,req.body.decision==='cancel'?'cancelled':'reserved']);
      if(req.body.decision==='cancel')await client.query("UPDATE products SET status='removed',updated_at=now() WHERE id=$1",[sale.product_id]);
      await audit(client,req.user.id,`dispute_${req.body.decision}`,sale.id,reason);
    });res.redirect('/admin/transactions');
  });
  router.post('/admin/categories',async(req,res)=>{
    const name=text(req.body.name,2,80,'Category name');await transaction(pool,async client=>{const row=(await client.query('INSERT INTO categories(name) VALUES ($1) RETURNING id',[name])).rows[0];await audit(client,req.user.id,'category_created',null,`Created category ${row.id}: ${name}`);});res.redirect('/admin/categories');
  });
  router.post('/admin/categories/:id',async(req,res)=>{
    if(!/^\d+$/.test(req.params.id))throw new UserError('Invalid category.');const name=text(req.body.name,2,80,'Category name');await transaction(pool,async client=>{await client.query('UPDATE categories SET name=$2,active=$3 WHERE id=$1',[req.params.id,name,req.body.active==='on']);await audit(client,req.user.id,'category_updated',null,`Category ${req.params.id}: ${name}, active: ${req.body.active==='on'}`);});res.redirect('/admin/categories');
  });
  router.post('/admin/announcements',async(req,res)=>{
    const title=text(req.body.title,3,160,'Title'),body=text(req.body.body,3,4000,'Announcement');await transaction(pool,async client=>{const row=(await client.query('INSERT INTO announcements(admin_id,title,body) VALUES ($1,$2,$3) RETURNING id',[req.user.id,title,body])).rows[0];await audit(client,req.user.id,'announcement_created',row.id,title);});res.redirect('/admin/announcements');
  });
  router.post('/admin/announcements/:id/hide',async(req,res)=>{await transaction(pool,async client=>{await client.query('UPDATE announcements SET active=false WHERE id=$1',[uuid(req.params.id)]);await audit(client,req.user.id,'announcement_hidden',req.params.id,'Removed from homepage');});res.redirect('/admin/announcements');});
  return router;
}
module.exports={adminRoutes};
