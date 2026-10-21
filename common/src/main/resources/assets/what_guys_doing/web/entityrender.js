// entityrender.js — M3a：实体按 part 实例化的纯数据层。
//
// 当前静态阶段：
//   每个 typeKey → parts[] 模板（part 的顶点/UV/索引，模型单位）
//   每个实体 → 一个世界矩阵（column-major，含 1/16 缩放）
// 同一 part 的所有实体实例共享模板，draw 时只换 instance 矩阵。
// M3b 的四肢/头部动画会在这里把 part 的局部矩阵乘进实例矩阵，模板不变。
import { entityPartsFor } from './entitymodel.js';

const DEG = Math.PI / 180;

/**
 * 实体世界矩阵（column-major，WGSL mat4x4f）。
 * 与 entitymesh 的变换完全一致：模型单位 1/16，绕 Y 旋转 (180-yaw)，平移到实体位置。
 */
export function entityWorldMatrix(entity) {
  const rad = (180 - ((entity && entity.yaw) || 0)) * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const x = entity ? entity.x : 0;
  const y = entity ? entity.y : 0;
  const z = entity ? entity.z : 0;
  return new Float32Array([
    cos / 16, 0, -sin / 16, 0,
    0, 1 / 16, 0, 0,
    sin / 16, 0, cos / 16, 0,
    x, y, z, 1,
  ]);
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
export function buildEntityPartTemplates(bundle, typeKeys, uvRectFor) {
  const templates = new Map();
  const keys = new Set(typeKeys ? typeKeys.values() : []);
  for (const typeKey of keys) {
    const info = entityPartsFor(bundle, typeKey);
    if (!info || !Array.isArray(info.parts) || !info.parts.length) continue;
    const parts = [];
    let quadCount = 0;
    for (let pi = 0; pi < info.parts.length; pi++) {
      const part = info.parts[pi];
      const positions = [];
      const uvs = [];
      const indices = [];
      let partQuads = 0;
      for (const quad of part.quads || []) {
        const rect = uvRectFor(quad.texture);
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
        name: part.name || '',
        vertices: interleave(positions, uvs),
        indices: new Uint32Array(indices),
        vertexCount: positions.length / 3,
        indexCount: indices.length,
        quadCount: partQuads,
      });
    }
    if (parts.length) {
      templates.set(typeKey, { modelKey: info.modelKey, parts, quadCount });
    }
  }
  return templates;
}

/**
 * 按当前实体列表生成每 part 的实例矩阵。
 * @returns Map<`${typeKey}\t${partIndex}`, { matrices: Float32Array, count }>
 */
export function buildEntityPartInstances(templates, entities, typeKeys) {
  const buckets = new Map();
  for (const entity of entities || []) {
    const typeKey = typeKeys.get(entity.typeId);
    const template = templates.get(typeKey);
    if (!template) continue;
    const matrix = entityWorldMatrix(entity);
    for (let pi = 0; pi < template.parts.length; pi++) {
      const key = `${typeKey}\t${pi}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { matrices: [], count: 0 };
        buckets.set(key, bucket);
      }
      bucket.matrices.push(matrix);
      bucket.count++;
    }
  }
  const out = new Map();
  for (const [key, bucket] of buckets) {
    const flat = new Float32Array(bucket.count * 16);
    for (let i = 0; i < bucket.count; i++) flat.set(bucket.matrices[i], i * 16);
    out.set(key, { matrices: flat, count: bucket.count });
  }
  return out;
}
