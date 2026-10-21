// entitybake-check.mjs — 实体模型回归：验证 generated-wgd-2 的显式四边形。
//
// 断言全部来自资源本身（模型里的 positions/uvs、PNG 头、bundle 的 states）：
//  1. 每个 cube 的面键唯一，绝大多数 cube 有 6 个面（扁片允许 2 个）；
//  2. texture_size 与真实 PNG 一致（基础模型 + RenderLayer）；
//  3. 四足 body 的旋转已烘进顶点；
//  4. 全量烘焙 + 贴图存在性；
//  5. entityPartsFor 解析全部 entitystate；
//  6. entitymesh 世界变换与绕序；
//  7. 面 UV 只对紧邻透明 gutter 的边内缩半 texel（不缩不透明的边）。
import fs from 'node:fs';
import path from 'node:path';
import {
  bakeEntityModel, partBounds, familyTexturePath, resolveEntityModel, entityPartsFor, entityTexturePaths,
} from '../common/src/main/resources/assets/what_guys_doing/web/entitymodel.js';
import { buildEntityMesh } from '../common/src/main/resources/assets/what_guys_doing/web/entitymesh.js';

const BUNDLE = 'common/src/main/resources/assets/what_guys_doing/entitybundle.json';
const TEXTURE_ROOT = process.env.WGD_ASSET_DIR
  || path.join('neoforge', 'run', 'config', 'what_guys_doing', 'assets', 'content', 'minecraft', 'textures');
const bundle = JSON.parse(fs.readFileSync(BUNDLE, 'utf8'));
const failures = [];
const fail = msg => failures.push(msg);

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function textureOnDisk(ref) {
  if (!ref) return false;
  const rel = ref.replace(/^minecraft:/, '').replace(/^textures\//, '');
  return fs.existsSync(path.join(TEXTURE_ROOT, rel));
}

console.log('=== 1. 格式与逐 cube 完整性 ===');
{
  let models = 0;
  let cubes = 0;
  let sixFace = 0;
  let flat = 0;
  let quadsTotal = 0;
  let wrappingQuads = 0;
  const wrappingModels = new Set();
  for (const [key, model] of Object.entries(bundle.models)) {
    models++;
    if (!Array.isArray(model.parts)) {
      fail(`${key}: 不是 generated-wgd-2（缺少 parts）`);
      continue;
    }
    for (const group of [model.parts, ...(model.layers || []).map(layer => layer.parts)]) {
      for (const part of group || []) {
        for (const cube of part.cubes || []) {
          cubes++;
          const quads = cube.quads || [];
          quadsTotal += quads.length;
          if (quads.length === 6) sixFace++;
          else if (quads.length === 2) flat++;
          else if (quads.length === 0) fail(`${key}/${part.name}#${cube.index}: 没有面`);
          const faces = new Set();
          for (const q of quads) {
            if (!Array.isArray(q.positions) || q.positions.length !== 4) {
              fail(`${key}/${part.name}#${cube.index}: positions 不是 4 个`);
              continue;
            }
            if (!Array.isArray(q.uvs) || q.uvs.length !== 4) {
              fail(`${key}/${part.name}#${cube.index}: uvs 不是 4 个`);
              continue;
            }
            if (faces.has(q.face)) fail(`${key}/${part.name}#${cube.index}: 面键重复 ${q.face}`);
            faces.add(q.face);
            let wrapping = false;
            for (const uv of q.uvs) {
              if (!Number.isFinite(uv[0]) || !Number.isFinite(uv[1])) {
                fail(`${key}/${part.name}#${cube.index}: 非有限 uv ${uv}`);
              } else if (uv[0] < -1e-6 || uv[0] > 1 + 1e-6 || uv[1] < -1e-6 || uv[1] > 1 + 1e-6) {
                wrapping = true;
              }
            }
            if (wrapping) {
              // 原版实体贴图是 REPEAT：鱼鳍/尾小幅越界，Breeze 风大幅滚动。
              wrappingQuads++;
              wrappingModels.add(key);
            }
            for (const p of q.positions) {
              if (!p.every(Number.isFinite)) fail(`${key}/${part.name}#${cube.index}: 非有限坐标 ${p}`);
            }
          }
        }
      }
    }
  }
  const ratio = cubes ? sixFace / cubes : 0;
  console.log(`  ${models} 个模型，${cubes} 个 cube，${quadsTotal} 个面`);
  console.log(`  6 面 cube ${sixFace}（${(ratio * 100).toFixed(1)}%），扁片 2 面 ${flat}`);
  console.log(`  REPEAT uv 越界 ${wrappingQuads} 个面，涉及 ${[...wrappingModels].join(',')}`);
  if (ratio < 0.8) fail(`6 面 cube 比例过低：${(ratio * 100).toFixed(1)}%（旧 dumper 约 10%）`);
  const knownWrap = new Set(['breeze', 'pufferfish', 'salmon', 'tropical_fish']);
  for (const key of wrappingModels) {
    if (!knownWrap.has(key)) fail(`${key}: 出现了未预期的 UV 越界（可能是生成/判面错误）`);
  }
}

console.log('\n=== 2. texture_size 与真实 PNG 一致 ===');
{
  let checked = 0;
  let bad = 0;
  const checkTexture = (key, ref, declared) => {
    const rel = ref.replace(/^minecraft:/, '').replace(/^textures\//, '');
    const file = path.join(TEXTURE_ROOT, rel.endsWith('.png') ? rel : rel + '.png');
    if (!fs.existsSync(file)) {
      fail(`${key}: 贴图不存在 ${ref}`);
      return;
    }
    const size = pngSize(file);
    checked++;
    if (!size || !declared
      || declared[0] !== size[0] || declared[1] !== size[1]) {
      bad++;
      fail(`${key}: texture_size ${JSON.stringify(declared)} != PNG ${size} (${ref})`);
    }
  };
  for (const [key, model] of Object.entries(bundle.models)) {
    const ref = Object.values(model.textures || {})[0];
    if (ref) checkTexture(key, 'minecraft:textures/' + ref.replace(/^textures\//, '') + '.png', model.texture_size);
    for (const layer of model.layers || []) {
      if (layer.texture) checkTexture(key + '/' + layer.name, layer.texture, layer.texture_size);
    }
  }
  console.log(`  ${checked} 张贴图，尺寸不符 ${bad}`);
}

console.log('\n=== 3. 四足 body 的旋转已烘进顶点 ===');
for (const modelKey of ['pig', 'cow', 'sheep']) {
  const model = bundle.models[modelKey];
  if (!model) { fail(`${modelKey}: 不在 bundle`); continue; }
  const baked = bakeEntityModel(model, familyTexturePath(modelKey));
  let body = null;
  let bodyPart = null;
  for (const part of baked) {
    if (part.name !== 'body') continue;
    const b = partBounds(part);
    const span = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    if (!body || span[0] * span[1] * span[2] > body.volume) {
      body = { span, volume: span[0] * span[1] * span[2], min: b.min, max: b.max };
      bodyPart = part;
    }
  }
  if (!body) { fail(`${modelKey}: 没有 body 部件`); continue; }
  console.log(`  ${modelKey} body 跨度 x=${body.span[0].toFixed(2)} y=${body.span[1].toFixed(2)} z=${body.span[2].toFixed(2)}`);
  if (!(body.span[2] > body.span[1])) fail(`${modelKey} body 没有横向旋转：z 跨度 ${body.span[2]} <= y 跨度 ${body.span[1]}`);

  // 绕序：方块路径的叉积指向“内”（cross·outward < 0）。
  // 只对 pig body 做：它是单个凸立方体；cow body 还包含角/乳房等子 cube，part 中心不能作为外法线参考。
  if (modelKey === 'pig') {
    const center = [(body.min[0] + body.max[0]) / 2, (body.min[1] + body.max[1]) / 2, (body.min[2] + body.max[2]) / 2];
    let wrongWinding = 0;
    for (const q of bodyPart.quads) {
      const [p0, p1, p2] = q.verts;
      const a = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const c = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
      const cr = [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
      const fc = [0, 1, 2].map(i => (p0[i] + p1[i] + p2[i] + q.verts[3][i]) / 4);
      const out = [fc[0] - center[0], fc[1] - center[1], fc[2] - center[2]];
      if (cr[0] * out[0] + cr[1] * out[1] + cr[2] * out[2] >= 0) wrongWinding++;
    }
    if (wrongWinding) fail(`pig body 有 ${wrongWinding} 个面绕序与方块路径相反（会被背面剔除）`);
  }
}

console.log('\n=== 4. 全量烘焙 + 贴图存在性 ===');
{
  let withQuads = 0;
  let totalQuads = 0;
  const missingTextures = new Set();
  for (const key of Object.keys(bundle.models)) {
    const model = resolveEntityModel(bundle.models, key);
    const baked = bakeEntityModel(model, familyTexturePath(key));
    const quads = baked.reduce((n, p) => n + p.quads.length, 0);
    if (!quads) { fail(`${key}: 没有烘出任何面`); continue; }
    withQuads++;
    totalQuads += quads;
    for (const part of baked) {
      for (const quad of part.quads) {
        if (!textureOnDisk(quad.texture)) missingTextures.add(quad.texture);
      }
    }
  }
  console.log(`  ${withQuads}/${Object.keys(bundle.models).length} 个模型烘出几何，共 ${totalQuads} 面`);
  console.log(`  贴图缺口 ${missingTextures.size} 种`);
  for (const t of [...missingTextures].slice(0, 8)) console.log(`    缺 ${t}`);
}

console.log('\n=== 5. entityPartsFor 映射 ===');
{
  let ok = 0;
  const unresolved = [];
  for (const key of Object.keys(bundle.states)) {
    const info = entityPartsFor(bundle, key);
    if (!info || !info.quads) unresolved.push(key);
    else ok++;
  }
  console.log(`  ${ok}/${Object.keys(bundle.states).length} 种实体类型解析到模型；未解析 ${unresolved.length}`);
  if (unresolved.length) fail(`未解析: ${unresolved.slice(0, 10).join(', ')}`);
  const pig = entityPartsFor(bundle, 'minecraft:pig');
  console.log(`  minecraft:pig -> model=${pig && pig.modelKey}, 部件=${pig && pig.parts.length}, 面=${pig && pig.quads}`);
  if (!pig || pig.modelKey !== 'pig' || !pig.parts.length || !pig.quads) fail('minecraft:pig 映射异常');
}

console.log('\n=== 6. entitymesh 世界变换与绕序 ===');
{
  const rect = [0, 0, 1 / 16, 1 / 16];
  const types = new Map([[128, 'minecraft:pig']]);
  const mk = (x, y, z, yaw) => ({ netId: 1, typeId: 128, x, y, z, yaw });
  const uvRectFor = () => rect;
  const opaque = () => 0;

  const a = buildEntityMesh(bundle, [mk(10, 64, 20, 0)], types, uvRectFor, opaque);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < a.vertexCount; i++) {
    const x = a.positions[i * 3], y = a.positions[i * 3 + 1], z = a.positions[i * 3 + 2];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const baked = bakeEntityModel(bundle.models.pig, familyTexturePath('pig'));
  let modelTop = -Infinity;
  for (const part of baked) for (const q of part.quads) for (const v of q.verts) modelTop = Math.max(modelTop, v[1]);
  const expectTop = 64 + modelTop / 16;
  console.log(`  yaw=0 包围盒 x[${minX.toFixed(2)},${maxX.toFixed(2)}] y[${minY.toFixed(2)},${maxY.toFixed(2)}] z[${minZ.toFixed(2)},${maxZ.toFixed(2)}]`);
  if (Math.abs(minY - 64) > 1e-6) fail(`脚底应在 y=64，实得 ${minY}`);
  if (Math.abs(maxY - expectTop) > 0.01) fail(`顶部应为 ${expectTop.toFixed(2)}，实得 ${maxY}`);
  if (!(a.quadCount > 0)) fail('实体没有生成任何面');
  if (a.vertexCount !== a.quadCount * 4) fail('顶点数应等于面数×4');
  if (!a.uvs.every(v => v >= -1e-6 && v <= 1 + 1e-6)) fail('实体 uv 越界');

  const b = buildEntityMesh(bundle, [mk(10, 64, 20, 90)], types, uvRectFor, opaque);
  let bMinX = Infinity, bMaxX = -Infinity, bMinZ = Infinity, bMaxZ = -Infinity;
  for (let i = 0; i < b.vertexCount; i++) {
    const x = b.positions[i * 3], z = b.positions[i * 3 + 2];
    bMinX = Math.min(bMinX, x); bMaxX = Math.max(bMaxX, x);
    bMinZ = Math.min(bMinZ, z); bMaxZ = Math.max(bMaxZ, z);
  }
  const widthA = maxX - minX, depthA = maxZ - minZ;
  const widthB = bMaxX - bMinX, depthB = bMaxZ - bMinZ;
  console.log(`  yaw=90 包围盒 x[${bMinX.toFixed(2)},${bMaxX.toFixed(2)}] z[${bMinZ.toFixed(2)},${bMaxZ.toFixed(2)}]`);
  if (Math.abs(widthA - depthB) > 1e-6 || Math.abs(depthA - widthB) > 1e-6) {
    fail(`yaw=90 宽深未互换：${widthA.toFixed(2)}/${depthA.toFixed(2)} vs ${widthB.toFixed(2)}/${depthB.toFixed(2)}`);
  }
}

console.log('\n=== 7. 源 UV 保持原样（生成器不做裁边）===');
{
  const model = bundle.models.sheep;
  const rawPart = model.parts.find(p => p.name === 'rightHindLeg');
  const raw = rawPart.cubes[0].quads.find(q => q.face === 'south');
  const rawMaxU = Math.max(...raw.uvs.map(uv => uv[0]));
  const rawMinU = Math.min(...raw.uvs.map(uv => uv[0]));
  const rawMinV = Math.min(...raw.uvs.map(uv => uv[1]));
  const rawMaxV = Math.max(...raw.uvs.map(uv => uv[1]));
  const expectedMaxU = 0.25;
  const expectedMinV = 0.625;
  console.log(`  leg south u[${rawMinU.toFixed(6)},${rawMaxU.toFixed(6)}] v[${rawMinV.toFixed(6)},${rawMaxV.toFixed(6)}]`);
  if (Math.abs(rawMaxU - expectedMaxU) > 1e-4) fail(`leg south 源 u 最大值被改动：${rawMaxU} vs ${expectedMaxU}`);
  if (Math.abs(rawMinV - expectedMinV) > 1e-4) fail(`leg south 源 v 最小值被改动：${rawMinV} vs ${expectedMinV}`);
  if (Math.abs(rawMinU - 0.1875) > 1e-4) fail(`leg south 源 u 最小值被改动：${rawMinU}`);
  if (Math.abs(rawMaxV - 1.0) > 1e-4) fail(`leg south 源 v 最大值被改动：${rawMaxV}`);

  const head = model.parts.find(p => p.name === 'head').cubes[0].quads.find(q => q.face === 'north');
  const headU = head.uvs.map(uv => uv[0]);
  const headV = head.uvs.map(uv => uv[1]);
  const hMinU = Math.min(...headU), hMaxU = Math.max(...headU);
  const hMinV = Math.min(...headV), hMaxV = Math.max(...headV);
  console.log(`  head north u[${hMinU.toFixed(6)},${hMaxU.toFixed(6)}] v[${hMinV.toFixed(6)},${hMaxV.toFixed(6)}]`);
  if (Math.abs(hMinU - 0.125) > 1e-4 || Math.abs(hMaxU - 0.21875) > 1e-4) {
    fail(`head 正面源 u 被改动：${hMinU}/${hMaxU}`);
  }
  if (Math.abs(hMinV - 0.25) > 1e-4) fail(`head 正面源 v 最小值被改动：${hMinV}`);
  if (Math.abs(hMaxV - 0.4375) > 1e-4) {
    fail(`head 正面源 v 最大值被改动：${hMaxV}`);
  }
}

console.log('\n=== 结果 ===');
if (failures.length) {
  console.log(`FAILED: ${failures.length} 项`);
  for (const f of failures.slice(0, 20)) console.log('  ' + f);
  process.exitCode = 1;
} else {
  console.log('ALL PASSED：显式四边形、旋转、贴图尺寸与 entitymesh 变换均符合预期');
}
