import {Box3,BufferGeometry,Frustum,Matrix4,Sphere,Vector3} from '../vendor/three/build/three.module.js';

export function zoneAt(position) {
 if(position.x<-12.2)return 'Exterior';
 if(position.z<-2)return position.x<-2?'ServerRoom':position.x>4?'Forensics':'Training';
 if(position.x<-2&&position.z<5)return 'SOC';
 if(position.x>4&&position.z<5)return 'Network';
 return 'MainOffice';
}
// Every surface is evaluated in world/screen space. Glass partitions are
// deliberately absent from the opaque blocker list; rooms are never hidden
// merely because the player is in another zone.
export async function prepareVisibility(gltf) {
 const root=gltf.scene,cache=new Map(),items=[],opaqueWalls=[];
 root.updateMatrixWorld(true);
 root.traverse(o=>{if(o.name.startsWith('COLLIDER_Wall_')){const b=new Box3().setFromObject(o);if(b.max.y-b.min.y>2.2)opaqueWalls.push(b);}});
 const corners=box=>{const points=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push([x,y,z]);return points;};
 const blocked=(origin,target,wall)=>{
  let near=0,far=1;
  for(let axis=0;axis<3;axis++){
   const name=['x','y','z'][axis],from=origin[name],delta=target[axis]-from,min=wall.min[name]+.015,max=wall.max[name]-.015;
   if(Math.abs(delta)<1e-8){if(from<min||from>max)return false;continue;}
   let a=(min-from)/delta,b=(max-from)/delta;if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);if(near>far)return false;
  }
  return near>.0001&&near<.995&&far>near;
 };
 const promises=[];
 root.traverse(o=>{
  if(!o.isMesh||o.name.startsWith('COLLIDER_')||!o.visible||o.isInstancedMesh)return;
  const geometry=o.geometry,levels=geometry.userData.runtimeLOD;
  let functional=false,door=false;for(let p=o;p;p=p.parent){functional||=Boolean(p.userData.interaction);door||=p.name.startsWith('DOOR_');}
  if(door)return;
  const box=new Box3().setFromObject(o),sphere=box.getBoundingSphere(new Sphere());
  const item={object:o,base:geometry,levels:[],box,sphere,corners:corners(box),zone:zoneAt(sphere.center),functional,level:0,visible:true};items.push(item);
  if(levels?.length){
   if(!cache.has(geometry))cache.set(geometry,Promise.all(levels.map(async l=>{
    const index=await gltf.parser.getDependency('accessor',l.indices),copy=new BufferGeometry();for(const [name,a]of Object.entries(geometry.attributes))copy.setAttribute(name,a);copy.setIndex(index);copy.boundingBox=geometry.boundingBox;copy.boundingSphere=geometry.boundingSphere;return {geometry:copy,error:l.error};
   })));
   promises.push(cache.get(geometry).then(levels=>{item.levels=levels;}));
   // The ray always sees the original close-detail mesh, independently of LOD.
   const raycast=o.raycast;o.raycast=function(ray,hits){const visual=this.geometry;this.geometry=geometry;try{raycast.call(this,ray,hits);}finally{this.geometry=visual;}};
  }
 });
 await Promise.all(promises);
 const frustum=new Frustum(),matrix=new Matrix4(),stats={visibleZones:[],lod:[0,0,0],culled:0,tinyDetails:0,opaqueCulled:0};let lastPose='';
 return {
  stats,
  update(camera,height,enabled=true){
   const pose=[...camera.position.toArray(),...camera.quaternion.toArray(),height,enabled].join(',');if(pose===lastPose)return false;lastPose=pose;
   camera.updateMatrixWorld();frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
   const focal=height/(2*Math.tan(camera.fov*Math.PI/360)),zones=new Set();stats.lod=[0,0,0];stats.culled=0;stats.tinyDetails=0;stats.opaqueCulled=0;let changed=false;
   for(const item of items){
    const distance=Math.max(.15,camera.position.distanceTo(item.sphere.center)-item.sphere.radius),pixels=item.sphere.radius*2*focal/distance;
    const inView=frustum.intersectsSphere(item.sphere);
    // Tiny complete props disappear only below subpixel relevance, with margin.
    const tiny=!item.functional&&item.sphere.radius<.065&&pixels<(item.visible?1.2:1.9);
    const occluded=enabled&&inView&&opaqueWalls.some(wall=>!wall.containsPoint(camera.position)&&!wall.intersectsBox(item.box)&&item.corners.every(p=>blocked(camera.position,p,wall)));
    const visible=!enabled||inView&&!tiny&&!occluded;
    if(visible!==item.visible){changed=true;item.visible=visible;item.object.visible=visible;}
    if(!visible){stats.culled++;if(tiny)stats.tinyDetails++;if(occluded)stats.opaqueCulled++;continue;}
    zones.add(item.zone);let level=0;
    if(enabled)for(let i=0;i<item.levels.length;i++){
     const screenError=item.levels[i].error*focal/distance;
     if(screenError<(item.level>=i+1?1.15:.85))level=i+1;
    }
    if(level!==item.level){changed=true;item.level=level;item.object.geometry=level?item.levels[level-1].geometry:item.base;}
    stats.lod[Math.min(2,level)]++;
   }
   stats.visibleZones=[...zones];return changed;
  },
  dispose(){for(const levels of cache.values())void levels.then(list=>list.forEach(l=>l.geometry.dispose()));}
 };
}
