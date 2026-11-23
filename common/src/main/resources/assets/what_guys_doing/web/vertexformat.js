// vertexformat.js — 地形顶点格式：**单一交错缓冲**，20 B/顶点（原来 4 个流共 36 B）。
//
// DOM-free：运行时（app.js 建管线/上传）与测试（tools/vertexformat-check.mjs）共用同一份定义，
// 布局不会两边漂移。
//
// 布局（stride 20，全部按 4 字节对齐）：
//   @0  float32x3   position   世界坐标（共享池 + 跨段合并绘制，不能用段内相对坐标：没有每段原点可用）
//   @12 unorm16x2   uv         图集坐标
//   @16 unorm8x4    tint.rgb   染色
//                   tint.a     光照（合并后的单值 0..1，与网格化时的 light 含义一致）
//
// 为什么 uv 用 unorm16 而不是 f16：f16 在 0.5 附近精度约 5e-4，与 256 图集的纹素尺寸（3.9e-3）
// 同量级，最邻近采样有取错纹素的风险；unorm16 精度 1.5e-5，富余两个数量级。
// 为什么 8 位只有一个属性：WebGPU 的 8 位顶点格式只有 x2/x4，没有 x3，所以染色与光照合进一个 unorm8x4。

export const VERTEX_STRIDE = 24;

/** 管线用的属性表（app.js 直接拿它建 vertex.buffers）。 */
export const VERTEX_ATTRIBUTES = [
  { shaderLocation: 0, offset: 0, format: 'float32x3' },
  { shaderLocation: 1, offset: 12, format: 'unorm16x2' },
  { shaderLocation: 2, offset: 16, format: 'unorm8x4' },
  // AO：x = 遮挡系数（0..1），y 留给后续（平滑光照标志等）。
  // 注意：声明成 unorm8x2 就必须在 WGSL 里用 vec2f 接收 —— 分量数不匹配会让管线校验失败，
  // 之后所有引用它的命令都会报 "Invalid CommandBuffer"。
  { shaderLocation: 3, offset: 20, format: 'unorm8x2' },
];

/** 交错缓冲需要的字节数。 */
export const vertexBytesFor = vertexCount => vertexCount * VERTEX_STRIDE;

/**
 * 把 mesher 的 4 个独立数组交错了成一块缓冲。
 * mesher 与既有回归脚本都按「4 个独立数组」工作，交错放在上传前一步做，改动面最小。
 *
 * 返回体附带 anomalies：NaN/非有限值会被**挡成安全值**（否则 unorm 量化会把 NaN 变成 0，
 * 表现为"纯黑的不透明面"），同时计数以便 HUD 直接报出来。
 */
export function interleaveMesh(mesh) {
  const count = mesh.vertexCount;
  const buffer = new ArrayBuffer(vertexBytesFor(count));
  const view = new DataView(buffer);
  const positions = mesh.positions;
  const uvs = mesh.uvs;
  const tints = mesh.tints;
  const lights = mesh.lights;
  const aos = mesh.aos;
  const alphas = mesh.alphas;
  let nanValues = 0;
  let zeroTints = 0;
  let zeroLights = 0;
  /** 只挡 NaN，**不夹取**：位置是世界坐标，夹到 [0,1] 会把所有几何压进 1×1×1。 */
  const finite = v => {
    if (Number.isFinite(v)) return v;
    nanValues++;
    return 0;
  };
  /** 0..1 语义的分量：挡 NaN 并夹取。 */
  const safe01 = (v, fallback) => {
    if (!Number.isFinite(v)) { nanValues++; return fallback; }
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  };
  for (let i = 0; i < count; i++) {
    const base = i * VERTEX_STRIDE;
    view.setFloat32(base, finite(positions[i * 3]), true);
    view.setFloat32(base + 4, finite(positions[i * 3 + 1]), true);
    view.setFloat32(base + 8, finite(positions[i * 3 + 2]), true);
    view.setUint16(base + 12, Math.round(safe01(uvs[i * 2], 0) * 65535), true);
    view.setUint16(base + 14, Math.round(safe01(uvs[i * 2 + 1], 0) * 65535), true);
    const r = safe01(tints[i * 3], 1);
    const g = safe01(tints[i * 3 + 1], 1);
    const b = safe01(tints[i * 3 + 2], 1);
    const light = safe01(lights[i], 0);
    if (r === 0 && g === 0 && b === 0) zeroTints++;
    if (light === 0) zeroLights++;
    view.setUint8(base + 16, Math.round(r * 255));
    view.setUint8(base + 17, Math.round(g * 255));
    view.setUint8(base + 18, Math.round(b * 255));
    view.setUint8(base + 19, Math.round(light * 255));
    // AO 缺省 1（不做 AO 的老网格仍然正常）
    const ao = safe01(aos ? aos[i] ?? 1 : 1, 1);
    view.setUint8(base + 20, Math.round(ao * 255));
    // lowres 用第二个分量携带“是否存在方块”的 alpha；普通地形/实体缺省 1。
    const alpha = safe01(alphas ? alphas[i] ?? 1 : 1, 1);
    view.setUint8(base + 21, Math.round(alpha * 255));
    view.setUint8(base + 22, 0);
    view.setUint8(base + 23, 0);
  }
  return { buffer, count, anomalies: { nanValues, zeroTints, zeroLights } };
}

/** 读回一个顶点（测试与诊断用；与 GPU 的 unorm 解码语义一致）。 */
export function readVertex(buffer, index) {
  const view = new DataView(buffer);
  const base = index * VERTEX_STRIDE;
  return {
    position: [view.getFloat32(base, true), view.getFloat32(base + 4, true), view.getFloat32(base + 8, true)],
    uv: [view.getUint16(base + 12, true) / 65535, view.getUint16(base + 14, true) / 65535],
    tint: [view.getUint8(base + 16) / 255, view.getUint8(base + 17) / 255, view.getUint8(base + 18) / 255],
    light: view.getUint8(base + 19) / 255,
    ao: view.getUint8(base + 20) / 255,
    alpha: view.getUint8(base + 21) / 255,
  };
}
