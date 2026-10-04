import * as THREE from '../vendor/three/build/three.module.js';
import { GLTFLoader } from '../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { Player } from './player3d.js';
import { Interaction } from './interaction3d.js';
import { observeMission, requestTool } from './labbridge.js';
import { batchStatic } from './batch3d.js';

const $ = id => document.getElementById(id);
const VIEW_KEY = 'security-lab-view';
let renderer, scene, camera, model, player, interaction, ready=false, mode='2d', toolsOpen=false;
let generation=0, controller, previousTime=0, frames=0, frameMs=0, fps=0, noticeTimer;
let mission=null, currentTab='terminal';
const materials = new Set(), geometries = new Set(), textures = new Set();

function savedView() { try { return localStorage.getItem(VIEW_KEY); } catch { return null; } }
function saveView(value) { try { localStorage.setItem(VIEW_KEY,value); } catch { /* Optional view preference only. */ } }
function message(title,text) { $('scene-title').textContent=title; $('scene-message').textContent=text; }
function clearResources(root) {
  if (!root) return;
  root.traverse(object=>{
    if(object.geometry) geometries.add(object.geometry);
    for(const mat of (Array.isArray(object.material)?object.material:[object.material])) if(mat) materials.add(mat);
  });
  for(const mat of materials) {
    for(const value of Object.values(mat)) if(value?.isTexture) textures.add(value);
    mat.dispose();
  }
  for(const tex of textures) { tex.source?.data?.close?.(); tex.dispose(); }
  for(const geometry of geometries) geometry.dispose();
  textures.clear(); materials.clear(); geometries.clear();
}
function setMode(value) {
  mode=value; saveView(value);
  const address=new URL(location.href); address.searchParams.set('view',value); history.replaceState(null,'',address);
  document.body.classList.toggle('lab-3d',value==='3d');
  $('lab-world').hidden=value!=='3d'; $('tool-toolbar').hidden=true;
  $('lab-tools').hidden=value==='3d'; toolsOpen=false;
  $('lab-tools').removeAttribute('role'); $('lab-tools').removeAttribute('aria-modal');
  $('lab-tools').inert=false;
  $('view-switch').textContent=value==='3d'?'2D 도구 화면':'3D 실습실';
  if(value!=='3d') { player?.controls.unlock(); player?.clear(); controller?.abort(); generation++; }
  else { $('scene-cover').hidden=false; pauseMessage(); if(!ready) void loadModel(); }
}
function pauseMessage() {
  if(!ready) return;
  message('실습실을 탐색하세요.','장비 가까이에서 E를 누르면 조사 도구가 열립니다. 단서를 모으고, 방어한 뒤, 정상 기능을 재검증하세요.');
  $('scene-progress').hidden=true; $('scene-start').hidden=false; $('scene-retry').hidden=true;
}
function resize() {
  if(!renderer) return;
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight,false);
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));
}
async function readModel(signal) {
  // This fixed local URL never contains game commands or user-provided addresses.
  const response=await fetch('assets/models/security_lab.glb',{signal});
  if(!response.ok) throw new Error('모델 파일을 읽을 수 없습니다.');
  const total=Number(response.headers.get('Content-Length'))||0;
  if(total>32*1024*1024) throw new Error('모델 파일 크기가 제한을 초과했습니다.');
  const reader=response.body.getReader(), chunks=[];
  let received=0;
  while(true) {
    const {done,value}=await reader.read(); if(done) break;
    received+=value.byteLength;
    if(received>32*1024*1024) { await reader.cancel(); throw new Error('모델 파일 크기가 제한을 초과했습니다.'); }
    chunks.push(value); $('scene-progress').value=total?Math.min(80,received/total*80):25;
    $('scene-message').textContent=`실습실을 불러오는 중 · ${(received/1024/1024).toFixed(1)} MB`;
  }
  const buffer=new Uint8Array(received); let offset=0;
  for(const chunk of chunks) {buffer.set(chunk,offset);offset+=chunk.byteLength;}
  return buffer.buffer;
}
async function loadModel() {
  controller?.abort(); const token=++generation;
  controller=new AbortController(); const transaction=controller, signal=transaction.signal;
  player?.controls.unlock(); player?.clear();
  ready=false; $('lab-world').dataset.state='loading'; $('scene-cover').hidden=false;
  message('실습실 준비 중','공간과 조사 장비를 불러오고 있습니다.');
  $('scene-progress').hidden=false; $('scene-progress').value=0;
  $('scene-start').hidden=true; $('scene-retry').hidden=true;
  let timer;
  try {
    if(!renderer) {
      renderer=new THREE.WebGLRenderer({canvas:$('lab-canvas'),antialias:true,alpha:false,powerPreference:'high-performance'});
      renderer.outputColorSpace=THREE.SRGBColorSpace;
      renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.2;
      renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFShadowMap;
      scene=new THREE.Scene(); scene.background=new THREE.Color('#20333e');
      camera=new THREE.PerspectiveCamera(70,innerWidth/innerHeight,.05,70);
      scene.add(new THREE.HemisphereLight(0xd3e8f5,0x65737b,2.0));
      scene.add(new THREE.AmbientLight(0xd8e3ed,1.1));
      const light=new THREE.DirectionalLight(0xffeed8,2.5);
      light.position.set(-6,3.1,5); light.target.position.set(0,0,0);
      light.castShadow=true; light.shadow.mapSize.set(1024,1024);
      Object.assign(light.shadow.camera,{left:-15,right:15,top:15,bottom:-15,near:.1,far:40});
      light.shadow.bias=-.002; light.shadow.normalBias=.045; scene.add(light,light.target);
      resize(); window.addEventListener('resize',resize);
      $('lab-canvas').addEventListener('webglcontextlost',event=>{
        event.preventDefault(); ready=false; player?.controls.unlock(); $('scene-cover').hidden=false;
        message('3D 화면이 중단되었습니다.','다시 불러오거나 2D 도구 화면에서 이어서 플레이하세요.');
        $('scene-retry').hidden=false; $('scene-start').hidden=true;
      });
      $('lab-canvas').addEventListener('webglcontextrestored',()=>void loadModel());
    }
    const gltf=await Promise.race([
      (async()=>{
        const bytes=await readModel(signal); $('scene-progress').value=85;
        $('scene-message').textContent='장비와 충돌 경계를 준비하고 있습니다.';
        const loaded=await new GLTFLoader().parseAsync(bytes,new URL('assets/models/',location.href).href);
        if(signal.aborted || token!==generation) clearResources(loaded.scene);
        return loaded;
      })(),
      new Promise((_,reject)=> {timer=setTimeout(()=>{transaction.abort();reject(new Error('준비 시간이 초과되었습니다.'));},20000);}),
    ]);
    if(token!==generation || signal.aborted || mode!=='3d') {clearResources(gltf.scene);return;}
    player?.dispose(); if(model) {scene.remove(model); clearResources(model);}
    model=gltf.scene; model.updateMatrixWorld(true);
    const boxes=[];
    model.traverse(object=>{
      if(object.name.startsWith('COLLIDER_')) {boxes.push(new THREE.Box3().setFromObject(object));object.visible=false;}
      if(object.isMesh && !object.name.startsWith('COLLIDER_')) {
        object.castShadow=/(Desk|Chair|Workstation|ServerRack|FileCabinet|Router|DOOR_)/.test(object.name) && !object.name.includes('Glass');
        object.receiveShadow=true;
        for(const mat of (Array.isArray(object.material)?object.material:[object.material])) {
          if(mat.map) mat.map.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
        }
      }
    });
    batchStatic(model);
    const spawnObject=model.getObjectByName('SPAWN_Player');
    const spawn=spawnObject.getWorldPosition(new THREE.Vector3());
    scene.add(model); player=new Player(camera,$('lab-canvas'),boxes,spawn);
    interaction=new Interaction(model,camera,player,openTool);
    player.controls.addEventListener('lock',()=>{
      if(toolsOpen || mode!=='3d') {player.controls.unlock();return;}
      $('scene-cover').hidden=true; $('crosshair').hidden=false; previousTime=performance.now();
    });
    player.controls.addEventListener('unlock',()=>{
      $('crosshair').hidden=true; $('interaction-prompt').hidden=true;
      if(mode==='3d' && !toolsOpen) {$('scene-cover').hidden=false;pauseMessage();}
    });
    ready=true; $('lab-world').dataset.state='ready'; $('scene-progress').value=100; pauseMessage();
  } catch(error) {
    if(token!==generation || mode!=='3d') return;
    $('lab-world').dataset.state='error';
    message('실습실을 열지 못했습니다.',`${error.message} 다시 시도하거나 2D 도구 화면에서 계속할 수 있습니다.`);
    $('scene-progress').hidden=true; $('scene-retry').hidden=false; $('scene-start').hidden=true;
    console.warn('Security Lab 3D unavailable:',error.message);
  } finally {clearTimeout(timer);}
}
function openTool(kind,label='조사 노트') {
  if(mode!=='3d') return;
  toolsOpen=true; player?.controls.unlock(); player?.clear();
  $('scene-cover').hidden=true; $('lab-tools').hidden=false; $('tool-toolbar').hidden=false;
  $('lab-tools').setAttribute('role','dialog'); $('lab-tools').setAttribute('aria-modal','true');
  $('lab-tools').setAttribute('aria-label',label); $('tool-source').textContent=label;
  $('lab-world').inert=true; $('view-switch').disabled=true;
  currentTab=kind==='admin' ? (mission?.id==='tutorial'?'terminal':'settings') : kind;
  requestTool(currentTab);
  $('lab-tools').scrollTop=0;
  if(kind==='brief') {$('hint-copy').scrollIntoView({block:'center'}); $('hint').focus();}
  else if(currentTab==='terminal') $('command').focus();
  else $('tool-close').focus();
}
function nativeDialogOpen() { return Boolean(document.querySelector('dialog[open]')); }
function closeTool() {
  if(!toolsOpen || nativeDialogOpen()) return;
  toolsOpen=false; $('lab-tools').hidden=true; $('lab-world').inert=false; $('view-switch').disabled=false;
  $('scene-cover').hidden=false; pauseMessage(); $('scene-start').focus();
}
function lock() {
  if(!ready || toolsOpen || mode!=='3d') return;
  player.controls.lock();
}
function animate(time) {
  requestAnimationFrame(animate);
  const elapsed=previousTime ? time-previousTime:0;
  const dt=Math.min(elapsed/1000,.1); previousTime=time;
  if(mode!=='3d' || document.hidden || !renderer || !ready) return;
  if(toolsOpen) return; // The frozen scene remains behind the tools without GPU work.
  if(!toolsOpen) {
    interaction.update(dt);
    player.update(dt,interaction.boxes);
  }
  const prompt=player.controls.isLocked?interaction.prompt():'';
  $('interaction-prompt').textContent=prompt; $('interaction-prompt').hidden=!prompt;
  $('crosshair').classList.toggle('target',Boolean(prompt));
  renderer.render(scene,camera);
  frameMs+=elapsed; frames++;
  if(frameMs>=1000) {fps=Math.round(frames*1000/frameMs);frameMs=0;frames=0;}
}
export function get3DDiagnostics() {
  const direction=camera?.getWorldDirection(new THREE.Vector3());
  return {mode,ready,toolsOpen,pointerLocked:player?.controls.isLocked??false,tab:currentTab,
    position:camera?.position.toArray(),rotation:camera?.rotation.toArray().slice(0,3),
    yaw:direction?Math.atan2(-direction.x,-direction.z):0,pitch:direction?Math.asin(direction.y):0,
    target:interaction?.target?.name??null,doors:interaction?.doors.map(d=>({name:d.object.name,angle:d.angle,target:d.target,pivot:d.object.position.toArray()}))??[],
    colliders:player?.boxes.length??0,drawCalls:renderer?.info.render.calls??0,triangles:renderer?.info.render.triangles??0,fps,
    renderer:renderer?renderer.getContext().getParameter(renderer.getContext().VERSION):null};
}
export function init3D() {
  if(getComputedStyle(document.documentElement).getPropertyValue('--scene-styles-ready').trim()!=='1') throw new Error('3D 화면 스타일을 불러오지 못했습니다.');
  observeMission(status=>{
    mission=status; $('hud-title').textContent=status.title; $('hud-objective').textContent=status.objective;
    $('hud-stage').textContent=`${status.stage} · 단서 ${status.clues}개 · ${status.score}/100`;
    $('hud-mission').textContent=status.id==='tutorial'?'CASE 001 / 조사 준비':`CASE 001 / MISSION ${String(status.active).padStart(2,'0')}`;
  });
  $('scene-start').addEventListener('click',lock); $('lab-canvas').addEventListener('click',lock);
  $('scene-retry').addEventListener('click',()=>void loadModel());
  $('scene-fallback').addEventListener('click',()=>setMode('2d'));
  $('view-switch').addEventListener('click',()=>setMode(mode==='3d'?'2d':'3d'));
  $('world-2d').addEventListener('click',()=>setMode('2d'));
  $('world-notes').addEventListener('click',()=>openTool('brief','조사 노트 / 현재 미션'));
  $('world-reset').addEventListener('click',()=>{
    player?.reset(); $('scene-cover').hidden=false; player?.controls.unlock(); pauseMessage();
    clearTimeout(noticeTimer); $('world-location').textContent='출입구로 돌아왔습니다. 미션 진행은 유지됩니다.';
    noticeTimer=setTimeout(()=>{$('world-location').textContent='SECURITY OPERATIONS / TRAINING FACILITY';},3000);
  });
  $('tool-close').addEventListener('click',closeTool);
  document.addEventListener('keydown',event=>{
    if(event.code==='KeyE' && !event.repeat && player?.controls.isLocked && !toolsOpen) {event.preventDefault(); interaction.interact();}
    if(event.code==='Escape' && player?.controls.isLocked && !toolsOpen) {event.preventDefault();player.controls.unlock();}
    if(event.code==='Escape' && toolsOpen && !nativeDialogOpen()) {event.preventDefault();closeTool();}
    if(event.code==='Tab' && toolsOpen && !nativeDialogOpen()) {
      const available=[...$('lab-tools').querySelectorAll('button,input,select,a[href]')].filter(e=>!e.disabled && e.tabIndex>=0 && e.getClientRects().length);
      const first=available[0],last=available.at(-1);
      if(event.shiftKey && document.activeElement===first) {event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last) {event.preventDefault();first?.focus();}
    }
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden) {player?.controls.unlock();player?.clear();} previousTime=0;});
  document.addEventListener('pointerlockerror',()=>{
    message('마우스 잠금을 허용해주세요.','화면의 탐색 시작을 다시 누르세요. 마우스 잠금을 사용할 수 없다면 2D 도구 화면에서 플레이할 수 있습니다.');
  });
  const query=new URLSearchParams(location.search).get('view');
  const mobile=matchMedia('(pointer: coarse)').matches;
  setMode(query==='2d' || (query!=='3d' && (savedView()==='2d' || mobile))?'2d':'3d');
  requestAnimationFrame(animate);
}
