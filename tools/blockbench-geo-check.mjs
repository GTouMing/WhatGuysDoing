// blockbench-geo-check.mjs — 校验 dumper 生成的 Bedrock .geo.json sidecar。
//
//   node tools/blockbench-geo-check.mjs
//
// 需要先跑一次客户端 dump（run/wgd-entity-dump/blockbench）。
import fs from 'node:fs';
import path from 'node:path';

const GEO_DIR = path.join('neoforge', 'run', 'wgd-entity-dump', 'blockbench');
const failures = [];
const fail = msg => failures.push(msg);
const finiteArray = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
const FACE_NAMES = new Set(['down', 'up', 'north', 'south', 'west', 'east']);

console.log('=== Bedrock .geo.json ===');
if (!fs.existsSync(GEO_DIR)) {
  console.log(`  目录不存在：${GEO_DIR}（先跑一次 dump）`);
  process.exit(1);
}

const geoFiles = fs.readdirSync(GEO_DIR).filter(f => f.endsWith('.geo.json'));
const baseFiles = geoFiles.filter(f => !/_SheepFurLayer\.geo\.json$/.test(f));
const metas = fs.readdirSync(GEO_DIR).filter(f => f.endsWith('.meta.json'));
let bonesTotal = 0;
let cubesTotal = 0;

for (const file of geoFiles) {
  const j = JSON.parse(fs.readFileSync(path.join(GEO_DIR, file), 'utf8'));
  const label = file.replace('.geo.json', '');
  if (j.format_version !== '1.12.0') fail(`${label}: format_version ${j.format_version}`);
  if (!Array.isArray(j['minecraft:geometry']) || j['minecraft:geometry'].length !== 1) {
    fail(`${label}: minecraft:geometry 不是单个数组`);
    continue;
  }
  const geo = j['minecraft:geometry'][0];
  const d = geo.description || {};
  if (!String(d.identifier || '').startsWith('geometry.what_guys_doing.')) fail(`${label}: identifier ${d.identifier}`);
  if (!Number.isInteger(d.texture_width) || !Number.isInteger(d.texture_height)) fail(`${label}: texture_width/height`);
  if (!Array.isArray(geo.bones) || !geo.bones.length) fail(`${label}: 没有 bones`);
  const names = new Set();
  for (const bone of geo.bones || []) {
    if (!bone.name) fail(`${label}: bone 没有 name`);
    if (names.has(bone.name)) fail(`${label}: bone 重名 ${bone.name}`);
    names.add(bone.name);
    if (!finiteArray(bone.pivot, 3)) fail(`${label}/${bone.name}: pivot`);
    if (bone.rotation && !finiteArray(bone.rotation, 3)) fail(`${label}/${bone.name}: rotation`);
    for (const cube of bone.cubes || []) {
      cubesTotal++;
      if (!finiteArray(cube.origin, 3)) fail(`${label}/${bone.name}: cube origin`);
      if (!finiteArray(cube.size, 3)) fail(`${label}/${bone.name}: cube size`);
      for (const [face, uv] of Object.entries(cube.uv || {})) {
        if (!FACE_NAMES.has(face)) fail(`${label}/${bone.name}: 未知面 ${face}`);
        if (!finiteArray(uv.uv, 2) || !finiteArray(uv.uv_size, 2)) fail(`${label}/${bone.name}/${face}: uv`);
        if (uv.uv_size[0] <= 0 || uv.uv_size[1] <= 0) fail(`${label}/${bone.name}/${face}: uv_size 非正`);
      }
    }
    bonesTotal++;
  }
  for (const bone of geo.bones || []) {
    if (bone.parent && !names.has(bone.parent)) fail(`${label}/${bone.name}: parent ${bone.parent} 不存在`);
  }
}

// pig 与 vanilla Bedrock 样本对照（坐标/pivot/旋转）
{
  const p = path.join(GEO_DIR, 'pig.geo.json');
  if (!fs.existsSync(p)) {
    fail('pig.geo.json 不存在');
  } else {
    const geo = JSON.parse(fs.readFileSync(p, 'utf8'))['minecraft:geometry'][0];
    const byName = new Map(geo.bones.map(b => [b.name, b]));
    const body = byName.get('body');
    const head = byName.get('head');
    if (geo.bones.length !== 6) fail(`pig: bones ${geo.bones.length} != 6`);
    if (!body || !head) fail('pig: 缺 body/head bone');
    if (body) {
      const rot = body.rotation || [];
      if (Math.abs(rot[0] - 90) > 1e-3) fail(`pig body rotation ${JSON.stringify(rot)}`);
      const c = body.cubes && body.cubes[0];
      if (!c || !finiteArray(c.origin, 3) || !finiteArray(c.size, 3)
        || c.origin.join(',') !== '-5,7,-5' || c.size.join(',') !== '10,16,8') {
        fail(`pig body cube ${JSON.stringify(c && { origin: c.origin, size: c.size })}`);
      }
    }
    if (head && head.pivot.join(',') !== '0,12,-6') fail(`pig head pivot ${head.pivot}`);
    const headCube = head && head.cubes && head.cubes[0];
    if (headCube && headCube.uv) {
      const up = headCube.uv.up;
      const down = headCube.uv.down;
      // 透明 gutter 的边会内缩 0.5 texel，所以 up 起点是 8.5；关键是 up 不能跑到 down 的 16。
      if (!up || !down || !(up.uv[0] < down.uv[0]) || Math.abs(down.uv[0] - 16) > 0.6) {
        fail(`pig head up/down 仍反：up=${JSON.stringify(up)} down=${JSON.stringify(down)}`);
      }
    }
    if (geo.description.texture_width !== 64 || geo.description.texture_height !== 32) {
      fail('pig texture size');
    }
  }
}

// sheep 的羊毛层要单独一个 geo
{
  const base = path.join(GEO_DIR, 'sheep.geo.json');
  const fur = path.join(GEO_DIR, 'sheep_SheepFurLayer.geo.json');
  if (!fs.existsSync(base)) fail('sheep.geo.json 不存在');
  if (!fs.existsSync(fur)) fail('sheep_SheepFurLayer.geo.json 不存在');
}

// meta sidecar
for (const file of ['pig.meta.json', 'sheep.meta.json']) {
  const p = path.join(GEO_DIR, file);
  if (!fs.existsSync(p)) { fail(`${file} 不存在`); continue; }
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!m.id || !m.base || !m.base.geometry || !m.base.texture) fail(`${file}: 结构不完整`);
  if (file === 'sheep.meta.json' && !(m.layers || []).some(l => l.name === 'SheepFurLayer')) {
    fail('sheep.meta.json: 缺 SheepFurLayer');
  }
}

console.log(`  ${geoFiles.length} 个 geo（base ${baseFiles.length} + layer ${geoFiles.length - baseFiles.length}），${metas.length} 个 meta`);
console.log(`  ${bonesTotal} 个 bone，${cubesTotal} 个 cube`);
if (failures.length) {
  console.log(`FAILED: ${failures.length}`);
  for (const f of failures.slice(0, 20)) console.log('  ' + f);
  process.exitCode = 1;
} else {
  console.log('ALL PASSED：Bedrock geo 结构、pig vanilla 对照、sheep 层与 meta 均正常');
}
