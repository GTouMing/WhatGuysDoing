package github.gtouming.what_guys_doing.net;

import github.gtouming.what_guys_doing.core.DimTable;
import github.gtouming.what_guys_doing.world.BlockDeltaSet;
import github.gtouming.what_guys_doing.world.SectionSnapshot;

/** 下行消息编码。全部在会话线程调用（除 HELLO 由 hub 构建）。 */
public final class Protocol {

    /** 决定某方块变更是否发给该会话（其 section 是否已发送且未被标记重发）。 */
    public interface SectionGate {
        boolean allow(int dimId, int x, int y, int z);
    }

    private Protocol() {
    }

    public static byte[] hello(DimTable dims, int tickRate, int playerTypeId) {
        BinaryWriter w = new BinaryWriter(256);
        w.u8(Msg.HELLO);
        w.u32(Msg.PROTOCOL_VERSION);
        w.u32(tickRate);
        w.u16(playerTypeId);
        w.u16(dims.dimensionCount());
        for (int i = 0; i < dims.dimensionCount(); i++) {
            w.u8(i);
            w.utf(dims.nameOf(i));
            w.i32(dims.minSectionY(i));
            w.i32(dims.sectionCount(i));
        }
        return w.toBytes();
    }

    public static byte[] section(SectionSnapshot s) {
        int paletteSize = s.palette().length;
        BinaryWriter w = new BinaryWriter(16 + paletteSize * 4 + s.indices().length + s.blockLight().length * 2 + 512);
        w.u8(Msg.SECTION_FULL);
        w.u8(s.dimId());
        w.i32(s.cx());
        w.i32(s.cy());
        w.i32(s.cz());
        w.u16(paletteSize);
        for (int id : s.palette()) {
            w.u32(id);
        }
        w.u8(s.bitsPerEntry());
        w.bytes(s.indices());
        w.bytes(s.blockLight());
        w.bytes(s.skyLight());
        for (int biome : s.biomes()) {
            w.u16(biome);
        }
        return w.toBytes();
    }

    public static byte[] blockDeltas(int tick, BlockDeltaSet set, SectionGate gate) {
        int count = 0;
        for (int i = 0; i < set.count(); i++) {
            if (gate.allow(set.dims()[i], set.xs()[i], set.ys()[i], set.zs()[i])) {
                count++;
            }
        }
        BinaryWriter w = new BinaryWriter(12 + count * 16);
        w.u8(Msg.BLOCK_DELTA_BATCH);
        w.u32(tick);
        w.u16(count);
        for (int i = 0; i < set.count(); i++) {
            int dim = set.dims()[i];
            int x = set.xs()[i];
            int y = set.ys()[i];
            int z = set.zs()[i];
            if (!gate.allow(dim, x, y, z)) {
                continue;
            }
            w.u8(dim);
            w.i32(x);
            w.i32(y);
            w.i32(z);
            w.u32(set.states()[i]);
        }
        return w.toBytes();
    }

    public static byte[] chunkUnload(int dimId, int cx, int cz) {
        BinaryWriter w = new BinaryWriter(16);
        w.u8(Msg.CHUNK_UNLOAD);
        w.u8(dimId);
        w.i32(cx);
        w.i32(cz);
        return w.toBytes();
    }

    public static byte[] timeSync(int tick, long gameTime) {
        BinaryWriter w = new BinaryWriter(16);
        w.u8(Msg.TIME_SYNC);
        w.u32(tick);
        w.u64(gameTime);
        return w.toBytes();
    }

    public static byte[] pong() {
        return new byte[]{(byte) Msg.PONG};
    }
}
