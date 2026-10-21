// entitymesh.js — 实体几何（纯函数，可测）。
//
// 输出形状与 mesher 完全一致（positions/uvs/tints/lights/aos/indices...），
// 因此可以直接走同一套 interleaveMesh + 顶点管线，不需要第二份顶点格式。
//
// 变换顺序（vanilla 约定）：
//   1) 模型坐标是 1/16 方块，原点在实体**脚底中心** → 乘 1/16
//   2) 绕 Y 旋转 (180° − yaw)：模型正面朝 −z，而 yaw=0 的实体朝 +z
//      （yaw=90 = 朝西/−x，代入可验证：−z 转 90° → −x ✓）
//   3) 平移到 (x, y, z)
// 旋转保持顶点顺序 → 绕序不变，所以与地形共用同一个 frontFace 设置。
import { entityPartsFor } from './entitymodel.js';

const DEG = Math.PI / 180;

export function buildEntityMesh(bundle, entities, typeKeys, uvRectFor, materialOf, partsFor = entityPartsFor) {
  const positions = [];
  const uvs = [];
  const tints = [];
  const lights = [];
  const aos = [];
  const indices = [];
  const indicesTranslucent = [];
  let quads = 0;
  let skipped = 0;

  for (const e of entities) {
    const key = typeKeys.get(e.typeId);
    if (!key) { skipped++; continue; }
    const info = partsFor(bundle, key);
    if (!info) { skipped++; continue; }
    // BlueMapEntities 的模型是 **y 向上**（头部 y 大于身体），与地形一致，不需要翻转。
    // （自研生成器的原版模型是 y 向下，那版曾在这里加过翻转，已回退。）
    const rad = (180 - (e.yaw || 0)) * DEG;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    for (const part of info.parts) {
      for (const quad of part.quads) {
        const rect = uvRectFor(quad.texture);
        if (!rect) continue;
        const base = positions.length / 3;
        const du = rect[2] - rect[0];
        const dv = rect[3] - rect[1];
        for (const v of quad.verts) {
          const mx = v[0] / 16;
          const my = v[1] / 16;
          const mz = v[2] / 16;
          // rotateY(rad)
          const wx = mx * cos + mz * sin;
          const wz = -mx * sin + mz * cos;
          positions.push(e.x + wx, e.y + my, e.z + wz);
          uvs.push(rect[0] + (v[3] / 16) * du, rect[1] + (v[4] / 16) * dv);
          tints.push(1, 1, 1);
          lights.push(1);      // M2 先用满亮度：实体光照（方块光/天空光）是下一步
          aos.push(1);         // 实体不做 AO
        }
        // 半透明面也并入同一组索引：M2 阶段"画出来"优先于正确混合。
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        quads++;
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    tints: new Float32Array(tints),
    lights: new Float32Array(lights),
    aos: new Float32Array(aos),
    indices: new Uint32Array(indices),
    indicesTranslucent: new Uint32Array(indicesTranslucent),
    vertexCount: positions.length / 3,
    quadCount: quads,
    skipped,
  };
}
