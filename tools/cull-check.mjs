// cull-check.mjs — 视锥剔除回归（纯 Node，不需要服务端）。
//
// 被测：camera.js 的 frustumPlanes + aabbInFrustum（运行时与这里共用同一份）。
// 真值：**独立口径** —— 把 AABB 的 8 个角按定义投影到裁剪空间，逐平面判是否全部在负侧。
// 重点断言：
//   1) 绝不假阴性（平面测试说剔除 ⇒ 真值也必须说完全在视锥外）。漏画是致命错误，多画可接受。
//   2) 已知方位（正前方/背后/左右/上下/包住相机）行为符合直觉。
//   3) 随机对拍数千次无假阴性，并报告剔除率（估算收益）。
//
//   node tools/cull-check.mjs
import {
  createCamera, buildViewProj, frustumPlanes, aabbInFrustum,
} from '../common/src/main/resources/assets/what_guys_doing/web/camera.js';

let failed = 0;
function expect(name, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
}

const frustum = new Float32Array(24);
const boxOutsideByCorners = (vp, b) => {
  const [x0, y0, z0, x1, y1, z1] = b;
  const corners = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
    corners.push({
      x: vp[0] * x + vp[4] * y + vp[8] * z + vp[12],
      y: vp[1] * x + vp[5] * y + vp[9] * z + vp[13],
      z: vp[2] * x + vp[6] * y + vp[10] * z + vp[14],
      w: vp[3] * x + vp[7] * y + vp[11] * z + vp[15],
    });
  }
  // WebGPU 裁剪空间：−w ≤ x ≤ w，−w ≤ y ≤ w，0 ≤ z ≤ w
  const tests = [
    c => c.x + c.w, c => c.w - c.x,
    c => c.y + c.w, c => c.w - c.y,
    c => c.z, c => c.w - c.z,
  ];
  return tests.some(f => corners.every(c => f(c) < 0));
};

const box = (cx, cy, cz, r = 8) => [cx - r, cy - r, cz - r, cx + r, cy + r, cz + r];
const culled = (vp, b) => { frustumPlanes(frustum, vp); return !aabbInFrustum(frustum, b[0], b[1], b[2], b[3], b[4], b[5]); };

console.log('=== 1. 已知方位 ===');
{
  const cam = createCamera({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });   // 朝 +Z
  const vp = buildViewProj(cam, 16 / 9);
  expect('正前方 40 格：可见', !culled(vp, box(0, 0, 40)), '');
  expect('正前方 40 格但偏右 30 格：可见', !culled(vp, box(30, 0, 40)), '');
  expect('正后方 40 格：剔除', culled(vp, box(0, 0, -40)), '');
  expect('右侧 200 格（视野外）：剔除', culled(vp, box(200, 0, 40)), '');
  expect('正上方 400 格（视野外）：剔除', culled(vp, box(0, 400, 40)), '');
  expect('包住相机的巨块：可见', !culled(vp, box(0, 0, 0, 64)), '');
  expect('超出远平面（2000）的方块：剔除', culled(vp, box(0, 0, 4000)), '');
  const cam2 = createCamera({ x: 0, y: 0, z: 0, yaw: 90, pitch: 0 }); // 朝 +X
  expect('转 90° 后，+X 方向 40 格：可见', !culled(buildViewProj(cam2, 16 / 9), box(40, 0, 0)), '');
  expect('转 90° 后，+Z 方向 40 格：剔除', culled(buildViewProj(cam2, 16 / 9), box(0, 0, 40)), '');
}

console.log('=== 2. 随机对拍（真实 section 尺寸 16³，随机相机/位置）===');
{
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let trials = 0, culledCount = 0, falseNegatives = 0;
  let firstFalseNegative = '';
  for (let i = 0; i < 4000; i++) {
    const cam = createCamera({
      x: (rnd() - 0.5) * 400, y: (rnd() - 0.5) * 200 + 80, z: (rnd() - 0.5) * 400,
      yaw: rnd() * 360, pitch: (rnd() - 0.5) * 170,
    });
    const vp = buildViewProj(cam, 1 + rnd());
    // section 对齐的 16³ 盒（和运行时一致）
    const sx = Math.round((rnd() - 0.5) * 400 / 16) * 16;
    const sy = Math.round((rnd() - 0.5) * 200 / 16) * 16;
    const sz = Math.round((rnd() - 0.5) * 400 / 16) * 16;
    const b = [sx, sy, sz, sx + 16, sy + 16, sz + 16];
    trials++;
    const isCulled = culled(vp, b);
    const trulyOutside = boxOutsideByCorners(vp, b);
    if (isCulled) {
      culledCount++;
      if (!trulyOutside) {
        falseNegatives++;
        if (!firstFalseNegative) {
          firstFalseNegative = `相机(${cam.x.toFixed(0)},${cam.y.toFixed(0)},${cam.z.toFixed(0)} yaw${cam.yaw.toFixed(0)} pitch${cam.pitch.toFixed(0)}) 盒(${sx},${sy},${sz})`;
        }
      }
    }
  }
  expect('4000 次随机对拍：无假阴性（剔除的确实都在视锥外）', falseNegatives === 0,
    falseNegatives ? `${falseNegatives} 例，首例 ${firstFalseNegative}` : `${trials} 例`);
  console.log(`    剔除率 ${(culledCount / trials * 100).toFixed(1)}%（该组随机分布下的估算收益）`);
}

console.log('=== 3. 保守性：真值说"可能可见"时不得剔除 ===');
{
  // 反向断言：真值判定为"未被完全剔除"的盒子，平面测试必须判可见（宁可多画）
  let seed = 999;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let violations = 0;
  for (let i = 0; i < 2000; i++) {
    const cam = createCamera({ x: 0, y: 64, z: 0, yaw: rnd() * 360, pitch: (rnd() - 0.5) * 120 });
    const vp = buildViewProj(cam, 16 / 9);
    const sx = Math.round((rnd() - 0.5) * 300 / 16) * 16;
    const sy = Math.round((rnd() - 0.5) * 80 / 16) * 16;
    const sz = Math.round((rnd() - 0.5) * 300 / 16) * 16;
    const b = [sx, sy, sz, sx + 16, sy + 16, sz + 16];
    if (!boxOutsideByCorners(vp, b) && culled(vp, b)) violations++;
  }
  expect('2000 次：真值未判定完全外 ⇒ 平面测试不得剔除', violations === 0, `违例 ${violations}`);
}

console.log('');
if (failed) {
  console.log(`FAILED: ${failed} 项断言未通过`);
  process.exit(1);
}
console.log('ALL PASSED：视锥剔除无假阴性且保守');
