// entityatlas.js — 实体贴图图集：按**原生像素尺寸**打包，不降采样。
//
// 与方块图集（atlas.js）的三点差异：
//  1. 贴图尺寸不一（64×64 皮肤、64×32、128×128 …），不能按 16×16 瓦片切；
//  2. uv 的跨度直接由贴图尺寸决定（模型里的 uv 以 texture_size 为分母）；
//  3. 同样保留 0 号洋红占位、unknownRequests 计数与 alpha 分类的既有约定。
//
// 布局必须**只追加**：槽位进了 uv，一旦重排，已烘焙的实体几何就会指到别的贴图。
// 这里用固定页宽 + shelf 追加 + 高度量化（256 台阶）实现：新增贴图只会占用新行，
// 旧贴图坐标不变；只有跨高度台阶时 uv 的 v 分量才需要整体更新（由消费方决定是否重建几何）。
import {
  ALPHA_OPAQUE, ALPHA_CUTOUT, ALPHA_TRANSLUCENT,
  MATERIAL_SOLID, MATERIAL_TRANSLUCENT,
  stableTileOrder, drawMissingTile,
} from './atlas.js';

/** 0 号洋红占位格的边长（与方块图集一致）。 */
export const MISSING_TILE_SIZE = 16;
/** 默认页宽：实体贴图最大 256，1024 足够并远低于 WebGPU 的 8192 下限。 */
export const DEFAULT_MAX_WIDTH = 1024;
/** 页尺寸按 256 像素量化，减少重建时 uv 失效的次数。 */
export const DEFAULT_WIDTH_QUANTUM = 256;
export const DEFAULT_HEIGHT_QUANTUM = 256;

function positiveInt(value, fallback) {
  const n = Math.ceil(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * shelf 打包。entries 顺序即最终布局顺序，调用方必须保证追加而不是重排。
 * @param {Array<{path: string, width: number, height: number}>} entries
 * @param options
 * @returns {{width:number, height:number, usedHeight:number,
 *            placements: Map<string,{x:number,y:number,width:number,height:number}>,
 *            missingPlacement:{x:number,y:number,width:number,height:number},
 *            entries: Array<{path:string,width:number,height:number}>}}
 */
export function packEntityAtlas(entries, options = {}) {
  const widthQuantum = positiveInt(options.widthQuantum, DEFAULT_WIDTH_QUANTUM);
  const heightQuantum = positiveInt(options.heightQuantum, DEFAULT_HEIGHT_QUANTUM);
  const requestedWidth = positiveInt(options.maxWidth, DEFAULT_MAX_WIDTH);
  const padding = Math.max(0, Math.floor(Number(options.padding ?? 1)));

  const normalized = [];
  const seen = new Set();
  let widest = MISSING_TILE_SIZE + padding * 2;
  for (const entry of entries || []) {
    const path = entry && entry.path;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const width = positiveInt(entry.width, MISSING_TILE_SIZE);
    const height = positiveInt(entry.height, MISSING_TILE_SIZE);
    widest = Math.max(widest, width + padding * 2);
    normalized.push({ path, width, height });
  }

  // 单张贴图比页宽还宽时扩页（当前资源最大 128，正常不会触发）。
  const width = Math.ceil(Math.max(requestedWidth, widest) / widthQuantum) * widthQuantum;

  const placements = new Map();
  // 内容坐标（不含 padding）；slot 比内容大 2×padding，边缘像素在绘制时复制。
  const missingPlacement = {
    x: padding, y: padding, width: MISSING_TILE_SIZE, height: MISSING_TILE_SIZE,
  };
  const missingSlotWidth = MISSING_TILE_SIZE + padding * 2;
  let x = missingSlotWidth;
  let y = 0;
  let rowHeight = MISSING_TILE_SIZE + padding * 2;
  for (const entry of normalized) {
    const slotWidth = entry.width + padding * 2;
    const slotHeight = entry.height + padding * 2;
    if (x + slotWidth > width) {
      y += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    placements.set(entry.path, {
      x: x + padding, y: y + padding, width: entry.width, height: entry.height,
    });
    x += slotWidth;
    rowHeight = Math.max(rowHeight, slotHeight);
  }

  const usedHeight = y + rowHeight;
  const height = Math.max(heightQuantum, Math.ceil(usedHeight / heightQuantum) * heightQuantum);
  return {
    width, height, usedHeight, padding, placements,
    missingPlacement, entries: normalized,
  };
}

/**
 * 图集空间 uv 矩形：**精确**映射贴图内容，不做半 texel 内缩。
 * 边缘采样由槽位外圈的 1px 复制 padding 吸收；内缩会让纹理整体缩小并偏移。
 */
export function entityUvRect(place, atlasWidth, atlasHeight) {
  return [
    place.x / atlasWidth,
    place.y / atlasHeight,
    (place.x + place.width) / atlasWidth,
    (place.y + place.height) / atlasHeight,
  ];
}

/** 单块区域的 alpha 分类；约定与 atlas.js 相同。 */
export function classifyAlphaRegion(pixels, atlasWidth, place) {
  let mode = ALPHA_OPAQUE;
  for (let ty = 0; ty < place.height; ty++) {
    const row = (place.y + ty) * atlasWidth;
    for (let tx = 0; tx < place.width; tx++) {
      const alpha = pixels[(row + place.x + tx) * 4 + 3];
      if (alpha === 255) continue;
      if (alpha === 0) {
        if (mode === ALPHA_OPAQUE) mode = ALPHA_CUTOUT;
      } else {
        return ALPHA_TRANSLUCENT;
      }
    }
  }
  return mode;
}

/** 把贴图内容精确画到 place，并把外圈 padding 用边缘像素复制填满。 */
function drawPaddedBitmap(ctx, bitmap, place, padding) {
  const { x, y, width, height } = place;
  ctx.drawImage(bitmap, 0, 0, width, height, x, y, width, height);
  if (padding <= 0 || width <= 0 || height <= 0) return;
  // 四条边
  ctx.drawImage(bitmap, 0, 0, 1, height, x - padding, y, padding, height);
  ctx.drawImage(bitmap, width - 1, 0, 1, height, x + width, y, padding, height);
  ctx.drawImage(bitmap, 0, 0, width, 1, x, y - padding, width, padding);
  ctx.drawImage(bitmap, 0, height - 1, width, 1, x, y + height, width, padding);
  // 四个角
  ctx.drawImage(bitmap, 0, 0, 1, 1, x - padding, y - padding, padding, padding);
  ctx.drawImage(bitmap, width - 1, 0, 1, 1, x + width, y - padding, padding, padding);
  ctx.drawImage(bitmap, 0, height - 1, 1, 1, x - padding, y + height, padding, padding);
  ctx.drawImage(bitmap, width - 1, height - 1, 1, 1, x + width, y + height, padding, padding);
}

/**
 * 浏览器侧构建：并发取图 → 原生尺寸打包 → 建 GPU 纹理。
 * @param device WebGPU device
 * @param texturePaths `minecraft:textures/entity/pig/pig.png` 形式
 * @param options
 */
export async function buildEntityAtlas(device, texturePaths, options = {}) {
  const paths = stableTileOrder(texturePaths || []);
  const concurrency = positiveInt(options.concurrency, 16);

  const bitmaps = new Array(paths.length);
  const skinModels = new Array(paths.length);
  let cursor = 0;
  async function prefetch() {
    for (;;) {
      const i = cursor++;
      if (i >= paths.length) return;
      try {
        const result = await options.fetchTexture(paths[i]);
        if (result && result.bitmap) {
          bitmaps[i] = result.bitmap;
          skinModels[i] = result.model || 'wide';
        } else {
          bitmaps[i] = result;
          skinModels[i] = 'wide';
        }
      } catch {
        bitmaps[i] = null;
        skinModels[i] = 'wide';
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, prefetch));

  const entries = paths.map((path, i) => {
    const bitmap = bitmaps[i];
    return {
      path,
      width: bitmap ? bitmap.width : MISSING_TILE_SIZE,
      height: bitmap ? bitmap.height : MISSING_TILE_SIZE,
    };
  });
  const layout = packEntityAtlas(entries, options);
  // 诊断：打包时读到的尺寸。uv 探针显示某个格子的"宽对、高是 ~575"，
  // 这里直接把前几个 entry 的实际 bitmap 尺寸打出来，定位是解码、还是取字段错。
  console.log('[WhatGuysDoing] entity atlas entries',
    entries.length,
    entries.slice(0, 5).map(e => (e.path.split('/').slice(-2).join('/') + '=' + e.width + 'x' + e.height)).join('  '));
  const { width, height } = layout;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  drawMissingTile(ctx, 0, 0);

  const tiles = new Map();
  const missing = [];
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const place = layout.placements.get(path);
    const bitmap = bitmaps[i];
    if (bitmap) {
      // 原生尺寸绘制；外圈 padding 复制边缘，uvRect 精确指向内容。
      drawPaddedBitmap(ctx, bitmap, place, layout.padding);
      if (bitmap.close) bitmap.close();
    } else {
      missing.push(path);
      drawMissingTile(ctx, place.x, place.y);
    }
    tiles.set(path, { ...place, alphaMode: ALPHA_OPAQUE });
  }

  const pixels = ctx.getImageData(0, 0, width, height).data;
  // 诊断：读猪贴图格中心的一个像素。若这里是 (255,255,255,255)，
  // 说明 canvas 画上去的内容本身就是白的（与 GPU 上传无关）。
  {
    const pigKey = paths.find(p => p.includes('entity/pig/pig'));
    if (pigKey) {
      const pl = layout.placements.get(pigKey);
      const px = Math.min(width - 1, pl.x + (pl.width >> 1));
      const py = Math.min(height - 1, pl.y + (pl.height >> 1));
      const idx = (py * width + px) * 4;
      console.log('[WhatGuysDoing] entity atlas pixel probe', pigKey,
        'at', px + ',' + py, '=', pixels[idx], pixels[idx + 1], pixels[idx + 2], pixels[idx + 3]);
    }
  }
  let opaque = 0;
  let cutout = 0;
  let translucent = 0;
  for (const tile of tiles.values()) {
    tile.alphaMode = classifyAlphaRegion(pixels, width, tile);
    if (tile.alphaMode === ALPHA_OPAQUE) opaque++;
    else if (tile.alphaMode === ALPHA_CUTOUT) cutout++;
    else translucent++;
  }

  const texture = device.createTexture({
    size: [width, height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  // 上传像素：这里**不用** copyExternalImageToTexture，而是用上面已经读出来的 ImageData。
  // 实测：canvas 内容正确（镂空/半透明统计都算得出来），但 copyExternalImageToTexture
  // 上传后采样得到全白 —— 走 writeTexture 这条更直接的路，像素数据本来就在手上。
  const rgba = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  device.queue.writeTexture(
    { texture },
    rgba,
    { bytesPerRow: width * 4, rowsPerImage: height },
    [width, height],
  );

  const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
  const missingRect = entityUvRect(layout.missingPlacement, width, height);

  let unknownRequests = 0;
  function uvRect(path) {
    const tile = tiles.get(path);
    if (!tile) {
      unknownRequests++;
      return missingRect;
    }
    return entityUvRect(tile, width, height);
  }

  return {
    texture,
    sampler,
    width,
    height,
    usedHeight: layout.usedHeight,
    /** 诊断：把图集内容本身画出来（区分"图集内容错了"与"采样错了"）。 */
    drawTo(targetCtx, scale = 1) {
      targetCtx.imageSmoothingEnabled = false;
      targetCtx.clearRect(0, 0, width * scale, height * scale);
      targetCtx.drawImage(canvas, 0, 0, width, height, 0, 0, width * scale, height * scale);
    },
    tiles: tiles.size,
    hasTexture: path => {
      const tile = tiles.get(path);
      return !!tile && !missing.includes(path);
    },
    missing,
    uvRect,
    tileOf: path => {
      const tile = tiles.get(path);
      return tile ? { x: tile.x, y: tile.y, width: tile.width, height: tile.height } : null;
    },
    alphaMode: path => (tiles.has(path) ? tiles.get(path).alphaMode : ALPHA_OPAQUE),
    materialOf: path => (tiles.has(path) && tiles.get(path).alphaMode === ALPHA_TRANSLUCENT
      ? MATERIAL_TRANSLUCENT : MATERIAL_SOLID),
    skinModels: new Map(paths.map((path, i) => [path, skinModels[i] || 'wide'])),
    unknownRequests: () => unknownRequests,
    stats: {
      tiles: tiles.size, opaque, cutout, translucent, missing: missing.length,
      width, height, usedHeight: layout.usedHeight,
    },
  };
}
