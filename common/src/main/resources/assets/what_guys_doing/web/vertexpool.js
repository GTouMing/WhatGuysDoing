// vertexpool.js — 顶点/索引池的分配、空洞与整理决策（DOM-free：运行时与 Node 测试共用同一份）。
//
// 动机：原来是「每 section 6 个 GPUBuffer」，于是每帧 763 段要做 763 × 5 次状态切换
// （4 次 setVertexBuffer + 1 次 setIndexBuffer）。改成共享大缓冲后，**状态切换降到每帧 5 次**，
// 而 draw 仍逐段（保留视锥剔除的收益），相邻区段索引相连时再贪心合并成一次 draw。
//
// 关键约定：
//   * 索引里存的是**池内绝对顶点号**（绘制时 baseVertex=0），所以任意区段都能独立绘制，
//     也能把相连区段合并；不需要 baseVertex 参与寻址。
//   * 释放只把索引区间**清零**（退化三角形，GPU 侧无害），顶点/索引区间进入 free-list 复用；
//     分配失败且空洞过多时才 compact，compact 会清空竞技场并让调用方重新网格化全部段。

import { VERTEX_STRIDE } from './vertexformat.js';

export const INDEX_BYTES = 4;

/** 空洞占比超过这个比例就整理而不是扩容。 */
const COMPACT_WASTE_RATIO = 0.4;
/**
 * 需求估计的余量：需求按「当前存活(live)」× 4 估。
 *
 * 曾经用 `used`（含空洞与历史重网格的累计）估需求 —— 结果越估越大：实测被推到 **32M 顶点 ≈ 1.4 GB**，
 * 随后出现 `Invalid CommandBuffer`（超量分配后的必然结果）。用 live 才收敛。
 * ×4 是为了第一次失败就覆盖整个订阅（live 在失败时 ≈ 已放下的段，而最终要放下全部段）。
 */
const HEADROOM = 4;
/** 硬上限（顶点数，约 430 MB 顶点缓冲）：容量规划出问题时不要拖垮设备。 */
const MAX_VERTEX_CAPACITY = 12 << 20;
const MAX_INDEX_CAPACITY = 24 << 20;

/** 向上取整到 64k：GPUBuffer 不要求 2 的幂，用 2 的幂会把容量虚增近一倍。 */
const roundUp = (value, multiple = 1 << 16) => Math.ceil(Math.max(1, value) / multiple) * multiple;

/**
 * 按**订阅半径**预估池容量（纯函数，便于回归）。
 *
 * 为什么要在订阅时预估：池一旦在"流式加载到一半"时才扩容，就要在一个同步调用里
 * 销毁旧缓冲 + 申请几百 MB 新缓冲 + 清空全部网格 + 全部重网格 —— 表现为界面卡死
 * （日志里 `mesh pool grow` 紧跟一条 mesh 数骤降的心跳就是它）。提前按订阅半径给够，
 * 正常情况一次都不会扩容。
 *
 * 估算依据（实测）：半径 8 → 约 2016 段；每段约 3520 顶点 / 5280 实体索引；
 * 每区块列按 8 段估（略高于实测的 ~7，留余量）。
 */
const SECTIONS_PER_CHUNK = 8;
const VERTICES_PER_SECTION = 3520;
const SOLID_INDICES_PER_SECTION = 5280;
const TRANSLUCENT_INDICES_PER_SECTION = 80;
const ESTIMATE_HEADROOM = 1.25;

/**
 * 把容量夹到「单缓冲字节上限」内。
 *
 * 教训：上限必须用**平台限制的单位（字节）**表达。之前按"顶点数"写死 12M ——
 * 在 20 B/顶点时是 240 MB（合规），AO 把 stride 改成 24 B 后就是 288 MB，直接超限
 * （Buffer size exceeds the max buffer size limit，默认 256 MB）。
 */
export function clampCapsToBytes(caps, maxBytes) {
  const limit = maxBytes || (256 << 20);
  const perIndexArena = Math.floor(limit / 2 / INDEX_BYTES);   // 索引缓冲里放了实体 + 半透明两段
  return {
    vertexCapacity: Math.min(caps.vertexCapacity, Math.floor(limit / VERTEX_STRIDE)),
    solidIndexCapacity: Math.min(caps.solidIndexCapacity, perIndexArena),
    translucentIndexCapacity: Math.min(caps.translucentIndexCapacity, perIndexArena),
  };
}

export function estimatePoolCapacity(radius) {
  const side = 2 * Math.max(1, radius) + 1;
  const sections = side * side * SECTIONS_PER_CHUNK;
  return {
    vertexCapacity: Math.min(roundUp(sections * VERTICES_PER_SECTION * ESTIMATE_HEADROOM), MAX_VERTEX_CAPACITY),
    solidIndexCapacity: Math.min(roundUp(sections * SOLID_INDICES_PER_SECTION * ESTIMATE_HEADROOM), MAX_INDEX_CAPACITY),
    translucentIndexCapacity: Math.min(
      roundUp(sections * TRANSLUCENT_INDICES_PER_SECTION * ESTIMATE_HEADROOM), MAX_INDEX_CAPACITY),
  };
}

export function createMeshPool(options = {}) {
  // 初始容量给一个不大的值，交给"按需求右尺寸化"的扩容收敛（实测半径 8 稳态约 710 万顶点）
  let vertexCapacity = options.vertexCapacity ?? 1 << 20;              // 顶点数
  let solidIndexCapacity = options.solidIndexCapacity ?? 2 << 20;      // 索引数
  let translucentIndexCapacity = options.translucentIndexCapacity ?? 1 << 19;

  let vertexUsed = 0, solidUsed = 0, translucentUsed = 0;
  let vertexLive = 0, solidLive = 0, translucentLive = 0;
  const freeVert = [];
  const freeSolid = [];
  const freeTrans = [];

  function addFree(list, offset, size) {
    if (!(size > 0)) return;
    let i = 0;
    while (i < list.length && list[i].offset < offset) i++;
    list.splice(i, 0, { offset, size });
    for (let j = list.length - 1; j > 0; j--) {
      const a = list[j - 1];
      const b = list[j];
      if (a.offset + a.size >= b.offset) {
        a.size = Math.max(a.size, b.offset + b.size - a.offset);
        list.splice(j, 1);
      }
    }
  }

  function findSlot(list, size, used, capacity) {
    if (!(size > 0)) return { fromFree: false, offset: used };
    for (let i = 0; i < list.length; i++) {
      if (list[i].size >= size) return { fromFree: true, freeIndex: i, offset: list[i].offset };
    }
    if (used + size <= capacity) return { fromFree: false, offset: used };
    return null;
  }

  function commitSlot(list, slot, size) {
    if (!(size > 0) || !slot.fromFree) return;
    const f = list[slot.freeIndex];
    if (f.size === size) list.splice(slot.freeIndex, 1);
    else {
      f.offset += size;
      f.size -= size;
    }
  }

  const api = {
    get vertexCapacity() { return vertexCapacity; },
    get solidIndexCapacity() { return solidIndexCapacity; },
    get translucentIndexCapacity() { return translucentIndexCapacity; },
    get vertexUsed() { return vertexUsed; },
    get solidIndexUsed() { return solidUsed; },
    get translucentIndexUsed() { return translucentUsed; },
    get vertexLive() { return vertexLive; },
    get solidIndexLive() { return solidLive; },
    get translucentIndexLive() { return translucentLive; },

    /** GPU 缓冲需要的字节数（单个交错顶点缓冲 + 索引缓冲）。 */
    vertexBufferBytes() {
      return [vertexCapacity * VERTEX_STRIDE];
    },
    indexBufferBytes() {
      return solidIndexCapacity * INDEX_BYTES + translucentIndexCapacity * INDEX_BYTES;
    },
    /** 半透明索引放在索引缓冲的后半段，便于一次 setIndexBuffer。 */
    translucentIndexBase() { return solidIndexCapacity; },

    /** 分配一段：顶点区 + 实体索引区 + 半透明索引区。空间不足返回 null（由调用方决定扩容/整理）。 */
    allocate(vertexCount, solidIndexCount, translucentIndexCount) {
      const v = findSlot(freeVert, vertexCount, vertexUsed, vertexCapacity);
      const s = findSlot(freeSolid, solidIndexCount, solidUsed, solidIndexCapacity);
      const t = findSlot(freeTrans, translucentIndexCount, translucentUsed, translucentIndexCapacity);
      if (!v || !s || !t) return null;
      commitSlot(freeVert, v, vertexCount);
      commitSlot(freeSolid, s, solidIndexCount);
      commitSlot(freeTrans, t, translucentIndexCount);
      if (!v.fromFree) vertexUsed += vertexCount;
      if (!s.fromFree) solidUsed += solidIndexCount;
      if (!t.fromFree) translucentUsed += translucentIndexCount;
      const handle = {
        vertexOffset: v.offset,
        vertexCount,
        solidFirst: s.offset,
        solidCount: solidIndexCount,
        translucentFirst: t.offset,
        translucentCount: translucentIndexCount,
      };
      vertexLive += vertexCount;
      solidLive += solidIndexCount;
      translucentLive += translucentIndexCount;
      return handle;
    },

    /**
     * 释放：区间清零后进入 free-list 复用；返回需要在 GPU 索引缓冲上清零的区间
     *（数组下标已是索引缓冲内的绝对位置）。
     */
    free(handle) {
      vertexLive -= handle.vertexCount;
      solidLive -= handle.solidCount;
      translucentLive -= handle.translucentCount;
      addFree(freeVert, handle.vertexOffset, handle.vertexCount);
      addFree(freeSolid, handle.solidFirst, handle.solidCount);
      addFree(freeTrans, handle.translucentFirst, handle.translucentCount);
      const ranges = [];
      if (handle.solidCount) ranges.push([handle.solidFirst, handle.solidCount]);
      if (handle.translucentCount) ranges.push([solidIndexCapacity + handle.translucentFirst, handle.translucentCount]);
      return ranges;
    },

    /**
     * 分配失败时的决策：容量按**存活量**右尺寸化（扩容或缩容），并夹在硬上限内。
     * 用 live 而不是 used —— 后者含空洞与历史重网格的累计，会把容量一路推高（实测 1.4 GB → 设备报错）。
     */
    planOnFailure() {
      const solidWaste = (solidUsed - solidLive) / solidIndexCapacity;
      const translucentWaste = (translucentUsed - translucentLive) / translucentIndexCapacity;
      const vertexWaste = (vertexUsed - vertexLive) / vertexCapacity;
      const target = {
        vertexCapacity: Math.min(roundUp(vertexLive * HEADROOM), MAX_VERTEX_CAPACITY),
        solidIndexCapacity: Math.min(roundUp(solidLive * HEADROOM), MAX_INDEX_CAPACITY),
        translucentIndexCapacity: Math.min(roundUp(translucentLive * HEADROOM), MAX_INDEX_CAPACITY),
      };
      if (Math.max(solidWaste, translucentWaste, vertexWaste) > COMPACT_WASTE_RATIO) {
        return { action: 'compact', ...target };
      }
      return { action: 'grow', ...target };
    },

    /** 设定容量（扩容/缩容，按 planOnFailure 的目标）。 */
    resize(next) {
      if (next.vertexCapacity) vertexCapacity = next.vertexCapacity;
      if (next.solidIndexCapacity) solidIndexCapacity = next.solidIndexCapacity;
      if (next.translucentIndexCapacity) translucentIndexCapacity = next.translucentIndexCapacity;
    },

    /** 整理：清空竞技场（调用方随后要重新网格化全部段）。 */
    compact() {
      vertexUsed = 0; solidUsed = 0; translucentUsed = 0;
      vertexLive = 0; solidLive = 0; translucentLive = 0;
      freeVert.length = 0; freeSolid.length = 0; freeTrans.length = 0;
    },

    /** 供调试/HUD 的概览。 */
    stats() {
      return {
        vertexUsed, vertexCapacity, vertexLive,
        solidUsed, solidIndexCapacity, solidLive,
        translucentUsed, translucentIndexCapacity, translucentLive,
      };
    },

    /**
     * 把一组已按分配顺序排列的段合并成尽量少的 draw。
     * 输入 [{firstIndex, indexCount, ...}]，输出 [{firstIndex, indexCount, items:[...]}]。
     */
    mergeRuns(items) {
      const runs = [];
      for (const item of items) {
        if (!item.indexCount) continue;
        const last = runs[runs.length - 1];
        if (last && last.firstIndex + last.indexCount === item.firstIndex) {
          last.indexCount += item.indexCount;
          last.items.push(item);
        } else {
          runs.push({ firstIndex: item.firstIndex, indexCount: item.indexCount, items: [item] });
        }
      }
      return runs;
    },
  };

  return api;
}
