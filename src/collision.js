// Grounded player cylinder (1.8 m high) against lightweight boxes. Pure math for testing.
export const PLAYER_RADIUS = .31;
export const PLAYER_HEIGHT = 1.8;
export function overlaps(position, box, radius = PLAYER_RADIUS) {
  if (box.max.y <= .035 || box.min.y >= PLAYER_HEIGHT) return false;
  const x = Math.max(box.min.x, Math.min(position.x, box.max.x));
  const z = Math.max(box.min.z, Math.min(position.z, box.max.z));
  return (position.x-x)**2 + (position.z-z)**2 < radius**2;
}
export function moveWithCollisions(position, dx, dz, boxes) {
  // Small steps prevent tunnelling through even narrow walls at low frame rates.
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz)/.08));
  const result = { x: position.x, z: position.z };
  for (let i=0; i<steps; i++) {
    const nextX = { x: result.x + dx/steps, z: result.z };
    if (!boxes.some(box => overlaps(nextX, box))) result.x = nextX.x;
    const nextZ = { x: result.x, z: result.z + dz/steps };
    if (!boxes.some(box => overlaps(nextZ, box))) result.z = nextZ.z;
  }
  return result;
}
