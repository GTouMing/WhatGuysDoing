// entityrender.js — M3a：实体按 part 实例化的纯数据层。
//
// 当前静态阶段：
//   每个 typeKey → parts[] 模板（part 的顶点/UV/索引，模型单位）
//   每个实体 → 一个世界矩阵（column-major，含 1/16 缩放）
// 同一 part 的所有实体实例共享模板，draw 时只换 instance 矩阵。
// M3b 的四肢/头部动画会在这里把 part 的局部矩阵乘进实例矩阵，模板不变。
import { entityPartsFor, entityTexturePath, bakeEntityModel, familyTexturePath } from './entitymodel.js';

const DEG = Math.PI / 180;

// DyeColor 0..15 的 diffuse 颜色（原版 sheep fur tint）。
const SHEEP_COLORS = [
  [1.0, 1.0, 1.0, 1],       // white
  [0.976, 0.502, 0.114, 1], // orange
  [0.784, 0.263, 0.639, 1], // magenta
  [0.408, 0.639, 0.925, 1], // light_blue
  [0.976, 0.859, 0.153, 1], // yellow
  [0.443, 0.784, 0.153, 1], // lime
  [0.953, 0.565, 0.682, 1], // pink
  [0.259, 0.259, 0.259, 1], // gray
  [0.608, 0.608, 0.608, 1], // light_gray
  [0.153, 0.443, 0.541, 1], // cyan
  [0.392, 0.208, 0.592, 1], // purple
  [0.208, 0.259, 0.784, 1], // blue
  [0.443, 0.259, 0.153, 1], // brown
  [0.235, 0.443, 0.129, 1], // green
  [0.541, 0.129, 0.129, 1], // red
  [0.153, 0.153, 0.153, 1], // black
];

function tintColor(kind, entity) {
  const bits = (entity && entity.variantBits) || 0;
  if (kind === 'sheep') return SHEEP_COLORS[bits & 15] || SHEEP_COLORS[0];
  if (kind === 'wolf_collar') return SHEEP_COLORS[(bits >> 4) & 15] || SHEEP_COLORS[0];
  if (kind === 'cat_collar') return SHEEP_COLORS[(bits >> 8) & 15] || SHEEP_COLORS[0];
  if (kind === 'tropical_base') return SHEEP_COLORS[(bits >> 4) & 15] || SHEEP_COLORS[0];
  if (kind === 'tropical_pattern') return SHEEP_COLORS[(bits >> 8) & 15] || SHEEP_COLORS[0];
  if (kind && (kind === 'leather' || kind.startsWith('leather_'))) {
    const slot = kind === 'leather' ? 'chest' : kind.slice('leather_'.length);
    const index = { head: 0, chest: 1, legs: 2, feet: 3 }[slot] ?? 1;
    const raw = (entity && entity.leatherColors && entity.leatherColors[index]) || 0;
    const c = raw ? (raw & 0xFFFFFF) : 0xA06540;
    return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, 1];
  }
  return [1, 1, 1, 1];
}

function variantIndex(typeKey, entity) {
  const bits = (entity && entity.variantBits) || 0;
  if (typeKey === 'minecraft:cat') return (bits >> 12) & 15;
  if (typeKey === 'minecraft:wolf') {
    const flags = (entity && entity.flags) || 0;
    const state = (flags & FLAG_ANGRY) ? 2 : ((flags & FLAG_TAME) ? 1 : 0);
    return (((bits >> 16) & 15) * 3 + state);
  }
  if (typeKey === 'minecraft:horse') return (bits >> 20) & 15;
  if (typeKey === 'minecraft:parrot') return (bits >> 24) & 15;
  if (typeKey === 'minecraft:fox' || typeKey === 'minecraft:mooshroom') {
    if (typeKey === 'minecraft:fox') {
      const sleep = ((entity && entity.flags) || 0) & FLAG_SLEEPING ? 2 : 0;
      return (bits & 1) + sleep;
    }
    return bits & 15;
  }
  if (typeKey === 'minecraft:rabbit') return bits & 15;
  if (typeKey === 'minecraft:llama' || typeKey === 'minecraft:axolotl') return bits & 15;
  if (typeKey === 'minecraft:panda') return bits & 15;
  if (typeKey === 'minecraft:shulker' || typeKey === 'minecraft:frog') return bits & 15;
  if (typeKey === 'minecraft:tropical_fish') return (bits >> 12) & 1;
  return 0;
}

const FLAG_TAME = 1 << 8;
const FLAG_CROUCHING = 1 << 0;
const FLAG_SHEARED = 1 << 9;
const FLAG_ANGRY = 1 << 10;
const FLAG_SADDLED = 1 << 11;
const FLAG_FALL_FLYING = 1 << 5;
const FLAG_SLEEPING = 1 << 12;
const FLAG_BABY = 1 << 13;
const FLAG_SITTING = 1 << 14;

function conditionMatches(condition, entity) {
  if (!condition) return true;
  const flags = (entity && entity.flags) || 0;
  if (condition === 'tame') return (flags & FLAG_TAME) !== 0;
  if (condition === 'not_sheared') return (flags & FLAG_SHEARED) === 0;
  if (condition.startsWith('horse_marking_')) {
    const marking = Number(condition.slice('horse_marking_'.length));
    return (((entity && entity.variantBits) || 0) >> 28 & 15) === marking;
  }
  if (condition === 'horse_saddle') return ((((entity && entity.variantBits) || 0) >> 24) & 1) !== 0;
  if (condition === 'saddled') return (flags & FLAG_SADDLED) !== 0;
  if (condition.startsWith('villager_profession_')) {
    return ((((entity && entity.variantBits) || 0) & 31)) === Number(condition.slice('villager_profession_'.length));
  }
  if (condition.startsWith('villager_type_')) {
    return ((((entity && entity.variantBits) || 0) >> 5) & 7) === Number(condition.slice('villager_type_'.length));
  }
  if (condition.startsWith('villager_level_')) {
    return ((((entity && entity.variantBits) || 0) >> 8) & 7) === Number(condition.slice('villager_level_'.length));
  }
  if (condition.startsWith('horse_armor_')) {
    const material = Number(condition.slice('horse_armor_'.length));
    return ((((entity && entity.variantBits) || 0) >> 25) & 7) === material;
  }
  if (condition.startsWith('armor_')) {
    const m = /^armor_(head|chest|legs|feet)_(\d+)$/.exec(condition);
    if (!m) return true;
    const shift = { head: 0, chest: 4, legs: 8, feet: 12 }[m[1]];
    return (((entity && entity.equipment) || 0) >> shift & 15) === Number(m[2]);
  }
  if (condition.startsWith('tropical_pattern_')) {
    const m = /^tropical_pattern_(\d+)_(\d+)$/.exec(condition);
    if (!m) return true;
    const bits = (entity && entity.variantBits) || 0;
    return ((bits >> 12) & 1) === Number(m[1]) && (bits & 7) === Number(m[2]);
  }
  if (condition.startsWith('llama_swag_')) {
    return (((entity && entity.variantBits) || 0) >> 4 & 31) === Number(condition.slice('llama_swag_'.length));
  }
  return true;
}

/** column-major mat4 乘法（WGSL mat4x4f 约定）。 */
function mul(a, b) {
  const r = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      r[col * 4 + row] = a[row] * b[col * 4]
        + a[4 + row] * b[col * 4 + 1]
        + a[8 + row] * b[col * 4 + 2]
        + a[12 + row] * b[col * 4 + 3];
    }
  }
  return r;
}

const translate = (x, y, z) => new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1,
]);

const rotX = (a) => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
};

const rotY = (a) => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
};

const rotZ = (a) => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
};

function pivotDelta(pivot, rotation) {
  return mul(mul(translate(pivot[0], pivot[1], pivot[2]), rotation),
    translate(-pivot[0], -pivot[1], -pivot[2]));
}

function partRole(name) {
  const n = name.toLowerCase();
  if (n === 'cape') return 'cape';
  if (n === 'body') return 'body';
  if (n.includes('tail')) return 'tail';
  if (n.includes('wing')) return 'wing';
  if (n === 'head' || n === 'headparts' || n === 'mane' || n === 'upper_mouth'
      || n === 'right_ear' || n === 'left_ear') return 'head';
  if (n.includes('leg') || n.includes('haunch') || n.includes('thigh')) return 'leg';
  if (n.includes('arm') || n.includes('sleeve') || n.includes('hand')) return 'arm';
  return null;
}

/** part 在当前实体状态下的局部动画矩阵（模型空间，未乘实体世界矩阵）。 */
function partAnimationMatrix(part, entity, time) {
  if (!part.pivot || !part.role) return null;
  const flags = (entity && entity.flags) || 0;
  if ((flags & FLAG_SITTING) !== 0) {
    let rotation;
    if (part.role === 'body') rotation = rotX(-0.55);
    else if (part.role === 'tail') rotation = rotX(0.7);
    else if (part.role === 'leg') rotation = rotX(1.0);
    else if (part.role === 'head') rotation = rotX(0.3);
    else return null;
    return pivotDelta(part.pivot, rotation);
  }
  if ((flags & FLAG_CROUCHING) !== 0) {
    let rotation;
    if (part.role === 'body') rotation = rotX(0.45);
    else if (part.role === 'head') rotation = rotX(0.25);
    else if (part.role === 'arm') rotation = rotX(0.5);
    else if (part.role === 'leg') rotation = rotX(-0.3);
    else return null;
    return pivotDelta(part.pivot, rotation);
  }
  let rotation;
  if (part.role === 'head') {
    const headYaw = entity.headYaw ?? entity.yaw ?? 0;
    const rel = ((headYaw - (entity.yaw || 0) + 540) % 360) - 180;
    const clamped = Math.max(-90, Math.min(90, rel));
    const pitch = entity.pitch || 0;
    rotation = mul(rotY(-clamped * DEG), rotX(-pitch * DEG));
  } else if (part.role === 'leg') {
    const amp = Math.min(1, Math.max(0, (entity.limbSwing || 0) / 255)) * 0.9;
    if (amp <= 1e-6) return null;
    const phase = time * 8 + (entity.netId || 0) * 0.7 + (part.side ? Math.PI : 0);
    rotation = rotX(Math.sin(phase) * amp);
  } else if (part.role === 'wing') {
    const flags = (entity && entity.flags) || 0;
    if ((flags & FLAG_FALL_FLYING) === 0) return null;
    rotation = rotZ((part.side ? 1 : -1) * (Math.PI / 2));
  } else if (part.role === 'cape') {
    const flags = (entity && entity.flags) || 0;
    const walk = Math.min(1, Math.max(0, (entity.limbSwing || 0) / 255));
    const fall = (flags & FLAG_FALL_FLYING) !== 0;
    if (!fall && walk <= 1e-6) return null;
    const phase = time * 6 + (entity.netId || 0) * 0.5;
    rotation = rotX((fall ? 0.9 : 0.45) + Math.sin(phase) * walk * 0.25);
  } else {
    // arm：挥手优先，叠加走路摆动
    const swing = Math.max(0, Math.min(1, (entity.swingProgress || 0) / 255));
    const walk = Math.min(1, Math.max(0, (entity.limbSwing || 0) / 255)) * 0.5;
    const phase = time * 8 + (entity.netId || 0) * 0.7 + (part.side ? Math.PI : 0);
    const angle = -Math.sin(swing * Math.PI) * 1.5 + Math.sin(phase) * walk;
    rotation = rotX(angle);
  }
  return pivotDelta(part.pivot, rotation);
}

/**
 * 实体世界矩阵（column-major，WGSL mat4x4f）。
 * 与 entitymesh 的变换完全一致：模型单位 1/16，绕 Y 旋转 (180-yaw)，平移到实体位置。
 */
export function entityWorldMatrix(entity) {
  const rad = (180 - ((entity && entity.yaw) || 0)) * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const scale = (entity && (entity.flags & FLAG_BABY)) ? 0.5 / 16 : 1 / 16;
  const x = entity ? entity.x : 0;
  const y = entity ? entity.y : 0;
  const z = entity ? entity.z : 0;
  const base = new Float32Array([
    cos * scale, 0, -sin * scale, 0,
    0, scale, 0, 0,
    sin * scale, 0, cos * scale, 0,
    x, y, z, 1,
  ]);
  return (entity && (entity.flags & ((1 << 2) | FLAG_SLEEPING)))
    ? mul(base, rotX(-Math.PI / 2)) : base;
}

function interleave(positions, uvs) {
  const out = new Float32Array(positions.length / 3 * 5);
  for (let i = 0; i < positions.length / 3; i++) {
    out[i * 5] = positions[i * 3];
    out[i * 5 + 1] = positions[i * 3 + 1];
    out[i * 5 + 2] = positions[i * 3 + 2];
    out[i * 5 + 3] = uvs[i * 2];
    out[i * 5 + 4] = uvs[i * 2 + 1];
  }
  return out;
}

/**
 * 为一个实体类型集合建 part 模板。
 * @param bundle entitybundle.json
 * @param typeKeys Map<typeId, "minecraft:pig">
 * @param uvRectFor texturePath → [u0,v0,u1,v1]（图集空间）
 * @returns Map<typeKey, { modelKey, parts: [{name, vertices, indices, ...}], quadCount }>
 */
export function buildEntityPartTemplates(bundle, typeKeys, uvRectFor, options = {}) {
  const templates = new Map();
  const keys = new Set(typeKeys ? typeKeys.values() : []);
  for (const typeKey of keys) {
    const info = entityPartsFor(bundle, typeKey);
    if (!info || !Array.isArray(info.parts) || !info.parts.length) continue;
    const model = bundle.models[info.modelKey];
    const baseTexture = model && model.textures ? entityTexturePath(model, '#0') : null;

    const addVariant = (key, modelKey, partList, partModel, baseTex, variantTex) => {
      const pivots = (partModel && partModel.pivots) || {};
      const parts = [];
      let quadCount = 0;
      for (let pi = 0; pi < partList.length; pi++) {
        const part = partList[pi];
        const name = part.name || '';
        const pivot = part.pivot || pivots[name] || null;
        const role = partRole(name);
        const side = !!pivot && role && /left/i.test(name);
        const tint = part.tint || null;
        const condition = part.condition || null;
        const positions = [];
        const uvs = [];
        const indices = [];
        let partQuads = 0;
        for (const quad of part.quads || []) {
          const tex = baseTex && quad.texture === baseTex && variantTex
            ? variantTex
            : quad.texture;
          const rect = uvRectFor(tex);
          if (!rect) continue;
          const base = positions.length / 3;
          const du = rect[2] - rect[0];
          const dv = rect[3] - rect[1];
          for (const v of quad.verts) {
            positions.push(v[0], v[1], v[2]);
            uvs.push(rect[0] + (v[3] / 16) * du, rect[1] + (v[4] / 16) * dv);
          }
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          partQuads++;
        }
        if (!partQuads) continue;
        quadCount += partQuads;
        parts.push({
          name,
          pivot,
          role,
          side,
          tint,
          condition,
          vertices: interleave(positions, uvs),
          indices: new Uint32Array(indices),
          vertexCount: positions.length / 3,
          indexCount: indices.length,
          quadCount: partQuads,
        });
      }
      if (parts.length) {
        templates.set(key, { key, modelKey, parts, quadCount });
      }
    };

    if (typeKey === 'minecraft:player') {
      addVariant(`${typeKey}|0`, info.modelKey, info.parts, model, baseTexture, baseTexture);
      const playerSkins = Array.isArray(options.playerSkins) ? options.playerSkins : [];
      const hasTexture = typeof options.hasTexture === 'function' ? options.hasTexture : () => true;
      playerSkins.forEach((skin, i) => {
        const skinModelKey = skin && skin.model === 'slim' ? 'player_slim' : 'player';
        const skinModel = bundle.models[skinModelKey] || model;
        const skinParts = skinModelKey === info.modelKey
          ? info.parts
          : bakeEntityModel(skinModel, familyTexturePath(skinModelKey));
        const skinBase = skinModel.textures ? entityTexturePath(skinModel, '#0') : baseTexture;
        const skinTexture = skin && skin.path ? skin.path : (typeof skin === 'string' ? skin : null);
        const capeModel = bundle.models.player_cape;
        const capePivot = capeModel && capeModel.pivots ? capeModel.pivots.cape : null;
        const capePath = skin && skin.cape && hasTexture(skin.cape) ? skin.cape : null;
        const capeParts = capePath && capeModel
          ? bakeEntityModel(capeModel, capePath).map(part => ({
            ...part,
            pivot: capePivot,
            quads: part.quads.map(quad => ({ ...quad, texture: capePath })),
          }))
          : [];
        const variantParts = capeParts.length ? [...skinParts, ...capeParts] : skinParts;
        addVariant(`${typeKey}|${i + 1}`, skinModelKey, variantParts, skinModel, skinBase, skinTexture);
      });
      continue;
    }

    const variantTextures = model && Array.isArray(model.variantTextures) && model.variantTextures.length
      ? model.variantTextures
      : [baseTexture];
    for (let vi = 0; vi < variantTextures.length; vi++) {
      const key = `${typeKey}|${vi}`;
      const variantTexture = variantTextures[vi]
        ? (entityTexturePath(model, variantTextures[vi]) || baseTexture)
        : baseTexture;
      addVariant(key, info.modelKey, info.parts, model, baseTexture, variantTexture);
    }
  }
  return templates;
}

/**
 * 按当前实体列表生成每 part 的实例矩阵。
 * @returns Map<`${typeKey}\t${partIndex}`, { matrices: Float32Array, count }>
 */
export function buildEntityPartInstances(templates, entities, typeKeys, time = 0, options = {}) {
  const buckets = new Map();
  for (const entity of entities || []) {
    const typeKey = typeKeys.get(entity.typeId);
    const vi = typeKey === 'minecraft:player' && typeof options.skinIndexOf === 'function'
      ? options.skinIndexOf(entity)
      : variantIndex(typeKey, entity);
    const template = templates.get(`${typeKey}|${vi}`) || templates.get(`${typeKey}|0`);
    if (!template) continue;
    const world = entityWorldMatrix(entity);
    for (let pi = 0; pi < template.parts.length; pi++) {
      const part = template.parts[pi];
      if (!conditionMatches(part.condition, entity)) continue;
      const anim = partAnimationMatrix(part, entity, time);
      const matrix = anim ? mul(world, anim) : world;
      const key = `${template.key}\t${pi}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { matrices: [], colors: [], count: 0 };
        buckets.set(key, bucket);
      }
      bucket.matrices.push(matrix);
      bucket.colors.push(tintColor(part.tint, entity));
      bucket.count++;
    }
  }
  const out = new Map();
  for (const [key, bucket] of buckets) {
    const flat = new Float32Array(bucket.count * 16);
    const colors = new Float32Array(bucket.count * 4);
    for (let i = 0; i < bucket.count; i++) {
      flat.set(bucket.matrices[i], i * 16);
      colors.set(bucket.colors[i], i * 4);
    }
    out.set(key, { matrices: flat, colors, count: bucket.count });
  }
  return out;
}
