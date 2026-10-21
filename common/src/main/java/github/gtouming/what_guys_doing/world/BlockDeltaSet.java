package github.gtouming.what_guys_doing.world;

/** 一个 tick 内合并后的方块变更集合。 */
public record BlockDeltaSet(int[] dims, int[] xs, int[] ys, int[] zs, int[] states, int count) {
    public static final BlockDeltaSet EMPTY = new BlockDeltaSet(new int[0], new int[0], new int[0], new int[0], new int[0], 0);

    public boolean isEmpty() {
        return count == 0;
    }
}
