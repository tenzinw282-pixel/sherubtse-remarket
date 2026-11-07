const { UserError, transaction, money, amount, uuid, notify, activeUser } = require('./database');
function createCommerce(pool, publish = () => {}) {
  async function lockedAuction(client, id) {
    const ref = (await client.query('SELECT product_id FROM auctions WHERE id=$1',[uuid(id)])).rows[0];
    if (!ref) throw new UserError('Auction not found.',404);
    const product = (await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE',[ref.product_id])).rows[0];
    const auction = (await client.query('SELECT * FROM auctions WHERE id=$1 FOR UPDATE',[id])).rows[0];
    const time = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    return {product,auction,now:new Date(time)};
  }
  async function bid(id,userId,value) {
    const cents=money(value);
    const result=await transaction(pool,async client=>{
      const {product,auction,now}=await lockedAuction(client,id);
      await activeUser(client,userId);
      if (product.seller_id===userId) throw new UserError('You cannot bid on your own item.');
      if (product.moderation_status!=='approved' || product.status!=='available' || auction.status!=='open') throw new UserError('This auction is not open for bidding.');
      if (now < new Date(auction.starts_at)) throw new UserError('This auction has not started.');
      if (now >= new Date(auction.ends_at)) throw new UserError('This auction has ended.');
      const seller=(await client.query('SELECT suspended_at FROM users WHERE id=$1',[product.seller_id])).rows[0];
      if (!seller || seller.suspended_at) throw new UserError('This seller is not currently active.');
      const previous=auction.highest_bid_id?(await client.query('SELECT * FROM bids WHERE id=$1',[auction.highest_bid_id])).rows[0]:null;
      const minimum=previous?money(previous.amount)+money(auction.minimum_increment):money(auction.starting_price);
      if (cents<minimum) throw new UserError(`The minimum next bid is Nu. ${amount(minimum)}.`);
      const bid=(await client.query('INSERT INTO bids(auction_id,bidder_id,amount) VALUES ($1,$2,$3) RETURNING id,amount,created_at',[id,userId,amount(cents)])).rows[0];
      await client.query('UPDATE auctions SET highest_bid_id=$2 WHERE id=$1',[id,bid.id]);
      await notify(client,product.seller_id,`bid:${bid.id}:seller`,'new_bid',`A new bid was placed on ${product.title}.`,`/products/${product.id}`);
      if (previous && previous.bidder_id!==userId) await notify(client,previous.bidder_id,`bid:${bid.id}:outbid`,'outbid',`You were outbid on ${product.title}.`,`/products/${product.id}`);
      return {...bid,auctionId:id,productId:product.id};
    });
    // Called only after COMMIT; a socket delivery failure must never undo a bid.
    try { publish(`auction:${id}`,'bid',result); } catch { /* clients reconcile with the authoritative HTTP state */ }
    return result;
  }
  async function close(id) {
    const result=await transaction(pool,async client=>{
      const {product,auction,now}=await lockedAuction(client,id);
      if (auction.status!=='open' || now<new Date(auction.ends_at)) return null;
      const winner=auction.highest_bid_id?(await client.query('SELECT * FROM bids WHERE id=$1',[auction.highest_bid_id])).rows[0]:null;
      await client.query("UPDATE auctions SET status='closed',closed_at=clock_timestamp() WHERE id=$1",[id]);
      let transactionId=null;
      if (winner && product.moderation_status==='approved' && product.status==='available') {
        transactionId=(await client.query(`INSERT INTO transactions(product_id,auction_id,buyer_id,seller_id,amount)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT(auction_id) DO NOTHING RETURNING id`,[product.id,id,winner.bidder_id,product.seller_id,winner.amount])).rows[0]?.id;
        await client.query("UPDATE products SET status='reserved',updated_at=now() WHERE id=$1",[product.id]);
        await notify(client,winner.bidder_id,`auction:${id}:winner`,'auction_won',`You won ${product.title}. Arrange collection with the seller.`, '/dashboard/won-auctions');
      } else if (product.status==='available') await client.query("UPDATE products SET status='expired',updated_at=now() WHERE id=$1",[product.id]);
      await notify(client,product.seller_id,`auction:${id}:ended`,'auction_ended',`Your auction for ${product.title} has ended.`, '/dashboard/sales');
      return {auctionId:id,productId:product.id,transactionId};
    });
    if (result) {try{publish(`auction:${id}`,'auction-ended',result);}catch{}}
    return result;
  }
  async function closeDue() {
    const due=(await pool.query("SELECT id FROM auctions WHERE status='open' AND ends_at<=clock_timestamp() ORDER BY ends_at LIMIT 100")).rows;
    for (const row of due) await close(row.id);
    return due.length;
  }
  async function purchase(id,buyerId) {
    return transaction(pool,async client=>{
      const product=(await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE',[uuid(id)])).rows[0];
      await activeUser(client,buyerId);
      if (!product || product.status!=='available' || product.moderation_status!=='approved' || product.selling_type!=='fixed') throw new UserError('This item is not available for purchase.',409);
      if (product.seller_id===buyerId) throw new UserError('You cannot buy your own item.');
      const seller=(await client.query('SELECT suspended_at FROM users WHERE id=$1',[product.seller_id])).rows[0];
      if (!seller || seller.suspended_at) throw new UserError('This seller is not currently active.');
      const sale=(await client.query(`INSERT INTO transactions(product_id,buyer_id,seller_id,amount) VALUES ($1,$2,$3,$4) RETURNING id`,[id,buyerId,product.seller_id,product.price])).rows[0];
      await client.query("UPDATE products SET status='reserved',updated_at=now() WHERE id=$1",[id]);
      for(const user of [buyerId,product.seller_id]) await notify(client,user,`purchase:${sale.id}:${user}`,'product_reserved',`${product.title} is reserved. Arrange collection and payment outside the website.`, '/dashboard/purchases');
      return sale.id;
    });
  }
  async function transition(id,userId,action) {
    return transaction(pool,async client=>{
      const ref=(await client.query('SELECT product_id FROM transactions WHERE id=$1',[uuid(id)])).rows[0];
      if(!ref) throw new UserError('Transaction not found.',404);
      await client.query('SELECT id FROM products WHERE id=$1 FOR UPDATE',[ref.product_id]);
      const sale=(await client.query('SELECT * FROM transactions WHERE id=$1 FOR UPDATE',[id])).rows[0];
      await activeUser(client,userId);
      if (![sale.buyer_id,sale.seller_id].includes(userId)) throw new UserError('This transaction is private.',403);
      if (['completed','cancelled','disputed'].includes(sale.status)) throw new UserError('This transaction cannot be changed.');
      if (action==='cancel') {
        if(sale.seller_handover_at || sale.buyer_received_at) throw new UserError('After handover, open a dispute instead of cancelling.');
        await client.query("UPDATE transactions SET status='cancelled',updated_at=now() WHERE id=$1",[id]);
        await client.query("UPDATE products SET status=$2,updated_at=now() WHERE id=$1",[sale.product_id,sale.auction_id?'expired':'available']);
      } else if (action==='dispute') await client.query("UPDATE transactions SET status='disputed',updated_at=now() WHERE id=$1",[id]);
      else if(action==='handover' && userId===sale.seller_id) await client.query("UPDATE transactions SET seller_handover_at=coalesce(seller_handover_at,now()),status='reserved',updated_at=now() WHERE id=$1",[id]);
      else if(action==='receive' && userId===sale.buyer_id && sale.seller_handover_at) await client.query('UPDATE transactions SET buyer_received_at=coalesce(buyer_received_at,now()),updated_at=now() WHERE id=$1',[id]);
      else throw new UserError('Invalid action. Receipt requires the seller to confirm handover first.');
      const completed=await client.query(`UPDATE transactions SET status='completed',completed_at=now(),updated_at=now()
        WHERE id=$1 AND seller_handover_at IS NOT NULL AND buyer_received_at IS NOT NULL AND status NOT IN ('cancelled','disputed') RETURNING id`,[id]);
      if(completed.rowCount) await client.query("UPDATE products SET status='sold',updated_at=now() WHERE id=$1",[sale.product_id]);
      for(const user of [sale.buyer_id,sale.seller_id]) await notify(client,user,`transaction:${id}:${action}:${user}`,completed.rowCount?'transaction_completed':'transaction_updated',`Transaction ${completed.rowCount?'completed':action+' recorded'}.`,'/dashboard/purchases');
    });
  }
  return {bid,close,closeDue,purchase,transition};
}
module.exports={createCommerce};
