package github.gtouming.what_guys_doing.net;

/**
 * 协议常量。详见实施方案 §5。
 *
 * <p>角度编码为 u16 满圈（65536 单位 = 360°）。{@code yaw}/{@code headYaw} 视为无符号 0–360；
 * {@code pitch} 为有符号 −90–90，解码时需把 ≥ 32768 的值当作负数（例：309.3° = −50.7°）。
 */
public final class Msg {
    /**
     * 协议版本。v2：实体掩码 u16 → u32，每实体加 u8 dimId，新增 VARIANT/ANIM/NAME/PLAYER_UUID 位。
     * 破坏性变更（客户端与服务端同 jar，可接受）。
     */
    public static final int PROTOCOL_VERSION = 2;

    public static final int HELLO = 0x01;
    public static final int SECTION_FULL = 0x02;
    public static final int BLOCK_DELTA_BATCH = 0x03;
    public static final int CHUNK_UNLOAD = 0x04;
    public static final int ENTITY_SNAPSHOT = 0x10;
    public static final int TIME_SYNC = 0x11;

    public static final int C_SUBSCRIBE = 0x81;
    public static final int C_PING = 0x82;
    public static final int PONG = 0x83;

    public static final int ENTITY_FLAG_POS = 1 << 0;
    public static final int ENTITY_FLAG_MOTION = 1 << 1;
    public static final int ENTITY_FLAG_ROT = 1 << 2;
    public static final int ENTITY_FLAG_HEAD_ROT = 1 << 3;
    public static final int ENTITY_FLAG_FLAGS = 1 << 4;
    public static final int ENTITY_FLAG_HEALTH = 1 << 5;
    public static final int ENTITY_FLAG_POSE = 1 << 6;
    public static final int ENTITY_FLAG_VEHICLE = 1 << 7;
    public static final int ENTITY_FLAG_ITEM = 1 << 8;
    public static final int ENTITY_FLAG_PLAYER = 1 << 9;
    /** v2 新增。 */
    public static final int ENTITY_FLAG_VARIANT = 1 << 10;       // u32 家族变体位
    public static final int ENTITY_FLAG_ANIM = 1 << 11;          // u8 肢体摆动 + u8 挥手进度
    public static final int ENTITY_FLAG_NAME = 1 << 12;          // u8 可见 + UTF 名字
    public static final int ENTITY_FLAG_PLAYER_UUID = 1 << 13;   // 16 字节 UUID（取皮肤）
    public static final int ENTITY_FLAG_EQUIP = 1 << 14;         // u16 护甲材质位
    public static final int ENTITY_FLAG_TINT = 1 << 15;          // u32 皮革染色 0xRRGGBB
    public static final int ENTITY_FLAG_ALL = 0xFFFF;

    private Msg() {
    }
}
