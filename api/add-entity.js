require('dns').setServers(['8.8.8.8','1.1.1.1']);
require('dotenv').config();
const {MongoClient}=require('mongodb');
(async()=>{
 const [name,type,status,source]=process.argv.slice(2);
 if(!name||!['registered','warning','blacklisted'].includes(status)){
  console.log('usage: node add-entity.js "Name" "investment platform" registered|warning|blacklisted "SEC list, 2026"');return;
 }
 const c=new MongoClient(process.env.MONGO_URI);await c.connect();
 await c.db('scamcheck').collection('entities').updateOne(
  {name},{$set:{name,type:type||'unknown',regulator_status:status,source:source||'',last_verified:new Date()},$setOnInsert:{aliases:[]}},{upsert:true});
 console.log('saved',name,status);
 await c.close();
})().catch(e=>console.log('error:',e.message));
