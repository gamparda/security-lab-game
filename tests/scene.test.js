import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { overlaps, moveWithCollisions } from '../src/collision.js';
const wall={min:{x:-2,y:0,z:-.06},max:{x:2,y:3,z:.06}};
test('player cannot tunnel through narrow walls, even with a long move',()=>{
  const p=moveWithCollisions({x:0,z:2},0,-10,[wall]);
  assert.ok(p.z>=.31); assert.ok(p.z<.45);
});
test('player slides along walls and walks through a 1.28 m doorway',()=>{
  const p=moveWithCollisions({x:0,z:1},1.2,-2,[wall]);
  assert.ok(p.x>1.1); assert.ok(p.z>.31);
  const jambs=[{min:{x:-2,y:0,z:-.1},max:{x:-.64,y:3,z:.1}}, {min:{x:.64,y:0,z:-.1},max:{x:2,y:3,z:.1}}];
  assert.ok(moveWithCollisions({x:0,z:1},0,-2,jambs).z<-.9);
});
test('headers above the body and the floor do not block a grounded player',()=>{
  assert.equal(overlaps({x:0,z:0},{min:{x:-1,y:2.3,z:-1},max:{x:1,y:3,z:1}}),false);
  assert.equal(overlaps({x:0,z:0},{min:{x:-1,y:-.24,z:-1},max:{x:1,y:0,z:1}}),false);
  assert.equal(overlaps({x:0,z:0},wall),true);
});
const bytes=readFileSync(new URL('../assets/models/security_lab.glb',import.meta.url));
const length=bytes.readUInt32LE(12);
const gltf=JSON.parse(bytes.subarray(20,20+length).toString());
test('closed main door blocks frame-quantized walking at 60 FPS and dt 0.1',()=>{
  const door=gltf.nodes.find(n=>n.name==='DOOR_Main');
  const bounds=door.extras.collisionBounds,[x,y,z]=door.translation;
  const box={min:{x:x+bounds[0],y:y+bounds[2],z:z-bounds[4]},max:{x:x+bounds[3],y:y+bounds[5],z:z-bounds[1]}};
  const spawn=gltf.nodes.find(n=>n.name==='SPAWN_Player').translation;
  for(const dt of [1/60,.1]) {
    let position={x:spawn[0],z:spawn[2]};
    for(let frame=0;frame<120;frame++) position=moveWithCollisions(position,0,-2.6*dt,[box]);
    assert.ok(position.z<spawn[2]-1,'walking must advance before the closed door');
    assert.ok(position.z>=10.2 && position.z<10.32,`dt=${dt}: collision stops at ${position.z}`);
    assert.equal(overlaps(position,box),false);
    assert.deepEqual(moveWithCollisions(position,0,-2.6*dt,[box]),position,'held movement remains stopped');
    // The same movement crosses the doorway when the door is no longer blocking it.
    let open=position;
    for(let frame=0;frame<60;frame++) open=moveWithCollisions(open,0,-2.6*dt,[]);
    assert.ok(open.z<9.8,'opening the door must permit crossing the former boundary');
  }
});
test('real packed GLB has metre-scale rooms, named tools, hinged doors, spawn and colliders',()=>{
  assert.equal(bytes.readUInt32LE(0),0x46546c67); assert.equal(bytes.readUInt32LE(4),2);
  assert.equal(bytes.readUInt32LE(8),bytes.length);
  assert.equal(gltf.scenes.length,1); assert.ok(!gltf.nodes.some(n=>n.name==='Cube'));
  for(const name of ['ENV_Floor','ENV_Ceiling','INTERACT_ServerRack','INTERACT_AdminPC','INTERACT_Router','INTERACT_FileCabinet','INTERACT_Whiteboard','DOOR_Main','DOOR_ServerRoom','DOOR_RecordsRoom','SPAWN_Player']) assert.ok(gltf.nodes.some(n=>n.name===name),name);
  assert.ok(gltf.nodes.filter(n=>n.name?.startsWith('COLLIDER_')).length>=25);
  for(const name of ['DOOR_Main','DOOR_ServerRoom','DOOR_RecordsRoom']) {
    const door=gltf.nodes.find(n=>n.name===name);
    assert.ok(Number.isFinite(door.translation[0])); assert.equal(door.translation[1],0);
    assert.equal(door.extras.width,1.28); assert.equal(door.extras.height,2.3);
    assert.ok(door.extras.openAngleDegrees>=90); assert.ok(door.children.length>0);
  }
  assert.ok(gltf.buffers.every(b=>!b.uri)); assert.ok(gltf.images.every(i=>i.bufferView!==undefined));
  assert.ok(gltf.nodes.every(n=>!n.scale || n.scale.every(s=>s>0)));
  assert.ok(bytes.length<12*1024*1024);
});
test('runtime library graph is local; simulation state schema remains untouched',()=>{
  for(const path of ['loaders/GLTFLoader.js','controls/PointerLockControls.js','utils/BufferGeometryUtils.js','utils/SkeletonUtils.js']) {
    const source=readFileSync(new URL('../vendor/three/examples/jsm/'+path,import.meta.url),'utf8');
    const code=source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
    assert.ok(!/^.*from ['"](?:three|https?:)/m.test(code));
  }
  const source=readFileSync(new URL('../src/scene3d.js',import.meta.url),'utf8');
  assert.ok(source.includes("fetch('assets/models/security_lab.glb'"));
  assert.ok(!source.includes('runCommand('));
});
