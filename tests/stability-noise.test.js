import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PNG} from 'pngjs';
import jsQR from 'jsqr';
import * as geometryModule from '../src/geometry.js';
const {StabilityGate,answerCorners,distance}=geometryModule;

const square=(shift=0,size=64)=>[{x:100+shift,y:100},{x:100+size+shift,y:100},{x:100+size+shift,y:100+size},{x:100+shift,y:100+size}];
function sample(gate,shift,time,{size=64,id='S001',answer=true,perturb=0}={}){
  const corners=square(shift,size);corners[2].x+=perturb;
  return gate.update(id,corners,time,answer?answerCorners(corners):undefined);
}

test('bounded three-sample noise accepts coherent +/-3px around a stationary 64px QR',()=>{
  const gate=new StabilityGate();
  assert.equal(sample(gate,3,0),false);
  assert.equal(sample(gate,-3,150),false);
  assert.equal(sample(gate,3,300),true);
  assert.equal(gate.info.acceptedBy,'bounded-noise');
  assert.equal(gate.info.samples,3);
  assert.equal(gate.info.elapsedMs,300);
  assert.equal(gate.info.maxCornerShiftPx,6);
  assert.equal(gate.info.allowedCornerShiftPx,4.16);
  assert.ok(Math.abs(gate.info.maxAnswerRadiusPx-4)<1e-8);
});

test('bounded fallback rejects +/-4px noise, clear drift and a large isolated jump',()=>{
  for(const sequence of [[4,-4,4],[0,5,10],[0,0,10]]){
    const gate=new StabilityGate();
    sequence.forEach((shift,i)=>assert.equal(sample(gate,shift,i*150),false));
    assert.equal(gate.info.acceptedBy,null);
    assert.equal(gate.info.reason,'corner-unstable');
  }
});

test('answer-region bound rejects amplified perspective noise that passes the QR window',()=>{
  const base=square(0,72),perturbed=square(0,72);perturbed[2].x+=1;
  const original=answerCorners(base),changed=answerCorners(perturbed);
  assert.ok(Math.max(...changed.map((p,i)=>distance(p,original[i])))>27,'one QR pixel can move a far answer corner by more than 27px');
  const gate=new StabilityGate();
  assert.equal(sample(gate,3,0,{size:72}),false);
  assert.equal(sample(gate,-3,150,{size:72,perturb:1}),false);
  assert.equal(sample(gate,3,300,{size:72}),false);
  assert.ok(gate.info.maxCornerRadiusPx<gate.info.allowedCornerRadiusPx);
  assert.ok(gate.info.maxAnswerRadiusPx>gate.info.allowedCornerRadiusPx);
  assert.equal(gate.info.reason,'answer-unstable');
});

test('legacy QR-only callers retain strict two-sample acceptance and cannot use fallback',()=>{
  const strict=new StabilityGate();
  assert.equal(sample(strict,0,0,{answer:false}),false);
  assert.equal(sample(strict,0,240,{answer:false}),true);
  assert.equal(strict.info.acceptedBy,'strict');
  assert.equal(strict.info.maxAnswerRadiusPx,null);
  const jitter=new StabilityGate();
  for(let i=0;i<8;i++)assert.equal(sample(jitter,i%2?-3:3,i*150,{answer:false}),false);
  assert.equal(jitter.history.length,0);
});

test('strict acceptance still works with answer geometry, at 240ms and at 699ms',()=>{
  for(const gap of [240,699]){
    const gate=new StabilityGate();sample(gate,0,0);
    assert.equal(sample(gate,0,gap),true);
    assert.equal(gate.info.acceptedBy,'strict');
  }
});

test('fallback requires three observations over at least 240ms',()=>{
  const short=new StabilityGate();
  assert.equal(sample(short,3,0),false);
  assert.equal(sample(short,-3,100),false);
  assert.equal(sample(short,3,200),false);
  const two=new StabilityGate();
  assert.equal(sample(two,3,0),false);
  assert.equal(sample(two,-3,300),false);
  assert.equal(sample(two,3,600),true);
  assert.equal(two.info.acceptedBy,'bounded-noise');
});

test('pupil changes reset the bounded window and only later contiguous samples qualify',()=>{
  const gate=new StabilityGate();
  assert.equal(sample(gate,3,0),false);
  assert.equal(sample(gate,-3,150,{id:'S002'}),false);
  assert.equal(gate.info.reason,'pupil-changed');assert.equal(gate.info.samples,1);
  assert.equal(sample(gate,3,300),false);
  assert.equal(gate.info.samples,1);
  assert.equal(sample(gate,-3,450),false);
  assert.equal(sample(gate,3,600),true);
});

test('700ms gaps, duplicate timestamps and backwards timestamps start a fresh window',()=>{
  for(const invalidTime of [850,150,100]){
    const gate=new StabilityGate();sample(gate,3,0);sample(gate,-3,150);
    assert.equal(sample(gate,3,invalidTime),false);
    assert.equal(gate.info.samples,1);
    assert.equal(gate.info.reason,invalidTime===850?'sample-gap':'non-monotonic-time');
    assert.equal(sample(gate,-3,invalidTime+150),false);
    assert.equal(sample(gate,3,invalidTime+300),true);
  }
});

test('invalid input and explicit reset remove all temporal evidence',()=>{
  const gate=new StabilityGate();sample(gate,3,0);sample(gate,-3,150);
  assert.equal(sample(gate,3,NaN),false);
  assert.equal(gate.info.reason,'invalid-time');assert.equal(gate.info.samples,0);
  assert.equal(gate.last,null);assert.equal(gate.history.length,0);
  sample(gate,3,300);gate.reset();
  assert.equal(gate.info.reason,'reset');assert.equal(gate.info.samples,0);
  assert.equal(sample(gate,-3,450),false);
  assert.equal(gate.info.samples,1);
  assert.equal(gate.update('S001',null,600),false);
  assert.equal(gate.info.reason,'invalid-corners');
});

test('a missing answer observation breaks fallback continuity but preserves strict behavior',()=>{
  const gate=new StabilityGate();sample(gate,3,0);sample(gate,-3,150);
  assert.equal(sample(gate,3,300,{answer:false}),false);
  assert.equal(gate.history.length,0);
  assert.equal(sample(gate,-3,450),false);
  assert.equal(gate.info.samples,1);
  assert.equal(sample(gate,3,600),false);
  assert.equal(sample(gate,-3,750),true);
});

test('history stays bounded, diagnostics contain only scalar values, and inputs stay untouched',()=>{
  const gate=new StabilityGate(),corners=square(3),answer=answerCorners(corners);
  const before=JSON.stringify({corners,answer});
  gate.update('S001',corners,0,answer);
  assert.equal(JSON.stringify({corners,answer}),before);
  corners[0].x=9999;answer[0].x=9999;
  assert.notEqual(gate.last.corners[0].x,9999);
  assert.notEqual(gate.history[0].answer[0].x,9999);
  for(let i=1;i<20;i++)sample(gate,i%2?-3:3,i*150);
  assert.equal(gate.history.length,3);
  for(const value of Object.values(gate.info))assert.ok(value===null||['number','string'].includes(typeof value));
});

test('real QR worker accepts bounded translated synthetic frames and crops the current frame',async()=>{
  // Synthetic typeset fixture only; this is not real-camera or handwriting evidence.
  const original=PNG.sync.read(fs.readFileSync(new URL('../public/samples/synthetic-S001-A.png',import.meta.url)));
  const frame=shift=>{
    const width=720,height=1280,data=new Uint8ClampedArray(width*height*4).fill(255);
    for(let y=0;y<original.height/2;y++)for(let x=0;x<original.width/2;x++){
      const source=((y*2)*original.width+x*2)*4,target=((y+250)*width+x+30+shift)*4;
      for(let c=0;c<4;c++)data[target+c]=original.data[source+c];
    }
    return {width,height,data};
  };
  const source=fs.readFileSync(new URL('../src/scan-worker.js',import.meta.url),'utf8').replace(/importScripts\([^;]+;/,'').replace(/const geometry=import\([^;]+;/,'const geometry=Promise.resolve(geometryModule);');
  const self={jsQR,postMessage:message=>{self.last=message;}};
  vm.runInNewContext(source,{self,geometryModule,performance});
  for(const [i,shift] of [0,7,0].entries()){
    await self.onmessage({data:{id:i,image:frame(shift),time:i*150}});
    assert.equal(self.last.stage,i===2?'crop-ready':'stability');
  }
  assert.equal(self.last.gate.acceptedBy,'bounded-noise');
  const current=frame(0),qr=jsQR(current.data,current.width,current.height),l=qr.location;
  const corners=[l.topLeftCorner,l.topRightCorner,l.bottomRightCorner,l.bottomLeftCorner];
  const fit=geometryModule.checkGeometry(corners,current.width,current.height);
  assert.equal(fit.ok,true);
  const expected=geometryModule.warpAnswer(current,fit.h);
  assert.deepEqual(self.last.crop.data,expected.data,'saved pixels must use the latest raw frame and homography, never a temporal mean');
});
