package github.gtouming.what_guys_doing.core;

import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;

import java.util.HashMap;
import java.util.Map;

/** 维度表：维度 → 稳定的小整数 id，供线上协议使用。 */
public final class DimTable {
    private final Map<ResourceKey<Level>, Integer> byKey = new HashMap<>();
    private final ResourceKey<Level>[] keys;
    private final String[] names;
    private final int[] minSectionY;
    private final int[] sectionCount;

    @SuppressWarnings("unchecked")
    public DimTable(MinecraftServer server) {
        int n = 0;
        for (ServerLevel ignored : server.getAllLevels()) {
            n++;
        }
        this.keys = new ResourceKey[n];
        this.names = new String[n];
        this.minSectionY = new int[n];
        this.sectionCount = new int[n];
        int i = 0;
        for (ServerLevel level : server.getAllLevels()) {
            this.byKey.put(level.dimension(), i);
            this.keys[i] = level.dimension();
            this.names[i] = level.dimension().location().toString();
            this.minSectionY[i] = level.getMinBuildHeight() >> 4;
            this.sectionCount[i] = level.getSectionsCount();
            i++;
        }
    }

    public int dimensionCount() {
        return names.length;
    }

    public Integer idOf(ResourceKey<Level> key) {
        return byKey.get(key);
    }

    public ResourceKey<Level> keyOrNull(int id) {
        return (id >= 0 && id < keys.length) ? keys[id] : null;
    }

    public String nameOf(int id) {
        return (id >= 0 && id < names.length) ? names[id] : "<unknown>";
    }

    public int minSectionY(int id) {
        return minSectionY[id];
    }

    public int sectionCount(int id) {
        return sectionCount[id];
    }
}
