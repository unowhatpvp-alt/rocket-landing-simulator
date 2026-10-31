/** Original engine synthesis. The first explicit toggle is the audio gesture. */
export class EngineAudio {
  enabled = false;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private rumble: OscillatorNode | null = null;
  private turbine: OscillatorNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private disposed = false;

  async toggle(): Promise<boolean> {
    if (this.disposed) return false;
    if (!this.context) this.initialize();
    const context = this.context!;
    if (context.state === 'suspended') await context.resume();
    this.enabled = !this.enabled;
    if (!this.enabled) this.master?.gain.setTargetAtTime(0, context.currentTime, 0.04);
    return this.enabled;
  }

  update(throttle: number, altitude: number, crashed: boolean): void {
    if (!this.context || !this.master || !this.filter || !this.rumble || !this.turbine) return;
    const amount = Number.isFinite(throttle) ? Math.max(0, Math.min(1, throttle)) : 0;
    const time = this.context.currentTime;
    const ground = Number.isFinite(altitude) ? Math.max(0, 1 - altitude / 25) : 0;
    const gain = this.enabled && !crashed ? Math.pow(amount, 0.8) * (0.11 + ground * 0.035) : 0;
    this.master.gain.setTargetAtTime(gain, time, 0.055);
    this.filter.frequency.setTargetAtTime(180 + amount * 1000 + ground * 160, time, 0.08);
    this.rumble.frequency.setTargetAtTime(30 + amount * 35, time, 0.08);
    this.turbine.frequency.setTargetAtTime(65 + amount * 80, time, 0.1);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.noise?.stop();
    this.rumble?.stop();
    this.turbine?.stop();
    this.noise?.disconnect();
    this.rumble?.disconnect();
    this.turbine?.disconnect();
    this.filter?.disconnect();
    this.master?.disconnect();
    void this.context?.close();
    this.context = null;
  }

  private initialize(): void {
    const context = new AudioContext();
    this.context = context;
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = buffer.getChannelData(0);
    // A repeatable noise texture is filtered into the low engine roar.
    let seed = 362436069;
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      samples[i] = ((seed >>> 0) / 2147483648 - 1) * 0.5;
    }
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const rumble = context.createOscillator();
    rumble.type = 'triangle';
    rumble.frequency.value = 30;
    const turbine = context.createOscillator();
    turbine.type = 'sawtooth';
    turbine.frequency.value = 65;
    const rumbleGain = context.createGain();
    rumbleGain.gain.value = 0.45;
    const turbineGain = context.createGain();
    turbineGain.gain.value = 0.055;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180;
    filter.Q.value = 0.6;
    const master = context.createGain();
    master.gain.value = 0;
    noise.connect(filter);
    rumble.connect(rumbleGain).connect(filter);
    turbine.connect(turbineGain).connect(filter);
    filter.connect(master).connect(context.destination);
    noise.start();
    rumble.start();
    turbine.start();
    this.noise = noise;
    this.rumble = rumble;
    this.turbine = turbine;
    this.filter = filter;
    this.master = master;
  }
}
