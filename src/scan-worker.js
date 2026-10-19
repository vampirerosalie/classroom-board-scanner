/* Local-only worker: jsQR reads pixels; no BarcodeDetector dependency. */
importScripts('../vendor/jsQR.js?v=0.2.2');
const geometry=import('./geometry.js?v=0.2.2');
let stability,lastSampleTime=null;
self.onmessage=async ({data:m})=>{
  const start=performance.now(),timings={};
  const emit=(stage,result,transfer=[])=>self.postMessage({id:m.id,stage,timings:{...timings,workerMs:performance.now()-start},...result},transfer);
  try{
    const g=await geometry;stability??=new g.StabilityGate();
    if(m.reset){stability.reset();lastSampleTime=null;return;}
    timings.sampleGapMs=lastSampleTime===null?null:m.time-lastSampleTime;lastSampleTime=m.time;
    const qrStart=performance.now();
    const code=self.jsQR(m.image.data,m.image.width,m.image.height,{inversionAttempts:'dontInvert'});
    timings.qrMs=performance.now()-qrStart;
    if(!code){stability.reset();emit('find-qr',{ok:false,reason:'Find one board. Keep its QR and whole answer area in view.'});return;}
    const pupil=code.data.trim();if(!/^S\d{3}$/.test(pupil)){emit('qr-id',{ok:false,reason:'Use a standard S001–S040 board QR'});return;}
    const l=code.location,corners=[l.topLeftCorner,l.topRightCorner,l.bottomRightCorner,l.bottomLeftCorner];
    const geometryStart=performance.now(),fit=g.checkGeometry(corners,m.image.width,m.image.height);timings.geometryMs=performance.now()-geometryStart;
    if(!fit.ok){stability.reset();emit('geometry',{pupil,corners,...fit});return;}
    const stable=m.still||stability.update(pupil,corners,m.time);
    if(!stable){emit('stability',{pupil,corners,answer:fit.answer,ok:false,reason:timings.sampleGapMs>=700?'Checks are too far apart to confirm steadiness. Keep one board close and well lit.':'Hold one board steady. Keep other QRs out of view.'});return;}
    const warpStart=performance.now(),crop=g.warpAnswer(m.image,fit.h);timings.warpMs=performance.now()-warpStart;
    const qualityStart=performance.now(),quality=g.assessQuality(crop);timings.qualityMs=performance.now()-qualityStart;
    if(!quality.ok){emit('quality',{pupil,corners,answer:fit.answer,ok:false,reason:quality.reason,quality});return;}
    emit('crop-ready',{pupil,corners,answer:fit.answer,ok:true,crop,quality:{...quality,qrPixels:fit.qrPixels,scanMs:Math.round(performance.now()-start)}},[crop.data.buffer]);
  }catch(e){emit('error',{ok:false,reason:'Capture could not be processed. Try again.',error:String(e.message)});}
};
