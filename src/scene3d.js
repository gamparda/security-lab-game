import * as THREE from '../vendor/three/build/three.module.js';
import { GLTFLoader } from '../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from '../vendor/three/examples/jsm/environments/RoomEnvironment.js';
import { Player } from './player3d.js';
import { Interaction } from './interaction3d.js';
import { observeMission, requestTool } from '/src/labbridge.js';
import { batchStatic, isSoftwareRenderer } from './batch3d.js';
import { createCity, refineGlass, restoreCityEnvironment, CITY_SUN } from './city3d.js';
import { prepareVisibility } from './visibility3d.js';
import { Upscaler, RENDER_PRESETS } from './upscale3d.js';

const $ = id => document.getElementById(id);
const PREPARATION_TIMEOUT = 60000;
const MAX_MODEL_BYTES = 256 * 1024 * 1024;
let renderer, graphicsContext, scene, camera, model, player, interaction;
let ready = false, firstFrameReady = false, contextLost = false, mode = '2d', toolsOpen = false;
let initialized = false, generation = 0, preparation, previousTime = 0, renderedFrames = 0;
let frames = 0, frameMs = 0, fps = 0, noticeTimer, mission = null, currentTab = 'terminal', toolOpener;
let softwareRenderer = false, redraw = true, environmentTarget;
let city, visibility, upscaler, preset='quality', optimization=true, debug=false, gpuName=null;
let loadStarted=0, loadTimeMs=0, glbLoadMs=0, renderTimeMs=0, averageFrameMs=0;

function message(title, text) {
  $('scene-title').textContent = title;
  $('scene-message').textContent = text;
}
function aborted() { return new DOMException('3D preparation cancelled', 'AbortError'); }
function healthyContext() { return Boolean(graphicsContext && !contextLost && !graphicsContext.isContextLost()); }
function checkAttempt(token, signal) {
  if (signal.aborted || token !== generation || mode !== '3d') throw signal.reason instanceof Error ? signal.reason : aborted();
}
function clearResources(root) {
  if (!root) return;
  const materials = new Set(), geometries = new Set(), textures = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) { texture.source?.data?.close?.(); texture.dispose(); }
  for (const geometry of geometries) geometry.dispose();
}
function stopInput() {
  player?.controls.unlock();
  player?.clear();
  $('crosshair').hidden = true;
  $('interaction-prompt').hidden = true;
  previousTime = 0;
}
function resetToolModal() {
  toolsOpen = false;
  $('tool-toolbar').hidden = true;
  for (const attribute of ['role', 'aria-modal', 'aria-label', 'aria-busy']) $('lab-tools').removeAttribute(attribute);
  $('lab-tools').inert = false;
  $('lab-world').inert = false;
  $('view-switch').disabled = false;
  $('tool-close').disabled = false;
  toolOpener = null;
}
function showError(error) {
  ready = false;
  firstFrameReady = false;
  stopInput();
  resetToolModal();
  $('lab-tools').hidden = mode === '3d';
  $('lab-world').dataset.state = 'error';
  $('lab-world').setAttribute('aria-busy', 'false');
  $('scene-cover').hidden = false;
  message('실습실을 열지 못했습니다.', `${error?.message || error} 다시 시도하거나 2D 도구 화면에서 계속할 수 있습니다.`);
  $('scene-progress').hidden = true;
  $('scene-retry').hidden = false;
  $('scene-start').hidden = true;
}
// The lightweight entry owns the graph/CSS deadline and can cancel late work.
export function cancelPreparation(error = new Error('준비 시간이 초과되었습니다.')) {
  generation++;
  preparation?.controller.abort(error);
  preparation = undefined;
  if (mode === '3d') showError(error);
  else { ready = false; firstFrameReady = false; stopInput(); resetToolModal(); }
}
export function setMode(value) {
  if (value !== '2d' && value !== '3d') throw new Error('지원하지 않는 보기입니다.');
  mode = value;
  stopInput();
  resetToolModal();
  document.body.classList.toggle('lab-3d', value === '3d');
  $('lab-world').hidden = value !== '3d';
  $('lab-tools').hidden = value === '3d';
  $('view-switch').textContent = value === '3d' ? '2D 도구 화면' : '3D 실습실';
  if (value === '2d') {
    generation++;
    preparation?.controller.abort(aborted());
    preparation = undefined;
    $('lab-world').setAttribute('aria-busy', 'false');
    clearTimeout(noticeTimer);
    return Promise.resolve();
  }
  $('scene-cover').hidden = false;
  if (ready && healthyContext()) {
    resize();
    pauseMessage();
    return Promise.resolve();
  }
  if (preparation) return preparation.promise;
  return loadModel();
}
function pauseMessage() {
  if (!ready || !healthyContext()) return;
  message('실습실을 탐색하세요.', '장비 가까이에서 E를 누르면 조사 도구가 열립니다. 단서를 모으고, 방어한 뒤, 정상 기능을 재검증하세요.');
  $('scene-progress').hidden = true;
  $('scene-start').hidden = false;
  $('scene-retry').hidden = true;
}
function resize() {
  if (!renderer || !camera) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight, false);
  upscaler?.resize(innerWidth,innerHeight,RENDER_PRESETS[preset]);
  redraw = true;
}
async function waitForContext(token, signal) {
  checkAttempt(token, signal);
  if (healthyContext()) return;
  await new Promise((resolve, reject) => {
    const canvas = $('lab-canvas');
    const cleanup = () => {
      canvas.removeEventListener('webglcontextrestored', restored);
      signal.removeEventListener('abort', cancelled);
    };
    const cancelled = () => { cleanup(); reject(signal.reason instanceof Error ? signal.reason : aborted()); };
    const restored = () => {
      // Three.js rebuilds its context state in the same event dispatch.
      queueMicrotask(() => {
        if (!healthyContext()) return;
        cleanup(); resolve();
      });
    };
    canvas.addEventListener('webglcontextrestored', restored);
    signal.addEventListener('abort', cancelled, { once: true });
    if (signal.aborted) cancelled();
    else if (healthyContext()) { cleanup(); resolve(); }
  });
  checkAttempt(token, signal);
}
async function ensureRenderer(token, signal) {
  if (renderer) { await waitForContext(token, signal); return; }
  const options = { antialias: false, alpha: false, powerPreference: 'high-performance' };
  graphicsContext = $('lab-canvas').getContext('webgl2', options);
  if (!graphicsContext) throw new Error('이 브라우저에서 3D 그래픽을 사용할 수 없습니다.');
  contextLost = graphicsContext.isContextLost();
  await waitForContext(token, signal);
  renderer = new THREE.WebGLRenderer({ canvas: $('lab-canvas'), context: graphicsContext, ...options });
  softwareRenderer = isSoftwareRenderer(graphicsContext);
  const gpu=graphicsContext.getExtension('WEBGL_debug_renderer_info');
  gpuName=gpu?graphicsContext.getParameter(gpu.UNMASKED_RENDERER_WEBGL):'Unavailable';
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = !softwareRenderer;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  scene = new THREE.Scene();
  rebuildEnvironment();
  scene.environmentIntensity = .32;
  scene.background = new THREE.Color('#667b99');
  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, .05, 1100);
  scene.add(new THREE.HemisphereLight(0xe2e8ed, 0x3d444b, .85));
  scene.add(new THREE.AmbientLight(0xdfe4e7, .24));
  const light = new THREE.DirectionalLight(0xfff3e6, 1.35);
  light.position.set(-6, 3.1, 5);
  light.target.position.set(0, 0, 0);
  // Furniture is stationary. Bake this one practical shadow map at install/
  // context restoration; moving glass doors are deliberately excluded.
  light.castShadow=!softwareRenderer;light.shadow.mapSize.set(2048,2048);
  Object.assign(light.shadow.camera,{left:-15,right:15,top:13,bottom:-13,near:.1,far:35});
  light.shadow.bias=-.00015;light.shadow.normalBias=.025;
  scene.add(light, light.target);
  const sunset=new THREE.DirectionalLight(0xffb16b,.75);sunset.position.copy(CITY_SUN).multiplyScalar(100);scene.add(sunset);
  // Bounded practical fills establish office/network/server identity without
  // extra scene passes or shadow maps. The sunset/exterior pipeline is unchanged.
  for(const [color,intensity,distance,position] of [
    [0xe9edf0,12,9,[0,3.10,5]],
    [0xd9e6f1,11,7,[7,3.08,2]],
    [0xc9ddf2,15,9,[-7,3.12,-6]],
  ]) {const fill=new THREE.PointLight(color,intensity,distance,2);fill.position.set(...position);scene.add(fill);}
  upscaler=new Upscaler(renderer);
  resize();
}
function rebuildEnvironment() {
  environmentTarget?.dispose();
  const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
  environmentTarget = pmrem.fromScene(room, .04, .1, 100, {size: softwareRenderer ? 64 : 256});
  scene.environment = environmentTarget.texture;
  room.dispose(); pmrem.dispose();
}
async function readModel(controller, token) {
  const started=performance.now();
  const signal = controller.signal;
  let stallTimer;
  const activity = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(new Error('모델 파일 응답 시간이 초과되었습니다.')), 20000);
  };
  activity();
  try {
    // This fixed local URL never contains game commands or user-provided addresses.
    const response = await fetch('assets/models/security_lab.glb', { signal });
    if (!response.ok) throw new Error('모델 파일을 읽을 수 없습니다.');
    const total = Number(response.headers.get('Content-Length')) || 0;
    if (total > MAX_MODEL_BYTES) throw new Error('모델 파일 크기가 제한을 초과했습니다.');
    const reader = response.body.getReader(), chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      checkAttempt(token, signal);
      if (done) break;
      received += value.byteLength;
      activity();
      if (received > MAX_MODEL_BYTES) { await reader.cancel(); throw new Error('모델 파일 크기가 제한을 초과했습니다.'); }
      chunks.push(value);
      $('scene-progress').value = total ? Math.min(80, received / total * 80) : 25;
      $('scene-message').textContent = `실습실을 불러오는 중 · ${(received / 1024 / 1024).toFixed(1)} MB`;
    }
    const buffer = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    glbLoadMs=performance.now()-started;return buffer.buffer;
  } finally { clearTimeout(stallTimer); }
}
async function installModel(gltf) {
  const loaded=gltf.scene;
  loaded.updateMatrixWorld(true);
  refineGlass(loaded,city?.environment.texture);
  const finishes=new Set();
  loaded.traverse(object=>{
    if(!object.isMesh||object.name.startsWith('COLLIDER_'))return;
    for(const material of Array.isArray(object.material)?object.material:[object.material]) {
      if(material?.sheen>0) material.sheen=.07;
      if(!material?.aoMap||finishes.has(material))continue;finishes.add(material);
      // Offline static contact AO also attenuates the broad ceiling fill. This
      // makes feet, cabinets and desks meet the floor, without dynamic SSAO.
      material.onBeforeCompile=shader=>{
        shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>',
          '#include <aomap_fragment>\n#ifdef USE_AOMAP\nreflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, 0.72);\n#endif');
      };
      material.customProgramCacheKey=()=> 'interior-static-contact-v1';
      material.needsUpdate=true;
    }
  });
  const boxes = [];
  loaded.traverse(object => {
    if (object.name.startsWith('COLLIDER_')) { boxes.push(new THREE.Box3().setFromObject(object)); object.visible = false; }
    if (object.isMesh && !object.name.startsWith('COLLIDER_')) {
      const materials=Array.isArray(object.material)?object.material:[object.material];
      let moving=false;for(let p=object;p;p=p.parent)if(p.userData.interaction==='door')moving=true;
      object.castShadow = !moving && !materials.some(m=>m.transparent||m.transmission>0)
        && /Desk|Chair|Workstation|Computer|Rack|Router|Cabinet|Partition|Monitor|Managed|Document|Mouse|Binder|Printer/.test(object.name);
      object.receiveShadow = !materials.some(m=>m.transparent||m.transmission>0);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material.map) material.map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    }
  });
  const spawnObject = loaded.getObjectByName('SPAWN_Player');
  if (!spawnObject) throw new Error('실습실의 시작 위치를 읽을 수 없습니다.');
  const spawn = spawnObject.getWorldPosition(new THREE.Vector3());
  batchStatic(loaded);
  player?.dispose();
  if (model) { scene.remove(model); clearResources(model); }
  model = loaded;
  scene.add(model);
  renderer.shadowMap.needsUpdate=true;
  player = new Player(camera, $('lab-canvas'), boxes, spawn);
  interaction = new Interaction(model, camera, player, openTool);
  visibility?.dispose();visibility=await prepareVisibility(gltf);
  player.controls.addEventListener('lock', () => {
    if (!ready || !healthyContext() || toolsOpen || mode !== '3d') { player.controls.unlock(); return; }
    $('scene-cover').hidden = true;
    $('crosshair').hidden = false;
    previousTime = performance.now();
  });
  player.controls.addEventListener('unlock', () => {
    $('crosshair').hidden = true;
    $('interaction-prompt').hidden = true;
    if (mode === '3d' && !toolsOpen) { $('scene-cover').hidden = false; pauseMessage(); }
  });
}
async function renderFirstFrame(token, signal) {
  await waitForContext(token, signal);
  await new Promise((resolve, reject) => {
    let frame;
    const cleanup = () => { cancelAnimationFrame(frame); signal.removeEventListener('abort', cancelled); };
    const cancelled = () => { cleanup(); reject(signal.reason instanceof Error ? signal.reason : aborted()); };
    signal.addEventListener('abort', cancelled, { once: true });
    frame = requestAnimationFrame(() => {
      try {
        checkAttempt(token, signal);
        if (!healthyContext()) throw new Error('3D 그래픽 연결이 복원되지 않았습니다.');
        // The one-time shadow bake must see furniture in every zone, including
        // objects outside the player's initial view. Normal culling resumes
        // on the next frame; subsequent renders reuse the cached shadow map.
        visibility?.update(camera,innerHeight*RENDER_PRESETS[preset],optimization&&!(renderer.shadowMap.enabled&&renderer.shadowMap.needsUpdate));
        upscaler.render(scene, camera,true);
        if (!healthyContext() || renderer.info.render.calls === 0) throw new Error('3D 첫 화면을 표시하지 못했습니다.');
        renderedFrames++;
        redraw = false;
        frame = requestAnimationFrame(() => {
          try {
            checkAttempt(token, signal);
            if (!healthyContext()) throw new Error('3D 그래픽 연결이 복원되지 않았습니다.');
            cleanup(); resolve();
          } catch (error) { cleanup(); reject(error); }
        });
      } catch (error) { cleanup(); reject(error); }
    });
    if (signal.aborted) cancelled();
  });
}
function loadModel() {
  loadStarted=performance.now();
  preparation?.controller.abort(aborted());
  const token = ++generation, controller = new AbortController(), signal = controller.signal;
  const attempt = { controller, promise: null };
  preparation = attempt;
  ready = false;
  firstFrameReady = false;
  stopInput();
  $('lab-world').dataset.state = 'loading';
  $('lab-world').setAttribute('aria-busy', 'true');
  $('scene-cover').hidden = false;
  message('실습실 준비 중', contextLost ? '그래픽 연결 복원을 기다리고 있습니다.' : '공간과 조사 장비를 불러오고 있습니다.');
  $('scene-progress').hidden = false;
  $('scene-progress').value = 0;
  $('scene-start').hidden = true;
  $('scene-retry').hidden = !contextLost;
  attempt.promise = (async () => {
    const timer = setTimeout(() => controller.abort(new Error('준비 시간이 초과되었습니다.')), PREPARATION_TIMEOUT);
    let pendingModel;
    try {
      // Abort covers fetch, context restoration, parsing and both first-frame waits.
      const work = (async () => {
        await ensureRenderer(token, signal);
        checkAttempt(token, signal);
        if (!model) {
          const [bytes,exterior] = await Promise.all([readModel(controller, token),city?Promise.resolve(city):createCity(renderer)]);
  if(!city){city=exterior;scene.add(city.root);}
          $('scene-progress').value = 85;
          $('scene-message').textContent = '장비와 충돌 경계를 준비하고 있습니다.';
          const loaded = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, new URL('assets/models/', location.href).href);
          if (signal.aborted || token !== generation || mode !== '3d') { clearResources(loaded.scene); checkAttempt(token, signal); }
          pendingModel = loaded.scene;
          await installModel(loaded);
          pendingModel = undefined;
        }
        checkAttempt(token, signal);
        $('scene-progress').value = 95;
        $('scene-message').textContent = '표면과 조명을 준비하고 있습니다.';
        // Warm visible shader variants asynchronously before the first draw.
        // Hidden originals need no programs; clones share the actual GPU data.
        const warmup = new THREE.Group();
        scene.traverseVisible(object => { if (object.isMesh) warmup.add(object.clone(false)); });
        await renderer.compileAsync(warmup, camera, scene);
        checkAttempt(token, signal);
        await renderFirstFrame(token, signal);
      })();
      const interrupted = new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason instanceof Error ? signal.reason : aborted()), { once: true });
      });
      await Promise.race([work, interrupted]);
      checkAttempt(token, signal);
      if (!healthyContext()) throw new Error('3D 그래픽 연결이 복원되지 않았습니다.');
      firstFrameReady = true;
      ready = true;
      loadTimeMs=performance.now()-loadStarted;
      $('lab-world').dataset.state = 'ready';
      $('lab-world').setAttribute('aria-busy', 'false');
      $('scene-progress').value = 100;
      previousTime = 0;
      pauseMessage();
    } catch (error) {
      if (pendingModel) { clearResources(pendingModel); pendingModel = undefined; }
      if (token === generation && mode === '3d') showError(error);
      throw error;
    } finally {
      clearTimeout(timer);
      if (preparation === attempt) preparation = undefined;
    }
  })();
  return attempt.promise;
}
function nativeDialogOpen() { return Boolean(document.querySelector('dialog[open]')); }
function busy() { return Boolean(mission?.busy); }
function openTool(kind, label = '조사 노트') {
  if (mode !== '3d' || !ready || !healthyContext() || nativeDialogOpen()) return;
  toolOpener = document.activeElement;
  toolsOpen = true;
  stopInput();
  $('scene-cover').hidden = true;
  $('lab-tools').hidden = false;
  $('tool-toolbar').hidden = false;
  $('lab-tools').setAttribute('role', 'dialog');
  $('lab-tools').setAttribute('aria-modal', 'true');
  $('lab-tools').setAttribute('aria-label', label);
  $('lab-tools').setAttribute('aria-busy', String(busy()));
  $('tool-source').textContent = label;
  $('lab-world').inert = true;
  $('view-switch').disabled = true;
  $('tool-close').disabled = busy();
  currentTab = kind === 'admin' ? ((mission?.missionId || mission?.id) === 'tutorial' ? 'terminal' : 'settings') : kind;
  requestTool(currentTab);
  $('lab-tools').scrollTop = 0;
  if (kind === 'brief') {
    $('hint-copy').scrollIntoView({ block: 'center' });
    (busy() || $('hint').disabled ? $('tool-close') : $('hint')).focus();
  } else if (currentTab === 'terminal' && !$('command').disabled) $('command').focus();
  else if (!$('tool-close').disabled) $('tool-close').focus();
  else $('lab-tools').querySelector('[role="tabpanel"]:not([hidden])')?.focus();
}
function closeTool() {
  if (!toolsOpen || nativeDialogOpen() || busy()) return;
  const opener = toolOpener;
  resetToolModal();
  $('lab-tools').hidden = true;
  $('scene-cover').hidden = false;
  pauseMessage();
  if (opener instanceof HTMLElement && opener !== document.body && opener.getClientRects().length && !opener.closest('[inert]')) opener.focus();
  else $('scene-start').focus();
}
function lock() {
  if (!ready || !healthyContext() || toolsOpen || mode !== '3d' || nativeDialogOpen()) return;
  player.controls.lock();
}
function animate(time) {
  requestAnimationFrame(animate);
  const elapsed = previousTime ? time - previousTime : 0;
  const dt = Math.min(elapsed / 1000, .5);
  previousTime = time;
  if (mode !== '3d' || document.hidden || !renderer || !ready || !healthyContext() || toolsOpen) return;
  // A paused view is static. Re-render only after resize/reset or an unfinished
  // door animation, leaving the browser free to process dialogs and input.
  const movingDoor = interaction.doors.some(door => Math.abs(door.target-door.angle) > .0001);
  if (!player.controls.isLocked && !movingDoor && !redraw && !upscaler?.pending) return;
  const steps = Math.max(1, Math.ceil(dt / .1));
  for (let step = 0; step < steps; step++) {
    interaction.update(dt / steps);
    player.update(dt / steps, interaction.boxes);
  }
  const prompt = player.controls.isLocked ? interaction.prompt() : '';
  $('interaction-prompt').textContent = prompt;
  $('interaction-prompt').hidden = !prompt;
  $('crosshair').classList.toggle('target', Boolean(prompt));
  try {
    const lodChanged=visibility?.update(camera,innerHeight*RENDER_PRESETS[preset],optimization);
    const started=performance.now();
    upscaler.render(scene, camera,movingDoor||lodChanged);
    renderTimeMs=performance.now()-started;
    if (!healthyContext()) return;
    renderedFrames++;
    redraw = false;
  } catch (error) { cancelPreparation(error); return; }
  frameMs += elapsed;
  frames++;
  if (frameMs >= 1000) { fps = Math.round(frames * 1000 / frameMs);averageFrameMs=frameMs/frames; frameMs = 0; frames = 0; }
  if(debug)$('graphics-debug').textContent=`${fps} FPS · ${averageFrameMs.toFixed(1)} ms\n${renderer.info.render.calls} calls · ${renderer.info.render.triangles.toLocaleString()} triangles\n${Math.round(RENDER_PRESETS[preset]*100)}% · WebGL2 / ${softwareRenderer?'software':'GPU'}\n${visibility.stats.visibleZones.join(' / ')}\nLOD 0/1/2: ${visibility.stats.lod.join(' / ')} · culled ${visibility.stats.culled}`;
}
export function get3DDiagnostics() {
  const direction = camera?.getWorldDirection(new THREE.Vector3());
  let rendererVersion = null;
  if (healthyContext()) {
    try { rendererVersion = graphicsContext.getParameter(graphicsContext.VERSION); } catch { /* A loss may begin between checks. */ }
  }
  return {
    mode, ready: ready && healthyContext(), firstFrameReady: firstFrameReady && healthyContext(),
    contextLost: contextLost || Boolean(graphicsContext?.isContextLost()), renderedFrames, generation, initializing: Boolean(preparation),
    toolsOpen, pointerLocked: player?.controls.isLocked ?? false, tab: currentTab,
    position: camera?.position.toArray(), rotation: camera?.rotation.toArray().slice(0, 3),
    movementSeconds: player?.movementSeconds ?? 0,
    yaw: direction ? Math.atan2(-direction.x, -direction.z) : 0, pitch: direction ? Math.asin(direction.y) : 0,
    target: interaction?.target?.name ?? null,
    doors: interaction?.doors.map(door => ({ name: door.object.name, angle: door.angle, target: door.target, pivot: door.object.position.toArray() })) ?? [],
    colliders: player?.boxes.length ?? 0, drawCalls: renderer?.info.render.calls ?? 0,
    triangles: renderer?.info.render.triangles ?? 0, fps, frameTimeMs:averageFrameMs,renderTimeMs, renderer: rendererVersion, softwareRenderer,
    backend:'WebGL2',gpu:gpuName,geometries:renderer?.info.memory.geometries,textures:renderer?.info.memory.textures,
    renderScale:RENDER_PRESETS[preset],preset,temporal:upscaler?.temporal,historySamples:upscaler?.samples,
    optimization,visibleZones:visibility?.stats.visibleZones,lod:visibility?.stats.lod,culled:visibility?.stats.culled,
    loadTimeMs,glbLoadMs,heapMB:performance.memory?.usedJSHeapSize/1048576,cityBuildings:city?.buildingCount,
  };
}
export function init3D() {
  if (getComputedStyle(document.documentElement).getPropertyValue('--scene-styles-ready').trim() !== '1') throw new Error('3D 화면 스타일을 불러오지 못했습니다.');
  if (!initialized) {
    initialized = true;
    observeMission(status => {
      mission = status;
      $('hud-title').textContent = status.title;
      $('hud-objective').textContent = status.objective;
      $('hud-stage').textContent = `${status.stage} · 단서 ${status.clues}개 · ${status.score}/100`;
      $('hud-mission').textContent = (status.missionId || status.id) === 'tutorial' ? 'CASE 001 / 조사 준비' : `CASE 001 / MISSION ${String(status.active).padStart(2, '0')}`;
      $('tool-close').disabled = toolsOpen && busy();
      if (toolsOpen) $('lab-tools').setAttribute('aria-busy', String(busy()));
    });
    $('scene-start').addEventListener('click', lock);
    try{const value=localStorage.getItem('security-lab-render-preset');if(value in RENDER_PRESETS)preset=value;}catch{}
    $('render-preset').value=preset;
    $('render-preset').addEventListener('change',()=>{preset=$('render-preset').value;try{localStorage.setItem('security-lab-render-preset',preset);}catch{}resize();});
    $('temporal-aa').addEventListener('change',()=>{if(upscaler){upscaler.temporal=$('temporal-aa').checked;upscaler.reset();redraw=true;}});
    debug=new URLSearchParams(location.search).has('debug');$('graphics-debug').hidden=!debug;
    $('lab-canvas').addEventListener('click', lock);
    $('scene-retry').addEventListener('click', () => document.dispatchEvent(new Event('scene3d-retry')));
    $('world-notes').addEventListener('click', () => openTool('brief', '조사 노트 / 현재 미션'));
    $('world-reset').addEventListener('click', () => {
      player?.reset();
      redraw = true;
      stopInput();
      $('scene-cover').hidden = false;
      pauseMessage();
      clearTimeout(noticeTimer);
      $('world-location').textContent = '출입구로 돌아왔습니다. 미션 진행은 유지됩니다.';
      noticeTimer = setTimeout(() => { $('world-location').textContent = 'SECURITY OPERATIONS / TRAINING FACILITY'; }, 3000);
    });
    $('tool-close').addEventListener('click', closeTool);
    window.addEventListener('resize', resize);
    $('lab-canvas').addEventListener('webglcontextlost', event => {
      event.preventDefault();
      contextLost = true;
      ready = false;
      firstFrameReady = false;
      stopInput();
      resetToolModal();
      $('lab-tools').hidden = mode === '3d';
      if (mode !== '3d') return;
      $('scene-cover').hidden = false;
      message('3D 화면이 중단되었습니다.', '그래픽 연결 복원을 기다리고 있습니다. 다시 시도하거나 2D 도구 화면에서 이어서 플레이하세요.');
      $('scene-start').hidden = true;
      $('scene-retry').hidden = false;
      if (!preparation) void loadModel().catch(() => {});
    });
    $('lab-canvas').addEventListener('webglcontextrestored', () => {
      contextLost = graphicsContext?.isContextLost() ?? false;
      // This listener predates Three's listener. Recreate the generated light
      // texture only after Three has rebuilt its WebGL state for the new context.
      queueMicrotask(() => {
        if (renderer && scene && !contextLost) {
          rebuildEnvironment();
          if(city){restoreCityEnvironment(renderer,city);if(model)refineGlass(model,city.environment.texture);}
          renderer.shadowMap.needsUpdate=true;
          upscaler?.reset();redraw=true;
        }
        if (mode === '3d' && !ready && !preparation) void loadModel().catch(() => {});
      });
    });
    document.addEventListener('keydown', event => {
      if(event.code==='F3'&&mode==='3d'){event.preventDefault();debug=!debug;$('graphics-debug').hidden=!debug;}
      if (mode !== '3d' || nativeDialogOpen()) return;
      if (event.code === 'KeyE' && !event.repeat && ready && player?.controls.isLocked && !toolsOpen) { event.preventDefault(); interaction.interact(); }
      if (event.code === 'Escape' && player?.controls.isLocked && !toolsOpen) { event.preventDefault(); player.controls.unlock(); }
      if (event.code === 'Escape' && toolsOpen) { event.preventDefault(); closeTool(); }
      if (event.code === 'Tab' && toolsOpen) {
        const available = [...$('lab-tools').querySelectorAll('button,input,select,textarea,a[href],[tabindex]')]
          .filter(element => !element.disabled && element.tabIndex >= 0 && !element.closest('[inert]') && element.getClientRects().length);
        const first = available[0], last = available.at(-1);
        if (event.shiftKey && (document.activeElement === first || !available.includes(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !available.includes(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopInput(); previousTime = 0; });
    document.addEventListener('pointerlockerror', () => {
      if (mode !== '3d' || toolsOpen || !ready) return;
      stopInput();
      $('scene-cover').hidden = false;
      message('마우스 잠금을 허용해주세요.', '화면의 탐색 시작을 다시 누르세요. 마우스 잠금을 사용할 수 없다면 2D 도구 화면에서 플레이할 수 있습니다.');
    });
    requestAnimationFrame(animate);
  }
  return setMode('3d');
}
