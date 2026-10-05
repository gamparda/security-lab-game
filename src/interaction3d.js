import { Raycaster, Vector2, Box3, Vector3 } from '../vendor/three/build/three.module.js';
import { overlaps } from './collision.js';
export const REACH = 2.65;
export class Interaction {
  constructor(model, camera, player, openTool) {
    this.model=model; this.camera=camera; this.player=player; this.openTool=openTool;
    this.ray=new Raycaster(); this.ray.far=REACH;
    this.doors=[]; this.target=null;
    this.raycastMeshes=[];
    model.traverse(object => {
      if(object.isMesh && this.visible(object)) {
        object.geometry.computeBoundingBox();
        this.raycastMeshes.push(object);
      }
      if (object.name.startsWith('DOOR_') && object.userData.interaction === 'door') {
        const bounds = object.userData.collisionBounds;
        const local = new Box3(new Vector3(bounds[0],bounds[2],-bounds[4]),new Vector3(bounds[3],bounds[5],-bounds[1]));
        this.doors.push({object,local,box:new Box3(),angle:0,from:0,target:0,time:.45,
          open: Number(object.userData.openAngleDegrees)*Math.PI/180});
      }
    });
    this.update(0);
  }
  update(dt) {
    for (const door of this.doors) {
      const previous=door.angle;
      door.time=Math.min(.45,door.time+dt);
      const t=door.time/.45, eased=t*t*(3-2*t);
      door.angle=door.from+(door.target-door.from)*eased;
      door.object.rotation.y=door.angle; door.object.updateWorldMatrix(true,true);
      door.box.copy(door.local).applyMatrix4(door.object.matrixWorld);
      // Opening/closing never sweeps a leaf through the player's body.
      if (overlaps(this.player.camera.position,door.box,.305) && Math.abs(door.angle-previous)>.0001) {
        door.angle=previous; door.object.rotation.y=previous; door.object.updateWorldMatrix(true,true);
        door.box.copy(door.local).applyMatrix4(door.object.matrixWorld);
        door.from=previous; door.target=door.open; door.time=0;
      }
    }
    this.target=this.findTarget();
    return this.target;
  }
  findTarget() {
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(new Vector2(0,0),this.camera);
    const hits=this.ray.intersectObjects(this.raycastMeshes,false);
    for (const hit of hits) {
      if (!hit.object.isMesh || !this.visible(hit.object)) continue;
      let object=hit.object;
      while (object && object!==this.model) {
        if (object.userData.interaction) return object;
        object=object.parent;
      }
      // The nearest opaque non-interactive surface blocks interaction through walls.
      const material=Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material;
      if (material?.userData.interactionOpaque ?? (!material?.transparent || material.opacity>.5)) return null;
    }
    return null;
  }
  visible(object) { for (let o=object;o;o=o.parent) if (!o.visible) return false; return true; }
  interact() {
    const object=this.findTarget();
    if (!object) return;
    if (object.userData.interaction==='door') {
      const door=this.doors.find(d=>d.object===object);
      door.from=door.angle; door.target=door.target===0 ? door.open : 0; door.time=0;
    } else this.openTool(object.userData.interaction,object.userData.label);
  }
  prompt() {
    if (!this.target) return '';
    const door=this.doors.find(d=>d.object===this.target);
    return door ? `E · ${door.target===0?'문 열기':'문 닫기'}` : `E · ${this.target.userData.label}`;
  }
  get boxes() { return this.doors.map(d=>d.box); }
}
