// camera-check.mjs — 相机方向语义回归（纯 Node，不需要服务端）。
// 断言的对象就是浏览器在跑的那份 camera.js，避免"看着对"。
//
//   node tools/camera-check.mjs
import { readFileSync } from 'node:fs';
import {
  createCamera, applyLook, forwardOf, rightOf, moveCamera, projectPoint,
} from '../common/src/main/resources/assets/what_guys_doing/web/camera.js';

let failed = 0;
function expect(name, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
}
const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;
const cam = (over = {}) => Object.assign(createCamera({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }), over);
/** 相机前方 d 单位处的一点 */
const ahead = (c, d) => { const f = forwardOf(c); return [c.x + f[0] * d, c.y + f[1] * d, c.z + f[2] * d]; };
const offset = (p, dx, dy, dz) => [p[0] + dx, p[1] + dy, p[2] + dz];

console.log('=== 1. 正前方/右/上/后 的投影（用非平凡角度，转置矩阵会在此暴露）===');
for (const [yaw, pitch] of [[0, 0], [37, 22], [200, -35], [90, 0]]) {
  const c = cam({ yaw, pitch });
  const tag = `yaw=${yaw} pitch=${pitch}`;
  const front = projectPoint(c, 16 / 9, ahead(c, 10));
  expect(`${tag}: 正前方 10 格 → 屏幕中心`, near(front[0], 0) && near(front[1], 0), `ndc=(${front[0].toFixed(4)}, ${front[1].toFixed(4)})`);

  const r = rightOf(c);
  const right = projectPoint(c, 16 / 9, offset(ahead(c, 10), r[0] * 3, 0, r[2] * 3));
  expect(`${tag}: 观者右手边 3 格 → 屏幕右侧 (x>0)`, right[0] > 0.1, `x=${right[0].toFixed(4)}`);

  const up = projectPoint(c, 16 / 9, offset(ahead(c, 10), 0, 3, 0));
  expect(`${tag}: 正上方 3 格 → 屏幕上方 (y>0)`, up[1] > 0.1, `y=${up[1].toFixed(4)}`);

  const back = projectPoint(c, 16 / 9, ahead(c, -10));
  expect(`${tag}: 正后方 → w<0（在相机背后）`, back[2] < 0, `w=${back[2].toFixed(3)}`);
}

console.log('=== 2. 鼠标手势方向（接管后的语义）===');
{
  const c = cam({ yaw: 0, pitch: 0 });
  applyLook(c, 600, 0, 0.15);   // 向右拖 600px × 0.15 = 90°
  expect('鼠标右移 90° → 朝向变成原来的右手边 (−X)', near(c.yaw, 270), `yaw=${c.yaw}`);
  const f = forwardOf(c);
  expect('  此时 forward ≈ (−1, 0, 0)', near(f[0], -1) && near(f[2], 0), `f=(${f.map(v => v.toFixed(3)).join(', ')})`);

  const c2 = cam({ yaw: 0, pitch: 0 });
  applyLook(c2, -300, 0, 0.15); // 向左拖 45°
  expect('鼠标左移 → 向左转（yaw 增大）', near(c2.yaw, 45), `yaw=${c2.yaw}`);

  const c3 = cam({ yaw: 0, pitch: 0 });
  applyLook(c3, 0, -200, 0.15); // 向上拖
  expect('鼠标上移 → 抬头（pitch 增大）', near(c3.pitch, 30), `pitch=${c3.pitch}`);
  applyLook(c3, 0, 200, 0.15);
  expect('鼠标下移 → 低头（回到 0）', near(c3.pitch, 0), `pitch=${c3.pitch}`);

  applyLook(c3, 0, -100000, 0.15);
  expect('俯仰角上限锁定 89°', near(c3.pitch, 89), `pitch=${c3.pitch}`);
  applyLook(c3, 0, 200000, 0.15);
  expect('俯仰角下限锁定 −89°', near(c3.pitch, -89), `pitch=${c3.pitch}`);

  const c4 = cam({ yaw: 350, pitch: 0 });
  applyLook(c4, -400, 0, 0.15); // 继续向左 60° → 应回绕到 50
  expect('偏航角回绕到 [0,360)', near(c4.yaw, 50), `yaw=${c4.yaw}`);
}

console.log('=== 3. 键盘移动方向 ===');
{
  const c = cam({ yaw: 0, pitch: 0, speed: 10 });
  moveCamera(c, new Set(['w']), 1);
  expect('W 朝正前方 (+Z)', near(c.z, 10) && near(c.x, 0) && near(c.y, 0), `(${c.x},${c.y},${c.z})`);

  const c2 = cam({ yaw: 0, pitch: 0, speed: 10 });
  moveCamera(c2, new Set(['d']), 1);
  expect('D 朝观者右手边 (−X)', near(c2.x, -10) && near(c2.z, 0), `(${c2.x},${c2.y},${c2.z})`);

  const c3 = cam({ yaw: 0, pitch: 0, speed: 10 });
  moveCamera(c3, new Set(['a']), 1);
  expect('A 朝观者左手边 (+X)', near(c3.x, 10) && near(c3.z, 0), `(${c3.x},${c3.y},${c3.z})`);

  const c4 = cam({ yaw: 0, pitch: 0, speed: 10 });
  moveCamera(c4, new Set(['w']), 1);
  const c5 = cam({ yaw: 0, pitch: 0, speed: 10 });
  moveCamera(c5, new Set(['s']), 1);
  expect('S 与 W 方向相反', near(c5.z, -c4.z), `W.z=${c4.z} S.z=${c5.z}`);

  const c6 = cam({ yaw: 90, pitch: 45, speed: 10 });
  moveCamera(c6, new Set(['w']), 1);
  expect('W/S 保持水平（不随 pitch 抬头）', c6.y === 0, `y=${c6.y.toFixed(3)}`);

  const c7 = cam({ yaw: 30, pitch: 89, speed: 10 });
  moveCamera(c7, new Set(['d']), 1);
  expect('接近正上方时横移仍保持水平 (y 不变)', near(c7.y, 0), `y=${c7.y}`);

  const c8 = cam({ yaw: 0, pitch: 0, speed: 10 });
  moveCamera(c8, new Set(['control', 'w']), 1);
  expect('Control 加速 3×', near(c8.z, 30), `z=${c8.z}`);

  const c9 = cam({ yaw: 0, pitch: 0, speed: 10 });
  moveCamera(c9, new Set([' ']), 1);
  moveCamera(c9, new Set(['shift']), 0.5);
  expect('空格上升 / Shift 下降', near(c9.y, 5), `y=${c9.y}`);

  const c10 = cam({ yaw: 0, pitch: 0, speed: 10 });
  moveCamera(c10, new Set(['w', 'd']), 1);
  expect('斜向 W+D 先归一化，速度仍为 speed×dt', near(Math.hypot(c10.x, c10.y, c10.z), 10),
    `len=${Math.hypot(c10.x, c10.y, c10.z).toFixed(3)}`);
}

console.log('=== 4. 视角与投影自洽（转视角后正前方仍在屏幕中心）===');
{
  const c = cam({ yaw: 0, pitch: 0 });
  for (const [dx, dy] of [[123, -77], [-400, 250], [37, 400]]) {
    applyLook(c, dx, dy, 0.15);
    const p = projectPoint(c, 21 / 9, ahead(c, 25));
    expect(`手势(${dx},${dy}) 后正前方 25 格仍在中心`, near(p[0], 0, 1e-3) && near(p[1], 0, 1e-3), `ndc=(${p[0].toFixed(5)}, ${p[1].toFixed(5)})`);
  }
}

console.log('=== 5. 接线检查（app.js 调用相机函数时确实传了 camera）===');
{
  const src = readFileSync(new URL('../common/src/main/resources/assets/what_guys_doing/web/app.js', import.meta.url), 'utf8');
  const callLines = src.split('\n').filter(l => /(applyLook|moveCamera|buildViewProj)\s*\(/.test(l) && !l.trim().startsWith('//') && !l.trim().startsWith('import'));
  expect('app.js 里有相机调用', callLines.length > 0, `${callLines.length} 处`);
  for (const line of callLines) {
    expect(`  传了 camera：${line.trim().slice(0, 70)}`, /\(\s*camera\b/.test(line));
  }
}

console.log('');
if (failed) {
  console.log(`FAILED: ${failed} 项断言未通过`);
  process.exit(1);
}
console.log('ALL PASSED：相机方向语义与手柄方向一致');
