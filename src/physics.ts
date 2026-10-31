import RAPIER from '@dimforge/rapier3d-compat';

export type FlightMode = 'arcade' | 'realistic';
export type FlightStatus = 'flying' | 'landed' | 'crashed';
export interface Vec3 { x: number; y: number; z: number }
export interface Quaternion { x: number; y: number; z: number; w: number }
export interface FlightInput {
  throttle: number;
  pitch: number;
  roll: number;
  stabilization?: boolean;
}
export interface ResetOptions {
  mode?: FlightMode;
  unlimitedFuel?: boolean;
  /** Rocket base, in metres. Deck surface is y = 3. */
  position?: Vec3;
  velocity?: Vec3;
  /** Initial pitch and roll, in radians. */
  tilt?: { pitch: number; roll: number };
  fuelMass?: number;
}
export interface FlightSnapshot {
  position: Vec3;
  quaternion: Quaternion;
  velocity: Vec3;
  angularVelocity: Vec3;
  acceleration: Vec3;
  altitude: number;
  fuel: number;
  fuelMass: number;
  mass: number;
  throttle: number;
  targetThrottle: number;
  actualThrust: number;
  tilt: number;
  offset: number;
  status: FlightStatus;
  time: number;
  contact: boolean;
  physicsMs: number;
  stepCount: number;
  mode: FlightMode;
  unlimitedFuel: boolean;
  touchdownSpeed: number | null;
  touchdownTilt: number | null;
}

export const FLIGHT_CONSTANTS = Object.freeze({
  fixedDt: 1 / 120,
  gravity: 9.81,
  dryMass: 15_000,
  fuelCapacity: 9_000,
  maxThrust: 550_000,
  fuelBurnRate: 185,
  centreHeight: 10,
  deckTop: 3,
  deckHalfWidth: 22,
});

const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
// Match the exported GLB: four legs at 45-degree diagonals, radius 4.35 m.
const FOOT_CORNER = 4.35 / Math.sqrt(2);
const FOOT_OFFSETS = [
  { x: FOOT_CORNER, y: -9.65, z: FOOT_CORNER }, { x: -FOOT_CORNER, y: -9.65, z: FOOT_CORNER },
  { x: FOOT_CORNER, y: -9.65, z: -FOOT_CORNER }, { x: -FOOT_CORNER, y: -9.65, z: -FOOT_CORNER },
];

function clamp(n: number, low: number, high: number) {
  return Number.isFinite(n) ? Math.min(high, Math.max(low, n)) : low;
}
function rotate(v: Vec3, q: Quaternion): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}
function initialRotation(pitch: number, roll: number): Quaternion {
  const sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
  const sz = Math.sin(roll / 2), cz = Math.cos(roll / 2);
  return { x: sx * cz, y: -sx * sz, z: cx * sz, w: cx * cz };
}

let initialization: Promise<void> | undefined;

/** Client-local SI-unit rigid-body simulation. No visual or DOM dependencies. */
export class FlightPhysics {
  private world!: RAPIER.World;
  private events!: RAPIER.EventQueue;
  private body!: RAPIER.RigidBody;
  private deckHandle = -1;
  private waterHandle = -1;
  private footHandles = new Set<number>();
  private accumulator = 0;
  private elapsed = 0;
  private steps = 0;
  private fuelMass: number = FLIGHT_CONSTANTS.fuelCapacity;
  private throttle = 0;
  private targetThrottle = 0;
  private thrust = 0;
  private mode: FlightMode = 'arcade';
  private unlimitedFuel = false;
  private status: FlightStatus = 'flying';
  private contact = false;
  private acceleration: Vec3 = { ...ZERO };
  private physicsMs = 0;
  private touchdownSpeed: number | null = null;
  private touchdownTilt: number | null = null;
  private disposed = false;

  private constructor() {}

  static async create(options: ResetOptions = {}): Promise<FlightPhysics> {
    initialization ??= RAPIER.init();
    await initialization;
    const simulation = new FlightPhysics();
    simulation.reset(options);
    return simulation;
  }

  reset(options: ResetOptions = {}): void {
    if (this.disposed) throw new Error('Cannot reset a disposed flight simulation.');
    this.events?.free();
    this.world?.free();
    this.mode = options.mode ?? this.mode;
    this.unlimitedFuel = options.unlimitedFuel ?? this.unlimitedFuel;
    this.fuelMass = clamp(options.fuelMass ?? FLIGHT_CONSTANTS.fuelCapacity, 0, FLIGHT_CONSTANTS.fuelCapacity);
    this.accumulator = this.elapsed = this.steps = this.throttle = this.targetThrottle = this.thrust = 0;
    this.physicsMs = 0;
    this.status = 'flying';
    this.contact = false;
    this.acceleration = { ...ZERO };
    this.touchdownSpeed = this.touchdownTilt = null;
    this.footHandles.clear();
    this.world = new RAPIER.World({ x: 0, y: -FLIGHT_CONSTANTS.gravity, z: 0 });
    this.world.timestep = FLIGHT_CONSTANTS.fixedDt;
    this.events = new RAPIER.EventQueue(true);

    const deckBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1.5, 0));
    const deck = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(FLIGHT_CONSTANTS.deckHalfWidth, 1.5, FLIGHT_CONSTANTS.deckHalfWidth)
        .setFriction(0.9).setRestitution(0).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), deckBody,
    );
    this.deckHandle = deck.handle;
    const water = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(10_000, 0.5, 10_000).setTranslation(0, -0.5, 0)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    );
    this.waterHandle = water.handle;

    const base = options.position ?? { x: 10, y: 98, z: 5 };
    const q = initialRotation(options.tilt?.pitch ?? 0, options.tilt?.roll ?? 0);
    const centreOffset = rotate({ x: 0, y: FLIGHT_CONSTANTS.centreHeight, z: 0 }, q);
    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(base.x + centreOffset.x, base.y + centreOffset.y, base.z + centreOffset.z)
        .setRotation(q).setCcdEnabled(true).setCanSleep(false)
        .setLinearDamping(0.001).setAngularDamping(this.mode === 'arcade' ? 0.6 : 0.15),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(8.6, 1.8).setDensity(0).setFriction(0.6).setRestitution(0.02)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), this.body,
    );
    for (const offset of FOOT_OFFSETS) {
      const foot = this.world.createCollider(
        RAPIER.ColliderDesc.ball(0.35).setTranslation(offset.x, offset.y, offset.z).setDensity(0)
          .setFriction(1).setRestitution(0).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), this.body,
      );
      this.footHandles.add(foot.handle);
    }
    this.updateMass();
    this.body.setLinvel(options.velocity ?? { x: 0, y: -8, z: 0 }, true);
  }

  private updateMass() {
    const mass = FLIGHT_CONSTANTS.dryMass + this.fuelMass;
    this.body.setAdditionalMassProperties(mass, ZERO,
      { x: mass * 35, y: mass * 1.8, z: mass * 35 }, IDENTITY, true);
  }

  /** Wall time is accumulated; forces and engine response run only on 120 Hz ticks. */
  advance(deltaSeconds: number, input: FlightInput): FlightSnapshot {
    if (this.disposed) throw new Error('Cannot advance a disposed flight simulation.');
    if (this.status !== 'flying') return this.snapshot();
    // A resumed/background tab cannot queue an unbounded catch-up spiral.
    this.accumulator += clamp(deltaSeconds, 0, 0.25);
    const started = performance.now();
    while (this.accumulator + 1e-10 >= FLIGHT_CONSTANTS.fixedDt && this.status === 'flying') {
      this.tick(input);
      this.accumulator = Math.max(0, this.accumulator - FLIGHT_CONSTANTS.fixedDt);
    }
    this.physicsMs = performance.now() - started;
    return this.snapshot();
  }

  private tick(input: FlightInput): void {
    const dt = FLIGHT_CONSTANTS.fixedDt;
    this.targetThrottle = clamp(input.throttle, 0, 1);
    const hasFuel = this.unlimitedFuel || this.fuelMass > 0;
    const target = hasFuel ? this.targetThrottle : 0;
    const slewRate = this.mode === 'arcade' ? 0.9 : 0.55;
    this.throttle += clamp(target - this.throttle, -slewRate * dt, slewRate * dt);
    if (!hasFuel) this.throttle = 0;
    this.thrust = this.throttle * FLIGHT_CONSTANTS.maxThrust;
    if (!this.unlimitedFuel && this.fuelMass > 0) {
      this.fuelMass = Math.max(0, this.fuelMass - this.throttle * FLIGHT_CONSTANTS.fuelBurnRate * dt);
      this.updateMass();
    }

    const rotation = this.body.rotation();
    const up = rotate({ x: 0, y: 1, z: 0 }, rotation);
    const velocity = this.body.linvel();
    const beforeVelocity = { x: velocity.x, y: velocity.y, z: velocity.z };
    const angular = this.body.angvel();
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    const drag = 0.5 * 1.225 * 0.35 * 32 * speed;
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.body.addForce({
      x: up.x * this.thrust - drag * velocity.x,
      y: up.y * this.thrust - drag * velocity.y,
      z: up.z * this.thrust - drag * velocity.z,
    }, true);
    const inertia = (FLIGHT_CONSTANTS.dryMass + this.fuelMass) * 35;
    const assisted = input.stabilization !== false;
    const correction = assisted ? (this.mode === 'arcade' ? 1.4 : 0.5) : 0;
    const damping = assisted ? (this.mode === 'arcade' ? 1.7 : 0.55) : 0.08;
    const authority = this.mode === 'arcade' ? 0.75 : 0.4;
    this.body.addTorque({
      x: inertia * (clamp(input.pitch, -1, 1) * authority - up.z * correction - angular.x * damping),
      y: -inertia * angular.y * damping * 0.15,
      z: inertia * (clamp(input.roll, -1, 1) * authority + up.x * correction - angular.z * damping),
    }, true);

    this.world.step(this.events);
    this.elapsed += dt;
    this.steps++;
    const afterVelocity = this.body.linvel();
    this.acceleration = {
      x: (afterVelocity.x - beforeVelocity.x) / dt,
      y: (afterVelocity.y - beforeVelocity.y) / dt,
      z: (afterVelocity.z - beforeVelocity.z) / dt,
    };
    let surfaceHit = false;
    let feetHit = true;
    this.events.drainCollisionEvents((handleA, handleB, started) => {
      if (!started) return;
      if (handleA === this.waterHandle || handleB === this.waterHandle) {
        const other = handleA === this.waterHandle ? handleB : handleA;
        if (other !== this.deckHandle) { surfaceHit = true; feetHit = false; }
      }
      if (handleA === this.deckHandle || handleB === this.deckHandle) {
        const other = handleA === this.deckHandle ? handleB : handleA;
        if (other !== this.waterHandle) {
          surfaceHit = true;
          feetHit = feetHit && this.footHandles.has(other);
        }
      }
    });
    if (surfaceHit) this.resolveTouchdown(beforeVelocity, feetHit);
    const current = this.body.translation();
    if (current.y < -30 || Math.hypot(current.x, current.z) > 2_000) {
      this.status = 'crashed';
      this.throttle = this.thrust = 0;
    }
  }

  private resolveTouchdown(impactVelocity: Vec3, feetHit: boolean): void {
    const rotation = this.body.rotation();
    const up = rotate({ x: 0, y: 1, z: 0 }, rotation);
    const tilt = Math.acos(clamp(up.y, -1, 1)) * 180 / Math.PI;
    const p = this.body.translation();
    const feetInside = FOOT_OFFSETS.every(foot => {
      const offset = rotate(foot, rotation);
      return Math.abs(p.x + offset.x) < FLIGHT_CONSTANTS.deckHalfWidth - 0.4
        && Math.abs(p.z + offset.z) < FLIGHT_CONSTANTS.deckHalfWidth - 0.4;
    });
    const verticalLimit = this.mode === 'arcade' ? 3 : 1.8;
    const horizontalLimit = this.mode === 'arcade' ? 2 : 1;
    const angleLimit = this.mode === 'arcade' ? 10 : 5;
    this.contact = true;
    this.touchdownSpeed = Math.abs(impactVelocity.y);
    this.touchdownTilt = tilt;
    this.status = feetHit && feetInside && tilt <= angleLimit
      && Math.abs(impactVelocity.y) <= verticalLimit
      && Math.hypot(impactVelocity.x, impactVelocity.z) <= horizontalLimit ? 'landed' : 'crashed';
    this.throttle = this.thrust = 0;
    if (this.status === 'landed') {
      this.body.setRotation(IDENTITY, true);
      this.body.setTranslation({ x: p.x, y: FLIGHT_CONSTANTS.deckTop + FLIGHT_CONSTANTS.centreHeight, z: p.z }, true);
    }
    this.body.setLinvel(ZERO, true);
    this.body.setAngvel(ZERO, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
  }

  snapshot(): FlightSnapshot {
    const p = this.body.translation();
    const q = this.body.rotation();
    const offset = rotate({ x: 0, y: FLIGHT_CONSTANTS.centreHeight, z: 0 }, q);
    const position = { x: p.x - offset.x, y: p.y - offset.y, z: p.z - offset.z };
    const velocity = this.body.linvel();
    const angular = this.body.angvel();
    const up = rotate({ x: 0, y: 1, z: 0 }, q);
    return {
      position, quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
      velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
      angularVelocity: { x: angular.x, y: angular.y, z: angular.z },
      acceleration: { ...this.acceleration },
      altitude: Math.max(0, position.y - FLIGHT_CONSTANTS.deckTop),
      fuel: this.fuelMass / FLIGHT_CONSTANTS.fuelCapacity,
      fuelMass: this.fuelMass, mass: FLIGHT_CONSTANTS.dryMass + this.fuelMass,
      throttle: this.throttle, targetThrottle: this.targetThrottle, actualThrust: this.thrust,
      tilt: Math.acos(clamp(up.y, -1, 1)) * 180 / Math.PI,
      offset: Math.hypot(position.x, position.z), status: this.status,
      time: this.elapsed, contact: this.contact, physicsMs: this.physicsMs, stepCount: this.steps,
      mode: this.mode, unlimitedFuel: this.unlimitedFuel,
      touchdownSpeed: this.touchdownSpeed, touchdownTilt: this.touchdownTilt,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.events.free();
    this.world.free();
    this.disposed = true;
  }
}
