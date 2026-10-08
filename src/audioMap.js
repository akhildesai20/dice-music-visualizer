/**
 * Audio-to-visual mapping.
 * Reads normalized features and writes intents. Does not render or analyze FFT bins.
 */

import { clamp } from './math.js';
import { mapBassToWave } from './bass.js';

export const audioMappings = {
  master: 1,
  bass: { target: 'radialWave', sensitivity: 0.75, strength: 1 },
  lowMids: { target: 'cubeElevation', sensitivity: 0.5, strength: 0.55 },
  mids: { target: 'horizontalWaves', sensitivity: 0.7, strength: 0.6 },
  highs: { target: 'pipActivity', sensitivity: 0.6, strength: 0.8 },
  energy: { target: 'globalIntensity', strength: 0.5 },
  brightness: { target: 'illumination', strength: 0.35 }
};

function syncMappings(config) {
  audioMappings.master = config.audioMaster;
  audioMappings.bass.sensitivity = config.bassSensitivity;
  audioMappings.bass.strength = 1;
  audioMappings.lowMids.sensitivity = config.midSensitivity * 0.85;
  audioMappings.lowMids.strength = config.elevation;
  audioMappings.mids.sensitivity = config.midSensitivity;
  audioMappings.mids.strength = 0.6;
  audioMappings.highs.sensitivity = config.highSensitivity;
  audioMappings.highs.strength = config.pipReactivity;
  audioMappings.energy.strength = 0.5;
  audioMappings.brightness.strength = 0.35;
  return audioMappings;
}

/** Higher sensitivity lets quieter material through. */
export function shapeLevel(value, sensitivity) {
  const s = clamp(sensitivity == null ? 0.7 : sensitivity, 0.05, 1.5);
  const exp = clamp(1.35 - s * 0.7, 0.4, 1.7);
  return clamp(value, 0, 1) ** exp;
}

export function createMusicMapper() {
  let midEnv = 0;
  let midArmed = true;
  let lastMid = -Infinity;
  let dir = 1;
  let elev = 0;
  let pip = 0;
  let flash = 0;
  let global = 0;
  let illum = 1;

  function reset() {
    midEnv = 0;
    midArmed = true;
    lastMid = -Infinity;
    dir = 1;
    elev = 0;
    pip = 0;
    flash = 0;
    global = 0;
    illum = 1;
  }

  function update(music, config, grid, timeSec, dt = 0.016) {
    const map = syncMappings(config);
    const master = clamp(config.audioMaster == null ? 1 : config.audioMaster, 0, 1.5);
    const waveScale = clamp(config.audioWave == null ? 1 : config.audioWave, 0, 2);
    const step = Math.max(0.001, Math.min(dt, 0.05));

    const energy = clamp(music.energy, 0, 1);
    const globalTarget = clamp(energy * map.energy.strength * (0.65 + master * 0.7), 0, 1);
    global += (globalTarget - global) * (1 - Math.exp(-3.2 * step));

    let radial = null;
    if (music.bassHit && master > 0.01 && waveScale > 0.01) {
      const sens = 0.55 + map.bass.sensitivity * 0.6;
      const body = 0.72 + global * 0.4;
      const s = clamp(music.hitStrength * sens * map.bass.strength * master * waveScale * body, 0, 1);
      radial = mapBassToWave(s, config, grid.cols, grid.rows, timeSec * 1000);
    }

    const mid = shapeLevel(music.mids, map.mids.sensitivity);
    const midFlux = mid - midEnv;
    midEnv += (mid - midEnv) * (mid > midEnv ? 0.45 : 0.12);
    if (mid < 0.34) midArmed = true;

    let horizontal = null;
    const midCooldown = 0.8 / Math.max(0.4, waveScale);
    if (
      master > 0.01 &&
      waveScale > 0.01 &&
      midArmed &&
      midFlux > 0.045 &&
      mid > 0.48 &&
      timeSec - lastMid > midCooldown
    ) {
      midArmed = false;
      lastMid = timeSec;
      const type = dir > 0 ? 'ltr' : 'rtl';
      dir *= -1;
      const s = clamp(mid * map.mids.strength * master * waveScale * (0.6 + 0.55 * global), 0, 1);
      const reach = 0.28 + 0.72 * (s ** 0.9);
      horizontal = {
        type,
        strength: 0.22 + s * 0.7,
        speed: config.speed * (0.62 + s * 0.55),
        width: config.width * (0.8 + s * 0.35),
        rotationMode: config.rotationAxis,
        maxDistance: Math.max(1, (grid.cols - 1) * reach),
        duration: config.rotationDuration * (1.05 - s * 0.2),
        timestamp: timeSec * 1000
      };
    }

    const low = shapeLevel(music.lowMids, map.lowMids.sensitivity);
    const elevTarget = clamp(low * map.lowMids.strength * master * (0.55 + 0.7 * global), 0, 1);
    const elevK = elevTarget > elev ? 1.8 : 0.85;
    elev += (elevTarget - elev) * (1 - Math.exp(-elevK * step));

    const high = shapeLevel(music.highs, map.highs.sensitivity);
    const pipTarget = clamp(high * map.highs.strength * master * (0.45 + 0.75 * global), 0, 1);
    pip += (pipTarget - pip) * (1 - Math.exp((pipTarget > pip ? -8 : -2.2) * step));
    const flashTarget = clamp(music.transient * high * map.highs.strength * master, 0, 1);
    flash += (flashTarget - flash) * (1 - Math.exp((flashTarget > flash ? -18 : -6) * step));

    const bright = clamp(music.brightness, 0, 1);
    const illumTarget = clamp(
      1 + (bright - 0.42) * map.brightness.strength * master * 1.15,
      0.78,
      1.22
    );
    illum += (illumTarget - illum) * (1 - Math.exp(-2.4 * step));

    return {
      radial,
      horizontal,
      elevation: elev,
      pipActivity: pip,
      pipTransient: flash,
      globalIntensity: global,
      illumination: illum
    };
  }

  return { update, reset };
}
