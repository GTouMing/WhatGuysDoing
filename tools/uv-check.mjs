// uv-check.mjs — UV 正确性回归（纯 Node，用真实资源包）。
//
// 盯住的是"贴图被拉伸/条纹化"这一类错误：面 UV 的范围必须与元素在该轴上的实际尺寸一致。
//   * 整方块的面：UV 必须铺满 0..16（任何 0..1 缩放、局部裁剪都会失败）
//   * 台阶/雪层等局部元素：侧面 UV 的范围必须正好等于元素高度（8 或 2 ...）
//   * 任何 UV 都不得跑到 [0,16] 之外（显式 uv 除外，vanilla 允许但会"inconsistent"）
//
//   node tools/uv-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createBaker } from '../common/src/main/resources/assets/what_guys_doing/web/baker.js';

const CONTENT = process.env.WGD_ASSET_DIR
  || path.join('neoforge', 'run', 'config', 'what_guys_doing', 'assets', 'content', 'minecraft');

let failed = 0;
const expect = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};

const readJson = rel => {
  const p = path.join(CONTENT, rel.replace(/^minecraft\//, ''));
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};
const baker = createBaker({ readJson });

const states = [
  ['minecraft:stone', ''],
  ['minecraft:grass_block', 'snowy=false'],
  ['minecraft:oak_log', 'axis=y'],
  ['minecraft:oak_log', 'axis=x'],
  ['minecraft:oak_slab', 'type=bottom'],
  ['minecraft:oak_stairs', 'facing=north,half=bottom,shape=straight'],
  ['minecraft:snow', 'layers=4'],
  ['minecraft:poppy', ''],
  ['minecraft:glass', ''],
  ['minecraft:crafting_table', ''],
];

/** 哪些面的 UV 必须是"铺满"的：整方块的全部 6 面 */
function fullCubeExtentCheck(block, props, quads, report) {
  for (const quad of quads) {
    const us = quad.verts.map(v => v[3]);
    const vs = quad.verts.map(v => v[4]);
    const uSpan = Math.max(...us) - Math.min(...us);
    const vSpan = Math.max(...vs) - Math.min(...vs);
    if (Math.abs(uSpan - 16) > 0.01 || Math.abs(vSpan - 16) > 0.01) {
      report(`UV 未铺满：u 跨度 ${uSpan.toFixed(2)}、v 跨度 ${vSpan.toFixed(2)}（应为 16），贴图 ${quad.texture}`);
      return false;
    }
  }
  return true;
}

/** 通用：UV 不得越界 */
function rangeCheck(quads, report) {
  let bad = 0;
  for (const quad of quads) {
    for (const v of quad.verts) {
      if (v[3] < -0.01 || v[3] > 16.01 || v[4] < -0.01 || v[4] > 16.01) {
        bad++;
        if (bad === 1) report(`UV 越界：(${v[3].toFixed(2)}, ${v[4].toFixed(2)}) 贴图 ${quad.texture}`);
      }
    }
  }
  return bad;
}

console.log('=== 1. 逐状态烘焙并检查 UV ===');
const baked = [];
for (const [block, props] of states) {
  const template = baker.bakeState(block, props);
  const label = `${block.replace('minecraft:', '')}[${props}]`;
  if (!template || !template.quads.length) {
    expect(label, false, '没有烘出任何四边形（模型/匹配失败）');
    continue;
  }
  baked.push([label, block, props, template]);
  const problems = [];
  const outOfRange = rangeCheck(template.quads, m => problems.push(m));
  expect(`${label}（${template.quads.length} 面）UV 不越界`, outOfRange === 0, problems.find(m => m.startsWith('UV 越界')) || '');
}

console.log('=== 2. 整方块的面必须铺满 0..16 ===');
for (const [label, block, props, template] of baked) {
  if (!template.fullCube) continue;
  const problems = [];
  const ok = fullCubeExtentCheck(block, props, template.quads, m => problems.push(m));
  expect(`${label} 每个面 UV 铺满 16×16`, ok, problems[0] || '');
}

console.log('=== 3. 局部元素：UV 范围应与元素尺寸一致 ===');
{
  // 台阶侧面：元素高度 8 → 侧面 UV 的 v 跨度必须是 8；顶面仍是 16
  const slab = baker.bakeState('minecraft:oak_slab', 'type=bottom');
  const sides = slab.quads.filter(q => q.dir === 2 || q.dir === 3 || q.dir === 4 || q.dir === 5);
  const tops = slab.quads.filter(q => q.dir === 1);
  const sideSpans = sides.map(q => Math.max(...q.verts.map(v => v[4])) - Math.min(...q.verts.map(v => v[4])));
  const topSpans = tops.map(q => Math.max(...q.verts.map(v => v[4])) - Math.min(...q.verts.map(v => v[4])));
  expect('台阶 4 个侧面 v 跨度为 8', sideSpans.length === 4 && sideSpans.every(s => Math.abs(s - 8) < 0.01), `跨度 ${sideSpans.map(n => n.toFixed(1)).join(',')}`);
  expect('台阶顶面 v 跨度为 16', topSpans.every(s => Math.abs(s - 16) < 0.01), `跨度 ${topSpans.map(n => n.toFixed(1)).join(',')}`);

  // 雪层：真值是资源文件里的显式 uv —— layers=4 → snow_height8，侧面 uv [0,8,16,16]
  // （断言"跨度 4"是我先入为主的错误；跨度应等于元素高度 8）
  const snow = baker.bakeState('minecraft:snow', 'layers=4');
  const snowSides = snow.quads.filter(q => q.dir >= 2 && q.dir <= 5);
  const expectUv = [0, 8, 16, 16];
  const matchesExplicit = snowSides.length === 4 && snowSides.every(q => {
    const us = q.verts.map(v => v[3]); const vs = q.verts.map(v => v[4]);
    return Math.abs(Math.min(...us) - expectUv[0]) < 0.01 && Math.abs(Math.min(...vs) - expectUv[1]) < 0.01
      && Math.abs(Math.max(...us) - expectUv[2]) < 0.01 && Math.abs(Math.max(...vs) - expectUv[3]) < 0.01;
  });
  expect('雪层(layers=4) 侧面使用资源文件里的显式 uv [0,8,16,16]', matchesExplicit,
    snowSides.length !== 4 ? `侧面数 ${snowSides.length}` : `实际 u∈[${Math.min(...snowSides[0].verts.map(v => v[3]))}, ${Math.max(...snowSides[0].verts.map(v => v[3]))}] v∈[${Math.min(...snowSides[0].verts.map(v => v[4]))}, ${Math.max(...snowSides[0].verts.map(v => v[4]))}]`);
  expect('雪层侧面 v 跨度等于元素高度 8', snowSides.every(q => Math.abs((Math.max(...q.verts.map(v => v[4])) - Math.min(...q.verts.map(v => v[4]))) - 8) < 0.01));
}

console.log('=== 4. 每个面用的是不是正确的贴图（真值来自资源文件）===');
{
  const faceTextures = (block, props) => {
    const t = baker.bakeState(block, props);
    const map = {};
    for (const q of t.quads) {
      const name = ['down', 'up', 'north', 'south', 'west', 'east'][q.dir];
      if (q.dir >= 0) {
        const key = q.texture.replace('minecraft:', '');
        if (!map[name]?.includes(key)) map[name] = map[name] ? `${map[name]},${key}` : key;
      }
    }
    return map;
  };

  const grass = faceTextures('minecraft:grass_block', 'snowy=false');
  expect('草方块 顶面 = grass_block_top', String(grass.up).includes('block/grass_block_top'), grass.up);
  expect('草方块 底面 = dirt', String(grass.down).includes('block/dirt'), grass.down);
  expect('草方块 侧面 = grass_block_side(+overlay)', String(grass.north).includes('block/grass_block_side') && !String(grass.north).includes('grass_block_top'), grass.north);

  const log = faceTextures('minecraft:oak_log', 'axis=y');
  expect('原木 顶/底面 = oak_log_top', String(log.up).includes('block/oak_log_top') && String(log.down).includes('block/oak_log_top'), `${log.up} / ${log.down}`);
  expect('原木 侧面 = oak_log', String(log.north).includes('block/oak_log') && !String(log.north).includes('oak_log_top'), log.north);

  const table = faceTextures('minecraft:crafting_table', '');
  expect('工作台 顶面 = crafting_table_top', String(table.up).includes('block/crafting_table_top'), table.up);
  expect('工作台 侧面 = crafting_table_front/side', String(table.north).includes('crafting_table_front'), table.north);

  // 侧面 v 方向：贴图上部对应 v=0（用整方块验证）
  const cube = baker.bakeState('minecraft:stone', '');
  const south = cube.quads.find(q => q.dir === 3);
  const highest = south.verts.reduce((a, b) => (b[1] > a[1] ? b : a));
  const lowest = south.verts.reduce((a, b) => (b[1] < a[1] ? b : a));
  expect('南面上顶点 v 应为 0（贴图上部）', Math.abs(highest[4] - 0) < 0.01, `v=${highest[4].toFixed(2)}`);
  expect('南面下顶点 v 应为 16', Math.abs(lowest[4] - 16) < 0.01, `v=${lowest[4].toFixed(2)}`);
}

console.log('=== 5. mesher 把 0..16 的面 UV 映射到图集瓦片（用真实形状的矩形）===');
{
  const { createMesher, stateIdAt } = await import('../common/src/main/resources/assets/what_guys_doing/web/mesher.js');
  // 256×256 图集里位于 (3,5) 的瓦片，**不内缩** —— 与 atlas.js 的 uvRect 同形
  const rect = [
    (3 * 16) / 256, (5 * 16) / 256,
    ((3 + 1) * 16) / 256, ((5 + 1) * 16) / 256,
  ];
  // 单一方块的 section（bits=0 → 全段同一状态）
  const section = {
    key: '0:0:0:0', dim: 0, cx: 0, cy: 0, cz: 0,
    palette: Int32Array.from([1]), bits: 0, indices: new Uint8Array(0),
    blockLight: new Uint8Array(2048), skyLight: new Uint8Array(2048),
    biomes: new Int32Array(256), ids: null, instances: null, count: 0,
  };
  const mesher = createMesher({
    bakeState: (block, props) => baker.bakeState(block, props),
    describe: () => ({ block: 'minecraft:stone', props: '' }),
    isOpaque: id => id === 1,
    blockAt: () => -1,          // 不剔除任何面 → 整方块 6 面都在
    uvRect: () => rect,
    materialOf: () => 0,
    tintFor: () => [1, 1, 1],
  });
  const mesh = mesher.meshSection(section);
  // bits=0 表示整段 4096 个方块都是同一状态 → 6×4096 面（这里不剔除任何面）
  expect('合成 section 网格化成功', mesh.quadCount === 6 * 4096, `${mesh.quadCount} 面（应为 ${6 * 4096}）`);

  // 每个四边形的 UV 必须精确覆盖 rect 的四个角（这正是"是否只采样了一个像素"的判别点）
  let bad = 0;
  let sample = '';
  for (let q = 0; q < mesh.quadCount; q++) {
    const us = [], vs = [];
    for (let i = 0; i < 4; i++) { us.push(mesh.uvs[q * 8 + i * 2]); vs.push(mesh.uvs[q * 8 + i * 2 + 1]); }
    const okU = Math.abs(Math.min(...us) - rect[0]) < 1e-6 && Math.abs(Math.max(...us) - rect[2]) < 1e-6;
    const okV = Math.abs(Math.min(...vs) - rect[1]) < 1e-6 && Math.abs(Math.max(...vs) - rect[3]) < 1e-6;
    if (!(okU && okV)) { bad++; if (!sample) sample = `u∈[${Math.min(...us).toFixed(5)},${Math.max(...us).toFixed(5)}] v∈[${Math.min(...vs).toFixed(5)},${Math.max(...vs).toFixed(5)}] 应为 u∈[${rect[0].toFixed(5)},${rect[2].toFixed(5)}] v∈[${rect[1].toFixed(5)},${rect[3].toFixed(5)}]`; }
  }
  expect('每个面的 UV 精确覆盖整块图集瓦片', bad === 0, bad ? `${bad}/6 面不对：${sample}` : '');

  // 面朝向明暗（vanilla 固定系数）：合成方块用的是白色染色，所以 tint 里只剩面系数
  const { FACE_BRIGHTNESS } = await import('../common/src/main/resources/assets/what_guys_doing/web/mesher.js');
  const perQuad = [];
  for (let q = 0; q < mesh.quadCount; q++) {
    const values = [0, 1, 2, 3].map(i => mesh.tints[q * 12 + i * 3]);   // 每顶点 3 分量，取 r
    perQuad.push(values);
  }
  const uniformPerQuad = perQuad.every(vs => vs.every(v => Math.abs(v - vs[0]) < 1e-6));
  expect('每个面四个顶点的明暗一致', uniformPerQuad);
  // 合成 section 是 4096 个方块，所以每个朝向系数各出现 4096 次
  const counts = new Map();
  for (const vs of perQuad) {
    const key = Number(vs[0].toFixed(3));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const distinct = [...counts.keys()].sort((a, b) => a - b);
  const want = [...new Set(FACE_BRIGHTNESS)].sort((a, b) => a - b).map(v => Number(v.toFixed(3)));
  expect('出现的明暗系数集合 = vanilla 表（下 0.5 / 上 1.0 / 南北 0.8 / 东西 0.6）',
    distinct.join(',') === want.join(','), distinct.join(','));
  // 期望计数从表本身推导：某系数在表里出现几次 × 4096 个方块
  const freq = new Map();
  for (const v of FACE_BRIGHTNESS) {
    const key = Number(v.toFixed(3));
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  const wrongCounts = [...freq].filter(([value, f]) => counts.get(value) !== f * 4096);
  expect('每个系数的面数 = 该系数在表中的出现次数 × 4096',
    wrongCounts.length === 0,
    [...counts.entries()].map(([k, n]) => `${k}×${n}`).join(' '));
}

console.log('=== 6. 图集瓦片 → uv 矩形（真函数 tileRect，运行时与这里共用同一份）===');
{
  const { tileRect } = await import('../common/src/main/resources/assets/what_guys_doing/web/atlas.js');
  // 第 8 列第 3 行：绘制时的像素坐标是 (128, 48)，图集 256×256
  const rect = tileRect({ x: 128, y: 48 }, 256, 256);
  // 规格：像素矩形直接除以图集尺寸，**不内缩**（采样器是 nearest；
  // 内缩会让每块边缘少画半像素，表现为方块之间稳定的"井"字缝）。
  const want = [128 / 256, 48 / 256, 144 / 256, 64 / 256];
  const close = rect.every((v, i) => Math.abs(v - want[i]) < 1e-9);
  expect('像素坐标 (128,48) → uv 矩形按像素换算（不是又乘一次 TILE）', close,
    `得 [${rect.map(v => v.toFixed(4)).join(', ')}] 应为 [${want.map(v => v.toFixed(4)).join(', ')}]`);
  expect('矩形落在 [0,1] 内（指向图集外就是条纹的成因）',
    rect.every(v => v >= 0 && v <= 1), `[${rect.map(v => v.toFixed(4)).join(', ')}]`);
  expect('跨度 = 16/256（瓦片完整覆盖，无内缩）',
    Math.abs((rect[2] - rect[0]) - 16 / 256) < 1e-9 && Math.abs((rect[3] - rect[1]) - 16 / 256) < 1e-9,
    `${(rect[2] - rect[0]).toFixed(6)} × ${(rect[3] - rect[1]).toFixed(6)}`);

  // 图集非正方形时（宽 256 高 128）也要落在 [0,1] 内
  const rect2 = tileRect({ x: 240, y: 112 }, 256, 128);
  expect('非方图集 256×128 的末行瓦片仍在 [0,1] 内', rect2.every(v => v >= 0 && v <= 1),
    `[${rect2.map(v => v.toFixed(4)).join(', ')}]`);

  // 图集里每个瓦片的矩形都必须落在 [0,1]：这是"条纹"的根因检查
  const columns = 16, rows = 8;
  let outside = 0;
  for (let c = 0; c < columns; c++) {
    for (let r = 0; r < rows; r++) {
      const rr = tileRect({ x: c * 16, y: r * 16 }, columns * 16, rows * 16);
      if (!rr.every(v => v >= 0 && v <= 1)) outside++;
    }
  }
  expect('16×8 全部瓦片的矩形都在 [0,1] 内', outside === 0, `越界 ${outside} 个`);
}

console.log('=== 6b. 光照采样必须跨 section（否则每段最顶层的顶面偏黑）===');
{
  const { createMesher, lightAt } = await import('../common/src/main/resources/assets/what_guys_doing/web/mesher.js');
  const mkSection = (cy, sky) => ({
    key: `0:0:${cy}:0`, dim: 0, cx: 0, cy, cz: 0,
    palette: Int32Array.from([1]), bits: 0, indices: new Uint8Array(0),
    blockLight: new Uint8Array(2048),
    skyLight: new Uint8Array(2048).fill(sky),   // sky = 0xFF → 每格天空光 15
    biomes: new Int32Array(256), ids: null, instances: null, count: 0,
  });
  const below = mkSection(0, 0x00);   // 本段：无光（模拟"方块自己内部 = 0"）
  const above = mkSection(1, 0xFF);   // 上方段：空气，天空光 15
  const sections = new Map([[below.key, below], [above.key, above]]);
  const io = {
    bakeState: (block, props) => baker.bakeState(block, props),
    describe: () => ({ block: 'minecraft:stone', props: '' }),
    isOpaque: () => false,            // 不剔除任何面
    blockAt: () => -1,
    lightAt: (dim, wx, wy, wz) => {
      const s = sections.get(`0:${wx >> 4}:${wy >> 4}:${wz >> 4}`);
      return s ? lightAt(s, wx & 15, wy & 15, wz & 15) : null;
    },
    uvRect: () => [0, 0, 1, 1],
    materialOf: () => 0,
    tintFor: () => [1, 1, 1],
  };
  const mesh = createMesher(io).meshSection(below);
  // 找 y=15 的顶面（顶点 y 接近 16 的那个四边形），它的光照应当来自上方段 = 1.0
  let topLight = -1;
  for (let q = 0; q < mesh.quadCount; q++) {
    const ys = [0, 1, 2, 3].map(i => mesh.positions[q * 12 + i * 3 + 1]);
    if (Math.min(...ys) > 15.9) { topLight = mesh.lights[q * 4]; break; }
  }
  expect('段顶层的顶面能读到上方段的光照（1.0，而不是 0）', topLight > 0.99, String(topLight));
  // 对照：把 cross-section 访问器拿掉（老行为）→ 顶面会采到自己 = 0
  const meshOld = createMesher({ ...io, lightAt: undefined }).meshSection(below);
  let oldTopLight = -1;
  for (let q = 0; q < meshOld.quadCount; q++) {
    const ys = [0, 1, 2, 3].map(i => meshOld.positions[q * 12 + i * 3 + 1]);
    if (Math.min(...ys) > 15.9) { oldTopLight = meshOld.lights[q * 4]; break; }
  }
  expect('老行为（clamp 回本段）确实会把顶面采成 0 —— 这就是那个 bug', oldTopLight === 0, String(oldTopLight));
}

console.log('=== 6c. AO：遮挡采样点由「面法线 + 顶点位置」推出（不查表）===');
{
  const { cornerOcclusionOffsets, AO_LEVELS, createMesher } = await import('../common/src/main/resources/assets/what_guys_doing/web/mesher.js');
  // 不变量：对 6 个面 × 4 个角，三个偏移都必须在 ±1 内，且法线方向那一轴等于面朝向
  const DIRS = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  let bad = 0;
  let sample = '';
  for (let dir = 0; dir < 6; dir++) {
    for (const corner of [[0, 0, 0], [16, 0, 0], [0, 16, 0], [16, 16, 0], [0, 0, 16], [16, 0, 16], [0, 16, 16], [16, 16, 16]]) {
      const [d1, d2, dc] = cornerOcclusionOffsets(dir, corner);
      for (const d of [d1, d2, dc]) {
        if (d.some(v => Math.abs(v) > 1)) bad++;
      }
      const nAxis = DIRS[dir].findIndex(v => v !== 0);
      if (d1[nAxis] !== DIRS[dir][nAxis] || d2[nAxis] !== DIRS[dir][nAxis] || dc[nAxis] !== DIRS[dir][nAxis]) {
        bad++;
        if (!sample) sample = `dir=${dir} corner=${corner} 法线轴应为 ${DIRS[dir][nAxis]}`;
      }
    }
  }
  expect('6 面 × 8 角的偏移都在 ±1 内且法线轴与面朝向一致', bad === 0, bad ? `${bad} 处异常 ${sample}` : '');

  // 具体：朝上的面、位于最小 x/z 的角 → 两个边分别落在 −x 与 −z
  const [a, b, c] = cornerOcclusionOffsets(1, [0, 16, 0]);
  const key = d => `${d[0]},${d[1]},${d[2]}`;
  expect('上表面 + 最小 x/z 角：两边为 (−1,1,0) 与 (0,1,−1)，角为 (−1,1,−1)',
    [key(a), key(b), key(c)].sort().join(' | ') === ['-1,1,0', '0,1,-1', '-1,1,-1'].sort().join(' | '),
    [key(a), key(b), key(c)].join(' | '));

  // 端到端：一面"墙"贴着地板时，靠墙那两个角的 AO 必须更低
  const section = {
    key: '0:0:0:0', dim: 0, cx: 0, cy: 0, cz: 0,
    palette: Int32Array.from([1]), bits: 0, indices: new Uint8Array(0),
    blockLight: new Uint8Array(2048).fill(0xFF), skyLight: new Uint8Array(2048).fill(0xFF),
    biomes: new Int32Array(256), ids: null, instances: null, count: 0,
  };
  const mesher = createMesher({
    bakeState: (block, props) => baker.bakeState(block, props),
    describe: () => ({ block: 'minecraft:stone', props: '' }),
    isOpaque: () => true,
    // 只在 x = −1 那一列（世界坐标）放不透明方块，用来当地板旁的"墙"
    blockAt: (dim, wx, wy, wz) => (wx === -1 && wy === 0 && wz >= 0 && wz < 16 ? 2 : -1),
    lightAt: () => 1,
    uvRect: () => [0, 0, 1, 1],
    materialOf: () => 0,
    tintFor: () => [1, 1, 1],
  });
  const mesh = mesher.meshSection(section);
  expect('网格输出了逐顶点 AO', mesh.aos && mesh.aos.length === mesh.vertexCount, String(mesh.aos && mesh.aos.length));
  expect('AO 值都在定义的档位内（不出现 0 或 >1）',
    [...mesh.aos].every(v => AO_LEVELS.includes(Number(v.toFixed(4))) || (v >= 0.55 && v <= 1.0001)),
    `min=${Math.min(...mesh.aos).toFixed(2)} max=${Math.max(...mesh.aos).toFixed(2)}`);
  const ys = [...mesh.aos];
  expect('存在被遮挡的角（AO < 1）与未遮挡的角（AO = 1）',
    ys.some(v => v < 0.999) && ys.some(v => v > 0.999),
    `被遮挡 ${ys.filter(v => v < 0.999).length}/${ys.length}`);
}

console.log('=== 7. 图集瓦片顺序必须"只追加、不排序"（否则草方块会变钻石块）===');
{
  const { stableTileOrder } = await import('../common/src/main/resources/assets/what_guys_doing/web/atlas.js');
  const base = stableTileOrder(['minecraft:block/stone', 'minecraft:block/dirt']);
  const grown = stableTileOrder(['minecraft:block/stone', 'minecraft:block/dirt', 'minecraft:block/grass_block_top']);
  expect('新增贴图追加在末尾，已有瓦片位置不变',
    grown.slice(0, 2).join(',') === base.join(',') && grown[2].includes('grass_block_top'), grown.join(','));
  const unsorted = stableTileOrder(['minecraft:block/zebra', 'minecraft:block/aaa']);
  expect('不按字典序排序（排序会让已有瓦片整体挪位）', unsorted[0].includes('zebra'), unsorted.join(','));
  expect('去重但保持首次出现顺序', stableTileOrder(['b', 'a', 'b', 'c']).join(',') === 'b,a,c');

  // 持久槽位表：跨重建只追加；输入集合即使缩小，已有槽位也不得改变
  const { assignTileSlots } = await import('../common/src/main/resources/assets/what_guys_doing/web/atlas.js');
  const order = new Map();
  assignTileSlots(order, ['minecraft:block/stone', 'minecraft:block/dirt', 'minecraft:block/grass_block_top']);
  const before = [...order.entries()].map(([p, i]) => `${p}=${i}`).join(',');
  assignTileSlots(order, ['minecraft:block/dirt']);            // 集合缩小到只剩一项
  expect('集合缩小时已有槽位不变（否则旧网格指到别的贴图）',
    [...order.entries()].map(([p, i]) => `${p}=${i}`).join(',') === before, [...order.keys()].length + ' 项');
  assignTileSlots(order, ['minecraft:block/diamond_block']);   // 追加
  expect('新贴图追加到末尾，不插空', order.get('minecraft:block/diamond_block') === 3, [...order.values()].join(','));
}

console.log('=== 8. 图集容量必须量化成台阶（尺寸变化会让所有已建网格 uv 失效）===');
{
  const { atlasCapacity } = await import('../common/src/main/resources/assets/what_guys_doing/web/atlas.js');
  expect('256 以内容量恒定', atlasCapacity(1) === 256 && atlasCapacity(139) === 256 && atlasCapacity(256) === 256,
    `${atlasCapacity(1)}/${atlasCapacity(139)}/${atlasCapacity(256)}`);
  expect('跨台阶才增长（257 → 512）', atlasCapacity(257) === 512 && atlasCapacity(400) === 512, `${atlasCapacity(257)}`);
  expect('台阶等距：513 → 768（256 的整数倍，不是 2 的幂）', atlasCapacity(513) === 768 && atlasCapacity(768) === 768, `${atlasCapacity(513)}`);
  // 关键性质：同一台阶内，瓦片数变化不得改变容量（否则每次重建都要全量重网格）
  let stable = true;
  for (let n = 100; n <= 256; n++) if (atlasCapacity(n) !== 256) stable = false;
  expect('同一台阶内容量不变（重建非破坏性）', stable);
}

console.log('');
if (failed) {
  console.log(`FAILED: ${failed} 项断言未通过`);
  process.exit(1);
}
console.log('ALL PASSED：UV 范围与方向符合预期');
