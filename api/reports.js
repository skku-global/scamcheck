require('dns').setServers(['8.8.8.8','1.1.1.1']);
require('dotenv').config();
const {MongoClient,ObjectId}=require('mongodb');
(async()=>{
 const [cmd,id]=process.argv.slice(2);
 const c=new MongoClient(process.env.MONGO_URI);await c.connect();
 const col=c.db('scamcheck').collection('reports');
 if(cmd==='list'){
  const r=await col.find({status:'pending'}).sort({created_at:-1}).limit(50).toArray();
  r.forEach(x=>console.log(String(x._id),x.type,JSON.stringify(x.value.slice(0,80))));
  console.log(r.length+' pending');
 }else if(cmd==='verify'||cmd==='reject'){
  const r=await col.updateOne({_id:new ObjectId(id)},{$set:{status:cmd==='verify'?'verified':'rejected'}});
  console.log('updated',r.modifiedCount);
 }else console.log('usage: node reports.js list | verify <id> | reject <id>');
 await c.close();
})().catch(e=>console.log('error:',e.message));
