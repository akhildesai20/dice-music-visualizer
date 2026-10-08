/**
 * Rounded-cube mesh.
 *
 * The reference die is a raymarched rounded box (Inigo Quilez) with
 * corner radius = 0.16 × half-extent. This mesh projects a tessellated
 * cube onto that same implicit surface so the silhouette and bevel match,
 * without a full-screen raymarch per die.
 */

/** Unit cube half-extent. The renderer scales this to the on-screen size. */
export const UNIT_HALF = 0.5;

/** Matches physics.js: `radius = half * 0.16`. */
export const ROUND_RATIO = 0.16;

export function sdRoundBox(px, py, pz, b, r) {
  const qx = Math.abs(px) - b + r;
  const qy = Math.abs(py) - b + r;
  const qz = Math.abs(pz) - b + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  const outside = Math.hypot(ox, oy, oz);
  const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  return outside + inside - r;
}

export function roundBoxNormal(px, py, pz, b, r) {
  const ax = Math.abs(px);
  const ay = Math.abs(py);
  const az = Math.abs(pz);
  const qx = ax - b + r;
  const qy = ay - b + r;
  const qz = az - b + r;
  let nx = 0, ny = 0, nz = 0;
  if (qx > 0 && qy > 0 && qz > 0) {
    const len = Math.hypot(qx, qy, qz) || 1;
    return [
      Math.sign(px) * qx / len,
      Math.sign(py) * qy / len,
      Math.sign(pz) * qz / len
    ];
  }
  if (qx >= qy && qx >= qz && qx > 0) nx = Math.sign(px) || 1;
  else if (qy >= qx && qy >= qz && qy > 0) ny = Math.sign(py) || 1;
  else if (qz > 0) nz = Math.sign(pz) || 1;
  else if (ax >= ay && ax >= az) nx = Math.sign(px) || 1;
  else if (ay >= az) ny = Math.sign(py) || 1;
  else nz = Math.sign(pz) || 1;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function projectVertex(x, y, z, b, r, dst, dstN, offset) {
  const len = Math.hypot(x, y, z) || 1;
  const dx = x / len;
  const dy = y / len;
  const dz = z / len;
  let lo = 0;
  let hi = b * 3;
  for (let k = 0; k < 22; k++) {
    const mid = (lo + hi) * 0.5;
    const d = sdRoundBox(dx * mid, dy * mid, dz * mid, b, r);
    if (d < 0) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) * 0.5;
  const px = dx * t;
  const py = dy * t;
  const pz = dz * t;
  const n = roundBoxNormal(px, py, pz, b, r);
  dst[offset] = px;
  dst[offset + 1] = py;
  dst[offset + 2] = pz;
  dstN[offset] = n[0];
  dstN[offset + 1] = n[1];
  dstN[offset + 2] = n[2];
}

function buildPlane(u, v, w, udir, vdir, width, height, depth, grid, positions) {
  const segW = width / grid;
  const segH = height / grid;
  const halfW = width / 2;
  const halfH = height / 2;
  const halfD = depth / 2;
  const axis = { x: 0, y: 1, z: 2 };
  const grid1 = grid + 1;
  const base = positions.length / 3;
  const vector = [0, 0, 0];
  for (let iy = 0; iy < grid1; iy++) {
    const y = iy * segH - halfH;
    for (let ix = 0; ix < grid1; ix++) {
      const x = ix * segW - halfW;
      vector[axis[u]] = x * udir;
      vector[axis[v]] = y * vdir;
      vector[axis[w]] = halfD;
      positions.push(vector[0], vector[1], vector[2]);
    }
  }
  const indices = [];
  for (let iy = 0; iy < grid; iy++) {
    for (let ix = 0; ix < grid; ix++) {
      const a = base + ix + grid1 * iy;
      const b = base + ix + grid1 * (iy + 1);
      const c = base + (ix + 1) + grid1 * (iy + 1);
      const d = base + (ix + 1) + grid1 * iy;
      indices.push(a, b, d, b, c, d);
    }
  }
  return indices;
}

/**
 * Indexed rounded box in unit space (half-extent 0.5).
 * Returns { positions, normals, indices } as typed arrays.
 * positions and normals are separate xyz streams (not interleaved).
 */
export function createRoundedBox(segments = 10) {
  const grid = segments;
  const raw = [];
  const indices = [];
  const planes = [
    ['z', 'y', 'x', -1, -1, 1, 1, 1],
    ['z', 'y', 'x', 1, -1, 1, 1, -1],
    ['x', 'z', 'y', 1, 1, 1, 1, 1],
    ['x', 'z', 'y', 1, -1, 1, 1, -1],
    ['x', 'y', 'z', 1, -1, 1, 1, 1],
    ['x', 'y', 'z', -1, -1, 1, 1, -1]
  ];
  for (const p of planes) {
    const idx = buildPlane(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], grid, raw);
    for (let i = 0; i < idx.length; i++) indices.push(idx[i]);
  }

  const count = raw.length / 3;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const b = UNIT_HALF;
  const r = UNIT_HALF * ROUND_RATIO;
  for (let i = 0; i < count; i++) {
    projectVertex(raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2], b, r, positions, normals, i * 3);
  }
  return {
    positions,
    normals,
    indices: new Uint16Array(indices),
    radius: r,
    half: b
  };
}
