/**
 * Grid layout and per-die persistent state.
 * Orientations, colors, and blink seeds live here.
 * The lattice is larger than the viewport so the field crops at every edge.
 * Positions stay on the lattice — hops and musical elevation are added later.
 */

import { randomCubeOrientation } from './orientation.js';
import { bodyColor, getTheme } from './themes.js';

/** Short-side reference, in CSS pixels, for the density setting. */
export const FIELD_REFERENCE = 960;

/** Extra cells past the viewport on every side, so a die is always cut off. */
export const FIELD_OVERSCAN = 1;

const FIELD_INSTANCE_CAP = 8192;

export const MAX_QUEUE = 8;

export function gridDiagonal(cols, rows) {
  return Math.hypot((cols - 1) / 2, (rows - 1) / 2);
}

export function createDiceGrid(cols, rows, rng = Math.random) {
  const count = cols * rows;
  const state = {
    cols,
    rows,
    count,
    cubeSize: 1,
    half: 0.5,
    quat: new Float32Array(count * 4),
    logical: new Float32Array(count * 4),
    animFrom: new Float32Array(count * 4),
    animTo: new Float32Array(count * 4),
    animT: new Float32Array(count),
    animDur: new Float32Array(count),
    animOn: new Uint8Array(count),
    animSteps: new Float32Array(count),
    animLift: new Uint8Array(count),
    hop: new Float32Array(count),
    qHead: new Uint8Array(count),
    qLen: new Uint8Array(count),
    qDelta: new Float32Array(count * MAX_QUEUE * 4),
    qDur: new Float32Array(count * MAX_QUEUE),
    col: new Uint16Array(count),
    row: new Uint16Array(count),
    x: new Float32Array(count),
    y: new Float32Array(count),
    jitter: new Float32Array(count),
    lightT: new Float32Array(count),
    color: new Float32Array(count * 3),
    blinkPhase: new Float32Array(count),
    blinkFreq: new Float32Array(count),
    blinkSharp: new Float32Array(count),
    flash: new Float32Array(count)
  };

  const q = [1, 0, 0, 0];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      state.col[i] = col;
      state.row[i] = row;
      state.jitter[i] = (rng() - 0.5) * 0.56;
      state.lightT[i] = rng();
      state.blinkPhase[i] = rng() * Math.PI * 2;
      state.blinkFreq[i] = 0.35 + rng() * 1.45;
      state.blinkSharp[i] = rng() < 0.32 ? 1 : 0;
      randomCubeOrientation(rng, q);
      writeQuat(state.quat, i, q);
      writeQuat(state.logical, i, q);
    }
  }
  return state;
}

export function writeQuat(arr, i, q) {
  const o = i * 4;
  arr[o] = q[0];
  arr[o + 1] = q[1];
  arr[o + 2] = q[2];
  arr[o + 3] = q[3];
}

export function readQuat(arr, i, out) {
  const o = i * 4;
  out[0] = arr[o];
  out[1] = arr[o + 1];
  out[2] = arr[o + 2];
  out[3] = arr[o + 3];
  return out;
}

/** Cube pitch for a density step. Independent of the current viewport. */
export function fieldPitch(density) {
  return FIELD_REFERENCE / Math.max(1, density);
}

/**
 * How many dice are required to cover `viewW` × `viewH` with cropped edges.
 * Pitch stays at the density reference unless the instance cap forces it up,
 * so a phone shows a window into the same-sized cubes rather than a shrunken grid.
 */
export function resolveField(viewW, viewH, density, spacing) {
  const w = Math.max(1, viewW);
  const h = Math.max(1, viewH);
  let pitch = fieldPitch(density);
  let cols = 1;
  let rows = 1;
  for (let i = 0; i < 32; i++) {
    cols = Math.ceil(w / pitch) + FIELD_OVERSCAN * 2;
    rows = Math.ceil(h / pitch) + FIELD_OVERSCAN * 2;
    if (cols * rows <= FIELD_INSTANCE_CAP) break;
    pitch *= 1.05;
  }
  const size = pitch / (1 + Math.max(0, spacing));
  return { cols, rows, pitch, cubeSize: size };
}

/** Place an existing lattice on the viewport center. Pitch is in CSS pixels. */
export function layoutGrid(state, viewW, viewH, spacing, pitch) {
  const size = pitch / (1 + Math.max(0, spacing));
  state.cubeSize = size;
  state.half = size * 0.5;
  state.pitch = pitch;
  state.viewW = viewW;
  state.viewH = viewH;
  const ox = -((state.cols - 1) * pitch) / 2;
  const oy = -((state.rows - 1) * pitch) / 2;
  for (let row = 0; row < state.rows; row++) {
    for (let col = 0; col < state.cols; col++) {
      const i = row * state.cols + col;
      state.x[i] = ox + col * pitch;
      state.y[i] = oy + row * pitch;
    }
  }
  return state;
}

export function recolorGrid(state, themeId, minLightness, maxLightness) {
  const theme = getTheme(themeId);
  for (let i = 0; i < state.count; i++) {
    const rgb = bodyColor(theme, state.lightT[i], minLightness, maxLightness);
    state.color[i * 3] = rgb[0];
    state.color[i * 3 + 1] = rgb[1];
    state.color[i * 3 + 2] = rgb[2];
  }
}

/** Distance in grid cells from the wave's origin. Radial ignores jitter. */
export function waveDistance(type, col, row, cols, rows, jitter) {
  if (type === 'ltr') return col + jitter;
  if (type === 'rtl') return (cols - 1 - col) + jitter;
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  return Math.hypot(col - cx, row - cy);
}
