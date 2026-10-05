// Player cylinder against lightweight boxes. Feet and height are explicit so
// crouching/jumping use the same wall/door geometry as grounded movement.
export const PLAYER_RADIUS = .31;
export const PLAYER_HEIGHT = 1.8;
export function overlaps(position, box, radius = PLAYER_RADIUS) {
  const feet=position.feetY ?? 0, height=position.height ?? PLAYER_HEIGHT;
  if (box.max.y <= feet+.0001 || box.min.y >= feet+height-.0001) return false;
  return overlapsXZ(position,box,radius);
}
function overlapsXZ(position,box,radius=PLAYER_RADIUS) {
  const x = Math.max(box.min.x, Math.min(position.x, box.max.x));
  const z = Math.max(box.min.z, Math.min(position.z, box.max.z));
  return (position.x-x)**2 + (position.z-z)**2 < radius**2;
}
export function moveWithCollisions(position, dx, dz, boxes, body = {}) {
  // Small steps prevent tunnelling through even narrow walls at low frame rates.
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz)/.08));
  const result = { x: position.x, z: position.z };
  for (let i=0; i<steps; i++) {
    const nextX = { ...body, x: result.x + dx/steps, z: result.z };
    if (!boxes.some(box => overlaps(nextX, box))) result.x = nextX.x;
    const nextZ = { ...body, x: result.x, z: result.z + dz/steps };
    if (!boxes.some(box => overlaps(nextZ, box))) result.z = nextZ.z;
  }
  return result;
}

export function moveVertically(position, dy, boxes, body) {
  const {feetY,height}=body;
  let feet=Math.max(0,feetY+dy),blocked=feetY+dy<0,grounded=dy<=0&&feet<=.0001;
  for(const box of boxes) {
    if(!overlapsXZ(position,box))continue;
    if(dy>0 && feetY+height<=box.min.y+.0001 && feet+height>box.min.y) {
      feet=box.min.y-height;blocked=true;grounded=false;
    } else if(dy<=0 && feetY>=box.max.y-.0001 && feet<box.max.y) {
      feet=box.max.y;blocked=true;grounded=true;
    }
  }
  return {feetY:feet,blocked,grounded};
}
