class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.safe = true; }
}
async function transaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
function money(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)) throw new UserError('Enter a positive amount with at most two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents <= 0n) throw new UserError('Amount must be positive.');
  return cents;
}
function amount(cents) { return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`; }
function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new UserError('Record not found.', 404);
  return value;
}
function text(value, min, max, label) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new UserError(`${label} must be ${min}–${max} characters.`);
  return value.trim();
}
async function notify(client, userId, key, type, message, link) {
  await client.query(`INSERT INTO outbox(event_key,event_type,payload) VALUES ($1,'notification',$2::jsonb)
    ON CONFLICT(event_key) DO NOTHING`, [key, JSON.stringify({ userId, eventKey: key, type, text: message, link })]);
}
async function audit(client, adminId, action, targetId, reason) {
  await client.query('INSERT INTO admin_actions(admin_id,action,target_id,details) VALUES ($1,$2,$3,$4::jsonb)', [adminId, action, targetId, JSON.stringify({ reason })]);
}
async function activeUser(client, id) {
  const user = (await client.query('SELECT * FROM users WHERE id=$1 FOR SHARE', [id])).rows[0];
  if (!user || !user.email_verified_at || user.suspended_at) throw new UserError('A verified, active account is required.', 403);
  return user;
}
module.exports = { UserError, transaction, money, amount, uuid, text, notify, audit, activeUser };
