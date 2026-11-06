// Music Box: two iPads facing each other across a table, their far edges
// touching. Each player has a keyboard at their own edge. Between them, across
// the seam, a slow brass ring turns like the cylinder of a music box seen from
// above. Playing a key sets a pin into the ring; when a pin passes a player's
// comb, that player's wooden hands play it on their piano. The two devices
// run the rings from one clock, so the box stays in step however long it runs.
import * as LIVE from './live.js';
import {createStage} from './stage.js';

const q=s=>document.querySelector(s);
const TAU=Math.PI*2;
const PALETTE={paper:'#f1f2ed',ink:'#213b3c',copper:'#965432',lower:'#75898b',line:'#c8cfca',muted:'#637b7c',brass:'#e6e3d6',brassDark:'#d7d3c2'};
const RINGS={outer:{period:12,lo:0.66,hi:1.0},inner:{period:24,lo:0.33,hi:0.6}};
const FRICTION=25;        // seconds for a push to settle back to the ring's own pace
const LIFE_TURNS=10;      // a pin fades over this many turns, then is gone
const PITCH_LO=36,PITCH_HI=96;
const COMB={A:Math.PI/2,B:-Math.PI/2};  // world angle of each player's comb: A sits at +y, B at -y
const RELAY=location.hostname==='localhost'||location.hostname==='127.0.0.1'?'ws://127.0.0.1:5077/music-box/ws':'wss://tools.theuniversalsandpit.org/music-box/ws';
const PX_PER_MM=132/25.4; // iPad screens, near enough

// ---------- settings remembered on this device
const store={
 get(k,d){try{const v=localStorage.getItem('music-box:'+k);return v===null?d:JSON.parse(v);}catch{return d;}},
 set(k,v){try{localStorage.setItem('music-box:'+k,JSON.stringify(v));}catch{}},
};
const clientId=(()=>{try{let id=sessionStorage.getItem('music-box:id');if(!id){id=Math.random().toString(36).slice(2,10)+Date.now().toString(36);sessionStorage.setItem('music-box:id',id);}return id;}catch{return Math.random().toString(36).slice(2,12);}})(); // per tab, so a second tab on one device takes the other seat
const WORDS=['wren','field','fig','oak','tide','harbour','moss','lark','gum','reed','cove','fern','shell','sand','kite','pelican','dune','bay','cliff','lantern','rain','bench','willow','river','stone','cloud'];
const newCode=()=>WORDS[Math.random()*WORDS.length|0]+'-'+WORDS[Math.random()*WORDS.length|0];

// ---------- the state of the box
const me={seat:null,name:store.get('name',''),room:null,inst:store.get('inst','piano'),ring:'outer',gapMm:store.get('gap',10),base:store.get('octave',48)};
const box={started:null,spin:{},pins:new Map(),holds:{A:false,B:false},peers:{}};
const fx={ripples:[],blooms:[]};
let stage=null,ws=null,joined=false,clockOffset=0,bestRtt=Infinity,bestAt=0,pinCounter=0;
let lastNow=0;
const serverNow=()=>{const t=Date.now()+clockOffset;if(t<lastNow)return lastNow;lastNow=t;return t;}; // never runs backwards, so a pin cannot re-cross a comb

// ---------- sound: each device plays its own notes, in its own instrument
const pianoBuffers=new Map();
function pianoBuffer(ctx,midi){if(!pianoBuffers.has(midi))for(const [k,b] of LIVE.synthesizePiano(ctx,[midi]))pianoBuffers.set(k,b);return pianoBuffers.get(midi);}
function voice(ctx,dest,name,midi,vel,at){
 const f=440*Math.pow(2,(midi-69)/12),g=ctx.createGain();g.connect(dest);
 const nodes=[],osc=(type,freq,gain,detune=0)=>{const o=ctx.createOscillator();o.type=type;o.frequency.value=freq;o.detune.value=detune;const og=ctx.createGain();og.gain.value=gain;o.connect(og);og.connect(g);o.start(at);nodes.push(o);return og;};
 const amp=0.15+0.85*vel*vel;let release=0.25,sustained=false;
 const decay=(peak,tau)=>{g.gain.setValueAtTime(0.0001,at);g.gain.linearRampToValueAtTime(peak,at+0.004);g.gain.setTargetAtTime(0.0005,at+0.004,tau);};
 switch(name){
  case 'piano':{const src=ctx.createBufferSource();src.buffer=pianoBuffer(ctx,midi);src.connect(g);g.gain.value=amp;src.start(at);nodes.push(src);release=0.28;break;}
  case 'musicbox':{osc('sine',f,0.8);osc('sine',f*2.76,0.22);osc('sine',f*5.4,0.07);osc('triangle',f*4,0.04);decay(amp*0.9,0.45+1.1*Math.max(0,(96-midi)/60));release=0.3;break;}
  case 'epiano':{osc('sine',f,0.7);osc('sine',f*2,0.25*(1-vel*0.4));osc('sine',f*3.01,0.06);osc('triangle',f,0.12,6);decay(amp*0.9,0.55+1.8*Math.max(0,(90-midi)/60));release=0.18;break;}
  case 'vibes':{const og=osc('sine',f,0.8);osc('sine',f*4,0.08);const lfo=ctx.createOscillator();lfo.frequency.value=5.2;const lg=ctx.createGain();lg.gain.value=0.35;lfo.connect(lg);lg.connect(og.gain);lfo.start(at);nodes.push(lfo);decay(amp*0.9,1.1+2.0*Math.max(0,(96-midi)/60));release=0.35;break;}
  case 'organ':{osc('sine',f,0.5);osc('sine',f*2,0.3);osc('sine',f*3,0.14);osc('sine',f*4,0.08);osc('sine',f*0.5,0.18);g.gain.setValueAtTime(0.0001,at);g.gain.linearRampToValueAtTime(amp*0.5,at+0.03);sustained=true;release=0.09;break;}
 }
 let stopped=false;
 return {stop(when=ctx.currentTime){if(stopped)return;stopped=true;const t0=Math.max(when,at+0.01);g.gain.cancelScheduledValues(t0);g.gain.setValueAtTime(Math.max(0.0001,sustained?amp*0.5:0.5),t0);g.gain.setTargetAtTime(0.0001,t0,release/4);for(const n of nodes)n.stop(t0+release+0.05);},quick(when){if(stopped)return;stopped=true;g.gain.cancelScheduledValues(when);g.gain.setTargetAtTime(0.0001,when,0.01);for(const n of nodes)n.stop(when+0.06);}};
}
const piano={
 ctx:null,master:null,voices:new Map(),
 init(){
  if(this.ctx){if(this.ctx.state==='suspended')this.ctx.resume();return;}
  this.ctx=new (window.AudioContext||window.webkitAudioContext)();
  this.master=this.ctx.createGain();this.master.gain.value=0.8;this.master.connect(this.ctx.destination);
  const order=[];for(let d=0;d<40;d++){if(60+d<=PITCH_HI)order.push(60+d);if(d&&60-d>=PITCH_LO)order.push(60-d);}
  const step=()=>{if(!order.length)return;for(const m of order.splice(0,3))pianoBuffer(this.ctx,m);setTimeout(step,8);};step();
 },
 noteOn(key,midi,vel){this.init();if(!this.ctx)return;const old=this.voices.get(key);if(old)old.quick(this.ctx.currentTime);this.voices.set(key,voice(this.ctx,this.master,me.inst,midi,vel,this.ctx.currentTime));},
 noteOff(key){const v=this.voices.get(key);if(!v)return;v.stop(this.ctx.currentTime);this.voices.delete(key);},
};

// ---------- the rings: one shared clock, one angle per ring
function spinOf(ring){return box.spin[ring]||{theta0:0,omega:TAU/RINGS[ring].period,t0:box.started||0};}
function theta(ring,t=serverNow()){
 if(box.started===null)return (box.spin[ring]||{theta0:0}).theta0;
 const s=spinOf(ring),base=TAU/RINGS[ring].period,dt=Math.max(0,(t-Math.max(s.t0,box.started))/1000);
 return s.theta0+base*dt+(s.omega-base)*FRICTION*(1-Math.exp(-dt/FRICTION));
}
const wrap=a=>{a=(a+Math.PI)%TAU;if(a<0)a+=TAU;return a-Math.PI;};
function pinLife(p,now){const turns=(now-(p.born||now))/(RINGS[p.ring].period*1000);return Math.max(0,1-turns/LIFE_TURNS);}

// which pins pass my comb this frame: the hands play them
const playing=new Map(); // pin id -> midi, while the hands hold it
function passComb(now){
 if(!stage||!me.seat||box.started===null)return;
 const c=COMB[me.seat];
 for(const p of box.pins.values()){
  if(now-(p.born||0)<500&&p.who===me.seat){p._a=1e-6;p._b=1e-6;continue;} // a pin just set is sitting on my comb; it plays when it comes round
  const th=theta(p.ring,now),a=wrap(p.a+th-c),len=Math.max(p.len||0,0.02),b=wrap(p.a+len+th-c);
  if(p._a!==undefined){
   if(Math.sign(p._a)!==Math.sign(a)&&Math.abs(a-p._a)<Math.PI&&a!==0){
    const tag=p.who===me.seat?'mine':'theirs';
    if(playing.has(p.id))stage.engine.noteOff(playing.get(p.id));
    stage.engine.noteOn(p.midi,p.vel||0.7,tag);playing.set(p.id,p.midi);
    bloomAt(p,th,tag==='mine'?PALETTE.ink:PALETTE.copper);
   }
   if(!p.open&&Math.sign(p._b)!==Math.sign(b)&&Math.abs(b-p._b)<Math.PI&&playing.has(p.id)){stage.engine.noteOff(playing.get(p.id));playing.delete(p.id);}
  }
  p._a=a;p._b=b;
 }
 for(const [id,midi] of playing)if(!box.pins.has(id)){stage.engine.noteOff(midi);playing.delete(id);}
}
function bloomAt(p,th,color){const r=pinRadius(p),ang=p.a+th;fx.blooms.push({x:Math.cos(ang)*r,y:Math.sin(ang)*r,t0:performance.now(),color});}

// ---------- geometry: world px, centred on the ring, +y toward player A; each device draws its own half
const geo={W:0,H:0,R:0,gapHalf:0,ringH:0,keysTop:0};
function layout(){
 geo.W=innerWidth;geo.H=innerHeight;
 geo.R=Math.min(300,Math.max(150,geo.W*0.3));
 geo.gapHalf=me.gapMm*PX_PER_MM;
 geo.ringH=Math.round(geo.R-geo.gapHalf+14);
 document.documentElement.style.setProperty('--ring-h',geo.ringH+'px');
 const ov=q('#overlay');const dpr=Math.min(2,devicePixelRatio||1);ov.width=Math.round(geo.W*dpr);ov.height=Math.round(geo.H*dpr);ov.style.width=geo.W+'px';ov.style.height=geo.H+'px';
 geo.keysTop=q('#keys').getBoundingClientRect().top;
}
const flip=()=>me.seat==='B'?-1:1;
const toWorld=(sx,sy)=>({x:flip()*(sx-geo.W/2),y:flip()*(sy+geo.gapHalf)});
function pinRadius(p){const r=RINGS[p.ring];const u=Math.max(0,Math.min(1,(p.midi-PITCH_LO)/(PITCH_HI-PITCH_LO)));return geo.R*(r.lo+0.06+u*(r.hi-r.lo-0.12));}

// ---------- drawing the box
function drawRing(){
 const ov=q('#overlay'),ctx=ov.getContext('2d'),dpr=Math.min(2,devicePixelRatio||1);
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,geo.W,geo.H);
 const now=serverNow(),pnow=performance.now(),R=geo.R;
 ctx.save();ctx.translate(geo.W/2,-geo.gapHalf);if(me.seat==='B')ctx.rotate(Math.PI);
 // the disc
 ctx.fillStyle=PALETTE.brass;ctx.beginPath();ctx.arc(0,0,R,0,TAU);ctx.fill();
 ctx.lineWidth=1.4;ctx.strokeStyle=PALETTE.ink;ctx.beginPath();ctx.arc(0,0,R,0,TAU);ctx.stroke();
 ctx.lineWidth=0.6;ctx.beginPath();ctx.arc(0,0,R-4,0,TAU);ctx.stroke();
 for(const [name,r] of Object.entries(RINGS)){
  const th=theta(name,now),rin=R*r.lo,rout=R*r.hi;
  ctx.fillStyle=PALETTE.brassDark;ctx.beginPath();ctx.arc(0,0,rout,0,TAU);ctx.arc(0,0,rin,0,TAU,true);ctx.fill();
  ctx.strokeStyle=PALETTE.ink;ctx.globalAlpha=0.07;ctx.lineWidth=0.8;
  for(let rr=rin+5;rr<rout-3;rr+=5){ctx.beginPath();ctx.arc(0,0,rr,0,TAU);ctx.stroke();}
  ctx.globalAlpha=0.5;ctx.lineWidth=0.8;ctx.beginPath();ctx.arc(0,0,rin,0,TAU);ctx.stroke();ctx.beginPath();ctx.arc(0,0,rout,0,TAU);ctx.stroke();
  // engraved marks that turn with the ring, so its motion is seen even when it is empty
  ctx.globalAlpha=0.55;ctx.lineWidth=1;
  const n=name==='outer'?24:12;
  for(let i=0;i<n;i++){const a=th+i*TAU/n,long=i%(n/4)===0;ctx.beginPath();ctx.moveTo(Math.cos(a)*(rout-2),Math.sin(a)*(rout-2));ctx.lineTo(Math.cos(a)*(rout-(long?12:6)),Math.sin(a)*(rout-(long?12:6)));ctx.stroke();}
  ctx.globalAlpha=1;
 }
 // the hub
 const hub=R*0.26;ctx.fillStyle=PALETTE.brass;ctx.beginPath();ctx.arc(0,0,hub,0,TAU);ctx.fill();
 ctx.strokeStyle=PALETTE.ink;ctx.lineWidth=1;ctx.beginPath();ctx.arc(0,0,hub,0,TAU);ctx.stroke();
 ctx.globalAlpha=0.35;for(let i=0;i<24;i++){const a=i*TAU/24;ctx.beginPath();ctx.moveTo(Math.cos(a)*hub*0.8,Math.sin(a)*hub*0.8);ctx.lineTo(Math.cos(a)*(hub-2),Math.sin(a)*(hub-2));ctx.stroke();}
 ctx.globalAlpha=1;ctx.beginPath();ctx.arc(0,0,3,0,TAU);ctx.fillStyle=PALETTE.ink;ctx.fill();
 // the combs: a reader line toward each player, teeth at the octaves
 for(const seat of ['A','B']){
  const c=COMB[seat],mine=seat===me.seat;ctx.strokeStyle=mine?PALETTE.ink:PALETTE.copper;ctx.globalAlpha=mine?0.9:0.6;ctx.lineWidth=mine?1.6:1.2;
  ctx.beginPath();ctx.moveTo(Math.cos(c)*hub,Math.sin(c)*hub);ctx.lineTo(Math.cos(c)*(R+8),Math.sin(c)*(R+8));ctx.stroke();
  for(const [name] of Object.entries(RINGS))for(let m=PITCH_LO;m<=PITCH_HI;m+=12){const r=pinRadius({ring:name,midi:m});const px=Math.cos(c)*r,py=Math.sin(c)*r,nx=-Math.sin(c)*5,ny=Math.cos(c)*5;ctx.beginPath();ctx.moveTo(px-nx,py-ny);ctx.lineTo(px+nx,py+ny);ctx.stroke();}
  ctx.globalAlpha=1;
 }
 // the pins
 for(const p of box.pins.values()){
  const life=pinLife(p,now);if(life<=0)continue;
  const th=theta(p.ring,now),r=pinRadius(p),a0=p.a+th,len=p.open?Math.max(0.02,theta(p.ring,now)-p._thetaAt):Math.max(p.len||0,0.02);
  const mine=p.who===me.seat;ctx.strokeStyle=ctx.fillStyle=mine?PALETTE.ink:PALETTE.copper;ctx.globalAlpha=0.25+0.75*life;
  ctx.lineWidth=5;ctx.lineCap='round';ctx.beginPath();ctx.arc(0,0,r,a0,a0+len);ctx.stroke();
  ctx.beginPath();ctx.arc(Math.cos(a0)*r,Math.sin(a0)*r,4.2,0,TAU);ctx.fill();
  ctx.globalAlpha=1;
 }
 // blooms where a pin met a comb
 fx.blooms=fx.blooms.filter(b=>pnow-b.t0<900);
 for(const b of fx.blooms){const u=(pnow-b.t0)/900;ctx.strokeStyle=b.color;ctx.globalAlpha=(1-u)*0.8;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(b.x,b.y,4+u*28,0,TAU);ctx.stroke();}
 ctx.globalAlpha=1;
 // ripples: a wave from a played key, crossing the seam into the other half
 fx.ripples=fx.ripples.filter(r=>now-r.t0<2600);
 for(const r of fx.ripples){const u=(now-r.t0)/2600;const rad=20+u*900;ctx.strokeStyle=r.seat===me.seat?PALETTE.ink:PALETTE.copper;ctx.globalAlpha=(1-u)*0.35;ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(r.x,r.y,rad,0,TAU);ctx.stroke();}
 ctx.globalAlpha=1;
 ctx.restore();
 // a drag in progress: the finger's hold on the ring, drawn on top
 if(drag&&drag.moved){ctx.strokeStyle=PALETTE.ink;ctx.globalAlpha=0.5;ctx.lineWidth=1;ctx.beginPath();ctx.arc(geo.W/2,-geo.gapHalf,drag.r,0,TAU);ctx.stroke();ctx.globalAlpha=1;}
}

// ---------- the network: a room on the relay, the other player's events, one clock
function send(msg){if(ws&&ws.readyState===1)ws.send(JSON.stringify(msg));}
function connect(){
 if(ws){try{ws.onclose=null;ws.close();}catch{}}
 setStatus('Connecting…');
 ws=new WebSocket(RELAY);
 ws.onopen=()=>{send({t:'join',room:me.room,id:clientId,name:me.name,inst:me.inst});ping();};
 ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch{return;}handle(m);};
 ws.onclose=()=>{if(joined){setStatus('Lost the connection, trying again…');setTimeout(connect,1500);}};
 ws.onerror=()=>{};
}
let pingTimer=null;
function ping(){clearTimeout(pingTimer);send({t:'ping',c:Date.now()});pingTimer=setTimeout(ping,4000);}
function applyState(s){
 box.pins.clear();for(const p of s.pins||[])addPin(p,false);
 box.spin=s.spin||{};box.holds=s.holds||{A:false,B:false};box.started=s.started??null;box.peers=s.peers||{};
}
function addPin(p,fromMe){
 if(!p||!RINGS[p.ring])return;
 p._thetaAt=p._thetaAt??(p.open?theta(p.ring,p.born||serverNow()):0);
 box.pins.set(p.id,p);
 if(!fromMe&&box.pins.size>900)box.pins.delete(box.pins.keys().next().value);
}
function handle(m){
 switch(m.t){
  case 'pong':{const now=Date.now(),rtt=now-m.c;if(now-bestAt>60000)bestRtt=Infinity;if(rtt<=bestRtt+15){bestRtt=Math.min(bestRtt,rtt);bestAt=now;const want=m.s-(m.c+rtt/2);clockOffset+=Math.abs(want-clockOffset)>400?want-clockOffset:(want-clockOffset)*0.25;}break;}
  case 'welcome':{me.seat=m.seat;me.room=m.room;joined=true;clockOffset=m.s-Date.now();applyState(m.state);store.set('room',me.room);document.body.dataset.seat=me.seat;layout();q('#join').hidden=true;refreshStatus();break;}
  case 'full':setStatus('That room already has two players. Try another code.');joined=false;break;
  case 'peers':box.peers=m.peers||{};refreshStatus();break;
  case 'pin':addPin(m.pin,false);break;
  case 'pinend':{const p=box.pins.get(m.id);if(p){p.len=m.len;p.open=false;}break;}
  case 'unpin':box.pins.delete(m.id);break;
  case 'renew':{const p=box.pins.get(m.id);if(p)p.born=m.born;break;}
  case 'spin':box.spin[m.ring]={theta0:m.theta0,omega:m.omega,t0:m.t0};break;
  case 'clear':box.pins.clear();break;
  case 'load':box.pins.clear();for(const p of m.pins||[])addPin(p,false);box.spin=m.spin||{};setStatus(m.name?`${m.name} is on the box`:'A movement was loaded');break;
  case 'hold':box.holds[m.seat]=m.on;refreshStatus();break;
  case 'start':box.started=m.s;for(const p of box.pins.values()){p._a=undefined;p._b=undefined;}refreshStatus();break;
  case 'rest':box.started=null;box.holds={A:false,B:false};stage?.engine.allOff();playing.clear();refreshStatus();break;
  case 'ripple':fx.ripples.push({x:m.x,y:m.y,t0:m.t0,seat:m.seat});break;
  case 'keep':saveMovement(m.movement,false);break;
  case 'tick':break;
 }
}

// ---------- the player's keyboard
const pointers=new Map(),heldPins=new Map(),typed=new Map();
let span=36;
function buildKeys(){
 const el=q('#keys');el.textContent='';span=innerWidth<700?24:36;
 const whites=[];for(let m=me.base;m<=me.base+span;m++)if(!LIVE.KEYS[m-21]?.black)whites.push(m);
 for(const m of whites){const d=document.createElement('div');d.className='k-w';d.dataset.midi=m;if(m%12===0){const s=document.createElement('span');s.textContent=LIVE.noteName(m);d.appendChild(s);}el.appendChild(d);}
 for(let m=me.base;m<=me.base+span;m++){if(!LIVE.KEYS[m-21]?.black)continue;const idx=whites.filter(w=>w<m).length;const d=document.createElement('div');d.className='k-b';d.dataset.midi=m;d.style.left=(idx/whites.length*100)+'%';el.appendChild(d);}
 q('#octave').textContent=`${LIVE.noteName(me.base)} – ${LIVE.noteName(me.base+span)}`;
}
function keyDown(midi,vel){
 if(heldPins.has(midi))keyUp(midi);
 piano.noteOn('k'+midi,midi,vel);stage?.engine.live.add(midi);
 q('#keys').querySelector(`[data-midi="${midi}"]`)?.classList.add('is-down');
 const now=serverNow();
 // a wave from the key toward the seam
 const el=q('#keys').querySelector(`[data-midi="${midi}"]`),rect=el?el.getBoundingClientRect():{left:geo.W/2,width:0};
 const w=toWorld(rect.left+rect.width/2,geo.keysTop);const ripple={x:w.x,y:w.y,t0:now,seat:me.seat};fx.ripples.push(ripple);send({t:'ripple',x:w.x,y:w.y,t0:now});
 if(box.started===null){if(heldCount()===1)send({t:'hold',on:true});box.holds[me.seat]=true;refreshStatus();return;}
 // a pin set into the ring where it passes my comb now
 const ring=me.ring,th=theta(ring,now);
 const pin={id:`${me.seat}${(++pinCounter).toString(36)}${Math.random().toString(36).slice(2,5)}`,ring,a:COMB[me.seat]-th,len:0,midi,vel,who:me.seat,born:now,open:true,_thetaAt:th,_a:1e-6,_b:1e-6};
 addPin(pin,true);heldPins.set(midi,pin);
 send({t:'pin',pin:{id:pin.id,ring,a:pin.a,len:0,midi,vel,born:now,open:true}});
}
function keyUp(midi){
 piano.noteOff('k'+midi);stage?.engine.live.delete(midi);
 q('#keys').querySelector(`[data-midi="${midi}"]`)?.classList.remove('is-down');
 const pin=heldPins.get(midi);
 if(pin){heldPins.delete(midi);pin.len=Math.max(0.02,Math.abs(theta(pin.ring,serverNow())-pin._thetaAt));pin.open=false;send({t:'pinend',id:pin.id,len:pin.len});}
 if(box.started===null&&heldCount()===0){send({t:'hold',on:false});box.holds[me.seat]=false;refreshStatus();}
}
function heldCount(){return pointers.size+typed.size;}
function screenDown(e,el){const m=+el.dataset.midi;if(pointers.get(e.pointerId)===m)return;const sliding=pointers.has(e.pointerId);screenUp(e);pointers.set(e.pointerId,m);keyDown(m,sliding?0.6:0.72);}
function screenUp(e){const m=pointers.get(e.pointerId);if(m===undefined)return;pointers.delete(e.pointerId);keyUp(m);}
function keyUnder(e){const el=document.elementFromPoint(e.clientX,e.clientY);return el&&el.closest?el.closest('#keys [data-midi]'):null;}
const keysEl=q('#keys');
keysEl.addEventListener('pointerdown',e=>{const el=e.target.closest('[data-midi]');if(!el)return;e.preventDefault();piano.init();try{keysEl.setPointerCapture(e.pointerId);}catch{}screenDown(e,el);});
keysEl.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;const el=keyUnder(e);if(el&&+el.dataset.midi!==pointers.get(e.pointerId))screenDown(e,el);});
for(const ev of ['pointerup','pointercancel'])document.addEventListener(ev,screenUp);
const KEYMAP={KeyA:0,KeyW:1,KeyS:2,KeyE:3,KeyD:4,KeyF:5,KeyT:6,KeyG:7,KeyY:8,KeyH:9,KeyU:10,KeyJ:11,KeyK:12,KeyO:13,KeyL:14,KeyP:15,Semicolon:16,Quote:17};
document.addEventListener('keydown',e=>{if(e.repeat||!joined||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(e.code==='KeyZ')return shiftOctave(-12);if(e.code==='KeyX')return shiftOctave(12);if(!(e.code in KEYMAP))return;e.preventDefault();piano.init();const m=me.base+KEYMAP[e.code];typed.set(e.code,m);keyDown(m,0.72);});
document.addEventListener('keyup',e=>{const m=typed.get(e.code);if(m===undefined)return;typed.delete(e.code);keyUp(m);});
function shiftOctave(d){me.base=Math.max(PITCH_LO,Math.min(PITCH_HI-span,me.base+d));store.set('octave',me.base);buildKeys();}
q('#oct-down').addEventListener('click',()=>shiftOctave(-12));
q('#oct-up').addEventListener('click',()=>shiftOctave(12));

// ---------- a hand on the ring: push it round, or tap a pin to take it off
let drag=null;
const ringEl=q('#ring-space');
function ringPoint(e){const sx=e.clientX-geo.W/2,sy=e.clientY+geo.gapHalf;return {ang:Math.atan2(sy,sx),r:Math.hypot(sx,sy)};}
ringEl.addEventListener('pointerdown',e=>{if(!joined)return;e.preventDefault();piano.init();try{ringEl.setPointerCapture(e.pointerId);}catch{}const p=ringPoint(e);drag={id:e.pointerId,ang:p.ang,r:p.r,t:performance.now(),delta:0,moved:false,samples:[[performance.now(),0]],x:e.clientX,y:e.clientY};});
ringEl.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const p=ringPoint(e);let d=p.ang-drag.ang;d=wrap(d);drag.delta+=d;drag.ang=p.ang;if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>8)drag.moved=true;const now=performance.now();drag.samples.push([now,drag.delta]);while(drag.samples.length>2&&now-drag.samples[0][0]>120)drag.samples.shift();});
function ringUp(e){
 if(!drag||drag.id!==e.pointerId)return;const d=drag;drag=null;
 const now=serverNow();
 if(!d.moved&&performance.now()-d.t<350){ // a tap: a pin under the finger comes off
  const w=toWorld(e.clientX,e.clientY);let best=null;
  for(const p of box.pins.values()){const th=theta(p.ring,now),r=pinRadius(p),len=Math.max(p.len||0,0.02);const ang=Math.atan2(w.y,w.x),rr=Math.hypot(w.x,w.y);if(Math.abs(rr-r)>12)continue;const rel=wrap(ang-(p.a+th));const on=rel>=-0.06&&rel<=len+0.06;if(on){const dist=Math.abs(rr-r);if(!best||dist<best.dist)best={p,dist};}}
  if(best){box.pins.delete(best.p.id);send({t:'unpin',id:best.p.id});}
  return;
 }
 if(!d.moved)return;
 const ring=d.r<geo.R*0.63?'inner':'outer';
 const s=d.samples,[t0,a0]=s[0],[t1,a1]=s[s.length-1],vel=t1>t0?(a1-a0)/((t1-t0)/1000):0;
 const base=TAU/RINGS[ring].period;
 const omega=Math.max(-2.5*base,Math.min(5*base,base+vel*0.7));
 const spin={theta0:theta(ring,now)+d.delta,omega,t0:now};
 box.spin[ring]=spin;send({t:'spin',ring,...spin});
}
ringEl.addEventListener('pointerup',ringUp);ringEl.addEventListener('pointercancel',ringUp);

// ---------- the iPad: no double-tap or pinch zoom anywhere on the page, and a full-screen button
let lastTap=0;
document.addEventListener('touchend',e=>{const now=Date.now();if(now-lastTap<320&&!e.target.closest('input,select,textarea'))e.preventDefault();lastTap=now;},{passive:false});
document.addEventListener('touchmove',e=>{if(e.touches.length>1||(e.scale!==undefined&&e.scale!==1))e.preventDefault();},{passive:false});
for(const ev of ['gesturestart','gesturechange','gestureend'])document.addEventListener(ev,e=>e.preventDefault(),{passive:false});
document.addEventListener('dblclick',e=>{if(!e.target.closest('input,select,textarea'))e.preventDefault();},{passive:false});
const fsEl=document.documentElement;
const inFull=()=>!!(document.fullscreenElement||document.webkitFullscreenElement);
function toggleFull(){
 if(inFull()){(document.exitFullscreen||document.webkitExitFullscreen)?.call(document);return;}
 const req=fsEl.requestFullscreen||fsEl.webkitRequestFullscreen;
 if(req)Promise.resolve(req.call(fsEl)).catch(()=>setStatus('Full screen is not available here. Add the page to the Home Screen instead.'));
 else setStatus('Full screen is not available here. Add the page to the Home Screen instead.');
}
q('#full').addEventListener('click',toggleFull);
for(const ev of ['fullscreenchange','webkitfullscreenchange'])document.addEventListener(ev,()=>{q('#full').textContent=inFull()?'Exit full screen':'Full screen';setTimeout(()=>{layout();buildKeys();},150);});
if(matchMedia('(display-mode: standalone)').matches||navigator.standalone)q('#full').hidden=true;

// ---------- the bar
function setStatus(s){q('#status').textContent=s;}
function refreshStatus(){
 if(!joined)return;
 const other=me.seat==='A'?'B':'A',peer=box.peers[other];
 const name=peer?.present?(peer.name||'The other player'):null;
 if(box.started!==null)setStatus(`${me.room} · ${name?name+' is here':'playing alone'}`);
 else if(!name)setStatus(`${me.room} · waiting for the other player (they type this code)`);
 else setStatus(`${me.room} · ${name} is here · both hold a key to begin${box.holds[other]?' · '+name+' is holding':''}`);
 q('#alone').hidden=box.started!==null||!!name;
 q('#rest').hidden=box.started===null;
}
q('#alone').addEventListener('click',()=>send({t:'start'}));
q('#rest').addEventListener('click',()=>{send({t:'rest'});handle({t:'rest'});});
q('#clear').addEventListener('click',()=>{if(!box.pins.size||confirm('Take every pin off the box?')){box.pins.clear();send({t:'clear'});}});
q('#inst').value=me.inst;q('#inst').addEventListener('change',e=>{me.inst=e.target.value;store.set('inst',me.inst);send({t:'inst',inst:me.inst});});
q('#ring-pick').addEventListener('click',()=>{me.ring=me.ring==='outer'?'inner':'outer';q('#ring-pick').textContent=me.ring==='outer'?'Outer ring':'Inner ring';});
q('#gap').value=me.gapMm;q('#gap-val').textContent=me.gapMm+' mm';
q('#gap').addEventListener('input',e=>{me.gapMm=+e.target.value;store.set('gap',me.gapMm);q('#gap-val').textContent=me.gapMm+' mm';layout();});
q('#seam').addEventListener('click',()=>{const r=q('#seam-row');r.hidden=!r.hidden;});

// movements: the box as it stands, kept under the name of a park, to be put back on the box later
function movements(){return store.get('movements',[]);}
function saveMovement(mv,announce=true){const list=movements().filter(m=>m.id!==mv.id);list.unshift(mv);store.set('movements',list.slice(0,40));fillMovements();if(announce)setStatus(`Kept as "${mv.name}"`);}
function fillMovements(){const sel=q('#movements');sel.textContent='';const o=document.createElement('option');o.value='';o.textContent='Movements…';sel.appendChild(o);for(const m of movements()){const op=document.createElement('option');op.value=m.id;op.textContent=`${m.name} · ${new Date(m.when).toLocaleDateString('en-AU',{day:'numeric',month:'short'})} ${new Date(m.when).toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'})}`;sel.appendChild(op);}}
q('#keep').addEventListener('click',()=>{
 const name=prompt('Which park is this?',store.get('lastPark','')||'');if(name===null)return;store.set('lastPark',name);
 const now=serverNow();
 const pins=[...box.pins.values()].filter(p=>pinLife(p,now)>0).map(p=>({id:p.id,ring:p.ring,a:p.a,len:p.len||0.02,midi:p.midi,vel:p.vel,who:p.who}));
 const mv={id:now.toString(36),name:name||'Untitled',when:now,pins,spin:box.spin,room:me.room};
 saveMovement(mv);send({t:'keep',movement:mv});
});
q('#movements').addEventListener('change',e=>{
 const mv=movements().find(m=>m.id===e.target.value);e.target.value='';if(!mv)return;
 if(box.pins.size&&!confirm(`Put "${mv.name}" on the box in place of what is there?`))return;
 const now=serverNow();box.pins.clear();for(const p of mv.pins)addPin({...p,born:now,open:false},false);
 send({t:'load',pins:mv.pins.map(p=>({...p,born:now,open:false})),spin:box.spin,name:mv.name});setStatus(`${mv.name} is on the box`);
});
fillMovements();

// ---------- joining
const params=new URLSearchParams(location.search);
q('#name').value=me.name;
q('#room').value=(params.get('room')||store.get('room','')||newCode()).toLowerCase();
q('#new-code').addEventListener('click',()=>{q('#room').value=newCode();});
q('#join-form').addEventListener('submit',async e=>{
 e.preventDefault();
 me.name=q('#name').value.trim().slice(0,24);store.set('name',me.name);
 me.room=q('#room').value.trim().toLowerCase().replace(/[^a-z0-9-]+/g,'-').slice(0,40)||newCode();
 history.replaceState(null,'',`?room=${encodeURIComponent(me.room)}`);
 piano.init();
 q('#join-btn').disabled=true;q('#join-btn').textContent='Opening…';
 try{
  if(!stage){stage=await createStage(q('#stage'),{lo:PITCH_LO,hi:PITCH_HI,palette:PALETTE,onNoteOn:(midi,vel)=>piano.noteOn('p'+midi,midi,vel),onNoteOff:midi=>piano.noteOff('p'+midi)});}
 }catch(err){q('#join-btn').disabled=false;q('#join-btn').textContent='Join';q('#join-error').textContent='The hands could not load: '+err.message;return;}
 joined=true;connect();
});

// ---------- the frame
function loop(){
 if(joined){const now=serverNow();for(const [id,p] of box.pins)if(pinLife(p,now)<=0)box.pins.delete(id);passComb(now);stage?.draw();drawRing();}
 requestAnimationFrame(loop);
}
window.addEventListener('resize',()=>{layout();if((innerWidth<700?24:36)!==span)buildKeys();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&joined&&ws?.readyState!==1)connect();});
buildKeys();layout();requestAnimationFrame(loop);
window.MB={box,me,theta,serverNow,fx,get stage(){return stage;}};
