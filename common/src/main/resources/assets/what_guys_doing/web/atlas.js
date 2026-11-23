// atlas.js — 把原版贴图解码、按 16×16 瓦片打包成一张图集，并逐贴图判定 alpha 模式。
// 只在浏览器里用（需要 canvas / createImageBitmap / WebGPU）。

export const MATERIAL_SOLID = 0;
export const MATERIAL_TRANSLUCENT = 1;
export const ALPHA_OPAQUE = 0;      // 全部 alpha = 255
export const ALPHA_CUTOUT = 1;      // 只有 0 / 255（树叶、玻璃）
export const ALPHA_TRANSLUCENT = 2; // 存在中间值（水、冰）

const TILE = 16;

/**
 * 瓦片 → 归一化 uv 矩形（纯函数，导出以便 Node 直接回归；运行时与测试共用同一份）。
 *
 * tile.x / tile.y 是**像素**坐标（绘制时就按像素摆放：x = 列 * TILE）。
 * 这里曾经又乘一次 TILE，把 uv 指到图集外 16 倍远的地方，被 clamp-to-edge 拉成
 * 「边缘一个像素铺满整面」—— 就是用户看到的条纹。跨度看起来对（与 tile.x 无关），
 * 所以只测跨度的检查抓不到，必须测基准点。
 */
export function tileRect(tile, atlasWidth, atlasHeight, inset = 0) {
  return [
    (tile.x + inset) / atlasWidth,
    (tile.y + inset) / atlasHeight,
    (tile.x + TILE - inset) / atlasWidth,
    (tile.y + TILE - inset) / atlasHeight,
  ];
}

/**
 * 贴图顺序：**去重 + 保持首次出现顺序，绝不排序**。
 *
 * 这不是风格问题，是正确性：瓦片位置就是 uv 的一部分，而网格只在网格化时取一次 uv。
 * 一旦按字典序排，新贴图插进中间就会把后面所有瓦片整体挪位 → 已建好的网格指向别的贴图
 * （症状：草方块变成钻石块，且每次图集重建都重演）。
 * 保持追加顺序后，重建是**非破坏性**的：旧瓦片位置不变，旧网格继续有效，也不必全量重网格。
 */
export function stableTileOrder(texturePaths) {
  const seen = new Set();
  const out = [];
  for (const path of texturePaths) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/**
 * 把新贴图**追加**进持久顺序表（path → 槽位），返回槽位。
 *
 * 这是 `stableTileOrder` 的强化版：顺序表跨图集重建而存在，所以槽位是**整页生命期内不变**的。
 * 原因：槽位进了 uv，而网格只在网格化那一刻取一次 uv。若槽位随"当前贴图集合"变动，
 * 集合一缩小，后面的瓦片整体前移 → 已建网格指到别的贴图（草方块变钻石块、洋红占位）。
 * 只追加则任何一次重建都不会让旧网格失效。
 */
export function assignTileSlots(order, texturePaths) {
  for (const path of texturePaths) {
    if (!order.has(path)) order.set(path, order.size);
  }
  return order;
}

/**
 * 瓦片容量量化：256 → 512 → 1024 …
 *
 * 为什么必须量化：uv 是按图集**尺寸**归一化的，尺寸一变，所有已建网格的 uv 同时失效。
 * 之前容量直接跟着瓦片数走（2 的幂），跨过边界那次重建就会留下错纹理。
 * 量化成台阶后尺寸极少变化，且变化时调用方可以只做一次全量重网格。
 */
const SLOT_QUANTUM = 256;
export function atlasCapacity(tileCount) {
  const steps = Math.max(1, Math.ceil(Math.max(1, tileCount) / SLOT_QUANTUM));
  return SLOT_QUANTUM * Math.min(steps, 0x10000);
}

/**
 * @param device WebGPU device
 * @param texturePaths 需要打包的贴图路径（形如 minecraft:block/stone）
 * @param options.fetchTexture(path) → Promise<ImageBitmap|null>
 */
export async function buildAtlas(device, texturePaths, options) {
  const paths = stableTileOrder(texturePaths);
  const count = Math.max(1, paths.length);
  // 方块 atlas 预留固定容量：正常重建不改变页面尺寸，旧网格的归一化 uv 继续有效，
  // 只追加新槽位；否则每次跨 256 瓦片台阶都会全量重网格，表现为区块陆续显现。
  const minCapacity = options && Number.isFinite(options.minCapacity) ? options.minCapacity : 0;
  const capacity = Math.max(atlasCapacity(count), minCapacity);
  const columns = Math.ceil(Math.sqrt(capacity));
  const rows = Math.ceil(capacity / columns);
  const width = columns * TILE;
  const height = rows * TILE;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);

  const tiles = new Map();
  const missing = [];
  // 0 号格固定留给「未知贴图」：未知的引用会渲染成洋红格，便于诊断而不是凭空消失
  drawMissingTile(ctx, 0, 0);
  const MISSING_RECT = [0.5 / width, 0.5 / height, (TILE - 0.5) / width, (TILE - 0.5) / height];

  // 串行取 969 张贴图 ≈ 30 秒，这正是"烘焙路径迟迟不就绪、页面长时间停留在兜底渲染"的主因。
  // 改成有界并发预取（16 路），绘制顺序不变，所以图集布局与串行版完全一致。
  const CONCURRENCY = 16;
  const bitmaps = new Array(paths.length);
  let cursor = 0;
  async function prefetch() {
    for (;;) {
      const i = cursor++;
      if (i >= paths.length) return;
      try {
        bitmaps[i] = await options.fetchTexture(paths[i]);
      } catch {
        bitmaps[i] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, prefetch));

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const x = ((i + 1) % columns) * TILE;
    const y = Math.floor((i + 1) / columns) * TILE;
    const bitmap = bitmaps[i];
    if (bitmap) {
      // 动画贴图是 16×N，只取第一帧
      ctx.drawImage(bitmap, 0, 0, Math.min(TILE, bitmap.width), Math.min(TILE, bitmap.height), x, y, TILE, TILE);
      if (bitmap.close) bitmap.close();
    } else {
      missing.push(path);
      drawMissingTile(ctx, x, y);
    }
    tiles.set(path, { x, y, alphaMode: ALPHA_OPAQUE });
  }

  // 一次性读回像素，逐瓦片判定 alpha 模式
  const pixels = ctx.getImageData(0, 0, width, height).data;
  let opaque = 0;
  let cutout = 0;
  let translucent = 0;
  for (const [path, tile] of tiles) {
    let mode = ALPHA_OPAQUE;
    outer:
    for (let ty = 0; ty < TILE; ty++) {
      for (let tx = 0; tx < TILE; tx++) {
        const alpha = pixels[(((tile.y + ty) * width) + (tile.x + tx)) * 4 + 3];
        if (alpha === 255) continue;
        if (alpha === 0) {
          if (mode === ALPHA_OPAQUE) mode = ALPHA_CUTOUT;
        } else {
          mode = ALPHA_TRANSLUCENT;
          break outer;
        }
      }
    }
    tile.alphaMode = mode;
    if (mode === ALPHA_OPAQUE) opaque++;
    else if (mode === ALPHA_CUTOUT) cutout++;
    else translucent++;
    void path;
  }

  const texture = device.createTexture({
    size: [width, height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: canvas }, { texture }, [width, height]);

  const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });

  /**
   * 瓦片内 uv。**不内缩**：采样器是 nearest，片元中心永远落在瓦片内部，
   * 不会采到邻格；而 0.5 内缩会让每张贴图少画半个像素 —— 方块边缘露出底色，
   * 表现为每个方块之间稳定的"井"字缝（不是 z-fighting，不会闪烁）。
   */
  let unknownRequests = 0;
  function uvRect(path) {
    const tile = tiles.get(path);
    if (!tile) {
      unknownRequests++;            // 图集里没有这张贴图 → 渲染成洋红格，并在 HUD 提示重建
      return MISSING_RECT;
    }
    return tileRect(tile, width, height);
  }

  /** 诊断用：原始槽位（像素坐标）。uv 出问题时，槽位比 uv 更能说明是哪一步算错的。 */
  function tileOf(path) {
    const tile = tiles.get(path);
    return tile ? { x: tile.x, y: tile.y } : null;
  }

  function alphaMode(path) {
    return tiles.has(path) ? tiles.get(path).alphaMode : ALPHA_OPAQUE;
  }

  return {
    texture,
    sampler,
    width,
    height,
    /** 诊断用：把图集内容本身画出来，用来区分"图集内容错了"与"采样错了" */
    drawTo(targetCtx, scale = 2) {
      targetCtx.imageSmoothingEnabled = scale >= 1;
      targetCtx.clearRect(0, 0, width * scale, height * scale);
      targetCtx.drawImage(canvas, 0, 0, width, height, 0, 0, width * scale, height * scale);
    },
    tiles: tiles.size,
    /** 某个贴图是否已经在图集里（网格化时用来判断这次会不会出现洋红） */
    hasTexture: path => tiles.has(path),
    missing,
    alphaMode,
    uvRect,
    tileOf,
    materialOf: path => (alphaMode(path) === ALPHA_TRANSLUCENT ? MATERIAL_TRANSLUCENT : MATERIAL_SOLID),
    unknownRequests: () => unknownRequests,
    stats: { tiles: tiles.size, opaque, cutout, translucent, missing: missing.length, width, height },
  };
}

export function drawMissingTile(ctx, x, y) {
  const half = TILE / 2;
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(x, y, half, half);
  ctx.fillRect(x + half, y + half, half, half);
  ctx.fillStyle = '#000000';
  ctx.fillRect(x + half, y, half, half);
  ctx.fillRect(x, y + half, half, half);
}
