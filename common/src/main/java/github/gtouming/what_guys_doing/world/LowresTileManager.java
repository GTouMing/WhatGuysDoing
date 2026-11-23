package github.gtouming.what_guys_doing.world;

import java.awt.image.BufferedImage;
import java.io.IOException;

/** 管理 L1→L2→L3 的级联；父层永远只由下一层已保存的数据驱动。 */
public final class LowresTileManager {
    private final int tileSize;
    private final int lodFactor;
    private final int lodCount;
    private final LowresLayer.TileAccess access;
    private final LowresLayer[] layers;

    public LowresTileManager(
            int tileSize, int lodFactor, int lodCount,
            LowresLayer.TileAccess access) {
        this.tileSize = tileSize;
        this.lodFactor = lodFactor;
        this.lodCount = lodCount;
        this.access = access;
        this.layers = new LowresLayer[lodCount + 1];
        this.layers[1] = new LowresLayer(1, tileSize, lodFactor, access);
        for (int lod = 2; lod <= lodCount; lod++) {
            this.layers[lod] = new LowresLayer(lod, tileSize, lodFactor, access);
        }
    }

    public void set(String dim, int worldX, int worldZ, int color, int height, int light) {
        layers[1].set(dim, worldX, worldZ, color, height, light);
    }

    public synchronized void saveBase(String dim, int tileX, int tileZ) throws IOException {
        layers[1].savePending(dim, tileX, tileZ);
    }

    public synchronized void clear() {
        for (LowresLayer layer : layers) {
            if (layer != null) layer.clear();
        }
    }

    public synchronized void cascadeFromTile(String dim, int lod, int tileX, int tileZ) {
        if (lod >= lodCount) return;
        int parentLod = lod + 1;
        LowresLayer layer = layers[parentLod];
        int parentX = Math.floorDiv(tileX, lodFactor);
        int parentZ = Math.floorDiv(tileZ, lodFactor);

        BufferedImage parent;
        if (tileSize % lodFactor == 0) {
            BufferedImage source = access.read(dim, lod, tileX, tileZ);
            if (source == null) return;
            parent = layer.updateIncremental(dim, tileX, tileZ, source);
        } else {
            parent = layer.aggregateFull(dim, parentX, parentZ);
        }
        if (parent == null) return;

        if (LowresLayer.isEmpty(parent)) access.markEmpty(dim, parentLod, parentX, parentZ);
        else {
            try {
                access.write(dim, parentLod, parentX, parentZ, parent);
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
        }
        cascadeFromTile(dim, parentLod, parentX, parentZ);
    }
}
