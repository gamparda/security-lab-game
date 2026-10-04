import { Vector3 } from '../vendor/three/build/three.module.js';
import { PointerLockControls } from '../vendor/three/examples/jsm/controls/PointerLockControls.js';
import { moveWithCollisions } from './collision.js';
export class Player {
  constructor(camera, canvas, boxes, spawn) {
    this.camera = camera; this.boxes = boxes; this.keys = new Set();
    this.spawn = spawn.clone(); this.controls = new PointerLockControls(camera, canvas);
    this.controls.pointerSpeed = .7;
    this.controls.minPolarAngle = .15; this.controls.maxPolarAngle = Math.PI-.15;
    this.forward = new Vector3(); this.right = new Vector3();
    this.reset();
    this.down = event => {
      if (!this.controls.isLocked) return;
      if (['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight'].includes(event.code)) {
        event.preventDefault(); this.keys.add(event.code);
      }
    };
    this.up = event => this.keys.delete(event.code);
    this.clear = () => this.keys.clear();
    document.addEventListener('keydown', this.down);
    document.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.clear);
    this.controls.addEventListener('unlock', this.clear);
  }
  reset() { this.camera.position.copy(this.spawn); this.camera.position.y = 1.65; this.camera.rotation.set(0,0,0); this.keys.clear(); this.movementSeconds = 0; }
  update(dt, dynamicBoxes = []) {
    if (!this.controls.isLocked) return;
    let x = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    let z = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const length = Math.hypot(x,z);
    if (!length) return;
    x /= length; z /= length;
    this.camera.getWorldDirection(this.forward); this.forward.y=0; this.forward.normalize();
    this.right.crossVectors(this.forward, this.camera.up).normalize();
    const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4.2 : 2.6;
    const movementSeconds = Math.min(.1, Math.max(0,dt));
    this.movementSeconds += movementSeconds;
    const distance = speed * movementSeconds;
    const moved = moveWithCollisions(this.camera.position, (this.right.x*x+this.forward.x*z)*distance,
      (this.right.z*x+this.forward.z*z)*distance, [...this.boxes,...dynamicBoxes]);
    this.camera.position.set(moved.x,1.65,moved.z);
  }
  dispose() {
    document.removeEventListener('keydown',this.down); document.removeEventListener('keyup',this.up);
    window.removeEventListener('blur',this.clear); this.controls.dispose();
  }
}
