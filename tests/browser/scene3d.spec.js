import { test, expect } from '@playwright/test';
import { SAVE_KEY } from '../../src/storage.js';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const diagnostics=page=>page.evaluate(async()=> (await import('/src/scene3d.js')).get3DDiagnostics());
async function capture(page,file) {
  if(!process.env.LAB_SCREENSHOT_DIR) return;
  await mkdir(process.env.LAB_SCREENSHOT_DIR,{recursive:true});
  await page.screenshot({path:join(process.env.LAB_SCREENSHOT_DIR,file)});
}
async function start(page) {
  await page.goto('/?view=3d');
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','ready',{timeout:25000});
  await page.locator('#scene-start').click();
  await expect.poll(async()=> (await diagnostics(page)).pointerLocked).toBe(true);
}
async function walkUntil(page,key,predicate,timeout=16000) {
  await page.keyboard.down(key);
  try { await expect.poll(async()=>predicate(await diagnostics(page)),{timeout,intervals:[40,70,100]}).toBe(true); }
  finally { await page.keyboard.up(key); }
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
  await page.locator('#scene-start').click();
  await expect.poll(async()=> (await diagnostics(page)).pointerLocked).toBe(true);
}

test('3D actual movement, closed-door collision, hinge rotation, mouse and pause',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='mobile','Mouse and keyboard navigation uses the desktop project.');
  const errors=[],violations=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',e=>window.cspErrors=(window.cspErrors||[]).concat(e.violatedDirective)));
  await start(page);
  const initial=await diagnostics(page);
  expect(initial.position[1]).toBe(1.65); expect(initial.colliders).toBeGreaterThan(25);
  await walkUntil(page,'KeyW',d=>d.position[2]<10.25);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(350); await page.keyboard.up('KeyW');
  expect((await diagnostics(page)).position[2]).toBeGreaterThan(10.2);
  await expect(page.locator('#interaction-prompt')).toContainText('문 열기');
  await page.keyboard.press('KeyE');
  await expect.poll(async()=> (await diagnostics(page)).doors[0].angle).toBeCloseTo(100*Math.PI/180,2);
  expect((await diagnostics(page)).doors[0].pivot[0]).toBeCloseTo(-.64,2);
  await walkUntil(page,'KeyW',d=>d.position[2]<6.5);
  const walking=(await diagnostics(page)).position[2];
  await page.keyboard.down('KeyW'); await page.waitForTimeout(400); await page.keyboard.up('KeyW');
  const walkDistance=walking-(await diagnostics(page)).position[2];
  const sprinting=(await diagnostics(page)).position[2];
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await page.waitForTimeout(400);
  await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  expect(sprinting-(await diagnostics(page)).position[2]).toBeGreaterThan(walkDistance*1.3);
  await page.setViewportSize({width:1200,height:800});
  expect((await page.locator('#lab-canvas').boundingBox()).width).toBe(1200);
  const before=await diagnostics(page);
  await page.mouse.move(800,400); await page.mouse.move(1000,400);
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
  test.skip(testInfo.project.name==='mobile','Detailed spatial route is tested with desktop input.');
  test.setTimeout(120000);
  await start(page); await page.keyboard.press('KeyE'); await page.waitForTimeout(550);
  await capture(page,'02-door-open.png');
  await walkUntil(page,'KeyW',d=>d.position[2]<6);
  await aim(page,-3,1.5,0); await capture(page,'01-lab-overview.png');
  // Main operations PC: approach along its southern aisle, aiming at the screen.
  await aim(page,-5,1.65,6); await walkUntil(page,'KeyW',d=>d.position[0]<-4.85);
  await aim(page,-5.2,1.25,2.85);
  await walkUntil(page,'KeyW',d=>d.target==='INTERACT_AdminPC');
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
  await aim(page,0,1.65,6); await walkUntil(page,'KeyW',d=>d.position[0]>-.12);
  await aim(page,0,1.65,-.8); await walkUntil(page,'KeyW',d=>d.position[2]<.1);
  await aim(page,-5.3,1.65,.1); await walkUntil(page,'KeyW',d=>d.position[0]<-5.1);
  await aim(page,-5.3,1.45,-2);
  await expect.poll(async()=> (await diagnostics(page)).target).toBe('DOOR_ServerRoom');
  await page.keyboard.press('KeyE');
  await expect.poll(async()=> (await diagnostics(page)).doors.find(d=>d.name==='DOOR_ServerRoom').angle).toBeCloseTo(95*Math.PI/180,2);
  await aim(page,-5.3,1.65,-3.0); await walkUntil(page,'KeyW',d=>d.position[2]<-3.0);
  await aim(page,-7.1,1.3,-4.55);
  await expect.poll(async()=> (await diagnostics(page)).target).toBe('INTERACT_ServerRack');
  await capture(page,'03-server-rack.png');
  await page.keyboard.press('KeyE'); await expect(page.locator('#panel-terminal')).toBeVisible();
  await capture(page,'04-terminal-overlay.png');
  await page.locator('#command').fill('scan club-server'); await page.locator('#command').press('Enter');
  await expect(page.locator('#terminal')).toContainText('8080');
  const save=await page.evaluate(key=>localStorage.getItem(key),SAVE_KEY);
  expect(JSON.parse(save).active).toBe(1);
  await closeAndResume(page);
  // Leave the server suite through the same physical doorway, then the whiteboard.
  await aim(page,-5.3,1.65,0); await walkUntil(page,'KeyW',d=>d.position[2]>0);
  await aim(page,0,1.65,0); await walkUntil(page,'KeyW',d=>d.position[0]>-.1);
  await aim(page,2,1.7,-.82);
  await expect.poll(async()=> (await diagnostics(page)).target).toBe('INTERACT_Whiteboard');
  await page.keyboard.press('KeyE'); await expect(page.locator('#tool-source')).toContainText('화이트보드');
  await expect(page.locator('#hint')).toHaveText('힌트 보기 (0/3)');
  await closeAndResume(page);
  // Network bench along its clear southern approach.
  await aim(page,0,1.65,3.8); await walkUntil(page,'KeyW',d=>d.position[2]>3.5);
  await aim(page,7,1.65,3.8); await walkUntil(page,'KeyW',d=>d.position[0]>6.85);
  await aim(page,7,1.06,1.65);
  await expect.poll(async()=> (await diagnostics(page)).target).toBe('INTERACT_Router');
  await page.keyboard.press('KeyE'); await expect(page.locator('#panel-settings')).toBeVisible();
  await expect(page.locator('#port-8080')).toHaveValue('allow');
  await closeAndResume(page);
  // The records room has its own actual door, independent of the server suite.
  await aim(page,5.3,1.65,3.8); await walkUntil(page,'KeyW',d=>d.position[0]<5.4);
  await aim(page,5.3,1.65,0); await walkUntil(page,'KeyW',d=>d.position[2]<.1);
  await aim(page,5.3,1.45,-2);
  await expect.poll(async()=> (await diagnostics(page)).target).toBe('DOOR_RecordsRoom');
  await page.keyboard.press('KeyE');
  await expect.poll(async()=> (await diagnostics(page)).doors.find(d=>d.name==='DOOR_RecordsRoom').angle).toBeCloseTo(95*Math.PI/180,2);
  await aim(page,5.3,1.65,-5.9); await walkUntil(page,'KeyW',d=>d.position[2]<-5.8);
  await aim(page,7.4,1.2,-7.45);
  await walkUntil(page,'KeyW',d=>d.target==='INTERACT_FileCabinet');
  await page.keyboard.press('KeyE'); await expect(page.locator('#panel-files')).toBeVisible();
  await expect(page.locator('#tool-source')).toContainText('자료 보관함');
  await closeAndResume(page);
  await page.keyboard.press('Escape'); await page.locator('#world-2d').click();
  await expect(page.locator('#lab-tools')).toBeVisible();
  await page.reload(); await expect(page.locator('#mission-title')).toHaveText('노출된 서비스');
  expect(await page.evaluate(key=>localStorage.getItem(key),SAVE_KEY)).toBe(save);
});

test('door closing stops for a player in its sweep, then closes when clear',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='mobile');
  await start(page); await page.keyboard.press('KeyE'); await page.waitForTimeout(550);
  await walkUntil(page,'KeyW',d=>d.position[2]<9.88);
  await aim(page,-.72,1.4,9.4);
  await expect.poll(async()=> (await diagnostics(page)).target).toBe('DOOR_Main');
  await page.keyboard.press('KeyE'); await page.waitForTimeout(650);
  expect((await diagnostics(page)).doors[0].angle).toBeGreaterThan(.2);
  await aim(page,0,1.65,8.2); await walkUntil(page,'KeyW',d=>d.position[2]<8.35);
  await aim(page,-.83,1.4,8.8);
  await expect.poll(async()=> (await diagnostics(page)).target).toBe('DOOR_Main');
  await page.keyboard.press('KeyE');
  await expect.poll(async()=> (await diagnostics(page)).doors[0].angle).toBeCloseTo(0,2);
});

test('all original missions finish inside the 3D overlay and restore after reload',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='mobile');
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
  await page.reload(); await expect(page.locator('#lab-world')).toHaveAttribute('data-state','ready');
  await page.locator('#world-notes').click(); await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('.mission-step.complete')).toHaveCount(4);
});

test('model failure offers retry and 2D continuation; no external requests',async({page},testInfo)=>{
  test.skip(testInfo.project.name==='mobile');
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

test('unresponsive model has a bounded loading timeout and mobile defaults to tools',async({page},testInfo)=>{
  if(testInfo.project.name==='mobile') {
    await page.goto('/'); await expect(page.locator('#lab-tools')).toBeVisible();
    await expect(page.locator('#lab-world')).toBeHidden(); return;
  }
  await page.clock.install();
  await page.route('**/assets/models/security_lab.glb',()=>new Promise(()=>{}));
  await page.goto('/?view=3d');
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','loading');
  await page.clock.fastForward(21000);
  await expect(page.locator('#lab-world')).toHaveAttribute('data-state','error');
  await page.locator('#scene-fallback').click(); await expect(page.locator('#mission-title')).toBeVisible();
});
