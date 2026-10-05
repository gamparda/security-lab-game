import { Vector3 } from '../vendor/three/build/three.module.js';
import { PointerLockControls } from '../vendor/three/examples/jsm/controls/PointerLockControls.js';
import { moveWithCollisions, moveVertically, overlaps } from './collision.js';
const STANDING_HEIGHT=1.8,CROUCH_HEIGHT=1.1,STANDING_EYE=1.65,CROUCH_EYE=.95;
const GRAVITY=12.5,JUMP_SPEED=4.3;
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
      if (['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight','ControlLeft','ControlRight','KeyC','Space'].includes(event.code)) {
        event.preventDefault(); this.keys.add(event.code);
        if(event.code==='Space'&&!event.repeat&&this.grounded)this.jumpQueued=true;
      }
    };
    this.up = event => this.keys.delete(event.code);
    this.clear = () => {this.keys.clear();this.jumpQueued=false;};
    document.addEventListener('keydown', this.down);
    document.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.clear);
    this.controls.addEventListener('unlock', this.clear);
  }
  reset() {
    this.camera.position.copy(this.spawn); this.camera.position.y = STANDING_EYE;
    this.camera.rotation.set(0,0,0); this.keys.clear(); this.movementSeconds = 0;
    this.feetY=0;this.height=STANDING_HEIGHT;this.eyeHeight=STANDING_EYE;
    this.verticalVelocity=0;this.grounded=true;this.crouched=false;this.jumpQueued=false;
    this.jumpCount=0;this.jumpPeak=0;
  }
  get body(){return {feetY:this.feetY,height:this.height};}
  update(dt, dynamicBoxes = []) {
    if (!this.controls.isLocked) return;
    let x = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    let z = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const length = Math.hypot(x,z);
    if(length){x /= length; z /= length;}
    this.camera.getWorldDirection(this.forward); this.forward.y=0; this.forward.normalize();
    this.right.crossVectors(this.forward, this.camera.up).normalize();
    const movementSeconds = Math.min(.1, Math.max(0,dt));
    const boxes=[...this.boxes,...dynamicBoxes];
    const wantsCrouch=this.keys.has('ControlLeft')||this.keys.has('ControlRight')||this.keys.has('KeyC');
    const standingBody={x:this.camera.position.x,z:this.camera.position.z,feetY:this.feetY,height:STANDING_HEIGHT};
    const cannotStand=this.crouched&&!wantsCrouch&&boxes.some(box=>overlaps(standingBody,box));
    this.crouched=wantsCrouch || (this.crouched&&cannotStand);
    this.height=this.crouched?CROUCH_HEIGHT:STANDING_HEIGHT;
    if(this.jumpQueued&&this.grounded){this.verticalVelocity=JUMP_SPEED;this.grounded=false;this.jumpCount++;this.jumpStart=this.feetY;this.jumpPeak=0;}
    this.jumpQueued=false;
    const speed=this.crouched?1.35:this.keys.has('ShiftLeft')||this.keys.has('ShiftRight')?4.2:2.6;
    if(length)this.movementSeconds+=movementSeconds;
    // Substeps integrate vertical and horizontal motion together: a long frame
    // cannot skip a lintel or land inside the side of a desk.
    const steps=Math.max(1,Math.ceil(movementSeconds/(1/120))),step=movementSeconds/steps;
    for(let i=0;i<steps;i++) {
      const distance=speed*step;
      const moved=moveWithCollisions(this.camera.position,(this.right.x*x+this.forward.x*z)*distance,
        (this.right.z*x+this.forward.z*z)*distance,boxes,this.body);
      this.camera.position.x=moved.x;this.camera.position.z=moved.z;
      const dy=this.verticalVelocity*step-.5*GRAVITY*step*step;
      this.verticalVelocity-=GRAVITY*step;
      const vertical=moveVertically(this.camera.position,dy,boxes,this.body);
      this.feetY=vertical.feetY;this.grounded=vertical.grounded;
      if(this.jumpCount)this.jumpPeak=Math.max(this.jumpPeak,this.feetY-this.jumpStart);
      if(vertical.blocked)this.verticalVelocity=0;
    }
    const targetEye=this.crouched?CROUCH_EYE:STANDING_EYE;
    this.eyeHeight+=(targetEye-this.eyeHeight)*(1-Math.exp(-movementSeconds*18));
    this.eyeHeight=Math.min(this.eyeHeight,this.height-.12);
    this.camera.position.y=this.feetY+this.eyeHeight;
  }
  dispose() {
    document.removeEventListener('keydown',this.down); document.removeEventListener('keyup',this.up);
    window.removeEventListener('blur',this.clear); this.controls.dispose();
  }
}
