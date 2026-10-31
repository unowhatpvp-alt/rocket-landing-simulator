/** Camera-relative attitude controls, without rendering or physics dependencies. */
export interface AttitudeInput {
  pitch: number;
  roll: number;
}

export interface ViewDirection {
  x: number;
  y: number;
  z: number;
}

const LEGACY_FORWARD_YAW = Math.PI;
const MIN_HORIZONTAL_RATIO = 0.05;

function finiteAxis(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
}

/**
 * Convert existing keyboard/stick signs (pitch = S-W, roll = A-D) into
 * world-axis attitude commands using the current camera's horizontal heading.
 *
 * yaw = atan2(viewForward.x, viewForward.z): 0 looks +Z, pi/2 looks +X.
 * The screen-right basis is (-cos(yaw), sin(yaw)) in world X/Z.
 * Physics positive pitch tilts toward +Z; positive roll tilts toward -X.
 * Normalize combined input so diagonal keys cannot increase total authority.
 */
export function mapCameraRelativeInput(pitch: number, roll: number, controlYaw: number): AttitudeInput {
  let screenForward = -finiteAxis(pitch);
  let screenRight = -finiteAxis(roll);
  const magnitude = Math.hypot(screenForward, screenRight);
  if (magnitude === 0) return { pitch: 0, roll: 0 };
  if (magnitude > 1) {
    screenForward /= magnitude;
    screenRight /= magnitude;
  }
  const yaw = Number.isFinite(controlYaw) ? controlYaw : LEGACY_FORWARD_YAW;
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const worldX = sin * screenForward - cos * screenRight;
  const worldZ = cos * screenForward + sin * screenRight;
  return { pitch: worldZ, roll: -worldX };
}

/**
 * Retain the last useful camera heading for near-vertical views. Tiny projected
 * vectors otherwise make a top-down camera's controls flip with rounding noise.
 * The direction need not be normalized. Invalid/zero directions also retain yaw.
 */
export function controlYawFromDirection(direction: ViewDirection, previousYaw = LEGACY_FORWARD_YAW): number {
  const fallback = Number.isFinite(previousYaw) ? previousYaw : LEGACY_FORWARD_YAW;
  if (![direction.x, direction.y, direction.z].every(Number.isFinite)) return fallback;
  const horizontal = Math.hypot(direction.x, direction.z);
  const length = Math.hypot(horizontal, direction.y);
  if (length === 0 || horizontal / length < MIN_HORIZONTAL_RATIO) return fallback;
  return Math.atan2(direction.x, direction.z);
}
