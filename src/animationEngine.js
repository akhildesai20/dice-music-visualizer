/**
 * Per-die rotation queue.
 *
 * A wave never samples an in-between orientation as the start of a new turn.
 * Pending turns are applied, in order, from the snapped end of the previous one.
 * X/Y stay on the lattice. Only a temporary hop lifts the cube clear of the plane.
 */

import { easeOutCubic, qMul, qNormalize, qSlerp } from './math.js';
import { localAxisWorldZ, snapCubeQuaternion, turnAxis, turnSteps } from './orientation.js';
import { MAX_QUEUE, readQuat, writeQuat } from './diceGrid.js';

const _a = [0, 0, 0, 0];
const _b = [0, 0, 0, 0];
const _c = [0, 0, 0, 0];
const _d = [0, 0, 0, 0];

function deltaOffset(i, slot) {
  return (i * MAX_QUEUE + slot) * 4;
}

function readDelta(state, i, slot, out) {
  const o = deltaOffset(i, slot);
  out[0] = state.qDelta[o];
  out[1] = state.qDelta[o + 1];
  out[2] = state.qDelta[o + 2];
  out[3] = state.qDelta[o + 3];
  return out;
}

function writeDelta(state, i, slot, q) {
  const o = deltaOffset(i, slot);
  state.qDelta[o] = q[0];
  state.qDelta[o + 1] = q[1];
  state.qDelta[o + 2] = q[2];
  state.qDelta[o + 3] = q[3];
}

function startNext(state, i) {
  if (state.qLen[i] === 0) {
    state.animOn[i] = 0;
    state.hop[i] = 0;
    readQuat(state.logical, i, _a);
    writeQuat(state.quat, i, _a);
    return;
  }
  const slot = state.qHead[i];
  readDelta(state, i, slot, _d);
  state.qHead[i] = (slot + 1) % MAX_QUEUE;
  state.qLen[i]--;

  readQuat(state.quat, i, _a);
  writeQuat(state.animFrom, i, _a);
  qMul(_a, _d, _b);
  snapCubeQuaternion(_b, _c);
  writeQuat(state.animTo, i, _c);

  state.animT[i] = 0;
  state.animOn[i] = 1;
  state.animDur[i] = Math.max(0.05, state.qDur[i * MAX_QUEUE + slot]);
  state.animSteps[i] = turnSteps(_d);
  const axis = turnAxis(_d);
  state.animLift[i] = localAxisWorldZ(_a, axis) > 0.85 ? 0 : 1;
  state.hop[i] = 0;
}

function sample(state, i) {
  readQuat(state.animFrom, i, _a);
  readQuat(state.animTo, i, _b);
  const u = easeOutCubic(state.animT[i]);
  qSlerp(_a, _b, u, _c);
  writeQuat(state.quat, i, _c);

  if (!state.animLift[i]) {
    state.hop[i] = 0;
    return;
  }
  const theta = u * state.animSteps[i] * Math.PI * 0.5;
  const spread = Math.abs(Math.cos(theta)) + Math.abs(Math.sin(theta));
  state.hop[i] = state.half * Math.max(0, (spread - 1) * 1.08);
}

/**
 * Queue a local turn. `delta` is a wxyz quaternion (±90° or ±180°).
 * The logical orientation advances immediately; the mesh eases toward it.
 */
export function enqueueTurn(state, i, delta, duration) {
  readQuat(state.logical, i, _a);
  qMul(_a, delta, _b);
  snapCubeQuaternion(_b, _c);
  writeQuat(state.logical, i, _c);

  qNormalize(delta);
  if (state.qLen[i] >= MAX_QUEUE) {
    const last = (state.qHead[i] + state.qLen[i] - 1) % MAX_QUEUE;
    readDelta(state, i, last, _a);
    qMul(_a, delta, _b);
    qNormalize(_b);
    snapCubeQuaternion(_b, _c);
    writeDelta(state, i, last, _c);
    return;
  }

  const slot = (state.qHead[i] + state.qLen[i]) % MAX_QUEUE;
  writeDelta(state, i, slot, delta);
  state.qDur[i * MAX_QUEUE + slot] = duration;
  state.qLen[i]++;
  if (!state.animOn[i]) startNext(state, i);
}

export function updateAnimations(state, dt) {
  const n = state.count;
  const step = Math.min(dt, 0.05);
  for (let i = 0; i < n; i++) {
    if (!state.animOn[i]) {
      state.hop[i] = 0;
      continue;
    }
    let remaining = step;
    let guard = 0;
    while (state.animOn[i] && remaining > 0 && guard++ < 8) {
      const dur = state.animDur[i];
      const need = (1 - state.animT[i]) * dur;
      if (remaining + 1e-6 < need) {
        state.animT[i] += remaining / dur;
        remaining = 0;
        sample(state, i);
      } else {
        remaining -= need;
        state.animT[i] = 1;
        readQuat(state.animTo, i, _c);
        writeQuat(state.quat, i, _c);
        state.hop[i] = 0;
        startNext(state, i);
        if (state.animOn[i] && remaining > 0) {
          // Leftover time belongs to the turn that just started.
          state.animT[i] = 0;
        }
      }
    }
  }
}
