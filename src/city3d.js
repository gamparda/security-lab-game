import * as THREE from '../vendor/three/build/three.module.js';

// A distant photographic skyline, two real instanced building bands and a
// river/bridge below the office. Nothing follows the camera or window plane.
export async function createCity(renderer) {
 const root=new THREE.Group();root.name='Exterior_Sunset_City';root.userData.zone='Exterior';
 const texture=await new THREE.TextureLoader().loadAsync('assets/environment/city-sunset.png');
 texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
 const panorama=new THREE.Mesh(new THREE.PlaneGeometry(1600,900.5),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}));
 panorama.name='Exterior_Distant_Panorama';panorama.position.set(-420,-120,0);panorama.rotation.y=Math.PI/2;root.add(panorama);
 const facade=new THREE.MeshStandardMaterial({color:0x18212e,roughness:.78,metalness:.18});
 facade.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 cityPosition;').replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvec4 cityWorld=vec4(transformed,1.0);\n#ifdef USE_INSTANCING\ncityWorld=instanceMatrix*cityWorld;\n#endif\ncityPosition=(modelMatrix*cityWorld).xyz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 cityPosition;').replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
   vec2 grid=vec2(cityPosition.x+cityPosition.z,cityPosition.y)/vec2(2.35,2.8);
   vec2 cell=fract(grid);float lit=step(.67,fract(sin(dot(floor(grid),vec2(127.1,311.7)))*43758.5453));
   float windowMask=step(.24,cell.x)*step(cell.x,.68)*step(.24,cell.y)*step(cell.y,.62);
   diffuseColor.rgb*=mix(.56,1.0,windowMask);
   totalEmissiveRadiance+=vec3(1.0,.53,.20)*windowMask*lit*.85;`);
 };
 facade.customProgramCacheKey=()=> 'city-facade-1';
 const box=new THREE.BoxGeometry(1,1,1),buildings=new THREE.InstancedMesh(box,facade,60),matrix=new THREE.Matrix4();
 buildings.name='Exterior_Near_Mid_Buildings';let seed=831;
 const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<60;i++){
  const near=i<18,x=near?-48-rand()*62:-150-rand()*100,z=near?(i-9)*20+(rand()-.5)*7:(i-39)*16;
  const w=near?7+rand()*6:7+rand()*10,d=6+rand()*10,h=near?22+rand()*26:35+rand()*40;
  matrix.compose(new THREE.Vector3(x,-64+h/2,z),new THREE.Quaternion(),new THREE.Vector3(d,h,w));buildings.setMatrixAt(i,matrix);
 }
 buildings.computeBoundingSphere();root.add(buildings);
 const river=new THREE.Mesh(new THREE.PlaneGeometry(110,820),new THREE.MeshStandardMaterial({color:0x243a4d,roughness:.24,metalness:.7}));
 river.name='Exterior_River';river.rotation.x=-Math.PI/2;river.position.set(-120,-63.8,0);root.add(river);
 const roadMaterial=new THREE.MeshStandardMaterial({color:0x32393d,roughness:.8});
 const bridge=new THREE.Mesh(new THREE.BoxGeometry(160,1,9),roadMaterial);bridge.position.set(-130,-59,64);bridge.name='Exterior_Bridge';root.add(bridge);
 const lamps=new THREE.InstancedMesh(new THREE.BoxGeometry(.28,.32,.28),new THREE.MeshBasicMaterial({color:0xffbc68}),56);
 for(let i=0;i<56;i++){matrix.makeTranslation(-208+(i%28)*5.8,-57.8,64+(i<28?-4.1:4.1));lamps.setMatrixAt(i,matrix);}lamps.computeBoundingSphere();root.add(lamps);
 // The same sky and skyline contribute to glass reflections alongside the
 // indoor PMREM. A separate env texture avoids an expensive refraction pass.
 const reflectionScene=new THREE.Scene();reflectionScene.background=new THREE.Color(0x56697f);
 reflectionScene.add(panorama.clone());reflectionScene.add(buildings.clone());
 const warm=new THREE.DirectionalLight(0xffbf7d,2);warm.position.set(-400,80,0);reflectionScene.add(warm,new THREE.HemisphereLight(0xaebcdb,0x273240,1.3));
 const pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(reflectionScene,.08,.1,900,{size:128});pmrem.dispose();
 return {root,environment,panorama,buildingCount:60};
}

export function refineGlass(model,cityEnvironment) {
 const materials=new Set();model.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});
 for(const m of materials)if(m.transmission>0||/glass/i.test(m.name)){
  if(!m.isMeshPhysicalMaterial)continue;
  const etched=/etch/i.test(m.name);
  // Visibility through glass and physical interaction through a pane are
  // separate decisions. Keep the original interaction barrier unchanged.
  const interactionBarrier=m.userData.interactionOpaque??(!m.transparent||m.opacity>.5);
  m.transmission=0;m.transparent=true;m.opacity=etched?.25:.065;m.depthWrite=false;
  m.roughness=etched?.34:.09;m.metalness=.05;m.ior=1.5;m.clearcoat=.4;m.clearcoatRoughness=.08;
  m.userData.interactionOpaque=interactionBarrier;m.userData.visibilityOpaque=false;m.userData.glass=true;
  if(cityEnvironment){m.envMap=cityEnvironment;m.envMapIntensity=.25;}
  m.onBeforeCompile=shader=>{
   shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 glassPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nglassPosition=position;');
   shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 glassPosition;').replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
    float dust=sin(dot(glassPosition,vec3(71.0,79.0,67.0)))*sin(dot(glassPosition,vec3(113.0,97.0,101.0)));
    roughnessFactor=clamp(roughnessFactor+dust*.012,.04,1.0);`)
    .replace('#include <opaque_fragment>',`float facing=abs(dot(normal,normalize(vViewPosition)));
     diffuseColor.a=clamp(diffuseColor.a+.36*pow(1.0-facing,5.0),0.0,.7);
     #include <opaque_fragment>`);
  };
  m.customProgramCacheKey=()=> 'glass-fresnel-dust-2';m.needsUpdate=true;
 }
}
