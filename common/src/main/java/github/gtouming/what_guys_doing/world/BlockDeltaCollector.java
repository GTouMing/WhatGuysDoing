package github.gtouming.what_guys_doing.world;

import github.gtouming.what_guys_doing.core.SessionHub;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;

import java.util.HashMap;
import java.util.Map;

/**
 * 逐方块变更收集器。由 {@code LevelChunkMixin} 在服务器线程调用：
 * 只记录「已经被某个会话发送过」的 section，因此世界生成/区块加载的批量写入不会灌进来。
 */
public final class BlockDeltaCollector {
    private static final org.slf4j.Logger LOGGER = org.slf4j.LoggerFactory.getLogger("what_guys_doing/delta");
    private static int debugLeft = 20;
    private static final Object LOCK = new Object();
    private static Map<Integer, Map<Long, Integer>> changes = new HashMap<>();
    private static volatile boolean active;

    private BlockDeltaCollector() {
    }

    public static void activate() {
        synchronized (LOCK) {
            changes = new HashMap<>();
            active = true;
        }
    }

    public static void deactivate() {
        active = false;
        synchronized (LOCK) {
            changes = new HashMap<>();
        }
    }

    /** 由 mixin 调用（服务器线程）。 */
    public static void record(Level level, BlockPos pos, BlockState state) {
        // 诊断：前 20 次调用把每道关卡的结论写进日志（ASCII），用来定位"为什么没有 delta"。
        if (debugLeft > 0) {
            debugLeft--;
            String stage;
            if (!active) {
                stage = "collector inactive";
            } else if (!(level instanceof ServerLevel)) {
                stage = "not a ServerLevel";
            } else {
                SessionHub hub0 = SessionHub.instance();
                if (hub0 == null || !hub0.isRunning()) {
                    stage = "hub not running";
                } else {
                    Integer dim0 = hub0.dimensionId(((ServerLevel) level).dimension());
                    if (dim0 == null) {
                        stage = "dimension not broadcast";
                    } else if (!hub0.isSectionActive(dim0, pos.getX(), pos.getY(), pos.getZ())) {
                        stage = "section not sent to any session";
                    } else if (hub0.stateId(state) < 0) {
                        stage = "state id not registered";
                    } else {
                        stage = "recorded";
                    }
                }
            }
            LOGGER.info("delta probe: {} @ {},{},{}", stage, pos.getX(), pos.getY(), pos.getZ());
        }
        if (!active || !(level instanceof ServerLevel serverLevel)) {
            return;
        }
        SessionHub hub = SessionHub.instance();
        if (hub == null || !hub.isRunning()) {
            return;
        }
        Integer dimId = hub.dimensionId(serverLevel.dimension());
        if (dimId == null) {
            return;
        }
        int x = pos.getX();
        int y = pos.getY();
        int z = pos.getZ();
        if (!hub.isSectionActive(dimId, x, y, z)) {
            return;
        }
        int stateId = hub.stateId(state);
        if (stateId < 0) {
            return;
        }
        synchronized (LOCK) {
            changes.computeIfAbsent(dimId, k -> new HashMap<>(64))
                    .put(BlockPos.asLong(x, y, z), stateId);
        }
    }

    /** 取走并清空本 tick 的变更（服务器线程）。 */
    public static BlockDeltaSet drain() {
        Map<Integer, Map<Long, Integer>> snapshot;
        synchronized (LOCK) {
            if (changes.isEmpty()) {
                return BlockDeltaSet.EMPTY;
            }
            // 直接移交所有权，避免浅拷贝后又被清空
            snapshot = changes;
            changes = new HashMap<>();
        }
        int total = 0;
        for (Map<Long, Integer> m : snapshot.values()) {
            total += m.size();
        }
        int[] dims = new int[total];
        int[] xs = new int[total];
        int[] ys = new int[total];
        int[] zs = new int[total];
        int[] states = new int[total];
        int i = 0;
        for (Map.Entry<Integer, Map<Long, Integer>> e : snapshot.entrySet()) {
            for (Map.Entry<Long, Integer> c : e.getValue().entrySet()) {
                long packed = c.getKey();
                dims[i] = e.getKey();
                xs[i] = BlockPos.getX(packed);
                ys[i] = BlockPos.getY(packed);
                zs[i] = BlockPos.getZ(packed);
                states[i] = c.getValue();
                i++;
            }
        }
        return new BlockDeltaSet(dims, xs, ys, zs, states, total);
    }
}
