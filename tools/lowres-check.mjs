// lowres-check — 全局低模 heightfield 纯几何回归（不依赖 WebGPU/DOM）。
import assert from 'node:assert/strict';
import { buildLowresMesh, spanFor } from '../common/src/main/resources/assets/what_guys_doing/web/lowres.js';

assert.equal(spanFor(1), 500);
assert.equal(spanFor(2), 2500);
assert.equal(spanFor(3), 12500);

const W = 501;
const H = 1002;
const pixels = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (y < H / 2) {
      pixels[i] = 200; pixels[i + 1] = 100; pixels[i + 2] = 50; pixels[i + 3] = 255;
    } else {
      pixels[i] = 15; pixels[i + 1] = 0; pixels[i + 2] = 64; pixels[i + 3] = 255;
    }
  }
}
// 左上角 height=64, 其余 height=65；meta red=15（full light）。
for (let x = 0; x < W; x++) {
  const i = (H / 2) * W * 4 + x * 4;
  pixels[i + 1] = 0; pixels[i + 2] = 65;
}
{
  const i = (H / 2) * W * 4;
  pixels[i + 2] = 64;
}

const mesh = buildLowresMesh(pixels, W, H, 0, 0, 500, 0.1, 50, 1);
assert.equal(mesh.quadCount, 50 * 50);
assert.equal(mesh.vertexCount, 50 * 50 * 4);
assert.equal(mesh.indices.length, 50 * 50 * 6);
assert.equal(mesh.positions[1], 64.1, 'tile first corner height');
assert.equal(mesh.positions[4 * 3 + 1], 65.1, 'second cell first corner height');
// 顶点只保留基础颜色；slope shade 由片元高度纹理计算。
assert.equal(mesh.tints[0], 200 / 255);
assert.equal(mesh.tints[1], 100 / 255);
assert.equal(mesh.lights[0], 1);
assert.equal(mesh.positions[3], 10, 'cell width is 10 blocks for LOD1');

const lod3 = buildLowresMesh(pixels, W, H, 2, -1, 12500, 0, 17, 3);
assert.equal(lod3.positions[0], 2 * 12500);
assert.equal(lod3.positions[2], -1 * 12500);
assert.ok(Math.abs(lod3.positions[3] - (2 * 12500 + 12500 / 17)) < 1e-6,
  'LOD3 cell width is 12500/17 blocks');

console.log('lowres-check: OK');
