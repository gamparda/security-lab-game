import { test, expect as baseExpect } from '@playwright/test';
import { initialState, runCommand, applyAnswer, nextMission } from '../../src/engine.js';
import { CURRENT_SAVE_KEY, SAVE_KEY, encodeGame, exportGame } from '../../src/storage.js';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const expect=baseExpect.configure({timeout:process.platform==='win32' && process.env.CI ? 20000 : 5000});
const diagnostics=page=>page.evaluate(async()=> (await import('/src/scene-entry.js')).get3DDiagnostics());
const VIEW_KEY='security-lab-view';
const desktop3D=testInfo=>['desktop','windows-edge'].includes(testInfo.project.name);
const main3D=testInfo=>testInfo.project.name==='desktop';
test.beforeEach(async({page},testInfo)=>{
  if(process.env.CI && desktop3D(testInfo)) {
    // Hosted runners use software graphics. Keep the real scene, collisions,
    // rendering and input, at a smaller viewport rather than bypassing them.
    await page.setViewportSize({width:640,height:480});
    testInfo.setTimeout(process.platform==='win32' ? 120000 : 60000);
  }
});
async function savedGame(page) {
  await expect(page.locator('#save-status')).not.toHaveText('저장 중…');
  return page.evaluate(key=>localStorage.getItem(key),CURRENT_SAVE_KEY);
}
async function tutorialComplete() {
  const state=initialState();
  await runCommand(state,'help'); await runCommand(state,'inspect approval');
  applyAnswer(state,0); await runCommand(state,'verify'); nextMission(state);
  await runCommand(state,'scan club-server');
  return state;
}
async function seedV2(page,state) {
  const raw=JSON.stringify({version:2,revision:7,game:encodeGame(state)});
  await page.addInitScript(({key,raw})=>{if(localStorage.getItem(key)===null) localStorage.setItem(key,raw);},{key:CURRENT_SAVE_KEY,raw});
  return raw;
}
async function capture(page,file) {
  if(!process.env.LAB_SCREENSHOT_DIR) return;
  await mkdir(process.env.LAB_SCREENSHOT_DIR,{recursive:true});
  await page.screenshot({path:join(process.env.LAB_SCREENSHOT_DIR,file)});
}
async function start(page) {
  await page.goto('/?view=3d');
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','ready',{timeout:25000});
  await resume(page);
}
async function resume(page) {
  const before=await diagnostics(page);
  await page.locator('#scene-start').click();
  await expect.poll(async()=> (await diagnostics(page)).pointerLocked).toBe(true);
  // Xvfb can deliver a cursor-warp delta when native pointer lock begins.
  // Look back in the intended direction through the same mouse input path;
  // never assign the camera rotation or move the player for the test.
  const [x,y,z]=before.position, horizontal=Math.cos(before.pitch);
  await aim(page,x-Math.sin(before.yaw)*horizontal,y+Math.sin(before.pitch),z-Math.cos(before.yaw)*horizontal);
  // Native Windows software graphics can delay the automation response even
  // when the camera has already reached the expected direction.
  await expect.poll(async()=> (await diagnostics(page)).yaw,{timeout:20000}).toBeCloseTo(before.yaw,2);
}
async function openMainDoor(page) {
  await expect.poll(async()=> (await diagnostics(page)).target).toBe('DOOR_Main');
  await page.keyboard.press('KeyE');
  await expect.poll(async()=> (await diagnostics(page)).doors[0].angle).toBeCloseTo(100*Math.PI/180,2);
}
async function walkUntil(page,key,condition,timeout=16000) {
  // Arm the stop before sending the real keydown. Release through the normal
  // keyup handler in the frame that reaches the waypoint, so slow automation
  // transport cannot carry the player past a doorway or interaction target.
  await page.evaluate(async({key,condition,timeout})=>{
    const {get3DDiagnostics}=await import('/src/scene-entry.js');
    const state=window.__labWalk={done:false,error:null};
    let startSeconds=0,timer;
    const finish=error=>{
      if(state.done) return;
      state.done=true; state.error=error??null; clearTimeout(timer);
      document.removeEventListener('keydown',begin);
      document.dispatchEvent(new KeyboardEvent('keyup',{code:key,bubbles:true}));
    };
    const check=()=>{
      if(state.done) return;
      const d=get3DDiagnostics();
      if(!d.pointerLocked) return finish('Pointer lock was lost while walking');
      const value=d.position[condition.axis==='x'?0:2];
      const reached=condition.target!==undefined ? d.target===condition.target
        : condition.seconds!==undefined ? d.movementSeconds-startSeconds>=condition.seconds
        : condition.lt!==undefined ? value<condition.lt : value>condition.gt;
      if(reached) finish(); else requestAnimationFrame(check);
    };
    const begin=event=>{
      if(event.code!==key || event.repeat) return;
      document.removeEventListener('keydown',begin);
      startSeconds=get3DDiagnostics().movementSeconds;
      timer=setTimeout(()=>finish('Walking did not reach its physical target'),timeout);
      check();
    };
    state.cancel=()=>finish('Walking cancelled');
    document.addEventListener('keydown',begin);
  },{key,condition,timeout});
  await page.keyboard.down(key);
  try {
    // The in-page physical deadline stays unchanged; allow a delayed native
    // graphics/automation response to deliver its result after that deadline.
    await expect.poll(()=>page.evaluate(()=>window.__labWalk.done),{timeout:timeout+30000,intervals:[40,70,100]}).toBe(true);
    expect(await page.evaluate(()=>window.__labWalk.error)).toBeNull();
  } finally {
    await page.evaluate(()=>{window.__labWalk?.cancel(); delete window.__labWalk;});
    await page.keyboard.up(key);
  }
}
async function aim(page,x,y,z) {
  // PointerLockControls is exercised through mouse movement events, never by
  // editing the live camera/player or by teleporting through collision bounds.
  const d=await diagnostics(page), [px,py,pz]=d.position;
  const yaw=Math.atan2(-(x-px),-(z-pz)), pitch=Math.atan2(y-py,Math.hypot(x-px,z-pz));
  let dyaw=yaw-d.yaw; dyaw=Math.atan2(Math.sin(dyaw),Math.cos(dyaw));
  await page.evaluate(({movementX,movementY})=>document.dispatchEvent(new MouseEvent('mousemove',{movementX,movementY})),
    {movementX:Math.round(-dyaw/.0014),movementY:Math.round(-(pitch-d.pitch)/.0014)});
}
async function closeAndResume(page) {
  await page.locator('#tool-close').click();
  expect((await diagnostics(page)).pointerLocked).toBe(false);
  await resume(page);
}

test('3D actual movement, closed-door collision, hinge rotation, mouse and pause',async({page},testInfo)=>{
  test.skip(!main3D(testInfo),'Detailed physical navigation uses the primary desktop Chromium project.');
  test.setTimeout(120000);
  const errors=[],violations=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',e=>window.cspErrors=(window.cspErrors||[]).concat({directive:e.violatedDirective,blockedURI:e.blockedURI,sourceFile:e.sourceFile,line:e.lineNumber,sample:e.sample})));
  await start(page);
  const initial=await diagnostics(page);
  expect(initial.position[1]).toBe(1.65); expect(initial.colliders).toBeGreaterThan(25);
  // A 0.1 s frame can stop at 10.27 m: assert the collision boundary and
  // continued inability to cross, not one particular movement quantization.
  await walkUntil(page,'KeyW',{axis:'z',lt:10.32});
  const atClosedDoor=(await diagnostics(page)).position[2];
  expect(atClosedDoor).toBeGreaterThanOrEqual(10.2);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(350); await page.keyboard.up('KeyW');
  const blocked=(await diagnostics(page)).position[2];
  // A later, smaller frame can close the final few centimetres of clearance.
  // The player must still remain outside the closed leaf, without moving back.
  expect(blocked).toBeGreaterThanOrEqual(10.2);
  expect(blocked).toBeLessThanOrEqual(atClosedDoor+.005);
  await expect(page.locator('#interaction-prompt')).toContainText('문 열기');
  await page.keyboard.press('KeyE');
  await expect.poll(async()=> (await diagnostics(page)).doors[0].angle).toBeCloseTo(100*Math.PI/180,2);
  expect((await diagnostics(page)).doors[0].pivot[0]).toBeCloseTo(-.64,2);
  await walkUntil(page,'KeyW',{axis:'z',lt:6.5});
  const walking=await diagnostics(page);
  // Walk back toward the open entrance before sprinting forward, leaving
  // enough unobstructed corridor for delayed input delivery on CI.
  await walkUntil(page,'KeyS',{seconds:.4});
  const sprinting=await diagnostics(page);
  const walkSpeed=(sprinting.position[2]-walking.position[2])/(sprinting.movementSeconds-walking.movementSeconds);
  await page.keyboard.down('ShiftLeft');
  try { await walkUntil(page,'KeyW',{seconds:.4}); }
  finally { await page.keyboard.up('ShiftLeft'); }
  const afterSprint=await diagnostics(page);
  // Compare actual distance per simulated second, since software rendering and
  // automation latency can make equal wall-clock key pulses unequal in-game.
  const sprintSpeed=(sprinting.position[2]-afterSprint.position[2])/(afterSprint.movementSeconds-sprinting.movementSeconds);
  expect(walkSpeed).toBeCloseTo(2.6,1);
  expect(sprintSpeed).toBeCloseTo(4.2,1);
  expect(sprintSpeed).toBeGreaterThan(walkSpeed*1.3);
  // Exercise a real resize without increasing software rasterization load.
  const resized=process.env.CI ? {width:576,height:432} : {width:1200,height:800};
  await page.setViewportSize(resized);
  expect((await page.locator('#lab-canvas').boundingBox()).width).toBe(resized.width);
  const before=await diagnostics(page);
  await page.mouse.move(resized.width/2,resized.height/2); await page.mouse.move(resized.width/2+100,resized.height/2);
  expect((await diagnostics(page)).yaw).not.toBeCloseTo(before.yaw,2);
  await page.keyboard.press('Escape');
  await expect(page.locator('#scene-cover')).toBeVisible();
  const stopped=(await diagnostics(page)).position;
  await page.keyboard.down('KeyW'); await page.waitForTimeout(250); await page.keyboard.up('KeyW');
  expect((await diagnostics(page)).position).toEqual(stopped);
  await page.locator('#world-notes').click();
  await expect(page.locator('#lab-tools')).toHaveAttribute('role','dialog');
  expect((await diagnostics(page)).pointerLocked).toBe(false);
  await page.locator('#tool-close').click();
  await expect(page.locator('#lab-tools')).toBeHidden();
  expect((await diagnostics(page)).pointerLocked).toBe(false);
  expect(errors).toEqual([]); expect(await page.evaluate(()=>window.cspErrors||[])).toEqual(violations);
});

test('walk to all five devices; old tools, scoring, save and mission guards stay intact',async({page},testInfo)=>{
  test.skip(!main3D(testInfo),'Detailed spatial route uses the primary desktop Chromium project.');
  test.setTimeout(180000);
  await start(page); await openMainDoor(page);
  await capture(page,'02-door-open.png');
  await walkUntil(page,'KeyW',{axis:'z',lt:6});
  await aim(page,-3,1.5,0); await capture(page,'01-lab-overview.png');
  // Main operations PC: approach along its southern aisle, aiming at the screen.
  await aim(page,-5,1.65,6); await walkUntil(page,'KeyW',{axis:'x',lt:-4.85});
  await aim(page,-5.2,1.25,2.85);
  await walkUntil(page,'KeyW',{target:'INTERACT_AdminPC'});
  await page.keyboard.press('KeyE');
  await expect(page.locator('#panel-terminal')).toBeVisible();
  await page.locator('#command').fill('help'); await page.locator('#command').press('Enter');
  await expect(page.locator('#terminal')).toContainText('inspect');
  expect((await diagnostics(page)).toolsOpen).toBe(true);
  await page.locator('#command').fill('inspect approval'); await page.locator('#command').press('Enter');
  await page.locator('#answer-0').check(); await page.locator('#verify').click();
  await expect(page.locator('#next')).toBeVisible(); await page.locator('#next').click();
  await expect(page.locator('#hud-title')).toHaveText('노출된 서비스');
  await closeAndResume(page);
  // Back to the central aisle, then up to the server-room door.
  await aim(page,0,1.65,6); await walkUntil(page,'KeyW',{axis:'x',gt:-.12});
  await aim(page,0,1.65,-.8); await walkUntil(page,'KeyW',{axis:'z',lt:.1});
  await aim(page,-5.3,1.65,.1); await walkUntil(page,'KeyW',{axis:'x',lt:-5.1});
  await aim(page,-5.3,1.45,-2);
  await expect.poll(async()=> (await diagnostics(page)).target).toBe('DOOR_ServerRoom');
  await page.keyboard.press('KeyE');
  await expect.poll(async()=> (await diagnostics(page)).doors.find(d=>d.name==='DOOR_ServerRoom').angle).toBeCloseTo(95*Math.PI/180,2);
  await aim(page,-5.3,1.65,-3.0); await walkUntil(page,'KeyW',{axis:'z',lt:-3.0});
  await aim(page,-7.1,1.3,-4.55);
  await expect.poll(async()=> (await diagnostics(page)).target).toBe('INTERACT_ServerRack');
  await capture(page,'03-server-rack.png');
  await page.keyboard.press('KeyE'); await expect(page.locator('#panel-terminal')).toBeVisible();
  await capture(page,'04-terminal-overlay.png');
  await page.locator('#command').fill('scan club-server'); await page.locator('#command').press('Enter');
  await expect(page.locator('#terminal')).toContainText('8080');
  const save=await savedGame(page);
  expect(JSON.parse(save).game.active).toBe('services');
  await closeAndResume(page);
  // Leave the server suite through the same physical doorway, then the whiteboard.
  await aim(page,-5.3,1.65,0); await walkUntil(page,'KeyW',{axis:'z',gt:0});
  await aim(page,0,1.65,0); await walkUntil(page,'KeyW',{axis:'x',gt:-.1});
  await aim(page,2,1.7,-.82);
  await expect.poll(async()=> (await diagnostics(page)).target).toBe('INTERACT_Whiteboard');
  await page.keyboard.press('KeyE'); await expect(page.locator('#tool-source')).toContainText('화이트보드');
  await expect(page.locator('#hint')).toHaveText('힌트 보기 (0/3)');
  await closeAndResume(page);
  // Network bench along its clear southern approach.
  await aim(page,0,1.65,3.8); await walkUntil(page,'KeyW',{axis:'z',gt:3.5});
  await aim(page,7,1.65,3.8); await walkUntil(page,'KeyW',{axis:'x',gt:6.85});
  await aim(page,7,1.06,1.65);
  await expect.poll(async()=> (await diagnostics(page)).target).toBe('INTERACT_Router');
  await page.keyboard.press('KeyE'); await expect(page.locator('#panel-settings')).toBeVisible();
  await expect(page.locator('#port-8080')).toHaveValue('allow');
  await closeAndResume(page);
  // The records room has its own actual door, independent of the server suite.
  await aim(page,5.3,1.65,3.8); await walkUntil(page,'KeyW',{axis:'x',lt:5.4});
  await aim(page,5.3,1.65,0); await walkUntil(page,'KeyW',{axis:'z',lt:.1});
  await aim(page,5.3,1.45,-2);
  await expect.poll(async()=> (await diagnostics(page)).target).toBe('DOOR_RecordsRoom');
  await page.keyboard.press('KeyE');
  await expect.poll(async()=> (await diagnostics(page)).doors.find(d=>d.name==='DOOR_RecordsRoom').angle).toBeCloseTo(95*Math.PI/180,2);
  await aim(page,5.3,1.65,-5.9); await walkUntil(page,'KeyW',{axis:'z',lt:-5.8});
  await aim(page,7.4,1.2,-7.45);
  await walkUntil(page,'KeyW',{target:'INTERACT_FileCabinet'});
  await page.keyboard.press('KeyE'); await expect(page.locator('#panel-files')).toBeVisible();
  await expect(page.locator('#tool-source')).toContainText('자료 보관함');
  await closeAndResume(page);
  await page.keyboard.press('Escape'); await page.locator('#world-2d').click();
  await expect(page.locator('#lab-tools')).toBeVisible();
  await page.reload(); await expect(page.locator('#mission-title')).toHaveText('노출된 서비스');
  expect(await savedGame(page)).toBe(save);
});

test('door closing stops for a player in its sweep, then closes when clear',async({page},testInfo)=>{
  test.skip(!main3D(testInfo));
  await start(page); await openMainDoor(page);
  await walkUntil(page,'KeyW',{axis:'z',lt:9.88});
  await aim(page,-.72,1.4,9.4);
  await expect.poll(async()=> (await diagnostics(page)).target).toBe('DOOR_Main');
  await page.keyboard.press('KeyE'); await page.waitForTimeout(650);
  expect((await diagnostics(page)).doors[0].angle).toBeGreaterThan(.2);
  await aim(page,0,1.65,8.2); await walkUntil(page,'KeyW',{axis:'z',lt:8.35});
  await aim(page,-.83,1.4,8.8);
  await expect.poll(async()=> (await diagnostics(page)).target).toBe('DOOR_Main');
  await page.keyboard.press('KeyE');
  await expect.poll(async()=> (await diagnostics(page)).doors[0].angle).toBeCloseTo(0,2);
});

test('all original missions finish inside the 3D overlay and restore after reload',async({page},testInfo)=>{
  test.skip(!main3D(testInfo));
  const command=async text=>{
    await page.getByRole('tab',{name:'가상 터미널'}).click();
    await page.locator('#command').fill(text); await page.locator('#command').press('Enter');
    await expect(page.locator('#command')).toBeEnabled();
  };
  await start(page); await page.keyboard.press('Escape'); await page.locator('#world-notes').click();
  await command('help'); await command('inspect approval'); await page.locator('#answer-0').check();
  await page.locator('#verify').click(); await expect(page.locator('#next')).toBeVisible(); await page.locator('#next').click();
  await command('scan club-server'); await command('inspect club-server 8080'); await page.locator('#answer-1').check();
  await page.getByRole('tab',{name:'방어 설정'}).click(); await page.locator('#port-8080').selectOption('block');
  await command('scan club-server'); await command('verify'); await page.locator('#next').click();
  await command('inspect login'); await page.locator('#answer-2').check();
  await page.getByRole('tab',{name:'방어 설정'}).click(); await page.locator('#min-length').selectOption('15');
  await page.locator('#blockCommon').check(); await page.locator('#limitAttempts').check();
  await command('verify'); await page.locator('#next').click();
  await command('inspect baseline'); await command('hash files'); await page.locator('#answer-1').check();
  await page.getByRole('tab',{name:'방어 설정'}).click(); await page.locator('[data-restore="budget.csv"]').click();
  await command('hash files'); await command('verify');
  await expect(page.locator('#results')).toBeVisible(); await expect(page.locator('#score')).toHaveText('100 / 100');
  const save=await savedGame(page);
  expect(JSON.parse(save).game.missions.every(m=>m.verified)).toBe(true);
  await page.reload(); await expect(page.locator('#lab-world')).toHaveAttribute('data-state','ready',{timeout:25000});
  await page.locator('#world-notes').click(); await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('.mission-step.complete')).toHaveCount(4);
});

test('model failure offers retry and 2D continuation; no external requests',async({page},testInfo)=>{
  test.skip(!main3D(testInfo));
  const external=[];
  page.on('request',r=>{if(/^https?:/.test(r.url()) && new URL(r.url()).origin!==new URL(testInfo.project.use.baseURL||process.env.GAME_URL||'http://localhost:5173').origin) external.push(r.url());});
  await page.route('**/assets/models/security_lab.glb',route=>route.abort());
  await page.goto('/?view=3d');
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','error');
  await page.unroute('**/assets/models/security_lab.glb');
  await page.locator('#scene-retry').click();
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','ready',{timeout:25000});
  await page.locator('#scene-fallback').click(); await expect(page.locator('#lab-tools')).toBeVisible();
  await page.locator('#command').fill('https://example.com'); await page.locator('#command').press('Enter');
  expect(external).toEqual([]);
});

test('unresponsive model has a bounded loading timeout',async({page},testInfo)=>{
  test.skip(!main3D(testInfo));
  await page.clock.install();
  await page.route('**/assets/models/security_lab.glb',()=>new Promise(()=>{}));
  await page.goto('/?view=3d');
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','loading');
  await page.clock.fastForward(21000);
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','error');
  await page.locator('#scene-fallback').click(); await expect(page.locator('#mission-title')).toBeVisible();
});

test('first launch opens 2D without requesting optional 3D assets',async({page})=>{
  const optional=[];
  page.on('request',r=>{
    const path=new URL(r.url()).pathname;
    if(/^\/vendor\/three\//.test(path) || /\/(scene3d\.(?:js|css)|player3d\.js|interaction3d\.js|batch3d\.js|collision\.js)$/.test(path) || path.endsWith('.glb')) optional.push(path);
  });
  await page.goto('/');
  await expect(page.locator('#mission-title')).toHaveText('조사 준비');
  await expect(page.locator('#lab-tools')).toBeVisible();
  await expect(page.locator('#lab-world')).toBeHidden();
  await expect(page.locator('#view-switch')).toHaveText('3D 실습실');
  expect(optional).toEqual([]);
});

for(const blocked of ['src/scene3d.js','vendor/three/build/three.core.js','src/scene3d.css']) {
  test(`3D retry recovers ${blocked} without reloading the working game`,async({page},testInfo)=>{
    test.skip(!main3D(testInfo));
    test.setTimeout(60000);
    const raw=await seedV2(page,await tutorialComplete());
    await page.goto('/?view=2d'); await expect(page.locator('#mission-title')).toHaveText('노출된 서비스');
    await page.locator('#hint').click(); const saved=await savedGame(page);
    expect(saved).not.toBe(raw);
    await page.evaluate(()=>{window.originalGameDocument=true;});
    let appRequests=0;
    await page.route('**/src/app.js*',route=>{appRequests++; return route.abort();});
    await page.route('**/'+blocked,route=>route.abort());
    await page.locator('#view-switch').click();
    await expect(page.locator('#lab-world')).toHaveAttribute('data-state','error',{timeout:25000});
    await expect(page.locator('#loading-screen')).toBeHidden();
    // The original failed module stays in the browser's module map. A fresh
    // 3D graph must recover while app.js remains unavailable for a new page.
    await page.unroute('**/'+blocked);
    const fresh=[];
    page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/__scene__/'))fresh.push(request.url());});
    await page.locator('#scene-retry').click();
    await expect(page.locator('#lab-world')).toHaveAttribute('data-state','ready',{timeout:25000});
    expect(fresh.some(url=>url.includes('src/scene3d.js'))).toBe(true);
    expect(appRequests).toBe(0); expect(await page.evaluate(()=>window.originalGameDocument)).toBe(true);
    expect(await savedGame(page)).toBe(saved);
    await expect(page.locator('#hud-title')).toHaveText('노출된 서비스');
    await page.locator('#world-notes').click();
    await page.locator('#hint').click();
    await expect(page.locator('#hint')).toHaveText('힌트 보기 (2/3)');
    expect(JSON.parse(await savedGame(page)).game.missions[1].hint).toBe(2);
    await page.locator('#tool-close').click(); await page.locator('#world-2d').click();
    await expect(page.locator('#mission-title')).toHaveText('노출된 서비스');
    expect(await page.evaluate(()=>window.originalGameDocument)).toBe(true);
  });
}

test('view preference persists independently and explicit 2D wins over saved 3D',async({page},testInfo)=>{
  test.skip(!main3D(testInfo));
  await page.goto('/'); await page.locator('#view-switch').click();
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','ready',{timeout:25000});
  expect(await page.evaluate(key=>localStorage.getItem(key),VIEW_KEY)).toBe('3d');
  expect(await savedGame(page)).toBeNull();
  await page.goto('/'); await expect(page.locator('#lab-world')).toHaveAttribute('data-state','ready',{timeout:25000});
  await page.goto('/?view=2d'); await expect(page.locator('#lab-tools')).toBeVisible();
  await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),VIEW_KEY)).toBe('2d');
  await page.goto('/'); await expect(page.locator('#lab-world')).toBeHidden();
  await expect(page.locator('#mission-title')).toHaveText('조사 준비');
});

for(const [name,pattern] of [
  ['entry module','**/src/scene3d.js*'],
  ['stylesheet','**/src/scene3d.css*'],
  ['dependency graph','**/vendor/three/build/three.core.js*'],
]) {
  test(`optional ${name} failure leaves the existing 2D game playable`,async({page})=>{
    const raw=await seedV2(page,await tutorialComplete());
    await page.route(pattern,route=>route.abort());
    await page.goto('/?view=3d',{waitUntil:'domcontentloaded'});
    await expect(page.locator('#lab-world')).toHaveAttribute('data-state','error',{timeout:25000});
    await expect(page.locator('#scene-start')).toBeHidden();
    await expect(page.locator('#scene-retry')).toBeVisible();
    await page.locator('#scene-fallback').click();
    await expect(page.locator('#mission-title')).toHaveText('노출된 서비스');
    await expect(page.locator('#lab-world')).toBeHidden();
    expect(await savedGame(page)).toBe(raw);
    await page.locator('#command').fill('inspect club-server 8080'); await page.locator('#command').press('Enter');
    await expect(page.locator('#terminal')).toContainText('관리용 서비스');
    expect(JSON.parse(await savedGame(page)).game.missions[1].clues).toContain('port-8080');
  });

  test(`unresponsive optional ${name} ends within the total preparation deadline`,async({page})=>{
    let release,requested;
    const gate=new Promise(resolve=>{release=resolve;});
    const request=new Promise(resolve=>{requested=resolve;});
    await page.clock.install();
    await page.route(pattern,async route=>{requested(); await gate; await route.continue();});
    try {
      await page.goto('/?view=3d',{waitUntil:'domcontentloaded'}); await request;
      await expect(page.locator('#lab-world')).toHaveAttribute('data-state','loading');
      await expect(page.locator('#scene-start')).toBeHidden();
      await page.clock.fastForward(21000);
      await expect(page.locator('#lab-world')).toHaveAttribute('data-state','error');
      await page.locator('#scene-fallback').click();
      release();
      await expect(page.locator('#lab-tools')).toBeVisible();
      await expect(page.locator('#lab-world')).toBeHidden();
      await expect(page.locator('#mission-title')).toHaveText('조사 준비');
    } finally {release();}
  });
}

test('cancelled preparation cannot reopen 3D when a late optional module arrives',async({page})=>{
  let release,requested;
  const gate=new Promise(resolve=>{release=resolve;});
  const request=new Promise(resolve=>{requested=resolve;});
  await page.route('**/src/scene3d.js*',async route=>{requested(); await gate; await route.continue();});
  try {
    await page.goto('/?view=3d',{waitUntil:'domcontentloaded'}); await request;
    await page.locator('#scene-fallback').click(); release();
    await expect(page.locator('#mission-title')).toHaveText('조사 준비');
    await expect(page.locator('#lab-world')).toBeHidden();
    await page.locator('#command').fill('help'); await page.locator('#command').press('Enter');
    await expect(page.locator('#terminal')).toContainText('inspect approval');
    await expect(page.locator('#lab-world')).toBeHidden();
    expect(await page.evaluate(key=>localStorage.getItem(key),VIEW_KEY)).toBe('2d');
  } finally {release();}
});

test('v0.3 v2 progress and legacy original survive toggles, location return and retry',async({page},testInfo)=>{
  test.skip(!main3D(testInfo));
  const state=await tutorialComplete(),raw=await seedV2(page,state);
  const legacy=JSON.stringify(encodeGame(state,{legacy:true}));
  await page.addInitScript(({key,legacy})=>localStorage.setItem(key,legacy),{key:SAVE_KEY,legacy});
  await page.goto('/?view=3d');
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','ready',{timeout:25000});
  await expect(page.locator('#hud-title')).toHaveText('노출된 서비스');
  await page.locator('#world-reset').click();
  await page.locator('#world-2d').click();
  await expect(page.locator('#mission-title')).toHaveText('노출된 서비스');
  await expect(page.locator('#clues li')).toHaveCount(1);
  expect(await savedGame(page)).toBe(raw);
  await page.reload();
  await page.route('**/assets/models/security_lab.glb',route=>route.abort());
  await page.locator('#view-switch').click();
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','error');
  expect(await savedGame(page)).toBe(raw);
  await page.unroute('**/assets/models/security_lab.glb'); await page.locator('#scene-retry').click();
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','ready',{timeout:25000});
  expect(await savedGame(page)).toBe(raw);
  expect(await page.evaluate(key=>localStorage.getItem(key),SAVE_KEY)).toBe(legacy);
  await page.locator('#world-notes').click();
  await expect(page.locator('#next-action')).toContainText('관리 서비스가 불필요');
});

test('unsupported WebGL offers 2D continuation without altering progress',async({page})=>{
  const raw=await seedV2(page,await tutorialComplete());
  await page.addInitScript(()=>{
    const getContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args) {
      return /^webgl/.test(kind)?null:getContext.call(this,kind,...args);
    };
  });
  await page.goto('/?view=3d');
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','error',{timeout:25000});
  await expect(page.locator('#scene-start')).toBeHidden(); await page.locator('#scene-fallback').click();
  await expect(page.locator('#mission-title')).toHaveText('노출된 서비스');
  expect(await savedGame(page)).toBe(raw);
});

test('Pointer Lock rejection stays paused and offers retry or 2D',async({page},testInfo)=>{
  test.skip(!main3D(testInfo));
  await page.addInitScript(()=>{
    Element.prototype.requestPointerLock=function() {
      document.dispatchEvent(new Event('pointerlockerror'));
      return Promise.reject(new DOMException('Pointer lock denied','NotAllowedError'));
    };
  });
  await page.goto('/?view=3d');
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','ready',{timeout:25000});
  await page.locator('#scene-start').click(); await expect(page.locator('#scene-message')).toContainText('2D');
  expect((await diagnostics(page)).pointerLocked).toBe(false);
  await expect(page.locator('#scene-cover')).toBeVisible();
  await page.locator('#scene-fallback').click(); await expect(page.locator('#mission-title')).toHaveText('조사 준비');
});

test('lost WebGL context never becomes ready on retry before a restored first frame',async({page},testInfo)=>{
  test.skip(!main3D(testInfo));
  const raw=await seedV2(page,await tutorialComplete());
  await start(page);
  const available=await page.evaluate(()=>{
    const gl=document.getElementById('lab-canvas').getContext('webgl2');
    window.contextRecovery=gl.getExtension('WEBGL_lose_context');
    return Boolean(window.contextRecovery);
  });
  test.skip(!available,'The active browser does not expose WEBGL_lose_context.');
  await page.evaluate(()=>window.contextRecovery.loseContext());
  await expect.poll(async()=> (await diagnostics(page)).contextLost).toBe(true);
  const lost=await diagnostics(page);
  expect(lost.ready).toBe(false); expect(lost.firstFrameReady).toBe(false); expect(lost.pointerLocked).toBe(false);
  await expect(page.locator('#scene-start')).toBeHidden();
  await page.locator('#scene-retry').click();
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','loading');
  await page.waitForTimeout(350);
  expect((await diagnostics(page)).ready).toBe(false);
  expect(await page.locator('#lab-canvas').evaluate(canvas=>canvas.getContext('webgl2').isContextLost())).toBe(true);
  expect(await savedGame(page)).toBe(raw);
  await page.evaluate(()=>window.contextRecovery.restoreContext());
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','ready',{timeout:25000});
  const restored=await diagnostics(page);
  expect(restored.contextLost).toBe(false); expect(restored.firstFrameReady).toBe(true);
  expect(restored.renderedFrames).toBeGreaterThan(lost.renderedFrames);
  expect(restored.drawCalls).toBeGreaterThan(0);
  await page.locator('#scene-start').click(); await expect.poll(async()=> (await diagnostics(page)).pointerLocked).toBe(true);
  await page.keyboard.press('Escape'); await page.locator('#world-2d').click();
  await expect(page.locator('#mission-title')).toHaveText('노출된 서비스');
  expect(await savedGame(page)).toBe(raw);
});

test('3D tools preserve native dialogs and reject stale saves from another tab',async({page,context},testInfo)=>{
  test.skip(!main3D(testInfo));
  await start(page); await page.keyboard.press('Escape'); await page.locator('#world-notes').click();
  await page.locator('#hint').click(); const saved=await savedGame(page);
  for(const [opener,dialog] of [['#import-progress','#import-dialog'],['#reset-all','#reset-dialog']]) {
    await page.locator(opener).click(); await expect(page.locator(dialog)).toBeVisible();
    const controls=page.locator(`${dialog} button:enabled, ${dialog} input:enabled`);
    await controls.first().focus(); await page.keyboard.press('Shift+Tab');
    await expect.poll(()=>page.locator(dialog).evaluate(el=>el.contains(document.activeElement))).toBe(true);
    await controls.last().focus(); await page.keyboard.press('Tab');
    await expect.poll(()=>page.locator(dialog).evaluate(el=>el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape'); await expect(page.locator(dialog)).toBeHidden();
    await expect(page.locator('#lab-tools')).toBeVisible(); await expect(page.locator(opener)).toBeFocused();
    expect((await diagnostics(page)).toolsOpen).toBe(true);
    expect((await diagnostics(page)).pointerLocked).toBe(false);
    expect(await savedGame(page)).toBe(saved);
  }
  await page.keyboard.press('Escape'); await expect(page.locator('#lab-tools')).toBeHidden();
  await expect(page.locator('#world-notes')).toBeFocused();
  await expect(page.locator('#view-switch')).toBeEnabled();
  await page.locator('#world-notes').click();
  const other=await context.newPage(); await other.goto('/?view=2d');
  await expect(other.locator('#hint')).toHaveText('힌트 보기 (1/3)');
  await other.locator('#hint').click(); const latest=await savedGame(other);
  await expect(page.locator('#notice')).toContainText('다른 탭'); await page.locator('#hint').click();
  expect(await savedGame(page)).toBe(latest);
  await page.locator('#reload-progress').click();
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','ready',{timeout:25000});
  await page.locator('#world-notes').click(); await expect(page.locator('#hint')).toHaveText('힌트 보기 (2/3)');
  expect(await savedGame(page)).toBe(latest);
});

test('validated import remains usable inside the 3D overlay',async({page},testInfo)=>{
  test.skip(!main3D(testInfo));
  // Paused controls must remain clickable above the cover on a small screen.
  await page.setViewportSize({width:640,height:480});
  await start(page); await page.keyboard.press('Escape'); await page.locator('#world-notes').click();
  await page.locator('#import-progress').click();
  await page.locator('#progress-file').setInputFiles({name:'SecurityLab-progress.json',mimeType:'application/json',buffer:Buffer.from(exportGame(await tutorialComplete()))});
  await expect(page.locator('#confirm-import')).toBeEnabled(); await page.locator('#confirm-import').click();
  await expect(page.locator('#mission-title')).toHaveText('노출된 서비스');
  await expect(page.locator('#hud-title')).toHaveText('노출된 서비스');
  await expect(page.locator('#lab-tools')).toBeVisible();
  expect(JSON.parse(await savedGame(page)).game.active).toBe('services');
});

test('@windows-edge packaged 3D model displays an actual first frame',async({page},testInfo)=>{
  test.skip(!desktop3D(testInfo));
  await page.goto('/?view=3d');
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','ready',{timeout:25000});
  const d=await diagnostics(page);
  expect(d.firstFrameReady).toBe(true); expect(d.renderedFrames).toBeGreaterThan(0);
  expect(d.drawCalls).toBeGreaterThan(0); expect(d.colliders).toBeGreaterThan(25);
  await expect(page.locator('#scene-start')).toBeVisible();
});

test('@windows-edge door opening and WASD move through the physical doorway',async({page},testInfo)=>{
  test.skip(!desktop3D(testInfo));
  await start(page); await openMainDoor(page);
  const initial=(await diagnostics(page)).position;
  await walkUntil(page,'KeyW',{axis:'z',lt:9.7});
  const through=(await diagnostics(page)).position;
  expect(initial[2]-through[2]).toBeGreaterThan(1);
  await page.keyboard.press('Escape'); await expect(page.locator('#scene-cover')).toBeVisible();
});

test('@windows-edge lost graphics context stops navigation and continues in 2D',async({page},testInfo)=>{
  test.skip(!desktop3D(testInfo));
  const raw=await seedV2(page,await tutorialComplete()); await start(page);
  const available=await page.evaluate(()=>{
    const extension=document.getElementById('lab-canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
    if(extension) extension.loseContext(); return Boolean(extension);
  });
  test.skip(!available,'The active browser does not expose WEBGL_lose_context.');
  await expect.poll(async()=> (await diagnostics(page)).contextLost).toBe(true);
  expect((await diagnostics(page)).ready).toBe(false); expect((await diagnostics(page)).pointerLocked).toBe(false);
  await page.locator('#scene-fallback').click(); await expect(page.locator('#mission-title')).toHaveText('노출된 서비스');
  await expect(page.locator('#lab-world')).toBeHidden(); expect(await savedGame(page)).toBe(raw);
});
