package github.gtouming.what_guys_doing.world;

/**
 * 一个 16×16×16 section 的不可变快照。脱离 MC 对象，可安全跨线程传递。
 *
 * <p>线性索引约定（三处一致）：{@code idx = (y << 8) | (z << 4) | x}，x 最快。
 * 光照为 4bit/方块，{@code idx >> 1} 为字节下标，偶数 idx 存低半字节。
 * 索引为 LSB 优先的位流，条目可跨字节。
 */
public record SectionSnapshot(
        int dimId,
        int cx,
        int cy,
        int cz,
        int[] palette,
        int bitsPerEntry,
        byte[] indices,
        byte[] blockLight,
        byte[] skyLight,
        int[] biomes) {

    public static final int BLOCKS = 4096;
    public static final int LIGHT_BYTES = BLOCKS / 2;
    public static final int BIOME_COLUMNS = 256;
}
