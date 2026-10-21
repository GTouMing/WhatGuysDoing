// build-entity-bundle-geo.mjs — 从 Blockbench Bedrock .geo.json 烘焙运行时 entitybundle。
//
// 数据源：assets/what_guys_doing/blockbench/<id>.geo.json + <id>.meta.json
// 输出：assets/what_guys_doing/entitybundle.json（运行时格式仍是 generated-wgd-2，
//       浏览器渲染管线不用重写，但模型源是 Blockbench 的 .geo.json）。
//
// 关键约定（用显式四边形逐顶点/逐面反推）：
//   - Bedrock/Blockbench 的 bone rotation 与运行时矩阵符号相反，三轴取反；
//   - Euler 顺序与 dumper 的 ModelPart 一致：Rz·Ry·Rx；
//   - per-face UV 的角序：侧面翻 U，顶面翻 V，底面不翻。
//
//   node tools/build-entity-bundle-geo.mjs
import fs from 'node:fs';
import path from 'node:path';
import { faceQuad } from '../common/src/main/resources/assets/what_guys_doing/web/baker.js';

const ROOT = path.join('common', 'src', 'main', 'resources', 'assets', 'what_guys_doing');
const GEO_DIR = path.join(ROOT, 'blockbench');
const STATES_DIR = path.join(ROOT, 'entitystates');
const OUT = path.join(ROOT, 'entitybundle.json');

const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a, b) => {
  const r = new Array(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      for (let k = 0; k < 4; k++) r[row * 4 + col] += a[row * 4 + k] * b[k * 4 + col];
    }
  }
  return r;
};
const translate = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const rotateX = a => [1, 0, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, 0, Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1];
const rotateY = a => [Math.cos(a), 0, Math.sin(a), 0, 0, 1, 0, 0, -Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
const rotateZ = a => [Math.cos(a), -Math.sin(a), 0, 0, Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const transform = (m, p) => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
  m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
  m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
];

const D2R = Math.PI / 180;

function boneMatrix(bone) {
  const [px, py, pz] = bone.pivot || [0, 0, 0];
  const rotation = Array.isArray(bone.rotation) && bone.rotation.length === 3
    ? bone.rotation
    : [0, 0, 0];
  const [rx, ry, rz] = rotation.map(v => -v * D2R);
  const r = mul(mul(rotateZ(rz), rotateY(ry)), rotateX(rx));
  return mul(mul(translate(px, py, pz), r), translate(-px, -py, -pz));
}

function bakeGeometry(geo, texture, textureRef) {
  const geometry = geo['minecraft:geometry'][0];
  const W = geometry.description.texture_width;
  const H = geometry.description.texture_height;
  const bones = geometry.bones || [];
  const byName = new Map(bones.map(b => [b.name, b]));
  const worldCache = new Map();
  const worldOf = (bone, seen = new Set()) => {
    if (!bone) return I();
    if (worldCache.has(bone.name)) return worldCache.get(bone.name);
    if (seen.has(bone.name)) return I();
    seen.add(bone.name);
    const parent = bone.parent ? byName.get(bone.parent) : null;
    const world = mul(worldOf(parent, seen), boneMatrix(bone));
    worldCache.set(bone.name, world);
    return world;
  };

  const parts = [];
  for (const bone of bones) {
    if (!Array.isArray(bone.cubes) || !bone.cubes.length) continue;
    const world = worldOf(bone);
    const cubes = [];
    bone.cubes.forEach((cube, index) => {
      const origin = cube.origin || [0, 0, 0];
      const size = cube.size || [0, 0, 0];
      const to = [origin[0] + size[0], origin[1] + size[1], origin[2] + size[2]];
      const element = { from: origin, to };
      const quads = [];
      for (const [face, uv] of Object.entries(cube.uv || {})) {
        if (!uv || !Array.isArray(uv.uv) || !Array.isArray(uv.uv_size)) continue;
        const [u, v] = uv.uv;
        const [w, h] = uv.uv_size;
        if (!(w > 0 && h > 0)) continue;
        const rect = [
          u * 16 / W, v * 16 / H,
          (u + w) * 16 / W, (v + h) * 16 / H,
        ];
        const quad = faceQuad(element, face, { uv: rect, texture }, texture, 0, false);
        const flipU = face === 'north' || face === 'south' || face === 'east' || face === 'west';
        const flipV = face === 'up';
        const positions = [];
        const uvs = [];
        for (const vert of quad.verts) {
          const p = transform(world, vert);
          positions.push(p);
          let uu = vert[3];
          let vv = vert[4];
          if (flipU) uu = rect[0] + rect[2] - uu;
          if (flipV) vv = rect[1] + rect[3] - vv;
          uvs.push([uu / 16, vv / 16]);
        }
        quads.push({ face, texture, positions, uvs });
      }
      if (quads.length) cubes.push({ index, quads });
    });
    if (cubes.length) parts.push({ name: bone.name, cubes });
  }
  return { parts, texture_size: [W, H] };
}

const geoFiles = new Map();
for (const file of fs.readdirSync(GEO_DIR).filter(f => f.endsWith('.geo.json'))) {
  geoFiles.set(file.replace('.geo.json', ''), JSON.parse(fs.readFileSync(path.join(GEO_DIR, file), 'utf8')));
}
const metaFiles = fs.readdirSync(GEO_DIR).filter(f => f.endsWith('.meta.json'));

const models = {};
for (const file of metaFiles) {
  const meta = JSON.parse(fs.readFileSync(path.join(GEO_DIR, file), 'utf8'));
  const idPath = String(meta.id || '').replace(/^minecraft:/, '');
  if (!idPath) continue;
  const baseGeo = geoFiles.get(idPath);
  if (!baseGeo) {
    console.warn(`missing base geo for ${meta.id}`);
    continue;
  }
  const base = bakeGeometry(baseGeo, meta.base.texture, '#0');
  const layers = [];
  for (const layer of meta.layers || []) {
    const layerGeo = geoFiles.get(`${idPath}_${layer.name}`);
    if (!layerGeo) continue;
    const baked = bakeGeometry(layerGeo, layer.texture, layer.texture);
    if (baked.parts.length) {
      layers.push({
        name: layer.name,
        texture: layer.texture,
        texture_size: baked.texture_size,
        parts: baked.parts,
      });
    }
  }
  models[idPath] = {
    format_version: 'generated-wgd-2',
    texture_size: base.texture_size,
    textures: { 0: meta.base.texture },
    parts: base.parts,
    layers,
  };
}

const states = {};
for (const file of fs.readdirSync(STATES_DIR).filter(f => f.endsWith('.json'))) {
  states[file.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(STATES_DIR, file), 'utf8'));
}

const bundle = {
  version: 4,
  source: 'bedrock-geo (Blockbench)',
  generatedFrom: { models: Object.keys(models).length, states: Object.keys(states).length },
  models,
  states,
};

fs.writeFileSync(OUT, JSON.stringify(bundle));
console.log(`models ${Object.keys(models).length}, states ${Object.keys(states).length}`);
console.log(`-> ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
