// blockdelta-check.mjs — 观察 BLOCK_DELTA 是否到达（验证"改动有没有发出去"）。
//   node tools/blockdelta-check.mjs [秒数]
// 需要服务端在跑；配合 RCON 改方块即可验证端到端。
import { Reader, MSG, C_SUBSCRIBE } from '../common/src/main/resources/assets/what_guys_doing/web/protocol.js';

const PORT = Number(process.env.WGD_PORT || 27183);
const SECONDS = Number(process.argv[2] || 20);
const counts = {};
let deltas = 0;
let blocks = 0;
const samples = [];

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
ws.binaryType = 'arraybuffer';
ws.onopen = () => {
  const buf = new ArrayBuffer(11);
  const v = new DataView(buf);
  v.setUint8(0, C_SUBSCRIBE);
  v.setUint8(1, 0);           // 维度
  v.setInt32(2, 0, true);     // 中心 chunkX
  v.setInt32(6, 0, true);     // 中心 chunkZ（注意：订阅是 2D，没有 y）
  v.setUint8(10, 2);          // 半径（chunk）
  ws.send(buf);
};
ws.onmessage = ev => {
  if (!(ev.data instanceof ArrayBuffer)) return;
  const r = new Reader(ev.data);
  const type = r.u8();
  counts[type] = (counts[type] || 0) + 1;
  if (type !== MSG.BLOCK_DELTA) return;
  r.u32();
  const count = r.u16();
  deltas++;
  blocks += count;
  for (let i = 0; i < count; i++) {
    const dim = r.u8();
    const x = r.i32();
    const y = r.i32();
    const z = r.i32();
    const stateId = r.u32();
    if (samples.length < 8) samples.push(`dim${dim} ${x},${y},${z} -> state ${stateId}`);
  }
};
setTimeout(() => {
  ws.close();
  const names = { [MSG.HELLO]: 'HELLO', [MSG.SECTION_FULL]: 'SECTION_FULL', [MSG.BLOCK_DELTA]: 'BLOCK_DELTA', [MSG.ENTITY]: 'ENTITY', [MSG.TIME_SYNC]: 'TIME_SYNC' };
  console.log('messages: ' + Object.entries(counts).map(([t, n]) => `${names[t] || ('0x' + Number(t).toString(16))}x${n}`).join('  '));
  console.log(`BLOCK_DELTA 消息 ${deltas} 条，方块 ${blocks} 个`);
  for (const s of samples) console.log('  ' + s);
  if (deltas === 0) {
    console.log('结果: 没有收到 BLOCK_DELTA（服务端未发出，或改动不在订阅段内）');
  } else {
    console.log('结果: BLOCK_DELTA 通道正常');
  }
  process.exitCode = deltas > 0 ? 0 : 1;
}, SECONDS * 1000);
