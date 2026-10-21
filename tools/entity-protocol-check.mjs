// entity-protocol-check.mjs - protocol v2 cross-language round-trip check (Java encode <-> JS decode).
//
// Key assertion: after decoding in client order, the read pointer must equal the message length.
// A wrong mask width (u16->u32), a missing dimId, or a field-order mismatch would desync the offset.
//
// NOTE: the entity snapshot constant is MSG.ENTITY (same as app.js). Writing MSG.ENTITY_SNAPSHOT
// yields undefined, `first !== undefined` is always true, and every snapshot is silently skipped.
//
//   node tools/entity-protocol-check.mjs   (server must be running, world must contain entities)
import { Reader, MSG, ENTITY_FLAG, C_SUBSCRIBE } from '../common/src/main/resources/assets/what_guys_doing/web/protocol.js';

const TYPE_ENTITY = MSG.ENTITY;
const PORT = Number(process.env.WGD_PORT || 27183);
const result = {
  snapshots: 0, entities: 0, dims: new Set(), playerUuid: 0,
  animOk: true, framing: [], error: '', counts: {},
};

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
ws.binaryType = 'arraybuffer';

function decodeEntityMessage(buffer) {
  const r = new Reader(buffer);
  if (r.u8() !== TYPE_ENTITY) return null;
  r.u32();
  const removed = r.u16();
  for (let i = 0; i < removed; i++) r.varUInt();
  const count = r.u16();
  let entities = 0;
  for (let i = 0; i < count; i++) {
    r.varUInt();
    const typeId = r.u16();
    const dimId = r.u8();
    const mask = r.u32();
    result.dims.add(dimId);
    if (mask & ENTITY_FLAG.POS) { r.fixed(512); r.fixed(512); r.fixed(512); }
    if (mask & ENTITY_FLAG.MOTION) { r.fixed(512); r.fixed(512); r.fixed(512); }
    if (mask & ENTITY_FLAG.ROT) { r.angle(); r.angleSigned(); }
    if (mask & ENTITY_FLAG.HEAD_ROT) r.angle();
    if (mask & ENTITY_FLAG.FLAGS) r.u16();
    if (mask & ENTITY_FLAG.HEALTH) r.u16();
    if (mask & ENTITY_FLAG.POSE) r.u8();
    if (mask & ENTITY_FLAG.VEHICLE) r.varUInt();
    if (mask & ENTITY_FLAG.ITEM) r.varUInt();
    if (mask & ENTITY_FLAG.PLAYER) { r.u8(); r.u8(); }
    if (mask & ENTITY_FLAG.VARIANT) r.u32();
    if (mask & ENTITY_FLAG.ANIM) {
      const limb = r.u8();
      const swing = r.u8();
      if (limb > 255 || swing > 255) result.animOk = false;
    }
    if (mask & ENTITY_FLAG.NAME) { r.u8(); r.utf(); }
    if (mask & ENTITY_FLAG.PLAYER_UUID) {
      const hi = r.u64();
      const lo = r.u64();
      if (typeId === 128) {
        if (hi !== 0 || lo !== 0) result.playerUuid++;
        else result.error ||= 'player entity has all-zero UUID (encoder missing?)';
      }
    }
    entities++;
  }
  result.entities += entities;
  result.snapshots++;
  return { consumed: r.pos, total: buffer.byteLength, count: entities };
}

ws.onopen = () => {
  const buf = new ArrayBuffer(11);
  const v = new DataView(buf);
  v.setUint8(0, C_SUBSCRIBE);
  v.setUint8(1, 0);
  v.setInt32(2, 0, true);
  v.setInt32(6, 0, true);   // 订阅是 2D 区块框（dim, cx, cz, radius）——没有 y
  v.setUint8(10, 2);
  ws.send(buf);
};

ws.onmessage = ev => {
  const buffer = ev.data;
  if (!(buffer instanceof ArrayBuffer)) return;
  const first = new Uint8Array(buffer)[0];
  result.counts[first] = (result.counts[first] || 0) + 1;
  if (first !== TYPE_ENTITY) return;
  try {
    const info = decodeEntityMessage(buffer);
    if (info) result.framing.push(info);
  } catch (e) {
    result.error ||= String(e && e.message ? e.message : e);
  }
};

const done = () => {
  ws.close();
  const bad = result.framing.filter(f => f.consumed !== f.total);
  const names = {
    [MSG.HELLO]: 'HELLO', [MSG.SECTION_FULL]: 'SECTION_FULL', [MSG.BLOCK_DELTA_BATCH]: 'BLOCK_DELTA',
    [MSG.CHUNK_UNLOAD]: 'CHUNK_UNLOAD', [MSG.ENTITY]: 'ENTITY', [MSG.TIME_SYNC]: 'TIME_SYNC', [MSG.PONG]: 'PONG',
  };
  const summary = Object.entries(result.counts)
    .map(([t, n]) => `${names[t] || ('0x' + Number(t).toString(16))}x${n}`)
    .join('  ');
  console.log(`messages: ${summary || '(none)'}`);
  console.log(`snapshots ${result.snapshots}, entity records ${result.entities}`);
  console.log(`dimId values: ${[...result.dims].sort().join(',') || '-'}`);
  console.log(`player UUID hits: ${result.playerUuid}`);
  console.log(`ANIM bytes: ${result.animOk ? 'ok' : 'OUT OF RANGE'}`);
  if (result.framing.length) {
    const sample = result.framing[result.framing.length - 1];
    console.log(`last frame: consumed ${sample.consumed} / total ${sample.total} bytes, ${sample.count} entities`);
  }
  if (result.error) console.log(`error: ${result.error}`);
  if (bad.length) console.log(`FAILED: ${bad.length} frames with consumed != total (offset desync)`);
  const ok = result.snapshots > 0 && bad.length === 0 && result.dims.size > 0 && result.animOk && !result.error;
  console.log(ok ? 'ALL PASSED: protocol v2 round-trip consistent' : 'FAILED');
  process.exitCode = ok ? 0 : 1;
};

setTimeout(done, 20000);
