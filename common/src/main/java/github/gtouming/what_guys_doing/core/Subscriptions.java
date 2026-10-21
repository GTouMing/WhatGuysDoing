package github.gtouming.what_guys_doing.core;

import java.util.ArrayDeque;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 单个会话的订阅状态。
 *
 * <ul>
 *   <li>{@code sent}：客户端确实已经持有数据的 section（方块增量门的依据）。</li>
 *   <li>{@code planned}：已排队或已发送（发现阶段去重）。</li>
 *   <li>{@code knownEmpty}：确认全空气、暂不需要发送的 section（方块变更到达时会失效）。</li>
 * </ul>
 */
public final class Subscriptions {
    private final Set<Long> sent = ConcurrentHashMap.newKeySet();
    private final Set<Long> planned = ConcurrentHashMap.newKeySet();
    private final Set<Long> knownEmpty = ConcurrentHashMap.newKeySet();
    private final ArrayDeque<Long> pending = new ArrayDeque<>();

    private volatile int dimId = -1;
    private volatile int centerCx;
    private volatile int centerCz;
    private volatile int radius;

    private int discoveryCursor;

    public void subscribe(int dimId, int centerCx, int centerCz, int radius) {
        this.dimId = dimId;
        this.centerCx = centerCx;
        this.centerCz = centerCz;
        this.radius = Math.max(0, Math.min(32, radius));
        synchronized (this) {
            sent.clear();
            planned.clear();
            knownEmpty.clear();
            pending.clear();
            discoveryCursor = 0;
        }
    }

    public int dimId() {
        return dimId;
    }

    public int centerCx() {
        return centerCx;
    }

    public int centerCz() {
        return centerCz;
    }

    public int radius() {
        return radius;
    }

    public boolean isSent(long sectionKey) {
        return sent.contains(sectionKey);
    }

    /** 该 section 是否在订阅范围内、且我们"知道"它的状态（已发送或确认全空气）。 */
    public boolean isKnown(long sectionKey) {
        return sent.contains(sectionKey) || knownEmpty.contains(sectionKey);
    }

    public int sentCount() {
        return sent.size();
    }

    public void markSent(long sectionKey) {
        sent.add(sectionKey);
    }

    public boolean isPlanned(long sectionKey) {
        return planned.contains(sectionKey);
    }

    public void markPlanned(long sectionKey, boolean empty) {
        planned.add(sectionKey);
        if (empty) {
            knownEmpty.add(sectionKey);
        }
    }

    /** 方块变更命中该 section：需要整段重发。 */
    public void invalidate(long sectionKey) {
        sent.remove(sectionKey);
        planned.remove(sectionKey);
        knownEmpty.remove(sectionKey);
    }

    public void clear() {
        subscribe(dimId, centerCx, centerCz, radius);
        dimId = -1;
    }

    public synchronized void addPending(long packedSection) {
        pending.addLast(packedSection);
    }

    public synchronized Long pollPending() {
        return pending.pollFirst();
    }

    public synchronized int pendingCount() {
        return pending.size();
    }

    public synchronized long[] drainSentKeys() {
        long[] keys = sent.stream().mapToLong(Long::longValue).toArray();
        return keys;
    }

    public synchronized int discoveryCursor() {
        return discoveryCursor;
    }

    public synchronized void advanceCursor(int steps) {
        discoveryCursor += steps;
    }

    public synchronized void resetCursor() {
        discoveryCursor = 0;
    }
}
