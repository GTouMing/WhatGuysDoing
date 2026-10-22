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
        int equipment,        // 4 槽 × 4 位：head 0..3 / chest 4..7 / legs 8..11 / feet 12..15
        int leatherHead,      // 0x1000000 | RGB；0 = 非皮革/无染色
        int leatherChest,
        int leatherLegs,
        int leatherFeet,
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
    public static final int FLAG_TAME = 1 << 8;
    public static final int FLAG_SHEARED = 1 << 9;
    public static final int FLAG_ANGRY = 1 << 10;
    public static final int FLAG_SADDLED = 1 << 11;
    public static final int FLAG_SLEEPING = 1 << 12;
    public static final int FLAG_BABY = 1 << 13;
    public static final int FLAG_SITTING = 1 << 14;
}
