const express = require('express');
const { createCatalog } = require('../services/catalog');
function marketplaceRoutes({pool}) {
  const router=express.Router(); const catalog=createCatalog(pool);
  router.get('/api/time',async(req,res)=>res.json({now:(await pool.query('SELECT clock_timestamp() AS now')).rows[0].now}));
  router.get('/',async(req,res)=>{
    const [recent,featured,auctions,categories,announcements]=await Promise.all([
      catalog.browse({},4),catalog.browse({featured:true},4),catalog.browse({type:'auction',live:true},4),catalog.categories(),
      pool.query('SELECT title,body FROM announcements WHERE active=true ORDER BY created_at DESC LIMIT 3')
    ]);
    res.render('index',{title:'Your student marketplace',recent:recent.products,featured:featured.products,auctions:auctions.products,categories,announcements:announcements.rows});
  });
  router.get(['/marketplace','/auctions'],async(req,res)=>{
    const filters={...req.query,...(req.path==='/auctions'?{type:'auction'}:{})};
    const results=await catalog.browse(filters);const categories=await catalog.categories();
    const params=new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([key,value])=>key!=='page'&&typeof value==='string')));
    res.render('marketplace',{title:req.path==='/auctions'?'Auctions':'Marketplace',...results,filters,categories,pageQuery:params.toString()});
  });
  return router;
}
module.exports={marketplaceRoutes};
