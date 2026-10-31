import type { FlightSnapshot, Quaternion, Vec3 } from './physics';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVector(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

function normalized(q: Quaternion): Quaternion {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (length === 0 || !Number.isFinite(length)) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

/** Shortest-path spherical interpolation; q and -q represent one orientation. */
function slerpQuaternion(from: Quaternion, to: Quaternion, t: number): Quaternion {
  const a = normalized(from);
  let b = normalized(to);
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  if (dot < 0) {
    dot = -dot;
    b = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }
  dot = Math.min(1, Math.max(0, dot));
  if (dot > 0.9995) return normalized({
    x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t), w: lerp(a.w, b.w, t),
  });
  const angle = Math.acos(dot);
  const denominator = Math.sin(angle);
  const left = Math.sin((1 - t) * angle) / denominator;
  const right = Math.sin(t * angle) / denominator;
  return normalized({
    x: a.x * left + b.x * right, y: a.y * left + b.y * right,
    z: a.z * left + b.z * right, w: a.w * left + b.w * right,
  });
}

/**
 * Interpolate two recorded snapshots for display only. t is the normalized
 * fraction between their timestamps, clamped to [0,1]; neither input is changed.
 * Contact/result and other discrete state remain at a until b is reached.
 * The interpolated result must never be fed back into the flight simulation.
 */
export function interpolateSnapshot(a: FlightSnapshot, b: FlightSnapshot, t: number): FlightSnapshot {
  const fraction = Number.isNaN(t) ? 0 : Math.min(1, Math.max(0, t));
  const discrete = fraction < 1 ? a : b;
  return {
    ...discrete,
    position: lerpVector(a.position, b.position, fraction),
    quaternion: slerpQuaternion(a.quaternion, b.quaternion, fraction),
    velocity: lerpVector(a.velocity, b.velocity, fraction),
    angularVelocity: lerpVector(a.angularVelocity, b.angularVelocity, fraction),
    acceleration: lerpVector(a.acceleration, b.acceleration, fraction),
    time: lerp(a.time, b.time, fraction),
    altitude: lerp(a.altitude, b.altitude, fraction),
    fuel: lerp(a.fuel, b.fuel, fraction),
    fuelMass: lerp(a.fuelMass, b.fuelMass, fraction),
    mass: lerp(a.mass, b.mass, fraction),
    throttle: lerp(a.throttle, b.throttle, fraction),
    targetThrottle: lerp(a.targetThrottle, b.targetThrottle, fraction),
    actualThrust: lerp(a.actualThrust, b.actualThrust, fraction),
    tilt: lerp(a.tilt, b.tilt, fraction),
    offset: lerp(a.offset, b.offset, fraction),
  };
}
