/**
 * Compact control surface. No cards, no gradients.
 * Playback chrome is a second strip that only appears once the field is immersive.
 */

import { GRID_OPTIONS, WAVE_TYPES } from './config.js';
import { themeIds } from './themes.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fmtTime(t) {
  if (!Number.isFinite(t) || t < 0) return '0:00';
  const s = Math.floor(t);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function createUI(hooks) {
  const panel = document.getElementById('panel');
  const transport = document.getElementById('transport');
  const fps = document.getElementById('fps');

  const brand = el('div', 'brand');
  brand.append(el('strong', null, 'Dice'));
  const count = el('span', 'count', '1,600');
  brand.append(count);
  panel.append(brand);

  const seeking = { on: false };

  function section(title) {
    const wrap = el('section', 'section');
    wrap.append(el('h2', null, title));
    panel.append(wrap);
    return wrap;
  }

  const fields = {};

  function slider(parent, key, label, min, max, step, format, initial) {
    const row = el('label', 'slider');
    const name = el('span', 'name', label);
    const value = el('span', 'value', format(initial));
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(initial);
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      value.textContent = format(v);
      hooks.onSlider(key, v);
    });
    row.append(name, input, value);
    parent.append(row);
    fields[key] = { kind: 'slider', input, value, format };
    return { input, name };
  }

  const audioSec = section('Audio');
  const sourceRow = el('div', 'segment pair');
  const songBtn = el('button', null, 'Song');
  const micBtn = el('button', null, 'Mic');
  songBtn.type = 'button';
  micBtn.type = 'button';
  songBtn.setAttribute('aria-pressed', 'true');
  micBtn.setAttribute('aria-pressed', 'false');
  songBtn.addEventListener('click', () => hooks.onSource('song'));
  micBtn.addEventListener('click', () => hooks.onSource('mic'));
  sourceRow.append(songBtn, micBtn);
  audioSec.append(sourceRow);

  const fileRow = el('div', 'file-row');
  const fileBtn = el('button', null, 'Upload');
  const demoBtn = el('button', null, 'Demo');
  fileBtn.type = 'button';
  demoBtn.type = 'button';
  const fileName = el('span', 'file-name', 'No file');
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.className = 'file-input';
  fileInput.accept = '.mp3,.wav,.ogg,.m4a,.aac,.flac,.mid,.midi,audio/*';
  fileInput.setAttribute('aria-label', 'Upload song');
  fileBtn.addEventListener('click', () => fileInput.click());
  demoBtn.addEventListener('click', () => hooks.onDemo());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (file) hooks.onFile(file);
  });
  fileRow.append(fileBtn, demoBtn, fileName, fileInput);
  audioSec.append(fileRow);

  const playRow = el('div', 'actions');
  const playBtn = el('button', 'play', 'Play');
  const pauseBtn = el('button', null, 'Pause');
  const removeBtn = el('button', null, 'Remove');
  playBtn.type = 'button';
  pauseBtn.type = 'button';
  removeBtn.type = 'button';
  playBtn.disabled = true;
  pauseBtn.disabled = true;
  removeBtn.disabled = true;
  playBtn.addEventListener('click', () => hooks.onPlay());
  pauseBtn.addEventListener('click', () => hooks.onPause());
  removeBtn.addEventListener('click', () => hooks.onRemove());
  playRow.append(playBtn, pauseBtn, removeBtn);
  audioSec.append(playRow);

  const volume = slider(audioSec, 'volume', 'Volume', 0, 1, 0.01, (v) => v.toFixed(2), hooks.initial.volume);
  volume.input.closest('.slider').classList.add('level');
  const micNote = el('p', 'hint quiet', 'Level sets how strongly the mic drives the field. It is not played back.');
  micNote.hidden = true;
  audioSec.append(micNote);

  const seekRow = el('div', 'seek-row');
  const seek = document.createElement('input');
  seek.type = 'range';
  seek.min = '0';
  seek.max = '0';
  seek.step = '0.01';
  seek.value = '0';
  seek.disabled = true;
  seek.setAttribute('aria-label', 'Seek');
  const time = el('span', 'time', '0:00 / 0:00');
  seek.addEventListener('pointerdown', () => { seeking.on = true; });
  seek.addEventListener('pointerup', () => { seeking.on = false; });
  seek.addEventListener('pointercancel', () => { seeking.on = false; });
  seek.addEventListener('change', () => { seeking.on = false; });
  seek.addEventListener('input', () => hooks.onSeek(Number(seek.value)));
  seekRow.append(seek, time);
  audioSec.append(seekRow);
  const audioError = el('p', 'hint error');
  audioSec.append(audioError);

  const responseSec = section('Audio response');
  slider(responseSec, 'audioMaster', 'Master', 0, 1.5, 0.01, (v) => v.toFixed(2), hooks.initial.audioMaster);
  slider(responseSec, 'bassSensitivity', 'Bass', 0.1, 1.5, 0.01, (v) => v.toFixed(2), hooks.initial.bassSensitivity);
  slider(responseSec, 'midSensitivity', 'Mids', 0.1, 1.5, 0.01, (v) => v.toFixed(2), hooks.initial.midSensitivity);
  slider(responseSec, 'highSensitivity', 'Highs', 0.1, 1.5, 0.01, (v) => v.toFixed(2), hooks.initial.highSensitivity);
  slider(responseSec, 'audioWave', 'Waves', 0, 2, 0.01, (v) => v.toFixed(2), hooks.initial.audioWave);
  slider(responseSec, 'pipReactivity', 'Pips', 0, 1.5, 0.01, (v) => v.toFixed(2), hooks.initial.pipReactivity);
  slider(responseSec, 'elevation', 'Lift', 0, 1, 0.01, (v) => v.toFixed(2), hooks.initial.elevation);
  check(responseSec, 'Monitor', hooks.initial.showAudioMonitor, hooks.onMonitor, 'showAudioMonitor');

  const meterHost = el('div', 'meters');
  const meterBits = {};
  for (const name of ['Bass', 'Mids', 'Highs', 'Energy']) {
    const row = el('div', 'meter');
    const bar = el('span', 'bar');
    const fill = document.createElement('i');
    bar.append(fill);
    const num = el('span', 'value', '0.00');
    row.append(el('span', 'name', name), bar, num);
    meterHost.append(row);
    meterBits[name] = { fill, num };
  }
  responseSec.append(meterHost);

  const monitor = el('div', 'meters');
  monitor.id = 'monitor';
  const monitorBits = {};
  for (const name of ['Bass', 'Mids', 'Highs', 'Energy']) {
    const row = el('div', 'meter');
    const bar = el('span', 'bar');
    const fill = document.createElement('i');
    bar.append(fill);
    const num = el('span', 'value', '0.00');
    row.append(el('span', 'name', name), bar, num);
    monitor.append(row);
    monitorBits[name] = { fill, num };
  }
  document.getElementById('app').append(monitor);

  const waveSec = section('Wave');
  const typeRow = el('div', 'segment');
  const typeButtons = {};
  for (const type of WAVE_TYPES) {
    const btn = el('button', null, type.label);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', type.id === hooks.initial.waveType ? 'true' : 'false');
    btn.addEventListener('click', () => hooks.onWaveType(type.id));
    typeButtons[type.id] = btn;
    typeRow.append(btn);
  }
  waveSec.append(typeRow);

  function check(parent, label, initial, fn, key) {
    const row = el('label', 'check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = initial;
    input.addEventListener('change', () => fn(input.checked));
    row.append(input, el('span', null, label));
    parent.append(row);
    if (key) fields[key] = { kind: 'check', input };
    return input;
  }

  check(waveSec, 'Random wave mode', hooks.initial.randomWave, hooks.onRandomWave, 'randomWave');
  const triggerRow = el('div', 'row');
  const triggerBtn = el('button', null, 'Trigger');
  triggerBtn.type = 'button';
  triggerBtn.addEventListener('click', () => hooks.onTrigger());
  triggerRow.append(triggerBtn);
  waveSec.append(triggerRow);
  check(waveSec, 'Automatic test loop', hooks.initial.autoLoop, hooks.onAutoLoop, 'autoLoop');

  const propSec = section('Wave properties');
  slider(propSec, 'speed', 'Speed', 2, 40, 0.5, (v) => v.toFixed(1), hooks.initial.speed);
  slider(propSec, 'width', 'Width', 0.5, 10, 0.1, (v) => v.toFixed(1), hooks.initial.width);
  slider(propSec, 'strength', 'Strength', 0, 1, 0.01, (v) => v.toFixed(2), hooks.initial.strength);
  slider(propSec, 'rotationDuration', 'Rotation', 0.25, 1.4, 0.01, (v) => `${v.toFixed(2)}s`, hooks.initial.rotationDuration);

  const axisRow = el('label', 'row');
  axisRow.append(el('span', 'name', 'Axis'));
  const axis = document.createElement('select');
  axis.setAttribute('aria-label', 'Rotation axis');
  for (const [id, label] of [['random', 'Random'], ['x', 'X'], ['y', 'Y'], ['z', 'Z']]) {
    const opt = el('option', null, label);
    opt.value = id;
    axis.append(opt);
  }
  axis.value = hooks.initial.rotationAxis;
  axis.addEventListener('change', () => hooks.onSlider('rotationAxis', axis.value));
  axisRow.append(axis);
  propSec.append(axisRow);
  fields.rotationAxis = { kind: 'select', input: axis };

  const lookSec = section('Appearance');
  const themeRow = el('label', 'row');
  themeRow.append(el('span', 'name', 'Theme'));
  const theme = document.createElement('select');
  theme.setAttribute('aria-label', 'Theme');
  for (const id of themeIds()) {
    const opt = el('option', null, id.charAt(0).toUpperCase() + id.slice(1));
    opt.value = id;
    theme.append(opt);
  }
  theme.value = hooks.initial.theme;
  theme.addEventListener('change', () => hooks.onTheme(theme.value));
  themeRow.append(theme);
  lookSec.append(themeRow);
  fields.theme = { kind: 'select', input: theme };

  slider(lookSec, 'spacing', 'Spacing', 0.02, 0.6, 0.01, (v) => v.toFixed(2), hooks.initial.spacing);
  slider(lookSec, 'minLightness', 'Min gray', 0, 100, 1, (v) => String(Math.round(v)), hooks.initial.minLightness);
  slider(lookSec, 'maxLightness', 'Max gray', 0, 100, 1, (v) => String(Math.round(v)), hooks.initial.maxLightness);
  slider(lookSec, 'dotBrightness', 'Dot brightness', 0, 1.5, 0.01, (v) => v.toFixed(2), hooks.initial.dotBrightness);
  slider(lookSec, 'blinkFrequency', 'Blink', 0.05, 3, 0.01, (v) => `${v.toFixed(2)} Hz`, hooks.initial.blinkFrequency);
  slider(lookSec, 'glow', 'Glow', 0, 1.6, 0.01, (v) => v.toFixed(2), hooks.initial.glow);
  check(lookSec, 'Loudness brightness', hooks.initial.loudnessBrightness, hooks.onLoudness, 'loudnessBrightness');

  const perfSec = section('Performance');
  const gridRow = el('label', 'row');
  gridRow.append(el('span', 'name', 'Density'));
  const grid = document.createElement('select');
  grid.setAttribute('aria-label', 'Field density');
  for (const n of GRID_OPTIONS) {
    const opt = el('option', null, String(n));
    opt.value = String(n);
    grid.append(opt);
  }
  grid.value = String(hooks.initial.grid);
  grid.addEventListener('change', () => hooks.onGrid(Number(grid.value)));
  gridRow.append(grid);
  perfSec.append(gridRow);
  fields.grid = { kind: 'select', input: grid };
  check(perfSec, 'Frame rate', hooks.initial.showFps, hooks.onFps, 'showFps');

  const presetRow = el('div', 'actions two');
  const saveBtn = el('button', null, 'Save preset');
  const resetBtn = el('button', null, 'Reset');
  saveBtn.type = 'button';
  resetBtn.type = 'button';
  saveBtn.addEventListener('click', () => hooks.onSave());
  resetBtn.addEventListener('click', () => hooks.onReset());
  presetRow.append(saveBtn, resetBtn);
  panel.append(presetRow);
  const status = el('p', 'hint status');
  panel.append(status);

  panel.append(el('p', 'hint', 'Play enters fullscreen. Pause or Esc leaves it. Move the pointer or press C to show playback.'));

  const credit = el('footer', 'credit');
  credit.append(el('span', null, 'Akhil Desai'));
  const instagram = document.createElement('a');
  instagram.href = 'https://www.instagram.com/akhilius_/';
  instagram.target = '_blank';
  instagram.rel = 'noopener noreferrer';
  instagram.textContent = 'akhilius_';
  credit.append(instagram);
  panel.append(credit);

  const tPlay = el('button', null, 'Play');
  const tPause = el('button', null, 'Pause');
  tPlay.type = 'button';
  tPause.type = 'button';
  tPlay.disabled = true;
  tPause.disabled = true;
  tPlay.addEventListener('click', () => hooks.onPlay());
  tPause.addEventListener('click', () => hooks.onPause());
  const tSeek = document.createElement('input');
  tSeek.type = 'range';
  tSeek.min = '0';
  tSeek.max = '0';
  tSeek.step = '0.01';
  tSeek.value = '0';
  tSeek.setAttribute('aria-label', 'Seek');
  tSeek.addEventListener('pointerdown', () => { seeking.on = true; });
  tSeek.addEventListener('pointerup', () => { seeking.on = false; });
  tSeek.addEventListener('input', () => hooks.onSeek(Number(tSeek.value)));
  const tTime = el('span', 'time', '0:00 / 0:00');
  const tVol = document.createElement('input');
  tVol.type = 'range';
  tVol.min = '0';
  tVol.max = '1';
  tVol.step = '0.01';
  tVol.value = String(hooks.initial.volume);
  tVol.setAttribute('aria-label', 'Volume');
  tVol.addEventListener('input', () => hooks.onSlider('volume', Number(tVol.value)));
  const tExit = el('button', null, 'Exit');
  tExit.type = 'button';
  tExit.addEventListener('click', () => hooks.onExit());
  transport.append(tPlay, tPause, tSeek, tTime, tVol, tExit);

  function setSeek(current, duration) {
    const dur = duration > 0 ? duration : 0;
    seek.disabled = dur <= 0;
    seek.max = String(dur);
    tSeek.max = String(dur);
    if (!seeking.on) {
      seek.value = String(current);
      tSeek.value = String(current);
    }
    const label = `${fmtTime(current)} / ${fmtTime(dur)}`;
    time.textContent = label;
    tTime.textContent = label;
  }

  let statusTimer = 0;

  function apply(cfg) {
    for (const key of Object.keys(fields)) {
      const field = fields[key];
      if (cfg[key] == null) continue;
      if (field.kind === 'slider') {
        field.input.value = String(cfg[key]);
        field.value.textContent = field.format(Number(cfg[key]));
      } else if (field.kind === 'check') {
        field.input.checked = !!cfg[key];
      } else if (field.kind === 'select') {
        field.input.value = String(cfg[key]);
      }
    }
    setWaveType(cfg.waveType);
    tVol.value = String(cfg.volume);
  }

  return {
    setFileName(name) { fileName.textContent = name || 'No file'; },
    setSource(mode) {
      const mic = mode === 'mic';
      songBtn.setAttribute('aria-pressed', mic ? 'false' : 'true');
      micBtn.setAttribute('aria-pressed', mic ? 'true' : 'false');
      fileRow.hidden = mic;
      seekRow.hidden = mic;
      tSeek.hidden = mic;
      tTime.hidden = mic;
      micNote.hidden = !mic;
      const levelName = mic ? 'Level' : 'Volume';
      volume.name.textContent = levelName;
      volume.input.setAttribute('aria-label', levelName);
      tVol.setAttribute('aria-label', levelName);
    },
    setTransport({ canPlay, canPause, canRemove }) {
      playBtn.disabled = !canPlay;
      pauseBtn.disabled = !canPause;
      removeBtn.disabled = !canRemove;
      tPlay.disabled = !canPlay;
      tPause.disabled = !canPause;
    },
    setTime: setSeek,
    setVolume(v) {
      volume.input.value = String(v);
      tVol.value = String(v);
      fields.volume.value.textContent = Number(v).toFixed(2);
    },
    apply,
    setStatus(message) {
      status.textContent = message || '';
      clearTimeout(statusTimer);
      if (message) statusTimer = setTimeout(() => { status.textContent = ''; }, 1600);
    },
    setCount(n) { count.textContent = n.toLocaleString('en-US'); },
    setWaveType(id) {
      for (const key of Object.keys(typeButtons)) {
        typeButtons[key].setAttribute('aria-pressed', key === id ? 'true' : 'false');
      }
    },
    setError(message) { audioError.textContent = message || ''; },
    setFps(text, visible) {
      fps.hidden = !visible;
      if (visible) fps.textContent = text;
    },
    setMonitor(m) {
      const values = { Bass: m.bass, Mids: m.mids, Highs: m.highs, Energy: m.energy };
      for (const name of Object.keys(values)) {
        const v = Math.max(0, Math.min(1, values[name] || 0));
        const label = v.toFixed(2);
        const width = `${Math.round(v * 100)}%`;
        meterBits[name].num.textContent = label;
        meterBits[name].fill.style.width = width;
        monitorBits[name].num.textContent = label;
        monitorBits[name].fill.style.width = width;
      }
    },
    isSeeking() { return seeking.on; }
  };
}
