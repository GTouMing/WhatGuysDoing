// camera.js — 旁观众相机：角度、移动与视图-投影矩阵。纯数学、不依赖 DOM，可在 Node 里回归。
//
// 约定（tools/camera-check.mjs 会逐条断言，别再"凭感觉"改）：
//   yaw   ：0 = 朝 +Z；增大 → 转向 +X（俯视时逆时针）
//   pitch ：+90 = 正上方，−90 = 正下方
//   前向  ：forward = (sin(yaw)cos(pitch), sin(pitch), cos(yaw)cos(pitch))
//   右向  ：right   = cross(forward, worldUp)（世界 up = (0,1,0)）
//   矩阵  ：**列主序**（WebGPU / WGSL mat4x4f 的约定），与 mat4Multiply 的索引方式一致

export function createCamera(initial = {}) {
  return { x: 8, y: 80, z: 8, yaw: 0, pitch: 0, speed: 24, ...initial };
}

/** 鼠标移动 → 视角。dx 向右为正、dy 向下为正（浏览器 event 约定）。 */
export function applyLook(cam, dx, dy, sensitivity = 0.15) {
  cam.yaw -= dx * sensitivity;            // 鼠标右移 → 向右转（yaw 减小）
  cam.pitch -= dy * sensitivity;          // 鼠标上移（dy<0）→ 抬头（pitch 增大）
  if (cam.pitch > 89) cam.pitch = 89;
  if (cam.pitch < -89) cam.pitch = -89;
  cam.yaw = ((cam.yaw % 360) + 360) % 360;
}

export function forwardOf(cam) {
  const rad = Math.PI / 180;
  const cp = Math.cos(cam.pitch * rad);
  return [Math.sin(cam.yaw * rad) * cp, Math.sin(cam.pitch * rad), Math.cos(cam.yaw * rad) * cp];
}

/** 世界水平面的右向单位向量 = cross(forward, up) 归一化。 */
export function rightOf(cam) {
  const rad = Math.PI / 180;
  return [-Math.cos(cam.yaw * rad), 0, Math.sin(cam.yaw * rad)];
}

/** WASD / 空格 / Shift 移动。keys 为按下的小写键名集合（空格用 ' '）。 */
export function moveCamera(cam, keys, dt) {
  const f = forwardOf(cam);
  const r = rightOf(cam);
  let v = cam.speed * dt;
  if (keys.has('control')) v *= 3;
  let dx = 0, dy = 0, dz = 0;
  if (keys.has('w')) { dx += f[0]; dz += f[2]; }
  if (keys.has('s')) { dx -= f[0]; dz -= f[2]; }
  if (keys.has('d')) { dx += r[0]; dz += r[2]; }
  if (keys.has('a')) { dx -= r[0]; dz -= r[2]; }
  if (keys.has(' ')) dy += 1;
  if (keys.has('shift')) dy -= 1;
  const len = Math.hypot(dx, dy, dz);
  if (len > 0) {
    cam.x += dx / len * v;
    cam.y += dy / len * v;
    cam.z += dz / len * v;
  }
}

/** 列主序透视矩阵。 */
export function mat4Perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out.set([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far / (near - far), -1,
    0, 0, (far * near) / (near - far), 0,
  ]);
}

/** 列主序 4×4 乘法（out = a × b）。 */
export function mat4Multiply(out, a, b) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
}

/**
 * 从列主序 viewProj 提取 6 个视锥平面（Gribb–Hartmann），法线朝内、未归一化。
 * 返回列主序的 [nx,ny,nz,d] × 6，顺序：左、右、下、上、近、远。
 *
 * 为什么服务端式的"整块上传"做不到而我们能做到：BlueMap 靠 three.js 的逐对象视锥剔除撑住
 * draw call；我们的每 section 网格同样可以用它剪掉大半（半径 8 时约七成不在视锥内）。
 */
export function frustumPlanes(out, viewProj) {
  const m = viewProj;   // 列主序：元素 (r,c) 在 m[c*4+r]
  const at = (r, c) => m[c * 4 + r];
  const rows = [
    // row3 + row0 → 左；row3 − row0 → 右；row3 + row1 → 下；row3 − row1 → 上
    [at(3, 0) + at(0, 0), at(3, 1) + at(0, 1), at(3, 2) + at(0, 2), at(3, 3) + at(0, 3)],
    [at(3, 0) - at(0, 0), at(3, 1) - at(0, 1), at(3, 2) - at(0, 2), at(3, 3) - at(0, 3)],
    [at(3, 0) + at(1, 0), at(3, 1) + at(1, 1), at(3, 2) + at(1, 2), at(3, 3) + at(1, 3)],
    [at(3, 0) - at(1, 0), at(3, 1) - at(1, 1), at(3, 2) - at(1, 2), at(3, 3) - at(1, 3)],
    [at(3, 0) + at(2, 0), at(3, 1) + at(2, 1), at(3, 2) + at(2, 2), at(3, 3) + at(2, 3)],
    [at(3, 0) - at(2, 0), at(3, 1) - at(2, 1), at(3, 2) - at(2, 2), at(3, 3) - at(2, 3)],
  ];
  let i = 0;
  for (const p of rows) {
    const len = Math.hypot(p[0], p[1], p[2]) || 1;
    out[i++] = p[0] / len; out[i++] = p[1] / len; out[i++] = p[2] / len; out[i++] = p[3] / len;
  }
  return out;
}

/** AABB 是否与视锥相交（保守：跨界算可见，宁可多画不可漏画）。planes 为 frustumPlanes 输出。 */
export function aabbInFrustum(planes, minX, minY, minZ, maxX, maxY, maxZ) {
  for (let p = 0; p < 6; p++) {
    const nx = planes[p * 4], ny = planes[p * 4 + 1], nz = planes[p * 4 + 2], d = planes[p * 4 + 3];
    // 取沿法线最远的那个角；若它仍在负侧，则整个 AABB 在平面外
    const px = nx >= 0 ? maxX : minX;
    const py = ny >= 0 ? maxY : minY;
    const pz = nz >= 0 ? maxZ : minZ;
    if (nx * px + ny * py + nz * pz + d < 0) return false;
  }
  return true;
}


/** 列主序视图矩阵：列为 x 轴 / y 轴 / z 轴 / 平移。 */
export function mat4View(out, cam) {
  const f = forwardOf(cam);
  // z 轴 = −forward
  const zx = -f[0], zy = -f[1], zz = -f[2];
  // x 轴 = cross(worldUp, z)，归一化；正上/正下方时退化，退回世界 X
  let xx = zz, xy = 0, xz = -zx;
  let xl = Math.hypot(xx, xy, xz);
  if (xl < 1e-6) { xx = 1; xy = 0; xz = 0; xl = 1; }
  xx /= xl; xy /= xl; xz /= xl;
  // y 轴 = cross(z, x)
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  // 列主序存储：元素 (行 r, 列 c) 在索引 c*4+r，因此「第 0 行」(x 基向量) 落在 0/4/8。
  // 数学形式是 [x y z t] 四列，写成数组时按行铺开；写成 [xx,xy,xz,0,...] 会把矩阵转置掉。
  out.set([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * cam.x + xy * cam.y + xz * cam.z),
    -(yx * cam.x + yy * cam.y + yz * cam.z),
    -(zx * cam.x + zy * cam.y + zz * cam.z),
    1,
  ]);
}

const viewMatrix = new Float32Array(16);
const projMatrix = new Float32Array(16);

/** 世界坐标点 → 裁剪空间（w 未除）。便于回归断言。 */
export function projectPoint(cam, aspect, point) {
  mat4View(viewMatrix, cam);
  mat4Perspective(projMatrix, (70 * Math.PI) / 180, aspect, 0.1, 2000);
  const viewProj = new Float32Array(16);
  mat4Multiply(viewProj, projMatrix, viewMatrix);
  const x = point[0], y = point[1], z = point[2];
  const cx = viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12];
  const cy = viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13];
  const cw = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
  return [cx / cw, cy / cw, cw];
}

export function buildViewProj(cam, aspect, far = 2000) {
  const view = new Float32Array(16);
  const proj = new Float32Array(16);
  mat4View(view, cam);
  mat4Perspective(proj, (70 * Math.PI) / 180, aspect, 0.1, far);
  const out = new Float32Array(16);
  mat4Multiply(out, proj, view);
  return out;
}
