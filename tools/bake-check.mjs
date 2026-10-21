// 烘焙器全量回归：不需要起服务器，直接读抽取出来的原版资源包。
// 用法：node tools/bake-check.mjs   （可选 WGD_ASSETS=<content/minecraft 路径>）
import fs from 'node:fs';
import path from 'node:path';
import { createBaker, matchesKey } from '../common/src/main/resources/assets/what_guys_doing/web/baker.js';

const CONTENT = process.env.WGD_ASSET_DIR
  || path.join('neoforge', 'run', 'config', 'what_guys_doing', 'assets', 'content', 'minecraft');

const jsonCache = new Map();
// baker 的契约是 `minecraft/...` 相对路径（浏览器里会拼到 /assets/ 上）；
// 落盘目录 content/ 里已经有 minecraft 这一层，所以这里去掉前缀。
function readJson(rel) {
  const key = rel.replace(/^minecraft\//, '');
  if (jsonCache.has(key)) return jsonCache.get(key);
  let value = null;
  try { value = JSON.parse(fs.readFileSync(path.join(CONTENT, key), 'utf8')); } catch { value = null; }
  jsonCache.set(key, value);
  return value;
}

const baker = createBaker({ readJson });
const failures = [];
const notes = {};

// ---------------------------------------------------------------- 精确断言
function assert(cond, message) {
  if (!cond) failures.push(message);
}
function fmt(points) {
  return points
    .map(v => '[' + v.map(x => (typeof x === 'number' ? x.toFixed(2) : String(x))).join(',') + ']')
    .join(' ');
}
function spot(name, fn) {
  try {
    fn();
  } catch (e) {
    failures.push(`${name} 抛出异常: ${e.message}`);
  }
}

console.log('=== 精确断言 ===');
spot('stone', () => {
  const stone = baker.bakeState('minecraft:stone', '');
  assert(stone !== null, 'stone 应为空属性串烘出结果');
  assert(stone && stone.quads.length === 6, `stone 应有 6 个面，实得 ${stone ? stone.quads.length : 'null'}`);
  assert(stone && stone.fullCube === true, 'stone 应判定为满方块');
  const up = stone && stone.quads.find(q => q.dir === 1);
  assert(up && up.verts.length === 4, 'stone 的 up 面应有 4 个顶点');
  if (up) {
    const expected = [[0, 16, 0, 0, 0], [16, 16, 0, 16, 0], [16, 16, 16, 16, 16], [0, 16, 16, 0, 16]];
    const ok = up.verts.every((v, i) => expected[i].every((e, k) => Math.abs(e - v[k]) < 1e-6));
    assert(ok, `stone up 面顶点/uv 不符：实得 ${fmt(up.verts)}`);
    console.log(`  stone.up = ${fmt(up.verts)}`);
  }
});

{
  const slab = baker.bakeState('minecraft:oak_slab', 'type=bottom,waterlogged=false');
  assert(slab !== null, 'oak_slab(type=bottom) 应烘出结果');
  const up = slab && slab.quads.find(q => q.dir === 1);
  assert(up && Math.abs(up.verts[0][1] - 8) < 1e-6, `部分方块顶面应在 y=8，实得 ${up ? up.verts[0][1] : 'null'}`);
  assert(up && Math.abs(up.verts[0][3] - 0) < 1e-6 && Math.abs(up.verts[2][3] - 16) < 1e-6,
    `部分方块顶面 uv 仍应是 0..16，实得 ${up ? fmt(up.verts) : 'null'}`);
  if (up) console.log(`  oak_slab(type=bottom).up = ${fmt(up.verts)}`);
  assert(slab && slab.fullCube === false, '半砖不应判定为满方块');
}

{
  const stairs = baker.bakeState('minecraft:oak_stairs', 'facing=north,half=bottom,shape=straight,waterlogged=false');
  assert(stairs !== null, 'stairs 应烘出结果');
  assert(stairs && stairs.quads.length >= 6, `stairs 面数应 ≥6，实得 ${stairs ? stairs.quads.length : 'null'}`);
  if (stairs) console.log(`  oak_stairs(facing=north,half=bottom,shape=straight) = ${stairs.quads.length} 面 (match=${stairs.variant} key="${stairs.variantKey}")`);
}

// fence：blockstate y 必须从上往下顺时针；uvlock 必须真正旋转 UV 矩形。
{
  const east = baker.bakeState('minecraft:oak_fence', 'north=false,east=true,south=false,west=false,waterlogged=false');
  assert(east !== null, 'oak_fence(east) 应烘出结果');
  if (east) {
    const tops = east.quads.filter(q => q.dir === 1);
    const sideTop = tops.find(q => Math.max(...q.verts.map(v => v[0])) > 10);
    assert(!!sideTop, 'fence east 的 side 应在 +x 侧（x>10）');
    if (sideTop) {
      const us = sideTop.verts.map(v => v[3]), vs = sideTop.verts.map(v => v[4]);
      const du = Math.max(...us) - Math.min(...us), dv = Math.max(...vs) - Math.min(...vs);
      // uvlock 90° 后 2×9 的 top UV 必须变成 9×2，不能仍是 2×9。
      assert(Math.abs(du - 9) < 0.01 && Math.abs(dv - 2) < 0.01, `fence east top uv 应是 9×2，实得 ${du}×${dv}`);
      // 同时 u/v 轴必须交换：第一条边（模型 u）应落在纹理 v 的 2 像素上，
      // 第二条边（模型 v）应落在纹理 u 的 9 像素上；否则就是只转矩形没转角序。
      const [a, b, c] = sideTop.verts;
      const du1 = Math.abs(b[3] - a[3]), dv1 = Math.abs(b[4] - a[4]);
      const du2 = Math.abs(c[3] - b[3]), dv2 = Math.abs(c[4] - b[4]);
      assert(Math.abs(du1) < 0.01 && Math.abs(dv1 - 2) < 0.01
        && Math.abs(du2 - 9) < 0.01 && Math.abs(dv2) < 0.01,
      `fence east top 的 UV 轴未交换：edge1=${du1}×${dv1} edge2=${du2}×${dv2}`);
      console.log(`  oak_fence(east) sideTop x=${Math.min(...sideTop.verts.map(v => v[0])).toFixed(1)}..${Math.max(...sideTop.verts.map(v => v[0])).toFixed(1)}`);
    }
  }
  const north = baker.bakeState('minecraft:oak_fence', 'north=true,east=false,south=false,west=false,waterlogged=false');
  if (north) {
    const sideTop = north.quads.filter(q => q.dir === 1).find(q => Math.min(...q.verts.map(v => v[2])) < 6);
    assert(!!sideTop, 'fence north 的 side 应在 -z 侧');
  }
}

{
  const grass = baker.bakeState('minecraft:grass_block', 'snowy=false');
  assert(grass !== null, 'grass_block 应烘出结果');
  assert(grass && grass.tinted === true, 'grass_block 应带 tintindex（生物群系染色）');
  if (grass) console.log(`  grass_block(snowy=false) = ${grass.quads.length} 面, tinted=${grass.tinted}`);
}

{
  const leaves = baker.bakeState('minecraft:oak_leaves', 'distance=7,persistent=false,waterlogged=false');
  assert(leaves !== null, 'oak_leaves 应通过子集匹配（"" key）烘出结果');
  assert(leaves && leaves.variant === 'subset', `oak_leaves 应走子集匹配，实得 ${leaves ? leaves.variant : 'null'}`);
  if (leaves) console.log(`  oak_leaves(distance=7,...) = ${leaves.quads.length} 面, match=${leaves.variant}`);
}

// ---------------------------------------------------------------- 全量烘焙
console.log('\n=== 全量烘焙（每个 blockstates 文件的每个变体 key）===');
const dir = path.join(CONTENT, 'blockstates');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
console.log(`  blockstates 文件: ${files.length}`);

const NO_PROPS = '';
let states = 0;
let nullExpected = 0;
let nullUnexpected = 0;
const nullBlocks = new Map();
const nullReasons = new Map();
const t0 = performance.now();

/** 诊断某个状态为什么烘不出几何。 */
function nullReason(blockName, props) {
  const short = blockName.split(':')[1];
  const json = readJson(`minecraft/blockstates/${short}.json`);
  if (!json) return 'blockstates 缺失';
  if (json.variants) {
    const keys = Object.keys(json.variants).filter(k => matchesKey(props, k)).sort((a, b) => b.length - a.length);
    if (!keys.length) return '无匹配 key';
    const raw = json.variants[keys[0]];
    const variant = Array.isArray(raw) ? raw[0] : raw;
    if (!variant || typeof variant.model !== 'string') return '变体无 model';
    const model = readJson(`minecraft/models/${variant.model.replace(/^minecraft:/, '')}.json`);
    if (!model) return 'model 文件缺失';
    if (!model.elements && !model.parent) return '模型既无 elements 也无 parent';
    return '模型链最终无 elements';
  }
  if (json.multipart) return 'multipart 无适用条目';
  return '其它';
}

for (const file of files) {
  const blockName = `minecraft:${file.replace(/\.json$/, '')}`;
  const json = readJson(`minecraft/blockstates/${file}`);
  if (!json) continue;
  const propsToTry = new Set([NO_PROPS]);
  if (json.variants) {
    for (const key of Object.keys(json.variants)) propsToTry.add(key);
  } else if (json.multipart) {
    // multipart 无法从 JSON 反推状态空间：用空属性串 + 由 when 触发的合成状态
    for (const part of json.multipart) {
      if (!part.when) continue;
      const parts = [];
      const walk = when => {
        if (!when) return;
        if (when.OR) return when.OR.forEach(walk);
        if (when.AND) return when.AND.forEach(walk);
        for (const [k, v] of Object.entries(when)) parts.push(`${k}=${Array.isArray(v) ? v[0] : v}`);
      };
      walk(part.when);
      if (parts.length) propsToTry.add(parts.join(','));
    }
  }
  const variantsDeclareEmpty = !!json.variants && Object.prototype.hasOwnProperty.call(json.variants, NO_PROPS);
  for (const props of propsToTry) {
    const baked = baker.bakeState(blockName, props);
    states++;
    if (baked) {
      if (baked.variant === 'none') failures.push(`${blockName} "${props}" 变体无匹配`);
      continue;
    }
    // 空属性串探测：只有当该方块自己声明了 "" 变体时，空状态才算「应当有几何」
    if (props === NO_PROPS && !variantsDeclareEmpty) {
      nullExpected++;
    } else {
      nullUnexpected++;
      nullBlocks.set(blockName, (nullBlocks.get(blockName) || 0) + 1);
      const reason = nullReason(blockName, props);
      nullReasons.set(reason, (nullReasons.get(reason) || 0) + 1);
    }
  }
}
const elapsed = performance.now() - t0;
const stats = baker.stats();

console.log(`  尝试状态数: ${states}（空属性串探测: ${nullExpected} 个本就无此状态，预期内；真正无几何: ${nullUnexpected}）`);
console.log(`  已解析模型: ${stats.models}   已读 blockstates: ${stats.blockstates}`);
console.log(`  成功烘焙状态: ${stats.states}   四边形总数: ${stats.quads}`);
console.log(`  用到的贴图: ${baker.texturesUsed().length} 张`);
console.log(`  耗时: ${elapsed.toFixed(0)} ms（${(elapsed / Math.max(1, states)).toFixed(3)} ms/状态，${(stats.quads / Math.max(1, stats.states)).toFixed(1)} 面/状态）`);
if (nullBlocks.size) {
  console.log(`\n  真正无几何的原因分布:`);
  for (const [reason, count] of [...nullReasons].sort((a, b) => b[1] - a[1])) console.log(`    ${reason.padEnd(24)} ${count}`);
  console.log(`  涉及方块（前 12）:`);
  for (const [block, count] of [...nullBlocks].slice(0, 12)) console.log(`    ${block.padEnd(38)} ${count} 个状态`);
}

console.log('\n=== element.rotation 语义（用 vanilla 的 cross 模型交叉验证）===');
{
  // 真值来自模型文件本身：cross 的两个平面各绕 y 旋转 45° + rescale，
  // 结果必须顶到方块对角、且沿对角保留 from/to 里的 0.8 内缩。
  //   元素1 from/to x∈[0.8,15.2] @ z=8  → 四角 (0.8,15.2) 与 (15.2,0.8)
  //   元素2 z∈[0.8,15.2] @ x=8          → 四角 (0.8,0.8)  与 (15.2,15.2)
  const template = baker.bakeState('minecraft:poppy', '');
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const quad of template.quads) {
    for (const v of quad.verts) {
      minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
      minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
      minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]);
    }
  }
  const bbox = `x∈[${minX.toFixed(2)}, ${maxX.toFixed(2)}] y∈[${minY.toFixed(2)}, ${maxY.toFixed(2)}] z∈[${minZ.toFixed(2)}, ${maxZ.toFixed(2)}]`;
  console.log(`  poppy（cross 模型）旋转后包围盒 ${bbox}`);
  assert(Math.abs(minX - 0.8) < 0.01 && Math.abs(maxX - 15.2) < 0.01
    && Math.abs(minZ - 0.8) < 0.01 && Math.abs(maxZ - 15.2) < 0.01,
    `cross 旋转后 x/z 应落在 [0.8, 15.2]（顶到对角且保留内缩），实际 ${bbox}`);
  assert(Math.abs(minY) < 0.01 && Math.abs(maxY - 16) < 0.01,
    `cross 高度方向不应受 y 轴旋转影响，实际 ${bbox}`);

  // 两个平面必须成了"对角朝向"：四边形边在 x 与 z 上的分量大小相等（旋转 45° 的特征）
  let diagonalPlanes = 0;
  let axisAlignedPlanes = 0;
  for (const quad of template.quads) {
    const dx = quad.verts[1][0] - quad.verts[0][0];
    const dz = quad.verts[1][2] - quad.verts[0][2];
    if (Math.abs(Math.abs(dx) - Math.abs(dz)) < 0.01 && Math.abs(dx) > 0.01) diagonalPlanes++;
    else if (Math.abs(dx) < 0.01 || Math.abs(dz) < 0.01) axisAlignedPlanes++;
  }
  console.log(`  对角朝向的面 ${diagonalPlanes}、仍轴对齐的面 ${axisAlignedPlanes}`);
  assert(diagonalPlanes >= 2 && axisAlignedPlanes === 0,
    `cross 的两个平面都应是对角朝向，实际 对角 ${diagonalPlanes} / 轴对齐 ${axisAlignedPlanes}`);
}

/**
 * 教科书旋转（测试侧独立实现，用来对拍 baker）：
 * 绕 +axis 右手旋转 angle，先按 rescale 放大两个垂直轴，再旋转，最后加回 origin。
 * 符号约定取自标准右手系（y 向上）：这不是从 baker 抄的 —— 若两边约定不同，对拍会失败。
 */
function rotateCornerTextbook(point, rot) {
  const origin = rot.origin || [8, 8, 8];
  const a = ((rot.angle || 0) * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  let x = point[0] - origin[0], y = point[1] - origin[1], z = point[2] - origin[2];
  if (rot.rescale) {
    const f = 1 / Math.abs(c);
    if (rot.axis === 'x') { y *= f; z *= f; } else if (rot.axis === 'y') { x *= f; z *= f; } else { x *= f; y *= f; }
  }
  if (rot.axis === 'x') { const ny = y * c - z * s; const nz = y * s + z * c; y = ny; z = nz; }
  else if (rot.axis === 'y') { const nx = x * c + z * s; const nz = -x * s + z * c; x = nx; z = nz; }
  else { const nx = x * c - y * s; const ny = x * s + y * c; x = nx; y = ny; }
  return [x + origin[0], y + origin[1], z + origin[2]];
}

/** 模型自身元素角点 → { 旋转后集合, 未旋转集合 }（供"旋转确实生效"的判断） */
function elementCorners(modelRel) {
  const model = readJson(`models/${modelRel}.json`);
  const rotated = [];
  const unrotated = [];
  for (const el of model.elements || []) {
    for (const x of [el.from[0], el.to[0]]) {
      for (const y of [el.from[1], el.to[1]]) {
        for (const z of [el.from[2], el.to[2]]) {
          const corner = [x, y, z];
          unrotated.push(corner);
          rotated.push(el.rotation ? rotateCornerTextbook(corner, el.rotation) : corner);
        }
      }
    }
  }
  return { rotated, unrotated };
}

const samePoint = (a, b, eps = 0.02) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps;
const matchesAny = (p, list) => list.some(q => samePoint(p, q));

console.log('\n=== element.rotation：x / z 轴（对拍教科书公式）===');
for (const [block, props, modelRel, axisName] of [
  ['minecraft:big_dripleaf', 'facing=north,tilt=partial', 'block/big_dripleaf_partial_tilt', 'x'],
  ['minecraft:mangrove_propagule', 'hanging=true,age=0', 'block/mangrove_propagule_hanging_0', 'z'],
]) {
  const template = baker.bakeState(block, props);
  if (!template || !template.quads.length) {
    assert(false, `${block}[${props}] 没有烘出几何`);
    continue;
  }
  const { rotated, unrotated } = elementCorners(modelRel);
  let mismatched = 0;
  let movedByRotation = 0;
  let sample = '';
  for (const quad of template.quads) {
    for (const v of quad.verts) {
      const p = [v[0], v[1], v[2]];
      if (!matchesAny(p, rotated)) {
        mismatched++;
        if (!sample) sample = `顶点 (${p.map(n => n.toFixed(2)).join(', ')}) 不在期望角点集合内`;
      }
      if (!matchesAny(p, unrotated)) movedByRotation++;
    }
  }
  console.log(`  ${modelRel}：期望角点 ${rotated.length} 个，被旋转移动的顶点 ${movedByRotation}`);
  assert(mismatched === 0, `${modelRel}（${axisName} 轴）有 ${mismatched} 个顶点与教科书旋转不一致；${sample}`);
  assert(movedByRotation > 0, `${modelRel}（${axisName} 轴）旋转没有生效（所有顶点仍在未旋转角点上）`);
}

console.log('\n=== 满方块判定（遮挡剔除的前提）===');
{
  const cube = baker.bakeState('minecraft:grass_block', 'snowy=false');
  const stone = baker.bakeState('minecraft:stone', '');
  const stairs = baker.bakeState('minecraft:oak_stairs', 'facing=north,half=bottom,shape=straight');
  console.log(`  grass_block fullCube=${cube && cube.fullCube}  stone fullCube=${stone && stone.fullCube}  stairs fullCube=${stairs && stairs.fullCube}`);
  // 草方块有两个元素（本体 + 草色覆盖层），但仍是一个满方块 —— 这条以前是 false，
  // 导致相邻草方块的侧面不剔除（表现为地下抬头看到"井"字）。
  assert(cube && cube.fullCube === true, 'grass_block 应判为满方块（多元素但形状相同）');
  assert(stone && stone.fullCube === true, 'stone 应判为满方块');
  assert(stairs && stairs.fullCube !== true, 'stairs 不应判为满方块');
}

console.log('\n=== 结果 ===');
if (failures.length) {
  console.log(`FAILED: ${failures.length} 项`);
  for (const f of failures.slice(0, 20)) console.log('  ' + f);
  process.exitCode = 1;
} else {
  console.log('ALL PASSED');
}
