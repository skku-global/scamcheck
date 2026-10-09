require('dns').setServers(['8.8.8.8','1.1.1.1']);
require('dotenv').config();
const {MongoClient}=require('mongodb');
const u=process.env.MONGO_URI||'';
console.log('URI set:',u.length>0,'| starts mongodb+srv:',u.startsWith('mongodb+srv://'),'| has placeholder:',u.includes('PASTE_URI_HERE'));
new MongoClient(u,{serverSelectionTimeoutMS:8000}).connect()
 .then(c=>{console.log('CONNECTED');return c.close()})
 .catch(e=>console.log('FAIL:',e.name,'-',String(e.message).replace(/\/\/[^@]*@/,'//***@').slice(0,250)));
