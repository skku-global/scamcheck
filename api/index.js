require('dns').setServers(['8.8.8.8','1.1.1.1']);
require('dotenv').config();
const express=require('express'),helmet=require('helmet'),cors=require('cors'),rateLimit=require('express-rate-limit'),{z}=require('zod');
const {MongoClient}=require('mongodb');
const crypto=require('crypto');
const app=express();
app.use(helmet(),cors({origin:process.env.ALLOWED_ORIGIN||true}),express.json({limit:'10kb'}),rateLimit({windowMs:60000,max:30}));
const reportLimit=rateLimit({windowMs:60000,max:5});

let db=null;
async function getDb(){
 if(db)return db;
 if(!process.env.MONGO_URI)return null;
 try{const c=new MongoClient(process.env.MONGO_URI);await c.connect();db=c.db('scamcheck');return db}catch(e){console.error('Mongo error');return null}
}

const rules=[
 [/(send|pay|invest)\s*[\d,]+.{0,30}(get|receive|earn).{0,30}(times|double|triple|x\d|\d{5,})/i,35,'Send small, get big returns pattern'],
 [/guaranteed|double your money|100%\s*profit/i,25,'Promises guaranteed returns'],
 [/within\s*\d+\s*(hours|hrs|minutes)|24\s*hours/i,15,'Unrealistic timeframe'],
 [/send first|pay first|registration fee|activation fee/i,25,'Asks for payment first'],
 [/urgent|act now|last chance|expires/i,10,'Pressure and urgency'],
 [/bvn|otp|\bpin\b|password/i,25,'Asks for sensitive details'],
 [/bit\.ly|tinyurl|t\.co/i,10,'Shortened link hides destination'],
 [/http:\/\//i,10,'Link without HTTPS'],
];
const DOMAIN=/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b/gi;
const checkSchema=z.object({input:z.string().min(3).max(2000)});
const reportSchema=z.object({
 type:z.enum(['link','phone','account','message']),
 value:z.string().min(3).max(500),
 description:z.string().max(500).optional()
});

function getDomains(text){
 const out=new Set();
 for(const m of text.matchAll(DOMAIN))out.add(m[1].toLowerCase());
 return [...out].slice(0,3);
}
async function timed(url,opts={},ms=4000){
 const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
 try{return await fetch(url,{...opts,signal:c.signal})}finally{clearTimeout(t)}
}
async function domainAgeDays(d){
 try{
  const r=await timed('https://rdap.org/domain/'+encodeURIComponent(d));
  if(!r.ok)return null;
  const j=await r.json();
  const ev=(j.events||[]).find(e=>e.eventAction==='registration');
  if(!ev)return null;
  return Math.floor((Date.now()-new Date(ev.eventDate).getTime())/86400000);
 }catch{return null}
}
async function safeBrowsing(domains){
 if(!process.env.GSB_KEY||!domains.length)return false;
 try{
  const r=await timed('https://safebrowsing.googleapis.com/v4/threatMatches:find?key='+process.env.GSB_KEY,{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({
    client:{clientId:'scamcheck',clientVersion:'0.1'},
    threatInfo:{
     threatTypes:['MALWARE','SOCIAL_ENGINEERING','UNWANTED_SOFTWARE'],
     platformTypes:['ANY_PLATFORM'],threatEntryTypes:['URL'],
     threatEntries:domains.map(d=>({url:'http://'+d}))
    }
   })
  });
  const j=await r.json();
  return !!(j.matches&&j.matches.length);
 }catch{return false}
}
async function reportedBefore(text,domains){
 const d=await getDb();
 if(!d)return 0;
 try{
  const values=[text.slice(0,500),...domains];
  return await d.collection('reports').countDocuments({status:'verified',value:{$in:values}});
 }catch{return 0}
}

app.post('/api/check',async(req,res)=>{
 const p=checkSchema.safeParse(req.body);
 if(!p.success)return res.status(400).json({error:'Invalid input'});
 const text=p.data.input;
 let score=0;const reasons=[];
 for(const[r,w,t]of rules)if(r.test(text)){score+=w;reasons.push(t)}
 const domains=getDomains(text);
 const [ages,flagged,known]=await Promise.all([
  Promise.all(domains.map(domainAgeDays)),
  safeBrowsing(domains),
  reportedBefore(text,domains)
 ]);
 ages.forEach((a,i)=>{
  if(a===null)return;
  if(a<30){score+=25;reasons.push(domains[i]+' was registered '+a+' days ago')}
  else if(a<180){score+=10;reasons.push(domains[i]+' is under 6 months old')}
 });
 if(flagged){score+=60;reasons.push('Link flagged by Google Safe Browsing')}
 if(known>0){score+=40;reasons.push('Reported as a scam by other users')}
 score=Math.min(score,100);
 const risk=score>=50?'High':score>=20?'Medium':'Low';
 res.json({risk,score,reasons,note:'Low risk does not mean safe.'});
 getDb().then(d=>d&&d.collection('checks').insertOne({
  input_hash:crypto.createHash('sha256').update(text).digest('hex'),
  risk,score,reasons,created_at:new Date()
 })).catch(()=>{});
});

app.post('/api/report',reportLimit,async(req,res)=>{
 const p=reportSchema.safeParse(req.body);
 if(!p.success)return res.status(400).json({error:'Invalid input'});
 const d=await getDb();
 if(!d)return res.status(503).json({error:'Reporting unavailable'});
 try{
  await d.collection('reports').insertOne({
   type:p.data.type,value:p.data.value,description:p.data.description||'',
   status:'pending',created_at:new Date()
  });
  res.json({ok:true});
 }catch{res.status(500).json({error:'Could not save report'})}
});

app.get('/api/entity',async(req,res)=>{
 const name=typeof req.query.name==='string'?req.query.name.trim():'';
 if(name.length<2||name.length>100)return res.status(400).json({error:'Invalid name'});
 const d=await getDb();
 if(!d)return res.status(503).json({error:'Lookup unavailable'});
 try{
  const safe=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const e=await d.collection('entities').findOne({name:{$regex:safe,$options:'i'}},{projection:{_id:0,name:1,type:1,regulator_status:1,last_verified:1}});
  res.json(e?{found:true,entity:e}:{found:false});
 }catch{res.status(500).json({error:'Lookup failed'})}
});

app.listen(process.env.PORT||4000,()=>console.log('API up'));
