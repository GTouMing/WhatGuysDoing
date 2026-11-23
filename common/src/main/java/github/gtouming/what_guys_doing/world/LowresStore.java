package github.gtouming.what_guys_doing.world;

import github.gtouming.what_guys_doing.web.Json;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.material.MapColor;
import net.minecraft.world.level.storage.LevelResource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardWatchEventKinds;
import java.nio.file.WatchKey;
import java.nio.file.WatchService;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;
import java.util.zip.InflaterInputStream;

/**
 * 全局 lowres 数据面（M4b.0 的最小实现）。
 *
 * <p>按 BlueMap 的 LowresTile 布局生成 33×33（32 + 1 border）图像：上半颜色，下半 meta
 * （height 16-bit signed + blockLight）。LOD1 直接扫描 MCA 存档的列顶；LOD2/3 从上一层
 * 5×5 平均。数据按需生成并缓存到磁盘，不依赖当前 section 订阅。</p>
 */
public final class LowresStore {
    private static final Logger LOGGER = LoggerFactory.getLogger("what_guys_doing/lowres");
    public static final int TILE_SIZE = 500;
    public static final int LOD_COUNT = 3;
    public static final int LOD_FACTOR = 5;
    private static final int IMAGE_SIZE = TILE_SIZE + 1;
    /** 低模缓存格式：高度扫描/配色/光照/tileSize 改变时必须 +1，否则旧图片会被继续服务。 */
    private static final int CACHE_VERSION = 19;

    private final MinecraftServer server;
    private final Path root;
    private final LowresColorResolver colors;
    private final LowresTileManager lowresTiles;
    private final Map<String, LowresTile> memory = new ConcurrentHashMap<>();
    private final Map<String, Object> locks = new ConcurrentHashMap<>();
    private final java.util.Set<String> empty = ConcurrentHashMap.newKeySet();
    private final AtomicLong requests = new AtomicLong();
    private final AtomicLong generated = new AtomicLong();
    private final AtomicLong errors = new AtomicLong();
    private final AtomicLong lastWorldSave = new AtomicLong();
    private final Map<BlockState, Integer> colorCache = new ConcurrentHashMap<>();
    private final ExecutorService workers = Executors.newFixedThreadPool(2, r -> {
        Thread t = new Thread(r, "wgd-lowres");
        t.setDaemon(true);
        return t;
    });
    private final Map<String, Boolean> queued = new ConcurrentHashMap<>();
    private final java.util.Set<String> queuedRegions = ConcurrentHashMap.newKeySet();
    private final java.util.Set<String> invalidated = ConcurrentHashMap.newKeySet();
    private final java.util.Set<String> active = ConcurrentHashMap.newKeySet();
    private volatile String lastError = "";
    private volatile long lastGenMs;
    private final AtomicLong epoch = new AtomicLong();
    private static final Pattern REGION_FILE = Pattern.compile("r\\.(-?\\d+)\\.(-?\\d+)\\.mca");
    private volatile WatchService watcher;
    private volatile Thread watchThread;
    /** 自己触发的 level.save 会写 region 文件；这段时间内的 watch 事件不能当成外部世界变化。 */
    private volatile long selfSaveIgnoreUntil;

    public record TileResult(byte[] bytes, boolean pending, boolean empty) {
    }

    public LowresStore(MinecraftServer server, Path root) {
        this(server, root, null);
    }

    public LowresStore(MinecraftServer server, Path root, Path assetsContent) {
        this.server = server;
        this.root = root;
        this.colors = assetsContent == null ? null : new LowresColorResolver(assetsContent);
        this.lowresTiles = new LowresTileManager(TILE_SIZE, LOD_FACTOR, LOD_COUNT, new LowresLayer.TileAccess() {
            @Override
            public BufferedImage read(String dim, int lod, int x, int z) {
                return existing(dim, lod, x, z);
            }

            @Override
            public void write(String dim, int lod, int x, int z, BufferedImage image) throws IOException {
                store(dim, lod, x, z, image);
            }

            @Override
            public void markEmpty(String dim, int lod, int x, int z) {
                LowresStore.this.markEmpty(dim, lod, x, z);
            }
        });
        startRegionWatch();
    }

    public TileResult tile(String dim, int lod, int x, int z) {
        if (lod < 1 || lod > LOD_COUNT) return null;
        ServerLevel level = level(dim);
        if (level == null) return null;
        String key = key(dim, lod, x, z);
        active.add(key);
        long startNs = System.nanoTime();
        Object lock = locks.computeIfAbsent(key, k -> new Object());
        synchronized (lock) {
            requests.incrementAndGet();
            try {
                if (empty.contains(key)) return missingResult(lod);
                LowresTile cached = memory.get(key);
                BufferedImage img = cached == null ? null : cached.image();
                Path file = file(dim, lod, x, z);
                if (img == null) {
                    LowresTile loaded = LowresTile.read(file, TILE_SIZE);
                    if (loaded != null) {
                        if (loaded.isEmpty()) {
                            empty.add(key);
                            memory.remove(key);
                        } else {
                            memory.put(key, loaded);
                            img = loaded.image();
                        }
                    }
                }
                if (empty.contains(key)) return missingResult(lod);
                if (img == null) {
                    if (lod == 1) enqueueRegion(dim, level, x, z);
                    return new TileResult(null, true, false);
                }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                ImageIO.write(img, "png", out);
                return new TileResult(out.toByteArray(), false, false);
            } catch (Exception e) {
                errors.incrementAndGet();
                lastError = key + ": " + e;
                LOGGER.debug("lowres tile {} failed: {}", key, e.toString());
                return null;
            } finally {
                active.remove(key);
                lastGenMs = (System.nanoTime() - startNs) / 1_000_000;
            }
        }
    }

    private TileResult missingResult(int lod) {
        // L1 空 tile 可以确定；L2/L3 先返回 pending，等父层级联补齐，
        // 避免客户端把“暂时为空”的父层永久记成 empty。
        return lod == 1 ? new TileResult(null, false, true) : new TileResult(null, true, false);
    }

    private void enqueueRegion(String dim, ServerLevel level, int tileX, int tileZ) {
        int rx = Math.floorDiv(tileX * TILE_SIZE, 512);
        int rz = Math.floorDiv(tileZ * TILE_SIZE, 512);
        String rkey = dim + ":" + rx + ":" + rz;
        if (!queuedRegions.add(rkey)) return;
        workers.execute(() -> {
            active.add("region " + rkey);
            long startNs = System.nanoTime();
            try {
                // BlueMap 在渲染前会 flushWorldUpdates()；否则新建的 integrated world
                // 还没有 region 文件，loadColumns 只能读到空。
                ensureRegionSaved(dim, level, rx, rz);
                // 500 tile 已经接近一个 region 的大小，按需只生成请求的 L1，
                // 不能一次扫 region 内的 4 个大 tile；32 tile 保留 region 预生成。
                if (TILE_SIZE >= 500) image(dim, level, 1, tileX, tileZ);
                else generateRegionLod(dim, level, 1, rx, rz);
            } catch (Exception e) {
                errors.incrementAndGet();
                lastError = rkey + ": " + e;
                LOGGER.debug("lowres region {} failed: {}", rkey, e.toString());
            } finally {
                active.remove("region " + rkey);
                lastGenMs = (System.nanoTime() - startNs) / 1_000_000;
                queuedRegions.remove(rkey);
            }
        });
    }

    private void ensureRegionSaved(String dim, ServerLevel level, int rx, int rz) {
        long now = System.currentTimeMillis();
        long last = lastWorldSave.get();
        if (now - last < 5000) return;
        if (!lastWorldSave.compareAndSet(last, now)) return;
        // region 文件写入是异步落盘的；留足窗口，避免 watcher 把自己的 save 当成世界变化。
        selfSaveIgnoreUntil = now + 15000;
        if (server.isSameThread()) {
            level.save(null, true, false);
            return;
        }
        CompletableFuture<Void> saved = new CompletableFuture<>();
        server.execute(() -> {
            try {
                level.save(null, true, false);
                saved.complete(null);
            } catch (Throwable t) {
                saved.completeExceptionally(t);
            }
        });
        try {
            saved.get(60, TimeUnit.SECONDS);
        } catch (Exception e) {
            lastError = "save " + dim + " " + rx + " " + rz + ": " + e;
            LOGGER.debug("lowres world save failed: {}", e.toString());
        }
    }

    private void generateRegionLod(String dim, ServerLevel level, int lod, int rx, int rz) throws IOException {
        int span = TILE_SIZE * (int) Math.pow(LOD_FACTOR, lod - 1);
        int minX = Math.floorDiv(rx * 512, span);
        int maxX = Math.floorDiv(rx * 512 + 511, span);
        int minZ = Math.floorDiv(rz * 512, span);
        int maxZ = Math.floorDiv(rz * 512 + 511, span);
        for (int x = minX; x <= maxX; x++) {
            for (int z = minZ; z <= maxZ; z++) image(dim, level, lod, x, z);
        }
    }

    public void close() {
        if (watcher != null) {
            try {
                watcher.close();
            } catch (Exception ignored) {
            }
        }
        if (watchThread != null) watchThread.interrupt();
        workers.shutdownNow();
    }

    private void startRegionWatch() {
        try {
            Path world = worldRoot();
            WatchService ws = world.getFileSystem().newWatchService();
            registerRegionDir(ws, world.resolve("region"));
            registerRegionDir(ws, world.resolve("DIM-1").resolve("region"));
            registerRegionDir(ws, world.resolve("DIM1").resolve("region"));
            this.watcher = ws;
            Thread t = new Thread(this::watchRegions, "wgd-lowres-watch");
            t.setDaemon(true);
            this.watchThread = t;
            t.start();
        } catch (Exception e) {
            LOGGER.debug("lowres region watch unavailable: {}", e.toString());
        }
    }

    private static void registerRegionDir(WatchService ws, Path dir) throws java.io.IOException {
        if (Files.isDirectory(dir)) {
            dir.register(ws, StandardWatchEventKinds.ENTRY_CREATE,
                    StandardWatchEventKinds.ENTRY_MODIFY, StandardWatchEventKinds.ENTRY_DELETE);
        }
    }

    private void watchRegions() {
        WatchService ws = watcher;
        if (ws == null) return;
        while (!Thread.currentThread().isInterrupted()) {
            try {
                WatchKey key = ws.poll(2, TimeUnit.SECONDS);
                if (key == null) continue;
                Path dir = (Path) key.watchable();
                for (var event : key.pollEvents()) {
                    Path name = (Path) event.context();
                    Path file = dir.resolve(name);
                    if (System.currentTimeMillis() < selfSaveIgnoreUntil) continue;
                    if (invalidateRegion(file)) epoch.incrementAndGet();
                }
                key.reset();
            } catch (InterruptedException e) {
                return;
            } catch (Exception e) {
                LOGGER.debug("lowres region watch error: {}", e.toString());
            }
        }
    }

    private boolean invalidateRegion(Path file) {
        Matcher m = REGION_FILE.matcher(file.getFileName().toString());
        if (!m.matches()) return false;
        int rx, rz;
        try {
            rx = Integer.parseInt(m.group(1));
            rz = Integer.parseInt(m.group(2));
        } catch (NumberFormatException e) {
            return false;
        }
        String s = file.toString().replace('\\', '/');
        String dim = s.contains("/DIM-1/") ? "the_nether"
                : s.contains("/DIM1/") ? "the_end" : "overworld";
        queuedRegions.remove(dim + ":" + rx + ":" + rz);
        lowresTiles.clear();
        for (int cx = rx * 32; cx < rx * 32 + 32; cx++) {
            for (int cz = rz * 32; cz < rz * 32 + 32; cz++) {
                columnCache.remove(dim + ":" + cx + ":" + cz);
            }
        }
        int x0 = rx * 512, z0 = rz * 512;
        int minX = Math.floorDiv(x0, TILE_SIZE);
        int maxX = Math.floorDiv(x0 + 511, TILE_SIZE);
        int minZ = Math.floorDiv(z0, TILE_SIZE);
        int maxZ = Math.floorDiv(z0 + 511, TILE_SIZE);
        for (int x = minX; x <= maxX; x++) {
            for (int z = minZ; z <= maxZ; z++) {
                invalidate(dim, 1, x, z);
                for (int lod = 2; lod <= LOD_COUNT; lod++) {
                    int div = (int) Math.pow(LOD_FACTOR, lod - 1);
                    invalidate(dim, lod, Math.floorDiv(x, div), Math.floorDiv(z, div));
                }
            }
        }
        return true;
    }

    private void invalidate(String dim, int lod, int x, int z) {
        String key = key(dim, lod, x, z);
        Object lock = locks.computeIfAbsent(key, k -> new Object());
        synchronized (lock) {
            memory.remove(key);
            queued.remove(key);
            empty.remove(key);
            if (invalidated.size() > 4096) invalidated.clear();
            invalidated.add(key);
            try {
                Files.deleteIfExists(file(dim, lod, x, z));
            } catch (Exception e) {
                LOGGER.debug("lowres invalidate {} failed: {}", key, e.toString());
            }
        }
    }

    public String statusJson() {
        return Json.object()
                .put("state", "READY")
                .put("tileSize", TILE_SIZE)
                .put("lodCount", LOD_COUNT)
                .put("lodFactor", LOD_FACTOR)
                .put("cacheVersion", CACHE_VERSION)
                .put("worldRoot", worldRoot().toString())
                .put("epoch", epoch.get())
                .put("invalidated", String.join(",", invalidated))
                .put("active", active.size())
                .put("activeKeys", String.join(",", active))
                .put("lastError", lastError)
                .put("lastGenMs", lastGenMs)
                .put("colorResolver", colors != null ? 1 : 0)
                .put("colorResolved", colors == null ? 0 : colors.resolved())
                .put("colorFallback", colors == null ? 0 : colors.fallback())
                .put("cached", memory.size())
                .put("empty", empty.size())
                .put("pending", queued.size() + queuedRegions.size())
                .put("regionPending", queuedRegions.size())
                .put("requests", requests.get())
                .put("generated", generated.get())
                .put("errors", errors.get())
                .end();
    }

    private BufferedImage image(String dim, ServerLevel level, int lod, int x, int z) throws IOException {
        String key = key(dim, lod, x, z);
        LowresTile cached = memory.get(key);
        if (cached != null) return cached.image();

        Path file = file(dim, lod, x, z);
        LowresTile read = LowresTile.read(file, TILE_SIZE);
        if (read != null) {
            if (read.isEmpty()) {
                empty.add(key);
                memory.remove(key);
                return null;
            }
            memory.put(key, read);
            return read.image();
        }

        if (lod == 1) {
            generateBase(dim, level, x, z);
            BufferedImage base = existing(dim, 1, x, z);
            if (base == null) {
                empty.add(key);
                return null;
            }
            // BlueMap 的 LowresLayer.saveTile：base tile 保存后立刻级联到父层。
            cascadeFromTile(dim, 1, x, z);
            return base;
        }

        BufferedImage img = existing(dim, lod, x, z);
        if (img == null) return null;
        return img;
    }

    private static boolean isEmpty(BufferedImage img) {
        for (int y = 0; y < IMAGE_SIZE; y++) {
            for (int x = 0; x < IMAGE_SIZE; x++) {
                if ((img.getRGB(x, y) & 0x00FFFFFF) != 0 || (img.getRGB(x, y) >>> 24) != 0) return false;
            }
        }
        return true;
    }

    private void markEmpty(String dim, int lod, int x, int z) {
        String key = key(dim, lod, x, z);
        memory.remove(key);
        empty.add(key);
        try {
            Files.deleteIfExists(file(dim, lod, x, z));
        } catch (Exception ignored) {
        }
    }

    private void store(String dim, int lod, int x, int z, BufferedImage img) throws IOException {
        if (isEmpty(img)) {
            markEmpty(dim, lod, x, z);
            return;
        }
        empty.remove(key(dim, lod, x, z));
        Path file = file(dim, lod, x, z);
        LowresTile tile = new LowresTile(TILE_SIZE, img);
        tile.save(file);
        memory.put(key(dim, lod, x, z), tile);
        generated.incrementAndGet();
    }

    private void cascadeFromTile(String dim, int lod, int tileX, int tileZ) {
        lowresTiles.cascadeFromTile(dim, lod, tileX, tileZ);
    }

    private void generateBase(String dim, ServerLevel level, int tileX, int tileZ) throws IOException {
        int baseX = tileX * TILE_SIZE;
        int baseZ = tileZ * TILE_SIZE;
        for (int pz = 0; pz < IMAGE_SIZE; pz++) {
            for (int px = 0; px < IMAGE_SIZE; px++) {
                int wx = baseX + px;
                int wz = baseZ + pz;
                ChunkColumns cc = columns(dim, wx >> 4, wz >> 4);
                int idx = ((wz & 15) << 4) | (wx & 15);
                int top = 0;
                int height = 0;
                int light = 0;
                if (cc != null && cc.present[idx]) {
                    top = cc.color[idx];
                    height = cc.height[idx];
                    light = cc.light[idx];
                }
                lowresTiles.set(dim, wx, wz, top, height, light);
            }
        }
        lowresTiles.saveBase(dim, tileX, tileZ);
    }

    private BufferedImage existing(String dim, int lod, int x, int z) {
        String key = key(dim, lod, x, z);
        LowresTile cached = memory.get(key);
        if (cached != null) return cached.image();
        Path file = file(dim, lod, x, z);
        LowresTile read = LowresTile.read(file, TILE_SIZE);
        if (read == null) return null;
        if (read.isEmpty()) {
            empty.add(key);
            memory.remove(key);
            return null;
        }
        memory.put(key, read);
        return read.image();
    }

    private ChunkColumns columns(String dim, int cx, int cz) {
        String key = dim + ":" + cx + ":" + cz;
        ChunkColumns existing = columnCache.get(key);
        if (existing != null) return existing == MISSING_COLUMNS ? null : existing;
        ChunkColumns loaded = loadColumns(dim, cx, cz);
        // 空 chunk 也必须负缓存，否则同一 tile 的 33×33 列会反复打开 region 文件。
        columnCache.put(key, loaded == null ? MISSING_COLUMNS : loaded);
        return loaded;
    }

    private static final ChunkColumns MISSING_COLUMNS = new ChunkColumns();
    private final Map<String, ChunkColumns> columnCache = new ConcurrentHashMap<>();

    private ChunkColumns loadColumns(String dim, int cx, int cz) {
        Path regionFile = regionFile(dim, cx, cz);
        if (regionFile == null || !Files.isRegularFile(regionFile)) return null;
        CompoundTag chunk = readChunk(regionFile, cx, cz);
        if (chunk == null) return null;
        ServerLevel level = level(dim);
        if (level == null) return null;

        ChunkColumns cc = new ChunkColumns();
        ListTag sections = chunk.getList("sections", 10);
        List<Section> ordered = new ArrayList<>(sections.size());
        for (int i = 0; i < sections.size(); i++) {
            CompoundTag section = sections.getCompound(i);
            // NBT section.Y 是 section 索引（可为负）；Java 的 byte 符号扩展后才是 -4..19。
            int y = (byte) section.getInt("Y");
            CompoundTag blockStates = section.getCompound("block_states");
            if (blockStates.isEmpty()) continue;
            ListTag paletteTag = blockStates.getList("palette", 10);
            if (paletteTag.isEmpty()) continue;
            BlockState[] palette = new BlockState[paletteTag.size()];
            for (int p = 0; p < palette.length; p++) {
                palette[p] = blockState(paletteTag.getCompound(p).getString("Name"));
            }
            long[] data = blockStates.contains("data") ? blockStates.getLongArray("data") : new long[0];
            byte[] blockLight = section.getByteArray("block_light");
            byte[] skyLight = section.getByteArray("sky_light");
            ordered.add(new Section(y, palette, data, blockLight, skyLight));
        }
        ordered.sort(Comparator.comparingInt(Section::y).reversed());

        int remaining = 256;
        for (Section section : ordered) {
            int bits = section.palette.length <= 1 ? 0
                    : Math.max(4, 64 - Long.numberOfLeadingZeros(section.palette.length - 1));
            int perLong = bits == 0 ? 0 : 64 / bits;
            for (int i = 4095; i >= 0; i--) {
                int x = i & 15;
                int z = (i >> 4) & 15;
                int col = (z << 4) | x;
                if (cc.present[col]) continue;
                int pi = 0;
                if (bits != 0) {
                    int li = i / perLong;
                    if (li >= section.data.length) continue;
                    int shift = (i % perLong) * bits;
                    pi = (int) ((section.data[li] >>> shift) & ((1L << bits) - 1));
                }
                if (pi < 0 || pi >= section.palette.length) continue;
                BlockState state = section.palette[pi];
                if (state.isAir()) continue;
                // 顶层高度取第一个可见方块；颜色从顶层向下做 underlay（水/玻璃等透明层会让下层透出）。
                int y = section.y * 16 + (i >> 8);
                if (cc.opaque[col]) continue;
                int argb = colorOf(state, level, cx * 16 + x, y, cz * 16 + z);
                if ((argb >>> 24) == 0) continue;
                if (!cc.present[col]) {
                    cc.present[col] = true;
                    cc.height[col] = y + 1;
                    int block = nibble(section.blockLight, i);
                    int sky = nibble(section.skyLight, i);
                    int light = Math.max(block, sky);
                    cc.light[col] = light == 0 ? 15 : light;
                }
                cc.color[col] = underlay(cc.color[col], argb);
                // BlueMap BlockRenderPass 的等价优化：遇到可遮挡实体方块就停止向下扫。
                // 不能用“平均颜色 alpha>=254”判断，纹理边缘/平均 alpha 可能永远到不了 255。
                if (state.canOcclude()) {
                    cc.opaque[col] = true;
                    remaining--;
                }
            }
            if (remaining == 0) break;
        }
        return cc;
    }

    /** top 覆盖 lower 的 source-over；输入/输出都是 ARGB。 */
    private static int underlay(int top, int lower) {
        int ta = (top >>> 24) & 0xFF;
        int la = (lower >>> 24) & 0xFF;
        if (ta == 0) return lower;
        if (la == 0) return top;
        int rest = 255 - ta;
        int outA = ta + la * rest / 255;
        if (outA == 0) return 0;
        int tr = ((top >> 16) & 0xFF) * ta;
        int tg = ((top >> 8) & 0xFF) * ta;
        int tb = (top & 0xFF) * ta;
        int lr = ((lower >> 16) & 0xFF) * la * rest / 255;
        int lg = ((lower >> 8) & 0xFF) * la * rest / 255;
        int lb = (lower & 0xFF) * la * rest / 255;
        int r = (tr + lr) / outA;
        int g = (tg + lg) / outA;
        int b = (tb + lb) / outA;
        return (outA << 24) | (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
    }

    private CompoundTag readChunk(Path file, int cx, int cz) {
        try (RandomAccessFile raf = new RandomAccessFile(file.toFile(), "r")) {
            int localX = Math.floorMod(cx, 32);
            int localZ = Math.floorMod(cz, 32);
            int index = (localX & 31) + (localZ & 31) * 32;
            raf.seek(index * 4L);
            int location = raf.readInt();
            if (location == 0) return null;
            int sector = location >>> 8;
            raf.seek(sector * 4096L);
            int length = raf.readInt();
            int compression = raf.readUnsignedByte();
            if (length <= 0 || length > 64 * 1024 * 1024) return null;
            byte[] data = new byte[length - 1];
            raf.readFully(data);
            try (var in = new DataInputStream(switch (compression) {
                case 1 -> new GZIPInputStream(new ByteArrayInputStream(data));
                case 2 -> new InflaterInputStream(new ByteArrayInputStream(data));
                case 3 -> new ByteArrayInputStream(data);
                default -> throw new IOException("unknown compression " + compression);
            })) {
                return NbtIo.read(in, NbtAccounter.unlimitedHeap());
            }
        } catch (Exception e) {
            return null;
        }
    }

    private int colorOf(BlockState state, ServerLevel level, int x, int y, int z) {
        MapColor mapColor = state.getMapColor(level, new BlockPos(x, y, z));
        int fallback = (mapColor == null ? 0x777777 : mapColor.col) | 0xFF000000;
        int color = colors == null ? fallback : colors.color(state, fallback & 0xFFFFFF, level, x, y, z);
        return color;
    }

    private BlockState blockState(String name) {
        try {
            Block block = BuiltInRegistries.BLOCK.get(ResourceLocation.parse(name));
            return block == null ? Blocks.AIR.defaultBlockState() : block.defaultBlockState();
        } catch (Exception e) {
            return Blocks.AIR.defaultBlockState();
        }
    }

    private static int nibble(byte[] data, int index) {
        if (data == null || data.length == 0) return 0;
        int b = data[index >> 1] & 0xFF;
        return (index & 1) == 0 ? b & 15 : (b >> 4) & 15;
    }

    private static int signedHeight(int meta) {
        int h = meta & 0xFFFF;
        return h >= 0x8000 ? h - 0x10000 : h;
    }

    private static int pow(int base, int exp) {
        int v = 1;
        for (int i = 0; i < exp; i++) v *= base;
        return v;
    }

    private Path file(String dim, int lod, int x, int z) {
        return root.resolve("v" + CACHE_VERSION).resolve(dim).resolve("lod" + lod).resolve(x + "_" + z + ".png");
    }

    private static String key(String dim, int lod, int x, int z) {
        return dim + "/" + lod + "/" + x + "_" + z;
    }

    private Path worldRoot() {
        return server.getServerDirectory().resolve(server.getWorldPath(LevelResource.ROOT));
    }

    private Path regionFile(String dim, int cx, int cz) {
        Path world = worldRoot();
        String folder = switch (dim) {
            case "the_nether" -> "DIM-1";
            case "the_end" -> "DIM1";
            default -> "";
        };
        Path region = folder.isEmpty() ? world.resolve("region") : world.resolve(folder).resolve("region");
        return region.resolve("r." + Math.floorDiv(cx, 32) + "." + Math.floorDiv(cz, 32) + ".mca");
    }

    private ServerLevel level(String dim) {
        return switch (dim) {
            case "the_nether" -> server.getLevel(Level.NETHER);
            case "the_end" -> server.getLevel(Level.END);
            default -> server.getLevel(Level.OVERWORLD);
        };
    }

    private record Section(int y, BlockState[] palette, long[] data, byte[] blockLight, byte[] skyLight) {
    }

    private static final class ChunkColumns {
        final boolean[] present = new boolean[256];
        final boolean[] opaque = new boolean[256];
        final int[] height = new int[256];
        final int[] color = new int[256];
        final int[] light = new int[256];
    }
}
