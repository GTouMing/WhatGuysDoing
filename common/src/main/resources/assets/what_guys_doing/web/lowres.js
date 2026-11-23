// lowres.js — 全局 lowres 客户端：tile 加载、heightfield 网格、GPU 绘制。
// 数据来自服务端 /api/lowres/<dim>/<lod>/<x>_<z>.png（501×1002：上半颜色、下半 height/light）。
// 纯几何构建 buildLowresMesh 可在 Node 里测试；DOM/WebGPU 只在 renderer 方法里使用。

import { aabbInFrustum } from './camera.js';
import { interleaveMesh } from './vertexformat.js';

const TILE = 500;
const LOD_FACTOR = 5;
// 参考项目：网格段数按 LOD 降低，不是每个 tile 500 段。
const DEBUG_MESH_SCALE = 1;
function meshSegments(lod) {
  const base = lod >= 3 ? 17 : lod === 2 ? 25 : 50;
  return base * DEBUG_MESH_SCALE;
}
// 环带：full-res 近处；LOD1（500m）中近；LOD2（2500m）中远；LOD3（12500m）极远。
// 调试用加载半径：比正式值大，便于一次看到更多 LOD tile。
const FULL_RADIUS = 112;
const LOD1_END = 2048;
const LOD2_END = 8000;
const FAR_RADIUS = 30000;
const LOAD_MARGIN = 1000;
const LOAD_LIMIT = 24;
const COVERAGE_SIZE = 512;
const COVERAGE_TEXEL_WORLD = 16;
const COVERAGE_WORLD_SIZE = COVERAGE_SIZE * COVERAGE_TEXEL_WORLD;
// 服务端 lowres 缓存格式版本；查询参数只用于绕过浏览器 HTTP 缓存，服务端路由会忽略 query。
const LOWRES_CACHE_VERSION = 19;
const LOWRES_IMAGE_WIDTH = 501;
const LOWRES_IMAGE_HEIGHT = 1002;
const HEIGHT_TEXTURE_SIZE = 512;

export const LOWRES_WGSL = `
struct Uniforms {
  viewProj: mat4x4f,
  coverageOrigin: vec2f,
  coverageSize: vec2f,
  sunlightStrength: f32,
  ambientLight: f32,
  voidColor: vec3f,
  aoStrength: f32,
  cameraPos: vec3f,
  chunkBorders: f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(1) @binding(0) var coverageTex: texture_2d<f32>;
@group(1) @binding(1) var coverageSampler: sampler;
struct Tile {
  origin: vec2f,
  span: f32,
  cell: f32,
  texels: f32,
};
@group(2) @binding(0) var heightTex: texture_2d<f32>;
@group(2) @binding(1) var<uniform> tile: Tile;
@group(2) @binding(2) var colorTex: texture_2d<f32>;
@group(2) @binding(3) var colorSampler: sampler;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec3f,
  @location(1) light: f32,
  @location(2) worldXZ: vec2f,
  @location(3) ao: f32,
  @location(4) alpha: f32,
  @location(5) lod: f32,
  @location(6) lodScale: f32,
  @location(7) distance: f32,
};

@vertex
fn vs(@location(0) position: vec3f, @location(1) uv: vec2f, @location(2) packed: vec4f, @location(3) ao: vec2f) -> VSOut {
  var out: VSOut;
  out.pos = u.viewProj * vec4f(position, 1.0);
  out.color = packed.rgb;
  out.light = packed.a;
  out.worldXZ = position.xz;
  out.ao = ao.x;
  out.alpha = ao.y;
  // uv 在 lowres 中不用于贴图：x=lod/3，y=cell/25。
  out.lod = uv.x * 3.0;
  out.lodScale = pow(5.0, out.lod - 1.0);
  out.distance = length(position - u.cameraPos);
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let uv = (in.worldXZ - u.coverageOrigin) / u.coverageSize;
  if (textureSample(coverageTex, coverageSampler, uv).r > 0.5) {
    discard;
  }
  // BlueMap：颜色在片元阶段按世界位置从 lowres 纹理采样，
  // 不是按 mesh 顶点插值；这样几何段数低也不会丢颜色细节。
  let colorUV = (in.worldXZ - tile.origin) / tile.span * tile.texels / 512.0;
  let sampled = textureSample(colorTex, colorSampler, colorUV);
  if (sampled.a == 0.0) {
    discard;
  }
  // BlueMap：较粗 LOD 在相机过近时淡出，避免近处糊成一片。
  if (in.lod > 1.0 && in.distance < 10.0 * in.lodScale * in.lod) {
    discard;
  }
  let sunlight = mix(in.light, 1.0, u.sunlightStrength);
  let baseF = round((in.worldXZ - tile.origin) / tile.span * tile.texels);
  let base = vec2i(clamp(baseF, vec2f(0.0), vec2f(tile.texels)));
  let h = textureLoad(heightTex, base, 0).r;
  // 参考项目按 1 个 height texel 取邻居，而不是按 mesh cell；
  // 后者的间距在 L1 是 10m，AO/slope 基本失效。
  let hx = textureLoad(heightTex, clamp(base + vec2i(1, 0), vec2i(0, 0), vec2i(i32(tile.texels), i32(tile.texels))), 0).r;
  let hz = textureLoad(heightTex, clamp(base + vec2i(0, 1), vec2i(0, 0), vec2i(i32(tile.texels), i32(tile.texels))), 0).r;
  let texelWorld = max(tile.span / tile.texels, 1.0);
  let shade = clamp(((h - hx) + (h - hz)) / texelWorld * 0.06, -0.2, 0.04);
  var ao = 0.0;
  if (in.lod < 1.5) {
    const aoStep = 0.0067;
    for (var dz = -3; dz <= 3; dz = dz + 1) {
      for (var dx = -3; dx <= 3; dx = dx + 1) {
        if (dx == 0 && dz == 0) { continue; }
        let q = clamp(base + vec2i(dx, dz), vec2i(0, 0), vec2i(i32(tile.texels), i32(tile.texels)));
        if (textureLoad(heightTex, q, 0).r > h + 0.01) { ao = ao - aoStep; }
      }
    }
  }
  let aoView = u.aoStrength * (1.0 - smoothstep(200.0, 600.0, in.distance));
  let shadeFinal = mix(shade, shade * 0.3 + ao, aoView);
  let brightness = mix(u.ambientLight, 1.0, sunlight);
  let shaded = clamp(sampled.rgb + vec3f(shadeFinal), vec3f(0.0), vec3f(1.0));
  var color = mix(u.voidColor, shaded * brightness, sampled.a);
  if (u.chunkBorders > 0.5) {
    let cell = in.worldXZ / 16.0;
    let f = abs(fract(cell) - vec2f(0.5, 0.5));
    let edge = min(0.5 - f.x, 0.5 - f.y);
    let line = 1.0 - smoothstep(0.0, 0.008, edge);
    color = mix(color, vec3f(1.0, 0.0, 1.0), line * 0.4 * (1.0 - smoothstep(200.0, 600.0, in.distance)));
  }
  return vec4f(color, 1.0);
}
`;

const LOWRES_ATTRIBUTES = [
  { shaderLocation: 0, offset: 0, format: 'float32x3' },
  { shaderLocation: 1, offset: 12, format: 'unorm16x2' },
  { shaderLocation: 2, offset: 16, format: 'unorm8x4' },
  { shaderLocation: 3, offset: 20, format: 'unorm8x2' },
];

export function spanFor(lod) {
  return TILE * Math.pow(LOD_FACTOR, lod - 1);
}

function heightOf(meta) {
  const h = (meta[1] << 8) | meta[2];
  return h >= 0x8000 ? h - 0x10000 : h;
}

/**
 * 从 33×66 RGBA 像素构建一个 LOD tile 的 heightfield（世界坐标）。
 * @returns positions/uvs/tints/lights/aos/indices/quadCount
 */
export function buildLowresMesh(pixels, width, height, tileX, tileZ, span, yOffset = 0, segments = 32, lod = 1) {
  const metaBase = height / 2;
  const texelStep = (width - 1) / segments;
  const cell = span / segments;
  const positions = [];
  const uvs = [];
  const tints = [];
  const lights = [];
  const aos = [];
  const alphas = [];
  const indices = [];
  let quadCount = 0;
  const sample = (px, pz) => {
    const i = (pz * width + px) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
  };
  for (let pz = 0; pz < segments; pz++) {
    for (let px = 0; px < segments; px++) {
      const top = sample(Math.min(width - 1, Math.round(px * texelStep)), Math.min(width - 1, Math.round(pz * texelStep)));
      // 空 cell 不能生成 quad：500 tile 的 L3 大部分区域透明，
      // 否则片元会把整张 tile 画成 voidColor，看起来像一整块蓝色平面。
      if (top[3] === 0) continue;
      const light = Math.min(1, sample(Math.min(width - 1, Math.round(px * texelStep)), Math.min(width - 1, Math.round(pz * texelStep)) + metaBase)[0] / 15);
      const base = positions.length / 3;
      // 顶点只保存基础颜色；slope shade 已移到片元，用 tile 高度纹理计算。
      const tint = [top[0] / 255, top[1] / 255, top[2] / 255];
      for (const [dx, dz] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const sx = Math.min(width - 1, Math.round((px + dx) * texelStep));
        const sz = Math.min(width - 1, Math.round((pz + dz) * texelStep));
        const meta = sample(sx, sz + metaBase);
        const wx = tileX * span + (px + dx) * cell;
        const wz = tileZ * span + (pz + dz) * cell;
        positions.push(wx, heightOf(meta) + yOffset, wz);
        uvs.push(lod / 3, 0.5);
        tints.push(tint[0], tint[1], tint[2]);
        lights.push(light);
        aos.push(1);
        alphas.push(top[3] / 255);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      quadCount++;
    }
  }
  return {
    positions, uvs, tints, lights, aos, alphas, indices,
    quadCount,
    vertexCount: positions.length / 3,
  };
}

export function createLowresRenderer(device, format) {
  const module = device.createShaderModule({ code: LOWRES_WGSL });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vs',
      buffers: [{ arrayStride: 24, attributes: LOWRES_ATTRIBUTES }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
      // Hybrid：lowres 先画，实时地形后画。相同深度时把 lowres 稍微推远，
      // 让实时几何通过 depth less；纯 global 模式没有实时几何，偏移无感。
      depthBias: 1,
      depthBiasSlopeScale: 1,
    },
  });
  const coverageTexture = device.createTexture({
    size: [COVERAGE_SIZE, COVERAGE_SIZE],
    format: 'r8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const coverageSampler = device.createSampler({
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    magFilter: 'nearest',
    minFilter: 'nearest',
  });
  const coverageBind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: coverageTexture.createView() },
      { binding: 1, resource: coverageSampler },
    ],
  });
  const colorSampler = device.createSampler({
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    magFilter: 'nearest',
    minFilter: 'nearest',
  });
  return new LowresRenderer(device, pipeline, coverageTexture, coverageBind, colorSampler);
}

class LowresRenderer {
  constructor(device, pipeline, coverageTexture, coverageBind, colorSampler) {
    this.device = device;
    this.pipeline = pipeline;
    this.coverageTexture = coverageTexture;
    this.coverageBind = coverageBind;
    this.colorSampler = colorSampler;
    this.tiles = new Map();
    this.loading = new Set();
    this.pending = new Map();
    this.empty = new Set();
    this.failed = new Set();
    this.failures = new Map();
    this.loadingSince = new Map();
    this.lastFailure = '';
    this.requestStats = { ok: 0, pending: 0, failed: 0 };
    this.lastLoadMs = 0;
    this.maxLoadingMs = 0;
    this.draws = 0;
    this.quads = 0;
    this.fetched = 0;
    this.generation = 0;
    this.mode = 'hybrid';
    this.camera = null;
    this.chunkBorders = false;
    this.serverEpoch = null;
    this.serverVersion = null;
    this.serverCacheVersion = null;
    this.serverColorResolved = 0;
    this.serverColorFallback = 0;
    this.lastStatusCheck = 0;
    this.statusBusy = false;
    this.coverageOrigin = [0, 0];
    this.coverageOriginChunkX = null;
    this.coverageOriginChunkZ = null;
    this.coverageCount = -1;
    this.coverageDimId = -2;
    this.uniform = device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.uniformData = new Float32Array(32);
    this.uniformData[18] = COVERAGE_WORLD_SIZE;
    this.uniformData[19] = COVERAGE_WORLD_SIZE;
    // 服务端颜色是未乘光照的纹理平均色；这里用 meta light + 与真实地形一致的 ambient。
    this.uniformData[20] = 0;
    this.uniformData[21] = 0.25;
    this.uniformData[24] = 0;
    this.uniformData[25] = 0;
    this.uniformData[26] = 0;
    this.bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniform } }],
    });
  }

  setViewProj(viewProj, camera) {
    this.uniformData.set(viewProj, 0);
    this.uniformData[16] = this.coverageOrigin[0];
    this.uniformData[17] = this.coverageOrigin[1];
    this.uniformData[18] = COVERAGE_WORLD_SIZE;
    this.uniformData[19] = COVERAGE_WORLD_SIZE;
    // 服务端颜色是未乘光照的纹理平均色；这里用 meta light + 与真实地形一致的 ambient。
    this.uniformData[20] = 0;
    this.uniformData[21] = 0.25;
    this.uniformData[24] = 0;
    this.uniformData[25] = 0;
    this.uniformData[26] = 0;
    const down = Math.max(0, -(camera ? camera.pitch : 0));
    this.uniformData[27] = Math.min(1, Math.max(0, (down - 20) / 60));
    this.uniformData[28] = camera ? camera.x : 0;
    this.uniformData[29] = camera ? camera.y : 0;
    this.uniformData[30] = camera ? camera.z : 0;
    this.uniformData[31] = this.chunkBorders ? 1 : 0;
    this.device.queue.writeBuffer(this.uniform, 0, this.uniformData);
  }

  setChunkBorders(enabled) {
    this.chunkBorders = !!enabled;
  }

  /**
   * 1 texel = 16×16 chunk。只标记 full-res 已在 GPU 上可绘制的 section 所在 chunk；
   * lowres fragment 在该区域 discard。覆盖窗口跟随相机（512 chunk = 8192 方块）。
   */
  updateCoverage(camera, sections, dimId) {
    const camChunkX = camera.x >> 4;
    const camChunkZ = camera.z >> 4;
    let originChunkX = this.coverageOriginChunkX;
    let originChunkZ = this.coverageOriginChunkZ;
    const recenter = originChunkX === null
      || Math.abs(camChunkX - (originChunkX + COVERAGE_SIZE / 2)) > COVERAGE_SIZE / 4
      || Math.abs(camChunkZ - (originChunkZ + COVERAGE_SIZE / 2)) > COVERAGE_SIZE / 4;
    if (recenter) {
      originChunkX = camChunkX - COVERAGE_SIZE / 2;
      originChunkZ = camChunkZ - COVERAGE_SIZE / 2;
    }
    const count = sections ? sections.size : 0;
    if (this.coverageOriginChunkX === originChunkX
      && this.coverageOriginChunkZ === originChunkZ
      && this.coverageCount === count
      && this.coverageDimId === dimId) return;

    const data = new Uint8Array(COVERAGE_SIZE * COVERAGE_SIZE);
    if (sections && dimId != null && dimId >= 0) {
      for (const key of sections.keys()) {
        const parts = key.split(':');
        if (Number(parts[0]) !== dimId) continue;
        const tx = Number(parts[1]) - originChunkX;
        const tz = Number(parts[3]) - originChunkZ;
        if (tx < 0 || tx >= COVERAGE_SIZE || tz < 0 || tz >= COVERAGE_SIZE) continue;
        data[tz * COVERAGE_SIZE + tx] = 255;
      }
    }
    this.device.queue.writeTexture(
      { texture: this.coverageTexture },
      data,
      { bytesPerRow: COVERAGE_SIZE },
      [COVERAGE_SIZE, COVERAGE_SIZE],
    );
    this.coverageOrigin = [originChunkX * 16, originChunkZ * 16];
    this.coverageOriginChunkX = originChunkX;
    this.coverageOriginChunkZ = originChunkZ;
    this.coverageCount = count;
    this.coverageDimId = dimId;
  }

  clear() {
    for (const tile of this.tiles.values()) {
      tile.vertex.destroy();
      tile.index.destroy();
      if (tile.heightTexture) tile.heightTexture.destroy();
      if (tile.colorTexture) tile.colorTexture.destroy();
      if (tile.tileUniform) tile.tileUniform.destroy();
    }
    this.tiles.clear();
    this.pending.clear();
    this.empty.clear();
    this.failed.clear();
    this.generation++;
  }

  stats() {
    let quads = 0;
    let maxLoadingMs = 0;
    const now = performance.now();
    for (const t of this.loadingSince.values()) {
      maxLoadingMs = Math.max(maxLoadingMs, now - t);
    }
    const byLod = { 1: 0, 2: 0, 3: 0 };
    for (const tile of this.tiles.values()) {
      quads += tile.quadCount;
      byLod[tile.lod] = (byLod[tile.lod] || 0) + 1;
    }
    return {
      tiles: this.tiles.size,
      lod1: byLod[1],
      lod2: byLod[2],
      lod3: byLod[3],
      loading: this.loading.size,
      pending: this.pending.size,
      empty: this.empty.size,
      failed: this.failed.size,
      failedKeys: [...this.failures.keys()].slice(0, 6),
      lastFailure: this.lastFailure,
      lastLoadMs: Math.round(this.lastLoadMs),
      maxLoadingMs: Math.round(maxLoadingMs),
      requestStats: { ...this.requestStats },
      fetched: this.fetched,
      quads,
      draws: this.draws,
      coverage: this.coverageCount,
      cacheVersion: LOWRES_CACHE_VERSION,
      serverCacheVersion: this.serverCacheVersion,
      serverColorResolved: this.serverColorResolved,
      serverColorFallback: this.serverColorFallback,
    };
  }

  update(camera, frustum, dimension = 'overworld', mode = 'hybrid') {
    this.checkServerEpoch();
    this.camera = camera;
    this.mode = mode;
    const now = performance.now();
    const levels = [3, 2, 1];
    const perLevel = Math.max(1, Math.floor(LOAD_LIMIT / 3));
    for (const lod of levels) {
      let started = 0;
      const span = spanFor(lod);
      const view = lod === 3 ? FAR_RADIUS : lod === 2 ? LOD2_END + LOAD_MARGIN : LOD1_END + LOAD_MARGIN;
      const minX = Math.floor((camera.x - view) / span);
      const maxX = Math.floor((camera.x + view) / span);
      const minZ = Math.floor((camera.z - view) / span);
      const maxZ = Math.floor((camera.z + view) / span);
      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (started >= perLevel || this.loading.size >= LOAD_LIMIT) break;
          const key = `${dimension}/${lod}/${x}_${z}`;
          if (this.tiles.has(key) || this.loading.has(key) || this.failed.has(key) || this.empty.has(key)) continue;
          // L2 需要 5×5 L1 全部解析；L3 的 span 远大于 L2 加载半径，
          // 不能要求 25 个 L2 齐备，否则只有极少数近处 L3 能加载。
          const parentReady = lod === 3
            ? this.hasAnyChild({ dimension, lod, x, z })
            : (lod > 1 && this.hasAllChildren({ dimension, lod, x, z }));
          if (lod > 1 && !parentReady) {
            this.pending.delete(key);
            continue;
          }
          const retryAt = this.pending.get(key) || 0;
          const readyAt = typeof retryAt === 'number' ? retryAt : retryAt.nextAt;
          if (readyAt > now) continue;
          // pending 上限只限制 L1 新 key；L2/L3 必须能继续加载，否则会被 L1 队列饿死。
          if (!this.pending.has(key) && lod === 1 && this.pending.size >= 1024) continue;
          // 加载不做视锥裁剪：像参考项目一样按 region 预生成，转头后不应还需要重新加载。
          this.load(dimension, lod, x, z, span);
          started++;
        }
        if (started >= perLevel || this.loading.size >= LOAD_LIMIT) break;
      }
    }
  }

  checkServerEpoch() {
    const now = performance.now();
    if (now - this.lastStatusCheck < 5000 || this.statusBusy) return;
    this.lastStatusCheck = now;
    this.statusBusy = true;
    fetch('/api/lowres/status', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(s => {
        if (!s) return;
        this.serverCacheVersion = s.cacheVersion;
        this.serverColorResolved = s.colorResolved || 0;
        this.serverColorFallback = s.colorFallback || 0;
        const version = `${s.cacheVersion}:${s.epoch}`;
        if (this.serverVersion === null) {
          this.serverVersion = version;
          this.serverEpoch = s.epoch;
        } else if (version !== this.serverVersion) {
          this.serverVersion = version;
          this.serverEpoch = s.epoch;
          const keys = typeof s.invalidated === 'string'
            ? s.invalidated.split(',').filter(Boolean) : [];
          for (const key of keys) this.invalidateKey(key);
        }
      })
      .catch(() => {})
      .finally(() => { this.statusBusy = false; });
  }

  invalidateKey(key) {
    const tile = this.tiles.get(key);
    if (tile) {
      tile.vertex.destroy();
      tile.index.destroy();
      if (tile.heightTexture) tile.heightTexture.destroy();
      if (tile.colorTexture) tile.colorTexture.destroy();
      if (tile.tileUniform) tile.tileUniform.destroy();
      this.tiles.delete(key);
    }
    this.pending.delete(key);
    this.empty.delete(key);
    this.failed.delete(key);
    this.failures.delete(key);
    this.loadingSince.delete(key);
  }

  fail(key, reason) {
    const previous = this.failures.get(key);
    const attempt = previous && previous.attempt ? previous.attempt + 1 : 1;
    this.failures.set(key, { reason, attempt });
    this.lastFailure = `${key}: ${reason}`;
    this.requestStats.failed++;
    // 网络抖动/服务端繁忙是瞬时的，不能永久封死一个 tile。
    if (attempt <= 6) {
      const delay = Math.min(30000, 1000 * Math.pow(2, attempt));
      this.pending.set(key, { nextAt: performance.now() + delay, attempt });
    } else {
      this.failed.add(key);
    }
    if (this.failures.size > 128) {
      const first = this.failures.keys().next().value;
      this.failures.delete(first);
    }
  }

  async load(dimension, lod, x, z, span) {
    const key = `${dimension}/${lod}/${x}_${z}`;
    const generation = this.generation;
    const started = performance.now();
    this.loading.add(key);
    this.loadingSince.set(key, started);
    let timeout;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 60000);
      const response = await fetch(`/api/lowres/${dimension}/${lod}/${x}_${z}.png?v=${LOWRES_CACHE_VERSION}`, {
        signal: controller.signal,
        cache: 'no-cache',
      });
      if (generation !== this.generation) return;
      if (response.status === 202) {
        const previous = this.pending.get(key);
        const attempt = previous && previous.attempt ? previous.attempt + 1 : 1;
        const delay = Math.min(30000, 1000 * Math.pow(2, attempt));
        this.pending.set(key, { nextAt: performance.now() + delay, attempt });
        this.requestStats.pending++;
        return;
      }
      if (response.status === 204) {
        this.empty.add(key);
        this.pending.delete(key);
        return;
      }
      if (!response.ok) {
        this.fail(key, `HTTP ${response.status}`);
        return;
      }
      const bitmap = await createImageBitmap(await response.blob());
      this.requestStats.ok++;
      if (generation !== this.generation) {
        if (bitmap.close) bitmap.close();
        return;
      }
      const width = LOWRES_IMAGE_WIDTH;
      const height = LOWRES_IMAGE_HEIGHT;
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      if (bitmap.close) bitmap.close();
      const data = ctx.getImageData(0, 0, width, height).data;
      const mesh = buildLowresMesh(data, width, height, x, z, span, lod === 3 ? 0 : lod === 2 ? 0.05 : 0.1, meshSegments(lod), lod);
      const interleaved = interleaveMesh(mesh);
      // 每 tile 一张 512×512 r32float 高度纹理（前 501×501 有效），供逐片元 AO/slope。
      const heightData = new Float32Array(HEIGHT_TEXTURE_SIZE * HEIGHT_TEXTURE_SIZE);
      const metaBase = height / 2;
      for (let hz = 0; hz < metaBase; hz++) {
        for (let hx = 0; hx < width; hx++) {
          const metaY = (metaBase + hz) * width * 4 + hx * 4;
          const meta = data.subarray(metaY, metaY + 4);
          heightData[hz * HEIGHT_TEXTURE_SIZE + hx] = heightOf(meta);
        }
      }
      const heightTexture = this.device.createTexture({
        size: [HEIGHT_TEXTURE_SIZE, HEIGHT_TEXTURE_SIZE],
        format: 'r32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.device.queue.writeTexture(
        { texture: heightTexture },
        heightData,
        { bytesPerRow: HEIGHT_TEXTURE_SIZE * 4, rowsPerImage: HEIGHT_TEXTURE_SIZE },
        [HEIGHT_TEXTURE_SIZE, HEIGHT_TEXTURE_SIZE],
      );
      // 颜色单独一张 RGBA 纹理；片元按世界坐标逐像素采样，避免顶点颜色插值。
      const colorData = new Uint8Array(HEIGHT_TEXTURE_SIZE * HEIGHT_TEXTURE_SIZE * 4);
      for (let hz = 0; hz < metaBase; hz++) {
        const src = hz * width * 4;
        const dst = hz * HEIGHT_TEXTURE_SIZE * 4;
        colorData.set(data.subarray(src, src + width * 4), dst);
      }
      const colorTexture = this.device.createTexture({
        size: [HEIGHT_TEXTURE_SIZE, HEIGHT_TEXTURE_SIZE],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.device.queue.writeTexture(
        { texture: colorTexture },
        colorData,
        { bytesPerRow: HEIGHT_TEXTURE_SIZE * 4, rowsPerImage: HEIGHT_TEXTURE_SIZE },
        [HEIGHT_TEXTURE_SIZE, HEIGHT_TEXTURE_SIZE],
      );
      const tileUniform = this.device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(
        tileUniform, 0,
        new Float32Array([x * span, z * span, span, span / meshSegments(lod), width - 1]),
      );
      const heightBind = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(2),
        entries: [
          { binding: 0, resource: heightTexture.createView() },
          { binding: 1, resource: { buffer: tileUniform } },
          { binding: 2, resource: colorTexture.createView() },
          { binding: 3, resource: this.colorSampler },
        ],
      });
      const indexData = new Uint32Array(mesh.indices);
      const vertex = this.device.createBuffer({
        size: Math.max(16, interleaved.buffer.byteLength),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      const index = this.device.createBuffer({
        size: Math.max(16, indexData.byteLength),
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(vertex, 0, interleaved.buffer);
      this.device.queue.writeBuffer(index, 0, indexData);
      this.tiles.set(key, {
        dimension, lod, x, z, span, vertex, index,
        heightTexture, colorTexture, tileUniform, heightBind,
        indexCount: mesh.indices.length,
        quadCount: mesh.quadCount,
      });
      this.fetched++;
      this.pending.delete(key);
      this.failures.delete(key);
      this.lastLoadMs = performance.now() - started;
    } catch (e) {
      this.fail(key, e && e.name === 'AbortError' ? 'timeout 60s' : String(e && e.message ? e.message : e));
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      this.loading.delete(key);
      this.loadingSince.delete(key);
    }
  }

  hasAllChildren(tile) {
    if (tile.lod <= 1) return false;
    let anyTile = false;
    for (let dz = 0; dz < LOD_FACTOR; dz++) {
      for (let dx = 0; dx < LOD_FACTOR; dx++) {
        const key = `${tile.dimension}/${tile.lod - 1}/${tile.x * LOD_FACTOR + dx}_${tile.z * LOD_FACTOR + dz}`;
        if (this.tiles.has(key)) anyTile = true;
        else if (!this.empty.has(key)) return false;
      }
    }
    return anyTile;
  }

  hasAnyChild(tile) {
    if (tile.lod <= 1) return false;
    for (let dz = 0; dz < LOD_FACTOR; dz++) {
      for (let dx = 0; dx < LOD_FACTOR; dx++) {
        const key = `${tile.dimension}/${tile.lod - 1}/${tile.x * LOD_FACTOR + dx}_${tile.z * LOD_FACTOR + dz}`;
        if (this.tiles.has(key)) return true;
      }
    }
    return false;
  }

  tileDistance(tile) {
    const x0 = tile.x * tile.span;
    const z0 = tile.z * tile.span;
    const x1 = x0 + tile.span;
    const z1 = z0 + tile.span;
    const cam = this.camera || { x: 0, z: 0 };
    const dx = Math.max(x0 - cam.x, 0, cam.x - x1);
    const dz = Math.max(z0 - cam.z, 0, cam.z - z1);
    return Math.hypot(dx, dz);
  }

  tileMaxDistance(tile) {
    const x0 = tile.x * tile.span;
    const z0 = tile.z * tile.span;
    const x1 = x0 + tile.span;
    const z1 = z0 + tile.span;
    const cam = this.camera || { x: 0, z: 0 };
    const dx = Math.max(Math.abs(x0 - cam.x), Math.abs(x1 - cam.x));
    const dz = Math.max(Math.abs(z0 - cam.z), Math.abs(z1 - cam.z));
    return Math.hypot(dx, dz);
  }

  resetDrawStats() {
    this.draws = 0;
    this.quads = 0;
  }

  drawLod(pass, lod, frustum) {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind);
    pass.setBindGroup(1, this.coverageBind);
    for (const tile of this.tiles.values()) {
      if (tile.lod !== lod) continue;
      if (frustum && !aabbInFrustum(
        frustum,
        tile.x * tile.span, -64, tile.z * tile.span,
        (tile.x + 1) * tile.span, 320, (tile.z + 1) * tile.span,
      )) continue;
      pass.setVertexBuffer(0, tile.vertex);
      pass.setIndexBuffer(tile.index, 'uint32');
      pass.setBindGroup(2, tile.heightBind);
      pass.drawIndexed(tile.indexCount);
      this.draws++;
      this.quads += tile.quadCount;
    }
  }

  draw(pass, frustum) {
    this.resetDrawStats();
    pass.setBindGroup(0, this.bind);
    pass.setBindGroup(1, this.coverageBind);
    for (let lod = 3; lod >= 1; lod--) this.drawLod(pass, lod, frustum);
  }
}
