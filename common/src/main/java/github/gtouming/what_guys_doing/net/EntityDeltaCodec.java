package github.gtouming.what_guys_doing.net;

import github.gtouming.what_guys_doing.world.EntitySnapshot;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * 每连接一份的实体增量编码器：与上次发送值逐字段比较，只发送变化字段。
 * 只在会话线程使用。注意实体位置的哨兵值 {@link Float#NaN} 表示字段缺失。
 */
public final class EntityDeltaCodec {
    private static final double POS_SCALE = 512.0;
    private static final int NO_VEHICLE = -1;

    private final Map<Integer, EntitySnapshot> last = new HashMap<>();
    private EntitySnapshot[] prevArray = new EntitySnapshot[0];

    public byte[] encode(int tick, EntitySnapshot[] entities) {
        Set<Integer> present = new HashSet<>(entities.length * 2);
        for (EntitySnapshot e : entities) {
            present.add(e.netId());
        }
        // 上一帧存在、本帧消失的实体
        int removed = 0;
        for (EntitySnapshot prev : prevArray) {
            if (!present.contains(prev.netId())) {
                removed++;
            }
        }

        BinaryWriter w = new BinaryWriter(16 + entities.length * 32);
        w.u8(Msg.ENTITY_SNAPSHOT);
        w.u32(tick);
        w.u16(removed);
        for (EntitySnapshot prev : prevArray) {
            if (!present.contains(prev.netId())) {
                w.varUInt(prev.netId());
                last.remove(prev.netId());
            }
        }
        w.u16(entities.length);
        for (EntitySnapshot e : entities) {
            EntitySnapshot prev = last.get(e.netId());
            int mask = prev == null ? Msg.ENTITY_FLAG_ALL : diff(prev, e);
            w.varUInt(e.netId());
            w.u16(e.typeId());
            w.u8(e.dimId());          // v2：维度随记录走（不再依赖订阅时的维度假设）
            w.u32(mask);              // v2：掩码加宽到 u32
            if ((mask & Msg.ENTITY_FLAG_POS) != 0) {
                w.fixed(e.x(), (int) POS_SCALE).fixed(e.y(), (int) POS_SCALE).fixed(e.z(), (int) POS_SCALE);
            }
            if ((mask & Msg.ENTITY_FLAG_MOTION) != 0) {
                w.fixed(e.vx(), (int) POS_SCALE).fixed(e.vy(), (int) POS_SCALE).fixed(e.vz(), (int) POS_SCALE);
            }
            if ((mask & Msg.ENTITY_FLAG_ROT) != 0) {
                w.angle(e.yaw()).angle(e.pitch());
            }
            if ((mask & Msg.ENTITY_FLAG_HEAD_ROT) != 0) {
                w.angle(e.headYaw());
            }
            if ((mask & Msg.ENTITY_FLAG_FLAGS) != 0) {
                w.u16(e.flags());
            }
            if ((mask & Msg.ENTITY_FLAG_HEALTH) != 0) {
                w.u16(Math.round(e.health() * 10.0f));
            }
            if ((mask & Msg.ENTITY_FLAG_POSE) != 0) {
                w.u8(e.pose());
            }
            if ((mask & Msg.ENTITY_FLAG_VEHICLE) != 0) {
                if (e.vehicleId() == NO_VEHICLE) {
                    w.varUInt(0);
                } else {
                    w.varUInt(e.vehicleId() + 1);
                }
            }
            if ((mask & Msg.ENTITY_FLAG_ITEM) != 0) {
                w.varUInt(e.itemId());
            }
            if ((mask & Msg.ENTITY_FLAG_PLAYER) != 0) {
                w.u8(e.selectedSlot());
                w.u8(e.gameMode());
            }
            // ---- v2 ----
            if ((mask & Msg.ENTITY_FLAG_VARIANT) != 0) {
                w.u32(e.variantBits());
            }
            if ((mask & Msg.ENTITY_FLAG_ANIM) != 0) {
                w.u8(e.limbSwingAmount());
                w.u8(e.swingProgress());
            }
            if ((mask & Msg.ENTITY_FLAG_NAME) != 0) {
                w.u8(e.nameVisible() ? 1 : 0);
                w.utf(e.name() == null ? "" : e.name());
            }
            if ((mask & Msg.ENTITY_FLAG_PLAYER_UUID) != 0) {
                // UUID 拆成两个 u64 写出（客户端同样按两个 u64 读，避免引入字节数组 API）
                java.util.UUID uuid = e.uuid();
                w.u64(uuid == null ? 0L : uuid.getMostSignificantBits());
                w.u64(uuid == null ? 0L : uuid.getLeastSignificantBits());
            }
            if ((mask & Msg.ENTITY_FLAG_EQUIP) != 0) {
                w.u16(e.equipment());
            }
            if ((mask & Msg.ENTITY_FLAG_TINT) != 0) {
                w.u32(e.leatherHead());
                w.u32(e.leatherChest());
                w.u32(e.leatherLegs());
                w.u32(e.leatherFeet());
            }
            last.put(e.netId(), e);
        }
        prevArray = entities;
        return w.toBytes();
    }

    public void reset() {
        last.clear();
        prevArray = new EntitySnapshot[0];
    }

    private static int diff(EntitySnapshot a, EntitySnapshot b) {
        int mask = 0;
        if (a.x() != b.x() || a.y() != b.y() || a.z() != b.z()) {
            mask |= Msg.ENTITY_FLAG_POS;
        }
        if (a.vx() != b.vx() || a.vy() != b.vy() || a.vz() != b.vz()) {
            mask |= Msg.ENTITY_FLAG_MOTION;
        }
        if (a.yaw() != b.yaw() || a.pitch() != b.pitch()) {
            mask |= Msg.ENTITY_FLAG_ROT;
        }
        if (a.headYaw() != b.headYaw()) {
            mask |= Msg.ENTITY_FLAG_HEAD_ROT;
        }
        if (a.flags() != b.flags()) {
            mask |= Msg.ENTITY_FLAG_FLAGS;
        }
        if (a.health() != b.health()) {
            mask |= Msg.ENTITY_FLAG_HEALTH;
        }
        if (a.pose() != b.pose()) {
            mask |= Msg.ENTITY_FLAG_POSE;
        }
        if (a.vehicleId() != b.vehicleId()) {
            mask |= Msg.ENTITY_FLAG_VEHICLE;
        }
        if (a.itemId() != b.itemId()) {
            mask |= Msg.ENTITY_FLAG_ITEM;
        }
        if (a.selectedSlot() != b.selectedSlot() || a.gameMode() != b.gameMode()) {
            mask |= Msg.ENTITY_FLAG_PLAYER;
        }
        // ---- v2 ----
        if (a.variantBits() != b.variantBits()) {
            mask |= Msg.ENTITY_FLAG_VARIANT;
        }
        if (a.limbSwingAmount() != b.limbSwingAmount() || a.swingProgress() != b.swingProgress()) {
            mask |= Msg.ENTITY_FLAG_ANIM;
        }
        if (a.nameVisible() != b.nameVisible() || !java.util.Objects.equals(a.name(), b.name())) {
            mask |= Msg.ENTITY_FLAG_NAME;
        }
        if (!java.util.Objects.equals(a.uuid(), b.uuid())) {
            mask |= Msg.ENTITY_FLAG_PLAYER_UUID;
        }
        if (a.equipment() != b.equipment()) {
            mask |= Msg.ENTITY_FLAG_EQUIP;
        }
        if (a.leatherHead() != b.leatherHead()
                || a.leatherChest() != b.leatherChest()
                || a.leatherLegs() != b.leatherLegs()
                || a.leatherFeet() != b.leatherFeet()) {
            mask |= Msg.ENTITY_FLAG_TINT;
        }
        return mask;
    }
}
