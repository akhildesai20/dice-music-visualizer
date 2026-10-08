/**
 * Web Audio feature readout.
 * One AnalyserNode spectrum becomes normalized musical features.
 * Nothing here knows about dice, waves, or shaders.
 */

import { clamp } from './math.js';
import { createBassDetector } from './bass.js';

const music = {
  energy: 0,
  bass: 0,
  lowMids: 0,
  mids: 0,
  highs: 0,
  brightness: 0,
  transient: 0,
  bassHit: false,
  onset: false,
  hitStrength: 0
};

/** Byte frequency data is decibels. Map it so a full bin is 1 and the floor is ~0. */
export function byteToUnit(b) {
  const db = -100 + (b / 255) * 70;
  return 10 ** ((db + 30) / 20);
}

/** Float frequency data is already in dB. Same ceiling as the byte scale. */
export function dbToUnit(db) {
  if (!Number.isFinite(db)) return 0;
  return Math.min(1, 10 ** ((Math.max(db, -100) + 30) / 20));
}

function bandLevel(bins, i0, i1, ampOf) {
  const a = Math.max(0, i0);
  const b = Math.min(bins.length - 1, Math.max(a, i1));
  let sum = 0;
  let peak = 0;
  for (let i = a; i <= b; i++) {
    const v = ampOf(bins[i]);
    sum += v;
    if (v > peak) peak = v;
  }
  const mean = sum / (b - a + 1);
  return Math.min(1, mean * 0.65 + peak * 0.35);
}

/**
 * Band levels from one FFT frame.
 * `ampOf` turns each bin into a linear amplitude near 0–1.
 * Byte frames use `byteToUnit`. Decibel frames use `dbToUnit`.
 */
export function readBands(bins, sampleRate, fftSize, ampOf = byteToUnit) {
  const binHz = (sampleRate || 48000) / fftSize;
  const at = (hz) => Math.floor(hz / binHz);
  const bass = bandLevel(bins, Math.max(1, at(28)), at(140), ampOf);
  const lowMids = bandLevel(bins, at(140), at(400), ampOf);
  const mids = bandLevel(bins, at(400), at(1800), ampOf);
  const highs = bandLevel(bins, at(1800), at(8000), ampOf);
  const iLo = Math.max(1, at(28));
  const iHi = Math.min(bins.length - 1, at(12000));
  let mag = 0;
  let centroid = 0;
  for (let i = iLo; i <= iHi; i++) {
    const v = ampOf(bins[i]);
    mag += v;
    centroid += v * (i * binHz);
  }
  const spread = (bass + lowMids + mids + highs) / 4;
  const energy = clamp(Math.max(bass, lowMids, mids, highs) * 0.72 + spread * 0.28, 0, 1);
  const brightness = mag < 0.002 ? 0.35 : clamp(centroid / (mag * 4200), 0, 1);
  return { bass, lowMids, mids, highs, energy, brightness, iLo, iHi };
}

/**
 * Fast attack, slow release, then a resting level for sustained loudness.
 * A brickwalled track settles near the middle. A hit still reaches the top.
 */
export function createFeatureTracker() {
  const env = { bass: 0, lowMids: 0, mids: 0, highs: 0, energy: 0, brightness: 0.35, transient: 0 };
  const base = { bass: 0.04, lowMids: 0.04, mids: 0.04, highs: 0.03, energy: 0.04, transient: 0 };
  const peak = { bass: 0.18, lowMids: 0.16, mids: 0.16, highs: 0.12, energy: 0.16, transient: 0.08 };
  let prev = null;

  function follow(key, value, dt) {
    const attack = value > env[key] ? 14 : 2.4;
    const k = 1 - Math.exp(-attack * dt);
    env[key] += (value - env[key]) * k;
    const bk = 1 - Math.exp(-0.45 * dt);
    base[key] += (env[key] - base[key]) * bk;
    const decay = Math.exp(-0.35 * dt);
    peak[key] = Math.max(env[key], Math.max(0.08, peak[key] * decay));
    const span = Math.max(0.06, peak[key] - base[key]);
    const dyn = clamp((env[key] - base[key]) / span, 0, 1);
    const presence = clamp(env[key] / Math.max(0.18, peak[key]), 0, 1);
    return clamp(presence * 0.38 + dyn * 0.72, 0, 1);
  }

  function push(raw, dt, flux) {
    const step = Math.max(0.001, Math.min(dt, 0.05));
    const out = {
      bass: follow('bass', raw.bass, step),
      lowMids: follow('lowMids', raw.lowMids, step),
      mids: follow('mids', raw.mids, step),
      highs: follow('highs', raw.highs, step),
      energy: follow('energy', raw.energy, step),
      brightness: 0
    };
    const brightAttack = raw.brightness > env.brightness ? 6 : 1.6;
    env.brightness += (raw.brightness - env.brightness) * (1 - Math.exp(-brightAttack * step));
    out.brightness = clamp(env.brightness, 0, 1);

    const fluxEnvTarget = clamp(flux, 0, 1);
    out.transient = follow('transient', fluxEnvTarget, step);
    return out;
  }

  function fluxOf(bins, iLo, iHi, ampOf) {
    if (!prev || prev.length !== bins.length) prev = new Float32Array(bins.length);
    let sum = 0;
    let n = 0;
    for (let i = iLo; i <= iHi; i++) {
      const v = ampOf(bins[i]);
      sum += Math.max(0, v - prev[i]);
      prev[i] = v;
      n++;
    }
    return n ? sum / n : 0;
  }

  function reset() {
    env.bass = env.lowMids = env.mids = env.highs = env.energy = env.transient = 0;
    env.brightness = 0.35;
    base.bass = base.lowMids = base.mids = base.energy = 0.04;
    base.highs = 0.03;
    base.transient = 0;
    peak.bass = 0.18;
    peak.lowMids = peak.mids = peak.energy = 0.16;
    peak.highs = 0.12;
    peak.transient = 0.08;
    if (prev) prev.fill(0);
  }

  return { push, fluxOf, reset };
}

export function createAudioAnalyzer(analyserNode, cfg) {
  analyserNode.fftSize = 2048;
  analyserNode.smoothingTimeConstant = 0.25;
  analyserNode.minDecibels = -100;
  analyserNode.maxDecibels = -30;
  const bins = new Float32Array(analyserNode.frequencyBinCount);
  const detector = createBassDetector(cfg);
  const tracker = createFeatureTracker();
  let lastTime = -1;
  let fluxPeak = 0.02;

  function update(timeMs) {
    const time = timeMs / 1000;
    const dt = lastTime < 0 ? 0.016 : Math.min(0.05, time - lastTime);
    lastTime = time;

    analyserNode.getFloatFrequencyData(bins);
    const rate = analyserNode.context.sampleRate || 48000;
    const raw = readBands(bins, rate, analyserNode.fftSize, dbToUnit);
    const flux = tracker.fluxOf(bins, raw.iLo, raw.iHi, dbToUnit);
    fluxPeak = Math.max(flux, fluxPeak * Math.exp(-0.4 * Math.max(dt, 0.001)));
    const fluxN = clamp(flux / Math.max(0.012, fluxPeak), 0, 1);
    const levels = tracker.push(raw, dt, fluxN);

    const bassEvent = detector.push(raw.bass, time);
    const onset = fluxN > 0.62 && levels.transient > 0.45;

    music.energy = levels.energy;
    music.bass = levels.bass;
    music.lowMids = levels.lowMids;
    music.mids = levels.mids;
    music.highs = levels.highs;
    music.brightness = levels.brightness;
    music.transient = levels.transient;
    music.bassHit = bassEvent.onset;
    music.onset = onset;
    music.hitStrength = bassEvent.onset ? bassEvent.strength : 0;
    return music;
  }

  function getFrequencyData() {
    analyserNode.getFloatFrequencyData(bins);
    return bins;
  }

  return {
    update,
    getFrequencyData,
    suppress(timeMs, ms) { detector.suppress(timeMs / 1000, ms); },
    reset() {
      detector.reset();
      tracker.reset();
      lastTime = -1;
      fluxPeak = 0.02;
      music.energy = music.bass = music.lowMids = music.mids = music.highs = 0;
      music.brightness = 0.35;
      music.transient = 0;
      music.bassHit = false;
      music.onset = false;
      music.hitStrength = 0;
    }
  };
}
