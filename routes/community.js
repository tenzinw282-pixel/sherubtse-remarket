const express=require('express');
const mongoose=require('mongoose');
const {randomUUID}=require('node:crypto');
const {rateLimit}=require('express-rate-limit');
const {requireVerified}=require('../middleware/auth');
const {UserError,uuid,text}=require('../services/database');
const {createCatalog}=require('../services/catalog');
const defaultModels=require('../models/documents');
function communityRoutes({pool,publish=()=>{},models=defaultModels}){
  const {Conversation,Message,Notification}=models;
  const router=express.Router();const catalog=createCatalog(pool);
  const messageLimit=rateLimit({windowMs:60000,limit:40,standardHeaders:'draft-8',legacyHeaders:false});
  async function conversation(id,userId){
    if(!mongoose.isValidObjectId(id))throw new UserError('Conversation not found.',404);
    const record=await Conversation.findOne({_id:id,participantIds:userId});
    if(!record)throw new UserError('Conversation not found.',404);return record;
  }
  async function decorate(conversations){
    const ids=[...new Set(conversations.flatMap(c=>c.participantIds))];if(!ids.length)return [];
    const users=(await pool.query('SELECT id,full_name FROM users WHERE id=ANY($1::uuid[])',[ids])).rows;
    return conversations.map(c=>({...c,people:c.participantIds.map(id=>users.find(u=>u.id===id)?.full_name||'Student').join(' / ')}));
  }
  router.post('/products/:id/contact',requireVerified,messageLimit,async(req,res)=>{
    const {product}=await catalog.detail(req.params.id,req.user);let recipient=product.seller_id;
    if(req.user.id===product.seller_id){
      recipient=uuid(req.body.recipientId);const sale=await pool.query('SELECT 1 FROM transactions WHERE product_id=$1 AND seller_id=$2 AND buyer_id=$3',[product.id,req.user.id,recipient]);if(!sale.rowCount)throw new UserError('Choose the buyer from your sales dashboard.');
    }
    const participants=[req.user.id,recipient].sort();if(participants[0]===participants[1])throw new UserError('You cannot message yourself.');
    const record=await Conversation.findOneAndUpdate({conversationKey:`${product.id}:${participants.join(':')}`},{$setOnInsert:{productId:product.id,participantIds:participants}},{upsert:true,new:true,setDefaultsOnInsert:true});
    res.redirect(`/messages/${record._id}`);
  });
  router.get(['/messages','/messages/:id'],requireVerified,async(req,res)=>{
    const conversations=await decorate(await Conversation.find({participantIds:req.user.id}).sort({updatedAt:-1}).limit(100).lean());
    let selected=null,messages=[];
    if(req.params.id){selected=await conversation(req.params.id,req.user.id);messages=(await Message.find({conversationId:selected._id}).sort({createdAt:-1,_id:-1}).limit(100).lean()).reverse();await Conversation.updateOne({_id:selected._id},{$set:{[`readAt.${req.user.id}`]:new Date()}});}
    res.render('messages',{title:'Messages',conversations,selected,messages});
  });
  router.get('/api/conversations/:id/messages',requireVerified,async(req,res)=>{
    const selected=await conversation(req.params.id,req.user.id);const where={conversationId:selected._id};
    if(req.query.before){const before=new Date(req.query.before);if(!Number.isFinite(before.getTime()))throw new UserError('Invalid message cursor.');where.createdAt={$lt:before};}
    const messages=(await Message.find(where).sort({createdAt:-1,_id:-1}).limit(100).lean()).reverse();
    await Conversation.updateOne({_id:selected._id},{$set:{[`readAt.${req.user.id}`]:new Date()}});
    res.json({messages:messages.map(message=>({id:String(message._id),body:message.body,isYou:message.senderId===req.user.id,createdAt:message.createdAt}))});
  });
  router.post('/messages/:id',requireVerified,messageLimit,async(req,res)=>{
    const selected=await conversation(req.params.id,req.user.id);const body=text(req.body.body,1,4000,'Message');
    const recipient=selected.participantIds.find(id=>id!==req.user.id);
    const active=await pool.query('SELECT id FROM users WHERE id=$1 AND suspended_at IS NULL',[recipient]);if(!active.rowCount)throw new UserError('This recipient is not currently active.');
    const message=await Message.create({conversationId:selected._id,senderId:req.user.id,body});
    await Conversation.updateOne({_id:selected._id},{$set:{lastMessageAt:message.createdAt,[`readAt.${req.user.id}`]:message.createdAt}});
    await Notification.updateOne({userId:recipient,eventKey:`message:${message._id}`},{$setOnInsert:{type:'new_message',text:'You have a new message.',link:`/messages/${selected._id}`}},{upsert:true});
    publish(`conversation:${selected._id}`,'message',{conversationId:String(selected._id)});publish(`user:${recipient}`,'notification',{});
    res.json({message:'Message sent.'});
  });
  router.get('/notifications',requireVerified,async(req,res)=>{
    const notifications=await Notification.find({userId:req.user.id}).sort({createdAt:-1}).limit(100).lean();
    const unread=await Notification.countDocuments({userId:req.user.id,readAt:null});res.render('notifications',{title:'Notifications',notifications,unread});
  });
  router.get('/api/notifications/unread',requireVerified,async(req,res)=>res.json({count:await Notification.countDocuments({userId:req.user.id,readAt:null})}));
  router.post('/notifications/read-all',requireVerified,async(req,res)=>{await Notification.updateMany({userId:req.user.id,readAt:null},{$set:{readAt:new Date()}});res.redirect('/notifications');});
  router.post('/notifications/:id/read',requireVerified,async(req,res)=>{if(!mongoose.isValidObjectId(req.params.id))throw new UserError('Notification not found.',404);await Notification.updateOne({_id:req.params.id,userId:req.user.id},{$set:{readAt:new Date()}});res.redirect('/notifications');});
  return router;
}
module.exports={communityRoutes};
