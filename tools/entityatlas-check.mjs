// entityatlas-check.mjs — 实体图集回归：原生尺寸 shelf 打包 + uv 矩形 + alpha 分类。
//
// 断言全部来自真实资源（entitybundle.json 引用的贴图 + PNG 头里的宽高），不手算魔数：
//  1. 每个被引用的贴图都有槽位，且槽位尺寸 == PNG 原生尺寸（证明没有被降采样）；
//  2. 所有槽位互不重叠、都在页内；
//  3. uvRect 能精确反算回像素槽位（基准点也要查，不能只查跨度）；
//  4. 追加是稳定的：新增贴图不会移动旧槽位；
//  5. alpha 分类对合成像素符合 opaque / cutout / translucent 的约定。
import fs from 'node:fs';
import path from 'node:path';
import { entityTexturePaths } from '../common/src/main/resources/assets/what_guys_doing/web/entitymodel.js';
import {
  packEntityAtlas, entityUvRect, classifyAlphaRegion,
  MISSING_TILE_SIZE, DEFAULT_MAX_WIDTH, DEFAULT_HEIGHT_QUANTUM,
} from '../common/src/main/resources/assets/what_guys_doing/web/entityatlas.js';
import { ALPHA_OPAQUE, ALPHA_CUTOUT, ALPHA_TRANSLUCENT } from '../common/src/main/resources/assets/what_guys_doing/web/atlas.js';

let failed = 0;
function expect(name, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
}

const ASSET_DIR = process.env.WGD_ASSET_DIR
  || path.join('neoforge', 'run', 'config', 'what_guys_doing', 'assets', 'content', 'minecraft');
const BUNDLE = path.join('common', 'src', 'main', 'resources', 'assets', 'what_guys_doing', 'entitybundle.json');

// PNG 头：宽/高在 IHDR 里，big-endian。
function pngSize(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function diskFile(ref) {
  return path.join(ASSET_DIR, ref.replace(/^minecraft:/, ''));
}

const bundle = JSON.parse(fs.readFileSync(BUNDLE, 'utf8'));
const paths = entityTexturePaths(bundle);
console.log(`实体模型 ${Object.keys(bundle.models).length} 个，引用贴图 ${paths.length} 张`);

const entries = [];
const missing = [];
for (const ref of paths) {
  const file = diskFile(ref);
  const size = fs.existsSync(file) ? pngSize(file) : null;
  if (!size) {
    missing.push(ref);
    entries.push({ path: ref, width: MISSING_TILE_SIZE, height: MISSING_TILE_SIZE, present: false });
  } else {
    entries.push({ path: ref, width: size.width, height: size.height, present: true });
  }
}

console.log(`贴图存在 ${entries.filter(e => e.present).length} 张，缺失 ${missing.length} 张（按 16×16 洋红占位打包）`);

// ---------------------------------------------------------------- 1. 原生尺寸与覆盖
console.log('\n=== 1. 槽位覆盖与原生尺寸 ===');
const layout = packEntityAtlas(entries);
expect('每个引用贴图都有槽位', layout.placements.size === entries.length,
  `${layout.placements.size}/${entries.length}`);
let badSize = 0;
for (const entry of entries) {
  const place = layout.placements.get(entry.path);
  if (!place || place.width !== entry.width || place.height !== entry.height) badSize++;
}
expect('槽位尺寸 == PNG 原生尺寸（不降采样）', badSize === 0, `不符 ${badSize}`);

// ---------------------------------------------------------------- 2. 页内与不重叠
console.log('\n=== 2. 页内边界与互不重叠 ===');
const boxes = [...layout.placements.entries()].map(([p, b]) => ({ p, ...b }));
boxes.push({ p: '洋红占位', ...layout.missingPlacement });
let outside = 0;
for (const b of boxes) {
  if (b.x < 0 || b.y < 0 || b.x + b.width > layout.width || b.y + b.height > layout.height) outside++;
}
expect('全部槽位在页内', outside === 0, `越界 ${outside}`);
let overlaps = 0;
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], c = boxes[j];
    if (a.x < c.x + c.width && c.x < a.x + a.width
      && a.y < c.y + c.height && c.y < a.y + a.height) {
      overlaps++;
      if (overlaps <= 3) console.log(`      重叠 ${a.p} × ${c.p}`);
    }
  }
}
expect('槽位互不重叠', overlaps === 0, `重叠 ${overlaps} 对`);
expect('页高按量子量化', layout.height % DEFAULT_HEIGHT_QUANTUM === 0,
  `${layout.width}×${layout.height}（实际用到 ${layout.usedHeight}）`);
expect('页宽不超过默认上限（当前资源）', layout.width <= DEFAULT_MAX_WIDTH,
  `${layout.width}px`);

// ---------------------------------------------------------------- 3. uv 矩形反算
console.log('\n=== 3. uvRect 精确反算像素槽位 ===');
let badRect = 0;
let badBound = 0;
for (const entry of entries) {
  const place = layout.placements.get(entry.path);
  const rect = entityUvRect(place, layout.width, layout.height);
  const x0 = rect[0] * layout.width;
  const y0 = rect[1] * layout.height;
  const x1 = rect[2] * layout.width;
  const y1 = rect[3] * layout.height;
  // 精确映射：反算必须原样回到内容矩形的四条边，不能有半 texel 内缩。
  if (Math.abs(x0 - place.x) > 1e-6 || Math.abs(x1 - (place.x + place.width)) > 1e-6
    || Math.abs(y0 - place.y) > 1e-6 || Math.abs(y1 - (place.y + place.height)) > 1e-6) {
    badRect++;
  }
  if (rect[0] < 0 || rect[1] < 0 || rect[2] > 1 || rect[3] > 1
    || rect[2] <= rect[0] || rect[3] <= rect[1]) badBound++;
}
expect('uv 基准点与跨度都正确（无内缩）', badRect === 0, `不符 ${badRect}`);
expect('uv 全在 [0,1] 且非退化', badBound === 0, `越界 ${badBound}`);
expect('槽位外有 padding 吸收边缘采样', layout.padding === 1
  && [...layout.placements.values()].every(p => p.x >= layout.padding && p.y >= layout.padding),
  `padding=${layout.padding}`);
const missingRect = entityUvRect(layout.missingPlacement, layout.width, layout.height);
const first = entityUvRect(layout.placements.get(entries[0].path), layout.width, layout.height);
expect('洋红占位与 0 号槽位不重叠', missingRect[2] < first[0],
  `占位 u1=${missingRect[2].toFixed(6)} < 首槽 u0=${first[0].toFixed(6)}`);

// ---------------------------------------------------------------- 4. 追加稳定性
console.log('\n=== 4. 追加不移动旧槽位 ===');
const split = Math.max(1, Math.floor(entries.length / 2));
const base = packEntityAtlas(entries.slice(0, split));
const grown = packEntityAtlas(entries);
let moved = 0;
for (const entry of entries.slice(0, split)) {
  const a = base.placements.get(entry.path);
  const b = grown.placements.get(entry.path);
  if (!a || !b || a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height) moved++;
}
expect('前一半槽位在扩容后坐标不变', moved === 0, `移动 ${moved}`);
expect('扩容后页宽不变', base.width === grown.width, `${base.width} → ${grown.width}`);
expect('槽位数量随追加增长', grown.placements.size === entries.length);

// ---------------------------------------------------------------- 5. alpha 分类
console.log('\n=== 5. alpha 分类约定 ===');
function pixelsFrom(alphas) {
  const data = new Uint8ClampedArray(alphas.length * 4);
  alphas.forEach((a, i) => { data[i * 4 + 3] = a; });
  return data;
}
const place2x2 = { x: 0, y: 0, width: 2, height: 2 };
expect('全 255 → OPAQUE',
  classifyAlphaRegion(pixelsFrom([255, 255, 255, 255]), 2, place2x2) === ALPHA_OPAQUE);
expect('纯 0/255 混合 → CUTOUT',
  classifyAlphaRegion(pixelsFrom([255, 0, 255, 255]), 2, place2x2) === ALPHA_CUTOUT);
expect('出现中间值 → TRANSLUCENT',
  classifyAlphaRegion(pixelsFrom([255, 128, 255, 255]), 2, place2x2) === ALPHA_TRANSLUCENT);

console.log('\n=== 结果 ===');
if (failed === 0) {
  console.log(`ALL PASSED：实体图集布局 ${layout.width}×${layout.height}，${layout.placements.size} 张，缺失 ${missing.length}`);
} else {
  console.log(`FAILED：${failed} 项`);
}
process.exitCode = failed === 0 ? 0 : 1;
