// WhatGuysDoing M0 调试查看器：只验证数据通道（方块实例 + 实体标记），不是最终渲染器。
// M1b 起新增烘焙路径：原版 blockstate/model → 几何模板 → 图集 → 每 section 网格。
import { createBaker } from './baker.js';
import { createMesher, stateIdAt, lightAt, MATERIAL_TRANSLUCENT } from './mesher.js';
import { buildAtlas, ALPHA_OPAQUE, assignTileSlots } from './atlas.js';
import { tintFor } from './tint.js';
import { MSG, C_SUBSCRIBE, C_PING, ENTITY_FLAG, Reader } from './protocol.js';
import { createCamera, applyLook, moveCamera, buildViewProj, frustumPlanes, aabbInFrustum } from './camera.js';
import { createDiag, heapMB } from './diag.js';
import { createMeshPool, INDEX_BYTES, estimatePoolCapacity, clampCapsToBytes } from './vertexpool.js';
import { VERTEX_STRIDE, VERTEX_ATTRIBUTES, interleaveMesh } from './vertexformat.js';
import { entityPartsFor, entityTexturePaths } from './entitymodel.js';
import { buildEntityAtlas } from './entityatlas.js';
import { buildEntityMesh } from './entitymesh.js';
import { buildEntityPartTemplates, buildEntityPartInstances } from './entityrender.js';

// 崩溃取证：把现场持续写进 localStorage，标签页崩掉后重开页面仍能读到上次的错误与心跳
const diag = createDiag();
diag.install(window);

// ---- 实体（M2）：bundle 是预生成的模型集合，一次取全；类型键按需补取 ----
let entityBundle = null;
const entityTypeKeys = new Map();     // typeId -> "minecraft:pig"
const entityTypePending = new Set();  // 待取键的 typeId
const entityPartsCache = new Map();   // typeKey -> { parts, quads } | null
let lastEntityTypesFetch = 0;

// 方块增量观测：用来区分"服务端没发"与"客户端收不到/不重网格"
let deltaMessages = 0;
let deltaBlocks = 0;
let deltaDropped = 0;      // 收到但对应段不在本地（订阅范围外 / 已卸载）
let lastDeltaAt = 0;
/** 交互（放置/破坏）引起的重网格：必须插到积压队列前面，否则要等好几秒才可见。 */
const priorityDirty = new Set();
/** 满方块却被判为"不遮挡"的状态数 —— 用于确认服务端的 canOcclude() 标志是否真的生效。 */
let opaqueMisses = 0;
/** 第一个"满方块却不遮挡"的方块名 —— 用来判断是正常的（玻璃/树叶）还是标志没生效（草方块）。 */
let firstOpaqueMiss = '';

fetch('/api/entity-bundle')
  .then(r => (r.ok ? r.json() : null))
  .then(json => {
    entityBundle = json;
    console.log('[WhatGuysDoing] entity bundle', json && json.generatedFrom);
    queueEntityAtlasBuild('bundle');
  })
  .catch(e => console.warn('[WhatGuysDoing] entity bundle failed', e));

/** 类型键补取：一次 ≤128 个 id，失败就留到下次（不阻塞渲染）。 */
async function refreshEntityTypes() {
  if (!entityBundle || entityTypePending.size === 0) return;
  const ids = [...entityTypePending].filter(id => !entityTypeKeys.has(id));
  entityTypePending.clear();
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 128) {
    try {
      const res = await fetch(`/api/entity-types?ids=${ids.slice(i, i + 128).join(',')}`);
      if (!res.ok) continue;
      for (const line of (await res.text()).split('\n')) {
        if (!line.trim()) continue;
        const [id, key] = line.split('\t');
        if (key && key !== '?') entityTypeKeys.set(Number(id), key);
      }
    } catch {
      // 下一轮再试
    }
  }
}

// 构建标记：HUD 上可见，用来确认浏览器跑的就是当前这份代码（排查"改了没变化"的第一件事）
const BUILD_TAG = 'uv104';

const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FLOATS_PER_INSTANCE = 7;
// 兜底路径（烘焙未就绪时）每帧都要把实例数据传上 GPU：600000 × 28B = 16.8 MB/帧 ≈ 1 GB/s，
// 实测把 fps 压到 17 并出现 766ms 超长帧。降到 15 万（4.2 MB/帧）并按距离裁剪，保证近处地形优先。
const MAX_INSTANCES = 150000;

const state = {
  dims: new Map(),
  playerTypeId: -1,
  tick: 0,
  gameTime: 0,
  sections: new Map(),
  sectionIndex: new Map(),   // dim -> Map(数字 key -> section)，供邻居查询用（避免每次拼字符串）
  entities: new Map(),
  dirty: new Set(),
  bytesReceived: 0,
  messages: {},
  parseErrors: 0,
  lastParseError: '',
  sectionVersion: 0,   // 段集合变化时自增（用于"按距离排序"的缓存失效）
};

// ---------------------------------------------------------------- section 数字索引
const sectionKeyNum = (cx, cy, cz) => (((cx & 0xFFFFF) * 4096) + (cy & 0xFFF)) * 1048576 + (cz & 0xFFFFF);

function indexSection(section) {
  let byNum = state.sectionIndex.get(section.dim);
  if (!byNum) {
    byNum = new Map();
    state.sectionIndex.set(section.dim, byNum);
  }
  byNum.set(sectionKeyNum(section.cx, section.cy, section.cz), section);
}

function unindexChunk(dim, cx, cz) {
  const byNum = state.sectionIndex.get(dim);
  if (!byNum) return;
  for (const [key, section] of byNum) {
    if (section.cx === cx && section.cz === cz) byNum.delete(key);
  }
}

function sectionAt(dim, x, y, z) {
  const byNum = state.sectionIndex.get(dim);
  if (!byNum) return null;
  return byNum.get(sectionKeyNum(x >> 4, y >> 4, z >> 4)) ?? null;
}

const sectionKey = (dim, cx, cy, cz) => `${dim}:${cx}:${cy}:${cz}`;

// ---------------------------------------------------------------- 消息处理
function handleMessage(buffer) {
  state.bytesReceived += buffer.byteLength;
  const r = new Reader(buffer);
  const type = r.u8();
  state.messages[type] = (state.messages[type] || 0) + 1;

  switch (type) {
    case MSG.HELLO: {
      r.u32();
      r.u32();
      state.playerTypeId = r.u16();
      const count = r.u16();
      for (let i = 0; i < count; i++) {
        const id = r.u8();
        const name = r.utf();
        const minSectionY = r.i32();
        const sectionCount = r.i32();
        state.dims.set(id, { name, minSectionY, sectionCount });
      }
      break;
    }
    case MSG.SECTION_FULL: {
      const dim = r.u8(), cx = r.i32(), cy = r.i32(), cz = r.i32();
      const paletteSize = r.u16();
      const palette = new Int32Array(paletteSize);
      for (let i = 0; i < paletteSize; i++) palette[i] = r.u32();
      const bits = r.u8();
      const indexBytes = bits === 0 ? 0 : Math.ceil((4096 * bits) / 8);
      const indices = r.bytes(indexBytes).slice();
      const blockLight = r.bytes(2048).slice();
      const skyLight = r.bytes(2048).slice();
      const biomes = new Int32Array(256);
      for (let i = 0; i < 256; i++) biomes[i] = r.u16();
      const key = sectionKey(dim, cx, cy, cz);
      const section = { key, dim, cx, cy, cz, palette, bits, indices, blockLight, skyLight, biomes, ids: null, instances: null, count: 0 };
      state.sections.set(key, section);
      state.sectionVersion++;
      indexSection(section);
      state.dirty.add(key);
      // 邻居的存在会改变本段边界面的光照采样与遮挡判定：把**已经网格化过**的邻居标脏重网格。
      // 否则邻居缺席时烘进去的（回退采样的）光照会永久留着 —— 表现为"常驻暗面"。
      // 只标已网格化的邻居，所以流式加载期间几乎不增加工作量。
      for (const d of NEIGHBORS) {
        const neighborKey = sectionKey(dim, cx + d[0], cy + d[1], cz + d[2]);
        if (baked.sections.has(neighborKey)) state.dirty.add(neighborKey);
      }
      for (const id of palette) baked.pendingIds.add(id);
      break;
    }
    case MSG.BLOCK_DELTA: {
      r.u32();
      const count = r.u16();
      deltaMessages++;
      deltaBlocks += count;
      lastDeltaAt = performance.now();
      for (let i = 0; i < count; i++) {
        const dim = r.u8(), x = r.i32(), y = r.i32(), z = r.i32(), stateId = r.u32();
        const key = sectionKey(dim, x >> 4, y >> 4, z >> 4);
        const sec = state.sections.get(key);
        if (!sec) { deltaDropped++; continue; }
        const idx = (((y & 15) << 8) | ((z & 15) << 4) | (x & 15));
        // 关键：mesher 读的是 indices+palette，不是 ids。增量必须写进 overrides
        // 才会被重网格看到 —— 否则只有整段重发（刷新页面）才生效。
        if (!sec.overrides) sec.overrides = new Map();
        sec.overrides.set(idx, stateId);
        // 交互改动必须插队：普通 dirty 是插入序，落在 300+ 积压队尾要等好几秒
        priorityDirty.add(key);
        state.dirty.add(key);
        // 贴边改动会改变**相邻段**的可见性与光照：只重网格自己这一段，
        // 邻居那边"本该剔除的面"会留着、光照也不会更新（表现为边缘出现多余/残留的面）。
        const edge = { x: (x & 15) === 0 ? -1 : ((x & 15) === 15 ? 1 : 0),
                       y: (y & 15) === 0 ? -1 : ((y & 15) === 15 ? 1 : 0),
                       z: (z & 15) === 0 ? -1 : ((z & 15) === 15 ? 1 : 0) };
        if (edge.x || edge.y || edge.z) {
          for (const d of NEIGHBORS) {
            if ((d[0] && d[0] !== edge.x) || (d[1] && d[1] !== edge.y) || (d[2] && d[2] !== edge.z)) continue;
            const neighborKey = sectionKey(dim, (x >> 4) + d[0], (y >> 4) + d[1], (z >> 4) + d[2]);
            if (state.sections.has(neighborKey)) {
              priorityDirty.add(neighborKey);
              state.dirty.add(neighborKey);
            }
          }
        }
      }
      break;
    }
    case MSG.CHUNK_UNLOAD: {
      const dim = r.u8(), cx = r.i32(), cz = r.i32();
      for (const [key, sec] of state.sections) {
        if (sec.dim === dim && sec.cx === cx && sec.cz === cz) {
          state.sections.delete(key);
          state.sectionVersion++;
          // 以前这里只删数据不删 GPU 网格 → 缓冲泄漏（destroy 才是真正释放显存）
          removeSectionMesh(key);
        }
      }
      unindexChunk(dim, cx, cz);
      break;
    }
    case MSG.ENTITY: {
      state.tick = r.u32();
      const removed = r.u16();
      for (let i = 0; i < removed; i++) state.entities.delete(r.varUInt());
      const count = r.u16();
      for (let i = 0; i < count; i++) {
        const netId = r.varUInt();
        const typeId = r.u16();
        const dimId = r.u8();               // v2：维度随记录走
        const mask = r.u32();               // v2：掩码加宽到 u32
        const e = state.entities.get(netId) || { netId, x: 0, y: 0, z: 0, yaw: 0, flags: 0, equipment: 0, leatherColors: [0, 0, 0, 0], health: 0 };
        e.netId = netId;
        e.typeId = typeId;
        e.dimId = dimId;
        entityTypePending.add(typeId);
        if (mask & ENTITY_FLAG.POS) { e.x = r.fixed(512); e.y = r.fixed(512); e.z = r.fixed(512); }
        if (mask & ENTITY_FLAG.MOTION) { r.fixed(512); r.fixed(512); r.fixed(512); }
        if (mask & ENTITY_FLAG.ROT) { e.yaw = r.angle(); e.pitch = r.angleSigned(); }
        if (mask & ENTITY_FLAG.HEAD_ROT) e.headYaw = r.angle();
        if (mask & ENTITY_FLAG.FLAGS) e.flags = r.u16();
        if (mask & ENTITY_FLAG.HEALTH) e.health = r.u16() / 10;
        if (mask & ENTITY_FLAG.POSE) e.pose = r.u8();
        if (mask & ENTITY_FLAG.VEHICLE) r.varUInt();
        if (mask & ENTITY_FLAG.ITEM) r.varUInt();
        if (mask & ENTITY_FLAG.PLAYER) { e.slot = r.u8(); e.gameMode = r.u8(); }
        // ---- v2：读取顺序必须与 EntityDeltaCodec 的写入顺序完全一致 ----
        if (mask & ENTITY_FLAG.VARIANT) e.variantBits = r.u32();
        if (mask & ENTITY_FLAG.ANIM) { e.limbSwing = r.u8(); e.swingProgress = r.u8(); }
        if (mask & ENTITY_FLAG.NAME) { e.nameVisible = r.u8() !== 0; e.name = r.utf(); }
        if (mask & ENTITY_FLAG.PLAYER_UUID) {
          const hi = r.u64();
          const lo = r.u64();
          e.uuid = (hi === 0 && lo === 0) ? null
            : `${hi.toString(16).padStart(16, '0')}${lo.toString(16).padStart(16, '0')}`;
        }
        if (mask & ENTITY_FLAG.EQUIP) e.equipment = r.u16();
        if (mask & ENTITY_FLAG.TINT) {
          e.leatherColors = [r.u32(), r.u32(), r.u32(), r.u32()];
        }
        state.entities.set(netId, e);
        entityDirty = true;
      }
      break;
    }
    case MSG.TIME_SYNC:
      state.tick = r.u32();
      state.gameTime = r.u64();
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------- 几何重建
function decodeSection(sec) {
  const ids = new Int32Array(4096);
  const light = new Uint8Array(4096);
  const { palette, bits, indices, blockLight, skyLight } = sec;
  for (let i = 0; i < 4096; i++) {
    let slot = 0;
    if (bits === 0) {
      slot = 0;
    } else {
      const base = i * bits;
      let v = 0;
      for (let b = 0; b < bits; b++) {
        const p = base + b;
        v |= ((indices[p >> 3] >> (p & 7)) & 1) << b;
      }
      slot = v;
    }
    ids[i] = palette[slot] ?? 0;
    const bl = blockLight[i >> 1], sl = skyLight[i >> 1];
    light[i] = Math.max((i & 1) === 0 ? bl & 15 : bl >> 4, (i & 1) === 0 ? sl & 15 : sl >> 4);
  }
  sec.ids = ids;
  sec.light = light;
}

function colorFor(id, light) {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  const r = ((h >> 16) & 0xff) / 255, g = ((h >> 8) & 0xff) / 255, b = (h & 0xff) / 255;
  const l = 0.28 + 0.72 * (light / 15);
  return [r * l, g * l, b * l];
}

function rebuildSection(sec) {
  if (!sec.ids) decodeSection(sec);
  const ids = sec.ids, light = sec.light;
  const baseX = sec.cx << 4, baseY = sec.cy << 4, baseZ = sec.cz << 4;
  const out = [];
  for (let i = 0; i < 4096; i++) {
    const id = ids[i];
    if (id === 0) continue;
    const x = i & 15, z = (i >> 4) & 15, y = (i >> 8) & 15;
    let exposed = false;
    for (let n = 0; n < 6; n++) {
      const nx = x + NEIGHBORS[n][0], ny = y + NEIGHBORS[n][1], nz = z + NEIGHBORS[n][2];
      if (nx < 0 || nx > 15 || ny < 0 || ny > 15 || nz < 0 || nz > 15) { exposed = true; break; }
      if (ids[(ny << 8) | (nz << 4) | nx] === 0) { exposed = true; break; }
    }
    if (!exposed) continue;
    const [r, g, b] = colorFor(id, light[i]);
    out.push(baseX + x + 0.5, baseY + y + 0.5, baseZ + z + 0.5, r, g, b, 1.0);
  }
  sec.instances = new Float32Array(out);
  sec.count = out.length / FLOATS_PER_INSTANCE;
}

let instanceData = new Float32Array(4096 * FLOATS_PER_INSTANCE);
let instanceCount = 0;
let instanceTruncated = false;

// 兜底路径按「到相机的距离」取最近的段。
// Map 的迭代顺序与距离无关，撞上限时会被随机截断（实测撞到 60 万上限后 fps 只剩 17）。
let orderedSections = [];
let orderedVersion = -1;
let orderedChunk = -1;

function sectionsNearestCamera() {
  const ccx = camera.x >> 4, ccy = camera.y >> 4, ccz = camera.z >> 4;
  const chunkKey = ((((ccx & 0xFFFFF) * 4096) + (ccy & 0xFFF)) * 1048576) + (ccz & 0xFFFFF);
  if (state.sectionVersion === orderedVersion && chunkKey === orderedChunk) return orderedSections;
  const distances = [];
  for (const section of state.sections.values()) {
    const dx = section.cx - ccx, dy = section.cy - ccy, dz = section.cz - ccz;
    distances.push([dx * dx + dy * dy + dz * dz, section]);
  }
  distances.sort((a, b) => a[0] - b[0]);
  orderedSections = distances.map(pair => pair[1]);
  orderedVersion = state.sectionVersion;
  orderedChunk = chunkKey;
  return orderedSections;
}

function rebuildInstances(dirtyBudget) {
  const useBaked = baked.ready && baked.enabled;
  if (!useBaked) {
    let budget = dirtyBudget;
    for (const key of Array.from(state.dirty)) {
      if (budget-- <= 0) break;
      state.dirty.delete(key);
      const sec = state.sections.get(key);
      if (sec) rebuildSection(sec);
    }
  }
  // 拼接方块实例 + 实体标记（烘焙路径下地形交给 section 网格，这里只留实体标记）
  const entityCount = state.entities.size;
  // 给实体标记留位置：否则撞上限时先被砍掉的恰好是实体（实体数量少但最不该丢）
  const sectionBudget = Math.max(0, MAX_INSTANCES - Math.min(entityCount, MAX_INSTANCES));
  let wanted = entityCount;
  if (!useBaked) {
    for (const sec of state.sections.values()) wanted += sec.count;
  }
  instanceTruncated = wanted > MAX_INSTANCES;
  const total = Math.min(wanted, MAX_INSTANCES);
  if (instanceData.length < total * FLOATS_PER_INSTANCE) {
    instanceData = new Float32Array(total * FLOATS_PER_INSTANCE);
  }
  let o = 0;
  if (!useBaked) {
    for (const sec of sectionsNearestCamera()) {
      const src = sec.instances;
      if (!src) continue;
      for (let i = 0; i < src.length && o < sectionBudget; i += FLOATS_PER_INSTANCE) {
        instanceData.set(src.subarray(i, i + FLOATS_PER_INSTANCE), o * FLOATS_PER_INSTANCE);
        o++;
      }
      if (o >= sectionBudget) break;
    }
  }
  for (const e of state.entities.values()) {
    if (o >= total) break;
    const isPlayer = e.typeId === state.playerTypeId;
    const isHostile = (e.flags & 0x10) !== 0;
    // 实体已经走 entitybundle 的真实几何；玩家现在也有默认 Steve 模型，
    // 不再画黄色/淡蓝色占位；敌对标记保留用于缺模型定位。
    if (isPlayer || !isHostile) continue;
    const color = [1.0, 0.35, 0.2];
    const b = o * FLOATS_PER_INSTANCE;
    instanceData[b] = e.x; instanceData[b + 1] = e.y + 1.0; instanceData[b + 2] = e.z;
    instanceData[b + 3] = color[0]; instanceData[b + 4] = color[1]; instanceData[b + 5] = color[2];
    instanceData[b + 6] = 0.86;
    o++;
  }
  instanceCount = o;
  return true;
}

// ---------------------------------------------------------------- 相机
// 相机数学全在 camera.js（DOM-free，有 tools/camera-check.mjs 逐条断言方向语义）
const camera = createCamera({ x: 8, y: 80, z: 8, yaw: 200, pitch: -25, speed: 24 });
const keys = new Set();
let camInitialized = false;

// ---------------------------------------------------------------- WebGPU
const CUBE = (() => {
  const v = [];
  const faces = [
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
    [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
    [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
  ];
  for (const [, q] of faces) {
    for (const t of [[0, 1, 2], [0, 2, 3]]) {
      for (const i of t) v.push(q[i][0] * 0.5, q[i][1] * 0.5, q[i][2] * 0.5);
    }
  }
  return new Float32Array(v);
})();

const wgsl = `
struct Uniforms { viewProj: mat4x4f };
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSOut { @builtin(position) pos: vec4f, @location(0) color: vec3f };

@vertex
fn vs(@location(0) corner: vec3f, @location(1) ipos: vec3f, @location(2) icolor: vec3f, @location(3) iscale: f32) -> VSOut {
  var out: VSOut;
  let world = ipos + corner * iscale;
  out.pos = u.viewProj * vec4f(world, 1.0);
  out.color = icolor;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  return vec4f(in.color, 1.0);
}
`;

const gpu = { device: null, context: null, pipeline: null, uniform: null, bind: null, cube: null, instances: null, capacity: 0, depth: null, format: null, uniformData: new Float32Array(16) };

async function initWebGPU() {
  if (!navigator.gpu) throw new Error('此浏览器不支持 WebGPU');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('无法获取 GPU 适配器');
  // 请求适配器允许的最大单缓冲字节数：默认上限 256 MB，而"半径 8 的顶点池"在 24 B/顶点时约 285 MB，
  // 会直接创建失败（Buffer size exceeds the max buffer size limit）。适配器通常支持更大，直接要到位。
  const limits = {};
  if (adapter.limits && adapter.limits.maxBufferSize) limits.maxBufferSize = adapter.limits.maxBufferSize;
  gpu.device = await adapter.requestDevice({ requiredLimits: limits });
  diag.event('log', `device maxBufferSize=${Math.round((gpu.device.limits.maxBufferSize || 0) / 1048576)}MB`);
  diag.attachDevice(gpu.device);
  // 未捕获的 WebGPU 校验错误不会抛异常，只会静默丢命令 —— 必须显式接出来，否则表现为「画面空白但无报错」
  let lastDeviceError = '';
  gpu.device.onuncapturederror = event => {
    // 只记**第一条**：后续错误往往只是"第一条的连带"（如 Invalid CommandBuffer due to a previous error），
    // 覆盖掉第一条会把真正的病因藏起来。
    const text = String(event.error && event.error.message ? event.error.message : event.error);
    if (!lastDeviceError) lastDeviceError = text;
    console.error('[WhatGuysDoing] WebGPU 错误：', event.error);
  };
  gpu.lastDeviceError = () => lastDeviceError;
  // 设备丢失是"页面卡死/黑屏"最常见的技术形态：记下来并在 HUD 上明示
  gpu.device.lost.then(info => {
    lastDeviceLost = `${info.reason}: ${info.message || ''}`;
    diag.event('devicelost', lastDeviceLost);
  });
  const canvas = document.getElementById('c');
  gpu.context = canvas.getContext('webgpu');
  gpu.format = navigator.gpu.getPreferredCanvasFormat();
  gpu.context.configure({ device: gpu.device, format: gpu.format, alphaMode: 'opaque' });

  const module = gpu.device.createShaderModule({ code: wgsl });
  gpu.pipeline = gpu.device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vs',
      buffers: [
        { arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
        {
          arrayStride: FLOATS_PER_INSTANCE * 4, stepMode: 'instance',
          attributes: [
            { shaderLocation: 1, offset: 0, format: 'float32x3' },
            { shaderLocation: 2, offset: 12, format: 'float32x3' },
            { shaderLocation: 3, offset: 24, format: 'float32' },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: 'fs', targets: [{ format: gpu.format }] },
    // 背面剔除：mesher 的索引顺序（0,1,2 / 0,2,3）让几何法线朝**内**，
    // 实测（用户验证）必须配 frontFace: 'cw' —— 从外面看得见的那面在屏幕上是顺时针。
    // 之前是 'none'：站在方块内部会看到它的内壁（用户报的现象）。
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'cw' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });

  gpu.uniform = gpu.device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  gpu.bind = gpu.device.createBindGroup({
    layout: gpu.pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: gpu.uniform } }],
  });
  gpu.cube = gpu.device.createBuffer({ size: CUBE.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  gpu.device.queue.writeBuffer(gpu.cube, 0, CUBE);
  rebuildPoolBuffers();   // 共享顶点/索引池：每帧状态切换 5 次而不是每段 5 次
}

function ensureInstanceBuffer(count) {
  if (count <= gpu.capacity) return;
  if (gpu.instances) gpu.instances.destroy();
  gpu.capacity = Math.max(1024, count * 2);
  gpu.instances = gpu.device.createBuffer({
    size: gpu.capacity * FLOATS_PER_INSTANCE * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
}

function frame() {
  const canvas = document.getElementById('c');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    if (gpu.depth) gpu.depth.destroy();
    gpu.depth = gpu.device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  }

  rebuildInstances(6);
  ensureInstanceBuffer(Math.max(1, instanceCount));
  if (instanceCount > 0) {
    gpu.device.queue.writeBuffer(gpu.instances, 0, instanceData, 0, instanceCount * FLOATS_PER_INSTANCE);
  }
  const vp = buildViewProj(camera, w / h);
  gpu.uniformData.set(vp);
  gpu.device.queue.writeBuffer(gpu.uniform, 0, gpu.uniformData);

  // 注意：网格化会 createBuffer / writeBuffer，必须在 render pass 之外做
  // （在 pass 进行中写缓冲是 WebGPU 校验错误，会静默失败、画面空白且不抛异常）
  if (baked.ready && baked.enabled) {
    // 首次铺满世界前没有 fps 可保护（此时页面还在用兜底方块实例渲染，本来就只有十几帧），
    // 所以放开预算：2016 段 × 5.4ms 按 6ms/帧摊是 ~30 秒，按 20ms/帧约 ~9 秒。
    meshDirtySections(firstCoverageDone ? 6 : 20);
    if (!firstCoverageDone && state.dirty.size === 0) {
      firstCoverageDone = true;
      diag.event('log', 'first coverage done');
    }
  }

  const encoder = gpu.device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: gpu.context.getCurrentTexture().createView(),
      clearValue: { r: 0.043, g: 0.051, b: 0.071, a: 1 },
      loadOp: 'clear', storeOp: 'store',
    }],
    depthStencilAttachment: {
      view: gpu.depth.createView(), depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store',
    },
  });
  if (baked.ready && baked.enabled) {
    try {
      drawBaked(pass);
      drawEntities(pass);
    } catch (e) {
      baked.error = e && e.message ? e.message : String(e);
      baked.enabled = false;
      console.error('[WhatGuysDoing] 烘焙渲染失败，回退方块实例渲染：', e);
    }
  }
  if (instanceCount > 0) {
    // 烘焙路径下实例缓冲里只有实体标记；否则是地形实例 + 实体标记
    pass.setPipeline(gpu.pipeline);
    pass.setBindGroup(0, gpu.bind);
    pass.setVertexBuffer(0, gpu.cube);
    pass.setVertexBuffer(1, gpu.instances);
    pass.draw(36, instanceCount);
  }
  pass.end();
  gpu.device.queue.submit([encoder.finish()]);
}

// ================================================================ M1b 烘焙路径
// 资源包就绪后：取模型包 → 按调色板取 stateId 描述符 → 烘焙 → 建图集 → 每 section 网格化。
const baked = {
  enabled: true,
  ready: false,
  error: null,
  initStarted: false,
  stateInfo: new Map(),        // stateId -> { block, props }
  pendingIds: new Set(),       // 待取描述符的 stateId
  baker: null,
  mesher: null,
  atlas: null,
  entityAtlas: null,
  entityAtlasAssetState: null,
  pipelineSolid: null,
  pipelineTranslucent: null,
  entityPartPipeline: null,
  bindGroup: null,
  atlasBindGroup: null,
  sections: new Map(),         // key -> { buffers, solidIndexCount, translucentIndexCount }
  opaqueCache: new Map(),      // stateId -> bool
  stats: { initMs: 0, states: 0, tiles: 0, missingTextures: 0, meshed: 0, quads: 0, meshMs: 0, entityTiles: 0, entityMissing: 0 },
};

const ENTITY_PART_WGSL = `
struct Uniforms { viewProj: mat4x4f };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(1) @binding(0) var atlasTex: texture_2d<f32>;
@group(1) @binding(1) var atlasSampler: sampler;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
};

@vertex
fn vs(
  @location(0) position: vec3f,
  @location(1) uv: vec2f,
  @location(2) m0: vec4f,
  @location(3) m1: vec4f,
  @location(4) m2: vec4f,
  @location(5) m3: vec4f,
  @location(6) color: vec4f,
) -> VSOut {
  var out: VSOut;
  let m = mat4x4f(m0, m1, m2, m3);
  out.pos = u.viewProj * m * vec4f(position, 1.0);
  out.uv = uv;
  out.color = color.rgb;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let texel = textureSample(atlasTex, atlasSampler, in.uv);
  if (texel.a < 0.5) { discard; }
  return vec4f(texel.rgb * in.color, 1.0);
}
`;

const BAKED_WGSL = `
struct Uniforms { viewProj: mat4x4f };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(1) @binding(0) var atlasTex: texture_2d<f32>;
@group(1) @binding(1) var atlasSampler: sampler;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) light: f32,
  @location(3) ao: f32,     // 传给片元的是标量；顶点**输入**是 unorm8x2（见 vs 的 vec2f）
};

@vertex
fn vs(@location(0) position: vec3f, @location(1) uv: vec2f, @location(2) packed: vec4f, @location(3) ao: vec2f) -> VSOut {
  var out: VSOut;
  out.pos = u.viewProj * vec4f(position, 1.0);
  out.uv = uv;
  out.color = packed.rgb;   // 染色（unorm8 量化后仍是 0..1）
  out.light = packed.a;     // 光照与染色同挤在一个 unorm8x4 里（8 位格式没有 x3）
  out.ao = ao.x;
  return out;
}

@fragment
fn fsSolid(in: VSOut) -> @location(0) vec4f {
  let texel = textureSample(atlasTex, atlasSampler, in.uv);
  if (texel.a < 0.5) { discard; }
  // 环境底噪 0.25（而非 vanilla 的 0.12）：观察器要让暗处仍看得清形状，
  // 这也是 BlueMap 里 ambientLight 那个常数的同一作用。再乘逐角 AO（0.55..1）。
  let brightness = (0.25 + 0.75 * in.light) * in.ao;
  return vec4f(texel.rgb * in.color * brightness, 1.0);
}

@fragment
fn fsTranslucent(in: VSOut) -> @location(0) vec4f {
  let texel = textureSample(atlasTex, atlasSampler, in.uv);
  if (texel.a < 0.02) { discard; }
  let brightness = (0.25 + 0.75 * in.light) * in.ao;
  return vec4f(texel.rgb * in.color * brightness, texel.a);
}
`;

async function initBaked() {
  baked.initStarted = true;
  try {
    const t0 = performance.now();
    const bundle = await (await fetch('/api/models-bundle')).json();
    // 烘焙器的 readJson 是同步的：模型包一次取全，键为 `blockstates/x.json` 形式
    const baker = createBaker({ readJson: rel => bundle[rel.replace(/^minecraft\//, '')] ?? null });
    baked.baker = baker;

    await refreshDescriptors();
    if (baked.stateInfo.size === 0) {
      // 资产走缓存命中时，资产状态轮询会远早于区块到达就触发这里 —— 此时没有任何描述符，
      // 若继续下去就会用「0 张贴图」建出空图集并置 ready：此后 mesher 拿着空图集，
      // 每个四边形都查不到贴图（实测 1,056,559 次），表现为"一开始丢贴图就永远丢"。
      // 交回给轮询重试，等区块与描述符真正到齐再初始化。
      baked.initStarted = false;
      diag.event('log', 'initBaked deferred: no descriptors yet');
      console.log('[WhatGuysDoing] 尚无区块描述符，烘焙路径稍后重试');
      return;
    }
    for (const info of baked.stateInfo.values()) baker.bakeState(info.block, info.props);

    await queueAtlasBuild();
    createBakedPipelines();

    baked.stats.initMs = Math.round(performance.now() - t0);
    baked.stats.states = baked.stateInfo.size;
    baked.ready = true;
    for (const key of state.sections.keys()) state.dirty.add(key);
    console.log('[WhatGuysDoing] 烘焙路径就绪', baked.stats, baked.atlas.stats);
    queueEntityAtlasBuild('baked ready');
  } catch (e) {
    baked.error = e && e.message ? e.message : String(e);
    baked.enabled = false;
    console.error('[WhatGuysDoing] 烘焙路径初始化失败，回退方块实例渲染：', e);
  }
}

async function fetchTextureBitmap(path) {
  const url = `/assets/minecraft/textures/${path.replace(/^minecraft:/, '')}.png`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return createImageBitmap(await response.blob());
}

/** 实体贴图的路径已经带 `textures/…png`，与方块路径的拼接规则不同。 */
async function fetchEntityTextureBitmap(ref) {
  let url;
  if (ref.startsWith('wgd:skins/')) {
    url = `/assets/skins/${ref.slice('wgd:skins/'.length)}`;
  } else if (ref.startsWith('wgd:capes/')) {
    url = `/assets/capes/${ref.slice('wgd:capes/'.length)}`;
  } else {
    url = `/assets/minecraft/${ref.replace(/^minecraft:/, '')}`;
  }
  const response = await fetch(url);
  if (!response.ok) return null;
  const bitmap = await createImageBitmap(await response.blob());
  const model = response.headers.get('x-skin-model');
  return ref.startsWith('wgd:skins/') ? { bitmap, model: model || 'wide' } : bitmap;
}

/**
 * 实体图集：一次性构建（贴图集合来自静态 bundle）。仍挂在 atlasBuildChain 上，
 * 避免与方块图集的重建并发时各自创建/销毁 GPU 纹理。
 */
let entityAtlasBuild = null;
function queueEntityAtlasBuild(reason, options = {}) {
  if (!entityBundle || !gpu || !gpu.device) return Promise.resolve(null);
  if (baked.entityAtlas && !options.force) return Promise.resolve(baked.entityAtlas);
  if (entityAtlasBuild) return entityAtlasBuild;

  entityAtlasBuild = atlasBuildChain.then(async () => {
    const paths = entityTexturePaths(entityBundle, [...playerSkinPaths(), ...playerCapePaths()]);
    if (!paths.length) return null;
    // 在构建**开始时**记下资产状态：若抽取恰好在这几秒内完成，这一代仍是缺贴图的，必须再重建一次。
    const assetStateAtStart = assetStatus ? assetStatus.state : 'unknown';
    const previous = baked.entityAtlas;
    const atlas = await buildEntityAtlas(gpu.device, paths, { fetchTexture: fetchEntityTextureBitmap });
    baked.entityAtlas = atlas;
    baked.entityAtlasAssetState = assetStateAtStart;
    baked.stats.entityTiles = atlas.stats.tiles;
    baked.stats.entityMissing = atlas.stats.missing;
    console.log('[WhatGuysDoing] 实体图集就绪', reason, atlas.stats);
    diag.event('log', `entity atlas (${reason}) ${atlas.width}×${atlas.height}: `
      + `${atlas.stats.tiles} tiles, ${atlas.stats.missing} missing`);
    // 新图集接好前不销毁旧的（M3 的 bind group 会一直引用当前这张）
    if (previous) previous.texture.destroy();
    return atlas;
  }).catch(e => {
    console.warn('[WhatGuysDoing] 实体图集构建失败：', e);
    diag.event('error', 'entity atlas: ' + (e && e.message ? e.message : String(e)));
    return null;
  }).finally(() => {
    entityAtlasBuild = null;
  });

  atlasBuildChain = entityAtlasBuild;
  return entityAtlasBuild;
}

/** 用当前烘焙器引用到的贴图重建图集，并接好 bind group 与 mesher。 */
async function buildAndAttachAtlas() {
  const baker = baked.baker;
  // 槽位来自**持久顺序表**（只追加、跨重建不变）：槽位进了 uv，一旦重排，已建网格就会指到别的贴图。
  const paths = assignTileSlots(atlasOrder, baker.texturesUsed());
  const atlas = await buildAtlas(gpu.device, paths.keys(), { fetchTexture: fetchTextureBitmap });
  // 换图集就作废旧的"首个矩形"记录：否则诊断里会把上一代图集的矩形和这一代网格的 uv 混在一行，
  // 看起来自相矛盾（值会像旧公式的 8.0，而网格 uv 实际是合法的）。
  // 图集尺寸变化会让**所有**已建网格的 uv 失效（uv 按尺寸归一化）。容量已量化成台阶，
  // 所以只有跨台阶时才需要一次性全量重网格；其余重建都是非破坏性的（槽位只追加）。
  const previousAtlas = baked.atlas;
  const sizeChanged = previousAtlas && (previousAtlas.width !== atlas.width || previousAtlas.height !== atlas.height);
  baked.atlas = atlas;
  atlasGeneration++;
  // 诊断随图集换代一起作废：下一次网格化会按当前图集重新记录，保证那一行永远自洽
  firstUvRect = '';
  uvRectBad = 0;
  uvDiag = '';
  uvRaw = '';
  baked.stats.tiles = atlas.stats.tiles;
  if (atlas.stats.tiles === 0) {
    // 空图集是"全屏洋红"的根源，且事后很难从画面上判断，必须留证
    diag.event('error', 'atlas built with 0 tiles (baker had no states?)');
  }
  baked.stats.missingTextures = atlas.missing.length;
  baked.opaqueCache.clear();

  baked.mesher = createMesher({
    bakeState: (block, props) => baker.bakeState(block, props),
    describe: id => baked.stateInfo.get(id) ?? null,
    isOpaque: isOpaqueState,
    blockAt: bakedBlockAt,
    // 按世界坐标取光照（跨 section）：段内最高一层的方块顶面需要读上方段的空气光照，
    // 取不到（相邻段未加载）返回 null，由 mesher 自行回退。
    lightAt: (dim, wx, wy, wz) => {
      const s = sectionAt(dim, wx, wy, wz);
      return s ? lightAt(s, wx & 15, wy & 15, wz & 15) : null;
    },
    // 记录 mesher 实际拿到的第一个矩形；同时标记"本次网格化有没有未命中贴图"。
    // 未命中的段在画面上是洋红，必须在图集重建后重新网格化 —— 否则它会一直洋红下去
    //（图集重建有 1.2 秒防抖，窗口内网格化的段就会踩到"贴图还没进图集"）。
    uvRect: path => {
      const rect = atlas.uvRect(path);
      if (atlas.hasTexture(path) === false) uvMissedThisMesh = true;
      // 盲区修补：以前只检查 mesher **输出**的 uv（全部在界内），输入矩形本身没人查。
      // 这里直接查输入侧：越界或反向（u0>u1 / v0>v1）都记一次，并留下原始槽位。
      if (rect && (rect[0] < 0 || rect[1] < 0 || rect[2] > 1 || rect[3] > 1
        || rect[2] < rect[0] || rect[3] < rect[1])) {
        uvRectBad++;
        if (!firstUvRect) {
          const tile = atlas.tileOf ? atlas.tileOf(path) : null;
          firstUvRect = `${path.replace('minecraft:', '')}=[${rect.map(v => v.toFixed(4)).join(', ')}]`
            + ` 槽位=${tile ? `${tile.x},${tile.y}` : '无'}`
            + ` 图集=${atlas.width}×${atlas.height}`;
        }
      }
      return rect;
    },
    materialOf: path => atlas.materialOf(path),
    tintFor: (block, tintIndex, biomeId) => tintFor(block, tintIndex, biomeId),
  });

  if (baked.pipelineSolid) {
    baked.atlasBindGroup = gpu.device.createBindGroup({
      layout: baked.pipelineSolid.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: atlas.texture.createView() },
        { binding: 1, resource: atlas.sampler },
      ],
    });
  }
  // 新图集完全接好之后再释放旧的
  if (previousAtlas) previousAtlas.texture.destroy();
  if (sizeChanged) {
    // 跨容量台阶：所有已建网格的 uv 都过期了，必须全量重网格一次（此后又是非破坏性的）
    diag.event('log', `atlas size changed ${previousAtlas.width}×${previousAtlas.height} → ${atlas.width}×${atlas.height}, remesh all`);
    for (const key of state.sections.keys()) state.dirty.add(key);
    firstCoverageDone = false;
  }
}

/**
 * 图集构建串行化。
 *
 * 竞态：`rebuildAtlasNow()` 是 async 但按键处不 await —— 连按 R、或在 initBaked 进行中按 R，
 * 会让两次构建并发：各自 `destroy` 对方的纹理，最后用「已销毁的纹理」建 bind group。
 * 这类竞态天生表现为"概率性"故障，必须串起来。
 */
let atlasBuildChain = Promise.resolve();
function queueAtlasBuild() {
  atlasBuildChain = atlasBuildChain.then(() => buildAndAttachAtlas()).catch(e => {
    baked.error = e && e.message ? e.message : String(e);
    baked.enabled = false;
    console.error('[WhatGuysDoing] 图集构建失败：', e);
    diag.event('error', 'atlas build: ' + (e && e.message ? e.message : String(e)));
  });
  return atlasBuildChain;
}

/** 出现图集里没有的贴图时（新方块类型）自动重建图集 */
let descriptorBusy = false;
let atlasRebuildTimer = null;

/**
 * 贴图引用变多后自动重建图集。
 *
 * 因为 `stableTileOrder` 保证"只追加、不挪位"，重建是**非破坏性**的：旧瓦片位置不变，
 * 已建网格的 uv 依然有效 —— 所以这里**不再把全部段标脏**（以前那样做，重建后要 10–30 秒才追平，
 * 期间旧网格指着新图集里移位后的瓦片，于是出现"草方块变钻石块"）。
 */
function scheduleAtlasRebuild(reason) {
  if (atlasRebuildTimer) return;
  atlasRebuildTimer = setTimeout(async () => {
    atlasRebuildTimer = null;
    if (!baked.ready) return;
    diag.event('log', `atlas auto-rebuild: ${reason}`);
    try {
      await queueAtlasBuild();
      // 图集重建的防抖窗口里网格化的段会踩到"贴图还没进图集"（洋红）；重建后只重网格这些段
      if (pendingRemesh.size) {
        diag.event('log', `remesh ${pendingRemesh.size} sections referencing new textures`);
        for (const key of pendingRemesh) state.dirty.add(key);
        pendingRemesh.clear();
      }
    } catch (e) {
      diag.event('error', 'atlas auto-rebuild: ' + (e && e.message ? e.message : String(e)));
    }
  }, 1200);
}
async function refreshDescriptorsIfNeeded() {
  if (descriptorBusy || !baked.ready || baked.pendingIds.size === 0) return;
  descriptorBusy = true;
  try {
    const fresh = await refreshDescriptors();
    if (fresh.length) {
      for (const info of baked.stateInfo.values()) baked.baker.bakeState(info.block, info.props);
      // 只把「含新描述符的段」标脏。
      // 以前是无差别把全部段标脏：2016 段 × ~5ms ≈ 10 秒主线程满载，
      // 每来一批新方块类型就重演一次 —— 表现为页面长时间无响应（很可能被当成"崩溃"）。
      const freshSet = new Set(fresh);
      let touched = 0;
      for (const [key, section] of state.sections) {
        for (const id of section.palette) {
          if (freshSet.has(id)) {
            state.dirty.add(key);
            touched++;
            break;
          }
        }
      }
      diag.event('log', `descriptors +${fresh.length}, remesh ${touched}/${state.sections.size} sections`);
      // 新描述符会引用新贴图 → 图集必须跟着长。以前只提示"按 R 重建图集"：
      // 一旦图集是空建出来的（见 initBaked 的 defer 分支），就会一直烂下去。
      const usedNow = baked.baker.texturesUsed().length;
      if (baked.atlas && usedNow > baked.atlas.stats.tiles) {
        scheduleAtlasRebuild(`贴图引用 ${baked.atlas.stats.tiles} -> ${usedNow}`);
      }
    }
  } catch (e) {
    console.warn('[WhatGuysDoing] 描述符补取失败', e);
  } finally {
    descriptorBusy = false;
  }
}

/** 按需补取 stateId 描述符（每次 ≤128 个，避免 URL 过长）。返回本次新增的 id 列表。 */
async function refreshDescriptors() {
  const ids = [...baked.pendingIds].filter(id => !baked.stateInfo.has(id));
  baked.pendingIds.clear();
  const fresh = [];
  if (!ids.length) return fresh;
  let added = 0;
  for (let i = 0; i < ids.length; i += 128) {
    const chunk = ids.slice(i, i + 128);
    const response = await fetch(`/api/blockstates?ids=${chunk.join(',')}`);
    if (!response.ok) continue;
    for (const line of (await response.text()).split('\n')) {
      if (!line.trim()) continue;
      const [id, block, props, occludes] = line.split('\t');
      if (block && block !== '?') {
        baked.stateInfo.set(Number(id), { block, props: props ?? '', occludes: occludes === '1' });
        fresh.push(Number(id));
        added++;
      }
    }
  }
  return fresh;
}

function bakedBlockAt(dim, x, y, z) {
  const section = sectionAt(dim, x, y, z);
  return section ? stateIdAt(section, x & 15, y & 15, z & 15) : -1;
}

/** 满方块 + 全部贴图无透明像素 → 真能遮挡邻居的面 */
function isOpaqueState(id) {
  let cached = baked.opaqueCache.get(id);
  if (cached !== undefined) return cached;
  let opaque = false;
  const info = baked.stateInfo.get(id);
  if (info && baked.baker && baked.atlas) {
    const template = baked.baker.bakeState(info.block, info.props);
    if (template && template.fullCube) {
      // 服务端的 canOcclude() 是权威答案。以前用"所有贴图都不透明"猜：
      // 草方块有一层 cutout 覆盖贴图 → 被误判成不遮挡 → 相邻草方块之间的面全部不剔除。
      opaque = info.occludes !== undefined
        ? info.occludes
        : template.quads.every(q => baked.atlas.alphaMode(q.texture) === ALPHA_OPAQUE);
      if (!opaque) {
        opaqueMisses++;     // 满方块却不遮挡：玻璃/树叶属正常，草方块属异常
        if (!firstOpaqueMiss) firstOpaqueMiss = `${info.block}[${info.props}] occludes=${info.occludes}`;
      }
    }
  }
  baked.opaqueCache.set(id, opaque);
  return opaque;
}

function createBakedPipelines() {
  const device = gpu.device;
  const module = device.createShaderModule({ code: BAKED_WGSL });
  const vertex = {
    module,
    entryPoint: 'vs',
    // 单一交错缓冲，20 B/顶点（格式表来自 vertexformat.js，运行时与回归共用一份，避免布局漂移）
    buffers: [{ arrayStride: VERTEX_STRIDE, attributes: VERTEX_ATTRIBUTES }],
  };
  baked.pipelineSolid = device.createRenderPipeline({
    layout: 'auto',
    vertex,
    // 背面剔除：mesher 的索引顺序（0,1,2 / 0,2,3）让几何法线朝**内**，
    // 实测（用户验证）必须配 frontFace: 'cw' —— 从外面看得见的那面在屏幕上是顺时针。
    // 之前是 'none'：站在方块内部会看到它的内壁（用户报的现象）。
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'cw' },
    fragment: { module, entryPoint: 'fsSolid', targets: [{ format: gpu.format }] },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });
  baked.pipelineTranslucent = device.createRenderPipeline({
    layout: 'auto',
    vertex,
    // 背面剔除：mesher 的索引顺序（0,1,2 / 0,2,3）让几何法线朝**内**，
    // 实测（用户验证）必须配 frontFace: 'cw' —— 从外面看得见的那面在屏幕上是顺时针。
    // 之前是 'none'：站在方块内部会看到它的内壁（用户报的现象）。
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'cw' },
    fragment: {
      module,
      entryPoint: 'fsTranslucent',
      targets: [{
        format: gpu.format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }],
    },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
  });
  baked.bindGroup = device.createBindGroup({
    layout: baked.pipelineSolid.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: gpu.uniform } }],
  });
  baked.atlasBindGroup = device.createBindGroup({
    layout: baked.pipelineSolid.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: baked.atlas.texture.createView() },
      { binding: 1, resource: baked.atlas.sampler },
    ],
  });

  // M3a：实体 per-part 实例化管线（顶点 position/uv + per-instance mat4）
  try {
    const entityModule = device.createShaderModule({ code: ENTITY_PART_WGSL });
    baked.entityPartPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: entityModule,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 20,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x2' },
            ],
          },
          {
            arrayStride: 80,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 2, offset: 0, format: 'float32x4' },
              { shaderLocation: 3, offset: 16, format: 'float32x4' },
              { shaderLocation: 4, offset: 32, format: 'float32x4' },
              { shaderLocation: 5, offset: 48, format: 'float32x4' },
              { shaderLocation: 6, offset: 64, format: 'float32x4' },
            ],
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'cw' },
      fragment: { module: entityModule, entryPoint: 'fs', targets: [{ format: gpu.format }] },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    baked.entityPartBindGroup0 = device.createBindGroup({
      layout: baked.entityPartPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: gpu.uniform } }],
    });
  } catch (e) {
    baked.entityPartPipeline = null;
    console.warn('[WhatGuysDoing] entity part pipeline 创建失败，回退整只 mesh:', e);
  }
}

/** 每帧只做时间预算内的若干个 section（实测每段数毫秒，必须限时，否则主线程会卡住）。 */
function meshDirtySections(msBudget) {
  if (!baked.ready) return;
  const started = performance.now();
  const deadline = started + msBudget;
  let done = 0;
  // 交互改动（priorityDirty）排在积压队列前面：普通 dirty 是插入序，
  // 落在 300+ 段积压队尾时要等好几秒，玩家会以为"没反应"。
  const queue = [...new Set([...priorityDirty, ...state.dirty])];
  for (const key of queue) {
    if (done >= 8 || performance.now() > deadline) break;
    priorityDirty.delete(key);
    const section = state.sections.get(key);
    if (!section) {
      state.dirty.delete(key);
      removeSectionMesh(key);
      continue;
    }
    let described = true;
    for (const id of section.palette) {
      if (!baked.stateInfo.has(id)) {
        baked.pendingIds.add(id);
        described = false;
      }
    }
    done++;
    if (!described) continue;      // 描述符到齐后再网格化（fetchStatus 会重新标脏）
    state.dirty.delete(key);
    try {
      uvMissedThisMesh = false;
      const mesh = baked.mesher.meshSection(section);
      // 这次网格化踩到"贴图还没进图集" → 画面是洋红，等图集重建后必须重网格这一段
      if (uvMissedThisMesh) pendingRemesh.add(section.key);
      uploadSectionMesh(section, mesh);
    } catch (e) {
      console.error('[WhatGuysDoing] 网格化失败', key, e);
      state.dirty.delete(key);
    }
  }
  baked.stats.meshMs = Math.round(performance.now() - started);
}

let pool = createMeshPool();
let poolBuffers = [];   // [positions, uvs, tints, lights, index]

/** 按当前池容量创建/重建 GPU 缓冲。扩容或整理后调用；随后全部段重新网格化。 */
function rebuildPoolBuffers() {
  const device = gpu.device;
  for (const buffer of poolBuffers) buffer.destroy();
  poolBuffers = pool.vertexBufferBytes().map(size =>
    device.createBuffer({ size: Math.max(4, size), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }));
  poolBuffers.push(device.createBuffer({
    size: Math.max(4, pool.indexBufferBytes()),
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  }));
  // 整池重建：旧发号全部作废
  baked.sections.clear();
  bakedGpuBytes = pool.vertexBufferBytes().reduce((n, b) => n + b, 0) + pool.indexBufferBytes();
  for (const key of state.sections.keys()) state.dirty.add(key);
  firstCoverageDone = false;   // 重回"首次铺满"阶段，允许放宽网格预算
}

const ZERO_INDICES = new Uint32Array(4096);
/** 上传期异常计数：NaN 会被 unorm 量化成 0 → 表现为"纯黑的不透明面"，必须能看见 */
const uploadAnomalies = { nanValues: 0, zeroTints: 0, zeroLights: 0 };
/** 本次网格化是否踩到"贴图还没进图集"；踩到的段要在图集重建后重网格。 */
let uvMissedThisMesh = false;
/** 待重网格的洋红段（键）。 */
const pendingRemesh = new Set();
/** 空洞的索引区间清零 → 退化三角形，GPU 侧无害（这样才不用搬运、也不会有残影）。 */
function zeroIndexRange(firstIndex, count) {
  const buffer = poolBuffers[1];
  let done = 0;
  while (done < count) {
    const chunk = Math.min(count - done, ZERO_INDICES.length);
    gpu.device.queue.writeBuffer(buffer, (firstIndex + done) * INDEX_BYTES, ZERO_INDICES, 0, chunk);
    done += chunk;
  }
}

function removeSectionMesh(key) {
  const entry = baked.sections.get(key);
  if (!entry) return;
  for (const [first, count] of pool.free(entry.handle)) zeroIndexRange(first, count);
  baked.sections.delete(key);
}

/**
 * UV 自检（统计式）：只抽一个四边形会被"元素伸出方块"的模型（from/to 可到 −16..32）带偏，
 * 所以这里统计全部面：有多少面的 uv 超出 0..16（vanilla 对这类模型本就"不一致"），
 * 以及最常见的一格瓦片跨度是多少 —— 后者才代表绝大多数普通方块。
 */
function recordUvDiag(key, mesh, quadCount) {
  if (uvDiag) return;
  const spans = new Map();
  let outOfRange = 0;
  let tilesSpan = 0;
  for (let q = 0; q < quadCount; q++) {
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (let i = 0; i < 4; i++) {
      const u = mesh.uvs[q * 8 + i * 2], v = mesh.uvs[q * 8 + i * 2 + 1];
      if (u < uMin) uMin = u; if (u > uMax) uMax = u;
      if (v < vMin) vMin = v; if (v > vMax) vMax = v;
    }
    if (uMin < -1e-6 || uMax > 1 + 1e-6 || vMin < -1e-6 || vMax > 1 + 1e-6) outOfRange++;
    const sk = `${(uMax - uMin).toFixed(4)}×${(vMax - vMin).toFixed(4)}`;
    spans.set(sk, (spans.get(sk) || 0) + 1);
    if (Math.abs((uMax - uMin) - (vMax - vMin)) < 1e-4 && (uMax - uMin) < 0.2) tilesSpan++;
  }
  const top = [...spans.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, n]) => `${k}×${n}面`).join(' ');
  const rawUv = Array.from(mesh.uvs.slice(0, 8)).map(v => v.toFixed(3)).join(',');
  const rawPos = Array.from(mesh.positions.slice(0, 6)).map(v => v.toFixed(2)).join(',');
  const atlasSize = baked.atlas ? `${baked.atlas.width}×${baked.atlas.height}` : '无';
  uvDiag = `uv自检 ${key} ${quadCount}面  越界${outOfRange}  矩形越界${uvRectBad}  常见跨度 ${top}`;
  uvRaw = `原始 uvs[0..7]=${rawUv}　pos[0..5]=${rawPos}　图集 ${atlasSize}（第 ${atlasGeneration} 代）`;
}

function uploadSectionMesh(section, mesh) {
  const key = section.key;
  removeSectionMesh(key);
  recordUvDiag(key, mesh, mesh.quadCount);
  if (!mesh.vertexCount) return;
  const device = gpu.device;

  const handle = pool.allocate(mesh.vertexCount, mesh.indices.length, mesh.indicesTranslucent.length);
  if (!handle) {
    // 池满：按需求右尺寸化（扩容或缩容），然后**必须清空竞技场**再整池重建
    //（否则已用计数不归零，分配永远失败；盲目 ×4 会把显存推到几倍并伴随超长帧）。
    const plan = clampCapsToDevice(pool.planOnFailure());
    diag.event('log', `mesh pool ${plan.action} → 顶点 ${(plan.vertexCapacity / 1024).toFixed(0)}k 索引 ${(plan.solidIndexCapacity / 1024).toFixed(0)}k`);
    pool.resize(plan);
    pool.compact();
    rebuildPoolBuffers();
    state.dirty.add(key);
    return;
  }

  // 4 个顶点流已合并成一块交错缓冲（20 B/顶点），所以每帧只需 1 次 setVertexBuffer
  const queue = device.queue;
  const interleaved = interleaveMesh(mesh);
  queue.writeBuffer(poolBuffers[0], handle.vertexOffset * VERTEX_STRIDE, interleaved.buffer);
  const a = interleaved.anomalies;
  uploadAnomalies.nanValues += a.nanValues;
  uploadAnomalies.zeroTints += a.zeroTints;
  uploadAnomalies.zeroLights += a.zeroLights;
  // 索引加顶点偏移，变成池内绝对号（绘制时 baseVertex=0，任意区段可独立 draw）
  const indexBase = pool.translucentIndexBase();
  if (mesh.indices.length) {
    queue.writeBuffer(poolBuffers[1], handle.solidFirst * INDEX_BYTES, offsetIndices(mesh.indices, handle.vertexOffset));
  }
  if (mesh.indicesTranslucent.length) {
    queue.writeBuffer(poolBuffers[1], (indexBase + handle.translucentFirst) * INDEX_BYTES, offsetIndices(mesh.indicesTranslucent, handle.vertexOffset));
  }

  const ox = section.cx * 16, oy = section.cy * 16, oz = section.cz * 16;
  baked.sections.set(key, {
    handle,
    // 视锥剔除用的世界空间 AABB（16³）
    bounds: [ox, oy, oz, ox + 16, oy + 16, oz + 16],
    // 本段的光照统计：供 HUD 报"相机最近段"的当前状态（累计值看不出"现在"，会骗人）
    zeroLights: a.zeroLights,
    vertexCount: interleaved.count,
    solidIndexCount: mesh.indices.length,
    translucentIndexCount: mesh.indicesTranslucent.length,
  });
  baked.stats.meshed++;
  baked.stats.quads += mesh.quadCount;
}

/** 索引整体加 vertexOffset（返回池内绝对索引）。 */
function offsetIndices(indices, vertexOffset) {
  if (!vertexOffset) return indices;
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) out[i] = indices[i] + vertexOffset;
  return out;
}

let bakedVisible = 0;   // 本帧在视锥内的网格数
let bakedDraws = 0;     // 本帧烘焙路径的 drawIndexed 次数（架构优化看这个数）
const frustum = new Float32Array(24);
const visibleMeshes = [];
const staleMeshes = [];

// ---- 实体绘制（M2）：与地形共用管线与顶点格式，只换 bind group（实体图集）----
let entityVertexBuffer = null;
let entityIndexBuffer = null;
let entityIndexCount = 0;
let entityDrawQuads = 0;
let entityBindGroup = null;
let entityBindAtlas = null;      // bind group 绑定的是哪一代图集（换代要重建）
let entityDirty = true;          // 收到实体快照后置脏
let entitySkipped = 0;
let entityDebugLogged = false;
let entityFirstUv = '-';
/**
 * 对照实验：URL 加 ?blockatlas 时，实体改用**方块图集**绘制。
 * 实体出方块纹理 → 绑定路径没问题，问题在实体图集那张纹理；
 * 实体仍白 → 问题在顶点/采样输入，与纹理无关。
 */
const ENTITY_USE_BLOCK_ATLAS = typeof location !== 'undefined'
  && new URLSearchParams(location.search).has('blockatlas');
/** 默认走 M3a per-part 实例化；?entitymesh 强制回退到整只实体 mesh。 */
const ENTITY_PART_RENDER = typeof location === 'undefined'
  || !new URLSearchParams(location.search).has('entitymesh');

// ---- M3a per-part 实例化资源 ----
let entityPartTemplates = null;
let entityPartAtlas = null;
let entityPartKeyCount = -1;
let entityPartSkinKey = '';
let entityPartSkins = [];
const entityPartBuckets = new Map();
let entityPartAtlasBindGroup = null;
let entityPartDraws = 0;
let entityPartInstanceCount = 0;

function destroyEntityPartResources() {
  for (const bucket of entityPartBuckets.values()) {
    if (bucket.vertexBuffer) bucket.vertexBuffer.destroy();
    if (bucket.indexBuffer) bucket.indexBuffer.destroy();
    if (bucket.instanceBuffer) bucket.instanceBuffer.destroy();
  }
  entityPartBuckets.clear();
  entityPartTemplates = null;
}

function playerSkinEntries() {
  const out = [];
  const seen = new Set();
  for (const e of state.entities.values()) {
    if (e.typeId !== state.playerTypeId || !e.uuid) continue;
    const path = `wgd:skins/${e.uuid}.png`;
    if (seen.has(path)) continue;
    seen.add(path);
    const model = baked.entityAtlas && baked.entityAtlas.skinModels
      ? baked.entityAtlas.skinModels.get(path) || 'wide'
      : 'wide';
    out.push({ path, model, cape: `wgd:capes/${e.uuid}.png` });
  }
  return out;
}

function playerSkinPaths() {
  return playerSkinEntries().map(e => e.path);
}

function playerCapePaths() {
  return playerSkinEntries().map(e => e.cape).filter(Boolean);
}

function ensureEntityPartDraw() {
  if (!baked.ready || !baked.entityAtlas || !entityBundle || !baked.entityPartPipeline) return false;
  const device = gpu.device;
  const skins = playerSkinEntries();
  const skinKey = skins.map(e => e.path + ':' + e.model + ':' + (e.cape || '')).join('|');
  if (skinKey !== entityPartSkinKey) {
    entityPartSkinKey = skinKey;
    entityPartSkins = skins;
    queueEntityAtlasBuild('player skins', { force: true });
  }
  const atlasChanged = entityPartAtlas !== baked.entityAtlas;
  const keysChanged = entityPartKeyCount !== entityTypeKeys.size;
  if (!entityPartTemplates || atlasChanged || keysChanged) {
    destroyEntityPartResources();
    entityPartTemplates = buildEntityPartTemplates(
      entityBundle,
      entityTypeKeys,
      path => baked.entityAtlas.uvRect(path),
      { playerSkins: entityPartSkins, hasTexture: path => baked.entityAtlas.hasTexture(path) },
    );
    entityPartAtlas = baked.entityAtlas;
    entityPartKeyCount = entityTypeKeys.size;
    for (const [typeKey, template] of entityPartTemplates) {
      template.parts.forEach((part, pi) => {
        const vertexBuffer = device.createBuffer({
          size: Math.max(part.vertices.byteLength, 256),
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        const indexBuffer = device.createBuffer({
          size: Math.max(part.indices.byteLength, 256),
          usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(vertexBuffer, 0, part.vertices);
        device.queue.writeBuffer(indexBuffer, 0, part.indices);
        entityPartBuckets.set(`${typeKey}\t${pi}`, {
          template: part, vertexBuffer, indexBuffer,
          instanceBuffer: null, instanceCapacity: 0, count: 0,
        });
      });
    }
  }

  if (!entityPartAtlasBindGroup || atlasChanged) {
    entityPartAtlasBindGroup = device.createBindGroup({
      layout: baked.entityPartPipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: baked.entityAtlas.texture.createView() },
        { binding: 1, resource: baked.entityAtlas.sampler },
      ],
    });
  }

  for (const bucket of entityPartBuckets.values()) bucket.count = 0;
  entityPartInstanceCount = 0;
  const instances = buildEntityPartInstances(
    entityPartTemplates,
    [...state.entities.values()],
    entityTypeKeys,
    performance.now() / 1000,
    {
      skinIndexOf: entity => {
        if (!entity.uuid) return 0;
        const path = `wgd:skins/${entity.uuid}.png`;
        return Math.max(0, entityPartSkins.findIndex(e => e.path === path) + 1);
      },
    },
  );
  for (const [key, data] of instances) {
    const bucket = entityPartBuckets.get(key);
    if (!bucket || !data.count) continue;
    const strideFloats = 20;
    const bytes = data.count * strideFloats * 4;
    if (!bucket.instanceBuffer || bucket.instanceCapacity * strideFloats * 4 < bytes) {
      if (bucket.instanceBuffer) bucket.instanceBuffer.destroy();
      bucket.instanceCapacity = Math.max(data.count, 64);
      bucket.instanceBuffer = device.createBuffer({
        size: bucket.instanceCapacity * strideFloats * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    const packed = new Float32Array(data.count * strideFloats);
    for (let i = 0; i < data.count; i++) {
      packed.set(data.matrices.subarray(i * 16, i * 16 + 16), i * strideFloats);
      packed.set(data.colors.subarray(i * 4, i * 4 + 4), i * strideFloats + 16);
    }
    device.queue.writeBuffer(bucket.instanceBuffer, 0, packed);
    bucket.count = data.count;
    entityPartInstanceCount += data.count;
  }
  return entityPartBuckets.size > 0;
}

function drawEntityPart(pass) {
  if (!ensureEntityPartDraw()) return false;
  pass.setPipeline(baked.entityPartPipeline);
  pass.setBindGroup(0, baked.entityPartBindGroup0);
  pass.setBindGroup(1, entityPartAtlasBindGroup);
  let draws = 0;
  let quads = 0;
  for (const bucket of entityPartBuckets.values()) {
    if (!bucket.count) continue;
    pass.setVertexBuffer(0, bucket.vertexBuffer);
    pass.setVertexBuffer(1, bucket.instanceBuffer);
    pass.setIndexBuffer(bucket.indexBuffer, 'uint32');
    pass.drawIndexed(bucket.template.indexCount, bucket.count);
    draws++;
    quads += bucket.template.quadCount * bucket.count;
  }
  entityPartDraws = draws;
  entityDrawQuads = quads;
  return draws > 0;
}

/** 实体几何有变化时才重建：实体数量少，一次全量重建远比逐实体维护便宜。 */
function ensureEntityDraw() {
  if (!baked.ready || !baked.entityAtlas || !entityBundle || !baked.pipelineSolid) return;
  // 实体图集在启动期会被重建多次（bundle / baked ready / gpu ready / assets ready），
  // 每次都会 destroy 旧纹理。如果此时实体数据没变（entityDirty=false），bind group 就会
  // 一直指向已销毁的纹理 → 采样得到空白（实体全白）。所以图集换代也必须触发重建。
  if (!entityDirty && entityVertexBuffer && entityBindAtlas === baked.entityAtlas) return;
  entityDirty = false;

  const mesh = buildEntityMesh(
    entityBundle,
    [...state.entities.values()],
    entityTypeKeys,
    path => baked.entityAtlas.uvRect(path),
    path => baked.entityAtlas.materialOf(path),
  );
  // 运行时诊断（只打一次）：uvRect 在真实图集上到底返回什么 —— 纯函数测过是对的，
  // 所以若这里为 [0,0,0,0] 或明显不对，就是运行时路径与纯函数不一致。
  if (!entityDebugLogged) {
    entityDebugLogged = true;
    const probe = 'minecraft:textures/entity/pig/pig.png';
    const r = baked.entityAtlas.uvRect(probe);
    const first = mesh.positions.length ? null : null;
    let q0 = null;
    outer:
    for (const e of state.entities.values()) {
      const key = entityTypeKeys.get(e.typeId);
      const info = key ? entityPartsFor(entityBundle, key) : null;
      if (info && info.parts[0] && info.parts[0].quads[0]) { q0 = info.parts[0].quads[0]; break outer; }
    }
    console.log('[WhatGuysDoing] entity uv probe',
      'atlas', baked.entityAtlas.width + 'x' + baked.entityAtlas.height,
      'rect', r && r.map(v => v.toFixed(5)).join(','),
      'quadUV', q0 && q0.verts[0] ? [q0.verts[0][3], q0.verts[0][4]].join(',') : '-',
      'firstVertexUV', mesh.uvs.length ? [mesh.uvs[0].toFixed(5), mesh.uvs[1].toFixed(5)].join(',') : '-',
      void first);
  }
  entitySkipped = mesh.skipped;
  // 记录**这一次真实构建**的第一个顶点 uv（之前的 console 探针跑在实体类型就绪前的空构建上，是假警报）。
  entityFirstUv = mesh.uvs.length
    ? `${mesh.uvs[0].toFixed(4)},${mesh.uvs[1].toFixed(4)}`
    : `空（顶点 ${mesh.vertexCount} 面 ${mesh.quadCount}）`;
  entityDrawQuads = mesh.quadCount;
  entityIndexCount = mesh.indices.length;
  if (!entityIndexCount) { entityVertexBuffer = null; entityIndexBuffer = null; return; }

  const interleaved = interleaveMesh(mesh);
  const device = gpu.device;
  const needVertex = interleaved.buffer.byteLength;
  const needIndex = mesh.indices.byteLength;
  const usageV = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST;
  const usageI = GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST;
  if (!entityVertexBuffer || entityVertexBuffer.size < needVertex) {
    if (entityVertexBuffer) entityVertexBuffer.destroy();
    entityVertexBuffer = device.createBuffer({ size: Math.max(needVertex, 65536), usage: usageV });
  }
  if (!entityIndexBuffer || entityIndexBuffer.size < needIndex) {
    if (entityIndexBuffer) entityIndexBuffer.destroy();
    entityIndexBuffer = device.createBuffer({ size: Math.max(needIndex, 65536), usage: usageI });
  }
  device.queue.writeBuffer(entityVertexBuffer, 0, interleaved.buffer);
  device.queue.writeBuffer(entityIndexBuffer, 0, mesh.indices);

  // 图集换代（R / 资产就绪重建）会让旧的 bind group 指向已销毁的纹理
  if (entityBindGroup == null || entityBindAtlas !== baked.entityAtlas) {
    entityBindGroup = device.createBindGroup({
      layout: baked.pipelineSolid.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: baked.entityAtlas.texture.createView() },
        { binding: 1, resource: baked.entityAtlas.sampler },
      ],
    });
    entityBindAtlas = baked.entityAtlas;
  }
}

/** 在同一个 render pass 里，地形之后追加实体 draw。 */
function drawEntities(pass) {
  if (ENTITY_PART_RENDER) {
    try {
      if (drawEntityPart(pass)) return;
    } catch (e) {
      console.warn('[WhatGuysDoing] entity part draw 失败，回退整只 mesh:', e);
      baked.entityPartPipeline = null;
    }
  }
  ensureEntityDraw();
  if (!entityBindGroup || !entityVertexBuffer || !entityIndexCount) return;
  pass.setPipeline(baked.pipelineSolid);
  pass.setBindGroup(0, baked.bindGroup);
  pass.setBindGroup(1, ENTITY_USE_BLOCK_ATLAS ? baked.atlasBindGroup : entityBindGroup);
  pass.setVertexBuffer(0, entityVertexBuffer);
  pass.setIndexBuffer(entityIndexBuffer, 'uint32');
  pass.drawIndexed(entityIndexCount);
}

function drawBaked(pass) {
  // 与 shader 用同一份 viewProj（gpu.uniformData 就是本帧写的那个），逐 section 做 AABB 视锥剔除。
  // BlueMap 靠 three.js 的逐对象剔除撑住 draw call；我们半径 8 时 2016 段里约六成不在视锥内。
  frustumPlanes(frustum, gpu.uniformData);
  visibleMeshes.length = 0;
  staleMeshes.length = 0;
  for (const [key, entry] of baked.sections) {
    // 段已经不在了（服务端撤销订阅/区块卸载）→ 这个网格是残留：它的池槽位可能已被整理回收，
    // 画出来就是别的几何加别的贴图（用户看到的"纹理错误"）。这里顺手清掉，自愈。
    if (!state.sections.has(key)) { staleMeshes.push(key); continue; }
    const b = entry.bounds;
    if (!aabbInFrustum(frustum, b[0], b[1], b[2], b[3], b[4], b[5])) continue;
    visibleMeshes.push(entry);
  }
  if (staleMeshes.length) {
    for (const key of staleMeshes) removeSectionMesh(key);
    diag.event('log', `pruned ${staleMeshes.length} stale meshes`);
  }
  bakedVisible = visibleMeshes.length;
  bakedDraws = 0;
  if (!visibleMeshes.length || !poolBuffers.length) return;

  // 共享池：每帧状态切换 2 次（1 个交错顶点缓冲 + 1 个索引缓冲），而不是每段 5 次
  pass.setPipeline(baked.pipelineSolid);
  pass.setBindGroup(0, baked.bindGroup);
  pass.setBindGroup(1, baked.atlasBindGroup);
  pass.setVertexBuffer(0, poolBuffers[0]);
  pass.setIndexBuffer(poolBuffers[1], 'uint32');

  // visibleMeshes 天然是分配顺序（Map 插入序 = 分配序），所以相邻区段可直接贪心合并成一次 draw
  const solid = [];
  const translucent = [];
  for (const entry of visibleMeshes) {
    if (entry.solidIndexCount) {
      solid.push({ firstIndex: entry.handle.solidFirst, indexCount: entry.solidIndexCount });
    }
    if (entry.translucentIndexCount) {
      translucent.push({
        firstIndex: pool.translucentIndexBase() + entry.handle.translucentFirst,
        indexCount: entry.translucentIndexCount,
      });
    }
  }
  let draws = 0;
  for (const run of pool.mergeRuns(solid)) { pass.drawIndexed(run.indexCount, 1, run.firstIndex); draws++; }
  if (translucent.length && baked.pipelineTranslucent) {
    pass.setPipeline(baked.pipelineTranslucent);
    pass.setBindGroup(0, baked.bindGroup);
    pass.setBindGroup(1, baked.atlasBindGroup);
    for (const run of pool.mergeRuns(translucent)) { pass.drawIndexed(run.indexCount, 1, run.firstIndex); draws++; }
  }
  bakedDraws = draws;
}

async function rebuildAtlasNow() {
  if (!baked.ready) return;
  try {
    await queueAtlasBuild();
    await queueEntityAtlasBuild('manual', { force: true });
    if (pendingRemesh.size) {
      for (const key of pendingRemesh) state.dirty.add(key);
      pendingRemesh.clear();
    }
    console.log('[WhatGuysDoing] 图集已重建', baked.atlas.stats);
    // R 的语义是"刷新"：图集重建后整片重网格一次，让画面立刻反映当前数据
    for (const key of state.sections.keys()) state.dirty.add(key);
    firstCoverageDone = false;
  } catch (e) {
    baked.error = e && e.message ? e.message : String(e);
    baked.enabled = false;
    console.error('[WhatGuysDoing] 重建图集失败：', e);
  }
}

// ---------------------------------------------------------------- 输入
//
// 鼠标手势接管策略：
//   点击画面 → 请求指针锁定（Pointer Lock），锁定后无需按住按键，移动鼠标即转头，ESC 退出；
//   若锁定被拒绝或不可用，退化为「按住左键拖动」看视角（并 pointer capture，拖出画布也不断）。
let pointerLocked = false;
let dragLook = false;
let lockFailed = false;
let lastX = 0, lastY = 0;
const LOOK_SENSITIVITY = 0.15;

/** G：把诊断现场显示成可选中复制的文本（并尝试写剪贴板）——"导出"必须看得见才算导出。 */
function showDiagnostics(text) {
  let el = document.getElementById('diagview');
  if (!el) {
    el = document.createElement('textarea');
    el.id = 'diagview';
    el.readOnly = true;
    el.style.cssText = 'position:fixed;left:8px;top:8px;width:70%;height:70%;z-index:9;'
      + 'background:#0b0b0b;color:#ddd;font:12px/1.4 monospace;padding:8px;border:1px solid #666';
    document.body.appendChild(el);
  }
  if (el.style.display !== 'none' && el.value) { el.style.display = 'none'; return; }
  el.value = text;
  el.style.display = 'block';
  el.focus();
  el.select();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => { /* 权限问题就手动复制 */ });
  }
}

/** T：把图集内容画到页面上（区分"图集内容错"与"采样错"的最快方式）。连按两次切到实体图集。 */
let atlasViewShowsEntity = false;
function toggleAtlasView() {
  const el = document.getElementById('atlasview');
  if (!el) return;
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  // 第一次显示方块图集；隐藏后再次按 T，切到实体图集（看实体"白模"到底是不是图集内容为空）
  const target = atlasViewShowsEntity ? baked.entityAtlas : baked.atlas;
  if (!target) { el.style.display = 'none'; return; }
  const scale = 1;
  el.width = target.width * scale;
  el.height = target.height * scale;
  target.drawTo(el.getContext('2d'), scale);
  el.style.display = 'block';
  atlasViewShowsEntity = !atlasViewShowsEntity;
}

function bindInput() {
  const canvas = document.getElementById('c');

  // 点击：优先锁定指针；锁定被拒时进入拖拽模式
  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (!pointerLocked && document.pointerLockElement !== canvas) {
      const req = canvas.requestPointerLock({ unadjustedMovement: true });
      // 部分浏览器返回 Promise；失败则走拖拽兜底
      if (req && typeof req.catch === 'function') req.catch(() => startDrag(e));
      dragLook = true;
      lastX = e.clientX;
      lastY = e.clientY;
      return;
    }
    startDrag(e);
  });

  function startDrag(e) {
    dragLook = true;
    lastX = e.clientX;
    lastY = e.clientY;
    if (canvas.setPointerCapture && e.pointerId !== undefined) {
      try { canvas.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
    }
  }

  window.addEventListener('mouseup', () => { dragLook = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
    if (!pointerLocked) dragLook = false;
  });
  document.addEventListener('pointerlockerror', () => {
    pointerLocked = false;
    lockFailed = true;
  });

  // 锁定后：鼠标位移直接转为视角（不需要按键）
  window.addEventListener('mousemove', e => {
    if (pointerLocked) {
      applyLook(camera, e.movementX || 0, e.movementY || 0, LOOK_SENSITIVITY);
      return;
    }
    if (!dragLook) return;
    applyLook(camera, e.clientX - lastX, e.clientY - lastY, LOOK_SENSITIVITY * 1.6);
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === '[') { subscribe(0, 0, Math.max(1, currentRadius - 1)); }
    if (k === ']') { subscribe(0, 0, Math.min(16, currentRadius + 1)); }
    if (k === 'b') {
      baked.enabled = !baked.enabled;
      if (baked.enabled && !baked.ready && !baked.initStarted) initBaked();
      for (const key of state.sections.keys()) state.dirty.add(key);
    }
    if (k === 'r') rebuildAtlasNow();
    if (k === 'g') {
      // 之前只往控制台打，页面上完全看不出来 = 等于没有导出。现在弹可选中文本 + 尝试写剪贴板。
      const dump = diag.dump() + '\n\n现场快照：' + JSON.stringify(snapshot(), null, 2);
      console.log('[WhatGuysDoing] 诊断现场\n' + dump);
      showDiagnostics(dump);
    }
    if (k === 't') toggleAtlasView();
    keys.add(k === ' ' ? ' ' : k);
    if (k === ' ') e.preventDefault();
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase() === ' ' ? ' ' : e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  canvas.addEventListener('wheel', e => {
    camera.speed = Math.max(2, Math.min(400, camera.speed * (e.deltaY > 0 ? 0.85 : 1.18)));
    e.preventDefault();
  }, { passive: false });
}

// ---------------------------------------------------------------- 连接与 HUD
let ws = null;
let currentRadius = 8;

/** 池容量夹到设备允许的单缓冲字节数内（规则在 vertexpool 里，便于回归）。 */
function clampCapsToDevice(caps) {
  const maxBytes = gpu.device && gpu.device.limits ? gpu.device.limits.maxBufferSize : null;
  return clampCapsToBytes(caps, maxBytes);
}

function subscribe(centerX, centerZ, radius) {
  currentRadius = radius;
  // 先按订阅半径预估池容量：订阅时网格已被清空，此刻扩容是"免费"的；
  // 否则会在流式加载到一半时扩容（销毁+申请几百 MB + 全量重网格）→ 界面卡死。
  const estimate = clampCapsToDevice(estimatePoolCapacity(radius));
  const stats = pool.stats();
  const needsResize = estimate.vertexCapacity > stats.vertexCapacity
    || estimate.solidIndexCapacity > stats.solidIndexCapacity
    || estimate.vertexCapacity * 0.6 < stats.vertexCapacity;
  if (needsResize) {
    diag.event('log', `pool sized for radius ${radius}: 顶点 ${(estimate.vertexCapacity / 1024).toFixed(0)}k`);
    pool.resize(estimate);
    pool.compact();
    rebuildPoolBuffers();
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const buf = new ArrayBuffer(11);
  const v = new DataView(buf);
  v.setUint8(0, C_SUBSCRIBE);
  v.setUint8(1, 0);
  v.setInt32(2, centerX, true);
  v.setInt32(6, centerZ, true);
  v.setUint8(10, radius);
  ws.send(buf);
  state.sections.clear();
  state.sectionIndex.clear();
  state.dirty.clear();
  camInitialized = false;
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    subscribe(0, 0, currentRadius);
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const ping = new ArrayBuffer(1);
        new DataView(ping).setUint8(0, C_PING);
        ws.send(ping);
      }
    }, 10000);
  };
  ws.onmessage = ev => {
    try {
      handleMessage(ev.data);
    } catch (e) {
      // 之前这里是裸调用：解析异常会直接抛到事件分发里，HUD 上完全看不出来，只能靠控制台
      state.parseErrors++;
      state.lastParseError = e && e.message ? e.message : String(e);
      if (state.parseErrors <= 3) {
        console.error('[WhatGuysDoing] message parse failed (this must not be silent)', e);
      }
    }
  };
  ws.onclose = () => { document.getElementById('hud').textContent = '连接已断开，3 秒后重连…'; setTimeout(connect, 3000); };
}

let lastFrame = performance.now();
let fps = 0;
let hudTimer = 0;
let serverStatus = null;
let bakedGpuBytes = 0;   // 已上传的网格缓冲总字节数（destroy 时扣回）
let lastDeviceLost = ''; // GPU 设备丢失原因（非空即表示本次会话已丢过设备）
let firstCoverageDone = false;   // 烘焙路径首次铺满世界（此前网格预算放宽）
let uvDiag = '';                 // UV 自检结果（首段网格的第一面）
let uvRaw = '';                  // UV 自检的原始数字（不做解释，直接看）
let firstUvRect = '';            // mesher 实际拿到的第一个越界图集矩形（含原始槽位）
let uvRectBad = 0;               // 输入矩形越界/反向的累计次数（输出 uv 检查看不到这些）
let atlasGeneration = 0;         // 图集第几代（重建会作废上面的记录）
const atlasOrder = new Map();    // 贴图路径 → 图集槽位（只追加，整页生命期不变）

/** 现场快照：区分"资源单调增长"(OOM) 与"单帧超长"(GPU 看门狗/设备丢失) 两类崩溃。 */
function snapshot() {
  return {
    heapMB: heapMB(),
    gpuMB: Math.round(bakedGpuBytes / 1048576),
    sections: state.sections.size,
    meshes: baked.sections.size,
    dirty: state.dirty.size,
    firstCoverage: firstCoverageDone,
    instances: instanceCount,
    entities: state.entities.size,
    radius: currentRadius,
    fps: Math.round(fps),
    parseErrors: state.parseErrors,
    deviceError: gpu.lastDeviceError ? gpu.lastDeviceError() : '',
  };
}
let assetStatus = null;

function hudLoop() {
  fetchStatus();
  setInterval(fetchStatus, 2000);
}

function fetchStatus() {
  fetch('/api/status').then(r => r.json()).then(j => { serverStatus = j; }).catch(() => {});
  fetch('/api/assets/status').then(r => r.json()).then(j => {
    assetStatus = j;
    if (j.state === 'READY' && !baked.initStarted) initBaked();
    else refreshDescriptorsIfNeeded();
    // 资产还没抽完时建出的实体图集会全是洋红；就绪后重建一次（只重试一次）
    if (j.state === 'READY' && baked.entityAtlas && baked.entityAtlasAssetState !== 'READY') {
      queueEntityAtlasBuild('assets ready', { force: true });
    }
  }).catch(() => {});
}

function updateHud() {
  try {
    updateHudInner();
  } catch (e) {
    // HUD 自己抛错会每帧静默失败、显示冻结在旧值上（排查时极具误导性）—— 必须显式暴露。
    const text = e && e.message ? e.message : String(e);
    diag.event('error', 'updateHud: ' + text);
    document.getElementById('hud').textContent = `HUD 渲染异常：${text}\n（其余功能仍在运行；按 G 导出诊断）`;
  }
}

function updateHudInner() {
  const dims = [...state.dims.values()].map(d => d.name).join(', ') || '-';
  const lines = [
    `fps ${fps.toFixed(0)}   实例 ${instanceCount}   section ${state.sections.size}   实体 ${state.entities.size}   构建 ${BUILD_TAG}`,
    `维度 ${dims}   玩家类型 ${state.playerTypeId}   tick ${state.tick}   gameTime ${state.gameTime}`,
    `订阅 半径 ${currentRadius}   收到 ${(state.bytesReceived / 1024 / 1024).toFixed(2)} MiB`,
  ];
  lines.push(`相机 x ${camera.x.toFixed(1)} y ${camera.y.toFixed(1)} z ${camera.z.toFixed(1)}`
    + `  yaw ${camera.yaw.toFixed(0)}° pitch ${camera.pitch.toFixed(0)}°`);
  if (state.entities.size) {
    let nearestEntity = null;
    let nearestDist2 = Infinity;
    for (const e of state.entities.values()) {
      const dx = e.x - camera.x, dy = e.y - camera.y, dz = e.z - camera.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < nearestDist2) { nearestDist2 = d2; nearestEntity = e; }
    }
    if (nearestEntity) {
      const key = entityTypeKeys.get(nearestEntity.typeId) || `#${nearestEntity.typeId}`;
      lines.push(`最近实体 ${key} 距离 ${Math.sqrt(nearestDist2).toFixed(1)}`
        + `  位置 ${nearestEntity.x.toFixed(1)},${nearestEntity.y.toFixed(1)},${nearestEntity.z.toFixed(1)}`);
    }
  }
  if (serverStatus) {
    lines.push(`服务端 sessions ${serverStatus.sessions}  activeSections ${serverStatus.activeSections}`);
    lines.push(`服务端 发送 ${(serverStatus.bytesSent / 1024 / 1024).toFixed(2)} MiB  丢帧 ${serverStatus.droppedMessages}  峰值队列 ${serverStatus.peakQueueDepth}`);
    lines.push(`tick 采样 p99 ${serverStatus.sampleP99Micros.toFixed(1)}µs  max ${serverStatus.sampleMaxMicros.toFixed(1)}µs`);
  }
  if (assetStatus) {
    if (assetStatus.state === 'DISABLED') {
      lines.push(`资产 DISABLED：${assetStatus.message || '未启用'}（服务端需开启资产功能，浏览器无法自行获取）`);
    } else {
      const progress = assetStatus.totalBytes
        ? ` ${(assetStatus.downloadedBytes / 1048576).toFixed(1)}/${(assetStatus.totalBytes / 1048576).toFixed(1)} MiB`
        : '';
      lines.push(`资产 ${assetStatus.state}${progress}  文件 ${assetStatus.entries}  资源包 ${assetStatus.resourcePacks}  已分发 ${(assetStatus.servedBytes / 1024).toFixed(0)} KiB`);
    }
  }
  if (baked.error) {
    lines.push(`烘焙路径停用：${baked.error}`);
    lines.push('按 B 可重试；当前仍在用方块实例渲染');
  } else if (baked.ready) {
    const unknown = baked.atlas ? baked.atlas.unknownRequests() : 0;
    lines.push(`烘焙 ${baked.enabled ? '开' : '关'}(B)  状态 ${baked.stats.states}  贴图 ${baked.stats.tiles}${baked.stats.missingTextures ? `(缺 ${baked.stats.missingTextures})` : ''}  段 ${baked.sections.size}/${state.sections.size}`);
    if (baked.entityAtlas) {
      const a = baked.entityAtlas.stats;
      lines.push(`实体图集 ${a.tiles} 张${a.missing ? `(缺 ${a.missing})` : ''} ${a.width}×${a.height}`
        + `  不透明 ${a.opaque} 镂空 ${a.cutout} 半透明 ${a.translucent}`);
    }
    lines.push(`初始化 ${baked.stats.initMs}ms  本帧网格 ${baked.stats.meshMs}ms  累计重网格 ${baked.stats.meshed} 段 / ${baked.stats.quads} 面`);
    const ps = pool.stats();
    lines.push(`可见 ${bakedVisible}/${baked.sections.size} 段  绘制 ${bakedDraws} 次  状态切换 2 次（交错顶点 + 索引）`
      + `  池 顶点 ${(ps.vertexUsed / 1024).toFixed(0)}k/${(ps.vertexCapacity / 1024).toFixed(0)}k`
      + ` 索引 ${(ps.solidUsed / 1024).toFixed(0)}k/${(ps.solidIndexCapacity / 1024).toFixed(0)}k`
      + ` 空洞 ${(100 * (ps.solidUsed - ps.solidLive) / Math.max(1, ps.solidIndexCapacity)).toFixed(0)}%`);
    if (unknown > 0) {
      lines.push(`有 ${unknown} 次贴图不在图集内（显示为洋红）${atlasRebuildTimer ? '：正在自动重建图集…' : '，按 R 可立即重建'}`);
    }
    lines.push(`上传异常（累计）非有限值 ${uploadAnomalies.nanValues}  全零染色 ${uploadAnomalies.zeroTints}  零光照 ${uploadAnomalies.zeroLights}`);
    // 距离相机最近的段：它的统计反映"**现在**这一片的光照"，而不是某次历史上传的冻结值
    const nearest = (() => {
      let best = null;
      let bestDist = Infinity;
      for (const [key, entry] of baked.sections) {
        const b = entry.bounds;
        const dx = b[0] + 8 - camera.x, dy = b[1] + 8 - camera.y, dz = b[2] + 8 - camera.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestDist) { bestDist = d; best = { key, entry, dist: Math.sqrt(d) }; }
      }
      return best;
    })();
    if (nearest) {
      lines.push(`相机最近段 ${nearest.key}（距离 ${nearest.dist.toFixed(0)}）：${nearest.entry.vertexCount} 顶点中 零光照 ${nearest.entry.zeroLights}`);
    }
    // 实体（M2）：类型键按需补取（节流），并把"解析成功/失败"直接变成数字
    if (entityTypePending.size && performance.now() - lastEntityTypesFetch > 1000) {
      lastEntityTypesFetch = performance.now();
      refreshEntityTypes();
    }
    if (state.entities.size) {
      let resolved = 0;
      let unresolved = 0;
      let partCount = 0;
      let quadCount = 0;
      for (const e of state.entities.values()) {
        const key = entityTypeKeys.get(e.typeId);
        if (!key) {
          unresolved++;
          continue;
        }
        let info = entityPartsCache.get(key);
        if (info === undefined) {
          info = entityPartsFor(entityBundle, key);
          entityPartsCache.set(key, info);
        }
        if (!info) {
          unresolved++;
          continue;
        }
        resolved++;
        partCount += info.parts.length;
        quadCount += info.quads;
      }
      lines.push(`实体模型 已解析 ${resolved} / 未解析 ${unresolved}  部件 ${partCount}  面 ${quadCount}`);
      lines.push(`实体绘制 已绘 ${entityDrawQuads} 面  跳过 ${entitySkipped}  首顶点 uv ${entityFirstUv}`
        + (baked.entityAtlas ? '' : '（实体图集未就绪）'));
    }
    // 方块增量：数字必须在最前面，玩家放下/打掉方块时应当立刻跳动
    lines.push(`方块增量 消息 ${deltaMessages}  方块 ${deltaBlocks}  丢弃 ${deltaDropped}`
      + (lastDeltaAt ? `  最后 ${((performance.now() - lastDeltaAt) / 1000).toFixed(1)}s 前` : '  （从未收到）'));
    // 剔除统计：由 mesher 实际剔除的面数。与"面数下降"一起看，能区分"没剔除"与"剔了但还漏"。
    {
      const meshStats = baked.mesher && baked.mesher.stats ? baked.mesher.stats() : null;
      if (meshStats) {
        lines.push(`面剔除 已剔 ${meshStats.culled}  可见 ${meshStats.quads}  满方块不遮挡状态 ${opaqueMisses}（首个 ${firstOpaqueMiss || '-'}）`);
      }
    }
    if (uvRectBad > 0) {      // 输入侧统计：始终显示，随网格化实时增长（不像 uvDiag 那样只记首段）
      lines.push(`输入矩形越界 ${uvRectBad} 次`);
      if (firstUvRect) lines.push(`首个 uvRect ${firstUvRect}`);
    }
    if (uvDiag) {
      lines.push(uvDiag);
      if (uvRaw) lines.push(uvRaw);
    }
  } else if (baked.initStarted) {
    lines.push('烘焙路径初始化中…（取模型包 → 描述符 → 图集）');
  }
  const deviceError = gpu.lastDeviceError ? gpu.lastDeviceError() : '';
  if (lastDeviceLost) {
    lines.push(`GPU 设备丢失：${lastDeviceLost.slice(0, 110)}（渲染已停止，需刷新页面）`);
  }
  if (deviceError) {
    lines.push(`WebGPU 错误：${deviceError.slice(0, 120)}`);
  }
  if (state.parseErrors > 0) {
    lines.push(`解析错误 ${state.parseErrors} 条：${String(state.lastParseError).slice(0, 90)}`);
  }
  lines.push(`内存 堆 ${heapMB()} MB  GPU ${(bakedGpuBytes / 1048576).toFixed(1)} MB  网格 ${baked.sections.size} 段  待网格 ${state.dirty.size}`);
  if (instanceTruncated) {
    lines.push(`实例已按距离裁剪到上限 ${MAX_INSTANCES}（仅兜底渲染期间；烘焙路径接管后消失）`);
  }
  const prevErrors = diag.previousErrors();
  if (prevErrors.length) {
    const last = prevErrors[prevErrors.length - 1];
    lines.push(`上次会话异常 ${prevErrors.length} 条，最后：${last.k} ${String(last.m).slice(0, 110)}`);
    lines.push('按 G 输出完整现场到控制台（持久化在 localStorage: wgd.diag.v1）');
  }
  lines.push(pointerLocked
    ? `鼠标已锁定（移动即转头，ESC 退出）　速度 ${camera.speed.toFixed(0)}`
    : (lockFailed
      ? `指针锁定不可用：按住左键拖动看视角　速度 ${camera.speed.toFixed(0)}`
      : `点击画面锁定鼠标（拖动也可）　速度 ${camera.speed.toFixed(0)}`));
  document.getElementById('hud').textContent = lines.join('\n');
}

// ---------------------------------------------------------------- 主循环
(async function main() {
  try {
    await initWebGPU();
  } catch (e) {
    const el = document.getElementById('err');
    el.style.display = 'grid';
    el.textContent = `WebGPU 初始化失败：\n${e.message}`;
    return;
  }
  bindInput();
  connect();
  hudLoop();
  // bundle 的 fetch 可能早于 GPU 初始化完成；设备就绪后再补一次（已有图集会直接返回）
  queueEntityAtlasBuild('gpu ready');
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    fps = fps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1;
    if (!camInitialized) {
      // 出生点：取订阅区里最高的那一段，站到它上方。
      // 以前用"第一个收到的段 + 24"——当那段 y=-1 时相机 y 只到 8，正好埋在方块里，
      // 画面上就是满屏近距离的巨大面片（看起来像几何坏掉，其实只是相机在地里）。
      let top = null;
      for (const sec of state.sections.values()) {
        if (!top || sec.cy > top.cy) top = sec;
      }
      if (top) {
        let sameColumn = null;
        for (const sec of state.sections.values()) {
          if (sec.dim === top.dim && sec.cx === top.cx && sec.cz === top.cz && (!sameColumn || sec.cy > sameColumn.cy)) {
            sameColumn = sec;
          }
        }
        const anchor = sameColumn || top;
        camera.x = (anchor.cx << 4) + 8;
        camera.y = ((anchor.cy + 1) << 4) + 12;   // 该列最高段顶面再上 12 格
        camera.z = (anchor.cz << 4) + 8;
        camInitialized = true;
        diag.event('log', `camera spawn at ${camera.x},${Math.round(camera.y)},${camera.z} (top section cy=${anchor.cy})`);
      }
    }
    moveCamera(camera, keys, dt);
    const workStart = performance.now();
    frame();
    const workMs = performance.now() - workStart;
    // 单帧超长是 GPU 看门狗（TDR）重置设备的前兆，单独留证，便于和崩溃时刻对齐
    if (workMs > 200) diag.longFrame(workMs, snapshot());
    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      updateHud();
      diag.heartbeat(snapshot());   // 心跳自带 5 秒节流
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
