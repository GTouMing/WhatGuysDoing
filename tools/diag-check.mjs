// diag-check.mjs — 崩溃取证模块的回归（用假 storage，纯 Node）。
// 断言的重点：上次会话的现场必须活下来、本会话不能无限膨胀、写失败不能抛。
import { createDiag } from '../common/src/main/resources/assets/what_guys_doing/web/diag.js';

let failed = 0;
function expect(name, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
}

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: k => map.delete(k),
    _map: map,
  };
}

const KEY = 'wgd.diag.v1';

console.log('=== 1. 本会话记录与心跳节流 ===');
{
  const st = fakeStorage();
  const diag = createDiag({ storage: st, session: 'aaaaaaaa' });
  diag.event('log', 'hello');
  expect('事件被记录', diag.entries().length === 1, JSON.stringify(diag.entries()[0]));
  expect('写入 storage', st.getItem(KEY).includes('hello'));

  diag.heartbeat({ heapMB: 10 }, true);
  diag.heartbeat({ heapMB: 11 });
  diag.heartbeat({ heapMB: 12 });
  const hbs = diag.entries().filter(e => e.k === 'hb');
  expect('心跳节流：紧邻三次只记一条', hbs.length === 1, `${hbs.length} 条`);

  const prev = diag.previous();
  expect('没有上次会话时 previous() 为空', prev.length === 0);
  expect('previousErrors() 为空', diag.previousErrors().length === 0);
}

console.log('=== 2. 上次会话的现场必须活下来 ===');
{
  const st = fakeStorage();
  const dying = createDiag({ storage: st, session: 'dead01' });
  dying.event('hb', JSON.stringify({ heapMB: 900, gpuMB: 300, meshes: 2016 }));
  dying.event('longframe', '640ms {"fps":7}');
  dying.event('error', 'TypeError: boom');

  // 模拟崩溃后重开页面
  const revived = createDiag({ storage: st, session: 'live02' });
  expect('读到上次会话的事件', revived.previous().length === 3, `${revived.previous().length} 条`);
  expect('上次会话 id 保留', revived.previous().every(e => e.s === 'dead01'));
  const errs = revived.previousErrors();
  expect('错误与超长帧被识别为"异常"', errs.length === 2, errs.map(e => e.k).join(','));
  expect('现场内容可读（含心跳数字）', revived.previous().some(e => e.m.includes('2016')));

  revived.event('log', 'new session');
  const stored = JSON.parse(st.getItem(KEY));
  expect('写回时保留上次会话尾部', stored.some(e => e.s === 'dead01') && stored.some(e => e.s === 'live02'));

  // 第二次重开：上次会话应被"本会话"取代，但不能把 dead01 永久堆着
  const again = createDiag({ storage: st, session: 'live03' });
  expect('只保留最近两次会话的尾巴', new Set(again.previous().map(e => e.s)).size <= 2, [...new Set(again.previous().map(e => e.s))].join(','));
}

console.log('=== 3. 上限与容错 ===');
{
  const st = fakeStorage();
  const diag = createDiag({ storage: st, session: 'cap000' });
  for (let i = 0; i < 400; i++) diag.event('log', 'line ' + i);
  expect('本会话事件不会无限膨胀', diag.entries().length <= 240, `${diag.entries().length} 条`);

  const broken = createDiag({
    storage: { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => {} },
    session: 'quota1',
  });
  broken.event('log', 'x');
  expect('storage 写失败不抛异常', broken.writeFailures() === 1, `writeFailures=${broken.writeFailures()}`);

  const noStore = createDiag({ storage: null, session: 'none00' });
  noStore.event('log', 'y');
  expect('没有 storage 也能工作', noStore.entries().length === 1);
  expect('dump() 输出可读文本', noStore.dump().includes('none00'));
}

console.log('=== 4. install / attachDevice 接线 ===');
{
  const st = fakeStorage();
  const diag = createDiag({ storage: st, session: 'wire01' });
  const listeners = new Map();
  const fakeWin = {
    addEventListener: (type, fn) => listeners.set(type, fn),
  };
  diag.install(fakeWin);
  expect('注册了 error', listeners.has('error'));
  expect('注册了 unhandledrejection', listeners.has('unhandledrejection'));
  expect('注册了 pagehide（用于区分"刷新"与"被硬杀"）', listeners.has('pagehide'));
  listeners.get('error')({ message: 'boom', filename: 'app.js', lineno: 12, colno: 3 });
  expect('error 事件被记录', diag.entries().some(e => e.k === 'error' && e.m.includes('app.js:12:3')));
  listeners.get('unhandledrejection')({ reason: new Error('rejected') });
  expect('unhandledrejection 被记录', diag.entries().some(e => e.m.includes('rejected')));

  let lostResolve;
  const fakeDevice = {
    lost: new Promise(res => { lostResolve = res; }),
    addEventListener: () => {},
  };
  diag.attachDevice(fakeDevice);
  lostResolve({ reason: 'unknown', message: 'device removed' });
  // promise 回调是微任务，等一拍
  await Promise.resolve();
  await Promise.resolve();
  expect('设备丢失被记录', diag.entries().some(e => e.k === 'devicelost' && e.m.includes('device removed')), diag.dump().split('\n').pop());
}

console.log('');
if (failed) {
  console.log(`FAILED: ${failed} 项断言未通过`);
  process.exit(1);
}
console.log('ALL PASSED：诊断模块行为符合预期');
