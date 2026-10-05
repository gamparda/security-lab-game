// Offline, error-bounded runtime export. The Blender master is never opened.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {MeshoptSimplifier} from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
const [source,destination]=process.argv.slice(2);
if(!source||!destination)throw Error('Usage: node scripts/runtime-lod.mjs master.glb runtime-unpacked.glb');
await Promise.all([MeshoptDecoder.ready,MeshoptSimplifier.ready]);
const bytes=fs.readFileSync(source),jsonLength=bytes.readUInt32LE(12);
const doc=JSON.parse(bytes.subarray(20,20+jsonLength)),binary=bytes.subarray(28+jsonLength);
const original=structuredClone(doc),decoded=new Map(),accessors=new Map();
const width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4},types={5121:Uint8Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
function view(i){
 if(decoded.has(i))return decoded.get(i);
 const v=doc.bufferViews[i],e=v.extensions?.EXT_meshopt_compression;
 const data=e?new Uint8Array(e.count*e.byteStride):new Uint8Array(binary.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength));
 if(e)MeshoptDecoder.decodeGltfBuffer(data,e.count,e.byteStride,binary.subarray(e.byteOffset,e.byteOffset+e.byteLength),e.mode,e.filter);
 decoded.set(i,data);return data;
}
function accessor(i){
 if(accessors.has(i))return accessors.get(i);
 const a=doc.accessors[i],v=doc.bufferViews[a.bufferView],Type=types[a.componentType],components=width[a.type],data=view(a.bufferView);
 const stride=v.byteStride||components*Type.BYTES_PER_ELEMENT,offset=a.byteOffset||0;
 const result=new Type(a.count*components);
 for(let n=0;n<a.count;n++)result.set(new Type(data.buffer,data.byteOffset+offset+n*stride,components),n*components);
 accessors.set(i,result);return result;
}
const protectedMeshes=new Set();
for(const n of doc.nodes)if(n.name?.startsWith('COLLIDER_')||n.name?.startsWith('DOOR_')){
 const visit=i=>{const node=doc.nodes[i];if(node.mesh!==undefined)protectedMeshes.add(node.mesh);node.children?.forEach(visit);};visit(doc.nodes.indexOf(n));
}
const output=[],newViews=[],newAccessors=[],cached=new Map();let size=0;
function append(data,target){const buffer=Buffer.from(data.buffer,data.byteOffset,data.byteLength),padding=(-size)&3;if(padding){output.push(Buffer.alloc(padding));size+=padding;}const i=newViews.length;newViews.push({buffer:0,byteOffset:size,byteLength:buffer.length,...(target?{target}:{})});output.push(buffer);size+=buffer.length;return i;}
function addAccessor(array,template,target){
 const metadata={...template};delete metadata.bufferView;delete metadata.byteOffset;metadata.count=array.length/width[metadata.type];
 const key=JSON.stringify(metadata)+crypto.createHash('sha256').update(Buffer.from(array.buffer,array.byteOffset,array.byteLength)).digest('hex');
 if(cached.has(key))return cached.get(key);
 const i=newAccessors.length;newAccessors.push({...metadata,bufferView:append(array,target)});cached.set(key,i);return i;
}
const report=[];
for(let mi=0;mi<doc.meshes.length;mi++){
 const mesh=doc.meshes[mi];
 for(let pi=0;pi<mesh.primitives.length;pi++){
  const p=mesh.primitives[pi],positions=accessor(p.attributes.POSITION),indices=new Uint32Array(accessor(p.indices)),before=indices.length/3;
  let base=indices,levels=[];
  // Work in metre space; these bounds are geometric error, not a triangle cap.
  if(!protectedMeshes.has(mi)&&before>4000){
   const normal=p.attributes.NORMAL!==undefined?accessor(p.attributes.NORMAL):null,uv=p.attributes.TEXCOORD_0!==undefined?accessor(p.attributes.TEXCOORD_0):null;
   const stride=(normal?3:0)+(uv?2:0),attrs=new Float32Array(positions.length/3*stride),weights=[];
   if(normal)weights.push(.0005,.0005,.0005);if(uv)weights.push(.0005,.0005);
   for(let v=0;v<positions.length/3;v++){let k=v*stride;if(normal){attrs.set(normal.subarray(v*3,v*3+3),k);k+=3;}if(uv)attrs.set(uv.subarray(v*2,v*2+2),k);}
   const simplify=error=>MeshoptSimplifier.simplifyWithAttributes(indices,positions,3,attrs,stride,weights,null,0,error,['ErrorAbsolute','Permissive','RegularizeLight']);
   base=simplify(.0012)[0];if(!base.length)base=indices;
   for(const bound of [.004,.012]){const [index,error]=simplify(bound);if(index.length>0&&index.length<base.length*.92)levels.push({index,error});}
  }
  // All LODs index the same compacted vertices, so UVs and normals stay exact.
  const combined=new Uint32Array(base.length+levels.reduce((s,l)=>s+l.index.length,0));combined.set(base);let at=base.length;for(const l of levels){combined.set(l.index,at);at+=l.index.length;}
  const [remap,count]=MeshoptSimplifier.compactMesh(combined);
  const remapIndices=arr=>Uint32Array.from(arr,i=>remap[i]);
  const attrs={};
  for(const [name,ai]of Object.entries(p.attributes)){
   const a=doc.accessors[ai],values=accessor(ai),w=width[a.type],compact=new values.constructor(count*w);
   for(let old=0;old<remap.length;old++)if(remap[old]!==0xffffffff)compact.set(values.subarray(old*w,old*w+w),remap[old]*w);
   attrs[name]=addAccessor(compact,a,34962);
  }
  p.attributes=attrs;p.indices=addAccessor(remapIndices(base),{componentType:5125,type:'SCALAR'},34963);
  if(levels.length)p.extras={...p.extras,runtimeLOD:levels.map(l=>({indices:addAccessor(remapIndices(l.index),{componentType:5125,type:'SCALAR'},34963),error:l.error}))};
  report.push({mesh:mi,primitive:pi,name:mesh.name,before,after:base.length/3,lods:levels.map(l=>({triangles:l.index.length/3,error:l.error})),protected:protectedMeshes.has(mi)});
 }
}
for(const image of doc.images)image.bufferView=append(view(image.bufferView));
doc.bufferViews=newViews;doc.accessors=newAccessors;doc.buffers=[{byteLength:size}];
for(const key of ['extensionsUsed','extensionsRequired'])doc[key]=doc[key]?.filter(e=>e!=='EXT_meshopt_compression');
doc.asset.extras={...doc.asset.extras,runtimeExport:{sourceSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),baseErrorMetres:.0012,lodErrorsMetres:[.004,.012],masterPreserved:true}};
const js=Buffer.from(JSON.stringify(doc));const jsonPad=Buffer.concat([js,Buffer.alloc((-js.length)&3,32)]),bin=Buffer.concat(output),binPad=Buffer.concat([bin,Buffer.alloc((-bin.length)&3)]);
const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+jsonPad.length+binPad.length,8);header.writeUInt32LE(jsonPad.length,12);header.writeUInt32LE(0x4e4f534a,16);
const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(binPad.length,0);binHeader.writeUInt32LE(0x004e4942,4);
fs.writeFileSync(destination,Buffer.concat([header,jsonPad,binHeader,binPad]));
fs.writeFileSync(destination+'.report.json',JSON.stringify({sourceNodes:original.nodes.length,nodes:doc.nodes.length,primitives:report},null,2));
console.log(JSON.stringify({meshes:doc.meshes.length,before:report.reduce((s,r)=>s+r.before,0),after:report.reduce((s,r)=>s+r.after,0),bytes:fs.statSync(destination).size,lodPrimitives:report.filter(r=>r.lods.length).length}));
