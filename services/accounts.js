const bcrypt = require('bcrypt');
const { randomInt, randomUUID, createHmac, timingSafeEqual } = require('node:crypto');
const { connectionAdvice } = require('./service-errors');

class AccountError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function otpDigest(secret, challengeId, code) {
  return createHmac('sha256', secret).update(`email-otp:${challengeId}:${code}`).digest('hex');
}
function createAccounts({ pool, mail, config }) {
  async function issueCode(userId) {
    const client = await pool.connect();
    const id = randomUUID();
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    let email;
    try {
      await client.query('BEGIN');
      const user = (await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
      if (!user || user.email_verified_at || user.suspended_at) throw new AccountError('This account cannot request a verification code.');
      email = user.email;
      const rate = (await client.query(`SELECT count(*)::int AS count,
        coalesce(max(created_at) > now() - interval '60 seconds', false) AS cooling
        FROM email_verifications WHERE user_id = $1 AND created_at > now() - interval '1 hour'`, [userId])).rows[0];
      if (rate.cooling || rate.count >= 5) throw new AccountError('Please wait 60 seconds between codes. Maximum five requests per hour.', 429);
      await client.query('UPDATE email_verifications SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL', [userId]);
      await client.query(`INSERT INTO email_verifications(id, user_id, email, purpose, code_hash, expires_at)
        VALUES ($1, $2, $3, 'registration', $4, now() + interval '5 minutes')`,
      [id, userId, email, otpDigest(config.SESSION_SECRET, id, code)]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    try {
      const result = await mail.sendMail({ from: config.EMAIL_FROM, to: email,
        subject: 'Verify your Sherubtse ReMarket email',
        text: `Sherubtse ReMarket\nYour verification code is ${code}.\nThis code expires in 5 minutes. Do not share it with anyone.\nEmail verification does not verify college affiliation.`,
        html: `<div style="font-family:Arial,sans-serif;color:#122d4c;max-width:520px;margin:auto;padding:32px"><h1>Sherubtse ReMarket</h1><p>Buy Smart &bull; Sell Easy &bull; Bid Better</p><h2>Verify your email</h2><p>Your six-digit verification code:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${code}</p><p>Expires in <strong>5 minutes</strong>. Do not share this code with anyone.</p><p>Email verification does not verify official college affiliation.</p></div>` });
      if (!result.accepted?.length) throw new Error('Recipient rejected');
      await pool.query('UPDATE email_verifications SET delivered_at = now() WHERE id = $1 AND consumed_at IS NULL', [id]);
    } catch (error) {
      await pool.query('UPDATE email_verifications SET consumed_at = now() WHERE id = $1', [id]);
      // Return only controlled guidance, never provider responses or message objects.
      throw new AccountError(`Verification email could not be sent. Your account remains unverified. ${connectionAdvice('SMTP', error)} Wait 60 seconds and use resend.`, 502);
    }
  }
  async function register({ fullName, email, studentId, password }) {
    const hash = await bcrypt.hash(password, 12);
    try {
      return (await pool.query(`INSERT INTO users(full_name, email, student_id, password_hash)
        VALUES ($1, $2, $3, $4) RETURNING id`, [fullName, email, studentId || null, hash])).rows[0].id;
    } catch (error) {
      if (error.code === '23505') throw new AccountError('Unable to register this email. Try logging in or resend verification from your pending registration.', 409);
      throw error;
    }
  }
  async function verify(userId, code) {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new AccountError('Enter the six-digit numeric code.');
    const client = await pool.connect();
    let problem;
    try {
      await client.query('BEGIN');
      const user = (await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
      if (!user || user.suspended_at) throw new AccountError('Account not available.');
      const challenge = (await client.query(`SELECT *, expires_at <= now() AS expired FROM email_verifications
        WHERE user_id = $1 AND purpose = 'registration' AND consumed_at IS NULL FOR UPDATE`, [userId])).rows[0];
      if (!challenge || !challenge.delivered_at) problem = 'No delivered code is available. Please request another code.';
      else if (challenge.expired) problem = 'This code has expired. Please request another code.';
      else if (challenge.attempts >= 5) problem = 'Too many incorrect attempts. Please request another code.';
      else {
        const expected = Buffer.from(challenge.code_hash, 'hex');
        const actual = Buffer.from(otpDigest(config.SESSION_SECRET, challenge.id, code), 'hex');
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
          await client.query('UPDATE email_verifications SET attempts = attempts + 1 WHERE id = $1', [challenge.id]);
          problem = 'Incorrect verification code. Maximum five attempts per code.';
        } else {
          await client.query('UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1 AND email = $2', [userId, challenge.email]);
          await client.query('UPDATE email_verifications SET consumed_at = now() WHERE id = $1', [challenge.id]);
        }
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    if (problem) throw new AccountError(problem);
  }
  return { register, issueCode, verify };
}
module.exports = { createAccounts, AccountError, otpDigest };
