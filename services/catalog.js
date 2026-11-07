const { UserError, uuid, money } = require('./database');
const select = `SELECT p.*, c.name AS category_name,u.full_name AS seller_name,u.suspended_at AS seller_suspended,
  (SELECT secure_url FROM product_images WHERE product_id=p.id ORDER BY position LIMIT 1) AS image,
  a.id AS auction_id,a.ends_at,a.starts_at,a.status AS auction_status,a.minimum_increment,
  coalesce(b.amount,a.starting_price,p.price) AS current_price
  FROM products p JOIN categories c ON c.id=p.category_id JOIN users u ON u.id=p.seller_id
  LEFT JOIN auctions a ON a.product_id=p.id LEFT JOIN bids b ON b.id=a.highest_bid_id`;
function createCatalog(pool) {
  async function browse(filters = {}, limit = 12) {
    const values = [];
    const where = ["p.moderation_status='approved'", "p.status='available'", 'u.suspended_at IS NULL'];
    const add = (clause, value) => { values.push(value); where.push(clause.replace('?', `$${values.length}`)); };
    if (typeof filters.q === 'string' && filters.q.trim()) add("(p.title ILIKE ? OR p.description ILIKE ?)", `%${filters.q.trim().slice(0,100)}%`);
    // Both occurrences in the search expression reference the same bound value.
    if (where.at(-1)?.includes('?')) where[where.length - 1] = where.at(-1).replace('?', `$${values.length}`);
    if (filters.category && /^\d+$/.test(filters.category)) add('p.category_id=?', filters.category);
    if (filters.condition && ['New','Like New','Good','Fair','Used'].includes(filters.condition)) add('p.condition=?', filters.condition);
    if (['fixed','auction'].includes(filters.type)) add('p.selling_type=?', filters.type);
    if (filters.min) { money(filters.min); add('p.price>=?::numeric', filters.min); }
    if (filters.max) { money(filters.max); add('p.price<=?::numeric', filters.max); }
    if (filters.featured) where.push('p.featured=true');
    if (filters.seller) add('p.seller_id=?',uuid(filters.seller));
    if (filters.live) where.push("a.status='open' AND a.ends_at>now()");
    const sort = { newest:'p.created_at DESC',low:'p.price ASC,p.created_at DESC',high:'p.price DESC,p.created_at DESC' }[filters.sort] || 'p.created_at DESC';
    const page = Math.max(1, Math.min(10000, Number.parseInt(filters.page,10) || 1));
    const count = (await pool.query(`SELECT count(*)::int AS total FROM products p JOIN users u ON u.id=p.seller_id
      LEFT JOIN auctions a ON a.product_id=p.id WHERE ${where.join(' AND ')}`, values)).rows[0]?.total || 0;
    const products = (await pool.query(`${select} WHERE ${where.join(' AND ')} ORDER BY ${sort} LIMIT $${values.length+1} OFFSET $${values.length+2}`, [...values,limit,(page-1)*limit])).rows;
    return { products, total:count,page,pages:Math.max(1,Math.ceil(count/limit)) };
  }
  async function detail(id, user) {
    uuid(id);
    const product = (await pool.query(`${select} WHERE p.id=$1`,[id])).rows[0];
    if (!product || (!(product.moderation_status==='approved' && product.status!=='removed' && !product.seller_suspended) && product.seller_id!==user?.id && user?.role!=='admin')) throw new UserError('Product not found.',404);
    const photos = (await pool.query('SELECT secure_url FROM product_images WHERE product_id=$1 ORDER BY position',[id])).rows;
    return {product,photos};
  }
  return {browse,detail,categories:async()=> (await pool.query('SELECT id,name FROM categories WHERE active=true ORDER BY id')).rows};
}
module.exports = {createCatalog,select};
