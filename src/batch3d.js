import { Mesh, Float32BufferAttribute } from '../vendor/three/build/three.module.js';
import { mergeGeometries } from '../vendor/three/examples/jsm/utils/BufferGeometryUtils.js';
// Batch immobile, non-interactive geometry by material. Authored nodes and collider
// names remain available; interactive roots and their raycast meshes stay separate.
export function batchStatic(model) {
  model.updateMatrixWorld(true);
  const buckets=new Map(), originals=[];
  model.traverse(object=>{
    if(!object.isMesh || !object.visible || object.name.startsWith('COLLIDER_')) return;
    for(let parent=object;parent;parent=parent.parent) if(parent.userData.interaction) return;
    const mats=Array.isArray(object.material)?object.material:[object.material];
    const flat=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();
    const groups=flat.groups.length?flat.groups:[{start:0,count:flat.attributes.position.count,materialIndex:0}];
    for(const group of groups) {
      const mat=mats[group.materialIndex];
      const geometry=flat.clone();
      for(const name of Object.keys(geometry.attributes)) {
        const attr=geometry.attributes[name];
        const array=attr.array.slice(group.start*attr.itemSize,(group.start+group.count)*attr.itemSize);
        geometry.setAttribute(name,new attr.constructor(array,attr.itemSize,attr.normalized));
      }
      geometry.clearGroups(); geometry.applyMatrix4(object.matrixWorld);
      if(!geometry.attributes.uv) geometry.setAttribute('uv',new Float32BufferAttribute(new Float32Array(geometry.attributes.position.count*2),2));
      // Separate transparent glass and non-shadow-casting ceilings from opaque casters.
      const shadow=object.castShadow && !mat.transparent;
      const key=mat.uuid+'|'+shadow;
      if(!buckets.has(key)) buckets.set(key,{mat,shadow,parts:[]});
      buckets.get(key).parts.push(geometry);
    }
    flat.dispose(); originals.push(object);
  });
  for(const {mat,shadow,parts} of buckets.values()) {
    const geometry=mergeGeometries(parts,false);
    if(geometry) {
      const mesh=new Mesh(geometry,mat); mesh.name='ENV_Static_Batch';
      mesh.castShadow=shadow; mesh.receiveShadow=true; model.add(mesh);
    }
    for(const part of parts) part.dispose();
  }
  for(const object of originals) object.visible=false;
}
