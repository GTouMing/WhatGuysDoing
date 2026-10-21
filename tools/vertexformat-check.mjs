// vertexformat-check.mjs — 交错顶点格式回归（纯 Node）。
// 断言布局表本身、量化往返误差、以及"确实省了字节"。
import {
  VERTEX_STRIDE, VERTEX_ATTRIBUTES, vertexBytesFor, interleaveMesh, readVertex,
} from '../common/src/main/resources/assets/what_guys_doing/web/vertexformat.js';

let failed = 0;
function expect(name, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
}

console.log('=== 1. 布局表 ===');
{
  const sizes = { float32x3: 12, unorm16x2: 4, unorm8x4: 4, unorm8x2: 2 };
  expect('stride = 24（20 字节 + AO 的 unorm8x4）', VERTEX_STRIDE === 24, String(VERTEX_STRIDE));
  let covered = 0;
  let aligned = true;
  let inRange = true;
  for (const a of VERTEX_ATTRIBUTES) {
    covered += sizes[a.format];
    if (a.offset % 4 !== 0) aligned = false;                    // 多字节属性必须 4 字节对齐
    if (a.offset + sizes[a.format] > VERTEX_STRIDE) inRange = false;
  }
  expect('属性恰好铺满 stride（只允许尾部少量填充）',
    covered <= VERTEX_STRIDE && VERTEX_STRIDE - covered <= 3, `覆盖 ${covered} / stride ${VERTEX_STRIDE}`);
  expect('属性偏移 4 字节对齐', aligned, VERTEX_ATTRIBUTES.map(a => a.offset).join(','));
  expect('属性不越出 stride', inRange);
  expect('着色器位置连续 0..3（与 WGSL 的 @location 对应）',
    VERTEX_ATTRIBUTES.map(a => a.shaderLocation).join(',') === '0,1,2,3');
  expect('字节数 = 顶点数 × 24', vertexBytesFor(1000) === 24000, String(vertexBytesFor(1000)));
}

console.log('=== 2. 量化往返误差 ===');
{
  // 造 3 个顶点：位置/uv/染色/光照都用能暴露精度问题的值
  const count = 3;
  const mesh = {
    vertexCount: count,
    positions: new Float32Array([
      -64.125, -29.5, 80.75,
      1234.5, 96.25, -4321.875,
      0, 0, 0,
    ]),
    uvs: new Float32Array([0.5020, 0.0039, 0.5605, 0.1211, 1, 0]),
    tints: new Float32Array([0.8, 0.45, 0.2, 1, 1, 1, 0.5, 0.5, 0.5]),
    lights: new Float32Array([0.9372549, 1, 0]),
  };
  const { buffer } = interleaveMesh(mesh);
  expect('缓冲字节数 = 顶点数 × stride', buffer.byteLength === count * VERTEX_STRIDE, String(buffer.byteLength));

  const v0 = readVertex(buffer, 0);
  expect('位置保持 f32 精度（世界坐标不受量化影响）',
    v0.position[0] === -64.125 && v0.position[1] === -29.5 && v0.position[2] === 80.75, v0.position.join(','));
  expect('uv 误差 < 1/65535（unorm16）',
    Math.abs(v0.uv[0] - 0.5020) < 1 / 65535 && Math.abs(v0.uv[1] - 0.0039) < 1 / 65535, v0.uv.join(','));
  expect('染色误差 ≤ 1/255（unorm8）',
    Math.abs(v0.tint[0] - 0.8) <= 1 / 255 && Math.abs(v0.tint[2] - 0.2) <= 1 / 255, v0.tint.join(','));
  expect('光照误差 ≤ 1/255', Math.abs(v0.light - 0.9372549) <= 1 / 255, String(v0.light));

  const v1 = readVertex(buffer, 1);
  expect('第 2 个顶点没串位（大坐标）',
    v1.position[0] === 1234.5 && v1.position[2] === -4321.875
    && Math.abs(v1.uv[0] - 0.5605) < 1 / 65535 && Math.abs(v1.uv[1] - 0.1211) < 1 / 65535,
    `${v1.position.join(',')} / ${v1.uv.join(',')}`);
  const v2 = readVertex(buffer, 2);
  expect('uv=1 精确表示（65535/65535）', v2.uv[0] === 1, String(v2.uv[0]));
  expect('零值顶点：位置与光照为 0', v2.position.every(v => v === 0) && v2.light === 0);

  // 越界值必须夹住而不是回绕（否则会画到别的瓦片/变成全黑）
  const clamped = interleaveMesh({
    vertexCount: 1,
    positions: new Float32Array([0, 0, 0]),
    uvs: new Float32Array([-0.5, 1.7]),
    tints: new Float32Array([2, -1, 0.5]),
    lights: new Float32Array([9]),
  });
  const c = readVertex(clamped.buffer, 0);
  expect('uv 越界被夹到 [0,1]', c.uv[0] === 0 && c.uv[1] === 1, c.uv.join(','));
  expect('染色越界被夹到 [0,1]（量化到 128/255）',
    c.tint[0] === 1 && c.tint[1] === 0 && Math.abs(c.tint[2] - 0.5) <= 1 / 255, c.tint.join(','));
  expect('光照越界被夹到 1', c.light === 1, String(c.light));

  // NaN 会被 unorm 量化成 0 → 表现为"纯黑的不透明面"。必须挡成安全值并计数。
  const nanMesh = interleaveMesh({
    vertexCount: 2,
    positions: new Float32Array([Number.NaN, 0, 0, 1, 2, 3]),
    uvs: new Float32Array([Number.NaN, 0.5, 0.5, 0.5]),
    tints: new Float32Array([Number.NaN, 1, 1, 0.5, 0.5, 0.5]),
    lights: new Float32Array([Number.NaN, 0.5]),
  });
  const n0 = readVertex(nanMesh.buffer, 0);
  expect('NaN 染色被挡成 1（否则会变成纯黑面）', n0.tint[0] === 1, n0.tint.join(','));
  expect('NaN 位置被挡成 0、NaN uv 被挡成 0、NaN 光照被挡成 0',
    n0.position[0] === 0 && n0.uv[0] === 0 && n0.light === 0, `${n0.position[0]}/${n0.uv[0]}/${n0.light}`);
  expect('异常被计数（NaN 值 4 个：位置/uv/染色/光照各一）',
    nanMesh.anomalies.nanValues === 4, JSON.stringify(nanMesh.anomalies));
  const n1 = readVertex(nanMesh.buffer, 1);
  expect('未 NaN 的顶点不受影响（位置精确）', n1.position[0] === 1 && n1.position[1] === 2 && n1.position[2] === 3);
  expect('零染色/零光照被计数', nanMesh.anomalies.zeroTints === 0 && nanMesh.anomalies.zeroLights === 1,
    JSON.stringify(nanMesh.anomalies));
  // 关键：位置是世界坐标，绝不能被夹到 [0,1]（那会把所有几何压进 1×1×1）
  expect('位置只挡 NaN、不夹取（大坐标原样保留）', n1.position[0] === 1 && n1.position[1] === 2 && n1.position[2] === 3,
    n1.position.join(','));
  const bigPos = interleaveMesh({
    vertexCount: 1,
    positions: new Float32Array([1234.5, -4321.875, 96.25]),
    uvs: new Float32Array([0.5, 0.5]),
    tints: new Float32Array([1, 1, 1]),
    lights: new Float32Array([1]),
  });
  const bp = readVertex(bigPos.buffer, 0);
  expect('世界坐标 1234.5 / -4321.875 / 96.25 原样保留', bp.position[0] === 1234.5 && bp.position[1] === -4321.875 && bp.position[2] === 96.25,
    bp.position.join(','));
}

console.log('=== 3. 与旧格式的体积对比（实测每段约 3520 顶点）===');
{
  const perSection = 3520;
  const before = perSection * 36;
  const after = perSection * VERTEX_STRIDE;
  console.log(`    每段 ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB` +
    `（1921 段：${(before * 1921 / 1048576).toFixed(0)} MB → ${(after * 1921 / 1048576).toFixed(0)} MB）`);
  expect('顶点字节数减少约三分之一（36 → 24，含新增 AO）', after / before < 0.7, `${((1 - after / before) * 100).toFixed(1)}%`);
}

console.log('=== 4. 格式表与 WGSL 声明必须一致（分量数不匹配会让管线校验失败）===');
{
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../common/src/main/resources/assets/what_guys_doing/web/app.js', import.meta.url), 'utf8');
  // 文件里有两个 vs（地形 / 实例化立方体），挑参数里含 packed 的那个 = 地形管线。
  // 注意别用 [^)]* —— @location(1) 自己带括号，会把匹配截断（这个坑刚踩过）。
  const vsMatch = [...app.matchAll(/fn vs\((.*?)\)\s*->/gs)].find(m => m[1].includes('packed'));
  expect('找到地形管线的 vs 声明', !!vsMatch, vsMatch ? '' : '未匹配到');
  if (vsMatch) {
    const declared = new Map();
    for (const m of vsMatch[0].matchAll(/@location\((\d+)\)\s+\w+:\s*(f32|vec2f|vec3f|vec4f)/g)) {
      declared.set(Number(m[1]), { f32: 1, vec2f: 2, vec3f: 3, vec4f: 4 }[m[2]]);
    }
    const components = { float32x3: 3, unorm16x2: 2, unorm8x4: 4, unorm8x2: 2 };
    let mismatch = '';
    for (const a of VERTEX_ATTRIBUTES) {
      const want = components[a.format];
      const got = declared.get(a.shaderLocation);
      if (got !== want) mismatch += `loc${a.shaderLocation}: 格式 ${a.format}(${want} 分量) vs WGSL ${got ?? '缺失'}；`;
    }
    expect('每个 @location 的分量数与顶点格式一致', mismatch === '', mismatch);

    // 结构体字段赋值也要核对：`out.ao = ao.x` 这种"分量数不同"的赋值 WGSL 会直接报错
    // （Node 没有 WebGPU，编译不了 shader，所以只能在源码层面把这条规则钉住）。
    const structBody = [...app.matchAll(/struct VSOut \{([^}]*)\}/gs)]
      .map(m => m[1]).find(body => body.includes('ao'));
    expect('找到地形管线的 VSOut 结构体', !!structBody, structBody ? '' : '未匹配到');
    if (structBody) {
      const fieldComponents = {};
      for (const f of structBody.matchAll(/@location\((\d+)\)\s+(\w+):\s*(f32|vec2f|vec3f|vec4f)/g)) {
        fieldComponents[f[2]] = { f32: 1, vec2f: 2, vec3f: 3, vec4f: 4 }[f[3]];
      }
      const paramComponents = {};
      for (const p of vsMatch[1].matchAll(/@location\((\d+)\)\s+(\w+):\s*(f32|vec2f|vec3f|vec4f)/g)) {
        paramComponents[p[2]] = { f32: 1, vec2f: 2, vec3f: 3, vec4f: 4 }[p[3]];
      }
      const swizzleLen = { x: 1, y: 1, z: 1, w: 1, xy: 2, xyz: 3, rgba: 4, rgb: 3 };
      const vsBody = app.slice(app.indexOf(vsMatch[0]), app.indexOf('return out;', app.indexOf(vsMatch[0])));
      let assignBad = '';
      for (const a of vsBody.matchAll(/out\.(\w+)\s*=\s*([\w.]+)\s*;/g)) {
        const field = fieldComponents[a[1]];
        const [, base, swizzle] = a[2].match(/^(\w+)(?:\.(\w+))?$/) || [];
        const exprComponents = swizzle ? swizzleLen[swizzle] : paramComponents[base];
        if (field === undefined || exprComponents === undefined) continue;
        if (field !== exprComponents) assignBad += `out.${a[1]}(${field} 分量) = ${a[2]}(${exprComponents} 分量)；`;
      }
      expect('vs 里每条 out.X 赋值的分量数都一致', assignBad === '', assignBad);
    }
  }
}

console.log('');
if (failed) {
  console.log(`FAILED: ${failed} 项断言未通过`);
  process.exit(1);
}
console.log('ALL PASSED：交错顶点格式与量化往返正确');
