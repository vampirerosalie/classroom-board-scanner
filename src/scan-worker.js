/* Local-only worker: jsQR reads pixels; no BarcodeDetector dependency. */
importScripts('../vendor/jsQR.js?v=0.2.3');
const geometry=import('./geometry.js?v=0.2.3');
let stability,lastSampleTime=null;
self.onmessage=async ({data:m})=>{
  const start=performance.now(),timings={};
  const emit=(stage,result,transfer=[])=>self.postMessage({id:m.id,stage,timings:{...timings,workerMs:performance.now()-start},...result},transfer);
  try{
    const g=await geometry;stability??=new g.StabilityGate();
    if(m.reset){stability.reset();lastSampleTime=null;return;}
    // An explicit shutter/photo is not contiguous automatic temporal evidence.
    if(m.manualCapture||m.still){stability.reset();lastSampleTime=null;}
    timings.sampleGapMs=lastSampleTime===null?null:m.time-lastSampleTime;lastSampleTime=m.time;
    const qrStart=performance.now();
    const code=self.jsQR(m.image.data,m.image.width,m.image.height,{inversionAttempts:'dontInvert'});
    timings.qrMs=performance.now()-qrStart;
    if(!code){stability.reset();emit('find-qr',{ok:false,reason:'Find one board. Keep its QR and whole answer area in view.'});return;}
    const pupil=code.data.trim();if(!/^S\d{3}$/.test(pupil)){stability.reset();emit('qr-id',{ok:false,reason:'Use a standard S001–S040 board QR'});return;}
    if(m.manualCapture&&(!/^S\d{3}$/.test(m.expectedPupil||'')||pupil!==m.expectedPupil)){stability.reset();emit('identity',{pupil,ok:false,reason:'The QR changed before capture. Point at the intended board and tap Capture now again.'});return;}
    const l=code.location,corners=[l.topLeftCorner,l.topRightCorner,l.bottomRightCorner,l.bottomLeftCorner];
    const geometryStart=performance.now(),fit=g.checkGeometry(corners,m.image.width,m.image.height);timings.geometryMs=performance.now()-geometryStart;
    if(!fit.ok){stability.reset();emit('geometry',{pupil,corners,...fit});return;}
    const stable=m.still||m.manualCapture||stability.update(pupil,corners,m.time,fit.answer);
    if(!stable){emit('stability',{pupil,corners,answer:fit.answer,ok:false,gate:stability.info,reason:timings.sampleGapMs>=700?'Processing gaps prevent automatic capture. You can tap Capture now.':'Automatic capture is checking QR consistency. You can tap Capture now.'});return;}
    const warpStart=performance.now(),crop=g.warpAnswer(m.image,fit.h);timings.warpMs=performance.now()-warpStart;
    const qualityStart=performance.now(),quality=g.assessQuality(crop);timings.qualityMs=performance.now()-qualityStart;
    if(!quality.ok){emit('quality',{pupil,corners,answer:fit.answer,ok:false,reason:quality.reason,quality});return;}
    emit('crop-ready',{pupil,corners,answer:fit.answer,ok:true,crop,gate:m.manualCapture?{reason:'explicit-shutter',acceptedBy:'manual',samples:1}:m.still?{reason:'imported-photo',acceptedBy:'photo',samples:1}:stability.info,quality:{...quality,captureMode:m.manualCapture?'manual-camera':m.still?'photo':'automatic-camera',qrPixels:fit.qrPixels,scanMs:Math.round(performance.now()-start)}},[crop.data.buffer]);
  }catch(e){emit('error',{ok:false,reason:'Capture could not be processed. Try again.',error:String(e.message)});}
};
