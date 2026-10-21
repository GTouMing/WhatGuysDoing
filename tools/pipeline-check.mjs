// 用真实服务端数据跑一遍 app.js 的烘焙数据通路（不需要浏览器 / GPU）：
// WS 收 section → /api/models-bundle → /api/blockstates 描述符 → 烘焙 → 图集替身 → 每 section 网格化
// 用法：先起服务端，再 node tools/pipeline-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createBaker } from '../common/src/main/resources/assets/what_guys_doing/web/baker.js';
import { createMesher, stateIdAt } from '../common/src/main/resources/assets/what_guys_doing/web/mesher.js';
import { tintFor } from '../common/src/main/resources/assets/what_guys_doing/web/tint.js';
// 直接用客户端那份 Reader/MSG：保证「验的就是跑的」（之前各脚本自己重写 Reader，
// 因此漏掉了 this.bytes 字段遮蔽 bytes() 方法的 bug）
import { MSG, C_SUBSCRIBE, Reader } from '../common/src/main/resources/assets/what_guys_doing/web/protocol.js';

const PORT = Number(process.env.WGD_PORT || 27183);
const RADIUS = Number(process.env.WGD_RADIUS || 3);
const CONTENT = process.env.WGD_ASSET_DIR
  || path.join('neoforge', 'run', 'config', 'what_guys_doing', 'assets', 'content', 'minecraft');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- 1) 收 section
const sections = new Map();
const paletteIds = new Set();
let dimNames = [];
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
ws.binaryType = 'arraybuffer';
ws.onopen = () => {
  const buf = Buffer.alloc(11);
  buf.writeUInt8(0x81, 0); buf.writeUInt8(0, 1);
  buf.writeInt32LE(0, 2); buf.writeInt32LE(0, 6); buf.writeUInt8(RADIUS, 10);
  ws.send(buf);
};
ws.onmessage = ev => {
  const r = new Reader(ev.data);
  const type = r.u8();
  if (type === 0x01) {
    r.u32(); r.u32(); r.u16();
    const n = r.u16();
    for (let i = 0; i < n; i++) { r.u8(); dimNames.push(r.utf()); r.i32(); r.i32(); }
    return;
  }
  if (type !== 0x02) return;
  const dim = r.u8(), cx = r.i32(), cy = r.i32(), cz = r.i32();
  const paletteSize = r.u16();
  const palette = new Int32Array(paletteSize);
  for (let i = 0; i < paletteSize; i++) palette[i] = r.u32();
  const bits = r.u8();
  const indices = r.bytes(bits === 0 ? 0 : Math.ceil((4096 * bits) / 8)).slice();
  const blockLight = r.bytes(2048).slice();
  const skyLight = r.bytes(2048).slice();
  const biomes = new Int32Array(256);
  for (let i = 0; i < 256; i++) biomes[i] = r.u16();
  const key = `${dim}:${cx}:${cy}:${cz}`;
  sections.set(key, { key, dim, cx, cy, cz, palette, bits, indices, blockLight, skyLight, biomes });
  for (const id of palette) paletteIds.add(id);
};
await sleep(Number(process.env.WGD_WAIT || 9000));
ws.close();
console.log(`收到 ${sections.size} 个 section，调色板共 ${paletteIds.size} 个 stateId，维度 ${dimNames.join(', ')}`);

// ---------------------------------------------------------------- 2) 模型包 + 描述符
const t0 = performance.now();
const bundle = await (await fetch(`http://127.0.0.1:${PORT}/api/models-bundle`)).json();
const tBundle = performance.now() - t0;
const baker = createBaker({ readJson: rel => bundle[rel.replace(/^minecraft\//, '')] ?? null });

const stateInfo = new Map();
const ids = [...paletteIds];
let descriptorMisses = 0;
for (let i = 0; i < ids.length; i += 128) {
  const chunk = ids.slice(i, i + 128);
  const text = await (await fetch(`http://127.0.0.1:${PORT}/api/blockstates?ids=${chunk.join(',')}`)).text();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const [id, block, props] = line.split('\t');
    if (!block || block === '?') { descriptorMisses++; continue; }
    stateInfo.set(Number(id), { block, props: props ?? '' });
  }
}
console.log(`模型包 ${Object.keys(bundle).length} 条目 / ${tBundle.toFixed(0)} ms；描述符 ${stateInfo.size} 条（未解析 ${descriptorMisses}）`);

// ---------------------------------------------------------------- 3) 烘焙
const tBake = performance.now();
let bakedStates = 0;
const bakeFailures = [];
for (const [id, info] of stateInfo) {
  const baked = baker.bakeState(info.block, info.props);
  if (baked) bakedStates++;
  else bakeFailures.push(`${id} ${info.block} "${info.props}"`);
}
const tBakeMs = performance.now() - tBake;
console.log(`烘焙 ${bakedStates}/${stateInfo.size} 个状态，用时 ${tBakeMs.toFixed(0)} ms`);

// ---------------------------------------------------------------- 4) 贴图是否都在
const used = baker.texturesUsed();
const missingTextures = used.filter(tex => {
  const rel = tex.replace(/^minecraft:/, '');
  return !fs.existsSync(path.join(CONTENT, 'textures', `${rel}.png`));
});
console.log(`引用贴图 ${used.length} 张；磁盘上缺失 ${missingTextures.length} 张${missingTextures.length ? ':\n  ' + missingTextures.slice(0, 10).join('\n  ') : ''}`);

// ---------------------------------------------------------------- 5) 逐 section 网格化
const rectCache = new Map();
const uvRectStub = tex => {
  let rect = rectCache.get(tex);
  if (!rect) { rect = [0, 0, 1, 1]; rectCache.set(tex, rect); }   // 与真实图集一致：按贴图缓存
  return rect;
};
const materialCache = new Map();
const materialStub = tex => {
  let m = materialCache.get(tex);
  if (m === undefined) { m = (tex.includes('water') || tex.includes('ice')) ? 1 : 0; materialCache.set(tex, m); }
  return m;
};
// 与 app.js 一致的两处关键优化：数字 section 索引 + isOpaque 缓存（否则每次邻居查询都拼字符串/重烘焙）
const sectionIndex = new Map();
const sectionKeyNum = (dim, cx, cy, cz) => (((cx & 0xFFFFF) * 4096) + (cy & 0xFFF)) * 1048576 + (cz & 0xFFFFF);
for (const sec of sections.values()) {
  let byNum = sectionIndex.get(sec.dim);
  if (!byNum) { byNum = new Map(); sectionIndex.set(sec.dim, byNum); }
  byNum.set(sectionKeyNum(sec.dim, sec.cx, sec.cy, sec.cz), sec);
}
const opaqueCache = new Map();
function opaqueOf(id) {
  let cached = opaqueCache.get(id);
  if (cached !== undefined) return cached;
  const info = stateInfo.get(id);
  let opaque = false;
  if (info) {
    const t = baker.bakeState(info.block, info.props);
    opaque = !!(t && t.fullCube && !t.tinted && t.quads.every(q => q.texture !== 'minecraft:block/water_still'));
  }
  opaqueCache.set(id, opaque);
  return opaque;
}

const mesher = createMesher({
  bakeState: (block, props) => baker.bakeState(block, props),
  describe: id => stateInfo.get(id) ?? null,
  isOpaque: opaqueOf,
  blockAt: (dim, x, y, z) => {
    const byNum = sectionIndex.get(dim);
    if (!byNum) return -1;
    const sec = byNum.get(sectionKeyNum(dim, x >> 4, y >> 4, z >> 4));
    return sec ? stateIdAt(sec, x & 15, y & 15, z & 15) : -1;
  },
  uvRect: uvRectStub,
  materialOf: materialStub,
  tintFor,
});

const tMesh = performance.now();
let totalQuads = 0;
let emptySections = 0;
const perSection = [];
let meshError = null;
let outOfBounds = 0;
let boundsExample = '';
for (const [key, sec] of sections) {
  try {
    const mesh = mesher.meshSection(sec);
    perSection.push(mesh.quadCount);
    totalQuads += mesh.quadCount;
    if (mesh.quadCount === 0) emptySections++;
    if (!mesh.positions.every(Number.isFinite)) meshError = `${key} 位置出现 NaN`;
    // 包围盒必须落在本 section 的 16³ 内：缩放/原点错误不改变面数，只断言面数抓不到
    const x0 = sec.cx * 16, y0 = sec.cy * 16, z0 = sec.cz * 16;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const px = mesh.positions[i], py = mesh.positions[i + 1], pz = mesh.positions[i + 2];
      if (px < x0 - 0.01 || px > x0 + 16.01 || py < y0 - 0.01 || py > y0 + 16.01
        || pz < z0 - 0.01 || pz > z0 + 16.01) {
        outOfBounds++;
        if (!boundsExample) {
          // 指名道姓：越界顶点属于哪个方块、是什么方块
          const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
          const sid = stateIdAt(sec, bx & 15, by & 15, bz & 15);
          const info = stateInfo.get(sid);
          boundsExample = `${key}: 顶点 (${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)}) 越界`
            + `，期望 x∈[${x0}, ${x0 + 16}] y∈[${y0}, ${y0 + 16}] z∈[${z0}, ${z0 + 16}]`
            + `；方块 ${info ? `${info.block}[${info.props}]` : `stateId=${sid} (无描述符)`} @ (${bx}, ${by}, ${bz})`;
        }
      }
    }
  } catch (e) {
    meshError = `${key} 网格化异常: ${e.message}`;
    break;
  }
}
const tMeshMs = performance.now() - tMesh;
perSection.sort((a, b) => a - b);

console.log(`\n网格化 ${sections.size} 个 section：总 ${totalQuads} 面，空段 ${emptySections}，用时 ${tMeshMs.toFixed(0)} ms`);
console.log(`  顶点包围盒越界 ${outOfBounds} 个${boundsExample ? '  首例 ' + boundsExample : ''}`);
if (perSection.length) {
  console.log(`  每段面数 最小 ${perSection[0]} / 中位 ${perSection[Math.floor(perSection.length / 2)]} / 最大 ${perSection[perSection.length - 1]}`);
}

// ---------------------------------------------------------------- 6) 结论
const problems = [];
if (sections.size === 0) problems.push('没收到任何 section（订阅或数据流有问题）');
if (stateInfo.size === 0) problems.push('没有拿到任何描述符（/api/blockstates 有问题）');
if (bakedStates === 0) problems.push('没有任何状态被烘出几何');
if (missingTextures.length) problems.push(`${missingTextures.length} 张贴图在磁盘上缺失（浏览器里会显示洋红）`);
if (totalQuads === 0) problems.push('总面数为 0（烘焙路径确实画不出东西）');
if (meshError) problems.push(meshError);
if (outOfBounds > 0) problems.push(`${outOfBounds} 个顶点超出所属 section 的 16³ 包围盒（几何缩放/原点错误）`);
console.log('\n=== 结果 ===');
if (problems.length) {
  console.log('发现问题:');
  for (const p of problems) console.log('  - ' + p);
  process.exitCode = 1;
} else {
  console.log('数据通路正常：烘焙 + 网格化都产出了几何，问题不在数据侧');
}
