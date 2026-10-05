// Plan test waypoints from the real exported bounds. The test still walks with
// ordinary keyboard input and collision handling; it never teleports a player.
import { readFileSync } from 'node:fs';
import { Box3, Matrix4, Quaternion, Vector3 } from '../../vendor/three/build/three.module.js';
import { overlaps, moveWithCollisions } from '../../src/collision.js';
const bytes=readFileSync(new URL('../../assets/models/security_lab.glb',import.meta.url));
const doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
const parents=new Map();doc.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>parents.set(c,i)));
function world(i) {
  const n=doc.nodes[i];
  const m=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3(...(n.translation||[0,0,0])),new Quaternion(...(n.rotation||[0,0,0,1])),new Vector3(...(n.scale||[1,1,1])));
  return parents.has(i)?world(parents.get(i)).multiply(m):m;
}
const staticBoxes=[];
doc.nodes.forEach((n,i)=>{
  if(!n.name?.startsWith('COLLIDER_'))return;
  const box=new Box3();
  for(const p of doc.meshes[n.mesh].primitives) {
    const a=doc.accessors[p.attributes.POSITION];
    box.union(new Box3(new Vector3(...a.min),new Vector3(...a.max)));
  }
  staticBoxes.push(box.applyMatrix4(world(i)));
});
export function routeColliders(doors) {
  const boxes=[...staticBoxes];
  for(const d of doors) {
    const n=doc.nodes.find(n=>n.name===d.name),b=n.extras.collisionBounds;
    const box=new Box3(new Vector3(b[0],b[2],-b[4]),new Vector3(b[3],b[5],-b[1]));
    const m=new Matrix4().compose(new Vector3(...d.pivot),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),d.angle),new Vector3(1,1,1));
    boxes.push(box.applyMatrix4(m));
  }
  return boxes;
}
export function route(position,destination,doors) {
  const boxes=routeColliders(doors);
  const step=.1,key=(x,z)=>`${Math.round(x/step)},${Math.round(z/step)}`;
  const point=k=>k.split(',').map(Number).map(n=>n*step),freeCache=new Map();
  const free=k=>{
    if(freeCache.has(k))return freeCache.get(k);
    const [x,z]=point(k);
    const ok=x>=-11.6&&x<=11.6&&z>=-9.6&&z<=12.8&&!boxes.some(b=>overlaps({x,z},b,.36));
    freeCache.set(k,ok);return ok;
  };
  let start=key(position[0],position[2]);
  const goal=key(...destination),origin={x:position[0],z:position[2]};
  if(boxes.some(b=>overlaps(origin,b)) || !free(goal)) throw new Error(`Waypoint is obstructed: ${start} -> ${goal}`);
  // A real keyboard step can stop safely within the grid's extra 5 cm margin.
  // Connect the exact player position to a nearby clear cell through actual
  // collision math instead of treating a rounded coordinate as the player.
  const reachable=k=>{
    const [x,z]=point(k),moved=moveWithCollisions(origin,x-origin.x,z-origin.z,boxes);
    return Math.hypot(moved.x-x,moved.z-z)<1e-5;
  };
  if(!free(start) || !reachable(start)) {
    const [sx,sz]=start.split(',').map(Number),candidates=[];
    for(let dx=-6;dx<=6;dx++) for(let dz=-6;dz<=6;dz++) {
      const k=`${sx+dx},${sz+dz}`;
      if(free(k)&&reachable(k)) {const [x,z]=point(k);candidates.push([Math.hypot(x-origin.x,z-origin.z),k]);}
    }
    candidates.sort((a,b)=>a[0]-b[0]);
    if(!candidates.length) throw new Error(`No clear route from player position ${position}`);
    start=candidates[0][1];
  }
  const queue=[start],previous=new Map([[start,null]]);
  for(let head=0;head<queue.length;head++) {
    const u=queue[head];
    if(u===goal) {
      const path=[];for(let k=goal;k!==null;k=previous.get(k))path.push(point(k));path.reverse();
      const turns=path.filter((p,i)=>i===0||i===path.length-1||
        Math.sign(p[0]-path[i-1][0])!==Math.sign(path[i+1][0]-p[0])||
        Math.sign(p[1]-path[i-1][1])!==Math.sign(path[i+1][1]-p[1]));
      // A grid staircase is useful for finding a route, but humans walk the
      // clear diagonals instead of stopping at each 10 cm corner. Remove a
      // waypoint only when the entire segment is clear for the real player.
      // Keep the grid's extra clearance after the exact starting position.
      const waypoints=[[origin.x,origin.z],...turns],smooth=[waypoints[0]];
      const clear=(a,b,radius)=>{
        const dx=b[0]-a[0],dz=b[1]-a[1],samples=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.025));
        const moved=moveWithCollisions({x:a[0],z:a[1]},dx,dz,boxes);
        if(Math.hypot(moved.x-b[0],moved.z-b[1])>1e-5)return false;
        for(let sample=1;sample<=samples;sample++) {
          const p={x:a[0]+dx*sample/samples,z:a[1]+dz*sample/samples};
          if(boxes.some(box=>overlaps(p,box,radius)))return false;
        }
        return true;
      };
      for(let i=0;i<waypoints.length-1;) {
        let next=waypoints.length-1;
        while(next>i+1&&!clear(waypoints[i],waypoints[next],i===0?.31:.36))next--;
        smooth.push(waypoints[next]);i=next;
      }
      return smooth;
    }
    const [x,z]=u.split(',').map(Number);
    for(const [dx,dz] of [[0,-1],[-1,0],[1,0],[0,1]]) {
      const v=`${x+dx},${z+dz}`;
      if(!previous.has(v)&&free(v)){previous.set(v,u);queue.push(v);}
    }
  }
  throw new Error(`No physical route to ${destination}`);
}
