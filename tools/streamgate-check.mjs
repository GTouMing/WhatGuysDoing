import { shouldSettleStreaming } from '../common/src/main/resources/assets/what_guys_doing/web/streamgate.js';

let failed = 0;
const expect = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};

const base = {
  streaming: true,
  now: 10000,
  lastSectionAt: 9000,
  streamStartedAt: 1000,
  quietMs: 1200,
  timeoutMs: 15000,
  pendingDescriptors: 0,
};

console.log('=== 订阅稳定门 ===');
expect('流式进行中不提前重建',
  !shouldSettleStreaming({ ...base, now: 9500, lastSectionAt: 9000 }));
expect('静默且描述符清空后重建',
  shouldSettleStreaming({ ...base, now: 10300, lastSectionAt: 9000 }));
expect('静默但描述符未清空时等待',
  !shouldSettleStreaming({ ...base, now: 10300, lastSectionAt: 9000, pendingDescriptors: 3 }));
expect('超时且描述符未清空时兜底',
  shouldSettleStreaming({ ...base, now: 17000, lastSectionAt: 9000, pendingDescriptors: 3 }));
expect('非 streaming 不触发',
  !shouldSettleStreaming({ ...base, streaming: false, now: 20000 }));

console.log('\n=== 结果 ===');
if (failed) {
  console.log(`FAILED：${failed} 项`);
  process.exitCode = 1;
} else {
  console.log('ALL PASSED：订阅稳定门');
}
