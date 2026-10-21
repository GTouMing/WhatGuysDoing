// entitymodel.js — 把生成的实体模型烘成可直接绘制的四边形。
//
// 两种格式：
//   generated-wgd-2（当前）：显式 parts[].cubes[].quads[]，每个 quad 自带 4 个变换后的顶点
//     与 4 对归一化 uv。生成器已经把 part 旋转/缩放/父链/y-up 全部烘进顶点，这里不再推断。
//   elements（旧 vendored BlueMap 格式）：保留兼容路径；新资源不会再用。
//
// 输出与方块 baker 保持同一坐标系：模型单位（1/16 方块），quad.verts 为 [x,y,z,u,v]，
// 其中 uv 已换回 0..16 空间，供 entitymesh / 图集使用。
import { DIR_ORDER, faceQuad } from './baker.js';

/** 模型里的贴图引用 → 资源路径。实体贴图在 textures/<值>.png。 */
export function entityTexturePath(model, ref) {
  if (!ref) return null;
  if (ref.startsWith('#')) {
    const resolved = model.textures ? model.textures[ref.slice(1)] : null;
    return resolved ? entityTexturePath(model, resolved) : null;
  }
  if (ref.includes(':')) return ref;
  return `minecraft:textures/${ref}.png`;
}

/** 旧 BlueMap 格式的 uv 是贴图像素；generated-wgd-2 的 uv 已经是归一化值。 */
export function scaleEntityUv(uv, textureSize) {
  const sx = (textureSize[0] || 16) / 16;
  const sy = (textureSize[1] || 16) / 16;
  return [uv[0] / sx, uv[1] / sy, uv[2] / sx, uv[3] / sy];
}

/**
 * 解析模型继承：旧格式的薄描述符只有 parent + textures。
 * generated-wgd-2 目前是平铺模型，没有 parent；这里保留通用合并。
 */
export function resolveEntityModel(models, key, seen = new Set()) {
  const model = models[key];
  if (!model) return null;
  if (!model.parent) return model;
  if (seen.has(key)) return model;
  seen.add(key);
  const parentKey = String(model.parent).replace(/^minecraft:/, '').replace(/^entity\//, '');
  const parent = resolveEntityModel(models, parentKey, seen);
  if (!parent) return model;
  return {
    ...parent,
    ...model,
    textures: { ...(parent.textures || {}), ...(model.textures || {}) },
    elements: model.elements || parent.elements,
    parts: model.parts || parent.parts,
    texture_size: model.texture_size || parent.texture_size,
  };
}

/**
 * 旧多变体模型的贴图回退约定；generated-wgd-2 有显式 textures，不再依赖它。
 */
export function familyTexturePath(modelKey) {
  const family = String(modelKey).split('/')[0];
  return `minecraft:textures/entity/${family}/${family}.png`;
}

function bakeGeneratedParts(model, fallback) {
  const parts = [];
  const addGroup = (group, fallbackTexture, textureSize) => {
    for (const part of group || []) {
      const quads = [];
      for (const cube of part.cubes || []) {
        for (const q of cube.quads || []) {
          if (!q || !Array.isArray(q.positions) || q.positions.length !== 4) continue;
          if (!Array.isArray(q.uvs) || q.uvs.length !== 4) continue;
          const texture = entityTexturePath(model, q.texture) || fallbackTexture || fallback;
          if (!texture) continue;

          // 原版实体贴图是 REPEAT 采样：鱼鳍/尾有小幅越界（±2px），Breeze 的风是整段滚动（v≈3）。
          // 静态图集没有逐贴图 repeat：小幅越界 clamp 到本贴图边缘；大幅重复（>1/4 贴图）跳过。
          let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
          for (const [u, v] of q.uvs) {
            minU = Math.min(minU, u); maxU = Math.max(maxU, u);
            minV = Math.min(minV, v); maxV = Math.max(maxV, v);
          }
          if (minU < -0.25 || maxU > 1.25 || minV < -0.25 || maxV > 1.25) {
            continue;
          }

          // 源模型/geo 的 UV 原样传递，不在消费端做 0.01 texel 守卫或 clamp。
          const verts = q.positions.map((p, i) => [
            p[0], p[1], p[2], q.uvs[i][0] * 16, q.uvs[i][1] * 16,
          ]);
          quads.push({
            dir: DIR_ORDER.indexOf(q.face),
            cull: -1,
            tint: -1,
            texture,
            verts,
          });
        }
      }
      if (quads.length) parts.push({ name: part.name || '', quads });
    }
  };
  addGroup(model.parts, fallback, model.texture_size);
  // RenderLayer 模型（羊毛外壳等）与基础模型一起渲染；层贴图由 layer.texture 兜底。
  for (const layer of model.layers || []) {
    addGroup(layer.parts, layer.texture || null, layer.texture_size || model.texture_size);
  }
  return parts;
}

function bakeLegacyElements(model, fallback) {
  const textureSize = model.texture_size || [16, 16];
  const parts = [];
  for (const element of model.elements || []) {
    const faces = element.faces || {};
    const quads = [];
    for (const faceName of DIR_ORDER) {
      const face = faces[faceName];
      if (!face) continue;
      const texture = entityTexturePath(model, face.texture) || fallback;
      if (!texture) continue;
      const scaledFace = face.uv ? { ...face, uv: scaleEntityUv(face.uv, textureSize) } : face;
      quads.push(faceQuad(element, faceName, scaledFace, texture, 0));
    }
    parts.push({ name: element.name || '', quads });
  }
  return parts;
}

/**
 * @param model    模型 JSON（generated-wgd-2 或旧 elements 格式）
 * @param fallback 解析不到贴图时的回退路径
 * @returns {Array<{name: string, quads: Array}>} 每个 part 一个条目；
 *          quad.verts 为 [x,y,z,u,v]，坐标/uv 都在 0..16 空间，y 向上。
 */
export function bakeEntityModel(model, fallback = null) {
  if (Array.isArray(model.parts)) {
    return bakeGeneratedParts(model, fallback);
  }
  return bakeLegacyElements(model, fallback);
}

/** entitystate → renderer 键（"minecraft:pig" → "pig"）。 */
export function rendererOf(state) {
  const part = state && Array.isArray(state.parts) ? state.parts[0] : null;
  if (!part || !part.renderer) return null;
  return String(part.renderer).replace(/^minecraft:/, '');
}

/** 原版里这些是 Java 渲染器子类，模型文件不带它们的名字 —— 用同族近似。 */
export const RENDERER_ALIASES = {
  donkey: 'horse',
  mule: 'horse',
  skeleton_horse: 'horse',
  zombie_horse: 'horse',
  trader_llama: 'llama',
  ocelot: 'cat',
};

/** 在模型表里挑模型键：优先 <renderer>/adult，其次裸键，再按文件名匹配变体。 */
export function pickModelKey(models, renderer) {
  if (!renderer) return null;
  if (models[`${renderer}/adult`]) return `${renderer}/adult`;
  if (models[renderer]) return renderer;
  const family = Object.keys(models).find(k => k.startsWith(renderer + '/'));
  if (family) return family;
  const variant = Object.keys(models).find(k => {
    const base = k.slice(k.lastIndexOf('/') + 1);
    return base === renderer || base.startsWith(renderer + '_');
  });
  if (variant) return variant;
  const alias = RENDERER_ALIASES[renderer];
  return alias ? pickModelKey(models, alias) : null;
}

/** entitystate 的 part 可能直接给模型（"minecraft:entity/allay"），也可能给 renderer。 */
export function modelKeyOfPart(part) {
  if (!part || !part.model) return null;
  return String(part.model).replace(/^minecraft:/, '').replace(/^entity\//, '');
}

/**
 * 实体类型键 → 可直接绘制的部件。
 * 返回 null 表示这个类型在 bundle 里没有模型，调用方据此计数。
 */
export function entityPartsFor(bundle, typeKey) {
  if (!bundle || !bundle.models || !typeKey) return null;
  const states = bundle.states || {};
  const short = String(typeKey).replace(/^minecraft:/, '');
  const state = states[typeKey] || states[short] || null;
  if (!state) {
    // Bedrock bundle 直接按实体 id 存模型；没有 entitystate 的类型也能直接解析。
    const model = bundle.models[short];
    if (!model) return null;
    const baked = bakeEntityModel(model, familyTexturePath(short));
    if (!baked.length) return null;
    return {
      renderer: null,
      modelKey: short,
      parts: baked,
      quads: baked.reduce((n, p) => n + p.quads.length, 0),
    };
  }
  const stateParts = state && Array.isArray(state.parts) && state.parts.length ? state.parts : [null];
  const parts = [];
  let quads = 0;
  let renderer = null;
  let modelKey = null;
  for (const part of stateParts) {
    const partRenderer = part && part.renderer
      ? String(part.renderer).replace(/^minecraft:/, '')
      : rendererOf({ parts: [part] });
    const key = (part && modelKeyOfPart(part)) || pickModelKey(bundle.models, partRenderer);
    if (!key) continue;
    let model = resolveEntityModel(bundle.models, key);
    let resolvedKey = key;
    if (!model) {
      // 旧 entitystates 写的是实体包路径（entity/cod/cod），新生成器输出扁平键（cod）。
      const base = key.slice(key.lastIndexOf('/') + 1);
      model = resolveEntityModel(bundle.models, base);
      if (model) resolvedKey = base;
    }
    if (!model) continue;
    const baked = bakeEntityModel(model, familyTexturePath(resolvedKey));
    if (!baked.length) continue;
    for (const p of baked) parts.push(p);
    quads += baked.reduce((n, p) => n + p.quads.length, 0);
    if (!renderer) renderer = partRenderer;
    if (!modelKey) modelKey = resolvedKey;
  }
  if (!parts.length) return null;
  return { renderer, modelKey, parts, quads };
}

/**
 * bundle 里所有模型引用到的贴图（去重，保持模型顺序）。
 * 图集必须覆盖全部模型，而不只是当前 entitystates。
 */
export function entityTexturePaths(bundle) {
  const paths = new Set();
  const models = bundle && bundle.models;
  if (!models) return [];
  for (const key of Object.keys(models)) {
    const model = resolveEntityModel(models, key);
    if (!model) continue;
    for (const part of bakeEntityModel(model, familyTexturePath(key))) {
      for (const quad of part.quads) paths.add(quad.texture);
    }
  }
  return [...paths];
}

/** 部件在模型单位空间里的包围盒（诊断/断言用）。 */
export function partBounds(part) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const quad of part.quads) {
    for (const v of quad.verts) {
      for (let i = 0; i < 3; i++) {
        if (v[i] < min[i]) min[i] = v[i];
        if (v[i] > max[i]) max[i] = v[i];
      }
    }
  }
  return { min, max };
}
