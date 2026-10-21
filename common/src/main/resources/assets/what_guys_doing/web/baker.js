// baker.js — 把 blockstate + model JSON 烘成可实例化的方块几何模板。
// 不依赖 DOM，可直接在 Node 里对真实资源包做全量回归（见 tools/bake-check.mjs）。
//
// 关键规则（已对真实原版资产验证过，见方案 §9）：
//   变体匹配 = 先精确匹配全属性串；否则做「子集匹配」——key 里未列举的属性一律忽略，
//   取最具体的那个（key 最长）。因此 "" 匹配一切。
//   multipart = 逐条目独立判断 when（不成立的条目正常跳过），多个条目叠加。
//
// 顶点约定：每个面 4 个顶点，顺序为从外面看的「左上 → 右上 → 右下 → 左下」，
// 与 vanilla 的 uv 约定一致（u 向右、v 向下）。模板里顶点为 [x, y, z, u, v]，坐标 0..16。

export const DIR_ORDER = ['down', 'up', 'north', 'south', 'west', 'east'];

/** 每个方向「从外面看」的基：所在平面 / u 轴 / v 轴（含符号，v 指向观察者下方）。 */
const FACE_BASIS = {
  up: { plane: 'y', at: 'max', u: ['x', 1], v: ['z', 1] },
  down: { plane: 'y', at: 'min', u: ['x', 1], v: ['z', -1] },
  north: { plane: 'z', at: 'min', u: ['x', -1], v: ['y', -1] },
  south: { plane: 'z', at: 'max', u: ['x', 1], v: ['y', -1] },
  west: { plane: 'x', at: 'min', u: ['z', 1], v: ['y', -1] },
  east: { plane: 'x', at: 'max', u: ['z', -1], v: ['y', -1] },
};
const AXIS_INDEX = { x: 0, y: 1, z: 2 };

const shortName = name => (name.includes(':') ? name.slice(name.indexOf(':') + 1) : name);

export function matchesKey(props, key) {
  if (key === '') return true;
  const map = new Map(props ? props.split(',').map(p => p.split('=')) : []);
  for (const kv of key.split(',')) {
    const eq = kv.indexOf('=');
    if (map.get(kv.slice(0, eq)) !== kv.slice(eq + 1)) return false;
  }
  return true;
}

export function whenMatches(when, props) {
  if (!when) return true;
  const map = new Map(props ? props.split(',').map(p => p.split('=')) : []);
  if (when.OR) return when.OR.some(w => whenMatches(w, props));
  if (when.AND) return when.AND.every(w => whenMatches(w, props));
  for (const [key, value] of Object.entries(when)) {
    const allowed = Array.isArray(value) ? value : [value];
    if (!allowed.includes(map.get(key))) return false;
  }
  return true;
}

/**
 * [u1,v1,u2,v2] 按 0/90/180/270 旋转（贴图在面内旋转）。
 *
 * 关键：镜像必须围绕**这个 uv 矩形自己的中心**，不是整格中心 8。
 * 以前写死 `16 - u`，对铺满整格的方块 uv（0..16）恰好等价；但实体模型的 uv 是
 * 贴图里的小矩形（如 [2.5,2.5,5,5]），`16-2.5=13.5` 会指到完全不同的贴图区域 ——
 * 表现为实体模型"贴图错乱"。矩形的镜像中心就是 u0+u1（v 同理）。
 */
export function rotateFaceUv(uv, rotation) {
  const [u0, v0, u1, v1] = uv;
  const mu = u0 + u1;   // 矩形 u 方向的镜像中心之和
  const mv = v0 + v1;
  switch ((((rotation / 90) % 4) + 4) % 4) {
    case 1: return [v0, mu - u1, v1, mu - u0];
    case 2: return [mu - u1, mv - v1, mu - u0, mv - v0];
    case 3: return [mv - v1, u0, mv - v0, u1];
    default: return uv;
  }
}

function rotatePoint(point, axis, angleDeg, origin, rescale) {
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  let x = point[0] - origin[0];
  let y = point[1] - origin[1];
  let z = point[2] - origin[2];
  if (rescale) {
    const f = 1 / Math.max(1e-6, Math.abs(cos));
    if (axis === 'x') { y *= f; z *= f; } else if (axis === 'y') { x *= f; z *= f; } else { x *= f; y *= f; }
  }
  if (axis === 'x') {
    const ny = y * cos - z * sin;
    const nz = y * sin + z * cos;
    y = ny; z = nz;
  } else if (axis === 'y') {
    const nx = x * cos + z * sin;
    const nz = -x * sin + z * cos;
    x = nx; z = nz;
  } else {
    const nx = x * cos - y * sin;
    const ny = x * sin + y * cos;
    x = nx; y = ny;
  }
  return [x + origin[0], y + origin[1], z + origin[2]];
}

/** 变体的 x/y（90° 步进）整体旋转，绕方块中心 (8,8,8)。 */
function rotateVariant(point, x, y) {
  let p = point;
  if (x) p = rotatePoint(p, 'x', x, [8, 8, 8], false);
  // blockstate 的 y 是「从上往下看顺时针」；rotatePoint 的 +y 是逆时针，必须取反。
  // 之前 fence 的 east 被转到西侧，正是这个符号导致的。
  if (y) p = rotatePoint(p, 'y', -y, [8, 8, 8], false);
  return p;
}

/**
 * element 的一个面 → 四边形模板。
 * 位置由 element 盒体决定；uv 单独计算（未显式给出时按 vanilla 的自动 uv 规则，
 * 即 u/v 轴为负时做 16-x 反转，六面带公式与 vanilla 完全一致）。
 */
export function faceQuad(element, faceName, face, texture, uvRotation = 0, entityUvOrder = false) {
  const basis = FACE_BASIS[faceName];
  const ui = AXIS_INDEX[basis.u[0]];
  const vi = AXIS_INDEX[basis.v[0]];
  const pi = AXIS_INDEX[basis.plane];
  const signU = basis.u[1];
  const signV = basis.v[1];
  const planeValue = basis.at === 'max' ? element.to[pi] : element.from[pi];

  const u1 = signU > 0 ? element.from[ui] : element.to[ui];
  const u2 = signU > 0 ? element.to[ui] : element.from[ui];
  const v1 = signV > 0 ? element.from[vi] : element.to[vi];
  const v2 = signV > 0 ? element.to[vi] : element.from[vi];
  const inv = (value, sign) => (sign > 0 ? value : 16 - value);

  let uv = face.uv
    ? face.uv.slice()
    : [inv(u1, signU), inv(v1, signV), inv(u2, signU), inv(v2, signV)];
  // JSON 的 uv 是 [u1,v1,u2,v2]（两个角），按顶点展开成 4 对。
  // 实体模型用 BlueMap 的角序（ResourceModelRenderer）：(u0,v1) (u1,v1) (u1,v0) (u0,v0)，
  // 与方块路径在 v 方向相反 —— 方块路径已验证正确，不能一起改。
  // 方块路径的 90° 旋转必须两步：
  //   1) 旋转 UV 矩形（非正方形会交换宽高）；
  //   2) 旋转四边形的 UV 角序（交换 u/v 轴）。
  // 只做 1 会选到横向 crop（看起来仍然没转）；只做 2 会把 2×9 拉成 9×2（侧边被拉伸）。
  let blockRotation = 0;
  if (!entityUvOrder) {
    blockRotation = (face.rotation || 0) + uvRotation;
    if (blockRotation) uv = rotateFaceUv(uv, blockRotation);
  }
  let uvPairs = entityUvOrder
    ? [[uv[0], uv[3]], [uv[2], uv[3]], [uv[2], uv[1]], [uv[0], uv[1]]]
    : [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
  if (entityUvOrder) {
    // 实体路径：BlueMap 的四角循环移位。
    if (face.rotation) {
      const steps = ((Math.trunc(face.rotation / 90) % 4) + 4) % 4;
      if (steps) uvPairs = uvPairs.slice(steps).concat(uvPairs.slice(0, steps));
    }
    if (uvRotation) {
      const steps = ((Math.trunc(uvRotation / 90) % 4) + 4) % 4;
      if (steps) uvPairs = uvPairs.slice(steps).concat(uvPairs.slice(0, steps));
    }
  } else if (blockRotation) {
    const steps = ((Math.trunc(blockRotation / 90) % 4) + 4) % 4;
    if (steps) uvPairs = uvPairs.slice(steps).concat(uvPairs.slice(0, steps));
  }

  const corners = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]].map(([u, v]) => {
    const point = [0, 0, 0];
    point[pi] = planeValue;
    point[ui] = u;
    point[vi] = v;
    return point;
  });

  let verts = corners.map((point, i) => [point[0], point[1], point[2], uvPairs[i][0], uvPairs[i][1]]);
  if (element.rotation) {
    const r = element.rotation;
    const origin = r.origin || [8, 8, 8];
    verts = verts.map(v => {
      const p = rotatePoint([v[0], v[1], v[2]], r.axis, r.angle, origin, r.rescale === true);
      return [p[0], p[1], p[2], v[3], v[4]];
    });
  }
  return {
    dir: DIR_ORDER.indexOf(faceName),
    cull: face.cullface ? DIR_ORDER.indexOf(face.cullface) : -1,
    tint: face.tintindex ?? -1,
    texture,
    verts,
  };
}

export function createBaker(io) {
  const modelCache = new Map();
  const stateCache = new Map();
  const textures = new Set();
  const blockstateFiles = new Set();
  const stats = { models: 0, blockstates: 0, states: 0, quads: 0, missingModel: 0, noMatch: 0, noModelVariant: 0 };

  /** 解析 parent 链，得到合并后的 elements 与已解析的 textures。 */
  function resolveModel(name, depth = 0) {
    if (typeof name !== 'string' || !name) return null;
    const key = shortName(name);
    const cached = modelCache.get(key);
    if (cached !== undefined) return cached;
    if (depth > 16) return null;
    const json = io.readJson(`minecraft/models/${key}.json`);
    if (!json) {
      modelCache.set(key, null);
      return null;
    }

    const parent = json.parent ? resolveModel(json.parent, depth + 1) : null;
    const rawTextures = Object.assign({}, parent ? parent.rawTextures : {}, json.textures || {});
    const elements = json.elements !== undefined ? json.elements : (parent ? parent.elements : []);

    const resolveRef = (ref, seen) => {
      if (typeof ref !== 'string') return null;
      if (!ref.startsWith('#')) return ref.includes(':') ? ref : `minecraft:${ref}`;
      const varName = ref.slice(1);
      if (seen.has(varName)) return null;
      seen.add(varName);
      return resolveRef(rawTextures[varName], seen);
    };
    const resolved = {};
    for (const varName of Object.keys(rawTextures)) {
      const path = resolveRef(`#${varName}`, new Set());
      if (path) resolved[varName] = path;
    }

    const model = { key, elements: elements || [], textures: resolved, rawTextures };
    modelCache.set(key, model);
    stats.models++;
    return model;
  }

  /** blockstate → 选中的变体列表（每个含 model/x/y/uvlock）。 */
  function selectVariants(blockName, props) {
    const short = shortName(blockName);
    const json = io.readJson(`minecraft/blockstates/${short}.json`);
    if (!json) return null;
    if (!blockstateFiles.has(short)) {
      blockstateFiles.add(short);
      stats.blockstates++;
    }
    if (json.variants) {
      if (json.variants[props]) {
        const v = json.variants[props];
        return { match: 'exact', key: props, list: Array.isArray(v) ? [v[0]] : [v] };
      }
      const keys = Object.keys(json.variants).filter(k => matchesKey(props, k)).sort((a, b) => b.length - a.length);
      if (keys.length) {
        const v = json.variants[keys[0]];
        return { match: 'subset', key: keys[0], list: Array.isArray(v) ? [v[0]] : [v] };
      }
      return { match: 'none', list: [] };
    }
    if (json.multipart) {
      const list = [];
      for (const part of json.multipart) {
        if (whenMatches(part.when, props)) list.push(part.apply);
      }
      return { match: 'multipart', list };
    }
    return { match: 'none', list: [] };
  }

  /** 烘一个状态：blockName + 属性串 → 几何模板。 */
  function bakeState(blockName, props) {
    const cacheKey = `${blockName}\t${props}`;
    const cached = stateCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const selection = selectVariants(blockName, props);
    if (selection === null || !selection.list.length) {
      if (selection === null) stats.missingModel++;
      else stats.noMatch++;
      stateCache.set(cacheKey, null);
      return null;
    }

    const quads = [];
    let fullCube = false;
    for (const variant of selection.list) {
      if (!variant || typeof variant.model !== 'string') {
        stats.noModelVariant++;
        continue;
      }
      const model = resolveModel(variant.model);
      if (!model) { stats.missingModel++; continue; }
      const rx = variant.x || 0;
      const ry = variant.y || 0;
      const uvlock = variant.uvlock === true;
      // uvlock：贴图随模型旋转会一起转，这里反向补偿，让它保持世界对齐
      const uvRotation = uvlock ? -((rx || 0) + (ry || 0)) : 0;

      // 满方块判定看的是**形状**，不是"元素数量为 1"。
      // 草方块有 2 个元素（本体 + 草色覆盖层，两者都是 0..16 的整方块），
      // 以前的多元素直接判 false → 草方块不遮挡 → 相邻草方块之间的侧面全部保留（用户看到的"井"字）。
      if (rx === 0 && ry === 0 && model.elements.length > 0
        && model.elements.every(e => !e.rotation
          && e.from[0] === 0 && e.from[1] === 0 && e.from[2] === 0
          && e.to[0] === 16 && e.to[1] === 16 && e.to[2] === 16)) {
        fullCube = true;
      }

      for (const element of model.elements) {
        for (const faceName of DIR_ORDER) {
          const face = element.faces && element.faces[faceName];
          if (!face) continue;
          const texturePath = typeof face.texture === 'string' && face.texture.startsWith('#')
            ? model.textures[face.texture.slice(1)]
            : (face.texture ? (face.texture.includes(':') ? face.texture : `minecraft:${face.texture}`) : null);
          if (!texturePath) continue;
          let quad = faceQuad(element, faceName, face, texturePath, uvRotation);
          if (rx || ry) {
            quad = { ...quad, verts: quad.verts.map(v => {
              const p = rotateVariant([v[0], v[1], v[2]], rx, ry);
              return [p[0], p[1], p[2], v[3], v[4]];
            }) };
          }
          textures.add(texturePath);
          quads.push(quad);
        }
      }
    }

    if (!quads.length) {
      stateCache.set(cacheKey, null);
      return null;
    }
    stats.states++;
    stats.quads += quads.length;
    const baked = { block: blockName, props, variant: selection.match, variantKey: selection.key, quads, fullCube, tinted: quads.some(q => q.tint >= 0) };
    stateCache.set(cacheKey, baked);
    return baked;
  }

  return {
    bakeState,
    resolveModel,
    selectVariants,
    stats: () => ({ ...stats }),
    texturesUsed: () => [...textures].sort(),
    clearCaches() { modelCache.clear(); stateCache.clear(); },
  };
}
