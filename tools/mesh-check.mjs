// mesher 回归：用合成 section + 真实烘焙模板，断言面剔除与顶点数据的精确数量。
// 不需要起服务器：stateId 与方块名的映射由脚本自己提供（mesher 本身与 id 无关）。
// 用法：node tools/mesh-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createBaker } from '../common/src/main/resources/assets/what_guys_doing/web/baker.js';
import { createMesher, MATERIAL_SOLID, MATERIAL_TRANSLUCENT, stateIdAt } from '../common/src/main/resources/assets/what_guys_doing/web/mesher.js';

const CONTENT = process.env.WGD_ASSET_DIR
  || path.join('neoforge', 'run', 'config', 'what_guys_doing', 'assets', 'content', 'minecraft');

const jsonCache = new Map();
function readJson(rel) {
  const key = rel.replace(/^minecraft\//, '');
  if (jsonCache.has(key)) return jsonCache.get(key);
  let value = null;
  try { value = JSON.parse(fs.readFileSync(path.join(CONTENT, key), 'utf8')); } catch { value = null; }
  jsonCache.set(key, value);
  return value;
}

const baker = createBaker({ readJson });

// ---------------------------------------------------------------- 合成 section
// stateId 表（与真实注册表无关，只用于本脚本）
const STATES = [
  null,                                                     // 0 = 空气
  { block: 'minecraft:stone', props: '' },                   // 1
  { block: 'minecraft:oak_stairs', props: 'facing=north,half=bottom,shape=straight,waterlogged=false' }, // 2
  { block: 'minecraft:oak_slab', props: 'type=bottom,waterlogged=false' },  // 3
  { block: 'minecraft:oak_fence', props: 'east=false,north=false,south=false,waterlogged=false,west=false' }, // 4
  { block: 'minecraft:oak_leaves', props: 'distance=7,persistent=false,waterlogged=false' }, // 5
  { block: 'minecraft:water', props: 'level=0' },            // 6
  { block: 'minecraft:oak_log', props: 'axis=y' },           // 7
];
const ID = { AIR: 0, STONE: 1, STAIRS: 2, SLAB: 3, FENCE: 4, LEAVES: 5, WATER: 6, LOG: 7 };
const OPAQUE = new Set([ID.STONE, ID.LOG]);

const idxOf = (x, y, z) => (y << 8) | (z << 4) | x;

function makeSection({ fill } = {}) {
  const ids = new Int32Array(4096);
  if (fill) fill(ids);
  // 建 palette + 位流
  const palette = [];
  const slotOf = new Map();
  const slots = new Int32Array(4096);
  for (let i = 0; i < 4096; i++) {
    const id = ids[i];
    let slot = slotOf.get(id);
    if (slot === undefined) {
      slot = palette.length;
      slotOf.set(id, slot);
      palette.push(id);
    }
    slots[i] = slot;
  }
  const bits = palette.length <= 1 ? 0 : Math.max(1, 32 - Math.clz32(palette.length - 1));
  const indices = new Uint8Array(bits === 0 ? 0 : Math.ceil((4096 * bits) / 8));
  for (let i = 0; i < 4096; i++) {
    const value = slots[i];
    const base = i * bits;
    for (let b = 0; b < bits; b++) {
      if (((value >>> b) & 1) !== 0) {
        const p = base + b;
        indices[p >> 3] |= 1 << (p & 7);
      }
    }
  }
  const blockLight = new Uint8Array(2048);
  const skyLight = new Uint8Array(2048);
  skyLight.fill(0xFF);          // 全天空光 15
  const biomes = new Int32Array(256);
  return { dim: 0, cx: 0, cy: 0, cz: 0, palette, bits, indices, blockLight, skyLight, biomes };
}

// ---------------------------------------------------------------- 注入给 mesher 的 IO
let atlasTiles = new Map();
function uvRectFor(texture) {
  if (!atlasTiles.has(texture)) {
    const n = atlasTiles.size;
    const cols = 32;
    atlasTiles.set(texture, [0, 0, 1 / cols, 1 / cols]);   // 仅用于回归：不关心真实排布
  }
  return atlasTiles.get(texture);
}

// blockAt 要能查「当前正在网格化的 section」与**额外的相邻段**，这样跨段剔除才被测到。
// 以前段外一律返回 -1，于是"跨 section 边界查邻居"这条计划要求从未被验证。
let currentSection = null;
let extraSections = [];
function blockAt(dim, worldX, worldY, worldZ) {
  void dim;
  const candidates = currentSection ? [currentSection, ...extraSections] : extraSections;
  for (const sec of candidates) {
    const lx = worldX - (sec.cx << 4);
    const ly = worldY - (sec.cy << 4);
    const lz = worldZ - (sec.cz << 4);
    if (lx < 0 || lx > 15 || ly < 0 || ly > 15 || lz < 0 || lz > 15) continue;
    return stateIdAt(sec, lx, ly, lz);
  }
  return -1;
}

const mesher = createMesher({
  bakeState: (block, props) => baker.bakeState(block, props),
  describe: id => STATES[id] ?? null,
  isOpaque: id => OPAQUE.has(id),
  blockAt,
  uvRect: uvRectFor,
  materialOf: texture => (texture.includes('water') ? MATERIAL_TRANSLUCENT : MATERIAL_SOLID),
  tintFor: block => (block.includes('grass') ? [0.57, 0.74, 0.35] : null),
});

function mesh(section) {
  currentSection = section;
  try {
    return mesher.meshSection(section);
  } finally {
    currentSection = null;
  }
}

// ---------------------------------------------------------------- 断言
const failures = [];
const assert = (cond, message) => { if (!cond) failures.push(message); };

console.log('=== 用例 1：两层石头（16×16×2）===');
{
  const section = makeSection({ fill: ids => {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        ids[idxOf(x, 0, z)] = ID.STONE;
        ids[idxOf(x, 1, z)] = ID.STONE;
      }
    }
  } });
  const before = mesher.stats().culled;
  const meshResult = mesh(section);
  const culled = mesher.stats().culled - before;
  // 两层实心石头：总 2×256×6 = 3072
  // 隐藏面 = 内部垂直面（每层 x/z 相邻各 240 对、每对 2 面 → 每层 960，两层 1920）
  //        + 层间顶/底（各 256 → 512）= 2432 → 可见 640
  console.log(`  四边形 ${meshResult.quadCount}（剔除 ${culled}），顶点 ${meshResult.vertexCount}`);
  assert(meshResult.quadCount === 640, `期望 640 个可见四边形（3072-2432），实得 ${meshResult.quadCount}`);
  assert(culled === 2432, `期望剔除 2432 个面，实得 ${culled}`);
  assert(meshResult.vertexCount === meshResult.quadCount * 4, '顶点数应为四边形数 × 4');
  assert(meshResult.indices.length + meshResult.indicesTranslucent.length === meshResult.quadCount * 6,
    '索引总数应为四边形数 × 6');
  assert(meshResult.positions.every(Number.isFinite), '位置出现 NaN/Infinity');
  assert(meshResult.uvs.every(Number.isFinite), 'uv 出现 NaN/Infinity');
  assert(meshResult.lights.every(v => v >= 0 && v <= 1), 'light 应在 0..1');
  assert(Math.abs(meshResult.lights[0] - 1) < 1e-6, `天空光 15 应归一为 1，实得 ${meshResult.lights[0]}`);
  assert(meshResult.quadsPerMaterial[MATERIAL_SOLID] === meshResult.quadCount, '石头应全部落在不透明材质组');
}

console.log('\n=== 用例 2：石头地板上放楼梯/半砖/栅栏/树叶/水/原木 ===');
{
  const section = makeSection({ fill: ids => {
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) ids[idxOf(x, 0, z)] = ID.STONE;
    ids[idxOf(0, 1, 0)] = ID.STAIRS;
    ids[idxOf(1, 1, 0)] = ID.SLAB;
    ids[idxOf(2, 1, 0)] = ID.FENCE;
    ids[idxOf(3, 1, 0)] = ID.LEAVES;
    ids[idxOf(4, 1, 0)] = ID.WATER;
    ids[idxOf(5, 1, 0)] = ID.LOG;
  } });
  const result = mesh(section);
  const solids = result.quadsPerMaterial[MATERIAL_SOLID];
  const translucent = result.quadsPerMaterial[MATERIAL_TRANSLUCENT];
  // 单层石头：总 1536 面；隐藏 = 内部垂直面 960 + 被不透明方块（原木）压住的顶面 1 = 961 → 可见 575
  // 装饰：stairs 10（底面被石头剔除）+ slab 5 + fence 5 + leaves 5 + log 5 + water 0 = 30
  // 合计 605
  console.log(`  四边形 ${result.quadCount}（不透明 ${solids} / 半透明 ${translucent}），顶点 ${result.vertexCount}`);
  assert(result.quadCount === 605, `期望 605 个可见四边形（575 + 30），实得 ${result.quadCount}`);
  assert(result.positions.every(Number.isFinite), '位置出现 NaN/Infinity');

  console.log('  逐方块（单独网格化，模板面数对比）:');
  for (const [id, name] of [[ID.STAIRS, 'stairs'], [ID.SLAB, 'slab'], [ID.FENCE, 'fence'],
    [ID.LEAVES, 'leaves'], [ID.WATER, 'water'], [ID.LOG, 'log']]) {
    const single = makeSection({ fill: ids => { ids[idxOf(8, 8, 8)] = id; } });
    const meshResult = mesh(single);
    const template = baker.bakeState(STATES[id].block, STATES[id].props);
    const templateQuads = template ? template.quads.length : 0;
    console.log(`    ${name.padEnd(7)} 网格 ${String(meshResult.quadCount).padStart(2)} 面 / 模板 ${templateQuads} 面`);
    assert(meshResult.quadCount === templateQuads, `${name} 单独网格化面数应与模板一致`);
  }
  // 流体在 vanilla 里没有 block 几何（模型只有 particle，由流体渲染器绘制）
  const waterOnly = makeSection({ fill: ids => { ids[idxOf(8, 8, 8)] = ID.WATER; } });
  assert(mesh(waterOnly).quadCount === 0, '水应无 block 几何（vanilla 流体由流体渲染器绘制，M1 已知简化）');
  // cutout（树叶）与不透明同组
  const leavesOnly = makeSection({ fill: ids => { ids[idxOf(8, 8, 8)] = ID.LEAVES; } });
  assert(mesh(leavesOnly).quadsPerMaterial[MATERIAL_SOLID] === 6, '树叶（cutout）应落在不透明材质组');
}

console.log('\n=== 用例 3：整段网格化耗时 ===');
{
  const section = makeSection({ fill: ids => {
    for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      ids[idxOf(x, y, z)] = y === 0 ? ID.STONE : (y === 1 ? ID.LEAVES : ID.AIR);
    }
  } });
  const runs = 30;
  const t0 = performance.now();
  let quads = 0;
  for (let i = 0; i < runs; i++) quads += mesh(section).quadCount;
  const elapsed = performance.now() - t0;
  console.log(`  ${runs} 次（每次约 ${(quads / runs).toFixed(0)} 面）：${elapsed.toFixed(0)} ms → ${(elapsed / runs).toFixed(2)} ms/section`);
}

console.log('\n=== 用例：增量 overrides 优先于压缩数据（放置/破坏方块）===');
{
  // 这条守的是"交互为什么看不到"那个 bug：mesher 读 indices+palette，
  // 而增量以前写在 section.ids 上，两条路永远碰不到。
  const section = makeSection({ fill: ids => { ids[idxOf(1, 2, 3)] = ID.AIR; } });
  const before = stateIdAt(section, 1, 2, 3);
  section.overrides = new Map([[(2 << 8) | (3 << 4) | 1, ID.STONE]]);
  const after = stateIdAt(section, 1, 2, 3);
  assert(before !== ID.STONE, `前置条件失败：覆盖前就是石头（${before}）`);
  assert(after === ID.STONE, `override 未生效：${before} -> ${after}`);
  const quadCount = mesh(section).quadCount;
  assert(quadCount > 0, `写入 override 后没有生成几何（${quadCount} 面）`);
  console.log(`  stateIdAt: ${before} -> ${after}，网格面数 ${quadCount}`);
}

console.log('\n=== 用例：跨 section 边界的面剔除（计划明确要求）===');
{
  const a = makeSection({ fill: ids => { ids[idxOf(15, 8, 8)] = ID.STONE; } });
  a.cx = 0; a.cy = 0; a.cz = 0; a.dim = 0;
  const b = makeSection({ fill: ids => { ids[idxOf(0, 8, 8)] = ID.STONE; } });
  b.cx = 1; b.cy = 0; b.cz = 0; b.dim = 0;

  // 对照组：没有邻居段时，单个石头必须是 6 面
  extraSections = [];
  const alone = mesh(a).quadCount;
  assert(alone === 6, `对照组失败：孤立石头应为 6 面，实得 ${alone}`);

  // 跨段：a 的方块 +x 面贴着 b 的方块 -x 面 → 两面都应被剔除 → 各 5 面
  extraSections = [b];
  const aWithNeighbor = mesh(a).quadCount;
  extraSections = [a];
  const bWithNeighbor = mesh(b).quadCount;
  extraSections = [];
  console.log(`  孤立 ${alone} 面；贴邻段后 a=${aWithNeighbor} / b=${bWithNeighbor}（期望都 5）`);
  assert(aWithNeighbor === 5, `跨段剔除失败：a 应 5 面，实得 ${aWithNeighbor}`);
  assert(bWithNeighbor === 5, `跨段剔除失败：b 应 5 面，实得 ${bWithNeighbor}`);

  // 增量放到边界上：b 单看 6 面；给 a 的边界位置加 override 后，b 的贴合面必须消失 → 5 面
  const aAir = makeSection({ fill: ids => { ids[idxOf(15, 8, 8)] = ID.AIR; } });
  aAir.cx = 0; aAir.cy = 0; aAir.cz = 0; aAir.dim = 0;
  extraSections = [aAir];
  const bBefore = mesh(b).quadCount;
  aAir.overrides = new Map([[(8 << 8) | (8 << 4) | 15, ID.STONE]]);
  const bAfter = mesh(b).quadCount;
  extraSections = [];
  console.log(`  b 在邻居 override 前后：${bBefore} → ${bAfter}（期望 6 → 5）`);
  assert(bBefore === 6, `前置条件失败：b 单独应 6 面，实得 ${bBefore}`);
  assert(bAfter === 5, `增量未影响邻居剔除：应 5 面，实得 ${bAfter}`);
}

console.log('\n=== 结果 ===');
const stats = mesher.stats();
console.log(`  累计：section ${stats.sections}，块 ${stats.blocks}，面 ${stats.quads}，剔除 ${stats.culled}，无模板 ${stats.noTemplate}`);
if (failures.length) {
  console.log(`FAILED: ${failures.length} 项`);
  for (const f of failures) console.log('  ' + f);
  process.exitCode = 1;
} else {
  console.log('ALL PASSED');
}
