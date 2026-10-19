// Independent regression coverage for the minimal mobile original-crop repair.
// DOM/file sharing are mocked: this is not evidence of real iPhone browser behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';

const delay = () => new Promise(resolve => setTimeout(resolve, 5));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
const sourceBytes = Buffer.from([0xff, 0xd8, 0x00, 0x7f, 0x80, 0xfe, 0xff, 0xd9]);
const sourceCrop = `data:image/jpeg;base64,${sourceBytes.toString('base64')}`;

async function boot() {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, {url:'http://localhost:4173',runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window;
  w.indexedDB = new IDBFactory();
  w.isSecureContext = true;
  w.requestAnimationFrame = () => 1;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLMediaElement.prototype.play = async () => {};
  w.HTMLCanvasElement.prototype.getContext = function () {
    return {drawImage(){}, clearRect(){}, putImageData(){}, getImageData:()=>({width:this.width,height:this.height,data:new Uint8ClampedArray(this.width*this.height*4)})};
  };
  w.HTMLCanvasElement.prototype.toDataURL = () => sourceCrop;
  w.ImageData = class {constructor(data, width, height) {Object.assign(this,{data,width,height});}};
  w.Worker = class {postMessage() {}};
  w.HTMLDialogElement.prototype.showModal = function () {this.open=true;};
  w.HTMLDialogElement.prototype.close = function () {this.open=false;this.dispatchEvent(new w.Event('close'));};
  const created = [], revoked = [], downloads = [], popups = [];
  w.URL.createObjectURL = blob => {const url=`blob:review-${created.length}`;created.push({blob,url});return url;};
  w.URL.revokeObjectURL = url => revoked.push(url);
  w.HTMLAnchorElement.prototype.click = function () {downloads.push({anchor:this,href:this.href,name:this.download,attached:this.isConnected});};
  w.open = (...args) => {popups.push(args);return null;};
  const code = ['state.js','storage.js','crop-export.js','app.js'].map(name => fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8').replace(/^import .*?;\s*$/mg,'').replace(/\bexport\s+/g,'').replaceAll('import.meta.url',"'http://localhost:4173/src/app.js'")).join('\n');
  w.eval(code+'\nwindow.reviewTest={get state(){return state},get worker(){return recognitionWorker},current,captureRecord,addQuestion,render,showTab};');
  for(let count=0;count<100&&w.document.querySelector('#saveStatus').textContent!=='Saved on this device';count++) await delay();
  assert.equal(w.document.querySelector('#saveStatus').textContent,'Saved on this device');
  const api=w.reviewTest;
  const {session,question}=api.current();
  const {record}=api.captureRecord(session,question,'S001',{crop:sourceCrop,source:'camera'});
  record.status='review';
  api.showTab('review');
  return {w,dom,api,record,question,created,revoked,downloads,popups,close:()=>w.close()};
}

const bytesOf = (w,blob) => new Promise((resolve,reject) => {
  const reader=new w.FileReader();
  reader.onload=()=>resolve(Buffer.from(new Uint8Array(reader.result)));
  reader.onerror=()=>reject(reader.error);
  reader.readAsArrayBuffer(blob);
});

const get = (b,id) => b.w.document.getElementById(id);
const open = b => b.w.document.querySelector('[data-view-crop]').click();

test('mobile crop opens unchanged in-page, with attached byte-preserving download and no popup', async()=>{
  const b=await boot();
  try {
    const before=JSON.stringify(b.record);
    open(b);
    assert.equal(get(b,'cropViewer').hidden,false);
    assert.equal(get(b,'cropOriginal').src,sourceCrop);
    assert.equal(b.popups.length,0);
    assert.equal(b.downloads.length,0,'opening preview must not trigger a download');
    assert.equal(b.created.length,1);
    assert.deepEqual(await bytesOf(b.w,b.created[0].blob),sourceBytes);
    assert.equal(b.created[0].blob.type,'image/jpeg');
    assert.equal(get(b,'downloadCropFile').href,b.created[0].url);
    get(b,'downloadCropFile').click();
    assert.equal(b.downloads[0].attached,true);
    assert.equal(b.downloads[0].name,'boardlight-q1-S001-original-crop.jpg');
    assert.equal(JSON.stringify(b.record),before,'preview and export must not alter stored fields');
    assert.equal(b.record.result,null);
  } finally {b.close();}
});

test('full-resolution view and teacher draft survive review rerender without re-encoding',async()=>{
  const b=await boot();
  try {
    const input=get(b,'answer-S001');input.value='D';input.dispatchEvent(new b.w.Event('input'));
    open(b);get(b,'cropActualSize').click();
    assert.equal(get(b,'cropActualSize').getAttribute('aria-pressed'),'true');
    assert.equal(get(b,'cropOriginal').classList.contains('actual-pixels'),true);
    b.api.render();
    assert.equal(get(b,'cropViewer').hidden,false);
    assert.equal(get(b,'cropOriginal').src,sourceCrop);
    assert.equal(get(b,'cropOriginal').classList.contains('actual-pixels'),true);
    assert.equal(get(b,'answer-S001').value,'D');
    assert.equal(b.created.length,1,'render must not recreate or retire the active export URL');
    get(b,'cropActualSize').click();
    assert.equal(get(b,'cropOriginal').classList.contains('actual-pixels'),false);
  } finally {b.close();}
});

test('native file share is explicit, synchronous to click, single-flight, and does not claim verified save',async()=>{
  const b=await boot();
  try {
    const pending=deferred(),shares=[];
    b.w.navigator.canShare=({files})=>files.length===1;
    b.w.navigator.share=data=>{shares.push(data);return pending.promise;};
    open(b);
    assert.equal(get(b,'shareCrop').hidden,false);
    assert.equal(shares.length,0);
    const completion=get(b,'shareCrop').onclick();
    assert.equal(shares.length,1,'share must start before the handler yields and loses user activation');
    assert.equal(get(b,'shareCrop').disabled,true);
    await get(b,'shareCrop').onclick();
    assert.equal(shares.length,1,'repeated taps must not start concurrent share sheets');
    assert.equal(shares[0].files[0].name,'boardlight-q1-S001-original-crop.jpg');
    assert.deepEqual(await bytesOf(b.w,shares[0].files[0]),sourceBytes);
    pending.resolve();await completion;
    assert.equal(get(b,'shareCrop').disabled,false);
    assert.match(get(b,'cropExportStatus').textContent,/cannot verify/);
    assert.equal(b.downloads.length,0);
  } finally {b.close();}
});

for(const name of ['AbortError','NotAllowedError']) {
  test(`${name} from native share leaves original and fresh-click fallback available`,async()=>{
    const b=await boot();
    try {
      const pending=deferred();
      b.w.navigator.canShare=()=>true;b.w.navigator.share=()=>pending.promise;
      open(b);const completion=get(b,'shareCrop').onclick();
      pending.reject(Object.assign(new Error(name),{name}));await completion;
      assert.equal(get(b,'cropViewer').hidden,false);
      assert.equal(get(b,'cropOriginal').src,sourceCrop);
      assert.equal(get(b,'shareCrop').disabled,false);
      assert.equal(b.downloads.length,0,'cancellation/failure must not auto-download after activation expires');
      assert.match(get(b,'cropExportStatus').textContent,name==='AbortError'?/cancelled/:/could not complete/);
      get(b,'downloadCropFile').click();
      assert.equal(b.downloads.length,1);assert.equal(b.downloads[0].attached,true);
    } finally {b.close();}
  });
}

test('unsupported, throwing and missing file-share capabilities retain original preview and download',async()=>{
  for(const support of ['missing','false','throws','no-file']) {
    const b=await boot();
    try {
      let shares=0;b.w.navigator.share=()=>{shares++;return Promise.resolve();};
      if(support==='false')b.w.navigator.canShare=()=>false;
      if(support==='throws')b.w.navigator.canShare=()=>{throw new Error('Unsupported');};
      if(support==='no-file'){b.w.navigator.canShare=()=>true;b.w.File=undefined;}
      open(b);
      assert.equal(get(b,'shareCrop').hidden,true,support);
      await get(b,'shareCrop').onclick();
      assert.equal(shares,0);
      assert.equal(get(b,'cropOriginal').src,sourceCrop);
      assert.match(get(b,'downloadCropFile').href,/^blob:/);
    } finally {b.close();}
  }
});

test('missing Blob URL API keeps a usable saved-data image and attached fallback link',async()=>{
  const b=await boot();
  try {
    b.w.URL.createObjectURL=undefined;open(b);
    assert.equal(get(b,'cropViewer').hidden,false);
    assert.equal(get(b,'cropOriginal').src,sourceCrop);
    assert.equal(get(b,'downloadCropFile').href,sourceCrop);
    assert.equal(get(b,'downloadCropFile').isConnected,true);
  } finally {b.close();}
});

test('URLs live while preview is open and retire only after a delayed close or replacement',async()=>{
  const b=await boot();
  try {
    const timers=[];b.w.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};
    open(b);const first=b.created[0].url;
    b.w.dispatchEvent(new b.w.Event('pagehide'));
    b.w.document.dispatchEvent(new b.w.Event('visibilitychange'));
    assert.equal(b.revoked.length,0);assert.equal(timers.length,0);
    open(b);const second=b.created[1].url;
    assert.equal(timers.length,1);assert.ok(timers[0].ms>=60000);
    assert.equal(b.revoked.length,0);
    timers[0].fn();assert.deepEqual(b.revoked,[first]);
    assert.equal(get(b,'downloadCropFile').href,second);
    get(b,'closeCropViewer').click();
    assert.equal(get(b,'cropViewer').hidden,true);
    assert.equal(get(b,'cropOriginal').hasAttribute('src'),false);
    assert.equal(get(b,'downloadCropFile').hasAttribute('href'),false);
    assert.equal(timers.length,2);assert.ok(timers[1].ms>=60000);
    timers[1].fn();assert.deepEqual(b.revoked,[first,second]);
    get(b,'closeCropViewer').click();assert.equal(timers.length,2,'closing twice must not schedule duplicate cleanup');
  } finally {b.close();}
});

test('pending share completion cannot overwrite a replacement preview or share its new file implicitly',async()=>{
  const b=await boot();
  try {
    const pending=deferred(),shares=[];
    b.w.navigator.canShare=()=>true;b.w.navigator.share=data=>{shares.push(data);return pending.promise;};
    open(b);const completion=get(b,'shareCrop').onclick();
    b.record.crop='data:image/png;base64,AQIDBA==';b.api.render();open(b);
    assert.equal(get(b,'shareCrop').disabled,true);
    assert.equal(get(b,'cropOriginal').src,b.record.crop);
    const status=get(b,'cropExportStatus').textContent;
    pending.resolve();await completion;
    assert.equal(get(b,'cropExportStatus').textContent,status);
    assert.equal(get(b,'shareCrop').disabled,false);
    assert.equal(shares.length,1);
    assert.equal(get(b,'downloadCropFile').download,'boardlight-q1-S001-original-crop.png');
    assert.equal(b.created[1].blob.type,'image/png');
    assert.deepEqual(await bytesOf(b.w,b.created[1].blob),Buffer.from([1,2,3,4]));
  } finally {b.close();}
});

test('old capture needs no diagnostics and neutral legacy wording is display-only',async()=>{
  const b=await boot();
  try {
    delete b.record.quality;delete b.record.recognition;delete b.record.history;
    b.api.render();open(b);assert.equal(get(b,'cropOriginal').src,sourceCrop);
    const old='The crop does not look like one clear block-capital A, B, C or D. Please review it manually.';
    b.record.recognition={note:old,diagnostics:{decision:old}};
    const saved=JSON.stringify(b.record);b.api.render();
    assert.equal(get(b,'reviewList').textContent.includes(old),false);
    assert.match(get(b,'reviewList').textContent,/Could not confidently recognise this writing/);
    assert.equal(JSON.stringify(b.record),saved);
  } finally {b.close();}
});

test('malformed saved image reports a useful error without replacing an existing valid preview',async()=>{
  const b=await boot();
  try {
    open(b);const valid=get(b,'cropOriginal').src;
    b.record.crop='data:image/jpeg;base64,invalid!';b.api.render();open(b);
    assert.equal(get(b,'cropOriginal').src,valid);
    assert.match(get(b,'toast').textContent,/could not be opened/);
    assert.equal(b.created.length,1);
  } finally {b.close();}
});

test('erasing pilot data dismisses the active crop and its export link',async()=>{
  const b=await boot();
  try {
    open(b);b.w.confirm=()=>true;await get(b,'clearData').onclick();
    assert.equal(Object.keys(b.api.current().question.records).length,0);
    assert.equal(get(b,'cropViewer').hidden,true);
    assert.equal(get(b,'cropOriginal').hasAttribute('src'),false);
    assert.equal(get(b,'downloadCropFile').hasAttribute('href'),false);
  } finally {b.close();}
});
