require('dns').setServers(['8.8.8.8','1.1.1.1']);
require('dotenv').config();
const express=require('express'),helmet=require('helmet'),cors=require('cors'),rateLimit=require('express-rate-limit'),{z}=require('zod');
const {MongoClient}=require('mongodb');
const crypto=require('crypto');
const app=express();
app.set('trust proxy',1);
app.use(helmet());
const ORIGINS=(process.env.ALLOWED_ORIGIN||'').split(',').map(x=>x.replace(/[\s"']/g,'').replace(/\/+$/,'')).filter(Boolean);
app.use(cors({origin:(o,cb)=>cb(null,!o||!ORIGINS.length||ORIGINS.includes(o))}));
app.use(express.json({limit:'100kb',verify:(req,_r,buf)=>{req.rawBody=buf}}));
const checkLimit=rateLimit({windowMs:60000,max:30});
const reportLimit=rateLimit({windowMs:60000,max:5});

let dbp=null;
function getDb(){
 if(!process.env.MONGO_URI)return Promise.resolve(null);
 if(!dbp)dbp=(async()=>{
  try{
   const c=new MongoClient(process.env.MONGO_URI,{serverSelectionTimeoutMS:8000});
   await c.connect();
   const d=c.db('scamcheck');
   d.collection('reports').createIndex({value:1,status:1}).catch(()=>{});
   d.collection('entities').createIndex({name:1}).catch(()=>{});
   return d;
  }catch{console.error('Mongo error');return null}
 })().then(d=>{if(!d)dbp=null;return d});
 return dbp;
}

const rules=[
 [/guaranteed|double your money|100%\s*profit/i,25,'Promises guaranteed returns'],
 [/within\s*\d+\s*(hours|hrs|minutes)|24\s*hours/i,15,'Unrealistic timeframe'],
 [/send first|pay first|registration fee|activation fee/i,25,'Asks for payment first'],
 [/urgent|act now|last chance|expires/i,10,'Pressure and urgency'],
 [/\bbvn\b|\botp\b|\bpin\b|password/i,25,'Asks for sensitive details'],
 [/bit\.ly|tinyurl|t\.co\//i,10,'Shortened link hides destination'],
 [/http:\/\//i,10,'Link without HTTPS'],
 [/(send|pay|invest)\s*[\d,]+.{0,30}(get|receive|earn).{0,30}(times|double|triple|x\d|\d{5,})/i,35,'Send small, get big returns pattern'],
 [/(send|share|give|provide|enter|confirm).{0,25}(otp|pin|password|bvn|card number|cvv)/i,40,'Asks you to share a code or secret'],
 [/(blocked|suspended|deactivated|restricted|locked|expired).{0,40}(account|bvn|card|sim|wallet)|(account|bvn|card|sim|wallet).{0,40}(blocked|suspended|deactivated|restricted|locked|expired)/i,25,'Account threat'],
];
const SUMMARY={
 High:'Several strong scam signs were found. Do not send money, codes, or personal details.',
 Medium:'Some warning signs were found. Verify through an official channel before you act.',
 Low:'No known scam signs were found in this check. That does not guarantee safety.'
};
const DOMAIN=/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b/gi;
const PHONE=/(?:\+?234|\b0)[\d\s-]{9,13}\d/g;
const VALID=/^0[789][01]\d{8}$/;
const checkSchema=z.object({input:z.string().trim().min(3).max(2000)});
const reportSchema=z.object({
 type:z.enum(['link','phone','account','message']),
 value:z.string().trim().min(3).max(500),
 description:z.string().max(500).optional()
});

function normPhone(s){
 let d=String(s).replace(/\D/g,'');
 if(d.startsWith('234')&&d.length===13)d='0'+d.slice(3);
 else if(d.length===10&&/^[789]/.test(d))d='0'+d;
 return d;
}
function normLink(v){return v.toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split(/[/?#]/)[0]}
function getDomains(text){
 const out=new Set();
 for(const m of text.matchAll(DOMAIN))out.add(m[1].toLowerCase());
 return [...out].slice(0,3);
}
function getPhones(text){
 const out=new Set();
 for(const m of text.matchAll(PHONE)){const n=normPhone(m[0]);if(VALID.test(n))out.add(n)}
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
    client:{clientId:'scamcheck',clientVersion:'0.2'},
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
async function reportedBefore(text,extra){
 const d=await getDb();
 if(!d)return 0;
 try{
  return await d.collection('reports').countDocuments({status:'verified',value:{$in:[text.slice(0,500),...extra]}});
 }catch{return 0}
}
let entCache={at:0,list:[]};
async function getEntities(){
 if(Date.now()-entCache.at<300000)return entCache.list;
 const d=await getDb();
 if(!d)return [];
 try{entCache={at:Date.now(),list:await d.collection('entities').find({},{projection:{_id:0}}).limit(2000).toArray()}}catch{}
 return entCache.list;
}

async function analyze(raw){
 const text=raw.trim();
 let score=0;const reasons=[],matches=[];
 for(const[r,w,t]of rules){const m=r.exec(text);if(m){score+=w;reasons.push(t);matches.push({text:m[0],reason:t})}}
 const domains=getDomains(text);
 const phones=getPhones(text);
 if(/^\+?[\d\s-]{7,16}$/.test(text)){
  const n=normPhone(text);
  if(VALID.test(n)){if(!phones.includes(n))phones.push(n)}
  else{score+=10;reasons.push('Not a standard Nigerian mobile number format')}
 }
 const [ages,flagged,known,ents]=await Promise.all([
  Promise.all(domains.map(domainAgeDays)),
  safeBrowsing(domains),
  reportedBefore(text,[...domains,...phones]),
  getEntities()
 ]);
 ages.forEach((a,i)=>{
  if(a===null)return;
  if(a<30){score+=25;reasons.push(domains[i]+' was registered '+a+' days ago');matches.push({text:domains[i],reason:'Newly registered domain'})}
  else if(a<180){score+=10;reasons.push(domains[i]+' is under 6 months old');matches.push({text:domains[i],reason:'Young domain'})}
 });
 if(flagged){score+=60;reasons.push('Link flagged by Google Safe Browsing')}
 if(known>0){score+=40;reasons.push('Reported as a scam by other users')}
 const low=text.toLowerCase();
 for(const e of ents){
  const hit=[e.name,...(e.aliases||[])].filter(n=>n&&n.length>=4).find(n=>low.includes(n.toLowerCase()));
  if(!hit)continue;
  const src=e.source||'a regulator list';
  if(e.regulator_status==='blacklisted'){score+=50;reasons.push(e.name+' is blacklisted ('+src+')');matches.push({text:hit,reason:'Blacklisted'})}
  else if(e.regulator_status==='warning'){score+=25;reasons.push(e.name+' has a public warning ('+src+')');matches.push({text:hit,reason:'Warning'})}
  else if(e.regulator_status==='registered'){reasons.push(e.name+' is on a registered list ('+src+'). Scammers copy real names, so confirm the contact details.')}
 }
 score=Math.min(score,100);
 const risk=score>=50?'High':score>=20?'Medium':'Low';
 return {risk,score,reasons,matches,summary:SUMMARY[risk],note:'Low risk does not mean safe.'};
}

app.get('/api/health',(_q,r)=>r.json({ok:true}));

app.post('/api/check',checkLimit,async(req,res)=>{
 const p=checkSchema.safeParse(req.body);
 if(!p.success)return res.status(400).json({error:'Invalid input'});
 try{
  const out=await analyze(p.data.input);
  res.json(out);
  getDb().then(d=>d&&d.collection('checks').insertOne({
   input_hash:crypto.createHash('sha256').update(p.data.input).digest('hex'),
   risk:out.risk,score:out.score,reasons:out.reasons,created_at:new Date()
  })).catch(()=>{});
 }catch{res.status(500).json({error:'Check failed'})}
});

app.post('/api/report',reportLimit,async(req,res)=>{
 const p=reportSchema.safeParse(req.body);
 if(!p.success)return res.status(400).json({error:'Invalid input'});
 const d=await getDb();
 if(!d)return res.status(503).json({error:'Reporting unavailable'});
 let value=p.data.value;
 if(p.data.type==='phone')value=normPhone(value);
 else if(p.data.type==='link')value=normLink(value);
 try{
  await d.collection('reports').insertOne({type:p.data.type,value,description:p.data.description||'',status:'pending',created_at:new Date()});
  res.json({ok:true});
 }catch{res.status(500).json({error:'Could not save report'})}
});

app.get('/api/entity',checkLimit,async(req,res)=>{
 const name=typeof req.query.name==='string'?req.query.name.trim():'';
 if(name.length<2||name.length>100)return res.status(400).json({error:'Invalid name'});
 const d=await getDb();
 if(!d)return res.status(503).json({error:'Lookup unavailable'});
 try{
  const safe=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const e=await d.collection('entities').findOne({name:{$regex:safe,$options:'i'}},{projection:{_id:0,name:1,type:1,regulator_status:1,source:1}});
  res.json(e?{found:true,entity:e}:{found:false});
 }catch{res.status(500).json({error:'Lookup failed'})}
});

// WhatsApp
function validSig(req){
 const s=process.env.WA_APP_SECRET;
 if(!s)return false;
 const h=req.get('x-hub-signature-256')||'';
 const e='sha256='+crypto.createHmac('sha256',s).update(req.rawBody||'').digest('hex');
 const a=Buffer.from(h),b=Buffer.from(e);
 return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
async function waSend(to,body){
 if(!process.env.WA_TOKEN||!process.env.WA_PHONE_ID)return;
 try{
  await timed('https://graph.facebook.com/v20.0/'+process.env.WA_PHONE_ID+'/messages',{
   method:'POST',
   headers:{Authorization:'Bearer '+process.env.WA_TOKEN,'Content-Type':'application/json'},
   body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:body.slice(0,1500)}})
  },8000);
 }catch{}
}
const waHits=new Map();
function waAllowed(n){
 const now=Date.now();
 const arr=(waHits.get(n)||[]).filter(t=>now-t<60000);
 if(arr.length>=10){waHits.set(n,arr);return false}
 arr.push(now);waHits.set(n,arr);
 if(waHits.size>5000)waHits.clear();
 return true;
}
app.get('/api/whatsapp',(req,res)=>{
 if(req.query['hub.mode']==='subscribe'&&process.env.WA_VERIFY_TOKEN&&req.query['hub.verify_token']===process.env.WA_VERIFY_TOKEN){
  return res.status(200).type('text/plain').send(String(req.query['hub.challenge']||''));
 }
 res.sendStatus(403);
});
app.post('/api/whatsapp',async(req,res)=>{
 if(!validSig(req))return res.sendStatus(403);
 res.sendStatus(200);
 try{
  for(const en of req.body.entry||[])for(const ch of en.changes||[])for(const m of (ch.value&&ch.value.messages)||[]){
   const from=m.from;
   if(!from||!waAllowed(from))continue;
   const text=m.type==='text'&&m.text?String(m.text.body||'').trim():'';
   if(text.length<3){await waSend(from,'Send me a link, message, or phone number and I will check it for scam signs.');continue}
   const out=await analyze(text.slice(0,2000));
   const lines=['*'+out.risk+' risk* ('+out.score+'/100)',out.summary];
   if(out.reasons.length)lines.push('','Why:',...out.reasons.slice(0,6).map(r=>'- '+r));
   lines.push('',out.note);
   await waSend(from,lines.join('\n'));
  }
 }catch{}
});

app.use((e,_q,r,_n)=>r.status(500).json({error:'Server error'}));
app.listen(process.env.PORT||4000,()=>console.log('API up'));
