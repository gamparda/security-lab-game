import { Mesh, InstancedMesh, Matrix4, Vector3 } from '../vendor/three/build/three.module.js';
import { mergeGeometries } from '../vendor/three/examples/jsm/utils/BufferGeometryUtils.js';

// Preserve the full asset on every backend. Software rasterizers cannot afford
// a second render of the entire room for refractive glass.
export function isSoftwareRenderer(gl) {
  const info=gl.getExtension('WEBGL_debug_renderer_info');
  const name=info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  return /swiftshader|llvmpipe|softpipe|software|basic render|\bwarp\b/i.test(name);
}
export function prepareMaterials(model, software) {
  if(!software) return;
  const materials=new Set();
  model.traverse(o=>{if(o.isMesh) for(const m of Array.isArray(o.material)?o.material:[o.material]) materials.add(m);});
  for(const material of materials) {
    if(material.transmission>0) {
      material.userData.interactionOpaque=!material.transparent || material.opacity>.5;
      material.opacity=material.transmission>.9 ? .18 : .4;
      material.transmission=0; material.transparent=true; material.depthWrite=false;
      material.needsUpdate=true;
    }
  }
}
// Keep functional roots separate. Repeats share GPU data; unique geometry
// stays indexed and is batched spatially to bound memory and raycast work.
export function batchStatic(model) {
  model.updateMatrixWorld(true);
  const inverse=new Matrix4().copy(model.matrixWorld).invert();
  const repeats=new Map(), batches=new Map();
  model.traverse(object=>{
    if(!object.isMesh || object.isSkinnedMesh || !object.visible || object.name.startsWith('COLLIDER_')) return;
    for(let parent=object;parent;parent=parent.parent) if(parent.userData.interaction || !parent.visible) return;
    const mat=object.material;
    // Glass keeps individual sorting and multi-material meshes keep their groups.
    if(Array.isArray(mat) || mat.transparent || mat.transmission>0) return;
    object.geometry.computeBoundingBox();
    const key=object.geometry.uuid+'|'+mat.uuid;
    if(!repeats.has(key)) repeats.set(key,[]);
    repeats.get(key).push(object);
  });
  const matrix=object=>new Matrix4().multiplyMatrices(inverse,object.matrixWorld);
  for(const objects of repeats.values()) {
    if(objects.length>1) {
      const first=objects[0], mesh=new InstancedMesh(first.geometry,first.material,objects.length);
      mesh.name='ENV_Static_Instances'; mesh.castShadow=first.castShadow; mesh.receiveShadow=true;
      objects.forEach((object,index)=>mesh.setMatrixAt(index,matrix(object)));
      mesh.computeBoundingSphere(); mesh.computeBoundingBox(); model.add(mesh);
      for(const object of objects) object.visible=false;
      continue;
    }
    const object=objects[0], geometry=object.geometry;
    const center=geometry.boundingBox.getCenter(new Vector3()).applyMatrix4(object.matrixWorld);
    const layout=Object.entries(geometry.attributes).map(([name,a])=>`${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).sort().join('|');
    const key=`${object.material.uuid}|${Boolean(geometry.index)}|${layout}|${Math.floor(center.x/4)}:${Math.floor(center.z/4)}`;
    if(!batches.has(key)) batches.set(key,[]);
    batches.get(key).push(object);
  }
  for(const objects of batches.values()) {
    let chunk=[],vertices=0;
    const flush=()=>{
      if(chunk.length<2) {chunk=[];vertices=0;return;}
      const parts=chunk.map(object=>object.geometry.clone().applyMatrix4(matrix(object)));
      const geometry=mergeGeometries(parts,false);
      if(geometry) {
        geometry.computeBoundingBox();
        const mesh=new Mesh(geometry,chunk[0].material); mesh.name='ENV_Static_Batch';
        mesh.castShadow=chunk[0].castShadow; mesh.receiveShadow=true; model.add(mesh);
        for(const object of chunk) object.visible=false;
      }
      for(const part of parts) part.dispose();
      chunk=[];vertices=0;
    };
    for(const object of objects) {
      const count=object.geometry.attributes.position.count;
      if(vertices+count>100000) flush();
      chunk.push(object);vertices+=count;
    }
    flush();
  }
}
