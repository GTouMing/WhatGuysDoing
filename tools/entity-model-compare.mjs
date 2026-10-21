// entity-model-compare.mjs — 比较两个 generated-wgd-2 模型（逐 part / cube / 面）。
//
//   node tools/entity-model-compare.mjs <a.json> <b.json> [--tol 0.001]
//
// 比较内容：part 名、cube 顺序、每个面的 4 个 position / 4 个 uv。
// 坐标容差默认 0.001 模型单位（1/16000 方块）。
import fs from 'node:fs';

const [pathA, pathB, ...rest] = process.argv.slice(2);
if (!pathA || !pathB) {
  console.error('用法: node tools/entity-model-compare.mjs <a.json> <b.json> [--tol 0.001]');
  process.exit(2);
}
const tolIdx = rest.indexOf('--tol');
const tol = tolIdx >= 0 ? Number(rest[tolIdx + 1]) : 0.001;

const read = p => {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { raw: j, parts: j.parts || [] };
};
const a = read(pathA);
const b = read(pathB);
const failures = [];

const byName = model => {
  const map = new Map();
  for (const part of model.parts) {
    if (!map.has(part.name)) map.set(part.name, []);
    map.get(part.name).push(part);
  }
  return map;
};
const aParts = byName(a);
const bParts = byName(b);

const close = (x, y) => Math.abs(Number(x) - Number(y)) <= tol;
let comparedParts = 0;
let comparedCubes = 0;
let comparedQuads = 0;

for (const name of new Set([...aParts.keys(), ...bParts.keys()])) {
  const listA = aParts.get(name) || [];
  const listB = bParts.get(name) || [];
  if (listA.length !== listB.length) {
    failures.push(`part ${name}: 数量 ${listA.length} != ${listB.length}`);
  }
  for (let pi = 0; pi < Math.min(listA.length, listB.length); pi++) {
    const partA = listA[pi];
    const partB = listB[pi];
    comparedParts++;
    const cubesA = partA.cubes || [];
    const cubesB = partB.cubes || [];
    if (cubesA.length !== cubesB.length) {
      failures.push(`part ${name}[${pi}]: cube 数量 ${cubesA.length} != ${cubesB.length}`);
    }
    for (let ci = 0; ci < Math.min(cubesA.length, cubesB.length); ci++) {
      comparedCubes++;
      const quadsA = new Map((cubesA[ci].quads || []).map(q => [q.face, q]));
      const quadsB = new Map((cubesB[ci].quads || []).map(q => [q.face, q]));
      if (quadsA.size !== quadsB.size) {
        failures.push(`part ${name}[${pi}] cube ${ci}: 面数 ${quadsA.size} != ${quadsB.size}`);
      }
      for (const face of new Set([...quadsA.keys(), ...quadsB.keys()])) {
        const qa = quadsA.get(face);
        const qb = quadsB.get(face);
        if (!qa || !qb) {
          failures.push(`part ${name}[${pi}] cube ${ci} ${face}: 只在一侧存在`);
          continue;
        }
        comparedQuads++;
        let bad = 0;
        for (let i = 0; i < 4; i++) {
          for (let k = 0; k < 3; k++) {
            if (!close(qa.positions[i][k], qb.positions[i][k])) bad++;
          }
          for (let k = 0; k < 2; k++) {
            if (!close(qa.uvs[i][k], qb.uvs[i][k])) bad++;
          }
        }
        if (bad) failures.push(`part ${name}[${pi}] cube ${ci} ${face}: ${bad} 个分量不等`);
      }
    }
  }
}

console.log(`A ${pathA}  parts ${a.parts.length}  texture_size ${JSON.stringify(a.raw.texture_size)}`);
console.log(`B ${pathB}  parts ${b.parts.length}  texture_size ${JSON.stringify(b.raw.texture_size)}`);
console.log(`比较 part ${comparedParts}、cube ${comparedCubes}、面 ${comparedQuads}，差异 ${failures.length}`);
for (const f of failures.slice(0, 20)) console.log('  ✗ ' + f);
console.log(failures.length === 0 ? 'ALL PASSED：逐 part / cube / 面一致' : 'FAILED');
process.exitCode = failures.length === 0 ? 0 : 1;
