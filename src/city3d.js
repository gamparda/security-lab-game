import * as THREE from '../vendor/three/build/three.module.js';

// Fixed world layers use the shipped reconstruction and visibility paths.
// No per-window lights, extra render pass or camera-following background.
const GROUND=-64;
export const CITY_SUN=new THREE.Vector3(-.973,.10,-.208).normalize();
export const BACKDROP_RADIUS=960;
const PHOTO_COVERAGE=220*Math.PI/180;
const hashGLSL=`float cityHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}`;
function random(seed=831){return ()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}

// Closed curved dome. The horizontal join faces east behind the office.
// Capping the vertical coverage also protects steep upward near-window views.
export function backdropGeometry(){
 const vertices=[],uv=[],indices=[],segments=128,rows=48;
 for(let j=0;j<=rows;j++)for(let i=0;i<=segments;i++){
  const angle=-Math.PI+i/segments*Math.PI*2,latitude=-Math.PI/2+j/rows*Math.PI;
  const y=Math.sin(latitude)*BACKDROP_RADIUS,r=Math.cos(latitude)*BACKDROP_RADIUS;
  vertices.push(-Math.cos(angle)*r,y,Math.sin(angle)*r);uv.push(.5-angle/PHOTO_COVERAGE,(y+1194)/1900);
  if(i<segments&&j<rows){const a=j*(segments+1)+i,b=a+segments+1;indices.push(a,b,a+1,b,b+1,a+1);}
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();return g;
}
function panoramaMaterial(texture){
 const m=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,toneMapped:false});
 m.onBeforeCompile=s=>{
  s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
   vec2 photoUV=clamp(vMapUv,vec2(.001),vec2(.999));
   vec4 sampledDiffuseColor=texture2D(map,photoUV);
   float edge=smoothstep(.035,.12,vMapUv.x)*(1.0-smoothstep(.88,.965,vMapUv.x));
   vec3 haze=mix(vec3(.09,.12,.18),vec3(.44,.29,.29),smoothstep(.40,.70,vMapUv.y));
   haze=mix(haze,vec3(.16,.22,.31),smoothstep(.70,1.0,vMapUv.y));
   float luminance=dot(sampledDiffuseColor.rgb,vec3(.2126,.7152,.0722));
   sampledDiffuseColor.rgb=mix(vec3(luminance),sampledDiffuseColor.rgb,.94)*.90;
   edge*=1.0-smoothstep(.95,1.10,vMapUv.y);
   diffuseColor*=vec4(mix(haze,sampledDiffuseColor.rgb,edge),sampledDiffuseColor.a);
   #endif`);
 };m.customProgramCacheKey=()=> 'city-dome-photo-2';return m;
}

// Local metres keep window proportions consistent on differently sized boxes.
// Baked sunset/ambient response is independent of the strong indoor lights.
function facadeMaterial(color,family){
 const m=new THREE.MeshBasicMaterial({color});
 m.onBeforeCompile=s=>{
  s.vertexShader=s.vertexShader.replace('#include <common>',`#include <common>
   attribute vec3 citySize;attribute vec3 citySeed;
   varying vec3 cityLocal;varying vec3 cityWorld;varying vec3 cityNormal;varying vec3 cityVariation;`)
   .replace('#include <begin_vertex>',`#include <begin_vertex>
    cityLocal=(position+0.5)*citySize;cityNormal=normal;cityVariation=citySeed;`)
   .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
    vec4 cityPoint=vec4(transformed,1.0);
    #ifdef USE_INSTANCING
    cityPoint=instanceMatrix*cityPoint;
    #endif
    cityWorld=(modelMatrix*cityPoint).xyz;`);
  s.fragmentShader=s.fragmentShader.replace('#include <common>',`#include <common>
   varying vec3 cityLocal;varying vec3 cityWorld;varying vec3 cityNormal;varying vec3 cityVariation;
   ${hashGLSL}`)
   .replace('#include <color_fragment>',`#include <color_fragment>
    vec3 n=normalize(cityNormal);float wall=1.0-step(.6,abs(n.y));
    float stableSeed=floor(cityVariation.x+.5);
    float along=abs(n.x)>.5?cityLocal.z:cityLocal.x;
    float pitch=${family===0||family===4?'1.55':'2.25'};
    vec2 grid=vec2(along/pitch,cityLocal.y/3.0),cell=fract(grid),id=floor(grid);
    vec2 aa=max(fwidth(grid),vec2(.001));
    vec2 mask=smoothstep(vec2(.16,.19)-aa,vec2(.16,.19)+aa,cell)*(1.0-smoothstep(vec2(.79,.77)-aa,vec2(.79,.77)+aa,cell));
    float pane=mask.x*mask.y*wall*${family<6?'1.0':'0.0'};
    float floorSeed=cityHash(vec2(id.y,stableSeed));
    float occupancy=cityVariation.y+(.5-floorSeed)*.3;
    occupancy*=step(.12,floorSeed);
    float suite=cityHash(vec2(floor(id.x/3.0)+stableSeed,id.y));
    float light=step(1.0-occupancy,cityHash(id+stableSeed));light*=mix(.22,1.0,step(.18,suite));
    float brightness=mix(.14,.58,cityHash(id.yx+stableSeed*2.0));
    vec3 lamp=mix(vec3(1.0,.58,.25),vec3(.80,.84,.86),step(.80,cityHash(id+52.0+stableSeed)));
    lamp=mix(lamp,vec3(.46,.66,.86),step(.97,cityHash(id+73.0+stableSeed)));
    float sun=max(0.0,dot(n,vec3(-.973,.10,-.208)));
    vec3 illumination=vec3(.28,.38,.54)+sun*vec3(.91,.53,.27);
    float floorBand=1.0-smoothstep(.035,.075,min(cell.y,1.0-cell.y));
    vec3 glazing=mix(vec3(.032,.067,.11),vec3(.26,.16,.12),sun*.50);
    ${family===0||family===4?'diffuseColor.rgb=mix(diffuseColor.rgb,glazing,.66*wall);':''}
    diffuseColor.rgb*=illumination*(1.0-floorBand*.22*wall);
    diffuseColor.rgb=mix(diffuseColor.rgb,glazing*illumination,pane*.88);
    diffuseColor.rgb+=pane*light*brightness*lamp;
    float distanceHaze=smoothstep(110.0,650.0,length(cityWorld.xz))*.34;
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.23,.19,.23),distanceHaze);
   `);
 };m.customProgramCacheKey=()=> 'city-facade-2-'+family;return m;
}
function instanceBoxes(root,name,records,material,baseGeometry=null){
 if(!records.length)return null;
 const geometry=baseGeometry??new THREE.BoxGeometry(1,1,1),mesh=new THREE.InstancedMesh(geometry,material,records.length),matrix=new THREE.Matrix4();
 mesh.name=name;const size=[],seed=[];
 for(let i=0;i<records.length;i++){
  const r=records[i];matrix.compose(new THREE.Vector3(...r.p),new THREE.Quaternion(),new THREE.Vector3(...r.s));mesh.setMatrixAt(i,matrix);
  size.push(...r.s);seed.push(r.seed??i,r.occupancy??.4,r.distance??0);
 }
 geometry.setAttribute('citySize',new THREE.InstancedBufferAttribute(new Float32Array(size),3));
 geometry.setAttribute('citySeed',new THREE.InstancedBufferAttribute(new Float32Array(seed),3));
 mesh.computeBoundingSphere();root.add(mesh);return mesh;
}
const record=(p,s,extra={})=>({p,s,...extra});

export function cityGeometry(){
 const root=new THREE.Group();root.name='Exterior_City_Layers';
 const rand=random(),families=Array.from({length:6},()=>[]),roofs=[],equipment=[],antennae=[],rims=[],roadLights=[],balconies=[],fins=[];
 const colors=[0x283b50,0x827a6d,0xaaa18d,0x65727b,0x344a62,0x80716b];let buildingCount=0;
 // Near riverbanks, mid districts and a low contrast distant transition.
 // The river remains an unbuilt corridor. No repeated grid of equal boxes.
 for(const [count,range,band]of [[24,[42,108],0],[42,[196,360],1],[64,[380,720],2]]){
  for(let i=0;i<count;i++){
   const x=-range[0]-rand()*(range[1]-range[0]),z=(i-count/2)*(band===0?15:band===1?19:22)+(rand()-.5)*12;
   const depth=band===0?9+rand()*11:12+rand()*14,width=band===0?9+rand()*9:11+rand()*15;
   const height=band===0?22+rand()*32:band===1?30+rand()*56:18+rand()*58;
   const family=Math.floor(rand()*6),base={seed:rand()*999,occupancy:family===0||family===3?.25+rand()*.25:.36+rand()*.25};
   families[family].push(record([x,GROUND+height/2,z],[depth,height,width],base));buildingCount++;
   if(band<2){
    const capHeight=2+rand()*6,capDepth=depth*(.46+rand()*.3),capWidth=width*(.42+rand()*.3);
    families[family].push(record([x+(rand()-.5)*2,GROUND+height+capHeight/2,z],[capDepth,capHeight,capWidth],base));
    roofs.push(record([x,GROUND+height+.15,z],[depth+.35,.3,width+.35]));
    if(rand()<.7)equipment.push(record([x+depth*.19,GROUND+height+.7,z-width*.24],[1.9,.9,2.2]));
    if(rand()<.32)antennae.push(record([x,GROUND+height+capHeight+1.5,z],[.10,3.0,.10]));
    if(family===0||family===4)rims.push(record([x,GROUND+height-1.2,z],[depth+.08,.42,width+.08]));
    if(band===0){
     if(family===1||family===5)for(let floor=2;floor*3<height-1;floor++){
      // Balconies face the office; narrow parapets create real depth at close range.
      balconies.push(record([x+depth/2+.42,GROUND+floor*3,z],[.86,.17,width*.80]));
      rims.push(record([x+depth/2+.80,GROUND+floor*3+.42,z],[.10,.57,width*.80]));
     }
     if(family===0||family===3||family===4)for(let bay=1;bay*3<width-1;bay++)
      fins.push(record([x+depth/2+.08,GROUND+height/2,z-width/2+bay*3],[.16,height,.12]));
    }
   }
  }
 }
 families.forEach((list,i)=>instanceBoxes(root,'Exterior_Facade_Family_'+i,list,facadeMaterial(colors[i],i)));
 const roofMaterial=facadeMaterial(0x343b42,6),metal=facadeMaterial(0x78858b,7);
 instanceBoxes(root,'Exterior_Roof_Copings',roofs,roofMaterial);instanceBoxes(root,'Exterior_Rooftop_Plant',equipment,metal);
 instanceBoxes(root,'Exterior_Antennae',antennae,metal);instanceBoxes(root,'Exterior_Mechanical_Bands',rims,roofMaterial);
 instanceBoxes(root,'Exterior_Residential_Balconies',balconies,roofMaterial);instanceBoxes(root,'Exterior_Office_Fins',fins,metal);
 const groundMaterial=new THREE.MeshBasicMaterial({color:0x252a30});
 groundMaterial.onBeforeCompile=s=>{
  s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 groundWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\ngroundWorld=(modelMatrix*vec4(position,1.0)).xyz;');
  s.fragmentShader=s.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 groundWorld;${hashGLSL}`)
   .replace('#include <color_fragment>',`#include <color_fragment>
    vec2 block=groundWorld.xz/vec2(51.0,62.0),cell=abs(fract(block)-.5),aa=fwidth(block);
    vec2 street=smoothstep(vec2(.43)-aa,vec2(.47)+aa,cell);
    float roads=max(street.x,street.y),park=step(.83,cityHash(floor(block)))*(1.0-roads);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.023,.032,.043),roads);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.028,.048,.035),park*.7);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.15,.12,.16),smoothstep(450.0,900.0,length(groundWorld.xz))*.55);`);
 };groundMaterial.customProgramCacheKey=()=> 'city-urban-block-ground-1';
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(1580,1720),groundMaterial);
 ground.name='Exterior_Urban_Ground';ground.rotation.x=-Math.PI/2;ground.position.set(-390,GROUND-.10,0);root.add(ground);
 const surface=new THREE.MeshBasicMaterial({color:0x253244});
 surface.onBeforeCompile=s=>{
  s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 riverWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\nriverWorld=(modelMatrix*vec4(position,1.0)).xyz;');
  s.fragmentShader=s.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 riverWorld;${hashGLSL}`)
   .replace('#include <color_fragment>',`#include <color_fragment>
    float sunStripe=exp(-pow((riverWorld.x+145.0)/19.0,2.0));float phase=riverWorld.z*.7+sin(riverWorld.x*.3);
    float ripple=.76+.24*sin(phase)*(1.0-smoothstep(.7,2.0,fwidth(phase)));
    diffuseColor.rgb+=vec3(.20,.08,.025)*sunStripe*ripple;
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.24,.19,.23),smoothstep(250.0,800.0,abs(riverWorld.z))*.35);`);
 };surface.customProgramCacheKey=()=> 'city-river-1';
 const river=new THREE.Mesh(new THREE.PlaneGeometry(78,1680),surface);river.name='Exterior_River';river.rotation.x=-Math.PI/2;river.position.set(-147,GROUND+.08,0);root.add(river);
 const banks=[],bridges=[],supports=[];
 for(const x of [-105.5,-188.5]){
  banks.push(record([x,GROUND+.35,0],[5,.7,1660]));
  for(let i=0;i<90;i++)roadLights.push(record([x,GROUND+.8,(i-45)*18],[.25,.22,.45]));
 }
 for(const z of [64,-235,360]){
  bridges.push(record([-147,GROUND+4.5,z],[127,1.1,8]));
  for(const x of [-172,-122])supports.push(record([x,GROUND+2,z],[1.8,4,6]));
  for(let i=0;i<29;i++)for(const side of [-1,1])roadLights.push(record([-210+i*4.5,GROUND+5.45,z+side*3.7],[.20,.26,.20]));
 }
 instanceBoxes(root,'Exterior_Quays_And_Riverside_Roads',banks,roofMaterial);instanceBoxes(root,'Exterior_Bridge_Decks',bridges,roofMaterial);
 instanceBoxes(root,'Exterior_Bridge_Piers',supports,roofMaterial);
 instanceBoxes(root,'Exterior_Road_Lights',roadLights,new THREE.MeshBasicMaterial({color:0xffb56a}));
 return {root,buildingCount};
}

// Decoration only. Protected collider shapes, pivots and transforms stay
// unchanged. The existing player radius already prevents nose-on-glass views.
export function windowEnvelope(){
 const root=new THREE.Group();root.name='Exterior_Office_Envelope';
 const metal=new THREE.MeshStandardMaterial({color:0x394753,roughness:.43,metalness:.62}),concrete=new THREE.MeshStandardMaterial({color:0x858784,roughness:.91});
 const stone=new THREE.MeshStandardMaterial({color:0x58676e,roughness:.57,metalness:.06}),seal=new THREE.MeshStandardMaterial({color:0x151f25,roughness:.89});
 const concreteParts=[record([-12.21,-.2,0],[.44,.40,20.45]),record([-12.28,-32.3,-10.25],[.55,64.8,.55]),record([-12.28,-32.3,10.25],[.55,64.8,.55])];
 const sills=[],trims=[],gaps=[],mullions=[],drains=[];
 for(let i=0;i<10;i++){
  const z=-9+i*2;sills.push(record([-12.075,1.185,z],[1,1,1]));trims.push(record([-12.26,1.155,z],[.34,.035,1.91]));
  gaps.push(record([-12.445,1.107,z],[.024,.03,1.92]));drains.push(record([-12.29,1.137,z+.66],[.085,.013,.04]));
 }
 for(let z=-10;z<=10;z+=2)mullions.push(record([-12.15,1.9,z],[.15,1.51,.075]));
 trims.push(record([-12.24,2.66,0],[.31,.075,20.5]));
 for(let floor=0;floor<19;floor++){
  const y=-.38-floor*3.4;concreteParts.push(record([-12.28,y,0],[.42,.25,20.45]));gaps.push(record([-12.32,y-.8,0],[.04,.78,20.2]));
 }
 const profile=new THREE.Shape();profile.moveTo(-.35,-.025);profile.lineTo(.35,-.025);profile.lineTo(.35,.004);profile.lineTo(.329,.025);profile.lineTo(-.335,.025);profile.lineTo(-.35,.009);profile.closePath();
 const sillGeometry=new THREE.ExtrudeGeometry(profile,{depth:1.91,bevelEnabled:false,steps:1});sillGeometry.translate(0,0,-.955);
 instanceBoxes(root,'Exterior_Slab_And_Structure',concreteParts,concrete);instanceBoxes(root,'Exterior_Interior_Sill',sills,stone,sillGeometry);
 instanceBoxes(root,'Exterior_Metal_Trim',trims,metal);instanceBoxes(root,'Exterior_Mullions',mullions,metal);
 instanceBoxes(root,'Exterior_Shadow_Gaps_And_Spandrels',gaps,seal);instanceBoxes(root,'Exterior_Sill_Drains',drains,seal);return root;
}

export async function createCity(renderer){
 const root=new THREE.Group();root.name='Exterior_Sunset_City';root.userData.zone='Exterior';
 const texture=await new THREE.TextureLoader().loadAsync('assets/environment/city-sunset.png');texture.colorSpace=THREE.SRGBColorSpace;
 texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
 const panorama=new THREE.Mesh(backdropGeometry(),panoramaMaterial(texture));panorama.name='Exterior_Distant_Curved_Panorama';root.add(panorama);
 const geometry=cityGeometry();root.add(geometry.root,windowEnvelope());
 const reflectionScene=new THREE.Scene();reflectionScene.background=new THREE.Color(0x56697f);reflectionScene.add(panorama.clone(),geometry.root.clone(true));
 const city={root,reflectionScene,panorama,buildingCount:geometry.buildingCount};rebuildCityEnvironment(renderer,city);return city;
}
function rebuildCityEnvironment(renderer,city){const pmrem=new THREE.PMREMGenerator(renderer);city.environment=pmrem.fromScene(city.reflectionScene,.06,.1,2600,{size:128});pmrem.dispose();}
export function restoreCityEnvironment(renderer,city){city.environment.dispose();rebuildCityEnvironment(renderer,city);}

export function refineGlass(model,cityEnvironment){
 const materials=new Set();model.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});
 for(const m of materials)if(m.transmission>0||/glass/i.test(m.name)){
  if(!m.isMeshPhysicalMaterial)continue;
  const etched=/etch/i.test(m.name),interactionBarrier=m.userData.interactionOpaque??(!m.transparent||m.opacity>.5);
  m.transmission=0;m.transparent=true;m.opacity=etched?.25:.085;m.depthWrite=false;
  m.roughness=etched?.34:.105;m.metalness=.02;m.ior=1.5;m.clearcoat=.55;m.clearcoatRoughness=.09;m.color.set(etched?0xc6d4d4:0xc5d5d6);
  m.userData.interactionOpaque=interactionBarrier;m.userData.visibilityOpaque=false;m.userData.glass=true;
  if(cityEnvironment){m.envMap=cityEnvironment;m.envMapIntensity=.46;}
  m.onBeforeCompile=s=>{
   s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 glassPosition;varying vec3 glassWorld;')
    .replace('#include <begin_vertex>','#include <begin_vertex>\nglassPosition=position;')
    .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
     vec4 glassPoint=vec4(transformed,1.0);
     #ifdef USE_INSTANCING
     glassPoint=instanceMatrix*glassPoint;
     #endif
     glassWorld=(modelMatrix*glassPoint).xyz;`);
   s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 glassPosition;varying vec3 glassWorld;')
    .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
     float dust=sin(dot(glassPosition,vec3(71.0,79.0,67.0)))*sin(dot(glassPosition,vec3(113.0,97.0,101.0)));
     float smudge=sin(glassWorld.z*2.4+glassWorld.y*.8)*sin(glassWorld.y*3.1);
     roughnessFactor=clamp(roughnessFactor+dust*.012+smudge*.009,.04,1.0);`)
    .replace('#include <opaque_fragment>',`
     float facing=abs(dot(normal,normalize(vViewPosition)));float fresnel=.04+.96*pow(1.0-facing,5.0);
     // A world-space reflected ray hits a finite office ceiling, not a screen overlay.
     vec3 reflected=inverseTransformDirection(reflect(-normalize(vViewPosition),normal),viewMatrix);
     float ceilingT=(3.37-glassWorld.y)/max(reflected.y,.0001);vec3 hit=glassWorld+reflected*ceilingT;
     vec2 lightCell=abs(mod(hit.xz+vec2(1.5,1.5),vec2(3.0))-1.5);
     float ceilingLight=(1.0-smoothstep(.53,.68,lightCell.x))*(1.0-smoothstep(.16,.27,lightCell.y));
     float inside=step(-11.8,hit.x)*step(hit.x,11.8)*step(-9.8,hit.z)*step(hit.z,9.8)*step(.02,reflected.y)*step(0.0,ceilingT);
     outgoingLight+=vec3(.88,.92,1.0)*ceilingLight*inside*(.14+.8*fresnel);
     diffuseColor.a=clamp(diffuseColor.a+.48*pow(1.0-facing,3.0),0.0,.72);
     #include <opaque_fragment>`);
  };m.customProgramCacheKey=()=> 'glass-angle-ceiling-smudge-3';m.needsUpdate=true;
 }
}
