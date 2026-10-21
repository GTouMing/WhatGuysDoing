package github.gtouming.what_guys_doing.world;

/** 一个 tick 的共享快照：所有会话复用同一份实体与方块变更数据。 */
public record TickFrame(int tick, long gameTime, EntitySnapshot[] entities, BlockDeltaSet deltas) {
}
