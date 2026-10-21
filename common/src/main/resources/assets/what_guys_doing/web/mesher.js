// mesher.js — 把 section 数据 + 烘焙模板组装成顶点/索引。不依赖 DOM，可在 Node 里回归。
//
// 顶点布局（9 × f32）：x, y, z, u, v, tintR, tintG, tintB, light
//   - 位置为**世界坐标**（省掉每 section 的 uniform，单 bind group 即可绘制）
//   - uv 已换算到图集空间（由注入的 uvRect 提供）
//   - light 为 max(方块光, 天空光)/15（M1 不做平滑光照，也不做昼夜因子）
// 索引每面 2 个三角形。M1 管线用 cullMode 'none'，绕序留到 M2 一并校准。

export const VERTEX_FLOATS = 9;

export const MATERIAL_SOLID = 0;        // 不透明 + cutout（仅 0/255 alpha）
export const MATERIAL_TRANSLUCENT = 1;  // 有半透明像素（水/冰/玻璃之类）

export const DIR_VECTORS = [
  [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0],
];

export function stateIdAt(section, x, y, z) {
  const index = (y << 8) | (z << 4) | x;
  // 增量方块（放置/破坏）不在原始压缩数据里：覆盖表优先于 palette 解码。
  // 以前增量写的是 section.ids，而这里读的是 indices+palette —— 两条路，增量永远看不到。
  if (section.overrides) {
    const overridden = section.overrides.get(index);
    if (overridden !== undefined) return overridden;
  }
  if (section.bits === 0) return section.palette[0] ?? 0;
  let value = 0;
  const base = index * section.bits;
  for (let b = 0; b < section.bits; b++) {
    const p = base + b;
    value |= ((section.indices[p >> 3] >> (p & 7)) & 1) << b;
  }
  return section.palette[value] ?? 0;
}

/** 面朝向明暗系数，顺序与 DIR_ORDER（down,up,north,south,west,east）一致 —— vanilla 的固定值。 */
export const FACE_BRIGHTNESS = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];

/**
 * AO 四档亮度（原版是 0.25/0.5/0.75/1，这里压缩到 0.55 起 —— 观察器要让暗角仍看得见细节）。
 * 索引 = vanilla 的遮挡档位 0..3。
 */
export const AO_LEVELS = [0.55, 0.7, 0.85, 1.0];

const AXIS_INDEX = { x: 0, y: 1, z: 2 };

/**
 * 由「面法线 + 顶点在本方块内的位置」推出该角的三个遮挡采样点（世界偏移）。
 *
 * 不写"6 面 × 4 角"的大表：顶点位置每轴的 0/16 已经确定了角朝哪边，
 * 面法线给出第三个轴，两个面内轴随之唯一 —— 不用表就不会和面朝向表错位。
 *
 * @returns [[dx,dy,dz] 边1, [dx,dy,dz] 边2, [dx,dy,dz] 角]
 */
export function cornerOcclusionOffsets(dir, vertex) {
  const n = DIR_VECTORS[dir];
  const nAxis = n[0] !== 0 ? 0 : (n[1] !== 0 ? 1 : 2);
  const inPlane = [0, 1, 2].filter(a => a !== nAxis);
  const step = new Array(3).fill(0);
  step[nAxis] = n[nAxis];
  const offsets = [];
  for (const axis of inPlane) {
    const sign = vertex[axis] > 8 ? 1 : -1;      // 顶点在 0..16 空间；0 → 负侧，16 → 正侧
    const d = step.slice();
    d[axis] = sign;
    offsets.push(d);
  }
  const corner = step.slice();
  for (const axis of inPlane) corner[axis] = vertex[axis] > 8 ? 1 : -1;
  offsets.push(corner);
  return offsets;   // [边1, 边2, 角]
}

/** 该格 light = max(方块光, 天空光) / 15 */
export function lightAt(section, x, y, z) {
  const index = (y << 8) | (z << 4) | x;
  const blockByte = section.blockLight[index >> 1];
  const skyByte = section.skyLight[index >> 1];
  const blockLight = (index & 1) === 0 ? blockByte & 15 : blockByte >> 4;
  const skyLight = (index & 1) === 0 ? skyByte & 15 : skyByte >> 4;
  return Math.max(blockLight, skyLight) / 15;
}

export function biomeAt(section, x, z) {
  return section.biomes[(z << 4) | x] ?? 0;
}

/**
 * @param io.bakeState(blockName, props) → 烘焙模板 | null
 * @param io.describe(stateId) → { block, props } | null     （来自 /api/blockstates）
 * @param io.isOpaque(stateId) → 是否完全遮挡（满方块且贴图无透明像素）
 * @param io.blockAt(dim, worldX, worldY, worldZ) → 世界坐标处 stateId（未知返回 -1）
 * @param io.uvRect(texture) → [u0,v0,u1,v1]（图集空间 0..1）
 * @param io.materialOf(texture) → MATERIAL_SOLID | MATERIAL_TRANSLUCENT
 * @param io.tintFor(blockName, tintIndex, biomeId) → [r,g,b]（0..1）| null
 */
export function createMesher(io) {
  const describeCache = new Map();
  const stats = { sections: 0, blocks: 0, quads: 0, culled: 0, noTemplate: 0 };

  function describe(stateId) {
    if (describeCache.has(stateId)) return describeCache.get(stateId);
    const info = io.describe(stateId);
    describeCache.set(stateId, info);
    return info;
  }

  /**
   * 网格一个 section。section 需要 dim, cx, cy, cz, palette, bits, indices, blockLight, skyLight, biomes。
   * 索引分两组（不透明+cutout / 半透明），便于渲染时分两个 pass。
   */
  function meshSection(section) {
    const positions = [];
    const uvs = [];
    const tints = [];
    const lights = [];
    const aos = [];
    const indices = [];
    const indicesTranslucent = [];
    const quadsPerMaterial = [0, 0];
    const baseX = section.cx << 4;
    const baseY = section.cy << 4;
    const baseZ = section.cz << 4;

    /** 该世界位置是否被不透明方块遮挡（AO 用；跨段）。 */
    const occludesAt = (bx, by, bz) => {
      const id = io.blockAt(section.dim, bx, by, bz);
      return id !== -1 && io.isOpaque(id);
    };
    /** 跨段取光照；相邻段未加载或没有该访问器时返回 null（调用方回退到本面光照）。 */
    const lightSample = (bx, by, bz) => {
      if (!io.lightAt) return null;
      const value = io.lightAt(section.dim, bx, by, bz);
      return value === null || value === undefined ? null : value;
    };

    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const stateId = stateIdAt(section, x, y, z);
          if (stateId === 0) continue;              // 空气
          const info = describe(stateId);
          if (!info) continue;
          const baked = io.bakeState(info.block, info.props);
          if (!baked) { stats.noTemplate++; continue; }
          stats.blocks++;

          const biomeId = biomeAt(section, x, z);
          const worldX = baseX + x;
          const worldY = baseY + y;
          const worldZ = baseZ + z;

          for (const quad of baked.quads) {
            if (quad.cull >= 0) {
              const d = DIR_VECTORS[quad.cull];
              const neighbor = io.blockAt(section.dim, worldX + d[0], worldY + d[1], worldZ + d[2]);
              if (neighbor !== -1 && io.isOpaque(neighbor)) { stats.culled++; continue; }
            }
            const lightDir = quad.dir >= 0 ? DIR_VECTORS[quad.dir] : null;
            // 光照采样必须能跨 section：以前直接 clamp 回本段，导致"段内最高一层"的方块
            // 采到的是自己（方块内部 light = 0），于是每段顶层的顶面偏黑。
            // io.lightAt（可选的按世界坐标取光照）取不到时，才回退到本地 clamp 采样。
            let light;
            if (!lightDir) {
              light = lightAt(section, x, y, z);
            } else {
              const wx = worldX + lightDir[0], wy = worldY + lightDir[1], wz = worldZ + lightDir[2];
              const cross = io.lightAt ? io.lightAt(section.dim, wx, wy, wz) : null;
              light = cross === null || cross === undefined
                ? lightAt(section, clamp(x + lightDir[0]), clamp(y + lightDir[1]), clamp(z + lightDir[2]))
                : cross;
            }
            const tint = quad.tint >= 0 ? (io.tintFor(info.block, quad.tint, biomeId) ?? [1, 1, 1]) : [1, 1, 1];
            // 面朝向明暗（vanilla 的固定系数）：上 1.0、下 0.5、南北 0.8、东西 0.6。
            // 按 vanilla 的做法乘进颜色里（shader 里 color 与 brightness 是两次独立相乘），
            // 所以折进 tint 与折进 light 的曲线不同 —— 这里选 vanilla 的那种。
            const faceShade = quad.dir >= 0 ? FACE_BRIGHTNESS[quad.dir] : 1;
            const rect = io.uvRect(quad.texture);
            if (!rect) continue;
            const material = io.materialOf(quad.texture);

            const vertexBase = positions.length / 3;
            for (const v of quad.verts) {
              // 顶点 uv 是 0..16 的贴图像素坐标，映射到图集瓦片内
              const tu = rect[0] + ((v[3] / 16) * (rect[2] - rect[0]));
              const tv = rect[1] + ((v[4] / 16) * (rect[3] - rect[1]));
              positions.push(baseX + x + v[0] / 16, baseY + y + v[1] / 16, baseZ + z + v[2] / 16);
              uvs.push(tu, tv);
              tints.push(tint[0] * faceShade, tint[1] * faceShade, tint[2] * faceShade);
              // 逐角 AO + 平滑光照：采样点由「面法线 + 顶点位置」推出（见 cornerOcclusionOffsets），
              // 且跨段采样 —— 邻居段没到时会回退到本面光照，而新段到达会触发邻居重网格（见 app.js）。
              let ao = 1;
              let vertexLight = light;
              if (quad.dir >= 0 && io.isOpaque) {
                const [d1, d2, dc] = cornerOcclusionOffsets(quad.dir, v);
                const o1 = occludesAt(worldX + d1[0], worldY + d1[1], worldZ + d1[2]);
                const o2 = occludesAt(worldX + d2[0], worldY + d2[1], worldZ + d2[2]);
                const oc = occludesAt(worldX + dc[0], worldY + dc[1], worldZ + dc[2]);
                // vanilla 规则：两边都被挡 → 最暗档；否则按三者遮挡数递减
                ao = AO_LEVELS[(o1 && o2) ? 0 : 3 - ((o1 ? 1 : 0) + (o2 ? 1 : 0) + (oc ? 1 : 0))];
                if (!(o1 && o2)) {   // 两边都被挡时不做四采样平均（防漏光）
                  const l1 = lightSample(worldX + d1[0], worldY + d1[1], worldZ + d1[2]);
                  const l2 = lightSample(worldX + d2[0], worldY + d2[1], worldZ + d2[2]);
                  const lc = lightSample(worldX + dc[0], worldY + dc[1], worldZ + dc[2]);
                  if (l1 !== null && l2 !== null && lc !== null) vertexLight = (light + l1 + l2 + lc) / 4;
                }
              }
              lights.push(vertexLight);
              aos.push(ao);
            }
            const target = material === MATERIAL_TRANSLUCENT ? indicesTranslucent : indices;
            target.push(vertexBase, vertexBase + 1, vertexBase + 2, vertexBase, vertexBase + 2, vertexBase + 3);
            quadsPerMaterial[material]++;
            stats.quads++;
          }
        }
      }
    }

    stats.sections++;
    return {
      positions: new Float32Array(positions),
      uvs: new Float32Array(uvs),
      tints: new Float32Array(tints),
      lights: new Float32Array(lights),
      aos: new Float32Array(aos),
      indices: new Uint32Array(indices),
      indicesTranslucent: new Uint32Array(indicesTranslucent),
      vertexCount: positions.length / 3,
      quadCount: (indices.length + indicesTranslucent.length) / 6,
      quadsPerMaterial,
    };
  }

  return { meshSection, stats: () => ({ ...stats }), clearCaches() { describeCache.clear(); } };
}

function clamp(v) {
  return v < 0 ? 0 : (v > 15 ? 15 : v);
}
