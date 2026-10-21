// diag.js — 崩溃取证。
//
// 为什么需要它：浏览器标签页崩溃（Aw Snap / GPU 设备丢失）时控制台会一起消失，
// 事后无迹可查。这里把「现场」持续写进 localStorage：崩溃后重开页面仍能读到
// 上一次会话的错误与心跳（内存、段数、GPU 字节数、帧时），从而区分两类常见原因：
//   * 内存/资源单调增长 → 标签页 OOM
//   * 单帧超长 → GPU 看门狗（TDR）重置设备 → 设备丢失
//
// 设计要点：只保留上次会话的尾部若干条 + 本会话，避免 localStorage 无限膨胀。

const KEY = 'wgd.diag.v1';
const MAX_ENTRIES = 240;
const KEEP_PREV = 40;
const HEARTBEAT_MS = 5000;

export function createDiag(opts = {}) {
  const storage = opts.storage !== undefined
    ? opts.storage
    : (typeof localStorage !== 'undefined' ? localStorage : null);
  const session = opts.session || Math.random().toString(36).slice(2, 8);

  let loaded = [];
  try { loaded = JSON.parse((storage && storage.getItem(KEY)) || '[]'); } catch { loaded = []; }
  if (!Array.isArray(loaded)) loaded = [];
  // 上次会话留下的现场（本会话 id 之外的都算）
  const previous = loaded.filter(e => e && e.s !== session).slice(-KEEP_PREV);

  let entries = [];
  let lastHeartbeat = 0;
  let writeFailures = 0;

  function flush() {
    if (!storage) return;
    try {
      storage.setItem(KEY, JSON.stringify(previous.concat(entries).slice(-MAX_ENTRIES)));
    } catch {
      writeFailures++;   // 配额满/隐私模式等
    }
  }

  const api = {
    session,
    writeFailures: () => writeFailures,
    previous: () => previous.slice(),
    previousErrors: () => previous.filter(e => e.k === 'error' || e.k === 'devicelost' || e.k === 'longframe'),
    entries: () => entries.slice(),
    all: () => previous.concat(entries),

    event(kind, message) {
      entries.push({ t: Date.now(), s: session, k: kind, m: String(message).slice(0, 400) });
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
      flush();
    },

    /** 周期性记录现场；force=true 时忽略节流（例如崩溃前的最后时刻）。 */
    heartbeat(snapshot, force = false) {
      const t = Date.now();
      if (!force && t - lastHeartbeat < HEARTBEAT_MS) return;
      lastHeartbeat = t;
      api.event('hb', JSON.stringify(snapshot));
    },

    dump() {
      return api.all().map(e => `${new Date(e.t).toISOString()} [${e.s}] ${e.k.padEnd(10)} ${e.m}`).join('\n');
    },

    clear() {
      entries = [];
      try { if (storage) storage.removeItem(KEY); } catch { /* 忽略 */ }
    },

    /** 捕获两类最常见的静默失败：未处理异常与未处理的 Promise 拒绝。 */
    install(win) {
      win.addEventListener('error', ev => {
        api.event('error', `${ev.message || 'error'} @ ${ev.filename || '?'}:${ev.lineno || 0}:${ev.colno || 0}`);
      });
      win.addEventListener('unhandledrejection', ev => {
        const reason = ev.reason;
        api.event('error', `unhandledrejection: ${reason && reason.message ? reason.message : String(reason)}`);
      });
      // 记录"正常收场"：崩溃的会话会缺这一条。
      // 有了它，下次看到一段会话突然结束就能区分「用户刷新/关页面」与「进程被硬杀」。
      win.addEventListener('pagehide', () => api.event('pagehide', 'page hidden/unloaded'));
    },

    /** WebGPU 设备丢失：这是"页面看起来崩溃/卡死"最常见的技术形态。 */
    attachDevice(device) {
      if (!device) return;
      try {
        device.lost.then(info => {
          api.event('devicelost', `${info.reason}: ${info.message || ''}${info.reason === 'destroyed' ? '（预期内，通常是页面卸载）' : ''}`);
        });
      } catch { /* 忽略 */ }
      if (device.addEventListener) {
        device.addEventListener('uncapturederror', ev => {
          const err = ev.error;
          api.event('gpu', `${(err && err.constructor && err.constructor.name) || 'GPUError'}: ${(err && err.message) || ''}`);
        });
      }
    },

    /** 单帧超长是 GPU 看门狗超时的前兆，单独记下来便于与崩溃对齐。 */
    longFrame(ms, snapshot) {
      api.event('longframe', `${Math.round(ms)}ms ${JSON.stringify(snapshot)}`);
    },
  };

  return api;
}

/** Chromium 的 JS 堆用量（其他浏览器返回 -1）。 */
export function heapMB() {
  const m = typeof performance !== 'undefined' && performance.memory;
  return m && m.usedJSHeapSize ? Math.round(m.usedJSHeapSize / 1048576) : -1;
}
