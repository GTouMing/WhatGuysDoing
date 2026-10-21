// 校验服务端 /api/blockstates 生成的「属性串」是否与真实资源包里的 blockstate key 一致。
// 用法：先起服务端（runServer/runClient），再 node tools/verify-blockstates.mjs
//   WGD_PORT=27183  WGD_RADIUS=3  WGD_ASSET_DIR=<content/minecraft 路径>
import fs from 'node:fs';
import path from 'node:path';
import { Reader } from '../common/src/main/resources/assets/what_guys_doing/web/protocol.js';

const PORT = Number(process.env.WGD_PORT || 27183);
const RADIUS = Number(process.env.WGD_RADIUS || 3);
const CONTENT = process.env.WGD_ASSET_DIR
  || path.join('neoforge', 'run', 'config', 'what_guys_doing', 'assets', 'content', 'minecraft');

const paletteIds = new Set();
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
ws.binaryType = 'arraybuffer';
ws.onopen = () => {
  const buf = Buffer.alloc(11);
  buf.writeUInt8(0x81, 0); buf.writeUInt8(0, 1);
  buf.writeInt32LE(0, 2); buf.writeInt32LE(0, 6); buf.writeUInt8(RADIUS, 10);
  ws.send(buf);
};
ws.onmessage = ev => {
  const r = new Reader(ev.data);
  const type = r.u8();
  if (type !== 0x02) return;                       // 只看 SECTION_FULL
  r.u8(); r.i32(); r.i32(); r.i32();
  const paletteSize = r.u16();
  for (let i = 0; i < paletteSize; i++) paletteIds.add(r.u32());
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

setTimeout(async () => {
  ws.close();
  const ids = [...paletteIds].sort((a, b) => a - b);
  console.log(`采集到 ${ids.length} 个 stateId（来自订阅范围内所有 section 的调色板）`);

  // 分批取描述符（每次 ≤128 个，避免 URL 过长）
  const rows = [];
  for (let i = 0; i < ids.length; i += 128) {
    const chunk = ids.slice(i, i + 128);
    const res = await fetch(`http://127.0.0.1:${PORT}/api/blockstates?ids=${chunk.join(',')}`);
    const text = await res.text();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const [id, block, props] = line.split('\t');
      rows.push({ id: Number(id), block, props: props ?? '' });
    }
  }
  console.log(`取回 ${rows.length} 条描述符\n`);

  const stats = { exact: 0, subset: 0, miss: 0, multipartOk: 0, multipartBad: 0, noFile: 0, noModel: 0, unknown: 0 };
  const misses = [];
  const byBlock = new Map();
  const bump = (block, kind) => byBlock.set(block, [...(byBlock.get(block) || []), kind]);
  const cache = new Map();
  const readBlockstate = blockName => {
    if (cache.has(blockName)) return cache.get(blockName);
    const short = blockName.includes(':') ? blockName.split(':')[1] : blockName;
    const file = path.join(CONTENT, 'blockstates', `${short}.json`);
    let json = null;
    try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { json = null; }
    cache.set(blockName, json);
    return json;
  };

  /** 状态属性串是否满足某个 blockstate key：key 未列举的属性一律忽略，"" 匹配一切。 */
  function matchesKey(props, key) {
    if (key === '') return true;
    const propMap = new Map(props ? props.split(',').map(p => p.split('=')) : []);
    for (const kv of key.split(',')) {
      const eq = kv.indexOf('=');
      const k = kv.slice(0, eq);
      const v = kv.slice(eq + 1);
      if (propMap.get(k) !== v) return false;
    }
    return true;
  }

  for (const row of rows) {
    if (row.block === '?') { stats.unknown++; bump(row.block, 'unknown'); continue; }
    const json = readBlockstate(row.block);
    if (!json) { stats.noFile++; bump(row.block, 'noFile'); if (misses.length < 12) misses.push(`${row.id} ${row.block} -> 没有 blockstates 文件`); continue; }
    if (json.variants) {
      const keys = Object.keys(json.variants);
      if (Object.prototype.hasOwnProperty.call(json.variants, row.props)) { stats.exact++; bump(row.block, 'exact'); }
      else {
        // 子集匹配：取「最具体」的那个 key
        const matched = keys.filter(k => matchesKey(row.props, k)).sort((a, b) => b.length - a.length)[0];
        if (matched !== undefined) { stats.subset++; bump(row.block, 'subset'); }
        else {
          stats.miss++;
          bump(row.block, 'miss');
          if (misses.length < 12) misses.push(`${row.id} ${row.block} "${row.props}" -> 无任何 key 匹配（keys: ${JSON.stringify(keys.slice(0, 3))}）`);
        }
      }
    } else if (json.multipart) {
      // multipart 的每个条目各自判断是否适用：条件不满足是正常的；
      // 只有 when 引用了「生成属性串里根本没有的属性」才算契约错误。
      const propMap = new Map(row.props ? row.props.split(',').map(p => p.split('=')) : []);
      let bad = null;
      for (const part of json.multipart) {
        if (!part.when) continue;
        for (const key of Object.keys(part.when)) {
          if (key === 'OR' || key === 'AND') continue;
          if (!propMap.has(key)) { bad = `when 用到属性 ${key}，但属性串里没有`; break; }
        }
        if (bad) break;
      }
      if (bad) { stats.multipartBad++; bump(row.block, 'multipartBad'); if (misses.length < 12) misses.push(`${row.id} ${row.block} "${row.props}" -> ${bad}`); }
      else { stats.multipartOk++; bump(row.block, 'multipartOk'); }
    } else {
      stats.noModel++;
      bump(row.block, 'noModel');
    }
  }

  console.log('=== 结果 ===');
  console.log(`  variants 精确匹配 : ${stats.exact}`);
  console.log(`  variants 子集匹配 : ${stats.subset}   （key 未列举的属性被忽略；"" 匹配一切）`);
  console.log(`  variants 无匹配   : ${stats.miss}`);
  console.log(`  multipart 条件通过: ${stats.multipartOk}`);
  console.log(`  multipart 条件失败: ${stats.multipartBad}`);
  console.log(`  缺 blockstates 文件: ${stats.noFile}`);
  console.log(`  非 variants/multipart: ${stats.noModel}`);
  console.log(`  无法解析的 id      : ${stats.unknown}`);
  console.log('\n=== 按方块统计（只显示有问题的）===');
  for (const [block, kinds] of [...byBlock].sort()) {
    const bad = kinds.filter(k => k !== 'exact' && k !== 'subset' && k !== 'multipartOk');
    if (bad.length === 0) continue;
    const example = rows.find(r => r.block === block && r.id !== undefined);
    const json = readBlockstate(block);
    const keys = json && json.variants ? Object.keys(json.variants) : (json && json.multipart ? ['(multipart)'] : []);
    console.log(`  ${block.padEnd(34)} ${kinds.length} 个状态, 问题: ${[...new Set(bad)].join(',')}`);
    console.log(`      生成属性串示例: "${example ? example.props : '?'}"   资源包 keys: ${JSON.stringify(keys.slice(0, 3))}`);
  }
  if (misses.length) {
    console.log('\n=== 问题样本 ===');
    for (const m of misses) console.log('  ' + m);
  }
  const spot = rows.filter(r => ['minecraft:stone', 'minecraft:oak_stairs', 'minecraft:oak_slab', 'minecraft:oak_fence', 'minecraft:grass_block', 'minecraft:water', 'minecraft:air'].includes(r.block));
  console.log('\n=== 抽查 ===');
  const seen = new Set();
  for (const row of spot) {
    if (seen.has(row.block)) continue;
    seen.add(row.block);
    console.log(`  ${row.id}\t${row.block}\t${row.props}`);
  }
  const failed = stats.miss + stats.multipartBad + stats.noFile + stats.unknown;
  console.log(failed ? `\nFAILED: ${failed} 条有问题` : '\nALL PASSED');
  process.exitCode = failed ? 1 : 0;
  await sleep(500);
  process.exit(process.exitCode);
}, 12000);
