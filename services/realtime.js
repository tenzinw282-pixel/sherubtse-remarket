const {Server}=require('socket.io');
const {Conversation}=require('../models/documents');
function createRealtime({server,sessionMiddleware,pool,baseUrl}){
  const io=new Server(server,{serveClient:true,allowRequest:(req,done)=>done(null,!req.headers.origin||req.headers.origin===baseUrl)});
  io.engine.use(sessionMiddleware);
  async function authorize(socket){
    await new Promise((resolve,reject)=>socket.request.session.reload(error=>error?reject(error):resolve()));
    const id=socket.request.session.userId;if(!id)throw new Error('Login required');
    const user=(await pool.query('SELECT id FROM users WHERE id=$1 AND email_verified_at IS NOT NULL AND suspended_at IS NULL',[id])).rows[0];if(!user)throw new Error('Active verified account required');return user.id;
  }
  io.use(async(socket,next)=>{try{socket.userId=await authorize(socket);next();}catch{next(new Error('A verified active session is required.'));}});
  io.on('connection',socket=>{
    socket.join(`user:${socket.userId}`);let joins=0;
    socket.on('join-auction',async id=>{
      if(++joins>100)return socket.disconnect(true);
      try{await authorize(socket);if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))return;
        const allowed=await pool.query(`SELECT a.id FROM auctions a JOIN products p ON p.id=a.product_id JOIN users u ON u.id=p.seller_id WHERE a.id=$1 AND p.moderation_status='approved' AND p.status<>'removed' AND u.suspended_at IS NULL`,[id]);if(allowed.rowCount)socket.join(`auction:${id}`);
      }catch{socket.disconnect(true);}
    });
    socket.on('join-conversation',async id=>{
      if(++joins>100)return socket.disconnect(true);
      try{const userId=await authorize(socket);if(typeof id!=='string'||!/^[0-9a-f]{24}$/i.test(id))return;const allowed=await Conversation.exists({_id:id,participantIds:userId});if(allowed)socket.join(`conversation:${id}`);}catch{socket.disconnect(true);}
    });
    const timer=setInterval(()=>authorize(socket).catch(()=>socket.disconnect(true)),15000);timer.unref();socket.on('disconnect',()=>clearInterval(timer));
  });
  return io;
}
module.exports={createRealtime};
