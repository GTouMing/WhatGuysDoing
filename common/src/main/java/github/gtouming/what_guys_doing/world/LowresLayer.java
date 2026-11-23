package github.gtouming.what_guys_doing.world;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 一层 lowres tile 的父层构建逻辑。
 *
 * <p>500 tile 能被 lodFactor=5 整除时走参考项目的 5×5 增量更新；
 * 32 tile 暂时走整张父层重算，避免 30..32 的边界丢失。</p>
 */
public final class LowresLayer {
    public interface TileAccess {
        BufferedImage read(String dim, int lod, int x, int z);

        void write(String dim, int lod, int x, int z, BufferedImage image) throws IOException;

        void markEmpty(String dim, int lod, int x, int z);
    }

    private final int lod;
    private final int tileSize;
    private final int lodFactor;
    private final TileAccess access;
    private final Map<String, LowresTile> tiles = new ConcurrentHashMap<>();
    private final Map<String, LowresTile> pending = new ConcurrentHashMap<>();

    public LowresLayer(int lod, int tileSize, int lodFactor, TileAccess access) {
        this.lod = lod;
        this.tileSize = tileSize;
        this.lodFactor = lodFactor;
        this.access = access;
    }

    /** 写入一个世界列；负责 0 边界像素复制到相邻 tile。 */
    public void set(String dim, int worldX, int worldZ, int color, int height, int light) {
        int cellX = Math.floorDiv(worldX, tileSize);
        int cellZ = Math.floorDiv(worldZ, tileSize);
        int pixelX = Math.floorMod(worldX, tileSize);
        int pixelZ = Math.floorMod(worldZ, tileSize);
        setPixel(dim, cellX, cellZ, pixelX, pixelZ, color, height, light);
        if (pixelX == 0) {
            setPixel(dim, cellX - 1, cellZ, tileSize, pixelZ, color, height, light);
        }
        if (pixelZ == 0) {
            setPixel(dim, cellX, cellZ - 1, pixelX, tileSize, color, height, light);
        }
        if (pixelX == 0 && pixelZ == 0) {
            setPixel(dim, cellX - 1, cellZ - 1, tileSize, tileSize, color, height, light);
        }
    }

    private void setPixel(String dim, int cellX, int cellZ, int pixelX, int pixelZ,
                          int color, int height, int light) {
        String key = dim + "/" + cellX + "_" + cellZ;
        LowresTile tile = tiles.computeIfAbsent(key, ignored -> {
            BufferedImage image = access.read(dim, lod, cellX, cellZ);
            return image == null ? new LowresTile(tileSize) : new LowresTile(tileSize, image);
        });
        tile.set(pixelX, pixelZ, color, height, light);
        pending.put(key, tile);
    }

    public synchronized void savePending(String dim, int onlyX, int onlyZ) throws IOException {
        String key = dim + "/" + onlyX + "_" + onlyZ;
        LowresTile tile = pending.remove(key);
        if (tile == null) return;
        if (tile.isEmpty()) {
            tiles.remove(key);
            access.markEmpty(dim, lod, onlyX, onlyZ);
        } else {
            access.write(dim, lod, onlyX, onlyZ, tile.image());
        }
    }

    public synchronized void clear() {
        tiles.clear();
        pending.clear();
    }

    /** 32 tile 兼容路径：从 5×5 源 tile 重算完整父 tile。 */
    public BufferedImage aggregateFull(String dim, int parentX, int parentZ) {
        int imageSize = tileSize + 1;
        int targetCell = pow(lodFactor, lod - 1);
        int sourceCell = targetCell / lodFactor;
        int sourceSpan = tileSize * sourceCell;

        BufferedImage[] sources = new BufferedImage[(lodFactor + 1) * (lodFactor + 1)];
        boolean anySource = false;
        for (int sz = 0; sz < lodFactor + 1; sz++) {
            for (int sx = 0; sx < lodFactor + 1; sx++) {
                BufferedImage source = access.read(
                        dim, lod - 1,
                        parentX * lodFactor + sx,
                        parentZ * lodFactor + sz);
                sources[sz * (lodFactor + 1) + sx] = source;
                if (source != null) anySource = true;
            }
        }
        if (!anySource) return null;

        BufferedImage parent = new BufferedImage(imageSize, imageSize * 2, BufferedImage.TYPE_INT_ARGB);
        for (int pz = 0; pz < imageSize; pz++) {
            for (int px = 0; px < imageSize; px++) {
                int wx = parentX * tileSize * targetCell + px * targetCell;
                int wz = parentZ * tileSize * targetCell + pz * targetCell;
                int aSum = 0, rSum = 0, gSum = 0, bSum = 0, hSum = 0, lSum = 0, n = 0;
                for (int sz = 0; sz < lodFactor; sz++) {
                    for (int sx = 0; sx < lodFactor; sx++) {
                        int swx = wx + sx * sourceCell;
                        int swz = wz + sz * sourceCell;
                        int stx = Math.floorDiv(swx, sourceSpan);
                        int stz = Math.floorDiv(swz, sourceSpan);
                        int spx = Math.floorMod(swx, sourceSpan) / sourceCell;
                        int spz = Math.floorMod(swz, sourceSpan) / sourceCell;
                        int ix = stx - parentX * lodFactor;
                        int iz = stz - parentZ * lodFactor;
                        if (ix < 0 || ix > lodFactor || iz < 0 || iz > lodFactor) continue;
                        BufferedImage source = sources[iz * (lodFactor + 1) + ix];
                        if (source == null) continue;
                        int top = source.getRGB(spx, spz);
                        int meta = source.getRGB(spx, spz + imageSize);
                        int a = (top >>> 24) & 0xFF;
                        aSum += a;
                        rSum += ((top >> 16) & 0xFF) * a;
                        gSum += ((top >> 8) & 0xFF) * a;
                        bSum += (top & 0xFF) * a;
                        hSum += signedHeight(meta);
                        lSum += (meta >> 16) & 0xFF;
                        n++;
                    }
                }
                int top = 0;
                int meta = 0;
                if (n > 0 && aSum > 0) {
                    int count = lodFactor * lodFactor;
                    int a = aSum / n;
                    int r = rSum / aSum;
                    int g = gSum / aSum;
                    int b = bSum / aSum;
                    top = (a << 24) | (r << 16) | (g << 8) | b;
                    meta = ((hSum / count) & 0xFFFF) | (((lSum / count) & 0xFF) << 16) | 0xFF000000;
                }
                parent.setRGB(px, pz, top);
                parent.setRGB(px, pz + imageSize, meta);
            }
        }
        return parent;
    }

    /** 500 tile 路径：只从当前子 tile 的 5×5 块增量更新父 tile。 */
    public BufferedImage updateIncremental(String dim, int childX, int childZ, BufferedImage source) {
        int imageSize = tileSize + 1;
        int parentX = Math.floorDiv(childX, lodFactor);
        int parentZ = Math.floorDiv(childZ, lodFactor);
        BufferedImage parent = access.read(dim, lod, parentX, parentZ);
        if (parent == null) {
            parent = new BufferedImage(imageSize, imageSize * 2, BufferedImage.TYPE_INT_ARGB);
        }

        int groupCount = tileSize / lodFactor;
        int localX = Math.floorMod(childX, lodFactor);
        int localZ = Math.floorMod(childZ, lodFactor);
        for (int gx = 0; gx < groupCount; gx++) {
            for (int gz = 0; gz < groupCount; gz++) {
                int aSum = 0, rSum = 0, gSum = 0, bSum = 0, hSum = 0, lSum = 0;
                for (int sz = 0; sz < lodFactor; sz++) {
                    for (int sx = 0; sx < lodFactor; sx++) {
                        int px = gx * lodFactor + sx;
                        int pz = gz * lodFactor + sz;
                        if (px >= imageSize || pz >= imageSize) continue;
                        int top = source.getRGB(px, pz);
                        int meta = source.getRGB(px, pz + imageSize);
                        int a = (top >>> 24) & 0xFF;
                        aSum += a;
                        rSum += ((top >> 16) & 0xFF) * a;
                        gSum += ((top >> 8) & 0xFF) * a;
                        bSum += (top & 0xFF) * a;
                        hSum += signedHeight(meta);
                        lSum += (meta >> 16) & 0xFF;
                    }
                }
                int top = 0;
                int meta = 0;
                int count = lodFactor * lodFactor;
                if (aSum > 0) {
                    int a = aSum / count;
                    int r = rSum / aSum;
                    int g = gSum / aSum;
                    int b = bSum / aSum;
                    top = (a << 24) | (r << 16) | (g << 8) | b;
                    meta = ((hSum / count) & 0xFFFF) | (((lSum / count) & 0xFF) << 16) | 0xFF000000;
                }
                int px = localX * groupCount + gx;
                int pz = localZ * groupCount + gz;
                parent.setRGB(px, pz, top);
                parent.setRGB(px, pz + imageSize, meta);
            }
        }
        return parent;
    }

    public static boolean isEmpty(BufferedImage image) {
        int width = image.getWidth();
        int height = image.getHeight() / 2;
        for (int z = 0; z < height; z++) {
            for (int x = 0; x < width; x++) {
                int rgb = image.getRGB(x, z);
                if ((rgb & 0x00FFFFFF) != 0 || (rgb >>> 24) != 0) return false;
            }
        }
        return true;
    }

    private static int signedHeight(int meta) {
        int h = meta & 0xFFFF;
        return h >= 0x8000 ? h - 0x10000 : h;
    }

    private static int pow(int base, int exp) {
        int value = 1;
        for (int i = 0; i < exp; i++) value *= base;
        return value;
    }
}
