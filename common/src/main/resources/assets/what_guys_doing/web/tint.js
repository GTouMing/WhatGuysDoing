// tint.js — 面 tintindex 对应的染色来源。M1 先用固定默认色（平原色），
// 逐群系颜色留到 M1c（需要服务端下发每个群系的最终颜色，才能正确处理沼泽这类 override）。

const DEFAULTS = {
  grass: [0x91 / 255, 0xBD / 255, 0x59 / 255],
  foliage: [0x59 / 255, 0xAE / 255, 0x30 / 255],
  water: [0x3F / 255, 0x76 / 255, 0xE4 / 255],
  stem: [0xE0 / 255, 0xC7 / 255, 0x1C / 255],
};

const LEAVES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'azalea', 'flowering_azalea', 'pale_oak'];

const KIND = new Map();
for (const name of ['grass_block', 'grass', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'sugar_cane', 'pink_petals', 'wildflowers']) {
  KIND.set(name, 'grass');
}
for (const wood of LEAVES) {
  KIND.set(`${wood}_leaves`, 'foliage');
}
KIND.set('vine', 'foliage');
for (const name of ['water', 'water_cauldron', 'bubble_column', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'lily_pad']) {
  KIND.set(name, 'water');
}
for (const name of ['attached_melon_stem', 'attached_pumpkin_stem', 'melon_stem', 'pumpkin_stem']) {
  KIND.set(name, 'stem');
}

/** 方块名 → 染色种类 的记忆化（tintFor 每个四边形都会调用，别在里面做字符串解析） */
const KIND_CACHE = new Map();

/**
 * @param blockName 形如 minecraft:grass_block
 * @param tintIndex 面的 tintindex
 * @param biomeId   M1 未使用（等 M1c 的逐群系颜色）
 * @returns [r,g,b]（0..1）或 null（不染色）
 */
export function tintFor(blockName, tintIndex, biomeId) {
  void biomeId;
  if (tintIndex < 0) return null;
  let kind = KIND_CACHE.get(blockName);
  if (kind === undefined) {
    const short = blockName.includes(':') ? blockName.slice(blockName.indexOf(':') + 1) : blockName;
    kind = KIND.get(short) ?? null;
    KIND_CACHE.set(blockName, kind);
  }
  return kind ? DEFAULTS[kind] : null;
}

/** 供 HUD / 调试：这张表覆盖了多少方块 */
export function tintKindCount() {
  return KIND.size;
}
