/**
 * Maps a normalized bass event onto a radial wave.
 * The analyzer never imports the wave engine — main.js connects them.
 */

import { clamp } from './math.js';
import { gridDiagonal } from './diceGrid.js';

export function mapBassToWave(strength, config, cols, rows, timestamp = 0) {
  const s = clamp(strength, 0, 1);
  const reach = s ** 0.85;
  const diagonal = gridDiagonal(cols, rows);
  return {
    type: 'radial',
    strength: 0.3 + s * 0.7,
    speed: config.speed * (0.65 + s * 0.7),
    width: config.width * (0.8 + s * 0.45),
    rotationMode: config.rotationAxis,
    maxDistance: diagonal * (0.22 + 0.85 * reach),
    duration: config.rotationDuration * (1.08 - s * 0.28),
    timestamp
  };
}

/**
 * Low-band onset detector.
 * Fires when smoothed energy crosses an adaptive threshold, then stays
 * disarmed until the band falls back — so a held bass note is one ripple.
 */
export function createBassDetector(cfg) {
  let envelope = 0;
  let prev = 0;
  let baseline = 0.08;
  let armed = true;
  let lastOnset = -Infinity;
  let suppressUntil = -Infinity;

  function push(energy, time) {
    const e = clamp(energy, 0, 1);
    const follow = e > envelope ? 0.42 : 0.14;
    envelope += (e - envelope) * follow;
    const flux = envelope - prev;
    prev = envelope;
    baseline += (envelope - baseline) * 0.02;

    const relative = Math.max(baseline * 1.5, baseline + 0.055);
    const thresh = Math.max(cfg.bassThreshold, relative);
    const rate = cfg.audioWave == null ? 1 : Math.max(0.35, cfg.audioWave);
    const cooldown = cfg.bassCooldown / rate;

    if (envelope < thresh * 0.68) armed = true;

    let onset = false;
    let strength = 0;
    if (
      time >= suppressUntil &&
      armed &&
      flux > 0.012 &&
      envelope > thresh &&
      time - lastOnset > cooldown
    ) {
      armed = false;
      lastOnset = time;
      onset = true;
      strength = clamp((envelope - baseline) / 0.42, 0.2, 1);
    }
    return { bass: envelope, flux, onset, strength, threshold: thresh };
  }

  function suppress(time, ms) {
    suppressUntil = time + ms / 1000;
    armed = false;
  }

  function reset() {
    envelope = 0;
    prev = 0;
    baseline = 0.08;
    armed = true;
    lastOnset = -Infinity;
    suppressUntil = -Infinity;
  }

  return { push, suppress, reset };
}
