import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCameraRelativeInput, controlYawFromDirection, type AttitudeInput } from '../src/control-frame.ts';
import { FlightPhysics } from '../src/physics.ts';

function close(actual: number, expected: number, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`);
}
function expectInput(actual: AttitudeInput, expected: AttitudeInput) {
  close(actual.pitch, expected.pitch);
  close(actual.roll, expected.roll);
}

// Existing input signs: W=(-1,0), D=(0,-1), S=(1,0), A=(0,1).
const headings = [
  { name: '+Z', yaw: 0, forward: { pitch: 1, roll: 0 }, right: { pitch: 0, roll: 1 } },
  { name: '+X', yaw: Math.PI / 2, forward: { pitch: 0, roll: -1 }, right: { pitch: 1, roll: 0 } },
  { name: '-Z', yaw: Math.PI, forward: { pitch: -1, roll: 0 }, right: { pitch: 0, roll: -1 } },
  { name: '-X', yaw: -Math.PI / 2, forward: { pitch: 0, roll: 1 }, right: { pitch: -1, roll: 0 } },
];

for (const heading of headings) {
  test(`W/D follow camera forward/right when looking ${heading.name}`, () => {
    expectInput(mapCameraRelativeInput(-1, 0, heading.yaw), heading.forward);
    expectInput(mapCameraRelativeInput(0, -1, heading.yaw), heading.right);
    expectInput(mapCameraRelativeInput(1, 0, heading.yaw), {
      pitch: -heading.forward.pitch, roll: -heading.forward.roll,
    });
    expectInput(mapCameraRelativeInput(0, 1, heading.yaw), {
      pitch: -heading.right.pitch, roll: -heading.right.roll,
    });
  });
}

test('diagonal commands are normalized and remain aligned for an oblique heading', () => {
  for (const yaw of [0, Math.PI / 6, Math.PI / 4, 1.234, Math.PI, -2.34]) {
    const combined = mapCameraRelativeInput(-1, -1, yaw);
    const forward = mapCameraRelativeInput(-1, 0, yaw);
    const right = mapCameraRelativeInput(0, -1, yaw);
    close(combined.pitch, (forward.pitch + right.pitch) / Math.SQRT2);
    close(combined.roll, (forward.roll + right.roll) / Math.SQRT2);
    close(Math.hypot(combined.pitch, combined.roll), 1);
  }
});

test('camera rotation preserves analog magnitude and orthogonality', () => {
  for (let index = 0; index < 48; index++) {
    const yaw = index * Math.PI / 24;
    const input = mapCameraRelativeInput(-0.3, -0.4, yaw);
    close(Math.hypot(input.pitch, input.roll), 0.5);
    const forward = mapCameraRelativeInput(-1, 0, yaw);
    const right = mapCameraRelativeInput(0, -1, yaw);
    close(forward.pitch * right.pitch + forward.roll * right.roll, 0);
    expectInput(mapCameraRelativeInput(-0.3, -0.4, yaw + 2 * Math.PI), input);
  }
});

test('idle and malformed input cannot create an unintended attitude command', () => {
  expectInput(mapCameraRelativeInput(0, 0, 1.3), { pitch: 0, roll: 0 });
  expectInput(mapCameraRelativeInput(Number.NaN, Infinity, 0), { pitch: 0, roll: 0 });
  expectInput(mapCameraRelativeInput(-1, 0, Number.NaN), { pitch: -1, roll: 0 });
  close(Math.hypot(...Object.values(mapCameraRelativeInput(-10, 20, 0.7))), 1);
});

test('heading extraction matches the scene yaw convention and ignores vector scale', () => {
  close(controlYawFromDirection({ x: 0, y: -0.7, z: 1 }), 0);
  close(controlYawFromDirection({ x: 1, y: 0, z: 0 }), Math.PI / 2);
  close(controlYawFromDirection({ x: 0, y: 0, z: -1 }), Math.PI);
  close(controlYawFromDirection({ x: -1, y: 0, z: 0 }), -Math.PI / 2);
  close(controlYawFromDirection({ x: 30, y: -10, z: 40 }), Math.atan2(3, 4));
});

test('top-down, zero, and invalid camera directions retain the previous stable heading', () => {
  const previous = 1.234;
  for (const direction of [
    { x: 0, y: -1, z: 0 }, { x: 1e-7, y: -1, z: -1e-7 },
    { x: -0.01, y: -1, z: 0.01 }, { x: 0, y: 0, z: 0 },
    { x: Number.NaN, y: -1, z: 0 }, { x: 0, y: Infinity, z: 1 },
  ]) assert.equal(controlYawFromDirection(direction, previous), previous);
  assert.equal(controlYawFromDirection({ x: 0, y: -1, z: 0 }, Number.NaN), Math.PI);
  close(controlYawFromDirection({ x: 0.1, y: -1, z: 0 }, previous), Math.PI / 2);
});

test('mapped W and D produce acceleration along actual camera forward and right', async () => {
  const physics = await FlightPhysics.create({
    unlimitedFuel: true, position: { x: 0, y: 300, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
  });
  try {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.71]) {
      for (const [pitch, roll, rightward] of [[-1, 0, false], [0, -1, true]] as const) {
        physics.reset({ unlimitedFuel: true, position: { x: 0, y: 300, z: 0 }, velocity: { x: 0, y: 0, z: 0 } });
        const command = mapCameraRelativeInput(pitch, roll, yaw);
        for (let tick = 0; tick < 120; tick++) physics.advance(1 / 120, {
          ...command, throttle: 1, stabilization: true,
        });
        const { velocity } = physics.snapshot();
        const expectedX = rightward ? -Math.cos(yaw) : Math.sin(yaw);
        const expectedZ = rightward ? Math.sin(yaw) : Math.cos(yaw);
        const parallel = velocity.x * expectedX + velocity.z * expectedZ;
        const perpendicular = velocity.x * expectedZ - velocity.z * expectedX;
        assert.ok(parallel > 0.5, `yaw ${yaw}: expected acceleration in camera direction`);
        assert.ok(Math.abs(perpendicular) < 0.02, `yaw ${yaw}: unexpected sideways acceleration`);
      }
    }
  } finally { physics.dispose(); }
});
