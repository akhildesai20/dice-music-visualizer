import test from 'node:test';
import assert from 'node:assert/strict';

import { makeViewProj, qMul, transformPoint } from '../src/math.js';
import {
  getCubeOrientations,
  isCubeOrientation,
  makeTurnQuat,
  randomCubeOrientation,
  randomTurnQuat,
  snapCubeQuaternion,
  topFace,
  turnAxis
} from '../src/orientation.js';
import { createRoundedBox, sdRoundBox, UNIT_HALF, ROUND_RATIO } from '../src/geometry.js';
import { bodyColor, themes } from '../src/themes.js';
import { createDiceGrid, fieldPitch, layoutGrid, recolorGrid, readQuat, resolveField, waveDistance } from '../src/diceGrid.js';
import { enqueueTurn, updateAnimations } from '../src/animationEngine.js';
import { createWaveEngine } from '../src/waveEngine.js';
import { createBassDetector, mapBassToWave } from '../src/bass.js';
import { createFeatureTracker, readBands } from '../src/audioAnalyzer.js';
import { createMusicMapper } from '../src/audioMap.js';
import { config, DEFAULT_CONFIG } from '../src/config.js';
import { isMidiFile, parseMidi } from '../src/midi.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sameRot(a, b) {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return d > 0.999;
}

test('cube rotation group has 24 axis-aligned orientations and every face', () => {
  const list = getCubeOrientations();
  assert.equal(list.length, 24);
  const faces = [0, 0, 0, 0, 0, 0, 0];
  const sigs = new Set();
  for (const q of list) {
    assert.equal(isCubeOrientation(q), true);
    faces[topFace(q)]++;
    const snapped = [0, 0, 0, 0];
    snapCubeQuaternion(q, snapped);
    assert.equal(sameRot(q, snapped), true);
    sigs.add(topFace(q) + ':' + q.map((v) => Math.round(v * 4)).join(','));
  }
  for (let f = 1; f <= 6; f++) assert.equal(faces[f], 4, `face ${f}`);
  assert.equal(sigs.size, 24);
});

test('principal turns land on the standard opposite faces', () => {
  const id = [1, 0, 0, 0];
  const turn = [0, 0, 0, 0];
  const out = [0, 0, 0, 0];
  assert.equal(topFace(id), 1);

  makeTurnQuat(0, 1, turn);
  qMul(id, turn, out);
  assert.equal(topFace(out), 2);

  makeTurnQuat(0, -1, turn);
  qMul(id, turn, out);
  assert.equal(topFace(out), 5);

  makeTurnQuat(0, 2, turn);
  qMul(id, turn, out);
  assert.equal(topFace(out), 6);

  makeTurnQuat(1, -1, turn);
  qMul(id, turn, out);
  assert.equal(topFace(out), 3);

  makeTurnQuat(1, 1, turn);
  qMul(id, turn, out);
  assert.equal(topFace(out), 4);

  let q = [1, 0, 0, 0];
  const next = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    makeTurnQuat(0, 1, turn);
    qMul(q, turn, next);
    snapCubeQuaternion(next, q);
  }
  assert.equal(topFace(q), 1);
  assert.equal(sameRot(q, id), true);
});

test('random turns stay inside the allowed increments and requested axis', () => {
  const rng = mulberry32(7);
  const q = [0, 0, 0, 0];
  for (let i = 0; i < 40; i++) {
    const steps = randomTurnQuat('random', rng(), rng, q);
    assert.ok(steps === 1 || steps === -1 || steps === 2 || steps === -2);
    assert.equal(isCubeOrientation(q), true);
  }
  randomTurnQuat('x', 1, () => 0.9, q);
  assert.equal(turnAxis(q), 0);
  randomTurnQuat('y', 1, () => 0.9, q);
  assert.equal(turnAxis(q), 1);
  randomTurnQuat('z', 1, () => 0.9, q);
  assert.equal(turnAxis(q), 2);
});

test('a full grid starts aligned, with mixed faces and stable colors', () => {
  const rng = mulberry32(3);
  const state = createDiceGrid(40, 40, rng);
  assert.equal(state.count, 1600);
  const faces = [0, 0, 0, 0, 0, 0, 0];
  const q = [0, 0, 0, 0];
  for (let i = 0; i < state.count; i++) {
    readQuat(state.quat, i, q);
    assert.equal(isCubeOrientation(q), true);
    assert.equal(state.animOn[i], 0);
    faces[topFace(q)]++;
  }
  for (let f = 1; f <= 6; f++) assert.ok(faces[f] > 50, `face ${f} count ${faces[f]}`);

  recolorGrid(state, 'monochrome', themes.monochrome.minLightness, themes.monochrome.maxLightness);
  const a = state.color.slice(0, 3);
  recolorGrid(state, 'monochrome', 8, 92);
  assert.deepEqual(Array.from(state.color.slice(0, 3)), Array.from(a));
  let min = 1;
  let max = 0;
  for (let i = 0; i < state.count; i++) {
    min = Math.min(min, state.color[i * 3]);
    max = Math.max(max, state.color[i * 3]);
  }
  assert.ok(max - min > 0.5);
  const gray = bodyColor(themes.monochrome, 0.5, 8, 92);
  assert.ok(Math.abs(gray[0] - gray[1]) < 1e-6 && Math.abs(gray[1] - gray[2]) < 1e-6);
});

test('the field crops every edge and keeps cube pitch across viewports', () => {
  const desk = resolveField(1440, 900, 40, 0.22);
  const phone = resolveField(390, 844, 40, 0.22);
  assert.equal(desk.pitch, fieldPitch(40));
  assert.equal(phone.pitch, desk.pitch);
  assert.ok(Math.abs(phone.cubeSize - desk.cubeSize) < 1e-6);
  assert.ok(phone.cols < desk.cols);
  assert.ok(phone.rows > phone.cols);

  function cover(viewW, viewH) {
    const field = resolveField(viewW, viewH, 40, 0.22);
    const state = createDiceGrid(field.cols, field.rows, mulberry32(11));
    layoutGrid(state, viewW, viewH, 0.22, field.pitch);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const seen = new Set();
    for (let i = 0; i < state.count; i++) {
      minX = Math.min(minX, state.x[i] - state.half);
      maxX = Math.max(maxX, state.x[i] + state.half);
      minY = Math.min(minY, state.y[i] - state.half);
      maxY = Math.max(maxY, state.y[i] + state.half);
      seen.add(`${state.x[i].toFixed(3)},${state.y[i].toFixed(3)}`);
    }
    assert.equal(seen.size, state.count);
    assert.ok(minX < -viewW / 2, `left ${minX}`);
    assert.ok(maxX > viewW / 2, `right ${maxX}`);
    assert.ok(minY < -viewH / 2, `bottom ${minY}`);
    assert.ok(maxY > viewH / 2, `top ${maxY}`);
    assert.ok(Math.abs(state.x[0] + state.x[state.cols - 1]) < 1e-4);
    assert.ok(Math.abs(state.y[0] + state.y[(state.rows - 1) * state.cols]) < 1e-4);
    return state;
  }

  const rng = mulberry32(11);
  const state = cover(1440, 900);
  cover(390, 844);
  cover(1024, 768);

  const x = state.x[10];
  const y = state.y[10];
  const turn = [0, 0, 0, 0];
  for (let k = 0; k < 15; k++) {
    randomTurnQuat('random', 0.9, rng, turn);
    enqueueTurn(state, 10, turn.slice(), 0.28);
  }
  for (let s = 0; s < 500; s++) updateAnimations(state, 1 / 60);
  assert.equal(state.x[10], x);
  assert.equal(state.y[10], y);
  assert.equal(state.animOn[10], 0);
  assert.equal(state.hop[10], 0);
  assert.equal(state.qLen[10], 0);
  const visual = [0, 0, 0, 0];
  const logical = [0, 0, 0, 0];
  readQuat(state.quat, 10, visual);
  readQuat(state.logical, 10, logical);
  assert.equal(isCubeOrientation(visual), true);
  assert.equal(sameRot(visual, logical), true);
});

test('a new turn waits until the current one has landed', () => {
  const state = createDiceGrid(2, 2, mulberry32(1));
  const turn = [0, 0, 0, 0];
  makeTurnQuat(0, 1, turn);
  enqueueTurn(state, 0, turn.slice(), 0.6);
  for (let i = 0; i < 6; i++) updateAnimations(state, 1 / 60);
  const mid = [0, 0, 0, 0];
  readQuat(state.quat, 0, mid);
  assert.equal(isCubeOrientation(mid), false);
  makeTurnQuat(1, 1, turn);
  enqueueTurn(state, 0, turn.slice(), 0.6);
  const after = [0, 0, 0, 0];
  readQuat(state.quat, 0, after);
  assert.equal(sameRot(mid, after), true);
  for (let i = 0; i < 200; i++) updateAnimations(state, 1 / 60);
  readQuat(state.quat, 0, after);
  assert.equal(isCubeOrientation(after), true);
  assert.equal(state.hop[0], 0);
});

test('wave distances and propagation order', () => {
  assert.ok(waveDistance('radial', 0, 0, 40, 40, 0) > waveDistance('radial', 19, 19, 40, 40, 0));
  assert.ok(waveDistance('ltr', 0, 4, 40, 40, 0) < waveDistance('ltr', 39, 4, 40, 40, 0));
  assert.ok(waveDistance('rtl', 39, 4, 40, 40, 0) < waveDistance('rtl', 0, 4, 40, 40, 0));

  const state = createDiceGrid(5, 5, mulberry32(2));
  state.jitter.fill(0);
  const engine = createWaveEngine();
  engine.trigger({
    type: 'radial', strength: 1, speed: 10, width: 1.5,
    rotationMode: 'x', maxDistance: Infinity, duration: 0.4, timestamp: 0
  });
  const hitAt = new Array(state.count).fill(-1);
  for (let t = 0; t <= 4000; t += 10) {
    engine.update(t, state, (i) => { if (hitAt[i] < 0) hitAt[i] = t; }, 0.01);
  }
  assert.equal(hitAt.filter((t) => t >= 0).length, 25);
  const center = 2 * 5 + 2;
  const corner = 0;
  assert.ok(hitAt[center] < hitAt[corner]);

  const ltr = createWaveEngine();
  const ltrAt = new Array(state.count).fill(-1);
  ltr.trigger({
    type: 'ltr', strength: 1, speed: 10, width: 1,
    rotationMode: 'y', maxDistance: Infinity, duration: 0.4, timestamp: 0
  });
  for (let t = 0; t <= 4000; t += 10) {
    ltr.update(t, state, (i) => { if (ltrAt[i] < 0) ltrAt[i] = t; }, 0.01);
  }
  assert.ok(ltrAt[0] < ltrAt[4]);

  const rtl = createWaveEngine();
  const rtlAt = new Array(state.count).fill(-1);
  rtl.trigger({
    type: 'rtl', strength: 1, speed: 10, width: 1,
    rotationMode: 'z', maxDistance: Infinity, duration: 0.4, timestamp: 0
  });
  for (let t = 0; t <= 4000; t += 10) {
    rtl.update(t, state, (i) => { if (rtlAt[i] < 0) rtlAt[i] = t; }, 0.01);
  }
  assert.ok(rtlAt[4] < rtlAt[0]);
});

test('bass mapping stays radial and grows with strength; onsets do not repeat while held', () => {
  const quiet = mapBassToWave(0.25, config, 40, 40, 10);
  const loud = mapBassToWave(1, config, 40, 40, 20);
  assert.equal(quiet.type, 'radial');
  assert.equal(loud.type, 'radial');
  assert.ok(loud.maxDistance > quiet.maxDistance);
  assert.ok(loud.speed > quiet.speed);
  assert.ok(loud.strength > quiet.strength);

  const detector = createBassDetector({ bassThreshold: 0.22, bassCooldown: 0.2 });
  for (let i = 0; i < 30; i++) {
    const sample = detector.push(0.04, i * 0.016);
    assert.equal(sample.onset, false);
  }
  assert.equal(detector.push(0.9, 0.6).onset, true);
  let extra = 0;
  for (let i = 0; i < 40; i++) {
    if (detector.push(0.82, 0.7 + i * 0.016).onset) extra++;
  }
  assert.equal(extra, 0);
  for (let i = 0; i < 50; i++) detector.push(0.02, 1.5 + i * 0.016);
  assert.equal(detector.push(0.95, 2.6).onset, true);
});

function silentMusic() {
  return {
    energy: 0.15,
    bass: 0,
    lowMids: 0,
    mids: 0,
    highs: 0,
    brightness: 0.4,
    transient: 0,
    bassHit: false,
    onset: false,
    hitStrength: 0
  };
}

test('bands separate bass from highs, and a constant mix does not sit at full scale', () => {
  const bins = new Uint8Array(1024);
  for (let i = 1; i <= 6; i++) bins[i] = 255;
  const heavy = readBands(bins, 48000, 2048);
  assert.ok(heavy.bass > 0.8);
  assert.ok(heavy.highs < 0.05);
  bins.fill(0);
  for (let i = 80; i <= 200; i++) bins[i] = 220;
  const airy = readBands(bins, 48000, 2048);
  assert.ok(airy.highs > airy.bass);

  const tracker = createFeatureTracker();
  const raw = { bass: 0.92, lowMids: 0.9, mids: 0.88, highs: 0.86, energy: 0.9, brightness: 0.7 };
  let level;
  for (let i = 0; i < 500; i++) level = tracker.push(raw, 0.016, 0.01);
  assert.ok(level.bass < 0.7, `bass pinned at ${level.bass}`);
  assert.ok(level.energy > 0.15 && level.energy < 0.7);

  tracker.reset();
  for (let i = 0; i < 40; i++) tracker.push({ ...raw, bass: 0.04, energy: 0.05 }, 0.016, 0);
  const jump = tracker.push({ ...raw, bass: 0.85, energy: 0.7 }, 0.016, 0.9);
  assert.ok(jump.bass > 0.45);
  assert.ok(jump.transient > 0.2);
});

test('music mapping keeps rotation, elevation, and pips on separate channels', () => {
  const grid = { cols: 60, rows: 40 };
  const mapper = createMusicMapper();
  const soft = mapper.update({ ...silentMusic(), bassHit: true, hitStrength: 0.28, bass: 0.35, energy: 0.25 }, config, grid, 1, 0.016);
  const hard = mapper.update({ ...silentMusic(), bassHit: true, hitStrength: 1, bass: 1, energy: 0.9 }, config, grid, 2, 0.016);
  assert.equal(soft.radial.type, 'radial');
  assert.equal(hard.radial.type, 'radial');
  assert.ok(hard.radial.maxDistance > soft.radial.maxDistance);
  assert.ok(hard.radial.strength > soft.radial.strength);

  const first = mapper.update({ ...silentMusic(), mids: 0.96, energy: 0.75 }, config, grid, 3, 0.016);
  assert.equal(first.horizontal.type, 'ltr');
  const held = mapper.update({ ...silentMusic(), mids: 0.96, energy: 0.75 }, config, grid, 3.2, 0.016);
  assert.equal(held.horizontal, null);
  mapper.update({ ...silentMusic(), mids: 0.05 }, config, grid, 3.4, 0.016);
  const second = mapper.update({ ...silentMusic(), mids: 0.96, energy: 0.8 }, config, grid, 4.4, 0.016);
  assert.equal(second.horizontal.type, 'rtl');
  assert.ok(second.horizontal.maxDistance <= grid.cols);

  function settle(mapper, music, seconds) {
    let out;
    const steps = Math.max(1, Math.round(seconds / 0.016));
    for (let i = 0; i < steps; i++) out = mapper.update(music, config, grid, i * 0.016, 0.016);
    return out;
  }

  const quietMap = createMusicMapper();
  const calm = settle(quietMap, silentMusic(), 0.4);
  assert.ok(calm.elevation < 0.02);
  const lifted = settle(quietMap, { ...silentMusic(), lowMids: 1, energy: 0.85 }, 0.7);
  assert.ok(lifted.elevation > 0.08 && lifted.elevation <= 1);
  const lively = settle(quietMap, { ...silentMusic(), highs: 1, energy: 0.8, transient: 0.9, lowMids: 1 }, 0.45);
  assert.ok(lively.pipActivity > calm.pipActivity);
  assert.ok(lively.pipTransient > 0.2);

  const dim = settle(createMusicMapper(), { ...silentMusic(), brightness: 0.05 }, 1);
  const lit = settle(createMusicMapper(), { ...silentMusic(), brightness: 0.95 }, 1);
  assert.ok(dim.illumination < 1);
  assert.ok(lit.illumination > 1);
  assert.ok(lit.illumination < 1.25);

  const muted = { ...config, audioMaster: 0 };
  const blocked = createMusicMapper().update({ ...silentMusic(), bassHit: true, hitStrength: 1, mids: 1 }, muted, grid, 1, 0.016);
  assert.equal(blocked.radial, null);
  assert.equal(blocked.horizontal, null);
});

test('orthographic camera is centered and fills the CSS viewport', () => {
  const m = new Float32Array(16);
  makeViewProj(1000, 800, m);
  const center = transformPoint(m, 0, 0, 12);
  const right = transformPoint(m, 500, 0, 12);
  const up = transformPoint(m, 0, 400, 12);
  assert.ok(Math.abs(center[0]) < 0.02 && Math.abs(center[1]) < 0.02);
  assert.ok(Math.abs(right[0] - 1) < 0.02);
  assert.ok(Math.abs(up[1] - 1) < 0.02);
  assert.ok(center[2] > -1 && center[2] < 1);
});

test('rounded box matches the reference SDF', () => {
  const mesh = createRoundedBox(6);
  const r = UNIT_HALF * ROUND_RATIO;
  assert.ok(mesh.indices.length > 100);
  let worst = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const y = mesh.positions[i + 1];
    const z = mesh.positions[i + 2];
    const d = sdRoundBox(x, y, z, UNIT_HALF, r);
    worst = Math.max(worst, Math.abs(d));
    const nx = mesh.normals[i];
    const ny = mesh.normals[i + 1];
    const nz = mesh.normals[i + 2];
    const ndot = nx * x + ny * y + nz * z;
    assert.ok(ndot > 0.05, `inward normal at ${i}`);
    assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-3);
  }
  assert.ok(worst < 2e-3, `sdf error ${worst}`);
});

test('initial orientations are drawn from the cube group', () => {
  const rng = mulberry32(99);
  const q = [0, 0, 0, 0];
  const faces = new Set();
  for (let i = 0; i < 48; i++) {
    randomCubeOrientation(rng, q);
    assert.equal(isCubeOrientation(q), true);
    faces.add(topFace(q));
  }
  assert.ok(faces.size >= 4);
});

function midiBytes(tracks, division = 480) {
  const chunks = tracks.map((events) => {
    const body = new Uint8Array(events);
    const chunk = new Uint8Array(8 + body.length);
    chunk.set([0x4d, 0x54, 0x72, 0x6b], 0);
    const view = new DataView(chunk.buffer);
    view.setUint32(4, body.length);
    chunk.set(body, 8);
    return chunk;
  });
  const header = new Uint8Array(14);
  header.set([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, tracks.length > 1 ? 1 : 0], 0);
  const view = new DataView(header.buffer);
  view.setUint16(10, tracks.length);
  view.setUint16(12, division);
  const length = header.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const file = new Uint8Array(length);
  file.set(header, 0);
  let offset = header.length;
  for (const chunk of chunks) {
    file.set(chunk, offset);
    offset += chunk.length;
  }
  return file.buffer;
}

test('a standard MIDI file becomes timed notes', () => {
  const song = parseMidi(midiBytes([[
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    0x00, 0x90, 0x3c, 0x64,
    0x83, 0x60, 0x80, 0x3c, 0x00,
    0x00, 0xff, 0x2f, 0x00
  ]]));
  assert.ok(Math.abs(song.duration - 0.5) < 1e-6);
  assert.equal(song.notes.length, 1);
  assert.equal(song.notes[0].note, 60);
  assert.equal(song.notes[0].vel, 100);
  assert.ok(Math.abs(song.notes[0].dur - 0.5) < 1e-6);

  const split = parseMidi(midiBytes([
    [0x00, 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40, 0x00, 0xff, 0x2f, 0x00],
    [0x00, 0x91, 0x24, 0x40, 0x81, 0x70, 0x81, 0x24, 0x00, 0x00, 0xff, 0x2f, 0x00]
  ]));
  assert.equal(split.notes.length, 1);
  assert.equal(split.notes[0].channel, 1);
  assert.ok(Math.abs(split.notes[0].time - 0) < 1e-9);
  assert.ok(Math.abs(split.duration - 0.5) < 1e-6);
  assert.equal(isMidiFile({ name: 'sketch.MID' }), true);
  assert.equal(DEFAULT_CONFIG.loudnessBrightness, false);
});
