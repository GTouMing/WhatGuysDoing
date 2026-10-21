package github.gtouming.what_guys_doing.world;

/** 实体的完整状态快照（不可变）。逐字段增量由每连接的编码器负责。 */
public record EntitySnapshot(
        int dimId,
        int netId,
        int typeId,
        double x,
        double y,
        double z,
        double vx,
        double vy,
        double vz,
        float yaw,
        float pitch,
        float headYaw,
        int flags,
        int pose,
        int vehicleId,
        float health,
        int itemId,
        int selectedSlot,
        int gameMode,
        // ---- 协议 v2 ----
        int variantBits,      // 家族位布局见 m2-m4 计划 §3.2；未知家族 = 0
        int limbSwingAmount,  // 0..255，渲染侧推相位
        int swingProgress,    // 0..255，挥手进度
        boolean nameVisible,
        String name,          // 无自定义名字时为 null
        java.util.UUID uuid) {

    public static final int FLAG_CROUCHING = 1;
    public static final int FLAG_SPRINTING = 1 << 1;
    public static final int FLAG_SWIMMING = 1 << 2;
    public static final int FLAG_PASSENGER = 1 << 3;
    public static final int FLAG_ON_FIRE = 1 << 4;
    public static final int FLAG_FALL_FLYING = 1 << 5;
    public static final int FLAG_USING_ITEM = 1 << 6;
    public static final int FLAG_SWINGING = 1 << 7;
}
