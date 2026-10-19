// DOM lifecycle/accessibility tests. Real mobile viewport rendering still needs
// browser/device QA; these tests make no claims about camera hardware.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {createScanView} from '../src/scan-view.js';

function fixture({visualViewport=true}={}){
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/<script[\s\S]*?<\/script>/g,'');
 const dom=new JSDOM(html,{url:'http://localhost:4173',pretendToBeVisual:true}),win=dom.window,doc=win.document;
 const el=id=>doc.getElementById(id),scrollCalls=[];
 win.scrollTo=(...args)=>scrollCalls.push(args);
 Object.defineProperty(win,'scrollX',{configurable:true,value:11});Object.defineProperty(win,'scrollY',{configurable:true,value:527});
 const eventTarget=(properties={})=>{
  const target=new win.EventTarget(),listeners=new Map();Object.assign(target,properties);
  const add=target.addEventListener.bind(target),remove=target.removeEventListener.bind(target);
  target.addEventListener=(type,handler,options)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(handler);add(type,handler,options);};
  target.removeEventListener=(type,handler,options)=>{listeners.get(type)?.delete(handler);remove(type,handler,options);};
  target.listenerCount=()=>[...listeners.values()].reduce((total,set)=>total+set.size,0);
  return target;
 };
 const viewport=visualViewport?eventTarget({width:390,height:720,offsetTop:2,offsetLeft:3}):null;
 Object.defineProperty(win,'visualViewport',{configurable:true,value:viewport});
 const orientation=eventTarget();Object.defineProperty(win.screen,'orientation',{configurable:true,value:orientation});
 const controller=createScanView(win);
 const ready=()=>{el('startCamera').focus();el('cameraPlaceholder').hidden=true;el('stopCamera').hidden=false;};
 const stop=()=>{el('cameraPlaceholder').hidden=false;el('stopCamera').hidden=true;controller.exit();};
 return {dom,win,doc,el,controller,viewport,orientation,scrollCalls,ready,stop,close:()=>win.close()};
}

test('scan mode keeps existing media nodes, leaves tracks alone, and exposes only the scan branch',()=>{
 const f=fixture();try{
  const video=f.el('video'),canvas=f.el('overlay'),videoParent=video.parentElement,canvasParent=canvas.parentElement;
  let mediaCalls=0;f.win.navigator.mediaDevices={getUserMedia(){mediaCalls++;throw new Error('Scan view must not request media');}};
  const liveStream={getTracks(){throw new Error('Scan view must not manage tracks');}};video.srcObject=liveStream;
  f.ready();f.controller.enter();
  assert.equal(f.controller.active,true);assert.equal(f.doc.documentElement.classList.contains('scan-view-active'),true);
  assert.equal(f.el('video'),video);assert.equal(f.el('overlay'),canvas);assert.equal(video.parentElement,videoParent);assert.equal(canvas.parentElement,canvasParent);assert.equal(video.srcObject,liveStream);assert.equal(mediaCalls,0);
  assert.equal(f.doc.activeElement,f.el('stopCamera'));assert.equal(f.el('stopCamera').textContent,'Exit scanner');assert.equal(f.el('stopCamera').closest('[inert]'),null);
  assert.equal(f.el('cameraShell').getAttribute('aria-modal'),'true');assert.equal(f.el('cameraShell').getAttribute('role'),'dialog');
  for(const id of ['sessionSelect','questionSelect','newQuestion','photoInput','sampleToggle','reviewPanel','resultsPanel','cropViewer','scanTiming'])assert.ok(f.el(id).closest('[inert][aria-hidden="true"]'),id+' must be outside scan access');
  assert.equal(f.doc.querySelector('.topbar').hasAttribute('inert'),true);
  assert.equal(f.el('scanCaptureCount').closest('[inert]'),null);assert.equal(f.el('feedbackText').closest('[inert]'),null);
  f.stop();assert.equal(f.controller.active,false);assert.equal(f.el('video'),video);assert.equal(video.srcObject,liveStream);
 }finally{f.close();}
});

test('exit restores focus, scroll, styles and exact pre-existing accessibility attributes',()=>{
 const f=fixture();try{
  const body=f.doc.body,shell=f.el('cameraShell'),header=f.doc.querySelector('.topbar'),review=f.el('reviewPanel');
  body.style.setProperty('position','relative','important');body.style.setProperty('top','4px');body.style.setProperty('left','5px');body.style.setProperty('width','97%');body.style.setProperty('overflow','auto');body.style.setProperty('overscroll-behavior','contain');
  shell.setAttribute('role','region');shell.setAttribute('aria-label','Camera preview');shell.setAttribute('tabindex','0');shell.style.setProperty('--scan-view-height','99px','important');
  const originalViewportPriority=shell.style.getPropertyPriority('--scan-view-height');
  header.setAttribute('aria-hidden','false');header.setAttribute('data-scan-view-suppressed','prior');review.setAttribute('inert','existing');review.setAttribute('aria-hidden','true');
  f.doc.documentElement.style.scrollBehavior='smooth';
  f.ready();f.controller.enter();assert.equal(body.style.position,'fixed');assert.equal(body.style.top,'-527px');assert.equal(body.style.left,'-11px');
  f.stop();
  assert.equal(f.doc.activeElement,f.el('startCamera'));assert.deepEqual(f.scrollCalls,[[11,527]]);assert.equal(f.doc.documentElement.style.scrollBehavior,'smooth');
  assert.equal(body.style.position,'relative');assert.equal(body.style.getPropertyPriority('position'),'important');assert.equal(body.style.top,'4px');assert.equal(body.style.left,'5px');assert.equal(body.style.width,'97%');assert.equal(body.style.overflow,'auto');assert.equal(body.style.overscrollBehavior,'contain');
  assert.equal(shell.getAttribute('role'),'region');assert.equal(shell.getAttribute('aria-label'),'Camera preview');assert.equal(shell.getAttribute('tabindex'),'0');assert.equal(shell.hasAttribute('aria-modal'),false);assert.equal(shell.style.getPropertyValue('--scan-view-height'),'99px');assert.equal(shell.style.getPropertyPriority('--scan-view-height'),originalViewportPriority);assert.equal(shell.style.getPropertyValue('--scan-view-width'),'');
  assert.equal(header.getAttribute('aria-hidden'),'false');assert.equal(header.getAttribute('data-scan-view-suppressed'),'prior');assert.equal(header.hasAttribute('inert'),false);assert.equal(review.getAttribute('inert'),'existing');assert.equal(review.getAttribute('aria-hidden'),'true');assert.equal(f.el('sessionSelect').closest('[inert]'),null);
 }finally{f.close();}
});

test('visual viewport scroll/resize and orientation update the shared camera box and clean up on exit',()=>{
 const f=fixture();try{
  const style=f.el('cameraShell').style;
  f.ready();f.controller.enter();assert.equal(style.getPropertyValue('--scan-view-width'),'390px');assert.equal(style.getPropertyValue('--scan-view-height'),'720px');assert.equal(style.getPropertyValue('--scan-view-top'),'2px');assert.equal(style.getPropertyValue('--scan-view-left'),'3px');assert.equal(f.viewport.listenerCount(),2);assert.equal(f.orientation.listenerCount(),1);
  Object.assign(f.viewport,{height:640,offsetTop:25,offsetLeft:0});f.viewport.dispatchEvent(new f.win.Event('resize'));assert.equal(style.getPropertyValue('--scan-view-height'),'640px');assert.equal(style.getPropertyValue('--scan-view-top'),'25px');
  f.viewport.offsetTop=47;f.viewport.dispatchEvent(new f.win.Event('scroll'));assert.equal(style.getPropertyValue('--scan-view-top'),'47px');
  Object.assign(f.viewport,{width:844,height:390});f.win.dispatchEvent(new f.win.Event('orientationchange'));assert.equal(style.getPropertyValue('--scan-view-width'),'844px');assert.equal(style.getPropertyValue('--scan-view-height'),'390px');
  f.viewport.width=810;f.orientation.dispatchEvent(new f.win.Event('change'));assert.equal(style.getPropertyValue('--scan-view-width'),'810px');
  f.controller.enter();assert.equal(f.viewport.listenerCount(),2,'reentry must not duplicate listeners');
  f.stop();assert.equal(f.viewport.listenerCount(),0);assert.equal(f.orientation.listenerCount(),0);
  f.viewport.height=300;f.viewport.dispatchEvent(new f.win.Event('resize'));f.viewport.dispatchEvent(new f.win.Event('scroll'));f.win.dispatchEvent(new f.win.Event('resize'));f.win.dispatchEvent(new f.win.Event('orientationchange'));f.orientation.dispatchEvent(new f.win.Event('change'));assert.equal(style.getPropertyValue('--scan-view-height'),'');
  f.controller.exit();assert.deepEqual(f.scrollCalls,[[11,527]],'repeated exit must be a no-op');
  f.ready();f.controller.enter();assert.equal(style.getPropertyValue('--scan-view-height'),'300px');f.stop();assert.equal(f.viewport.listenerCount(),0);assert.equal(f.orientation.listenerCount(),0);
 }finally{f.close();}
});

test('without visualViewport the scan view follows window resize',()=>{
 const f=fixture({visualViewport:false});try{
  f.ready();f.controller.enter();const style=f.el('cameraShell').style;
  assert.equal(style.getPropertyValue('--scan-view-height'),f.win.innerHeight+'px');assert.equal(style.getPropertyValue('--scan-view-top'),'0px');
  f.win.innerWidth=812;f.win.innerHeight=375;f.win.dispatchEvent(new f.win.Event('resize'));assert.equal(style.getPropertyValue('--scan-view-width'),'812px');assert.equal(style.getPropertyValue('--scan-view-height'),'375px');f.stop();
 }finally{f.close();}
});

test('keyboard and programmatic focus stay in the scan view, while Escape uses the app stop handler',()=>{
 const f=fixture();try{
  let stops=0;f.el('stopCamera').onclick=()=>{stops++;f.stop();};f.ready();f.controller.enter();
  const tab=new f.win.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true,shiftKey:true});f.doc.dispatchEvent(tab);assert.equal(tab.defaultPrevented,true);assert.equal(f.doc.activeElement,f.el('stopCamera'));
  f.el('newQuestion').focus();assert.equal(f.doc.activeElement,f.el('stopCamera'));
  const escape=new f.win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});f.doc.dispatchEvent(escape);assert.equal(stops,1);assert.equal(f.controller.active,false);assert.equal(f.doc.activeElement,f.el('startCamera'));
  f.el('newQuestion').focus();assert.equal(f.doc.activeElement,f.el('newQuestion'),'focus listener must be removed');f.doc.dispatchEvent(new f.win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(stops,1);
 }finally{f.close();}
});

test('focus safely falls back to Start if the original trigger was removed',()=>{
 const f=fixture();try{
  const trigger=f.doc.createElement('button');f.doc.body.append(trigger);trigger.focus();f.el('cameraPlaceholder').hidden=true;f.el('stopCamera').hidden=false;f.controller.enter();trigger.remove();f.stop();assert.equal(f.doc.activeElement,f.el('startCamera'));
 }finally{f.close();}
});

test('stylesheet preserves matching contain geometry and supports viewport/safe-area fallbacks',()=>{
 const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(css,/\.scan-view-active #cameraShell video,\.scan-view-active #cameraShell canvas\{[^}]*inset:0;[^}]*width:100%;height:100%;object-fit:contain/);
 assert.match(css,/height:var\(--scan-view-height,100vh\)/);assert.match(css,/@supports\(height:100dvh\)/);
 for(const inset of ['top','left','right','bottom'])assert.ok(css.includes('env(safe-area-inset-'+inset+')'));
 assert.doesNotMatch(fs.readFileSync(new URL('../src/scan-view.js',import.meta.url),'utf8'),/\.requestFullscreen\s*\(/);
});
