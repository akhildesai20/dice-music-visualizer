/**
 * Dice field. Wires the grid, waves, animation, audio, and renderer.
 * Audio never calls the wave engine directly — bass events go through onBass.
 */

import { clearPreset, config, configDefaults, loadPreset, savePreset } from './config.js';
import { createDiceGrid, layoutGrid, recolorGrid, readQuat, resolveField } from './diceGrid.js';
import { createWaveEngine } from './waveEngine.js';
import { enqueueTurn, updateAnimations } from './animationEngine.js';
import { randomTurnQuat, isCubeOrientation, topFace } from './orientation.js';
import { mapBassToWave } from './bass.js';
import { createAudioAnalyzer } from './audioAnalyzer.js';
import { createMusicMapper } from './audioMap.js';
import { createAudioPlayer, isPlayableFile } from './audioPlayer.js';
import { createRenderer } from './renderer.js';
import { createUI } from './ui.js';
import { getTheme, hexToRgb } from './themes.js';

const canvas = document.getElementById('canvas');
const fatal = document.getElementById('fatal');

const _turn = [1, 0, 0, 0];
const _q = [1, 0, 0, 0];

const appearance = {
  blinkFrequency: config.blinkFrequency,
  dotBrightness: config.dotBrightness,
  glow: config.glow,
  pipOff: [0, 0, 0],
  pipOn: [1, 1, 1],
  elevAmp: 0,
  elevFreq: 0.04,
  pipActivity: 0,
  pipTransient: 0,
  illum: 1
};

const channels = {
  elevation: 0,
  pipActivity: 0,
  pipTransient: 0,
  globalIntensity: 0,
  illumination: 1
};

let grid;
let renderer;
let analyzer = null;
let immersive = false;
let lastAuto = 0;
let fpsEma = 60;
let fpsStamp = 0;
let running = true;

const waves = createWaveEngine();
const player = createAudioPlayer();
const mapper = createMusicMapper();

loadPreset(config);

function showFatal(err) {
  console.error(err);
  fatal.hidden = false;
  fatal.textContent = err && err.message ? err.message : 'The visualizer failed to start.';
}

function viewSize() {
  const rect = canvas.getBoundingClientRect();
  return {
    w: Math.max(1, rect.width || window.innerWidth),
    h: Math.max(1, rect.height || window.innerHeight)
  };
}

function dprCap() {
  const dpr = window.devicePixelRatio || 1;
  const n = grid ? grid.count : config.grid * config.grid;
  if (n >= 5000) return Math.min(dpr, 1.25);
  if (n >= 2500 || config.grid >= 40) return Math.min(dpr, 1.5);
  if (config.grid >= 30) return Math.min(dpr, 1.75);
  return Math.min(dpr, 2);
}

function ensureField() {
  if (!renderer) return;
  const { w, h } = viewSize();
  renderer.resize(w, h, dprCap());
  const need = resolveField(w, h, config.grid, config.spacing);
  const densityChanged = !grid || grid.density !== config.grid;
  const grow = !grid || need.cols > grid.cols || need.rows > grid.rows;
  const shrink = grid && (grid.cols > need.cols + 4 || grid.rows > need.rows + 4);
  if (densityChanged || grow || shrink) {
    const cols = grow && !shrink ? need.cols + 2 : need.cols;
    const rows = grow && !shrink ? need.rows + 2 : need.rows;
    grid = createDiceGrid(cols, rows);
    grid.density = config.grid;
    waves.clear();
    layoutGrid(grid, w, h, config.spacing, need.pitch);
    applyTheme();
    ui.setCount(grid.count);
    renderer.resize(w, h, dprCap());
  } else {
    layoutGrid(grid, w, h, config.spacing, need.pitch);
  }
}

function applyTheme() {
  const theme = getTheme(config.theme);
  appearance.pipOff = hexToRgb(theme.pipOff);
  appearance.pipOn = hexToRgb(theme.pipOn);
  renderer.setBackground(hexToRgb(theme.background));
  document.body.style.background = theme.background;
  recolorGrid(grid, config.theme, config.minLightness, config.maxLightness);
  renderer.syncStatic(grid);
}

function rebuild() {
  if (grid) grid.density = -1;
  ensureField();
}

function triggerWave(opts) {
  return waves.trigger({
    type: opts.type || 'radial',
    strength: opts.strength == null ? config.strength : opts.strength,
    speed: opts.speed == null ? config.speed : opts.speed,
    width: opts.width == null ? config.width : opts.width,
    rotationMode: opts.rotationMode || config.rotationAxis,
    maxDistance: opts.maxDistance == null ? Infinity : opts.maxDistance,
    duration: opts.duration == null ? config.rotationDuration : opts.duration,
    timestamp: opts.timestamp == null ? performance.now() : opts.timestamp
  });
}

function triggerFromUI() {
  const types = ['radial', 'ltr', 'rtl'];
  const type = config.randomWave ? types[(Math.random() * 3) | 0] : config.waveType;
  triggerWave({
    type,
    strength: config.strength,
    speed: config.speed,
    width: config.width,
    rotationMode: config.rotationAxis,
    maxDistance: Infinity,
    duration: config.rotationDuration
  });
}

function onBass({ strength, timestamp }) {
  const mapped = mapBassToWave(
    strength,
    config,
    grid.cols,
    grid.rows,
    timestamp == null ? performance.now() : timestamp
  );
  return waves.trigger(mapped);
}

function loopIntervalMs() {
  const span = grid ? Math.max(grid.cols, grid.rows) : config.grid;
  const travel = (span * 0.7) / Math.max(1, config.speed);
  return Math.max(1200, travel * 1000);
}

async function enterFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req || document.fullscreenElement || document.webkitFullscreenElement) return;
  try {
    await req.call(el);
  } catch {
    // Immersive layout still fills the viewport when fullscreen is denied.
  }
}

function fullscreenActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function setImmersive(on) {
  immersive = on;
  document.body.classList.toggle('immersive', on);
  if (!on) {
    document.body.classList.remove('show-transport');
    document.body.classList.remove('pin-transport');
  }
  syncTransport();
}

function syncTransport() {
  const mic = player.source === 'mic';
  ui.setTransport({
    canPlay: mic || player.hasFile,
    canPause: player.playing,
    canRemove: player.hasFile
  });
}

async function onPlay() {
  const mic = player.source === 'mic';
  if (!mic && !player.hasFile) return;
  if (!player.playing) {
    setImmersive(true);
    revealTransport();
    try {
      await player.play();
    } catch (err) {
      ui.setError(err && err.message ? err.message : 'Playback was blocked by the browser.');
      await onExit();
      syncTransport();
      return;
    }
    syncTransport();
    enterFullscreen();
  } else if (!immersive) {
    setImmersive(true);
    revealTransport();
    enterFullscreen();
  }
  ui.setError('');
  syncTransport();
}

async function onPause() {
  player.pause();
  if (analyzer) analyzer.suppress(performance.now(), 180);
  await onExit();
  syncTransport();
}

function onRemove() {
  player.remove();
  if (analyzer) analyzer.reset();
  mapper.reset();
  ui.setFileName('');
  ui.setTime(0, 0);
  ui.setError('');
  onExit();
  syncTransport();
}

function onSource(mode) {
  player.setSource(mode);
  ui.setSource(mode);
  if (analyzer) analyzer.suppress(performance.now(), 220);
  mapper.reset();
  ui.setError('');
  if (mode === 'mic') ui.setTime(0, 0);
  else if (player.hasFile) ui.setTime(player.currentTime, player.duration);
  syncTransport();
}

function applySettings() {
  player.setVolume(config.volume);
  ui.apply(config);
  document.body.classList.toggle('show-monitor', !!config.showAudioMonitor);
  ui.setFps(config.showFps ? `${Math.round(fpsEma)} fps` : '', !!config.showFps);
  if (renderer && grid) {
    applyTheme();
    rebuild();
  }
}

async function onExit() {
  setImmersive(false);
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (exit && fullscreenActive()) {
    try { await exit.call(document); } catch { /* already left */ }
  }
}

function revealTransport() {
  if (!immersive) return;
  document.body.classList.add('show-transport');
  clearTimeout(revealTransport._t);
  if (!document.body.classList.contains('pin-transport')) {
    revealTransport._t = setTimeout(() => {
      document.body.classList.remove('show-transport');
    }, 2200);
  }
}

const ui = createUI({
  initial: config,
  onFile: (file) => { loadAudioFile(file); },
  onDemo: () => { loadDemo(true).catch(() => {}); },
  onPlay: () => { onPlay().catch(() => {}); },
  onPause: () => { onPause().catch(() => {}); },
  onRemove: () => { onRemove(); },
  onSource: (mode) => { onSource(mode); },
  onSave: () => {
    try {
      savePreset(config);
      ui.setStatus('Saved');
    } catch {
      ui.setStatus('Could not save');
    }
  },
  onReset: () => {
    clearPreset();
    Object.assign(config, configDefaults());
    applySettings();
    ui.setStatus('Reset');
  },
  onLoudness: (on) => { config.loudnessBrightness = on; },
  onSeek: (t) => {
    player.seek(t);
    if (analyzer) analyzer.suppress(performance.now(), 280);
    mapper.reset();
  },
  onWaveType: (id) => {
    config.waveType = id;
    ui.setWaveType(id);
  },
  onRandomWave: (on) => { config.randomWave = on; },
  onAutoLoop: (on) => {
    config.autoLoop = on;
    lastAuto = performance.now();
    if (on) triggerFromUI();
  },
  onTrigger: () => triggerFromUI(),
  onTheme: (id) => {
    config.theme = id;
    applyTheme();
  },
  onGrid: (n) => {
    config.grid = n;
    rebuild();
  },
  onSlider: (key, value) => {
    config[key] = key === 'rotationAxis' ? value : Number(value);
    if (key === 'volume') {
      player.setVolume(config.volume);
      ui.setVolume(config.volume);
    } else if (key === 'spacing') {
      ensureField();
    } else if (key === 'minLightness' || key === 'maxLightness') {
      recolorGrid(grid, config.theme, config.minLightness, config.maxLightness);
      renderer.syncStatic(grid);
    }
  },
  onMonitor: (on) => {
    config.showAudioMonitor = on;
    document.body.classList.toggle('show-monitor', on);
  },
  onFps: (on) => {
    config.showFps = on;
    ui.setFps('', on);
  },
  onExit: () => { onExit(); }
});

player.onEnded(() => {
  if (analyzer) analyzer.reset();
  mapper.reset();
  setImmersive(false);
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (exit && fullscreenActive()) exit.call(document).catch(() => {});
  syncTransport();
});

player.setVolume(config.volume);
if (config.showAudioMonitor) document.body.classList.add('show-monitor');
if (config.showFps) ui.setFps(`${Math.round(fpsEma)} fps`, true);
syncTransport();

document.addEventListener('fullscreenchange', () => {
  if (!fullscreenActive()) setImmersive(false);
  ensureField();
});

window.addEventListener('resize', () => ensureField());

window.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (player.playing) onPause().catch(() => {});
    else onPlay().catch(() => {});
  } else if (e.key === 'c' || e.key === 'C') {
    revealTransport();
  }
});

window.addEventListener('mousemove', revealTransport);
window.addEventListener('touchstart', revealTransport, { passive: true });

const DEMO_URL = 'demo/emergency.mp3';

async function loadDemo(announce) {
  let res;
  try {
    res = await fetch(DEMO_URL);
  } catch {
    if (announce) ui.setError('Demo song is not available.');
    return;
  }
  if (!res.ok) {
    if (announce) ui.setError('Demo song is not available.');
    return;
  }
  const blob = await res.blob();
  const file = new File([blob], 'Emergency.mp3', { type: 'audio/mpeg' });
  await loadAudioFile(file);
}

async function loadAudioFile(file) {
  if (!isPlayableFile(file)) {
    ui.setError('Choose an MP3, WAV, or MIDI file.');
    return;
  }
  try {
    player.pause();
    await player.loadFile(file);
    if (!analyzer) analyzer = createAudioAnalyzer(player.analyser, config);
    else analyzer.reset();
    mapper.reset();
    ui.setSource('song');
    ui.setFileName(file.name);
    ui.setError('');
    ui.setTime(0, player.duration);
    syncTransport();
  } catch (err) {
    ui.setFileName('');
    ui.setError(err.message || 'Could not load that file.');
    syncTransport();
  }
}

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadAudioFile(file);
});

try {
  renderer = createRenderer(canvas);
  ensureField();
} catch (err) {
  showFatal(err);
  running = false;
}

let last = performance.now();
let monitorStamp = 0;
let lastMusic = null;
let lastMapped = null;
let loudLevel = 0;

function frame(now) {
  if (!running) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (player.playing && !analyzer && player.analyser) {
    analyzer = createAudioAnalyzer(player.analyser, config);
  }
  if (player.playing && analyzer) {
    const music = analyzer.update(now);
    const mapped = mapper.update(music, config, grid, now / 1000, dt);
    lastMusic = music;
    lastMapped = mapped;
    if (mapped.radial) waves.trigger(mapped.radial);
    if (mapped.horizontal) waves.trigger(mapped.horizontal);
    channels.elevation = mapped.elevation;
    channels.pipActivity = mapped.pipActivity;
    channels.pipTransient = mapped.pipTransient;
    channels.globalIntensity = mapped.globalIntensity;
    channels.illumination = mapped.illumination;
    if (config.showAudioMonitor && now - monitorStamp > 100) {
      monitorStamp = now;
      ui.setMonitor(music);
    }
  } else {
    const k = 1 - Math.exp(-2.4 * dt);
    channels.elevation += (0 - channels.elevation) * k;
    channels.pipActivity += (0 - channels.pipActivity) * k;
    channels.pipTransient += (0 - channels.pipTransient) * k;
    channels.globalIntensity += (0 - channels.globalIntensity) * k;
    channels.illumination += (1 - channels.illumination) * k;
  }

  if (config.autoLoop && now - lastAuto >= loopIntervalMs()) {
    lastAuto = now;
    triggerFromUI();
  }

  waves.update(now, grid, (i, wave) => {
    const steps = randomTurnQuat(wave.rotationMode, wave.strength, Math.random, _turn);
    const dur = wave.duration * (Math.abs(steps) === 2 ? 1.18 : 1);
    enqueueTurn(grid, i, _turn, dur);
  }, dt);

  updateAnimations(grid, dt);

  const g = channels.globalIntensity;
  appearance.blinkFrequency = config.blinkFrequency * (1 + channels.pipActivity * 1.35);
  appearance.dotBrightness = config.dotBrightness * (0.82 + g * 0.45);
  appearance.glow = config.glow * (0.9 + g * 0.28);
  appearance.elevAmp = channels.elevation * grid.cubeSize * 0.62;
  appearance.elevFreq = (Math.PI * 2) / Math.max(1, (grid.pitch || grid.cubeSize) * 7.5);
  appearance.pipActivity = channels.pipActivity;
  appearance.pipTransient = channels.pipTransient;
  appearance.illum = channels.illumination;
  const heard = player.playing && lastMusic ? lastMusic.energy : 0;
  const loudK = 1 - Math.exp(-(heard > loudLevel ? 5 : 1.7) * dt);
  loudLevel += (heard - loudLevel) * loudK;
  if (config.loudnessBrightness) {
    const scale = 0.4 + loudLevel;
    appearance.illum *= scale;
    appearance.dotBrightness *= 0.5 + loudLevel * 0.85;
    appearance.glow *= 0.55 + loudLevel * 0.7;
  }
  renderer.draw(grid, now / 1000, appearance);

  if (player.source !== 'mic' && player.hasFile && !ui.isSeeking()) {
    ui.setTime(player.currentTime, player.duration);
  }

  if (dt > 0) fpsEma = fpsEma * 0.9 + (1 / dt) * 0.1;
  if (config.showFps && now - fpsStamp > 200) {
    fpsStamp = now;
    ui.setFps(`${Math.round(fpsEma)} fps`, true);
  }

  requestAnimationFrame(frame);
}

if (running) requestAnimationFrame(frame);
loadDemo(false);

function faceHistogram() {
  const hist = [0, 0, 0, 0, 0, 0, 0];
  let aligned = 0;
  let animating = 0;
  for (let i = 0; i < grid.count; i++) {
    if (grid.animOn[i]) animating++;
    readQuat(grid.quat, i, _q);
    if (!grid.animOn[i] && isCubeOrientation(_q)) aligned++;
    const face = topFace(_q);
    hist[face] = (hist[face] || 0) + 1;
  }
  return { hist, aligned, animating, count: grid.count };
}

window.__viz = {
  get grid() { return grid; },
  get config() { return config; },
  triggerWave,
  onBass,
  loadFile: loadAudioFile,
  relayout: ensureField,
  player,
  stats: faceHistogram,
  get fps() { return fpsEma; },
  get music() { return lastMusic; },
  get mapped() { return lastMapped; }
};
