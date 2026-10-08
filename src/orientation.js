/**
 * The 24-element rotation group of the cube.
 *
 * Face ids match the reference shader:
 *   +Z → 1,  -Z → 6
 *   +Y → 2,  -Y → 5
 *   +X → 3,  -X → 4
 * Opposites sum to 7. Every stored orientation keeps a full face toward +Z.
 */

import { det3, qMul, qNormalize, qToMat3, mat3ToQuat, rotateVecQuat } from './math.js';

const H = Math.SQRT1_2;

/** Exact principal turns. steps is ±1 (±90°) or ±2 (±180°). Axis 0/1/2 = X/Y/Z. */
export function makeTurnQuat(axis, steps, out) {
  let w = 1;
  let k = 0;
  const s = steps | 0;
  if (s === 1 || s === -3) { w = H; k = H; }
  else if (s === -1 || s === 3) { w = H; k = -H; }
  else if (s === 2 || s === -2) { w = 0; k = 1; }
  out[0] = w;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[1 + axis] = k;
  return out;
}

function canonKey(q) {
  let flip = 1;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(q[i]) > 1e-8) {
      flip = q[i] < 0 ? -1 : 1;
      break;
    }
  }
  const parts = [];
  for (let i = 0; i < 4; i++) parts.push(Math.round(q[i] * flip * 1e5));
  return parts.join(',');
}

let _orientations = null;

/** All 24 cube rotations, each a wxyz array. Built once by group closure. */
export function getCubeOrientations() {
  if (_orientations) return _orientations;
  const gens = [
    [H, H, 0, 0],
    [H, 0, H, 0],
    [H, 0, 0, H]
  ];
  const next = [0, 0, 0, 0];
  const queue = [[1, 0, 0, 0]];
  const map = new Map();
  map.set(canonKey(queue[0]), queue[0]);
  while (queue.length) {
    const cur = queue.pop();
    for (let g = 0; g < 3; g++) {
      qMul(cur, gens[g], next);
      qNormalize(next);
      const key = canonKey(next);
      if (!map.has(key)) {
        const copy = [next[0], next[1], next[2], next[3]];
        map.set(key, copy);
        queue.push(copy);
      }
    }
  }
  _orientations = Array.from(map.values());
  return _orientations;
}

export function randomCubeOrientation(rng, out) {
  const list = getCubeOrientations();
  const q = list[(rng() * list.length) | 0];
  out[0] = q[0];
  out[1] = q[1];
  out[2] = q[2];
  out[3] = q[3];
  return out;
}

const _m = new Float32Array(9);
const _snapCol = [0, 0, 0];
const _snapSign = [1, 1, 1];

/**
 * Project a near-aligned quaternion onto the cube rotation group so
 * repeated turns cannot accumulate tilt.
 */
export function snapCubeQuaternion(q, out) {
  qToMat3(q, _m);
  const pairs = [];
  for (let c = 0; c < 3; c++) {
    for (let a = 0; a < 3; a++) {
      const v = _m[c * 3 + a];
      pairs.push(c, a, v, Math.abs(v));
    }
  }
  // Insertion sort by absolute component, descending. Nine entries.
  for (let i = 1; i < 9; i++) {
    const c = pairs[i * 4], a = pairs[i * 4 + 1], v = pairs[i * 4 + 2], ab = pairs[i * 4 + 3];
    let j = i - 1;
    while (j >= 0 && pairs[j * 4 + 3] < ab) {
      pairs[(j + 1) * 4] = pairs[j * 4];
      pairs[(j + 1) * 4 + 1] = pairs[j * 4 + 1];
      pairs[(j + 1) * 4 + 2] = pairs[j * 4 + 2];
      pairs[(j + 1) * 4 + 3] = pairs[j * 4 + 3];
      j--;
    }
    pairs[(j + 1) * 4] = c;
    pairs[(j + 1) * 4 + 1] = a;
    pairs[(j + 1) * 4 + 2] = v;
    pairs[(j + 1) * 4 + 3] = ab;
  }

  const colUsed = [false, false, false];
  const axisUsed = [false, false, false];
  let assigned = 0;
  for (let i = 0; i < 9 && assigned < 3; i++) {
    const c = pairs[i * 4];
    const a = pairs[i * 4 + 1];
    if (colUsed[c] || axisUsed[a]) continue;
    colUsed[c] = true;
    axisUsed[a] = true;
    _snapCol[c] = a;
    _snapSign[c] = pairs[i * 4 + 2] >= 0 ? 1 : -1;
    assigned++;
  }

  const sm = _m;
  sm.fill(0);
  for (let c = 0; c < 3; c++) sm[c * 3 + _snapCol[c]] = _snapSign[c];

  if (det3(sm) < 0) {
    const c = 2;
    sm[c * 3 + _snapCol[c]] *= -1;
  }
  return mat3ToQuat(sm, out);
}

export function isCubeOrientation(q, eps = 1e-3) {
  qToMat3(q, _m);
  const used = [false, false, false];
  for (let c = 0; c < 3; c++) {
    let hit = -1;
    for (let r = 0; r < 3; r++) {
      const a = Math.abs(_m[c * 3 + r]);
      if (a <= eps) continue;
      if (Math.abs(a - 1) > eps) return false;
      if (hit !== -1) return false;
      hit = r;
    }
    if (hit < 0 || used[hit]) return false;
    used[hit] = true;
  }
  return det3(_m) > 0.5;
}

/** Which face normal points toward world +Z (the camera). */
export function topFace(q) {
  qToMat3(q, _m);
  const scores = [
    [1, _m[8]],
    [6, -_m[8]],
    [2, _m[5]],
    [5, -_m[5]],
    [3, _m[2]],
    [4, -_m[2]]
  ];
  let best = 1;
  let bestD = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i][1] > bestD) {
      bestD = scores[i][1];
      best = scores[i][0];
    }
  }
  return best;
}

const _axis = [0, 0, 0];

/** Absolute world-Z component of a local principal axis. Near 1 means a flat spin. */
export function localAxisWorldZ(q, axis) {
  _axis[0] = axis === 0 ? 1 : 0;
  _axis[1] = axis === 1 ? 1 : 0;
  _axis[2] = axis === 2 ? 1 : 0;
  rotateVecQuat(q, _axis[0], _axis[1], _axis[2], _axis);
  return Math.abs(_axis[2]);
}

/**
 * Pick an allowed turn. High strength biases toward a half-turn.
 * Returns the step count (±1 or ±2).
 */
export function randomTurnQuat(mode, strength, rng, out) {
  let axis = (rng() * 3) | 0;
  if (mode === 'x') axis = 0;
  else if (mode === 'y') axis = 1;
  else if (mode === 'z') axis = 2;
  const half = rng() < (0.18 + 0.5 * Math.max(0, Math.min(1, strength)));
  const sign = rng() < 0.5 ? -1 : 1;
  const steps = sign * (half ? 2 : 1);
  makeTurnQuat(axis, steps, out);
  return steps;
}

/** Principal axis (0/1/2) of a 90° or 180° turn quaternion. */
export function turnAxis(q) {
  const ax = Math.abs(q[1]);
  const ay = Math.abs(q[2]);
  const az = Math.abs(q[3]);
  if (ax >= ay && ax >= az) return 0;
  if (ay >= az) return 1;
  return 2;
}

/** 1 for a quarter-turn, 2 for a half-turn. */
export function turnSteps(q) {
  return Math.abs(q[0]) < 0.2 ? 2 : 1;
}
