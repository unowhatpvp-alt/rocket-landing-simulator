import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightPhysics, FLIGHT_CONSTANTS, type FlightInput, type ResetOptions } from '../src/physics.ts';

const IDLE: FlightInput = { throttle: 0, pitch: 0, roll: 0 };
const FULL: FlightInput = { throttle: 1, pitch: 0, roll: 0 };

async function run(options: ResetOptions, input: FlightInput, seconds: number, fps = 60) {
  const physics = await FlightPhysics.create(options);
  for (let frame = 0; frame < Math.round(seconds * fps); frame++) physics.advance(1 / fps, input);
  const result = physics.snapshot();
  physics.dispose();
  return result;
}

test('fixed-step results are invariant at 30, 60, and 144 rendered frames per second', async () => {
  const results = await Promise.all([30, 60, 144].map(fps => run({}, FULL, 2, fps)));
  for (const result of results.slice(1)) {
    assert.equal(result.stepCount, results[0].stepCount);
    assert.ok(Math.abs(result.position.y - results[0].position.y) < 1e-6);
    assert.ok(Math.abs(result.fuelMass - results[0].fuelMass) < 1e-7);
    assert.ok(Math.abs(result.velocity.y - results[0].velocity.y) < 1e-6);
  }
});

test('gravity lowers the rocket and full thrust changes the velocity', async () => {
  const idle = await run({}, IDLE, 2);
  const thrust = await run({}, FULL, 2);
  assert.ok(idle.velocity.y < -20);
  assert.ok(idle.position.y < 70);
  assert.ok(thrust.velocity.y > idle.velocity.y + 20);
  assert.ok(thrust.position.y > idle.position.y);
});

test('engine response slews continuously and finite fuel reduces total mass', async () => {
  const physics = await FlightPhysics.create();
  const initial = physics.snapshot();
  const firstTick = physics.advance(FLIGHT_CONSTANTS.fixedDt, FULL);
  assert.ok(firstTick.throttle > 0 && firstTick.throttle < 0.02);
  for (let i = 0; i < 59; i++) physics.advance(FLIGHT_CONSTANTS.fixedDt, FULL);
  const halfSecond = physics.snapshot();
  assert.ok(halfSecond.throttle > 0.44 && halfSecond.throttle < 0.46);
  assert.ok(halfSecond.fuelMass < initial.fuelMass);
  assert.ok(halfSecond.mass < initial.mass);
  const reduced = physics.advance(FLIGHT_CONSTANTS.fixedDt, IDLE);
  assert.ok(reduced.throttle > 0 && reduced.throttle < halfSecond.throttle);
  physics.dispose();
});

test('unlimited fuel preserves mass; an empty tank produces no thrust', async () => {
  const unlimited = await run({ unlimitedFuel: true }, FULL, 2);
  assert.equal(unlimited.fuelMass, FLIGHT_CONSTANTS.fuelCapacity);
  const empty = await run({ fuelMass: 0 }, FULL, 1);
  assert.equal(empty.actualThrust, 0);
  assert.equal(empty.throttle, 0);
});

test('attitude input changes orientation; arcade stabilization damps residual tilt', async () => {
  const physics = await FlightPhysics.create({ position: { x: 0, y: 200, z: 0 }, velocity: { x: 0, y: 0, z: 0 } });
  for (let i = 0; i < 60; i++) physics.advance(1 / 120, { ...IDLE, pitch: 1 });
  const driven = physics.snapshot();
  assert.ok(driven.tilt > 1);
  for (let i = 0; i < 240; i++) physics.advance(1 / 120, IDLE);
  const settled = physics.snapshot();
  assert.ok(settled.tilt < driven.tilt + 1);
  assert.ok(Math.abs(settled.angularVelocity.x) < 0.1);
  physics.dispose();
});

test('actual foot collision at low speed registers a safe landing', async () => {
  const result = await run({ position: { x: 0, y: 3.015, z: 0 }, velocity: { x: 0, y: -0.5, z: 0 } }, IDLE, 1);
  assert.equal(result.status, 'landed');
  assert.equal(result.contact, true);
  assert.equal(result.altitude, 0);
  assert.ok(result.touchdownSpeed! < 3);
});

test('the default scenario is winnable with a fixed manual throttle schedule', async () => {
  const physics = await FlightPhysics.create();
  let result = physics.snapshot();
  // A reproducible human-input fixture, never used by the application:
  // coast until 1.9 s, command full power until 4.3 s, then hold 43%.
  for (let tick = 0; tick < 120 * 20 && result.status === 'flying'; tick++) {
    const time = tick / 120;
    result = physics.advance(1 / 120, { ...IDLE, throttle: time < 1.9 ? 0 : time < 4.3 ? 1 : 0.43 });
  }
  assert.equal(result.status, 'landed');
  assert.ok(result.touchdownSpeed! < 1.5);
  assert.ok(result.fuel > 0.85);
  assert.ok(result.time > 9 && result.time < 10);
  physics.dispose();
});

test('a hard impact is a crash even when centred over the deck', async () => {
  const result = await run({ position: { x: 0, y: 3.2, z: 0 }, velocity: { x: 0, y: -12, z: 0 } }, IDLE, 1);
  assert.equal(result.status, 'crashed');
  assert.equal(result.contact, true);
  assert.ok(result.touchdownSpeed! > 3);
});

test('deck edge and sea contact cannot produce a successful landing', async () => {
  const edge = await run({ position: { x: 20, y: 3.02, z: 0 }, velocity: { x: 0, y: -0.5, z: 0 } }, IDLE, 2);
  assert.equal(edge.status, 'crashed');
  const sea = await run({ position: { x: 50, y: 0.02, z: 0 }, velocity: { x: 0, y: -0.5, z: 0 } }, IDLE, 2);
  assert.equal(sea.status, 'crashed');
});

test('realistic mode uses stricter touchdown limits than arcade', async () => {
  const options: ResetOptions = { position: { x: 0, y: 3.015, z: 0 }, velocity: { x: 0, y: -2.1, z: 0 } };
  const arcade = await run({ ...options, mode: 'arcade' }, IDLE, 1);
  const realistic = await run({ ...options, mode: 'realistic' }, IDLE, 1);
  assert.equal(arcade.status, 'landed');
  assert.equal(realistic.status, 'crashed');
});

test('an excessive tilt or sideways velocity makes touchdown unsafe', async () => {
  const tilted = await run({ position: { x: 0, y: 4, z: 0 }, velocity: { x: 0, y: -0.5, z: 0 },
    tilt: { pitch: 0.3, roll: 0 } }, { ...IDLE, stabilization: false }, 2);
  assert.equal(tilted.status, 'crashed');
  const sideways = await run({ position: { x: 0, y: 3.015, z: 0 }, velocity: { x: 4, y: -0.5, z: 0 } }, IDLE, 1);
  assert.equal(sideways.status, 'crashed');
});

test('five minutes of fixed updates remain finite without accumulating simulation debt', async () => {
  const hoverThrottle = (FLIGHT_CONSTANTS.dryMass + FLIGHT_CONSTANTS.fuelCapacity)
    * FLIGHT_CONSTANTS.gravity / FLIGHT_CONSTANTS.maxThrust;
  const result = await run({ unlimitedFuel: true, position: { x: 0, y: 10_000, z: 0 },
    velocity: { x: 0, y: 0, z: 0 } }, { ...IDLE, throttle: hoverThrottle }, 300);
  assert.equal(result.status, 'flying');
  assert.equal(result.stepCount, 36_000);
  assert.ok(Math.abs(result.time - 300) < 1e-6);
  for (const component of Object.values(result.position)) assert.ok(Number.isFinite(component));
  assert.ok(result.tilt < 0.001);
});

test('reset replaces state; resources can be released repeatedly without leaks', async () => {
  const physics = await FlightPhysics.create();
  for (let i = 0; i < 40; i++) {
    physics.advance(0.1, FULL);
    physics.reset({ mode: i % 2 ? 'arcade' : 'realistic' });
    assert.equal(physics.snapshot().time, 0);
    assert.equal(physics.snapshot().status, 'flying');
    assert.equal(physics.snapshot().fuel, 1);
  }
  physics.dispose();
  physics.dispose();
  assert.throws(() => physics.advance(1 / 60, IDLE), /disposed/);
});
