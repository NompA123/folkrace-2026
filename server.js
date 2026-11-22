'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const ROOT=__dirname, PUBLIC=path.join(ROOT,'public');
fs.mkdirSync(path.join(ROOT,'data'),{recursive:true});
const db=new DatabaseSync(path.join(ROOT,'data','folkrace.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, title TEXT NOT NULL, track TEXT NOT NULL, starts_at TEXT NOT NULL, event_class TEXT NOT NULL, max_drivers INTEGER NOT NULL, rounds INTEGER NOT NULL DEFAULT 3, description TEXT NOT NULL DEFAULT '', organizer_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS registrations(id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, car TEXT NOT NULL, number TEXT NOT NULL DEFAULT '', team TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(event_id,user_id));
CREATE INDEX IF NOT EXISTS reg_event ON registrations(event_id);
CREATE INDEX IF NOT EXISTS event_start ON events(starts_at);`);
const PORT=Number(process.env.PORT||3000);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
function send(res,code,data,headers={}){const body=typeof data==='string'?data:JSON.stringify(data);res.writeHead(code,{'Content-Type':typeof data==='string'?'text/plain; charset=utf-8':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(body)}
function fail(res,code,msg){send(res,code,{error:msg})}
function parseCookie(raw){let obj={};for(const bit of (raw||'').split(';')){const i=bit.indexOf('=');if(i>0)obj[bit.slice(0,i).trim()]=bit.slice(i+1).trim()}return obj}
function session(req){const value=parseCookie(req.headers.cookie).fr_session;if(!value||! /^[a-f0-9]{64}$/.test(value))return null;const hash=crypto.createHash('sha256').update(value).digest('hex');return db.prepare('SELECT u.id,u.username,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(hash,Date.now())||null}
function requireUser(req,res){const u=session(req);if(!u)fail(res,401,'Logga in för att fortsätta.');return u}
function passwordHash(pass,salt=crypto.randomBytes(16).toString('hex')){return salt+':'+crypto.scryptSync(pass,salt,64).toString('hex')}
function checkPassword(p,stored){const [salt,hex]=stored.split(':');if(!salt||!hex)return false;const a=crypto.scryptSync(p,salt,64),b=Buffer.from(hex,'hex');return b.length===a.length&&crypto.timingSafeEqual(a,b)}
function makeSession(res,userId,req){const token=crypto.randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),userId,Date.now()+30*86400000);const secure=process.env.COOKIE_SECURE==='1'||(req.headers['x-forwarded-proto']==='https');const cookie=`fr_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure?'; Secure':''}`;res.setHeader('Set-Cookie',cookie)}
function clean(x,max=200){return typeof x==='string'?x.trim().slice(0,max):''}
function eventRows(){return db.prepare(`SELECT e.*,u.username AS organizer, (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id) AS signed FROM events e JOIN users u ON u.id=e.organizer_id ORDER BY CASE WHEN e.starts_at >= datetime('now') AND e.status='open' THEN 0 ELSE 1 END, e.starts_at ASC, e.id DESC`).all()}
function eventDetail(id){return db.prepare(`SELECT e.*,u.username AS organizer,(SELECT COUNT(*) FROM registrations WHERE event_id=e.id) AS signed FROM events e JOIN users u ON u.id=e.organizer_id WHERE e.id=?`).get(id)}
function registrationRows(id){return db.prepare(`SELECT r.id,r.user_id,u.username,u.display_name,r.car,r.number,r.team,r.created_at FROM registrations r JOIN users u ON u.id=r.user_id WHERE r.event_id=? ORDER BY r.created_at,r.id`).all(id)}
function isFuture(date){const t=Date.parse(date);return Number.isFinite(t)&&t>Date.now()}
function validStart(s){return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)&&Number.isFinite(Date.parse(s))}
async function payload(req){let buf='',size=0;for await(const ch of req){size+=ch.length;if(size>16000)throw {status:413,message:'För mycket data.'};buf+=ch}try{return JSON.parse(buf||'{}')}catch{throw {status:400,message:'Ogiltig data.'}}}
function escapePath(s){const x=path.normalize(decodeURIComponent(s)).replace(/^([/\\])+/, '');return path.join(PUBLIC,x)}
function safeOrigin(req){const origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===req.headers.host}catch{return false}}
const limits=new Map();function rate(req){const ip=(req.socket.remoteAddress||'')+':'+(req.url||'');const now=Date.now(),cur=limits.get(ip)||{n:0,t:now};if(now-cur.t>60000){cur.n=0;cur.t=now}cur.n++;limits.set(ip,cur);return cur.n<=70}
setInterval(()=>{db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());if(limits.size>2000)limits.clear()},3600000).unref();
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,`http://${req.headers.host||'localhost'}`),route=url.pathname,method=req.method||'GET';
 if(!route.startsWith('/api/')){
  if(method!=='GET')return fail(res,405,'Metoden stöds inte.');const f=route==='/'?path.join(PUBLIC,'index.html'):escapePath(route);if(!f.startsWith(PUBLIC+path.sep))return fail(res,403,'Nekad.');fs.stat(f,(err,stat)=>{if(err||!stat.isFile())return fail(res,404,'Sidan hittades inte.');res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});fs.createReadStream(f).pipe(res)});return;
 }
 if(!rate(req))return fail(res,429,'För många förfrågningar. Försök igen snart.');
 if(method!=='GET'&&!safeOrigin(req))return fail(res,403,'Ogiltig begäran.');
 if(route==='/api/me'&&method==='GET')return send(res,200,{user:session(req)});
 if(route==='/api/events'&&method==='GET')return send(res,200,{events:eventRows()});
 const detail=route.match(/^\/api\/events\/(\d+)$/);if(detail&&method==='GET'){const e=eventDetail(Number(detail[1]));return e?send(res,200,{event:e,registrations:registrationRows(e.id)}):fail(res,404,'Tävlingen finns inte.')}
 if(route==='/api/register'&&method==='POST'){
  const b=await payload(req),username=clean(b.username,28),display=clean(b.display_name,60),pass=b.password;
  if(!/^[A-Za-z0-9_]{3,20}$/.test(username)||!display||typeof pass!=='string'||pass.length<8||pass.length>128)return fail(res,400,'Ange Roblox-användarnamn (3–20 tecken), visningsnamn och ett lösenord på minst 8 tecken.');
  try{const r=db.prepare('INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?)').run(username,display,passwordHash(pass));makeSession(res,Number(r.lastInsertRowid),req);return send(res,201,{ok:true})}catch(e){if(String(e).includes('UNIQUE'))return fail(res,409,'Användarnamnet finns redan.');throw e}
 }
 if(route==='/api/login'&&method==='POST'){
  const b=await payload(req),u=db.prepare('SELECT * FROM users WHERE username=?').get(clean(b.username,28));if(!u||typeof b.password!=='string'||!checkPassword(b.password,u.password_hash))return fail(res,401,'Fel användarnamn eller lösenord.');makeSession(res,u.id,req);return send(res,200,{ok:true})
 }
 if(route==='/api/logout'&&method==='POST'){
  const t=parseCookie(req.headers.cookie).fr_session;if(t)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(t).digest('hex'));
  res.setHeader('Set-Cookie','fr_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');return send(res,200,{ok:true})
 }
 if(route==='/api/events'&&method==='POST'){
  const u=requireUser(req,res);if(!u)return;const b=await payload(req),title=clean(b.title,85),track=clean(b.track,70),start=clean(b.starts_at,40),klass=clean(b.event_class,40),description=clean(b.description,1200),max=Number(b.max_drivers),rounds=Number(b.rounds);
  if(title.length<4||track.length<2||!validStart(start)||!isFuture(start)||!klass||!Number.isInteger(max)||max<2||max>150||!Number.isInteger(rounds)||rounds<1||rounds>8)return fail(res,400,'Kontrollera tävlingens namn, bana, framtida datum, klass, maxantal och omgångar.');
  const r=db.prepare('INSERT INTO events(title,track,starts_at,event_class,max_drivers,rounds,description,organizer_id) VALUES(?,?,?,?,?,?,?,?)').run(title,track,start,klass,max,rounds,description,u.id);return send(res,201,{id:Number(r.lastInsertRowid)})
 }
 const status=route.match(/^\/api\/events\/(\d+)\/status$/);if(status&&method==='POST'){
  const u=requireUser(req,res);if(!u)return;const e=eventDetail(Number(status[1]));if(!e)return fail(res,404,'Tävlingen finns inte.');if(e.organizer_id!==u.id)return fail(res,403,'Bara arrangören får ändra tävlingen.');const b=await payload(req);
  if(!['open','closed','cancelled'].includes(b.status))return fail(res,400,'Ogiltig status.');if(b.status==='open'&&!isFuture(e.starts_at))return fail(res,400,'Tävlingen har redan startat.');db.prepare('UPDATE events SET status=? WHERE id=?').run(b.status,e.id);return send(res,200,{ok:true})
 }
 const registration=route.match(/^\/api\/events\/(\d+)\/registrations$/);if(registration&&method==='POST'){
  const u=requireUser(req,res);if(!u)return;const id=Number(registration[1]),b=await payload(req),car=clean(b.car,85),number=clean(b.number,8),team=clean(b.team,80),e=eventDetail(id);
  if(!e)return fail(res,404,'Tävlingen finns inte.');if(e.status!=='open'||!isFuture(e.starts_at))return fail(res,400,'Anmälan är stängd.');if(!car||car.length<2||number&&!/^[0-9A-Za-z-]{1,8}$/.test(number))return fail(res,400,'Ange bil och eventuellt startnummer.');
  try{db.exec('BEGIN IMMEDIATE');const count=db.prepare('SELECT COUNT(*) AS n FROM registrations WHERE event_id=?').get(id).n;if(count>=e.max_drivers){db.exec('ROLLBACK');return fail(res,409,'Tävlingen är full.')}db.prepare('INSERT INTO registrations(event_id,user_id,car,number,team) VALUES(?,?,?,?,?)').run(id,u.id,car,number,team);db.exec('COMMIT');return send(res,201,{ok:true})}catch(err){if(db.isTransaction)db.exec('ROLLBACK');if(String(err).includes('UNIQUE'))return fail(res,409,'Du är redan anmäld till tävlingen.');throw err}
 }
 const remove=route.match(/^\/api\/events\/(\d+)\/registrations\/(\d+)$/);if(remove&&method==='DELETE'){
  const u=requireUser(req,res);if(!u)return;const e=eventDetail(Number(remove[1])),r=db.prepare('SELECT * FROM registrations WHERE id=? AND event_id=?').get(Number(remove[2]),Number(remove[1]));if(!e||!r)return fail(res,404,'Anmälan hittades inte.');if(r.user_id!==u.id&&e.organizer_id!==u.id)return fail(res,403,'Du får inte ta bort den här anmälan.');if(!isFuture(e.starts_at))return fail(res,400,'Tävlingen har redan börjat.');db.prepare('DELETE FROM registrations WHERE id=?').run(r.id);return send(res,200,{ok:true})
 }
 return fail(res,404,'Okänd API-adress.');
 }catch(err){console.error(err);fail(res,err.status||500,err.status?err.message:'Ett serverfel inträffade.')}});
server.listen(PORT,'0.0.0.0',()=>console.log(`🏁 Folkrace 2026 igång på http://localhost:${PORT}`));
