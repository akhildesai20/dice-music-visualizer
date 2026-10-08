/**
 * Modular wave scheduler.
 * Knows grid coordinates and time. Does not know about WebGL or audio.
 * Each wave hits a die once, when the front reaches that die's distance.
 */

import { waveDistance } from './diceGrid.js';

let _nextId = 1;

export function createWaveEngine() {
  /** @type {Array<Wave>} */
  const waves = [];

  function trigger(opts) {
    const wave = {
      id: _nextId++,
      type: opts.type || 'radial',
      strength: opts.strength == null ? 0.8 : opts.strength,
      speed: Math.max(0.01, opts.speed == null ? 12 : opts.speed),
      width: Math.max(0.05, opts.width == null ? 3 : opts.width),
      rotationMode: opts.rotationMode || 'random',
      maxDistance: opts.maxDistance == null ? Infinity : opts.maxDistance,
      duration: opts.duration == null ? 0.62 : opts.duration,
      start: opts.timestamp == null ? 0 : opts.timestamp,
      hit: null,
      count: -1
    };
    waves.push(wave);
    return wave.id;
  }

  function ensureHit(wave, count) {
    if (wave.hit && wave.count === count) return;
    wave.hit = new Uint8Array(count);
    wave.count = count;
  }

  /**
   * @param {number} now  milliseconds, same clock as trigger timestamps
   * @param {object} grid dice state (cols, rows, col, row, jitter, flash)
   * @param {(index:number, wave:object)=>void} onArrive
   * @param {number} [dt] seconds since the previous update
   */
  function update(now, grid, onArrive, dt = 0.016) {
    const count = grid.count;
    const decay = Math.exp(-Math.min(dt, 0.05) * 2.4);
    for (let i = 0; i < count; i++) grid.flash[i] *= decay;

    for (let w = waves.length - 1; w >= 0; w--) {
      const wave = waves[w];
      ensureHit(wave, count);
      const elapsed = Math.max(0, (now - wave.start) / 1000);
      const front = elapsed * wave.speed;
      let pending = 0;

      for (let i = 0; i < count; i++) {
        const dist = waveDistance(wave.type, grid.col[i], grid.row[i], grid.cols, grid.rows, grid.jitter[i]);
        if (dist > wave.maxDistance) continue;
        pending++;
        const x = (front - dist) / wave.width;
        if (x >= 0 && x <= 1) {
          const pulse = Math.sin(x * Math.PI) * wave.strength;
          if (pulse > grid.flash[i]) grid.flash[i] = pulse;
        }
        if (!wave.hit[i] && front >= dist) {
          wave.hit[i] = 1;
          onArrive(i, wave);
        } else if (!wave.hit[i]) {
          // still waiting
        } else {
          pending--;
        }
      }

      const limit = Number.isFinite(wave.maxDistance)
        ? wave.maxDistance
        : waveDistance('radial', 0, 0, grid.cols, grid.rows, 0) + 1;
      if (pending === 0 && front > limit + wave.width + 1) {
        waves.splice(w, 1);
      }
    }
  }

  function clear() {
    waves.length = 0;
  }

  function activeCount() {
    return waves.length;
  }

  return { trigger, update, clear, activeCount };
}
