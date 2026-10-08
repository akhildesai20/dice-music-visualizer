/**
 * Vector / quaternion / matrix helpers.
 * Quaternion layout on the CPU is [w, x, y, z], matching the reference dice sim.
 * Hot paths write into caller-provided arrays.
 */

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** out = a ⊗ b. Right-multiply applies b in the local frame. */
export function qMul(a, b, out) {
  const aw = a[0], ax = a[1], ay = a[2], az = a[3];
  const bw = b[0], bx = b[1], by = b[2], bz = b[3];
  out[0] = aw * bw - ax * bx - ay * by - az * bz;
  out[1] = aw * bx + ax * bw + ay * bz - az * by;
  out[2] = aw * by - ax * bz + ay * bw + az * bx;
  out[3] = aw * bz + ax * by - ay * bx + az * bw;
  return out;
}

export function qNormalize(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  if (l < 1e-12) {
    q[0] = 1; q[1] = 0; q[2] = 0; q[3] = 0;
    return q;
  }
  const inv = 1 / l;
  q[0] *= inv; q[1] *= inv; q[2] *= inv; q[3] *= inv;
  return q;
}

export function qDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

/** Short-arc slerp. out may alias neither input. */
export function qSlerp(a, b, t, out) {
  if (t <= 0) {
    out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; out[3] = a[3];
    return out;
  }
  if (t >= 1) {
    out[0] = b[0]; out[1] = b[1]; out[2] = b[2]; out[3] = b[3];
    return out;
  }
  let bw = b[0], bx = b[1], by = b[2], bz = b[3];
  let cos = a[0] * bw + a[1] * bx + a[2] * by + a[3] * bz;
  if (cos < 0) {
    cos = -cos;
    bw = -bw; bx = -bx; by = -by; bz = -bz;
  }
  if (cos > 0.9995) {
    out[0] = a[0] + (bw - a[0]) * t;
    out[1] = a[1] + (bx - a[1]) * t;
    out[2] = a[2] + (by - a[2]) * t;
    out[3] = a[3] + (bz - a[3]) * t;
    return qNormalize(out);
  }
  const theta = Math.acos(clamp(cos, -1, 1));
  const s = Math.sin(theta);
  const w1 = Math.sin((1 - t) * theta) / s;
  const w2 = Math.sin(t * theta) / s;
  out[0] = a[0] * w1 + bw * w2;
  out[1] = a[1] * w1 + bx * w2;
  out[2] = a[2] * w1 + by * w2;
  out[3] = a[3] * w1 + bz * w2;
  return qNormalize(out);
}

/** Column-major 3×3. Columns are local axes in world space. */
export function qToMat3(q, out) {
  const w = q[0], x = q[1], y = q[2], z = q[3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;

  out[0] = 1 - (yy + zz);
  out[1] = xy + wz;
  out[2] = xz - wy;

  out[3] = xy - wz;
  out[4] = 1 - (xx + zz);
  out[5] = yz + wx;

  out[6] = xz + wy;
  out[7] = yz - wx;
  out[8] = 1 - (xx + yy);
  return out;
}

export function mat3MulVec(m, x, y, z, out) {
  out[0] = m[0] * x + m[3] * y + m[6] * z;
  out[1] = m[1] * x + m[4] * y + m[7] * z;
  out[2] = m[2] * x + m[5] * y + m[8] * z;
  return out;
}

/** Rotate a vector by a wxyz quaternion. Matches the GPU xyzw formula. */
export function rotateVecQuat(q, vx, vy, vz, out) {
  const w = q[0], x = q[1], y = q[2], z = q[3];
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  out[0] = vx + w * tx + (y * tz - z * ty);
  out[1] = vy + w * ty + (z * tx - x * tz);
  out[2] = vz + w * tz + (x * ty - y * tx);
  return out;
}

export function det3(m) {
  const a = m[0], b = m[3], c = m[6];
  const d = m[1], e = m[4], f = m[7];
  const g = m[2], h = m[5], i = m[8];
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/** Shepperd's method. out is wxyz. */
export function mat3ToQuat(m, out) {
  const m00 = m[0], m10 = m[1], m20 = m[2];
  const m01 = m[3], m11 = m[4], m21 = m[5];
  const m02 = m[6], m12 = m[7], m22 = m[8];
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    out[0] = 0.25 * s;
    out[1] = (m21 - m12) / s;
    out[2] = (m02 - m20) / s;
    out[3] = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    out[0] = (m21 - m12) / s;
    out[1] = 0.25 * s;
    out[2] = (m01 + m10) / s;
    out[3] = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    out[0] = (m02 - m20) / s;
    out[1] = (m01 + m10) / s;
    out[2] = 0.25 * s;
    out[3] = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    out[0] = (m10 - m01) / s;
    out[1] = (m02 + m20) / s;
    out[2] = (m12 + m21) / s;
    out[3] = 0.25 * s;
  }
  return qNormalize(out);
}

/** Column-major view matrix. gl-matrix convention. */
export function mat4LookAt(eye, center, up, out) {
  let z0 = eye[0] - center[0];
  let z1 = eye[1] - center[1];
  let z2 = eye[2] - center[2];
  let len = Math.hypot(z0, z1, z2) || 1;
  z0 /= len; z1 /= len; z2 /= len;

  let x0 = up[1] * z2 - up[2] * z1;
  let x1 = up[2] * z0 - up[0] * z2;
  let x2 = up[0] * z1 - up[1] * z0;
  len = Math.hypot(x0, x1, x2);
  if (len < 1e-8) {
    x0 = 0; x1 = 0; x2 = 0;
  } else {
    x0 /= len; x1 /= len; x2 /= len;
  }
  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;

  out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
  out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
  out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
  out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  out[15] = 1;
  return out;
}

/** Column-major orthographic projection, OpenGL clip space. */
export function mat4Ortho(left, right, bottom, top, near, far, out) {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  out[0] = -2 * lr; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = -2 * bt; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = 2 * nf; out[11] = 0;
  out[12] = (left + right) * lr;
  out[13] = (top + bottom) * bt;
  out[14] = (far + near) * nf;
  out[15] = 1;
  return out;
}

/** out = a * b. out must not alias a or b. */
export function mat4Mul(a, b, out) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
    }
  }
  return out;
}

const _view = new Float32Array(16);
const _proj = new Float32Array(16);

/**
 * Top-down orthographic camera.
 * World X is screen-right, world Y is screen-up, world Z is up toward the camera.
 * Positions are in CSS pixels, with the grid centered at the origin.
 */
export function makeViewProj(viewW, viewH, out) {
  mat4LookAt([0, 0, 800], [0, 0, 0], [0, 1, 0], _view);
  mat4Ortho(-viewW / 2, viewW / 2, -viewH / 2, viewH / 2, 1, 4000, _proj);
  return mat4Mul(_proj, _view, out);
}

export function transformPoint(m, x, y, z) {
  const x2 = m[0] * x + m[4] * y + m[8] * z + m[12];
  const y2 = m[1] * x + m[5] * y + m[9] * z + m[13];
  const z2 = m[2] * x + m[6] * y + m[10] * z + m[14];
  const w2 = m[3] * x + m[7] * y + m[11] * z + m[15];
  const inv = w2 === 0 ? 1 : 1 / w2;
  return [x2 * inv, y2 * inv, z2 * inv];
}

export function easeOutCubic(t) {
  const u = clamp(t, 0, 1);
  return 1 - (1 - u) ** 3;
}
