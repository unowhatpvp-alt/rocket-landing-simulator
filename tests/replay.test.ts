import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolateSnapshot } from '../src/replay.ts';
import type { FlightSnapshot } from '../src/physics.ts';

function snapshot(overrides: Partial<FlightSnapshot> = {}): FlightSnapshot {
  return {
    position: { x: 0, y: 20, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: -4, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0, y: -1, z: 0 }, altitude: 17, fuel: 0.9, fuelMass: 8100,
    mass: 23100, throttle: 0.4, targetThrottle: 0.5, actualThrust: 220000,
    tilt: 0, offset: 0, status: 'flying', time: 1, contact: false, physicsMs: 0.1,
    stepCount: 120, mode: 'arcade', unlimitedFuel: false,
    touchdownSpeed: null, touchdownTilt: null, ...overrides,
  };
}
function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);
}

test('replay interpolates motion and telemetry continuously without mutating recordings', () => {
  const a = snapshot();
  const b = snapshot({ position: { x: 4, y: 12, z: -8 }, velocity: { x: 2, y: -2, z: 4 },
    angularVelocity: { x: 0.2, y: 0, z: 0.4 }, time: 2, throttle: 0.8, fuel: 0.8, fuelMass: 7200,
    mass: 22200, altitude: 9, actualThrust: 440000 });
  const beforeA = structuredClone(a), beforeB = structuredClone(b);
  const middle = interpolateSnapshot(a, b, 0.5);
  assert.deepEqual(middle.position, { x: 2, y: 16, z: -4 });
  assert.deepEqual(middle.velocity, { x: 1, y: -3, z: 2 });
  assert.deepEqual(middle.angularVelocity, { x: 0.1, y: 0, z: 0.2 });
  close(middle.time, 1.5); close(middle.throttle, 0.6); close(middle.fuel, 0.85);
  close(middle.fuelMass, 7650); close(middle.mass, 22650); close(middle.actualThrust, 330000);
  assert.deepEqual(a, beforeA); assert.deepEqual(b, beforeB);
  assert.notEqual(middle.position, a.position);
  assert.deepEqual(interpolateSnapshot(a, b, -1).position, a.position);
  assert.deepEqual(interpolateSnapshot(a, b, 2).position, b.position);
});

test('quaternions follow the normalized shortest arc even for opposite-sign endpoints', () => {
  const a = snapshot();
  const b = snapshot({ quaternion: { x: 0, y: 0, z: -Math.SQRT1_2 * 2, w: -Math.SQRT1_2 * 2 } });
  const q = interpolateSnapshot(a, b, 0.5).quaternion;
  close(q.z, Math.sin(Math.PI / 8)); close(q.w, Math.cos(Math.PI / 8));
  close(Math.hypot(q.x, q.y, q.z, q.w), 1);
  const sameRotation = interpolateSnapshot(a, snapshot({ quaternion: { x: 0, y: 0, z: 0, w: -3 } }), 0.5).quaternion;
  assert.deepEqual(sameRotation, { x: 0, y: 0, z: 0, w: 1 });
});

test('touchdown state and event measurements change only when the next sample is reached', () => {
  const a = snapshot();
  const b = snapshot({ status: 'landed', contact: true, touchdownSpeed: 1.2, touchdownTilt: 2,
    position: { x: 0, y: 3, z: 0 }, altitude: 0, time: 1 + 1 / 30, throttle: 0, stepCount: 124 });
  const justBefore = interpolateSnapshot(a, b, 0.999);
  assert.equal(justBefore.status, 'flying'); assert.equal(justBefore.contact, false);
  assert.equal(justBefore.touchdownSpeed, null); assert.equal(justBefore.touchdownTilt, null);
  assert.equal(justBefore.stepCount, 120); assert.ok(justBefore.altitude > 0);
  const reached = interpolateSnapshot(a, b, 1);
  assert.equal(reached.status, 'landed'); assert.equal(reached.contact, true);
  assert.equal(reached.touchdownSpeed, 1.2); assert.equal(reached.touchdownTilt, 2);
  assert.equal(reached.altitude, 0); assert.equal(reached.stepCount, 124);
});
