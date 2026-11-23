// 订阅批次稳定门：只有 section 静默/超时且描述符请求清空后，才允许 atlas 重建。
export function shouldSettleStreaming({
  streaming,
  now,
  lastSectionAt,
  streamStartedAt,
  quietMs,
  timeoutMs,
  pendingDescriptors,
}) {
  if (!streaming) return false;
  const quiet = now - lastSectionAt >= quietMs;
  const timeout = now - streamStartedAt >= timeoutMs;
  return (quiet || timeout) && (pendingDescriptors === 0 || timeout);
}
