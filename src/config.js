/** Shared mutable settings. UI and engines read the same object. */

export const DEFAULT_CONFIG = {
  grid: 40,
  spacing: 0.22,

  theme: 'monochrome',
  minLightness: 8,
  maxLightness: 92,
  dotBrightness: 0.8,
  blinkFrequency: 0.55,
  glow: 0.72,
  loudnessBrightness: false,

  waveType: 'radial',
  randomWave: false,
  autoLoop: false,

  speed: 12,
  width: 3,
  strength: 0.8,
  rotationDuration: 0.62,
  rotationAxis: 'random',

  showFps: false,
  volume: 0.8,

  bassThreshold: 0.22,
  bassCooldown: 0.28,
  bassSmoothing: 0.62,

  audioMaster: 1,
  bassSensitivity: 0.75,
  midSensitivity: 0.7,
  highSensitivity: 0.6,
  audioWave: 1,
  pipReactivity: 0.8,
  elevation: 0.55,
  showAudioMonitor: false
};

export const config = { ...DEFAULT_CONFIG };

const PRESET_KEY = 'dice-visualizer-preset';

export function configDefaults() {
  return { ...DEFAULT_CONFIG };
}

export function loadPreset(target) {
  try {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(PRESET_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    let applied = false;
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (data[key] == null) continue;
      if (typeof data[key] !== typeof DEFAULT_CONFIG[key]) continue;
      target[key] = data[key];
      applied = true;
    }
    return applied;
  } catch {
    return false;
  }
}

export function savePreset(source) {
  const data = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) data[key] = source[key];
  localStorage.setItem(PRESET_KEY, JSON.stringify(data));
}

export function clearPreset() {
  try { localStorage.removeItem(PRESET_KEY); } catch { /* private mode */ }
}

export const GRID_OPTIONS = [10, 20, 30, 40];

export const WAVE_TYPES = [
  { id: 'radial', label: 'Radial' },
  { id: 'ltr', label: 'Left → Right' },
  { id: 'rtl', label: 'Right → Left' }
];
