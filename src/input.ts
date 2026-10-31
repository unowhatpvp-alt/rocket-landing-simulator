/** Browser input only. Physics consumes a normalized sample once per fixed update. */
export class FlightControls {
  throttle = 0;
  pitch = 0;
  roll = 0;
  sensitivity = 1;
  onAction?: (action: 'camera' | 'reset' | 'pause' | 'hud') => void;

  private readonly keys = new Set<string>();
  private readonly cleanup: Array<() => void> = [];
  private keyboardThrottle = false;
  private pointerId: number | null = null;
  private stickX = 0;
  private stickY = 0;
  private readonly knob: HTMLElement | null;
  private disposed = false;

  constructor(private readonly slider: HTMLInputElement, private readonly joystick: HTMLElement) {
    this.knob = joystick.querySelector<HTMLElement>('[data-knob], .joystick-knob, .knob')
      ?? joystick.firstElementChild as HTMLElement | null;
    this.throttle = this.readSlider();
    if (this.knob) {
      this.knob.style.left = '50%';
      this.knob.style.top = '50%';
      this.renderStick();
    }
    joystick.style.touchAction = 'none';
    // Each thumb owns its control; native range gestures must not become page pinch/pan.
    slider.style.touchAction = 'none';

    const onKeyDown = (event: KeyboardEvent) => {
      // Modal controls own their keys, including Space for native button activation.
      if (document.querySelector('dialog[open]')) return;
      if (this.editing(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;
      const codes = ['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyR', 'KeyP', 'KeyH'];
      if (!codes.includes(event.code)) return;
      event.preventDefault();
      this.keys.add(event.code);
      if (event.code === 'Space') this.keyboardThrottle = true;
      if (event.repeat) return;
      const action = ({ KeyC: 'camera', KeyR: 'reset', KeyP: 'pause', KeyH: 'hud' } as const)
        [event.code as 'KeyC' | 'KeyR' | 'KeyP' | 'KeyH'];
      if (action) this.onAction?.(action);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (this.keys.delete(event.code)) event.preventDefault();
    };
    const onSlider = () => {
      this.keyboardThrottle = false;
      this.throttle = this.readSlider();
    };
    const onBlur = () => this.clearHeldInput();
    const onVisibility = () => { if (document.hidden) this.clearHeldInput(); };
    const onPointerDown = (event: PointerEvent) => {
      if (this.pointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      this.pointerId = event.pointerId;
      joystick.setPointerCapture(event.pointerId);
      this.moveStick(event);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (this.pointerId !== event.pointerId) return;
      event.preventDefault();
      this.moveStick(event);
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (this.pointerId !== event.pointerId) return;
      this.pointerId = null;
      if (joystick.hasPointerCapture(event.pointerId)) joystick.releasePointerCapture(event.pointerId);
      this.stickX = this.stickY = 0;
      this.renderStick();
    };
    const onContextMenu = (event: Event) => event.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    slider.addEventListener('input', onSlider);
    joystick.addEventListener('pointerdown', onPointerDown);
    joystick.addEventListener('pointermove', onPointerMove);
    joystick.addEventListener('pointerup', onPointerEnd);
    joystick.addEventListener('pointercancel', onPointerEnd);
    joystick.addEventListener('lostpointercapture', onPointerEnd);
    joystick.addEventListener('contextmenu', onContextMenu);
    this.cleanup.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
      () => document.removeEventListener('visibilitychange', onVisibility),
      () => slider.removeEventListener('input', onSlider),
      () => joystick.removeEventListener('pointerdown', onPointerDown),
      () => joystick.removeEventListener('pointermove', onPointerMove),
      () => joystick.removeEventListener('pointerup', onPointerEnd),
      () => joystick.removeEventListener('pointercancel', onPointerEnd),
      () => joystick.removeEventListener('lostpointercapture', onPointerEnd),
      () => joystick.removeEventListener('contextmenu', onContextMenu),
    );
  }

  update(dt: number): void {
    if (this.disposed) return;
    const elapsed = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    if (this.keyboardThrottle) {
      this.throttle += (this.keys.has('Space') ? 0.7 : -0.45) * elapsed;
    }
    this.throttle = Math.min(1, Math.max(0, this.throttle));
    const gain = Math.min(2, Math.max(0.1, this.sensitivity));
    this.pitch = this.clamp((Number(this.keys.has('KeyS')) - Number(this.keys.has('KeyW')) + this.stickY) * gain);
    this.roll = this.clamp((Number(this.keys.has('KeyA')) - Number(this.keys.has('KeyD')) - this.stickX) * gain);
    const min = Number(this.slider.min) || 0;
    const max = Number(this.slider.max) || 100;
    this.slider.value = String(min + this.throttle * (max - min));
    this.slider.style.setProperty('--throttle', `${this.throttle * 100}%`);
    this.slider.setAttribute('aria-valuetext', `${Math.round(this.throttle * 100)}% thrust`);
  }

  /** Clear a paused/modal input session before the application opens an overlay. */
  suspend(): void {
    if (!this.disposed) this.clearHeldInput();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearHeldInput();
    this.cleanup.forEach(remove => remove());
    this.cleanup.length = 0;
  }

  private readSlider(): number {
    const min = Number(this.slider.min) || 0;
    const max = Number(this.slider.max) || 100;
    return max > min ? this.clamp01((Number(this.slider.value) - min) / (max - min)) : 0;
  }

  private editing(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.closest('[contenteditable="true"], textarea, select')) return true;
    if (target instanceof HTMLInputElement) return target.type !== 'range';
    return false;
  }

  private moveStick(event: PointerEvent): void {
    const rect = this.joystick.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.36);
    let x = (event.clientX - rect.left - rect.width / 2) / radius;
    let y = (event.clientY - rect.top - rect.height / 2) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    this.stickX = x;
    this.stickY = y;
    this.renderStick();
  }

  private renderStick(): void {
    const radius = Math.min(this.joystick.clientWidth, this.joystick.clientHeight) * 0.36;
    if (this.knob) this.knob.style.transform = `translate(calc(-50% + ${this.stickX * radius}px), calc(-50% + ${this.stickY * radius}px))`;
    this.joystick.style.setProperty('--stick-x', String(this.stickX));
    this.joystick.style.setProperty('--stick-y', String(this.stickY));
  }

  private clearHeldInput(): void {
    this.keys.clear();
    this.stickX = this.stickY = this.pitch = this.roll = 0;
    this.keyboardThrottle = false;
    // Losing focus must never leave a held engine input running unattended.
    this.throttle = 0;
    if (this.pointerId !== null && this.joystick.hasPointerCapture(this.pointerId)) {
      this.joystick.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
    this.renderStick();
  }

  private clamp(value: number): number { return Math.min(1, Math.max(-1, value)); }
  private clamp01(value: number): number { return Math.min(1, Math.max(0, value)); }
}



