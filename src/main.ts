import './style.css';
import { FlightPhysics, FLIGHT_CONSTANTS, type FlightSnapshot, type FlightMode } from './physics';
import { FlightControls } from './input';
import { FlightScene } from './scene';
import { EngineAudio } from './audio';
import { mapCameraRelativeInput } from './control-frame';
import { interpolateSnapshot } from './replay';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => { const el = $(id); if (el.textContent !== value) el.textContent = value; };
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);
const cameraNames = ['近景跟随 · 拖动绕看 / 缩放', '侧面观察', '远距离视角', '平台观察', '自由轨道 · 拖动旋转 / 滚轮缩放', '电影回放'];
let flight: FlightPhysics;
let scene: FlightScene;
let controls: FlightControls;
const audio = new EngineAudio();
let running = false;
let ready = false;
let camera = 0;
let visualTime = 0;
let frame = 0;
let previousTime = performance.now();
let uiElapsed = 0;
let fpsElapsed = 0;
let fpsFrames = 0;
let fps = 60;
let automaticQuality = true;
let quality: 'low' | 'medium' | 'high' | 'ultra' = innerWidth < 700 ? 'medium' : 'high';
let lastQualityChange = 0;
let recording: FlightSnapshot[] = [];
let lastRecordTime = -1;
let replay = false;
let replayTime = 0;
let replayIndex = 0;
let toastTimer: ReturnType<typeof setTimeout>;
let resultShown = false;
let cleaned = false;

function toast(message: string) {
  text('toast', message); $('toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2600);
}
function updateStart() {
  $('start').innerHTML = replay ? '<span>■</span> 结束回放' : running ? '<span>Ⅱ</span> 暂停模拟' : flight && flight.snapshot().status !== 'flying' ? '<span>↻</span> 重新开始' : flight?.snapshot().time ? '<span>▶</span> 继续飞行' : '<span>▶</span> 开始模拟';
  text('state-text', replay ? '回放中' : flight?.snapshot().status === 'landed' ? '成功着陆' : flight?.snapshot().status === 'crashed' ? '回收失败' : running ? '下降中' : flight?.snapshot().time ? '已暂停' : '等待指令');
}
function setCamera(index: number) {
  camera = index; scene.setCamera(index); text('view-name', cameraNames[index]);
  document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(button => button.classList.toggle('active', Number(button.dataset.camera) === index));
  if (index === 0 || index === 4) toast('拖动旋转视角，滚轮缩放；触控双指缩放。');
}
function reset() {
  if (!ready) return;
  running = false; replay = false; resultShown = false;
  controls.suspend(); scene.setControlInput(0, 0);
  flight.reset({ mode: select('mode').value as FlightMode, unlimitedFuel: input('unlimited').checked && select('mode').value === 'arcade' });
  controls.throttle = 0; input('throttle').value = '0';
  recording = [flight.snapshot()]; lastRecordTime = 0;
  $('result').hidden = true;
  setCamera(camera === 5 ? 0 : camera); updateStart(); updateHUD(flight.snapshot());
}
function toggleFlight() {
  if (!ready) return;
  if (replay) { replay = false; setCamera(0); showResult(flight.snapshot()); updateStart(); return; }
  if (flight.snapshot().status !== 'flying') { reset(); }
  running = !running; updateStart();
}
function showResult(s: FlightSnapshot) {
  running = false; resultShown = true;
  const landed = s.status === 'landed';
  text('result-kicker', landed ? 'TOUCHDOWN CONFIRMED' : 'MISSION ENDED');
  text('result-title', landed ? '稳稳回到地面。' : '下次，再稳一点。');
  text('result-detail', `接地速度 ${(s.touchdownSpeed ?? Math.abs(s.velocity.y)).toFixed(1)} m/s · 倾角 ${(s.touchdownTilt ?? s.tilt).toFixed(1)}°\n${landed ? `保留 ${(s.fuel * 100).toFixed(0)}% 推进剂。回收任务完成。` : '调整推力节奏，在接地前完成减速；留意姿态与平台边界。'}`);
  $('result').hidden = false; $<HTMLButtonElement>('replay').disabled = recording.length < 3;
  updateStart();
}
function updateHUD(s: FlightSnapshot) {
  text('altitude', s.altitude.toFixed(1));
  text('vertical-speed', (s.velocity.y < 0 ? '−' : '+') + Math.abs(s.velocity.y).toFixed(1));
  text('horizontal-speed', Math.hypot(s.velocity.x, s.velocity.z).toFixed(1));
  text('offset', s.offset.toFixed(1)); text('tilt', s.tilt.toFixed(1));
  const radar = $('radar-marker');
  if (radar) {
    const yaw = scene.getControlYaw();
    const screenX = -Math.cos(yaw) * s.position.x + Math.sin(yaw) * s.position.z;
    const screenY = -(Math.sin(yaw) * s.position.x + Math.cos(yaw) * s.position.z);
    const scale = Math.min(1, 42 / Math.max(42, Math.hypot(screenX, screenY)));
    radar.style.left = `${50 + screenX * scale}%`;
    radar.style.top = `${50 + screenY * scale}%`;
    text('radar-distance', `${s.offset.toFixed(1)} m`);
  }
  const fuel = Math.max(0, s.fuel * 100);
  $('fuel').innerHTML = `${s.unlimitedFuel ? '∞' : fuel.toFixed(0)}<small>${s.unlimitedFuel ? '' : '%'}</small>`;
  $('fuel-bar').style.width = `${fuel}%`;
  $('fuel-bar').style.background = fuel < 20 ? '#f5a765' : '#8bb8ab';
  text('fuel-mass', s.unlimitedFuel ? 'UNLIMITED · 训练模式' : `PROP. RESERVE  ${(s.fuelMass / 1000).toFixed(2)} t`);
  text('throttle-value', (s.throttle * 100).toFixed(0));
  $('throttle-fill').style.height = `${s.throttle * 100}%`;
  $('thrust').innerHTML = `${(s.actualThrust / 1000).toFixed(0)} <small>kN</small>`;
  const hover = s.mass * FLIGHT_CONSTANTS.gravity / FLIGHT_CONSTANTS.maxThrust * 100;
  $('hover-marker').style.bottom = `${hover}%`; text('hover-value', hover.toFixed(0) + '%');
  text('engine-status', s.fuel <= 0 ? '耗尽' : s.throttle > 0.02 ? '点火' : '待机');
  $('engine-status').style.color = s.throttle > 0.02 ? '#ffb582' : '#859ca4';
  const seconds = s.time % 60;
  text('sim-time', `T+ ${Math.floor(s.time / 60).toString().padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`);
  $('phase-burn').classList.toggle('active', s.throttle > 0.4 || s.altitude < 45);
  $('phase-land').classList.toggle('active', s.altitude < 12 || s.status === 'landed');
  const risky = s.velocity.y < -10 && s.altitude < 35;
  $('vertical-speed').style.color = risky ? '#ffab79' : '#e9edef';
  const advice = $('flight-advice');
  let title = '01 / 准备进近', message = '调节油门，找准你的着陆节奏。';
  if (s.time > 0) {
    if (s.status === 'landed') { title = '03 / TOUCHDOWN'; message = '接地确认。欢迎回家。'; }
    else if (s.status === 'crashed') { title = '飞行结束'; message = '重置任务，再试一次。'; }
    else if (s.fuel < .1) { title = '注意 / 推进剂不足'; message = '留意剩余燃料，准备着陆。'; }
    else if (s.tilt > 15) { title = '注意 / 姿态偏离'; message = '减小姿态输入，恢复垂直。'; }
    else if (risky) { title = '02 / 下降过快'; message = '增加推力，尽快完成减速。'; }
    else if (s.altitude < 15) { title = '03 / 最终着陆'; message = '保持低速与竖直姿态。'; }
    else if (s.velocity.y > 3) { title = '02 / 正在爬升'; message = '适当减小油门，控制高度。'; }
    else { title = '02 / 动力下降'; message = '关注垂直速度，柔和调节油门。'; }
  }
  advice.querySelector('span')!.textContent = title; advice.querySelector('b')!.textContent = message;
  if (!$('performance').hidden) {
    const stats = scene.stats();
    const entries = [['帧率', `${fps.toFixed(0)} FPS`], ['帧时间', `${(1000 / fps).toFixed(1)} ms`], ['后端', stats.backend], ['Draw calls', String(stats.drawCalls)], ['三角形', stats.triangles.toLocaleString()], ['纹理', String(stats.textures)], ['分辨率', `${stats.width} × ${stats.height}`], ['物理更新', `${s.physicsMs.toFixed(2)} ms`], ['场景加载', `${stats.loadMs.toFixed(0)} ms`], ['固定步长', '120 Hz'], ['GPU 耗时', '不可用']];
    $('performance').replaceChildren(...entries.map(([key, value]) => { const row = document.createElement('div'); row.style.cssText = 'display:flex;justify-content:space-between;gap:14px'; const a = document.createElement('span'), b = document.createElement('span'); a.textContent = key; b.textContent = value; row.append(a,b); return row; }));
  }
}
function bindUI() {
  $('start').onclick = toggleFlight; $('reset').onclick = reset; $('result-reset').onclick = reset;
  $('engine-cut').onclick = () => { controls.throttle = 0; input('throttle').value = '0'; input('throttle').dispatchEvent(new Event('input')); toast('关断指令已发送 · 发动机将逐渐降推。'); };
  $('camera-next').onclick = () => setCamera((camera + 1) % 5);
  document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(button => button.onclick = () => setCamera(Number(button.dataset.camera)));
  $('audio').onclick = async () => { try { const enabled = await audio.toggle(); $('audio').setAttribute('aria-label', enabled ? '关闭声音' : '开启声音'); $('audio').title = enabled ? '关闭声音' : '开启声音'; $('audio').style.color = enabled ? '#ffab79' : ''; toast(enabled ? '发动机音效已开启' : '声音已关闭'); } catch { toast('当前设备无法开启音频。'); } };
  const openDialog = (id: string) => { pauseActivity(); $<HTMLDialogElement>(id).showModal(); };
  $('settings-open').onclick = () => openDialog('settings'); $('help').onclick = () => openDialog('guide');
  $('perf-toggle').onclick = () => { $('performance').hidden = !$('performance').hidden; };
  select('mode').onchange = () => { input('unlimited').disabled = select('mode').value === 'realistic'; if (input('unlimited').disabled) input('unlimited').checked = false; reset(); toast('物理模式已切换，任务已重置。'); };
  input('unlimited').onchange = reset;
  select('environment').onchange = () => scene.setEnvironment(select('environment').value as 'day' | 'dusk' | 'night');
  select('quality').onchange = () => { const value = select('quality').value; automaticQuality = value === 'auto'; quality = automaticQuality ? (innerWidth < 700 ? 'medium' : 'high') : value as typeof quality; scene.setQuality(quality); scene.setResolution(1); scene.setShadows(input('shadows').checked); text('resolution-value', '1.0×'); input('resolution').value = '1'; };
  input('resolution').oninput = () => { select('quality').value = 'custom'; scene.setResolution(Number(input('resolution').value)); text('resolution-value', Number(input('resolution').value).toFixed(1) + '×'); automaticQuality = false; };
  input('sensitivity').oninput = () => { controls.sensitivity = Number(input('sensitivity').value); text('sensitivity-value', controls.sensitivity.toFixed(1) + '×'); };
  input('shadows').onchange = () => scene.setShadows(input('shadows').checked);
  input('minimal').onchange = () => document.body.classList.toggle('minimal', input('minimal').checked);
  $('replay').onclick = () => { replay = true; running = false; replayTime = 0; replayIndex = 0; $('result').hidden = true; setCamera(5); updateStart(); };
  controls.onAction = action => {
    if (document.querySelector('dialog[open]')) return;
    if (action === 'reset') reset(); else if (action === 'pause') toggleFlight(); else if (action === 'camera') setCamera((camera + 1) % 5); else { document.body.classList.toggle('hud-hidden'); toast(document.body.classList.contains('hud-hidden') ? '按 H 恢复 HUD。' : 'HUD 已显示。'); }
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
}
function pauseActivity() {
  if (!ready) return;
  running = false; controls.suspend(); scene.setControlInput(0, 0);
  if (replay) { replay = false; setCamera(0); showResult(flight.snapshot()); }
  audio.update(0, 0, false); updateStart();
}
function onVisibility() { if (document.hidden) pauseActivity(); }
function onBlur() { pauseActivity(); }
function onPageHide(event: PageTransitionEvent) {
  if (event.persisted) { pauseActivity(); return; }
  cleanup();
}
function onPageShow(event: PageTransitionEvent) { if (event.persisted) { previousTime = performance.now(); fpsElapsed = 0; fpsFrames = 0; } }
function cleanup() {
  if (cleaned) return; cleaned = true;
  cancelAnimationFrame(frame); clearTimeout(toastTimer);
  controls?.dispose(); audio.dispose(); scene?.dispose(); flight?.dispose();
  document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('blur', onBlur); window.removeEventListener('pagehide', onPageHide); window.removeEventListener('pageshow', onPageShow);
}
function tick(now: number) {
  if (cleaned) return;
  const rawDt = Math.max(0, (now - previousTime) / 1000);
  const dt = Math.min(rawDt, .1); previousTime = now;
  visualTime += dt;
  controls.update(dt);
  let s = flight.snapshot();
  scene.setControlInput(0, 0);
  if (running && s.status === 'flying') {
    const attitude = mapCameraRelativeInput(controls.pitch, controls.roll, scene.getControlYaw());
    scene.setControlInput(attitude.pitch, attitude.roll);
    s = flight.advance(dt, { throttle: controls.throttle, pitch: attitude.pitch, roll: attitude.roll, stabilization: input('stabilize').checked });
    if (s.time - lastRecordTime > 1 / 30 || s.status !== 'flying') {
      recording.push(s); lastRecordTime = s.time;
      if (recording.length > 9000) recording.shift();
    }
    if (s.status !== 'flying' && !resultShown) showResult(s);
  }
  if (replay && recording.length) {
    replayTime += dt * .7;
    const time = recording[0].time + replayTime;
    while (replayIndex + 1 < recording.length && recording[replayIndex + 1].time < time) replayIndex++;
    const current = recording[replayIndex];
    const next = recording[Math.min(replayIndex + 1, recording.length - 1)];
    const blend = next.time > current.time ? (time - current.time) / (next.time - current.time) : 0;
    s = interpolateSnapshot(current, next, blend);
    if (replayIndex >= recording.length - 1) { replay = false; showResult(flight.snapshot()); updateStart(); }
  }
  scene.update(s, dt, visualTime);
  audio.update(running || replay ? s.throttle : 0, s.altitude, s.status === 'crashed');
  uiElapsed += dt; fpsElapsed += rawDt; fpsFrames++;
  if (uiElapsed > .06) { updateHUD(s); uiElapsed = 0; }
  if (fpsElapsed >= 1) {
    fps = fpsFrames / fpsElapsed; fpsFrames = 0; fpsElapsed = 0;
    text('fps', `${Math.round(fps)} FPS`); text('backend', scene.stats().backend);
    if (automaticQuality && fps < 36 && visualTime - lastQualityChange > 8) {
      const next = quality === 'ultra' ? 'high' : quality === 'high' ? 'medium' : 'low';
      if (next !== quality) { quality = next; scene.setQuality(quality); scene.setShadows(input('shadows').checked); toast('已根据帧率自动调整画质。'); }
      lastQualityChange = visualTime;
    }
  }
  frame = requestAnimationFrame(tick);
}
async function start() {
  try {
    const results = await Promise.allSettled([FlightPhysics.create(), FlightScene.create($('viewport'))]);
    if (results[0].status === 'fulfilled') flight = results[0].value;
    if (results[1].status === 'fulfilled') scene = results[1].value;
    for (const result of results) { if (result.status === 'rejected') throw result.reason; }
    controls = new FlightControls(input('throttle'), $('joystick'));
    scene.setQuality(quality);
    bindUI(); ready = true; $('loading').hidden = true; $<HTMLButtonElement>('start').disabled = false;
    recording = [flight.snapshot()]; updateStart(); updateHUD(flight.snapshot());
    previousTime = performance.now(); frame = requestAnimationFrame(tick);
  } catch (error) {
    console.error('Flight initialization failed:', error);
    $('loading').innerHTML = '<b>场景连接未完成</b><small>请使用支持 WebGL2 的现代浏览器，确认硬件加速已开启，然后刷新页面。</small>';
    flight?.dispose(); scene?.dispose();
  }
}
void start();



