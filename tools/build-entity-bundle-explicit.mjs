// build-entity-bundle.mjs — 把 generated-wgd-2 实体模型与 entitystates 打成一个 JSON。
//
// 这是**运行时**bundle：源是 dumper 直接输出的显式四边形，保留 per-face UV 角序、
// 骨骼变换和 layer 数据。Blockbench 的 .geo.json 是 sidecar（见 build-entity-bundle-geo.mjs），
// 不直接作为运行时源 —— 因为它无法无损表达面内 UV 旋转/mirror、非均匀 scale 等。
//
//   node tools/build-entity-bundle.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join('common', 'src', 'main', 'resources', 'assets', 'what_guys_doing');
const MODELS_DIR = path.join(ROOT, 'entitymodels', 'entity');
const STATES_DIR = path.join(ROOT, 'entitystates');
const OUT = path.join(ROOT, 'entitybundle.json');

function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.json')) out.push(rel);
  }
  return out;
}

const models = {};
for (const rel of walk(MODELS_DIR)) {
  const key = rel.replace(/\.json$/, '');
  models[key] = JSON.parse(fs.readFileSync(path.join(MODELS_DIR, rel), 'utf8'));
}

const states = {};
for (const rel of walk(STATES_DIR)) {
  const key = rel.replace(/\.json$/, '');
  states[key] = JSON.parse(fs.readFileSync(path.join(STATES_DIR, rel), 'utf8'));
}

const bundle = {
  version: 2,
  source: 'generated-wgd-2 (EntityModelDumper)',
  generatedFrom: { models: Object.keys(models).length, states: Object.keys(states).length },
  models,
  states,
};

fs.writeFileSync(OUT, JSON.stringify(bundle));
console.log(`models ${Object.keys(models).length}, states ${Object.keys(states).length}`);
console.log(`-> ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
