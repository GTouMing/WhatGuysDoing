// entityrender-check.mjs — M3a per-part 模板/实例矩阵回归（无 DOM）。
import fs from 'node:fs';
import {
  buildEntityPartTemplates, buildEntityPartInstances, entityWorldMatrix,
} from '../common/src/main/resources/assets/what_guys_doing/web/entityrender.js';
import { buildEntityMesh } from '../common/src/main/resources/assets/what_guys_doing/web/entitymesh.js';

const bundle = JSON.parse(fs.readFileSync('common/src/main/resources/assets/what_guys_doing/entitybundle.json', 'utf8'));
let failed = 0;
const expect = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};

const uvRectFor = () => [0, 0, 1, 1];
const spriteFor = () => 0;
const typeKeys = new Map([[128, 'minecraft:pig']]);
const entity = { netId: 1, typeId: 128, x: 10, y: 64, z: 20, yaw: 0 };
const templates = buildEntityPartTemplates(bundle, typeKeys, uvRectFor);
console.log('=== 1. part 模板 ===');
expect('pig 有一个类型模板', templates.size === 1);
const template = templates.get('minecraft:pig');
expect('模板模型是 pig', !!template && template.modelKey === 'pig', template && template.modelKey);
expect('pig 6 个 part', !!template && template.parts.length === 6, String(template && template.parts.length));
expect('pig 42 个 quad', !!template && template.quadCount === 42, String(template && template.quadCount));
const partQuad = template && template.parts.reduce((n, p) => n + p.quadCount, 0);
expect('part quad 总数 42', partQuad === 42, String(partQuad));

console.log('\n=== 2. 实例矩阵 ===');
const instances = buildEntityPartInstances(templates, [entity], typeKeys);
expect('每 part 一个实例桶', instances.size === 6, String(instances.size));
let instanceTotal = 0;
for (const v of instances.values()) instanceTotal += v.count;
expect('实例总数 6', instanceTotal === 6, String(instanceTotal));
const m = entityWorldMatrix(entity);
expect('矩阵平移是实体位置', m[12] === 10 && m[13] === 64 && m[14] === 20);
expect('矩阵含 1/16 缩放', Math.abs(Math.abs(m[0]) - 1 / 16) < 1e-6, String(m[0]));

console.log('\n=== 3. 与 entitymesh 世界包围盒一致 ===');
const mesh = buildEntityMesh(bundle, [entity], typeKeys, uvRectFor, spriteFor);
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (let i = 0; i < mesh.vertexCount; i++) {
  const x = mesh.positions[i * 3], y = mesh.positions[i * 3 + 1], z = mesh.positions[i * 3 + 2];
  minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
}
let tMinX = Infinity, tMaxX = -Infinity, tMinY = Infinity, tMaxY = -Infinity, tMinZ = Infinity, tMaxZ = -Infinity;
for (const bucket of instances.values()) {
  const bm = bucket.matrices;
  for (let i = 0; i < bucket.count; i++) {
    const o = i * 16;
    for (const part of template.parts) {
      for (let vi = 0; vi < part.vertices.length; vi += 5) {
        const x = part.vertices[vi], y = part.vertices[vi + 1], z = part.vertices[vi + 2];
        const wx = bm[o] * x + bm[o + 4] * y + bm[o + 8] * z + bm[o + 12];
        const wy = bm[o + 1] * x + bm[o + 5] * y + bm[o + 9] * z + bm[o + 13];
        const wz = bm[o + 2] * x + bm[o + 6] * y + bm[o + 10] * z + bm[o + 14];
        tMinX = Math.min(tMinX, wx); tMaxX = Math.max(tMaxX, wx);
        tMinY = Math.min(tMinY, wy); tMaxY = Math.max(tMaxY, wy);
        tMinZ = Math.min(tMinZ, wz); tMaxZ = Math.max(tMaxZ, wz);
      }
    }
  }
}
const same = (a, b) => Math.abs(a - b) < 1e-5;
expect('包围盒 x 一致', same(minX, tMinX) && same(maxX, tMaxX), `${minX}/${maxX} vs ${tMinX}/${tMaxX}`);
expect('包围盒 y 一致', same(minY, tMinY) && same(maxY, tMaxY), `${minY}/${maxY} vs ${tMinY}/${tMaxY}`);
expect('包围盒 z 一致', same(minZ, tMinZ) && same(maxZ, tMaxZ), `${minZ}/${maxZ} vs ${tMinZ}/${tMaxZ}`);

console.log('\n=== 结果 ===');
if (failed) {
  console.log(`FAILED：${failed} 项`);
  process.exitCode = 1;
} else {
  console.log('ALL PASSED：part 模板、实例矩阵与 entitymesh 一致');
}
