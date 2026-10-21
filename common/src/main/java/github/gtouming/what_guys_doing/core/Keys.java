package github.gtouming.what_guys_doing.core;

/** 线上协议键（打包 / 解包）。坐标为 20bit 有符号。 */
public final class Keys {
    private static final int COORD_BITS = 20;
    private static final int COORD_MASK = (1 << COORD_BITS) - 1;

    private Keys() {
    }

    /** 会话内 section 键（含维度）。 */
    public static long section(int dimId, int cx, int cy, int cz) {
        return ((long) (dimId & 0xFF) << 60)
                | ((long) (cx & COORD_MASK) << 40)
                | ((long) (cy & COORD_MASK) << 20)
                | (cz & COORD_MASK);
    }

    /** 不带维度的 section 坐标打包（用于待发送队列）。 */
    public static long packSection(int cx, int cy, int cz) {
        return ((long) (cx & COORD_MASK) << 40) | ((long) (cy & COORD_MASK) << 20) | (cz & COORD_MASK);
    }

    public static int unpackCx(long packed) {
        return (int) (((packed >> 40) & COORD_MASK) << 12) >> 12;
    }

    public static int unpackCy(long packed) {
        return (int) (((packed >> 20) & COORD_MASK) << 12) >> 12;
    }

    public static int unpackCz(long packed) {
        return (int) ((packed & COORD_MASK) << 12) >> 12;
    }
}
