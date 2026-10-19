// Physical contract is shared with the printable A4 landscape board, in millimetres.
export const BOARD = Object.freeze({width:297,height:210,qr:{x:20,y:18,size:42},answer:{x:26,y:88,width:245,height:96}});
export const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export const rectCorners=({x,y,width,height})=>[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}];
export function homography(from,to){
  if(from.length!==4||to.length!==4) throw new Error('Four corners required');
  const a=[];
  for(let i=0;i<4;i++){const {x,y}=from[i],u=to[i].x,v=to[i].y;a.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);}
  for(let c=0;c<8;c++){let p=c;for(let r=c+1;r<8;r++)if(Math.abs(a[r][c])>Math.abs(a[p][c]))p=r;
    if(Math.abs(a[p][c])<1e-9)throw new Error('Degenerate corners');[a[c],a[p]]=[a[p],a[c]];
    const d=a[c][c];for(let j=c;j<9;j++)a[c][j]/=d;
    for(let r=0;r<8;r++)if(r!==c){const f=a[r][c];for(let j=c;j<9;j++)a[r][j]-=f*a[c][j];}}
  return [...a.map(r=>r[8]),1];
}
export function project(h,p){const z=h[6]*p.x+h[7]*p.y+h[8];if(!Number.isFinite(z)||Math.abs(z)<1e-7)throw new Error('Invalid perspective');return {x:(h[0]*p.x+h[1]*p.y+h[2])/z,y:(h[3]*p.x+h[4]*p.y+h[5])/z};}
export function fromQR(corners){const q=BOARD.qr;return homography(rectCorners({x:q.x,y:q.y,width:q.size,height:q.size}),corners);}
export function answerCorners(corners){const h=fromQR(corners);return rectCorners(BOARD.answer).map(p=>project(h,p));}
export function checkGeometry(corners,width,height){
  if(corners?.length!==4||corners.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return {ok:false,reason:'QR geometry is unclear'};
  const edges=corners.map((p,i)=>distance(p,corners[(i+1)%4]));
  if(Math.min(...edges)<64)return {ok:false,reason:'Move closer: QR is too small'};
  if(Math.max(...edges)/Math.min(...edges)>1.8)return {ok:false,reason:'Face the board more directly'};
  try {const h=fromQR(corners);const region=rectCorners(BOARD.answer);const den=region.map(p=>h[6]*p.x+h[7]*p.y+1);
    if(Math.min(...den)*Math.max(...den)<=0)throw new Error('Horizon');
    const answer=region.map(p=>project(h,p));
    if(answer.some(p=>p.x<2||p.y<2||p.x>width-3||p.y>height-3))return {ok:false,reason:'Keep the whole answer area in view',answer};
    const cross=answer.map((p,i)=>{const b=answer[(i+1)%4],c=answer[(i+2)%4];return(b.x-p.x)*(c.y-b.y)-(b.y-p.y)*(c.x-b.x);});
    if(cross.some(x=>x<=0))throw new Error('Mirrored or folded region');
    if(Math.min(distance(answer[0],answer[3]),distance(answer[1],answer[2]))<110)return {ok:false,reason:'Move closer: answer is too small',answer};
    return {ok:true,h,answer,qrPixels:Math.min(...edges)};
  } catch{return {ok:false,reason:'Face the board more directly'};}
}
export function warpAnswer(image,h,outWidth=640){
  const r=BOARD.answer,outHeight=Math.round(outWidth*r.height/r.width),out=new Uint8ClampedArray(outWidth*outHeight*4);
  for(let y=0;y<outHeight;y++)for(let x=0;x<outWidth;x++){
    const p=project(h,{x:r.x+(x+.5)*r.width/outWidth,y:r.y+(y+.5)*r.height/outHeight});
    const sx=Math.floor(p.x),sy=Math.floor(p.y),fx=p.x-sx,fy=p.y-sy,o=(y*outWidth+x)*4;
    if(sx<0||sy<0||sx+1>=image.width||sy+1>=image.height){out.fill(255,o,o+4);continue;}
    for(let c=0;c<3;c++){const at=(xx,yy)=>image.data[(yy*image.width+xx)*4+c];out[o+c]=(1-fy)*((1-fx)*at(sx,sy)+fx*at(sx+1,sy))+fy*((1-fx)*at(sx,sy+1)+fx*at(sx+1,sy+1));}out[o+3]=255;
  }return {width:outWidth,height:outHeight,data:out};
}
// Conservative capture heuristics, not a reliable glare/occlusion detector.
export function assessQuality(image){
  if(!Number.isInteger(image?.width)||!Number.isInteger(image?.height)||image.width<8||image.height<8||image.data?.length!==image.width*image.height*4)return {ok:false,reason:'Invalid or tiny answer crop'};
  const w=image.width,h=image.height,g=new Float32Array(w*h),hist=new Uint32Array(256);let sum=0,dark=0,lap=0,n=0;
  for(let i=0;i<g.length;i++){const j=i*4;g[i]=.299*image.data[j]+.587*image.data[j+1]+.114*image.data[j+2];hist[Math.round(g[i])]++;sum+=g[i];if(g[i]<120)dark++;}
  const pct=p=>{let c=0;for(let i=0;i<256;i++){c+=hist[i];if(c>=g.length*p)return i;}return 255;};
  for(let y=1;y<h-1;y+=2)for(let x=1;x<w-1;x+=2){const i=y*w+x,v=4*g[i]-g[i-1]-g[i+1]-g[i-w]-g[i+w];lap+=v*v;n++;}
  const mean=sum/g.length,ink=dark/g.length,sharpness=lap/n,contrast=pct(.95)-pct(.01),stats={mean,ink,sharpness,contrast};
  if(mean<90)return {ok:false,reason:'More light needed',...stats};
  if(ink<.002)return {ok:false,reason:'No clear dark writing: check glare or write larger',...stats};
  if(ink>.40)return {ok:false,reason:'Answer area is obstructed or too dark',...stats};
  if(sharpness<24||contrast<45)return {ok:false,reason:'Hold steady: writing looks blurred or faint',...stats};
  return {ok:true,reason:'Ready',...stats};
}
export class StabilityGate{
  constructor(){this.reset();}
  reset(){
    this.last=null;this.since=0;this.history=[];this.strictSamples=0;
    this.info={reason:'reset',samples:0,elapsedMs:0,strictElapsedMs:0,sampleGapMs:null,maxCornerShiftPx:null,allowedCornerShiftPx:null,maxCornerRadiusPx:null,maxAnswerRadiusPx:null,allowedCornerRadiusPx:null,acceptedBy:null};
  }
  update(id,corners,time,answer){
    const valid=points=>Array.isArray(points)&&points.length===4&&points.every(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y));
    if(!Number.isFinite(time)||!valid(corners)){
      this.reset();this.info.reason=Number.isFinite(time)?'invalid-corners':'invalid-time';return false;
    }
    const size=distance(corners[0],corners[1]);
    if(!(size>0)){this.reset();this.info.reason='invalid-corners';return false;}
    const previous=this.last,gap=previous?time-previous.time:null;
    const continuity=Boolean(previous&&previous.id===id&&gap>0&&gap<700);
    const interrupted=previous?(previous.id!==id?'pupil-changed':gap<=0?'non-monotonic-time':gap>=700?'sample-gap':null):null;
    const maxShift=previous?Math.max(...corners.map((p,i)=>distance(p,previous.corners[i]))):null;
    const allowedShift=size*.065;
    // Preserve the original pairwise gate and its 240 ms / 700 ms / 6.5% limits.
    // Non-monotonic timestamps cannot provide evidence of elapsed steadiness.
    const pairStable=continuity&&maxShift<allowedShift;
    if(!pairStable)this.since=time;
    this.strictSamples=pairStable?Math.min(3,this.strictSamples+1):1;
    const strictElapsed=time-this.since,strict=pairStable&&strictElapsed>=240;
    const copy=points=>points.map(p=>({x:p.x,y:p.y}));
    this.last={id,corners:copy(corners),time};

    // Optional bounded-noise fallback: three contiguous observations must fit
    // a common per-corner centre, including the extrapolated answer region.
    // QR-only callers keep legacy behavior. Missing answer geometry breaks the
    // window. A small QR-corner error can otherwise move the far crop edge a lot.
    if(!continuity||!valid(answer))this.history=[];
    if(valid(answer)){
      const qrSide=Math.min(...corners.map((p,i)=>distance(p,corners[(i+1)%4])));
      this.history.push({time,corners:copy(corners),answer:copy(answer),qrSide});
      if(this.history.length>3)this.history.shift();
    }
    const samples=this.history.length,elapsed=samples?time-this.history[0].time:strictElapsed;
    const allowedRadius=samples?Math.min(...this.history.map(s=>s.qrSide))*.065:null;
    const radius=key=>{
      const mean=[0,1,2,3].map(i=>({x:this.history.reduce((n,s)=>n+s[key][i].x,0)/samples,y:this.history.reduce((n,s)=>n+s[key][i].y,0)/samples}));
      return Math.max(...this.history.flatMap(s=>s[key].map((p,i)=>distance(p,mean[i]))));
    };
    const cornerRadius=samples?radius('corners'):null,answerRadius=samples?radius('answer'):null;
    const bounded=samples===3&&elapsed>=240&&allowedRadius>0&&cornerRadius<allowedRadius&&answerRadius<allowedRadius;
    const acceptedBy=strict?'strict':bounded?'bounded-noise':null;
    const reason=acceptedBy||interrupted||(samples===3&&cornerRadius>=allowedRadius?'corner-unstable':samples===3&&answerRadius>=allowedRadius?'answer-unstable':previous&&!pairStable?'corner-shift':elapsed<240?'insufficient-duration':'awaiting-samples');
    // Scalar diagnostics only. Never expose stored corner arrays or frame data.
    this.info={reason,samples:samples||this.strictSamples,elapsedMs:elapsed,strictElapsedMs:strictElapsed,sampleGapMs:gap,maxCornerShiftPx:maxShift,allowedCornerShiftPx:allowedShift,maxCornerRadiusPx:cornerRadius,maxAnswerRadiusPx:answerRadius,allowedCornerRadiusPx:allowedRadius,acceptedBy};
    // This is a stability decision only: the worker must still use the current
    // frame's raw geometry and all existing quality checks, then teacher review.
    // It does not recover gaps >=700 ms or establish real-phone reliability.
    return Boolean(acceptedBy);
  }
}
