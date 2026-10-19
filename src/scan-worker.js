/* Local-only worker: jsQR reads pixels; no BarcodeDetector dependency. */
importScripts('../vendor/jsQR.js?v=0.2.1');
const geometry=import('./geometry.js?v=0.2.1');
let stability;
self.onmessage=async ({data:m})=>{
  try{
    const g=await geometry;stability??=new g.StabilityGate();
    if(m.reset){stability.reset();return;}
    const start=performance.now();
    const code=self.jsQR(m.image.data,m.image.width,m.image.height,{inversionAttempts:'dontInvert'});
    if(!code){stability.reset();self.postMessage({id:m.id,ok:false,reason:'Find one board. Keep the QR and answer in view.'});return;}
    const pupil=code.data.trim();if(!/^S\d{3}$/.test(pupil)){self.postMessage({id:m.id,ok:false,reason:'Use a standard S001–S040 board QR'});return;}
    const l=code.location,corners=[l.topLeftCorner,l.topRightCorner,l.bottomRightCorner,l.bottomLeftCorner];
    const fit=g.checkGeometry(corners,m.image.width,m.image.height);
    if(!fit.ok){stability.reset();self.postMessage({id:m.id,pupil,corners,...fit});return;}
    const stable=m.still||stability.update(pupil,corners,m.time);
    if(!stable){self.postMessage({id:m.id,pupil,corners,answer:fit.answer,ok:false,reason:'Hold steady for a moment'});return;}
    const crop=g.warpAnswer(m.image,fit.h);const quality=g.assessQuality(crop);
    if(!quality.ok){self.postMessage({id:m.id,pupil,corners,answer:fit.answer,ok:false,reason:quality.reason,quality});return;}
    self.postMessage({id:m.id,pupil,corners,answer:fit.answer,ok:true,crop,quality:{...quality,qrPixels:fit.qrPixels,scanMs:Math.round(performance.now()-start)}},[crop.data.buffer]);
  }catch(e){self.postMessage({id:m.id,ok:false,reason:'Capture could not be processed. Try again.',error:String(e.message)});}
};
