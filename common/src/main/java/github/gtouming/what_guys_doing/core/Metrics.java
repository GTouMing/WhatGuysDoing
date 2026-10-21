package github.gtouming.what_guys_doing.core;

import java.util.Arrays;
import java.util.concurrent.atomic.AtomicLong;

/** 采样与发送的度量。tick 线程只做数字累加，不产生分配。 */
public final class Metrics {
    private static final int SAMPLE_RING = 512;

    private final AtomicLong sampleCount = new AtomicLong();
    private final AtomicLong sampleTotalNanos = new AtomicLong();
    private final AtomicLong sampleMaxNanos = new AtomicLong();
    private final long[] sampleRing = new long[SAMPLE_RING];
    private final AtomicLong sampleRingIndex = new AtomicLong();
    private final AtomicLong lastSampleNanos = new AtomicLong();

    private final AtomicLong tickSectionsBuilt = new AtomicLong();
    private final AtomicLong sectionBuildNanos = new AtomicLong();
    private final AtomicLong tickEntities = new AtomicLong();
    private final AtomicLong tickBlockDeltas = new AtomicLong();
    private final AtomicLong bytesSent = new AtomicLong();
    private final AtomicLong messagesSent = new AtomicLong();
    private final AtomicLong droppedMessages = new AtomicLong();
    private final AtomicLong activeSections = new AtomicLong();
    private final AtomicLong peakQueueDepth = new AtomicLong();

    public void recordSample(long nanos) {
        sampleCount.incrementAndGet();
        sampleTotalNanos.addAndGet(nanos);
        sampleMaxNanos.accumulateAndGet(nanos, Math::max);
        lastSampleNanos.set(nanos);
        int idx = (int) (sampleRingIndex.getAndIncrement() % SAMPLE_RING);
        sampleRing[idx] = nanos;
    }

    public long lastSampleNanos() {
        return lastSampleNanos.get();
    }

    public void addSectionsBuilt(int n) {
        if (n > 0) tickSectionsBuilt.addAndGet(n);
    }

    /** 单次 section 构建耗时，用于隔离出噪声之外的「每 section 成本」。 */
    public void addSectionBuildNanos(long nanos) {
        sectionBuildNanos.addAndGet(nanos);
    }

    public long sectionBuildNanos() {
        return sectionBuildNanos.get();
    }

    public void setEntities(int n) {
        tickEntities.set(n);
    }

    public void addBlockDeltas(int n) {
        if (n > 0) tickBlockDeltas.addAndGet(n);
    }

    public void addSent(int bytes) {
        bytesSent.addAndGet(bytes);
        messagesSent.incrementAndGet();
    }

    public void addDropped(int n) {
        if (n > 0) droppedMessages.addAndGet(n);
    }

    public void setActiveSections(long n) {
        activeSections.set(n);
    }

    public void observeQueueDepth(int depth) {
        peakQueueDepth.accumulateAndGet(depth, Math::max);
    }

    public long sampleCount() {
        return sampleCount.get();
    }

    public long sampleMeanNanos() {
        long c = sampleCount.get();
        return c == 0 ? 0 : sampleTotalNanos.get() / c;
    }

    public long sampleMaxNanos() {
        return sampleMaxNanos.get();
    }

    public long sampleP99Nanos() {
        long count = Math.min(sampleCount.get(), SAMPLE_RING);
        if (count <= 0) return 0;
        long[] copy = Arrays.copyOf(sampleRing, (int) count);
        Arrays.sort(copy);
        int idx = Math.min(copy.length - 1, (int) (copy.length * 0.99));
        return copy[idx];
    }

    public long bytesSent() {
        return bytesSent.get();
    }

    public long messagesSent() {
        return messagesSent.get();
    }

    public long droppedMessages() {
        return droppedMessages.get();
    }

    public long tickSectionsBuilt() {
        return tickSectionsBuilt.get();
    }

    public long tickEntities() {
        return tickEntities.get();
    }

    public long tickBlockDeltas() {
        return tickBlockDeltas.get();
    }

    public long activeSections() {
        return activeSections.get();
    }

    public long peakQueueDepth() {
        return peakQueueDepth.get();
    }
}
