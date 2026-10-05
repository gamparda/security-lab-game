import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Matrix4, Quaternion, Vector3, Group, Mesh, BoxGeometry, MeshStandardMaterial, MeshPhysicalMaterial } from '../vendor/three/build/three.module.js';
import { MeshoptDecoder } from '../vendor/three/examples/jsm/libs/meshopt_decoder.module.js';
import { batchStatic, isSoftwareRenderer, prepareMaterials } from '../src/batch3d.js';
import { route, routeColliders } from './browser/scene-route.js';
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
const modelReport=JSON.parse(readFileSync(new URL('../assets/models/security_lab.json',import.meta.url)));
const baseline=JSON.parse(readFileSync(new URL('../assets/models/security_lab_functional.json',import.meta.url)));

test('Corporate export retains all 76 functional world transforms and bindings',()=>{
  const parents=new Map();
  gltf.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>parents.set(c,i)));
  function world(i) {
    const n=gltf.nodes[i];
    const m=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(
      new Vector3(...(n.translation||[0,0,0])),new Quaternion(...(n.rotation||[0,0,0,1])),new Vector3(...(n.scale||[1,1,1])));
    return parents.has(i)?world(parents.get(i)).multiply(m):m;
  }
  const conversion=new Matrix4().set(1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1);
  for(const [name,snapshot] of Object.entries(baseline)) {
    const i=gltf.nodes.findIndex(n=>n.name===name);
    assert.ok(i>=0,name);
    const original=new Matrix4().set(...snapshot.world.flat());
    const expected=new Matrix4().multiplyMatrices(conversion,original).multiply(conversion.clone().invert());
    assert.ok(world(i).elements.every((v,j)=>Math.abs(v-expected.elements[j])<1e-5),name+' world transform');
    for(const key of ['interaction','width','height','openAngleDegrees','collisionBounds','label']) {
      if(key in snapshot.props) assert.deepEqual(gltf.nodes[i].extras[key],snapshot.props[key],name+' '+key);
    }
  }
  assert.equal(Object.keys(baseline).length,76);
  assert.equal(gltf.nodes.filter(n=>n.name?.startsWith('COLLIDER_')).length,89);
});

test('Corporate compressed asset decodes with exact protected geometry and full detail',async()=>{
  await MeshoptDecoder.ready;
  const binary=bytes.subarray(20+length+8), quantized=new Set(modelReport.quantizedViews);
  for(const [i,view] of gltf.bufferViews.entries()) {
    const e=view.extensions?.EXT_meshopt_compression;
    const decoded=e?new Uint8Array(e.count*e.byteStride):binary.subarray(view.byteOffset,view.byteOffset+view.byteLength);
    if(e) MeshoptDecoder.decodeGltfBuffer(decoded,e.count,e.byteStride,binary.subarray(e.byteOffset,e.byteOffset+e.byteLength),e.mode,e.filter);
    if(!quantized.has(i)) assert.equal(createHash('sha256').update(decoded).digest('hex'),modelReport.uncompressedViewSHA256[i],'view '+i);
    else {
      const floats=new Float32Array(decoded.buffer,decoded.byteOffset,decoded.byteLength/4);
      assert.ok(floats.every(Number.isFinite),'finite view '+i);
      for(const a of gltf.accessors.filter(a=>a.bufferView===i && a.min)) {
        const width=a.type==='VEC3'?3:a.type==='VEC2'?2:4;
        for(let j=0;j<floats.length;j++) assert.ok(floats[j]>=a.min[j%width]-.0002 && floats[j]<=a.max[j%width]+.0002,'position bounds '+i);
      }
    }
  }
  assert.equal(bytes.length,modelReport.glbBytes);
  assert.equal(modelReport.triangles,6968337);
  assert.equal(modelReport.embeddedImages,52);
  assert.ok(gltf.extensionsRequired.includes('EXT_meshopt_compression'));
});

test('static batching preserves transformed instances, materials, and functional roots',()=>{
  const model=new Group();model.position.set(4,0,3);
  const geometry=new BoxGeometry(),material=new MeshStandardMaterial();
  const originals=[];
  for(const x of [1,3,5]) {const mesh=new Mesh(geometry,material);mesh.position.x=x;model.add(mesh);originals.push(mesh);}
  const root=new Group();root.userData.interaction='door';model.add(root);
  const leaf=new Mesh(geometry,material);root.add(leaf);
  const multi=new Mesh(new BoxGeometry(),[material,material]);model.add(multi);
  model.updateMatrixWorld(true);
  const positions=originals.map(o=>o.getWorldPosition(new Vector3()));
  batchStatic(model);model.updateMatrixWorld(true);
  const instance=model.children.find(o=>o.isInstancedMesh);
  assert.equal(instance.count,3);assert.equal(instance.geometry,geometry);
  positions.forEach((p,i)=>{const matrix=new Matrix4();instance.getMatrixAt(i,matrix);assert.ok(new Vector3().setFromMatrixPosition(instance.matrixWorld.clone().multiply(matrix)).distanceTo(p)<1e-6);});
  assert.ok(originals.every(o=>!o.visible));assert.equal(leaf.visible,true);assert.equal(multi.visible,true);
});
test('software glass removes the extra room pass without changing geometry or interaction occlusion',()=>{
  for(const [name,software] of [['ANGLE (Google, Vulkan SwiftShader)',true],['ANGLE (Microsoft Basic Render Driver)',true],['ANGLE (NVIDIA RTX 5060 Ti)',false]]) {
    const gl={getExtension:()=>({UNMASKED_RENDERER_WEBGL:1}),getParameter:()=>name};
    assert.equal(isSoftwareRenderer(gl),software);
  }
  assert.equal(isSoftwareRenderer({getExtension:()=>null}),false);
  const root=new Group(),glass=new MeshPhysicalMaterial({transmission:1,roughness:.15});
  const mesh=new Mesh(new BoxGeometry(),glass);root.add(mesh);
  const positions=mesh.geometry.attributes.position.array.slice();
  prepareMaterials(root,false);assert.equal(glass.transmission,1);
  prepareMaterials(root,true);
  assert.equal(glass.transmission,0);assert.equal(glass.transparent,true);
  assert.equal(glass.userData.interactionOpaque,true);
  assert.deepEqual(mesh.geometry.attributes.position.array,positions);
});
test('physical route connects a safe player position inside the grid clearance margin',()=>{
  const position=[-3.5658678169949205,1.65,3.331259219604996];
  const doors=gltf.nodes.filter(n=>n.extras?.interaction==='door').map(n=>({name:n.name,pivot:n.translation,angle:n.name==='DOOR_Main'?100*Math.PI/180:0}));
  const path=route(position,[-5.3,.1],doors);
  assert.deepEqual(path[0],[position[0],position[2]]);
  assert.deepEqual(path.at(-1),[-5.300000000000001,.1]);
  assert.ok(path.length>2);
  assert.throws(()=>route(position,[-8,-5],doors),/obstructed/);
});
test('real lab routes remove tiny grid turns while every shortcut remains physically walkable',()=>{
  const doors=gltf.nodes.filter(n=>n.extras?.interaction==='door').map(n=>({name:n.name,pivot:n.translation,angle:n.extras.openAngleDegrees*Math.PI/180}));
  const boxes=routeColliders(doors);
  // Actual software-rendered positions from the failing multi-device walk.
  for(const [origin,destination] of [
    [[-3.5844023,1.65,3.27903565],[-5.3,-.6]],
    [[-7.1,1.65,-3.5],[2.4,.1]],
    [[5.8,1.65,-.39],[6.2,-7]],
  ]) {
    const path=route(origin,destination,doors);
    assert.ok(path.length<=8,'navigate clear aisles without a succession of 10 cm stops');
    for(let i=1;i<path.length;i++) {
      const [x,z]=path[i-1],[tx,tz]=path[i];
      const moved=moveWithCollisions({x,z},tx-x,tz-z,boxes);
      assert.ok(Math.hypot(moved.x-tx,moved.z-tz)<1e-5,'shortcuts must never cut through furniture, walls or door leaves');
    }
  }
});
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
  assert.ok(bytes.length<256*1024*1024);
});
test('runtime library graph is local; simulation state schema remains untouched',()=>{
  for(const path of ['loaders/GLTFLoader.js','controls/PointerLockControls.js','utils/BufferGeometryUtils.js','utils/SkeletonUtils.js','libs/meshopt_decoder.module.js','environments/RoomEnvironment.js']) {
    const source=readFileSync(new URL('../vendor/three/examples/jsm/'+path,import.meta.url),'utf8');
    const code=source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
    assert.ok(!/^.*from ['"](?:three|https?:)/m.test(code));
  }
  const source=readFileSync(new URL('../src/scene3d.js',import.meta.url),'utf8');
  assert.ok(source.includes("fetch('assets/models/security_lab.glb'"));
  assert.ok(!source.includes('runCommand('));
});
