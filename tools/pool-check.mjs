// pool-check.mjs — 顶点/索引池的分配、空洞、扩容/整理决策与 draw 合并（纯 Node）。
import { createMeshPool, INDEX_BYTES } from '../common/src/main/resources/assets/what_guys_doing/web/vertexpool.js';
import { VERTEX_STRIDE } from '../common/src/main/resources/assets/what_guys_doing/web/vertexformat.js';

let failed = 0;
function expect(name, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
}

console.log('=== 1. 分配与字节数 ===');
{
  const pool = createMeshPool({ vertexCapacity: 1000, solidIndexCapacity: 3000, translucentIndexCapacity: 600 });
  const a = pool.allocate(100, 200, 30);
  const b = pool.allocate(50, 120, 0);
  expect('两次分配相邻且不重叠', a.vertexOffset === 0 && b.vertexOffset === 100 && a.solidFirst === 0 && b.solidFirst === 200);
  expect('半透明索引单独计数', a.translucentFirst === 0 && b.translucentFirst === 30);
  const bytes = pool.vertexBufferBytes();
  expect('顶点缓冲 = 单个交错缓冲（容量 × 20 字节）',
    bytes.length === 1 && bytes[0] === 1000 * VERTEX_STRIDE, bytes.join(','));
  expect('索引缓冲 = 实体区 + 半透明区', pool.indexBufferBytes() === (3000 + 600) * INDEX_BYTES);
  expect('半透明区基址指向索引缓冲后半段', pool.translucentIndexBase() === 3000);
}

console.log('=== 2. 释放→空洞清零区间（下标为索引缓冲绝对位置）===');
{
  const pool = createMeshPool({ vertexCapacity: 1000, solidIndexCapacity: 3000, translucentIndexCapacity: 600 });
  const a = pool.allocate(100, 200, 30);
  const ranges = pool.free(a);
  expect('返回实体与半透明两段清零区间', ranges.length === 2 && ranges[0][0] === 0 && ranges[0][1] === 200 && ranges[1][0] === 3000 && ranges[1][1] === 30,
    JSON.stringify(ranges));
  expect('释放后 live 归零、used 不变（留洞不复用）', pool.solidIndexLive === 0 && pool.solidIndexUsed === 200);
  const zero = pool.allocate(10, 5, 0);
  expect('后续分配接在空洞之后（不打乱已发号）', zero.solidFirst === 200);
}

console.log('=== 3. 空间不足 → 扩容 或 整理 ===');
{
  // 空洞少 → 扩容
  const p1 = createMeshPool({ vertexCapacity: 100, solidIndexCapacity: 100, translucentIndexCapacity: 100 });
  p1.allocate(100, 100, 0);
  expect('用满后分配失败', p1.allocate(1, 1, 0) === null);
  const plan1 = p1.planOnFailure();
  expect('几乎无空洞 → 选择扩容，容量按存活量右尺寸化（100×4 → 向上取整到 64k）',
    plan1.action === 'grow' && plan1.vertexCapacity === 65536 && plan1.solidIndexCapacity === 65536, JSON.stringify(plan1));

  // 空洞多 → 整理
  const p2 = createMeshPool({ vertexCapacity: 1000, solidIndexCapacity: 1000, translucentIndexCapacity: 1000 });
  for (let i = 0; i < 10; i++) { const h = p2.allocate(50, 50, 0); p2.free(h); }
  const plan2 = p2.planOnFailure();
  expect('空洞占比 > 40% → 选择整理（并带右尺寸化的目标容量）',
    plan2.action === 'compact' && plan2.vertexCapacity > 0, JSON.stringify(plan2));

  // 右尺寸化：扩容/缩容都按目标容量设定，已分配区间不回退
  p1.resize(plan1);
  expect('右尺寸化后容量生效', p1.vertexCapacity === 65536 && p1.solidIndexCapacity === 65536);
  expect('设定容量不影响已分配区间', p1.vertexUsed === 100);
  p1.compact();
  expect('整理后 used/live 归零（整池重建前必须这样）', p1.vertexUsed === 0 && p1.solidIndexUsed === 0);
}

console.log('=== 4. draw 合并（相邻索引区间合成一次 draw）===');
{
  const pool = createMeshPool();
  // 三个相连 + 一个断开 + 一个空
  const items = [
    { firstIndex: 0, indexCount: 60, tag: 'a' },
    { firstIndex: 60, indexCount: 30, tag: 'b' },
    { firstIndex: 90, indexCount: 6, tag: 'c' },
    { firstIndex: 200, indexCount: 12, tag: 'd' },
    { firstIndex: 300, indexCount: 0, tag: 'e' },
  ];
  const runs = pool.mergeRuns(items);
  expect('相连区段合并为一次 draw', runs.length === 2, runs.map(r => `${r.firstIndex}+${r.indexCount}`).join(' '));
  expect('合并后覆盖范围正确', runs[0].firstIndex === 0 && runs[0].indexCount === 96 && runs[1].firstIndex === 200 && runs[1].indexCount === 12);
  expect('空段被跳过', runs.every(r => r.indexCount > 0));
  expect('items 可回溯（用于统计可见段数）', runs[0].items.length === 3 && runs[1].items.length === 1);
}

console.log('=== 5. 真实场景估算：763 可见段在 1869 已分配段中的合并效果 ===');
{
  const pool = createMeshPool();
  const sections = [];
  let first = 0;
  for (let i = 0; i < 1869; i++) {
    const count = 60 + (i % 7) * 6;      // 每段索引数不固定
    sections.push({ firstIndex: first, indexCount: count });
    first += count;
  }
  // 视锥内约 41%（与实测一致），随机挑选
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const visible = sections.filter(() => rnd() < 0.41);
  const runs = pool.mergeRuns(visible);
  console.log(`    可见 ${visible.length} 段 → ${runs.length} 次 draw（合并前 ${visible.length} 次）`);
  expect('合并确实减少 draw 次数', runs.length < visible.length);
  const total = runs.reduce((n, r) => n + r.indexCount, 0);
  const expectTotal = visible.reduce((n, s) => n + s.indexCount, 0);
  expect('合并不改变总索引数（不漏不重）', total === expectTotal, `${total} vs ${expectTotal}`);
}

console.log('=== 6. 真实装载序列：首次失败 → ×4 扩容 → 整理 → 一次装下 ===');
{
  const pool = createMeshPool({ vertexCapacity: 2 << 20, solidIndexCapacity: 4 << 20, translucentIndexCapacity: 1 << 20 });
  const per = { v: 3520, solid: 5280, tr: 60 };   // 实测约 880 面/段 → 3520 顶点、5280 索引
  let placedAfterRebuild = 0, totalPlaced = 0, rebuilds = 0, everFailed = false;
  for (let i = 0; i < 2016; i++) {
    let handle = pool.allocate(per.v, per.solid, per.tr);
    if (!handle) {
      rebuilds++;
      // 与 app.js 一致：失败后按决策扩容，并且**必须清空竞技场**（否则永远分配不成功）
      const plan = pool.planOnFailure();
      pool.resize(plan);
      pool.compact();
      placedAfterRebuild = 0;        // 整池重建 → 之前放下的段作废（随后重新网格化）
      handle = pool.allocate(per.v, per.solid, per.tr);
      if (!handle) { everFailed = true; break; }   // 右尺寸化后仍装不下 = 容量规划错误
    }
    placedAfterRebuild++;
    totalPlaced++;
  }
  expect('2016 段全部装入且扩容后不再失败', !everFailed && totalPlaced === 2016, `累计装入 ${totalPlaced}`);
  expect('整池重建次数收敛（存活量右尺寸化，一次覆盖订阅）', rebuilds <= 2, `${rebuilds} 次`);
  expect('最终顶点容量在合理区间（远小于出过问题的 32M ≈ 1.4 GB）',
    pool.vertexCapacity >= (7 << 20) && pool.vertexCapacity <= (12 << 20),
    `顶点容量 ${(pool.vertexCapacity / 1024).toFixed(0)}k ≈ ${(pool.vertexCapacity * 36 / 1048576).toFixed(0)} MB`);
  expect('扩容后容量确实覆盖稳态', pool.vertexUsed <= pool.vertexCapacity && pool.solidIndexUsed <= pool.solidIndexCapacity,
    `顶点 ${pool.vertexUsed}/${pool.vertexCapacity} 索引 ${pool.solidIndexUsed}/${pool.solidIndexCapacity}`);
}

console.log('=== 7. 按订阅半径预估容量（订阅时预估 → 正常情况一次都不扩容）===');
{
  const { estimatePoolCapacity } = await import('../common/src/main/resources/assets/what_guys_doing/web/vertexpool.js');
  const r8 = estimatePoolCapacity(8);
  // 实测半径 8：约 2016 段 × 3520 顶点 = 710 万顶点；预估必须覆盖它，否则又会中途扩容
  const observedVertices = 2016 * 3520;
  expect('半径 8 的预估覆盖实测需求（否则又会中途扩容）',
    r8.vertexCapacity >= observedVertices, `${r8.vertexCapacity} vs ${observedVertices}`);
  expect('半径 8 的预估不超过硬上限', r8.vertexCapacity <= (12 << 20), String(r8.vertexCapacity));
  expect('预估是 64k 的整数倍', r8.vertexCapacity % 65536 === 0 && r8.solidIndexCapacity % 65536 === 0);
  const r1 = estimatePoolCapacity(1);
  expect('小半径预估明显更小（不浪费显存）', r1.vertexCapacity * 10 < r8.vertexCapacity,
    `r1=${r1.vertexCapacity} r8=${r8.vertexCapacity}`);
  expect('预估随半径单调不减',
    estimatePoolCapacity(2).vertexCapacity >= r1.vertexCapacity
    && estimatePoolCapacity(16).vertexCapacity >= r8.vertexCapacity);
  console.log(`    预算：半径 1 → ${(r1.vertexCapacity / 1024).toFixed(0)}k 顶点；半径 8 → ${(r8.vertexCapacity / 1024).toFixed(0)}k 顶点`
    + `（约 ${(r8.vertexCapacity * 36 / 1048576).toFixed(0)} MB）`);

  // 上限必须用**字节**表达：把容量夹到设备单缓冲上限内（默认 256 MB），
  // 且夹完之后的**实际字节数**必须不超限 —— 这条正是 uv19 那个超限报错的根因。
  const { clampCapsToBytes } = await import('../common/src/main/resources/assets/what_guys_doing/web/vertexpool.js');
  const { VERTEX_STRIDE, INDEX_BYTES } = await import('../common/src/main/resources/assets/what_guys_doing/web/vertexformat.js')
    .then(m => ({ VERTEX_STRIDE: m.VERTEX_STRIDE, INDEX_BYTES: 4 }));
  const LIMIT = 256 << 20;
  const clamped = clampCapsToBytes(estimatePoolCapacity(16), LIMIT);   // 半径 16 必定超限，考验夹取
  expect('夹取后顶点缓冲字节数不超上限',
    clamped.vertexCapacity * VERTEX_STRIDE <= LIMIT, `${(clamped.vertexCapacity * VERTEX_STRIDE / 1048576).toFixed(0)} MB`);
  expect('夹取后索引缓冲字节数不超上限',
    (clamped.solidIndexCapacity + clamped.translucentIndexCapacity) * INDEX_BYTES <= LIMIT,
    `${((clamped.solidIndexCapacity + clamped.translucentIndexCapacity) * INDEX_BYTES / 1048576).toFixed(0)} MB`);
  expect('夹取确实生效（半径 16 的原始预估值应更大）',
    clamped.vertexCapacity < estimatePoolCapacity(16).vertexCapacity,
    `${clamped.vertexCapacity} vs ${estimatePoolCapacity(16).vertexCapacity}`);
}

console.log('');
if (failed) {
  console.log(`FAILED: ${failed} 项断言未通过`);
  process.exit(1);
}
console.log('ALL PASSED：池分配/空洞/扩容整理/draw 合并均符合预期');
