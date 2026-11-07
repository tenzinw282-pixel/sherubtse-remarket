const {transaction,UserError,uuid,text,notify,audit,activeUser}=require('./database');
function createApprovals(pool) {
  return async function moderate(adminId,productId,decision,reason) {
    uuid(productId);text(reason,3,2000,'Reason');
    if(!['approve','reject','remove','restore'].includes(decision))throw new UserError('Choose an approval action.');
    await transaction(pool,async client=>{
      const admin=await activeUser(client,adminId);if(admin.role!=='admin')throw new UserError('Administrator access required.',403);
      const product=(await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE',[productId])).rows[0];
      if(!product)throw new UserError('Listing not found.',404);
      if(['approve','reject'].includes(decision) && product.moderation_status!=='pending')throw new UserError('This listing has already been reviewed.');
      const auction=(await client.query('SELECT * FROM auctions WHERE product_id=$1 FOR UPDATE',[productId])).rows[0];
      if(['remove','reject'].includes(decision) && (product.status==='reserved'||product.status==='sold'))throw new UserError('Resolve the associated transaction before removing this listing.');
      const databaseTime=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      if(decision==='approve' && auction && new Date(auction.ends_at)<=new Date(databaseTime))throw new UserError('The auction deadline has passed. Ask the seller to edit its dates and resubmit.');
      if(decision==='restore' && (product.status!=='removed'||(auction && auction.status!=='open')))throw new UserError('This listing is not eligible for restoration.');
      if(decision==='approve'||decision==='reject')await client.query('UPDATE products SET moderation_status=$2,moderation_reason=$3,reviewed_by=$4,reviewed_at=now(),updated_at=now() WHERE id=$1',[productId,decision==='approve'?'approved':'rejected',reason,adminId]);
      else await client.query('UPDATE products SET status=$2,moderation_reason=$3,updated_at=now() WHERE id=$1',[productId,decision==='remove'?'removed':'available',reason]);
      if(decision==='remove' && auction && auction.status==='open')await client.query("UPDATE auctions SET status='cancelled',closed_at=now() WHERE id=$1",[auction.id]);
      if(decision==='remove' && auction){const bidders=(await client.query('SELECT DISTINCT bidder_id FROM bids WHERE auction_id=$1',[auction.id])).rows;for(const bidder of bidders)await notify(client,bidder.bidder_id,`auction:${auction.id}:cancelled:${bidder.bidder_id}`,'auction_cancelled',`The auction for ${product.title} was removed by moderation. ${reason}`,'/dashboard/bids');}
      await audit(client,adminId,`listing_${decision}`,productId,reason);
      await notify(client,product.seller_id,`moderation:${productId}:${require('node:crypto').randomUUID()}`,'listing_reviewed',`Your listing “${product.title}”: ${decision}. ${reason}`,`/products/${productId}`);
    });
  };
}
module.exports={createApprovals};
