// protocol.js — 线上协议的常量与二进制读取器。
//
// 这个模块之所以单独存在：之前客户端 app.js 自带的 Reader 里，字段 `this.bytes` 与
// 方法 `bytes()` 同名，字段遮蔽了方法，导致每条 SECTION_FULL 都抛异常被静默吞掉
// （症状：实体正常、区块全无）。而 Node 校验脚本各自重写了一份 Reader，绕开了真实代码，
// 所以没抓到。现在客户端与所有校验脚本共用这一份，保证「验的就是跑的」。

export const MSG = {
  HELLO: 0x01, SECTION_FULL: 0x02, BLOCK_DELTA: 0x03, CHUNK_UNLOAD: 0x04,
  ENTITY: 0x10, TIME_SYNC: 0x11,
};

export const C_SUBSCRIBE = 0x81;
export const C_PING = 0x82;
export const PONG = 0x83;

export const ENTITY_FLAG = {
  POS: 1 << 0, MOTION: 1 << 1, ROT: 1 << 2, HEAD_ROT: 1 << 3, FLAGS: 1 << 4,
  HEALTH: 1 << 5, POSE: 1 << 6, VEHICLE: 1 << 7, ITEM: 1 << 8, PLAYER: 1 << 9,
  // v2 新增（掩码同时加宽为 u32）
  VARIANT: 1 << 10, ANIM: 1 << 11, NAME: 1 << 12, PLAYER_UUID: 1 << 13,
  EQUIP: 1 << 14, TINT: 1 << 15,
  ALL: 0xFFFF,
};

/** 小端/低位优先的读取器。注意：不要再用 `bytes` 当字段名（会遮蔽 bytes() 方法）。 */
export class Reader {
  constructor(buffer) {
    this.view = new DataView(buffer);
    this.data = new Uint8Array(buffer);
    this.pos = 0;
  }

  u8() { return this.view.getUint8(this.pos++); }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i32() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  u64() { const v = this.view.getBigUint64(this.pos, true); this.pos += 8; return Number(v); }

  varUInt() {
    let value = 0;
    let shift = 0;
    while (true) {
      const b = this.u8();
      value |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return value;
      shift += 7;
    }
  }

  utf() {
    const len = this.varUInt();
    const s = new TextDecoder().decode(this.data.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }

  bytes(len) {
    const out = this.data.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  skip(len) { this.pos += len; }

  fixed(scale) { return this.i32() / scale; }
  angle() { return this.u16() * (360 / 65536); }
  /** pitch 为有符号 −90–90：≥32768 的值按负数解释（309.3° = −50.7°） */
  angleSigned() { const v = this.u16(); return (v >= 32768 ? v - 65536 : v) * (360 / 65536); }
}
