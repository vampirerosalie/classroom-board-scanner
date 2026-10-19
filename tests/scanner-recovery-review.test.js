// Independent recovery review. Mocked DOM/media/worker behavior, not real Safari execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function boot(){
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/<script[\s\S]*?<\/script>/g,'');
 const dom=new JSDOM(html,{url:'http://localhost:4173',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,rafs=new Map(),strokes=[],workers=[];let rafSeq=0;
 w.indexedDB=new IDBFactory();w.isSecureContext=true;w.scrollTo=()=>{};
 w.requestAnimationFrame=callback=>{const id=++rafSeq;rafs.set(id,callback);return id;};
 w.cancelAnimationFrame=id=>rafs.delete(id);
 w.HTMLMediaElement.prototype.play=async()=>{};
 w.HTMLCanvasElement.prototype.getContext=function(){return {drawImage(){},clearRect(){},putImageData(){},beginPath(){},lineTo(){},moveTo(){},closePath(){},stroke(){strokes.push(this.strokeStyle);},getImageData:()=>({width:this.width,height:this.height,data:new Uint8ClampedArray(this.width*this.height*4)})};};
 w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,AA==';
 w.ImageData=class {constructor(data,width,height){Object.assign(this,{data,width,height});}};
 w.Worker=class {constructor(url){this.url=String(url);this.messages=[];this.terminated=false;workers.push(this);}postMessage(message){this.messages.push(message);}terminate(){this.terminated=true;}};
 // Use the production transport when present; separate channel tests own its behavior.
 const names=['state.js','storage.js','crop-export.js','scan-view.js','scan-channel.js','app.js'];
 const code=names.map(name=>fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8').replace(/^import .*?;\s*$/mg,'').replace(/\bexport\s+/g,'').replaceAll('import.meta.url',"'http://localhost:4173/src/app.js'")).join('\n');
 w.eval(code+'\nwindow.reviewApi={get state(){return state},get stream(){return stream},get context(){return context},get recognition(){return recognitionWorker},get scanChannel(){return scanChannel},get cameraGeneration(){return cameraGeneration},startCamera,stopCamera,processSource,onScan,showTab,scanFault,setWriter(writer){writeState=writer;}};');
 for(let i=0;i<100&&w.document.querySelector('#saveStatus').textContent!=='Saved on this device';i++)await tick();
 assert.equal(w.document.querySelector('#saveStatus').textContent,'Saved on this device');
 return {w,dom,api:w.reviewApi,rafs,strokes,workers,tick,close(){w.reviewApi.stopCamera();w.close();}};
}
const media=()=>{const track={stopped:0,stop(){this.stopped++;},getSettings(){return {width:1920,height:1080,frameRate:30};}};return {track,stream:{getTracks:()=>[track],getVideoTracks:()=>[track]}};};
const response=id=>({data:{id,ok:true,pupil:'S001',stage:'ready',crop:{width:32,height:16,data:new Uint8ClampedArray(2048)},quality:{},corners:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]}});
async function start(b){const m=media();b.w.navigator.mediaDevices={getUserMedia:async()=>m.stream};await b.api.startCamera();return m;}
function enqueue(b){b.api.processSource({width:1280,height:720},{source:'camera',still:false});return b.api.context.id;}

test('review: Stop/Start cannot multiply queued animation loops',async()=>{const b=await boot();try{await start(b);assert.equal(b.rafs.size,1);const old=[...b.rafs.values()][0];b.api.stopCamera();await start(b);const before=b.rafs.size;old(200);assert.equal(b.rafs.size,before,'stale animation callback must not schedule another loop');assert.equal(b.rafs.size,1,'there should be exactly one live RAF callback');}finally{b.close();}});

test('review: acquisition success is not green before the save commits',async()=>{const b=await boot();try{await start(b);const save=deferred();b.api.setWriter(()=>save.promise);const pending=b.api.onScan(response(enqueue(b)));assert.equal(b.strokes.includes('#bbeb8b'),false,'green geometry must await durable capture');assert.equal(b.w.document.querySelector('#cameraShell').classList.contains('captured'),false);assert.doesNotMatch(b.w.document.querySelector('#feedbackText').textContent,/CAPTURED/);assert.equal(b.api.recognition.messages.length,0,'recognition must wait for the original crop save');save.resolve();await pending;assert.match(b.w.document.querySelector('#feedbackText').textContent,/CAPTURED/);assert.equal(b.api.recognition.messages.length,1);}finally{b.close();}});

test('review: Exit during a pending save cannot flash or vibrate an old capture',async()=>{const b=await boot();try{const m=await start(b),save=deferred();let vibrations=0;b.w.navigator.vibrate=()=>{vibrations++;};b.api.setWriter(()=>save.promise);const pending=b.api.onScan(response(enqueue(b)));b.w.document.querySelector('#stopCamera').click();save.resolve();await pending;assert.equal(b.api.stream,null);assert.ok(m.track.stopped);assert.equal(b.w.document.documentElement.classList.contains('scan-view-active'),false);assert.equal(b.w.document.querySelector('#cameraShell').classList.contains('captured'),false);assert.equal(vibrations,0);assert.equal(b.api.recognition.messages.length,1,'already accepted crop can still receive a suggestion after Exit');}finally{b.close();}});

test('review: late worker result cannot mutate a restarted camera session',async()=>{const b=await boot();try{await start(b);const oldId=enqueue(b);b.api.stopCamera();await start(b);const newer=b.api.stream;await b.api.onScan(response(oldId));assert.equal(b.api.stream,newer);assert.equal(Object.keys(b.api.state.sessions[0].questions[0].records).length,0);assert.equal(b.w.document.querySelector('#cameraShell').classList.contains('captured'),false);}finally{b.close();}});

test('review: saved-action feedback survives camera frame preparation',async()=>{const b=await boot();try{await start(b);await b.api.onScan(response(enqueue(b)));const feedback=b.w.document.querySelector('#feedbackText').textContent;enqueue(b);assert.equal(b.w.document.querySelector('#feedbackText').textContent,feedback);assert.doesNotMatch(feedback,/Checking/);}finally{b.close();}});

test('review: older cancelled permission request cannot enable Start during a newer pending request',async()=>{const b=await boot();try{const first=deferred(),second=deferred(),m1=media(),m2=media();let calls=0;b.w.navigator.mediaDevices={getUserMedia:()=>++calls===1?first.promise:second.promise};const p1=b.api.startCamera();b.api.stopCamera();const p2=b.api.startCamera();first.resolve(m1.stream);await p1;const disabledDuringSecond=b.w.document.querySelector('#startCamera').disabled;second.resolve(m2.stream);await p2;assert.ok(m1.track.stopped);assert.equal(disabledDuringSecond,true,'newer acquisition must keep its Start button disabled');assert.equal(b.api.stream,m2.stream);}finally{b.close();}});

test('review: saving failure never gives saved success or dispatches recognition',async()=>{const b=await boot();try{const m=await start(b);b.api.setWriter(async()=>{throw new Error('Storage review failure');});await b.api.onScan(response(enqueue(b)));assert.equal(b.api.stream,null);assert.ok(m.track.stopped);assert.equal(b.api.recognition.messages.length,0);assert.equal(b.w.document.querySelector('#cameraShell').classList.contains('captured'),false);assert.doesNotMatch(b.w.document.querySelector('#feedbackText').textContent,/CAPTURED/);assert.match(b.w.document.querySelector('#notice').textContent,/Scanning is paused/);}finally{b.close();}});

test('review: diagnostic timing display contains metrics, never crop data',async()=>{const b=await boot();try{await start(b);await b.api.onScan(response(enqueue(b)));const timing=b.w.document.querySelector('#scanTiming').textContent;assert.match(timing,/1280 × 720 pixels/);assert.match(timing,/QR/);assert.match(timing,/save/);assert.doesNotMatch(timing,/data:image|base64|https?:/);}finally{b.close();}});


test('review: Exit clears the previous saved flash before a new session starts',async()=>{const b=await boot();try{await start(b);await b.api.onScan(response(enqueue(b)));assert.equal(b.w.document.querySelector('#cameraShell').classList.contains('captured'),true);b.api.stopCamera();assert.equal(b.w.document.querySelector('#cameraShell').classList.contains('captured'),false);await start(b);assert.equal(b.w.document.querySelector('#cameraShell').classList.contains('captured'),false);}finally{b.close();}});

test('review: timeout fault explains the timeout and gives a fresh-start action',async()=>{const b=await boot();try{await start(b);enqueue(b);b.api.scanFault({id:b.api.context.id,reason:'timeout',error:new Error('timed out')});assert.equal(b.api.stream,null);assert.match(b.w.document.querySelector('#feedbackText').textContent,/took too long|timed out/i);assert.match(b.w.document.querySelector('#feedbackText').textContent,/Start camera/);}finally{b.close();}});

test('review: old save continuation cannot stop a new camera if recognition dispatch fails',async()=>{const b=await boot();try{await start(b);const save=deferred();b.api.setWriter(()=>save.promise);const id=enqueue(b);const scanner=b.workers.find(worker=>worker.url.includes('scan-worker.js'));scanner.onmessage(response(id));b.api.stopCamera();await start(b);const currentStream=b.api.stream;b.api.recognition.postMessage=()=>{throw new Error('Recognition dispatch failed');};save.resolve();await tick();await tick();assert.equal(b.api.stream,currentStream,'failure from an old capture must not stop the new session');assert.equal(b.w.document.documentElement.classList.contains('scan-view-active'),true);}finally{b.close();}});
