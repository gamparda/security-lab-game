import {test,expect} from '@playwright/test';
import {route} from './scene-route.js';
import {CURRENT_SAVE_KEY} from '../../src/storage.js';
const diagnostics=page=>page.evaluate(async()=>(await import('/src/scene-entry.js')).get3DDiagnostics());
async function aim(page,x,y,z){
 const d=await diagnostics(page),[px,py,pz]=d.position,yaw=Math.atan2(-(x-px),-(z-pz)),pitch=Math.atan2(y-py,Math.hypot(x-px,z-pz));
 const delta=Math.atan2(Math.sin(yaw-d.yaw),Math.cos(yaw-d.yaw));
 await page.evaluate(({movementX,movementY})=>document.dispatchEvent(new MouseEvent('mousemove',{movementX,movementY})),{movementX:Math.round(-delta/.0014),movementY:Math.round(-(pitch-d.pitch)/.0014)});
}
async function walk(page,key,condition){
 await page.evaluate(async({key,condition})=>{
  const {get3DDiagnostics}=await import('/src/scene-entry.js');let start=0,timer;const state=window.smokeWalk={done:false,error:null};
  const finish=error=>{if(state.done)return;state.done=true;state.error=error||null;clearTimeout(timer);document.dispatchEvent(new KeyboardEvent('keyup',{code:key,bubbles:true}));};
  const tick=()=>{if(state.done)return;const d=get3DDiagnostics(),value=d.position[condition.axis==='x'?0:2];if(!d.pointerLocked)return finish('lost pointer lock');
   if(condition.seconds!==undefined?d.movementSeconds-start>=condition.seconds:condition.lt!==undefined?value<condition.lt:value>condition.gt)finish();else requestAnimationFrame(tick);
  };
  document.addEventListener('keydown',function begin(e){if(e.code!==key)return;document.removeEventListener('keydown',begin);start=get3DDiagnostics().movementSeconds;timer=setTimeout(()=>finish('walk timed out'),16000);requestAnimationFrame(tick);});
 },{key,condition});
 await page.keyboard.down(key);
 try{await expect.poll(()=>page.evaluate(()=>window.smokeWalk.done),{timeout:30000,intervals:[100]}).toBe(true);expect(await page.evaluate(()=>window.smokeWalk.error)).toBeNull();}
 finally{await page.keyboard.up(key);}
}
async function walkTo(page,x,z){
 const d=await diagnostics(page);
 for(const [tx,tz]of route(d.position,[x,z],d.doors).slice(1)){
  const before=await diagnostics(page),[px,py,pz]=before.position;if(Math.hypot(tx-px,tz-pz)<.2)continue;
  await aim(page,tx,py,tz);const axis=Math.abs(tx-px)>Math.abs(tz-pz)?'x':'z',goal=axis==='x'?tx:tz,from=axis==='x'?px:pz;
  await walk(page,'KeyW',{axis,...(goal<from?{lt:goal}:{gt:goal})});
 }
}
test('Windows Chrome: packaged first frame, collision, door, WASD, INTERACT, mission and save',async({page})=>{
 test.setTimeout(150000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 if(process.env.CI)await page.setViewportSize({width:1280,height:720});
 await page.goto('/?view=3d');
 await expect(page.locator('#lab-world')).toHaveAttribute('data-state','ready',{timeout:65000});
 const initial=await diagnostics(page);expect(initial.firstFrameReady).toBe(true);expect(initial.drawCalls).toBeGreaterThan(0);expect(initial.colliders).toBe(89);expect(initial.cityBuildings).toBeGreaterThan(0);
 await page.locator('#scene-start').click();await expect.poll(async()=>(await diagnostics(page)).pointerLocked).toBe(true);
 await page.keyboard.down('ControlLeft');
 await expect.poll(async()=>(await diagnostics(page)).crouched).toBe(true);
 await expect.poll(async()=>(await diagnostics(page)).position[1]).toBeLessThan(1.05);
 expect((await diagnostics(page)).bodyHeight).toBe(1.1);
 await page.keyboard.up('ControlLeft');
 await expect.poll(async()=>(await diagnostics(page)).position[1]).toBeGreaterThan(1.6);
 await page.keyboard.down('Space');
 await expect.poll(async()=>(await diagnostics(page)).grounded,{intervals:[30]}).toBe(false);
 await expect.poll(async()=>(await diagnostics(page)).position[1],{intervals:[30]}).toBeGreaterThan(1.95);
 await expect.poll(async()=>(await diagnostics(page)).grounded,{intervals:[50]}).toBe(true);
 // Held/repeated Space cannot continuously bounce after landing.
 await page.waitForTimeout(200);expect((await diagnostics(page)).feetY).toBe(0);
 await page.keyboard.up('Space');
 await aim(page,0,1.65,9);await walk(page,'KeyW',{axis:'z',lt:10.32});
 await walk(page,'KeyW',{seconds:.2});expect((await diagnostics(page)).position[2]).toBeGreaterThanOrEqual(10.2);
 await expect.poll(async()=>(await diagnostics(page)).target).toBe('DOOR_Main');await page.keyboard.press('KeyE');
 await expect.poll(async()=>(await diagnostics(page)).doors[0].angle,{timeout:15000}).toBeCloseTo(100*Math.PI/180,2);
 expect((await diagnostics(page)).doors[0].pivot[0]).toBeCloseTo(-.64,2);
 await walk(page,'KeyW',{axis:'z',lt:6.5});await walkTo(page,-3.4,3.2);await aim(page,-5.2,1.25,2.85);
 await expect.poll(async()=>(await diagnostics(page)).target,{timeout:15000}).toBe('INTERACT_AdminPC');await page.keyboard.press('KeyE');
 await expect(page.locator('#panel-terminal')).toBeVisible();expect((await diagnostics(page)).pointerLocked).toBe(false);
 for(const command of ['help','inspect approval']){await page.locator('#command').fill(command);await page.locator('#command').press('Enter');await expect(page.locator('#command')).toBeEnabled();}
 await page.locator('#answer-0').check();await page.locator('#verify').click();await expect(page.locator('#next')).toBeVisible();await page.locator('#next').click();
 await expect(page.locator('#hud-title')).toHaveText('노출된 서비스');await expect(page.locator('#save-status')).not.toHaveText('저장 중…');
 const saved=await page.evaluate(key=>localStorage.getItem(key),CURRENT_SAVE_KEY);expect(JSON.parse(saved).game.active).toBe('services');
 await page.locator('#tool-close').click();await page.locator('#world-2d').click();
 await page.reload();await expect(page.locator('#mission-title')).toHaveText('노출된 서비스');expect(await page.evaluate(key=>localStorage.getItem(key),CURRENT_SAVE_KEY)).toBe(saved);
 expect(errors).toEqual([]);
});
