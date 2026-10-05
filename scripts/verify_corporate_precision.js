// Compare every compressed visual float against the original Blender export.
// Usage: node scripts/verify_corporate_precision.js unpacked.glb packed.glb
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MeshoptDecoder} from '../vendor/three/examples/jsm/libs/meshopt_decoder.module.js';

const [sourcePath,packedPath]=process.argv.slice(2);
if(!sourcePath||!packedPath)throw Error('Usage: node scripts/verify_corporate_precision.js unpacked.glb packed.glb');
await MeshoptDecoder.ready;
const parse=b=>{const length=b.readUInt32LE(12);return {doc:JSON.parse(b.subarray(20,20+length)),bin:b.subarray(20+length+8)};};
const source=parse(readFileSync(sourcePath)),packed=parse(readFileSync(packedPath));
const reportPath=packedPath.replace(/\.glb$/,'.json');
const report=JSON.parse(readFileSync(reportPath));
const originals=new Map();
for(const view of source.doc.bufferViews) {
  const data=source.bin.subarray(view.byteOffset,view.byteOffset+view.byteLength);
  originals.set(createHash('sha256').update(data).digest('hex'),data);
}
const semantics=new Map();
for(const mesh of packed.doc.meshes)for(const primitive of mesh.primitives)
  for(const [name,index]of Object.entries(primitive.attributes))semantics.set(packed.doc.accessors[index].bufferView,name);
const maximum={};
for(const i of report.quantizedViews) {
  const e=packed.doc.bufferViews[i].extensions.EXT_meshopt_compression;
  const target=new Uint8Array(e.count*e.byteStride);
  MeshoptDecoder.decodeGltfBuffer(target,e.count,e.byteStride,packed.bin.subarray(e.byteOffset,e.byteOffset+e.byteLength),e.mode,e.filter);
  const before=originals.get(report.uncompressedViewSHA256[i]);
  if(!before)throw Error('Original buffer view missing: '+i);
  const a=new Float32Array(target.buffer),b=new Float32Array(before.buffer,before.byteOffset,before.byteLength/4);
  let error=0;
  for(let j=0;j<a.length;j++) {
    if(!Number.isFinite(a[j]))throw Error('Non-finite visual attribute: '+i);
    error=Math.max(error,Math.abs(a[j]-b[j]));
  }
  const name=semantics.get(i)||'OTHER';maximum[name]=Math.max(maximum[name]||0,error);
}
if(maximum.POSITION>.0002)throw Error('Position error exceeds 0.2mm: '+maximum.POSITION);
report.maximumAttributeError=maximum;
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(maximum));
