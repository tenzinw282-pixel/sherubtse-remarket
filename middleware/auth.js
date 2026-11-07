function loadUser(pool) {
  return async (req, res, next) => {
    res.locals.currentUser = null;
    if (req.session.userId) {
      const user = (await pool.query(`SELECT id, full_name, email, email_verified_at, suspended_at, role, student_id, bio, avatar_url
        FROM users WHERE id = $1`, [req.session.userId])).rows[0];
      if (user && !user.suspended_at) req.user = res.locals.currentUser = user;
    }
    next();
  };
}
function requireVerified(req, res, next) {
  if (!req.user) return res.status(401).render('error', { title: 'Login required', message: 'Log in with a verified account to upload product images.' });
  if (!req.user.email_verified_at) return res.status(403).render('error', { title: 'Verification required', message: 'Verify your email before selling products.' });
  next();
}
function requireAdmin(req,res,next){
  if(!req.user || !req.user.email_verified_at || req.user.role!=='admin')return res.status(403).render('error',{title:'Access restricted',message:'A verified administrator account is required.'});
  next();
}
module.exports = { loadUser, requireVerified, requireAdmin };
