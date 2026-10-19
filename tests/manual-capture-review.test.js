// Independent recovery tests: actual QR/geometry/quality worker + mocked DOM/media.
// These are not real iPhone/Safari camera or visual-layout tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {PNG} from 'pngjs';
import jsQR from 'jsqr';
import * as geometryModule from '../src/geometry.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function sample(name='synthetic-S001-A.png'){
 const p=PNG.sync.read(fs.readFileSync(new URL('../public/samples/'+name,import.meta.url)));
 return {width:p.width,height:p.height,data:new Uint8ClampedArray(p.data)};
}
function workerBoot({decoder=jsQR}={}){
 const source=fs.readFileSync(new URL('../src/scan-worker.js',import.meta.url),'utf8').replace(/importScripts\([^;]+;/,'').replace(/const geometry=import\([^;]+;/,'const geometry=Promise.resolve(geometryModule);');
 const messages=[],self={jsQR:decoder,postMessage:m=>messages.push(m)};
 vm.runInNewContext(source,{self,geometryModule,performance});
 return {async send(m){const count=messages.length;await self.onmessage({data:m});assert.equal(messages.length,count+1,'each frame must have one terminal response');return messages.at(-1);}};
}

async function boot(){
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/<script[\s\S]*?<\/script>/g,'');
 const dom=new JSDOM(html,{url:'http://localhost:4173',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 const rafs=new Map(),workers=[],strokes=[],frameImages=[];let rafSeq=0,imageSeq=0,now=100;
 w.indexedDB=new IDBFactory();w.isSecureContext=true;w.scrollTo=()=>{};
 Object.defineProperty(w.performance,'now',{configurable:true,value:()=>now});
 w.requestAnimationFrame=cb=>{const id=++rafSeq;rafs.set(id,cb);return id;};w.cancelAnimationFrame=id=>rafs.delete(id);
 w.HTMLMediaElement.prototype.play=async()=>{};
 w.HTMLCanvasElement.prototype.getContext=function(){return {drawImage(){},clearRect(){},putImageData(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){strokes.push(this.strokeStyle);},getImageData:()=>{const image={width:this.width,height:this.height,data:new Uint8ClampedArray(this.width*this.height*4)};image.data[0]=++imageSeq;frameImages.push(image);return image;}};};
 w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,AA==';
 w.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});}};
 w.Worker=class{constructor(url){this.url=String(url);this.messages=[];this.terminated=false;workers.push(this);}postMessage(m){this.messages.push(m);}terminate(){this.terminated=true;}};
 const video=w.document.getElementById('video');
 for(const [key,value] of Object.entries({videoWidth:1280,videoHeight:720,readyState:4}))Object.defineProperty(video,key,{configurable:true,value});
 const code=['state.js','storage.js','crop-export.js','scan-view.js','scan-channel.js','app.js'].map(name=>fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8').replace(/^import .*?;\s*$/mg,'').replace(/\bexport\s+/g,'').replaceAll('import.meta.url',"'http://localhost:4173/src/app.js'")).join('\n');
 w.eval(code+'\nwindow.manualReview={get state(){return state},get stream(){return stream},get context(){return context},get recognition(){return recognitionWorker},get channel(){return scanChannel},get candidate(){return captureCandidate},get request(){return manualRequest},get inFlight(){return manualInFlight},startCamera,stopCamera,processSource,onScan,requestManualCapture,scanFault,showTab,render,armRescan,addQuestion,setWriter(writer){writeState=writer;}};');
 for(let i=0;i<100&&w.document.getElementById('saveStatus').textContent!=='Saved on this device';i++)await tick();
 assert.equal(w.document.getElementById('saveStatus').textContent,'Saved on this device');
 const b={w,dom,api:w.manualReview,workers,strokes,frameImages,rafs,el:id=>w.document.getElementById(id),get scanner(){return workers.filter(x=>x.url.includes('scan-worker.js')&&!x.terminated).at(-1);},get q(){const s=this.api.state.sessions.find(x=>x.id===this.api.state.activeSessionId);return s.questions.find(q=>q.id===s.activeQuestionId);},advance(ms=160){now+=ms;const entries=[...rafs.entries()];rafs.clear();for(const [,callback] of entries)callback(now);},age(ms){now+=ms;},close(){this.api.stopCamera();w.close();}};
 return b;
}
async function start(b){const track={stopped:0,stop(){this.stopped++;},getSettings(){return {width:1280,height:720,frameRate:30};}},stream={getTracks:()=>[track],getVideoTracks:()=>[track]};b.w.navigator.mediaDevices={getUserMedia:async()=>stream};await b.api.startCamera();return {track,stream};}
const corners=[{x:80,y:72},{x:248,y:72},{x:248,y:240},{x:80,y:240}],answer=[{x:104,y:352},{x:1084,y:352},{x:1084,y:736},{x:104,y:736}];
function pending(b){b.api.processSource({width:1280,height:840},{source:'camera',still:false});return b.scanner.messages.at(-1);}
function geometryReady(id,pupil='S001',extra={}){return {id,pupil,ok:false,stage:'stability',corners,answer,reason:'Hold one board steady',...extra};}
function ready(id,pupil='S001',extra={}){return {id,pupil,ok:true,stage:'crop-ready',corners,answer,crop:{width:32,height:16,data:new Uint8ClampedArray(2048)},quality:{captureMode:'manual-camera'},...extra};}
async function emit(b,m){assert.equal(typeof b.scanner?.onmessage,'function','a live worker must own the result');b.scanner.onmessage({data:m});await tick();}
async function candidate(b,pupil='S001'){const request=pending(b);await emit(b,geometryReady(request.id,pupil));return request;}
function clickCapture(b){b.el('captureNow').click();}
async function manual(b,pupil='S001'){await candidate(b,pupil);clickCapture(b);b.advance();const m=b.scanner.messages.at(-1);assert.equal(m.manualCapture,true);assert.equal(m.expectedPupil,pupil);return m;}
async function settled(predicate,label){for(let i=0;i<100&&!predicate();i++)await tick();assert.ok(predicate(),label);}

test('manual worker captures a fresh matching QR without waiting for temporal stability',async()=>{
 const b=workerBoot();const m=await b.send({id:1,image:sample(),time:0,still:false,manualCapture:true,expectedPupil:'S001'});
 assert.equal(m.ok,true);assert.equal(m.pupil,'S001');assert.equal(m.stage,'crop-ready');assert.equal(m.crop.width,640);assert.equal(m.quality.captureMode,'manual-camera');
 for(const key of ['qrMs','geometryMs','warpMs','qualityMs'])assert.ok(Number.isFinite(m.timings[key]),key);
});
test('manual worker re-decodes the fresh QR and rejects a different pupil without a crop',async()=>{
 const b=workerBoot();const m=await b.send({id:2,image:sample('synthetic-S002-B.png'),time:100,still:false,manualCapture:true,expectedPupil:'S001'});
 assert.equal(m.ok,false);assert.equal(m.stage,'identity');assert.equal(m.crop,undefined);assert.match(m.reason,/S001|changed|different/i);
});
test('manual worker still rejects a blank answer through the real quality gate',async()=>{
 const m=await workerBoot().send({id:3,image:sample('synthetic-S001-blank.png'),time:100,manualCapture:true,expectedPupil:'S001'});
 assert.equal(m.ok,false);assert.equal(m.stage,'quality');assert.equal(m.crop,undefined);assert.match(m.reason,/writing|glare/i);
});
test('manual worker still rejects too-small QR geometry',async()=>{
 const full=sample(),width=297,height=210,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const sx=Math.floor(x*full.width/width),sy=Math.floor(y*full.height/height);data.set(full.data.subarray((sy*full.width+sx)*4,(sy*full.width+sx)*4+4),(y*width+x)*4);}
 const m=await workerBoot().send({id:4,image:{width,height,data},time:0,manualCapture:true,expectedPupil:'S001'});
 assert.equal(m.ok,false);assert.equal(m.stage,'geometry');assert.equal(m.crop,undefined);assert.match(m.reason,/small|closer/i);
});
test('manual worker cannot bypass pupil binding with a missing expected ID',async()=>{
 const m=await workerBoot().send({id:5,image:sample(),time:0,manualCapture:true});
 assert.equal(m.ok,false);assert.equal(m.crop,undefined);
});

test('capture control needs a current geometry-valid roster pupil and expires its candidate',async()=>{
 const b=await boot();try{await start(b);assert.equal(b.el('captureNow').disabled,true);let job=pending(b);await emit(b,geometryReady(job.id,'S001',{stage:'geometry',answer:undefined,reason:'Move closer'}));assert.equal(b.el('captureNow').disabled,true);
 job=pending(b);await emit(b,geometryReady(job.id,'S001',{stage:'geometry',reason:'Keep the whole answer area in view'}));assert.equal(b.el('captureNow').disabled,true,'a clipped answer still has corner coordinates but failed geometry');
 await candidate(b,'S999');assert.equal(b.el('captureNow').disabled,true);await candidate(b);assert.equal(b.el('captureNow').disabled,false);
 const before=b.frameImages.length;b.age(2001);clickCapture(b);b.advance();assert.equal(b.scanner.messages.at(-1).manualCapture===true,false);assert.equal(b.api.request,null);assert.ok(b.frameImages.length<=before+1);
 }finally{b.close();}
});
test('a shutter queued during an in-flight check takes exactly one fresh frame and keeps the bound pupil',async()=>{
 const b=await boot();try{await start(b);await candidate(b);const waiting=pending(b),previousImage=waiting.image,reads=b.frameImages.length,messages=b.scanner.messages.length;
 clickCapture(b);clickCapture(b);assert.equal(b.frameImages.length,reads,'button must not reuse or read a competing frame');assert.equal(b.scanner.messages.length,messages);assert.equal(b.api.request.pupil,'S001');
 await emit(b,geometryReady(waiting.id));b.advance();const fresh=b.scanner.messages.at(-1);assert.equal(b.scanner.messages.length,messages+1);assert.equal(b.frameImages.length,reads+1);assert.equal(fresh.manualCapture,true);assert.equal(fresh.expectedPupil,'S001');assert.notEqual(fresh.image,previousImage);assert.notEqual(fresh.image.data[0],previousImage.data[0]);assert.equal(fresh.still,false);
 b.advance();clickCapture(b);assert.equal(b.scanner.messages.length,messages+1,'double clicks and animation must not create a second in-flight shutter');
 }finally{b.close();}
});
test('a changed QR in the fresh frame cannot capture either pupil under the queued shutter',async()=>{
 const b=await boot();try{await start(b);await candidate(b);const waiting=pending(b);clickCapture(b);await emit(b,geometryReady(waiting.id,'S002'));b.advance();const fresh=b.scanner.messages.at(-1);assert.equal(fresh.expectedPupil,'S001');
 const result=await workerBoot().send({...fresh,image:sample('synthetic-S002-B.png')});assert.equal(result.stage,'identity');await emit(b,result);assert.deepEqual(Object.keys(b.q.records),[]);assert.equal(b.api.recognition.messages.length,0);assert.equal(b.el('cameraShell').classList.contains('captured'),false);assert.equal(b.api.request,null);assert.equal(b.api.inFlight,false);
 }finally{b.close();}
});
test('manual quality rejection does not save or recognise and allows a later deliberate retry',async()=>{
 const b=await boot();try{await start(b);const fresh=await manual(b);const result=await workerBoot().send({...fresh,image:sample('synthetic-S001-blank.png')});await emit(b,result);
 assert.deepEqual(Object.keys(b.q.records),[]);assert.equal(b.api.recognition.messages.length,0);assert.equal(b.strokes.includes('#bbeb8b'),false);assert.equal(b.api.inFlight,false);assert.equal(b.api.request,null);
 await candidate(b);assert.equal(b.el('captureNow').disabled,false);clickCapture(b);b.advance();assert.equal(b.scanner.messages.at(-1).manualCapture,true);
 }finally{b.close();}
});
test('automatic success while a shutter is queued cancels the redundant manual capture',async()=>{
 const b=await boot();try{await start(b);await candidate(b);const waiting=pending(b);clickCapture(b);await emit(b,ready(waiting.id,'S001',{quality:{}}));await settled(()=>b.api.recognition.messages.length===1,'saved automatic frame should be recognised');
 assert.equal(b.api.request,null);b.advance();assert.notEqual(b.scanner.messages.at(-1).manualCapture,true);assert.equal(b.q.records.S001.history.length,0);assert.equal(b.el('captureNow').disabled,true);
 }finally{b.close();}
});
test('manual capture remains duplicate-locked and an explicitly armed rescan replaces exactly once',async()=>{
 const b=await boot();try{await start(b);let fresh=await manual(b);await emit(b,ready(fresh.id));await settled(()=>b.api.recognition.messages.length===1,'first capture saved');const first=b.q.records.S001;
 await candidate(b);assert.equal(b.el('captureNow').disabled,true);clickCapture(b);assert.equal(b.api.request,null);assert.equal(b.q.records.S001.token,first.token);
 b.api.armRescan(b.q,'S001');fresh=await manual(b);await emit(b,ready(fresh.id));await settled(()=>b.api.recognition.messages.length===2,'replacement saved');const replacement=b.q.records.S001;assert.notEqual(replacement.token,first.token);assert.equal(replacement.history.length,1);assert.equal(replacement.history[0].token,first.token);assert.equal(replacement.rescanArmed,false);assert.equal(replacement.result,null);
 await candidate(b);assert.equal(b.el('captureNow').disabled,true);assert.equal(b.q.records.S001.history.length,1);
 }finally{b.close();}
});
for(const reason of ['stop','context','timeout'])test(`queued manual shutter is cleared by ${reason} and cannot leak into restart`,async()=>{
 const b=await boot();try{const media=await start(b);await candidate(b);const waiting=pending(b);const oldScanner=b.scanner,oldReply=oldScanner.onmessage;clickCapture(b);assert.ok(b.api.request);
 if(reason==='stop')b.api.stopCamera();else if(reason==='context')b.api.showTab('results');else b.api.scanFault({id:waiting.id,reason:'timeout'});
 assert.equal(b.api.request,null);assert.equal(b.api.candidate,null);assert.equal(b.api.inFlight,false);assert.ok(media.track.stopped);assert.equal(b.api.stream,null);assert.equal(b.el('captureNow').hidden,true);
 if(reason==='context')b.api.showTab('scan');await start(b);oldReply({data:ready(waiting.id)});b.advance();assert.deepEqual(Object.keys(b.q.records),[]);assert.notEqual(b.scanner.messages.at(-1).manualCapture,true);assert.equal(b.el('cameraShell').classList.contains('captured'),false);
 }finally{b.close();}
});
test('Stop after manual dispatch discards a late accepted crop and stale shutter state',async()=>{
 const b=await boot();try{await start(b);const fresh=await manual(b),oldReply=b.scanner.onmessage;b.api.stopCamera();oldReply({data:ready(fresh.id)});await tick();assert.deepEqual(Object.keys(b.q.records),[]);assert.equal(b.api.recognition.messages.length,0);assert.equal(b.api.inFlight,false);assert.equal(b.api.request,null);
 }finally{b.close();}
});
test('manual capture does not turn green or launch recognition until its original crop is saved',async()=>{
 const b=await boot();try{await start(b);const fresh=await manual(b),save=deferred();b.api.setWriter(()=>save.promise);await emit(b,ready(fresh.id));
 assert.equal(b.strokes.includes('#bbeb8b'),false);assert.equal(b.el('cameraShell').classList.contains('captured'),false);assert.doesNotMatch(b.el('feedbackText').textContent,/CAPTURED/);assert.equal(b.api.recognition.messages.length,0);
 save.resolve();await settled(()=>b.api.recognition.messages.length===1,'recognition should start after durable save');assert.match(b.el('feedbackText').textContent,/CAPTURED/);assert.equal(b.el('cameraShell').classList.contains('captured'),true);assert.equal(b.q.records.S001.result,null);assert.equal(b.q.records.S001.source,'camera');assert.equal(b.q.records.S001.quality.captureMode,'manual-camera');
 }finally{b.close();}
});
test('manual save failure stops scanning without a success flash or recognition request',async()=>{
 const b=await boot();try{const media=await start(b),fresh=await manual(b);b.api.setWriter(async()=>{throw new Error('Review save failure');});await emit(b,ready(fresh.id));await settled(()=>b.api.stream===null,'save failure should stop camera');assert.ok(media.track.stopped);assert.equal(b.api.recognition.messages.length,0);assert.equal(b.strokes.includes('#bbeb8b'),false);assert.equal(b.api.request,null);assert.equal(b.api.inFlight,false);assert.match(b.el('notice').textContent,/Scanning is paused/);
 }finally{b.close();}
});
test('fullscreen keyboard loop reaches Capture now and Exit, and Escape cancels a queued shutter',async()=>{
 const b=await boot();try{const media=await start(b);await candidate(b);const exit=b.el('stopCamera'),capture=b.el('captureNow');assert.equal(capture.closest('[inert]'),null);exit.focus();
 const tab=()=>{const event=new b.w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});b.w.document.dispatchEvent(event);return event;};assert.equal(tab().defaultPrevented,true);assert.equal(b.w.document.activeElement,capture);tab();assert.equal(b.w.document.activeElement,exit);
 const reverse=new b.w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true});b.w.document.dispatchEvent(reverse);assert.equal(b.w.document.activeElement,capture);
 // jsdom has no native keyboard activation; invoking the focused native button
 // checks the same click handler Enter/Space invokes in a real browser.
 b.w.document.activeElement.click();assert.ok(b.api.request);b.w.document.dispatchEvent(new b.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(b.api.stream,null);assert.equal(b.api.request,null);assert.ok(media.track.stopped);assert.equal(b.w.document.documentElement.classList.contains('scan-view-active'),false);assert.equal(b.w.document.activeElement,b.el('startCamera'));
 }finally{b.close();}
});


test('app rejects an accepted manual response with the wrong bound pupil even if the worker contract is broken',async()=>{
 const b=await boot();try{await start(b);const fresh=await manual(b,'S001');await emit(b,ready(fresh.id,'S002'));assert.deepEqual(Object.keys(b.q.records),[]);assert.equal(b.api.recognition.messages.length,0);assert.equal(b.strokes.includes('#bbeb8b'),false);assert.equal(b.api.inFlight,false);assert.equal(b.api.request,null);
 }finally{b.close();}
});
test('changing the active question clears queued capture and rejects the old worker reply',async()=>{
 const b=await boot(),save=deferred();try{await start(b);await candidate(b);const waiting=pending(b),oldReply=b.scanner.onmessage,oldQuestion=b.q;clickCapture(b);
 // changeContext intentionally starts persistence without awaiting it. Hold the
 // write beyond the old 5 ms wait, then drain it before destroying this DOM.
 b.api.setWriter(()=>save.promise);
 const session=b.api.state.sessions[0];b.api.addQuestion(session,{prompt:'Second question',mode:'choice',answers:['B']});b.api.render();b.el('questionSelect').dispatchEvent(new b.w.Event('change',{bubbles:true}));assert.equal(b.api.stream,null);assert.equal(b.api.request,null);
 await start(b);oldReply({data:ready(waiting.id)});await tick();assert.deepEqual(Object.keys(oldQuestion.records),[]);assert.deepEqual(Object.keys(b.q.records),[]);b.advance();assert.notEqual(b.scanner.messages.at(-1).manualCapture,true);assert.equal(b.el('saveStatus').textContent,'Saving on this device…');
 }finally{save.resolve();try{await settled(()=>b.el('saveStatus').textContent==='Saved on this device','question persistence must finish before jsdom teardown');}finally{b.close();}}
});

test('manual observation of a different pupil breaks automatic temporal evidence',async()=>{
 const b=workerBoot();let m=await b.send({id:1,image:sample('synthetic-S002-B.png'),time:0});assert.equal(m.ok,false);
 m=await b.send({id:2,image:sample(),time:150,manualCapture:true,expectedPupil:'S001'});assert.equal(m.ok,true);
 m=await b.send({id:3,image:sample('synthetic-S002-B.png'),time:300});assert.equal(m.ok,false,'automatic S002 must start fresh after observing S001 at the manual shutter');assert.equal(m.stage,'stability');
});


function noisyDecoder(){let i=0;return (...args)=>{const code=jsQR(...args);if(!code)return code;const shift=[8,-8,8][i++%3],location={...code.location};for(const key of ['topLeftCorner','topRightCorner','bottomRightCorner','bottomLeftCorner'])location[key]={x:location[key].x+shift,y:location[key].y};return {...code,location};};}
test('bounded-noise worker keeps the current raw geometry for its crop rather than averaging or reusing an older crop',async()=>{
 const image=sample(),b=workerBoot({decoder:noisyDecoder()});let m;for(let i=0;i<3;i++)m=await b.send({id:i,image,time:i*150});assert.equal(m.ok,true);assert.equal(m.gate.acceptedBy,'bounded-noise');
 const code=jsQR(image.data,image.width,image.height),points=['topLeftCorner','topRightCorner','bottomRightCorner','bottomLeftCorner'].map(key=>({x:code.location[key].x+8,y:code.location[key].y}));const fit=geometryModule.checkGeometry(points,image.width,image.height);assert.equal(fit.ok,true);const expected=geometryModule.warpAnswer(image,fit.h);assert.deepEqual(m.crop.data,expected.data);assert.equal(m.quality.captureMode,'automatic-camera');
});
test('bounded-noise acceptance still reaches and obeys the real quality gate',async()=>{
 const image=sample('synthetic-S001-blank.png'),b=workerBoot({decoder:noisyDecoder()});let m;for(let i=0;i<3;i++)m=await b.send({id:i,image,time:i*150});assert.equal(m.ok,false);assert.equal(m.stage,'quality');assert.equal(m.crop,undefined);assert.match(m.reason,/writing|glare/i);
});
