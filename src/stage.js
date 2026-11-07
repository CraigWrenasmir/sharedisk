// The stage: an old piano keyboard with two wooden hands, drawn as an engraved
// plate. The hands are the Mechanical Pianist's model and measurements (from
// The Listening Field: Hands); they play whatever notes Sharedisk hands
// them, choosing fingers note by note. The player's own keys dip without hands.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import * as LIVE from './live.js';

const WHITE_PITCH=0.0235,WHITE_GAP=0.0011,WHITE_LENGTH=0.15,WHITE_FRONT_HEIGHT=0.0215,BLACK_WIDTH=0.0128,BLACK_LENGTH=0.095,BLACK_HEIGHT=0.0122,KEY_DIP=0.010,PIVOT_Z=-0.255;
const KEY_BY_MIDI=new Map(LIVE.KEYS.map(k=>[k.midi,k]));

function rng(seed){let a=seed*2654435761>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let x=a;x=Math.imul(x^(x>>>15),x|1);x^=x+Math.imul(x^(x>>>7),x|61);return((x^(x>>>14))>>>0)/4294967296;};}
function oldKey(k){
 const r=rng(k.midi+1),black=k.black;
 const w=black?BLACK_WIDTH:WHITE_PITCH-WHITE_GAP,h=black?BLACK_HEIGHT+0.004:WHITE_FRONT_HEIGHT,L=black?BLACK_LENGTH:WHITE_LENGTH;
 const g=new THREE.BoxGeometry(w,h,L,4,2,black?10:16);
 const top=black?h-0.002:0,zFront=black?-WHITE_LENGTH+BLACK_LENGTH:0;
 g.translate(0,black?BLACK_HEIGHT/2-0.002:-h/2,(black?-WHITE_LENGTH+BLACK_LENGTH/2:-L/2)-PIVOT_Z);
 const pos=g.attributes.position,v=new THREE.Vector3();
 const chips=[];
 const nFront=black?(r()<0.55?1:0)+(r()<0.3?1:0):(r()<0.38?1:0)+(r()<0.12?1:0);
 for(let i=0;i<nFront;i++)chips.push({x:(i===0?(r()<0.5?-1:1):(chips[0].x>0?-1:1))*w/2,z:zFront-PIVOT_Z,rad:(black?0.004:0.005)+r()*0.008,depth:0.003+r()*0.006});
 if(r()<(black?0.35:0.15))chips.push({x:(r()<0.5?-1:1)*w/2,z:zFront-PIVOT_Z-(0.02+r()*(black?0.06:0.09)),rad:0.003+r()*0.006,depth:0.002+r()*0.004});
 if(black&&r()<0.25)chips.push({x:0,z:zFront-PIVOT_Z,rad:0.006+r()*0.006,depth:0.004+r()*0.005});
 const capLoss=black?r()*0.0035:0,lean=black?(r()-0.5)*0.08:(r()-0.5)*0.02;
 const hollow=black?0.0008+r()*0.0012:0.0012+r()*0.0014,n1=r()*100,n2=r()*100,grainAmp=black?0.00035:0.0005;
 for(let i=0;i<pos.count;i++){
  v.fromBufferAttribute(pos,i);
  const onTop=Math.abs(v.y-top)<1e-4;
  if(onTop){
   const zz=v.z+PIVOT_Z,u=Math.max(0,Math.min(1,(zz-(zFront-0.06))/0.06));
   v.y-=hollow*u*(1-Math.pow(Math.abs(v.x)/(w/2),2));
   v.y+=grainAmp*Math.sin(v.x*900+n1)*Math.cos(zz*350+n2)+grainAmp*0.6*Math.sin(zz*1300+n2*3);
   if(black){v.y-=capLoss;const front=Math.max(0,1-(zFront-zz)/0.02);v.y-=0.0025*front*front;}
  }
  if(black&&!onTop&&v.y>top-0.012)v.y-=capLoss;
  for(const c of chips){const dz=Math.hypot(v.x-c.x,v.z-c.z);if(dz<c.rad&&v.y>top-0.012){const tt=1-dz/c.rad;v.y-=c.depth*tt;v.x-=Math.sign(c.x||1)*c.rad*0.35*tt;}}
  pos.setXYZ(i,v.x,v.y,v.z);
 }
 pos.needsUpdate=true;g.computeVertexNormals();
 g.rotateY((r()-0.5)*(black?0.03:0.012));g.rotateZ(lean);
 g.userData.restDip=r()<(black?0.45:0.35)?r()*(black?0.3:0.22):0;
 g.userData.black=black;
 return g;
}

const setRot=(o,m,m4)=>{m4.set(m[0],m[1],m[2],0,m[3],m[4],m[5],0,m[6],m[7],m[8],0,0,0,0,1);o.quaternion.setFromRotationMatrix(m4);};
const mul=(a,b)=>{const o=new Array(9);for(let r=0;r<3;r++)for(let c=0;c<3;c++)o[r*3+c]=a[r*3]*b[c]+a[r*3+1]*b[3+c]+a[r*3+2]*b[6+c];return o;};
const rotX=a=>{const c=Math.cos(a),s=Math.sin(a);return[1,0,0,0,c,-s,0,s,c];};
const rotY=a=>{const c=Math.cos(a),s=Math.sin(a);return[c,0,s,0,1,0,-s,0,c];};
const rotZ=a=>{const c=Math.cos(a),s=Math.sin(a);return[c,-s,0,s,c,0,0,0,1];};
const flex=a=>rotX(-a);

class Rig{
 constructor(template,hand,spec,scene){
  this.spec=spec;this.m4=new THREE.Matrix4();
  this.root=template.clone(true);this.root.name=hand;this.node={};
  this.root.traverse(o=>{if(o.name)this.node[o.name]=o;});
  const h=this.node.Hand;if(h&&h!==this.root){h.position.set(0,0,0);h.quaternion.identity();}
  this.root.scale.set(hand==='R'?1:-1,1,1);
  this.qa=new THREE.Quaternion();this.qb=new THREE.Quaternion();
  scene.add(this.root);
 }
 apply(h){
  const p=h.pose,m4=this.m4,spec=this.spec;this.root.position.set(h.wrist[0],h.wrist[1],h.wrist[2]);
  setRot(this.node.Palm,p.rot,m4);setRot(this.node.Forearm,p.fa,m4);
  this.qa.copy(this.node.Forearm.quaternion);this.qb.copy(this.node.Palm.quaternion);
  this.node.WristRing2.quaternion.slerpQuaternions(this.qa,this.qb,0.33);
  this.node.WristRing1.quaternion.slerpQuaternions(this.qa,this.qb,0.66);
  this.node.WristCore.quaternion.slerpQuaternions(this.qa,this.qb,0.82);
  spec.fingers.forEach((f,i)=>{const s=p.f[i];setRot(this.node[`F${f.id}_0`],mul(rotY(f.baseYaw+s[0]),flex(s[1])),m4);setRot(this.node[`F${f.id}_1`],flex(s[2]),m4);setRot(this.node[`F${f.id}_2`],flex(s[3]),m4);});
  const tb=mul(mul(rotY(spec.thumb.baseYaw),rotX(spec.thumb.basePitch)),rotZ(spec.thumb.opposition));
  setRot(this.node.T_0,mul(mul(mul(rotY(p.t[0]),tb),rotZ(p.t[1])),flex(p.t[2])),m4);setRot(this.node.T_1,flex(p.t[3]),m4);setRot(this.node.T_2,flex(p.t[4]),m4);
 }
}

// ---------- the hands that play the box: fingering chosen note by note, the hands moving as little as they can
function newHand(h){return {h,sx:h==='R'?1:-1,x:h==='R'?0.16:-0.22,y:0.064,z:0.10,tx:h==='R'?0.16:-0.22,tz:0.10,fingers:[null,null,null,null,null,null],since:[0,0,0,0,0,0]};}
function makeEngine(onOn,onOff){
 const eng={
  hands:{L:newHand('L'),R:newHand('R')},
  dips:new Map(),held:new Map(),sounding:new Map(),live:new Set(),last:0,counter:0,
  contact(midi){const k=KEY_BY_MIDI.get(midi);const z=k.playZ;return {k,x:LIVE.contactX(k,z),z};},
  best(hand,midi){
   const {x:kx}=this.contact(midi);let best=null;
   for(let f=1;f<=5;f++){
    const tip=LIVE.REST_TIPS[f];const wx=kx-hand.sx*tip[0];
    let cost=Math.abs(wx-hand.x)+(hand.fingers[f]?0.08:0);
    for(let g=1;g<=5;g++){const m=hand.fingers[g];if(!m||g===f)continue;const gx=this.contact(m).x;
     const stretch=Math.abs((gx-wx)*hand.sx-LIVE.REST_TIPS[g][0]);if(stretch>0.02)cost+=(stretch-0.02)*3;
     if(((gx-kx)*hand.sx>0)!==(g>f))cost+=0.06;
    }
    if(!best||cost<best.cost)best={f,wx,cost};
   }
   return best;
  },
  noteOn(midi,vel=0.7,tag='mine'){
   if(!KEY_BY_MIDI.has(midi))return;
   if(this.held.has(midi))this.noteOff(midi);
   const L=this.hands.L,R=this.hands.R,{x:kx}=this.contact(midi);
   const bl=this.best(L,midi),br=this.best(R,midi);
   let cl=bl.cost+(midi>=60?0.03:0)+(kx>R.x+0.02?0.25:0),cr=br.cost+(midi<60?0.03:0)+(kx<L.x-0.02?0.25:0);
   const hand=cl<=cr?L:R,b=cl<=cr?bl:br;
   if(hand.fingers[b.f])this.noteOff(hand.fingers[b.f]);
   hand.fingers[b.f]=midi;hand.since[b.f]=++this.counter;this.held.set(midi,{hand,f:b.f});
   this.sounding.set(midi,tag);this.retarget(hand);
   onOn(midi,vel,tag);
  },
  noteOff(midi){
   const h=this.held.get(midi);if(!h)return;
   h.hand.fingers[h.f]=null;this.held.delete(midi);this.sounding.delete(midi);this.retarget(h.hand);
   onOff(midi);
  },
  allOff(){for(const midi of [...this.held.keys()])this.noteOff(midi);},
  retarget(hand){
   let n=0,sx=0,sz=0;
   for(let f=1;f<=5;f++){const m=hand.fingers[f];if(!m)continue;const c=this.contact(m);n++;sx+=c.x-hand.sx*LIVE.REST_TIPS[f][0];sz+=c.z-LIVE.REST_TIPS[f][2];}
   if(n){hand.tx=sx/n;hand.tz=Math.max(0.07,Math.min(0.125,sz/n));}
  },
  pose(hand,dt){
   const k=1-Math.exp(-dt/0.045);hand.x+=(hand.tx-hand.x)*k;hand.z+=(hand.tz-hand.z)*k;
   const fingers=[],out=[0,0,0];
   const target=(f)=>{const m=hand.fingers[f];const {k:key,x,z}=this.contact(m);const d=this.dips.get(m)?.v||0;LIVE.keySurfacePoint(key,z,d,out,x);return [(out[0]-hand.x)*hand.sx,out[1]+LIVE.TIP_RADIUS[f]-hand.y,out[2]-hand.z];};
   for(let f=2;f<=5;f++){
    if(hand.fingers[f]){const sol=LIVE.solveFinger(f-2,target(f));fingers.push([sol.abduction,sol.angles[0],sol.angles[1],sol.angles[2]]);}
    else{const r=LIVE.REST_FINGER_POSES[f-2];fingers.push([r.abduction,r.angles[0]*0.8,r.angles[1]*0.8,r.angles[2]*0.8]);}
   }
   let th;
   if(hand.fingers[1]){const sol=LIVE.solveThumb(target(1));th=[sol.swing,sol.twist,sol.angles[0],sol.angles[1],sol.angles[2]];}
   else{const r=LIVE.REST_THUMB_POSE;th=[r.swing,r.twist,r.angles[0],r.angles[1],r.angles[2]];}
   const ex=hand.sx*0.19+0.5*(hand.x-hand.sx*0.19),dx=hand.sx*(ex-hand.x),dy=0.02,dz=0.36-hand.z,l=Math.hypot(dx,dy,dz);
   const fa=mul(rotY(Math.atan2(dx/l,dz/l)),rotX(-Math.asin(dy/l)));
   return {wrist:[hand.x,hand.y,hand.z],pose:{rot:rotX(-0.06),fa,f:fingers,t:th}};
  },
  frame(){
   const now=performance.now()/1000,dt=Math.min(0.05,now-(this.last||now));this.last=now;
   for(const midi of this.held.keys())if(!this.dips.has(midi))this.dips.set(midi,{v:0});
   for(const midi of this.live)if(!this.dips.has(midi))this.dips.set(midi,{v:0});
   const dips=[];
   for(const [midi,d] of this.dips){const want=this.held.has(midi)||this.live.has(midi)?1:0;const rate=want?dt/0.025:dt/0.085;d.v+=Math.max(-rate,Math.min(rate,want-d.v));if(d.v<=0.001&&!want){this.dips.delete(midi);continue;}dips.push(midi,d.v);}
   return {dips,L:this.pose(this.hands.L,dt),R:this.pose(this.hands.R,dt)};
  },
 };
 return eng;
}

export async function createStage(cv,{lo=36,hi=96,palette,onNoteOn,onNoteOff}){
 THREE.ColorManagement.enabled=false;
 const renderer=new THREE.WebGLRenderer({canvas:cv,antialias:false,alpha:false});
 renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
 const scene=new THREE.Scene();
 const camera=new THREE.PerspectiveCamera(19,3,0.05,5);
 scene.add(new THREE.HemisphereLight(0xffffff,0x777766,1.2));
 const keyLight=new THREE.DirectionalLight(0xffffff,2.2);keyLight.position.set(-0.6,1.0,0.5);scene.add(keyLight);
 const fillLight=new THREE.DirectionalLight(0xffffff,0.5);fillLight.position.set(0.5,0.4,-0.3);scene.add(fillLight);
 const KEY_WHITE=new THREE.MeshStandardMaterial({color:0xe4ddc8,roughness:0.75});
 const KEY_BLACK=new THREE.MeshStandardMaterial({color:0x2a2a2e,roughness:0.5});
 const KEY_MINE=new THREE.MeshStandardMaterial({color:0x0000ff,roughness:0.6});   // ink
 const KEY_THEIRS=new THREE.MeshStandardMaterial({color:0xff0000,roughness:0.6}); // copper
 const KEY_LIVE=new THREE.MeshStandardMaterial({color:0x00ff00,roughness:0.6});   // the lower grey-green
 const keyGroup=new THREE.Group(),keyMeshes=new Map();
 for(const k of LIVE.KEYS){if(k.midi<lo||k.midi>hi)continue;const m=new THREE.Mesh(oldKey(k),k.black?KEY_BLACK:KEY_WHITE);m.position.set(k.x,0,PIVOT_Z);keyGroup.add(m);keyMeshes.set(k.midi,m);}
 const CASE=new THREE.MeshStandardMaterial({color:0xd8d2c4,roughness:0.7});
 const x0=KEY_BY_MIDI.get(lo).x-0.03,x1=KEY_BY_MIDI.get(hi).x+0.03,cw=x1-x0,cx0=(x0+x1)/2;
 const fb=new THREE.Mesh(new THREE.BoxGeometry(cw,0.05,0.03),CASE);fb.position.set(cx0,0.012,-WHITE_LENGTH-0.015);keyGroup.add(fb);
 const slip=new THREE.Mesh(new THREE.BoxGeometry(cw,0.012,0.012),CASE);slip.position.set(cx0,-WHITE_FRONT_HEIGHT-0.006,0);keyGroup.add(slip);
 const bed=new THREE.Mesh(new THREE.BoxGeometry(cw,0.01,0.5),CASE);bed.position.set(cx0,-WHITE_FRONT_HEIGHT-0.012,0.1);keyGroup.add(bed);
 for(const s of [-1,1]){const cheek=new THREE.Mesh(new THREE.BoxGeometry(0.03,0.06,0.2),CASE);cheek.position.set(s>0?x1+0.015:x0-0.015,0.0,-0.07);keyGroup.add(cheek);}
 scene.add(keyGroup);

 const [spec,gltf]=await Promise.all([
  fetch('src/hand_spec.json').then(r=>r.json()),
  (()=>{const loader=new GLTFLoader();const draco=new DRACOLoader();draco.setDecoderPath('https://unpkg.com/three@0.186.1/examples/jsm/libs/draco/');loader.setDRACOLoader(draco);return loader.loadAsync('src/wooden_hand.glb');})(),
 ]);
 gltf.scene.traverse(o=>{if(o.isMesh)o.material.side=THREE.FrontSide;});
 const rigs={R:new Rig(gltf.scene,'R',spec,scene),L:new Rig(gltf.scene,'L',spec,scene)};
 const engine=makeEngine(onNoteOn,onNoteOff);

 // the plate: edges from depth and normals, hatching from light
 const normalMat=new THREE.MeshNormalMaterial();
 let W=2,H=2,colorRT=null,normalRT=null;
 function resize(){
  const dpr=Math.min(2,window.devicePixelRatio||1);
  const w=Math.max(2,Math.round(cv.clientWidth*dpr)),h=Math.max(2,Math.round(cv.clientHeight*dpr));
  if(w===W&&h===H&&colorRT)return;W=w;H=h;
  renderer.setSize(W,H,false);
  colorRT?.dispose();normalRT?.dispose();
  colorRT=new THREE.WebGLRenderTarget(W,H,{depthTexture:new THREE.DepthTexture(W,H,THREE.UnsignedIntType)});
  normalRT=new THREE.WebGLRenderTarget(W,H);
 }
 const quadScene=new THREE.Scene(),quadCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
 const plateMat=new THREE.ShaderMaterial({
  uniforms:{tColor:{value:null},tNormal:{value:null},tDepth:{value:null},res:{value:new THREE.Vector2()},paper:{value:new THREE.Color(palette.paper)},ink:{value:new THREE.Color(palette.ink)},copper:{value:new THREE.Color(palette.copper)},lower:{value:new THREE.Color(palette.lower)},near:{value:0.05},far:{value:5}},
  vertexShader:`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader:`
   precision highp float;
   varying vec2 vUv;
   uniform sampler2D tColor, tNormal, tDepth; uniform vec2 res; uniform vec3 paper, ink, copper, lower; uniform float near, far;
   float lin(float z){ float zn = 2.0 * z - 1.0; return 2.0 * near * far / (far + near - zn * (far - near)); }
   float depthAt(vec2 uv){ return lin(texture2D(tDepth, uv).x); }
   float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
   void main(){
    vec2 px = 1.0 / res;
    vec4 col = texture2D(tColor, vUv);
    vec3 n = texture2D(tNormal, vUv).xyz * 2.0 - 1.0;
    float d = depthAt(vUv);
    float de = 0.0, ne = 0.0;
    for (int i = 0; i < 4; i++) {
     vec2 o = (i == 0) ? vec2(px.x, 0.0) : (i == 1) ? vec2(-px.x, 0.0) : (i == 2) ? vec2(0.0, px.y) : vec2(0.0, -px.y);
     float dd = depthAt(vUv + o);
     de += clamp(abs(dd - d) / max(d * 0.012, 0.002), 0.0, 1.0);
     vec3 nn = texture2D(tNormal, vUv + o).xyz * 2.0 - 1.0;
     ne += 1.0 - dot(n, nn);
    }
    float edge = clamp(de * 0.9 + ne * 1.4, 0.0, 1.0);
    bool background = d > far * 0.9;
    if (background) edge = 0.0;
    float L = lum(col.rgb);
    vec2 sp = gl_FragCoord.xy;
    float h1 = step(0.55, fract((sp.x + sp.y) / 7.0));
    float h2 = step(0.55, fract((sp.x - sp.y) / 7.0));
    float h3 = step(0.6, fract((sp.x * 0.5 + sp.y) / 9.0));
    float hatch = 0.0;
    if (L < 0.62) hatch = max(hatch, 1.0 - h1);
    if (L < 0.40) hatch = max(hatch, 1.0 - h2);
    if (L < 0.22) hatch = max(hatch, 1.0 - h3);
    if (background) hatch = 0.0;
    bool mine = col.b > 0.6 && col.r < 0.25 && col.g < 0.25;
    bool theirs = col.r > 0.6 && col.g < 0.25 && col.b < 0.25;
    bool live = col.g > 0.6 && col.r < 0.25 && col.b < 0.25;
    vec3 tint = theirs ? copper : live ? lower : ink;
    vec3 c = paper;
    c = mix(c, tint, hatch * 0.8 * (theirs ? 1.0 : 0.85));
    c = mix(c, tint, edge);
    if (mine || theirs || live) c = mix(c, tint, 0.35 + 0.35 * hatch);
    gl_FragColor = vec4(c, 1.0);
   }`,
 });
 quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),plateMat));

 const camTarget=new THREE.Vector3(0,0,0.01),camPos=new THREE.Vector3(0,0.46,0.40);
 const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
 function draw(){
  resize();
  const f=engine.frame();
  rigs.R.apply(f.R);rigs.L.apply(f.L);
  const dip=new Map();for(let i=0;i<f.dips.length;i+=2)dip.set(f.dips[i],f.dips[i+1]);
  for(const [midi,m] of keyMeshes){const d=Math.max(dip.get(midi)||0,m.geometry.userData.restDip);m.rotation.x=-d*KEY_DIP/(-PIVOT_Z);const tag=engine.sounding.get(midi);m.material=tag==='theirs'?KEY_THEIRS:tag==='live'?KEY_LIVE:tag?KEY_MINE:engine.live.has(midi)?KEY_LIVE:(m.geometry.userData.black?KEY_BLACK:KEY_WHITE);}
  const cx=(f.L.wrist[0]+f.R.wrist[0])/2,spread=Math.abs(f.L.wrist[0]-f.R.wrist[0]);
  const aspect=W/H,wide=Math.max(0,2.8/aspect-1); // a shallower band sits the camera a little closer
  const want=new THREE.Vector3(cx,0.44+spread*0.3-wide*0.05,0.38+spread*0.25-wide*0.04),wantAt=new THREE.Vector3(cx,0.0,0.0);
  const ease=reducedMotion?1:0.03;camPos.lerp(want,ease);camTarget.lerp(wantAt,ease);
  camera.position.copy(camPos);camera.lookAt(camTarget);camera.aspect=aspect;camera.updateProjectionMatrix();
  scene.overrideMaterial=null;renderer.setRenderTarget(colorRT);renderer.setClearColor(0xffffff,1);renderer.render(scene,camera);
  scene.overrideMaterial=normalMat;renderer.setRenderTarget(normalRT);renderer.render(scene,camera);scene.overrideMaterial=null;
  const u=plateMat.uniforms;u.tColor.value=colorRT.texture;u.tNormal.value=normalRT.texture;u.tDepth.value=colorRT.depthTexture;u.res.value.set(W,H);
  renderer.setRenderTarget(null);renderer.render(quadScene,quadCam);
 }
 return {engine,draw,resize,keyX:midi=>{const k=KEY_BY_MIDI.get(midi);return k?(k.x-x0)/cw:0.5;}};
}
