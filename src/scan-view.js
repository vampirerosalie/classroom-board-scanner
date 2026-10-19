/**
 * A viewport-filling scan surface, without moving media nodes or using the
 * browser Fullscreen API. The app owns camera permissions, tracks and status.
 */
export function createScanView(env=globalThis){
 const win=env.window||env,doc=env.document||win.document;
 const shell=doc.getElementById('cameraShell'),exitButton=doc.getElementById('stopCamera'),startButton=doc.getElementById('startCamera');
 if(!shell||!exitButton)throw new Error('The camera scan view is missing its controls.');
 const root=doc.documentElement,body=doc.body;
 const viewportProperties=['--scan-view-width','--scan-view-height','--scan-view-top','--scan-view-left'];
 const bodyProperties=['position','top','left','width','overflow','overscroll-behavior'];
 let active=false,previousFocus=null,scrollPosition=null,bodyStyle=null,viewportStyle=null,shellAttributes=null,suppressed=[],viewport=null,orientation=null,hadActiveClass=false;
 const readStyles=(node,names)=>names.map(name=>[name,node.style.getPropertyValue(name),node.style.getPropertyPriority(name)]);
 const restoreStyles=(node,styles)=>styles.forEach(([name,value,priority])=>value?node.style.setProperty(name,value,priority):node.style.removeProperty(name));
 const readAttributes=(node,names)=>names.map(name=>[name,node.getAttribute(name)]);
 const restoreAttributes=(node,attributes)=>attributes.forEach(([name,value])=>value===null?node.removeAttribute(name):node.setAttribute(name,value));
 const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
 function syncViewport(){
  if(!active)return;
  const width=viewport?.width>0?viewport.width:win.innerWidth;
  const height=viewport?.height>0?viewport.height:win.innerHeight;
  if(width>0)shell.style.setProperty('--scan-view-width',width+'px');
  if(height>0)shell.style.setProperty('--scan-view-height',height+'px');
  shell.style.setProperty('--scan-view-top',Math.max(0,finite(viewport?.offsetTop,0))+'px');
  shell.style.setProperty('--scan-view-left',Math.max(0,finite(viewport?.offsetLeft,0))+'px');
 }
 function focusExit(){
  const target=!exitButton.hidden&&!exitButton.disabled?exitButton:shell;
  target.focus({preventScroll:true});
 }
 function onFocus(event){if(active&&!shell.contains(event.target))focusExit();}
 function onKey(event){
  if(!active)return;
  if(event.key==='Escape'){
   event.preventDefault();
   // The app's existing Stop handler must release tracks before leaving.
   if(!exitButton.hidden&&!exitButton.disabled)exitButton.click();
  }else if(event.key==='Tab'){
   // Scanning has one action; the dashboard and review are outside this view.
   event.preventDefault();focusExit();
  }
 }
 function enter(){
  if(active){syncViewport();return;}
  active=true;
  previousFocus=doc.activeElement;
  scrollPosition={x:finite(win.scrollX,0),y:finite(win.scrollY,0)};
  bodyStyle=readStyles(body,bodyProperties);
  viewportStyle=readStyles(shell,viewportProperties);
  shellAttributes=readAttributes(shell,['role','aria-modal','aria-label','tabindex']);
  hadActiveClass=root.classList.contains('scan-view-active');
  root.classList.add('scan-view-active');
  shell.setAttribute('role','dialog');shell.setAttribute('aria-modal','true');shell.setAttribute('aria-label','Live board scanner');shell.setAttribute('tabindex','-1');
  body.style.setProperty('position','fixed');body.style.setProperty('top',-scrollPosition.y+'px');body.style.setProperty('left',-scrollPosition.x+'px');body.style.setProperty('width','100%');body.style.setProperty('overflow','hidden');body.style.setProperty('overscroll-behavior','none');
  // Focus first so no currently focused dashboard control is aria-hidden.
  focusExit();
  // Suppress sibling branches along the path, never the camera's ancestors.
  // Keep their original inert/ARIA values so exit is fully reversible.
  suppressed=[];
  for(let branch=shell;branch&&branch!==body;branch=branch.parentElement){
   for(const sibling of branch.parentElement?.children||[]){
    if(sibling===branch||/^(SCRIPT|STYLE|LINK)$/.test(sibling.tagName))continue;
    suppressed.push([sibling,readAttributes(sibling,['inert','aria-hidden','data-scan-view-suppressed'])]);
    sibling.setAttribute('inert','');sibling.setAttribute('aria-hidden','true');sibling.setAttribute('data-scan-view-suppressed','');
   }
  }
  viewport=win.visualViewport||null;orientation=win.screen?.orientation||null;
  viewport?.addEventListener?.('resize',syncViewport);viewport?.addEventListener?.('scroll',syncViewport);
  win.addEventListener('resize',syncViewport);win.addEventListener('orientationchange',syncViewport);orientation?.addEventListener?.('change',syncViewport);
  doc.addEventListener('keydown',onKey,true);doc.addEventListener('focusin',onFocus,true);
  syncViewport();
 }
 function exit(){
  if(!active)return;
  active=false;
  viewport?.removeEventListener?.('resize',syncViewport);viewport?.removeEventListener?.('scroll',syncViewport);
  win.removeEventListener('resize',syncViewport);win.removeEventListener('orientationchange',syncViewport);orientation?.removeEventListener?.('change',syncViewport);
  doc.removeEventListener('keydown',onKey,true);doc.removeEventListener('focusin',onFocus,true);
  suppressed.forEach(([node,attributes])=>restoreAttributes(node,attributes));suppressed=[];
  restoreAttributes(shell,shellAttributes);restoreStyles(shell,viewportStyle);restoreStyles(body,bodyStyle);
  if(!hadActiveClass)root.classList.remove('scan-view-active');
  const canFocus=node=>node?.isConnected&&!node.disabled&&!node.closest('[hidden],[inert],[aria-hidden="true"]')&&typeof node.focus==='function';
  const returnTarget=previousFocus!==body&&previousFocus!==root&&canFocus(previousFocus)?previousFocus:canFocus(startButton)?startButton:null;
  returnTarget?.focus({preventScroll:true});
  // Disable smooth scrolling only for restoring the exact pre-scan position.
  const scrollStyle=readStyles(root,['scroll-behavior']);root.style.setProperty('scroll-behavior','auto');
  win.scrollTo?.(scrollPosition.x,scrollPosition.y);restoreStyles(root,scrollStyle);
  viewport=null;orientation=null;previousFocus=null;scrollPosition=null;
 }
 return {enter,exit,get active(){return active;}};
}
