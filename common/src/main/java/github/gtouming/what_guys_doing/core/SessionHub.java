package github.gtouming.what_guys_doing.core;

import github.gtouming.what_guys_doing.net.Msg;
import github.gtouming.what_guys_doing.net.Protocol;
import github.gtouming.what_guys_doing.web.AssetCache;
import github.gtouming.what_guys_doing.web.Json;
import github.gtouming.what_guys_doing.web.WebServer;
import github.gtouming.what_guys_doing.web.WebSocketConnection;
import github.gtouming.what_guys_doing.world.BlockDeltaCollector;
import github.gtouming.what_guys_doing.world.BlockDeltaSet;
import github.gtouming.what_guys_doing.world.EntitySnapshot;
import github.gtouming.what_guys_doing.world.SectionSnapshot;
import github.gtouming.what_guys_doing.world.TickFrame;
import github.gtouming.what_guys_doing.world.WorldSampler;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerChunkCache;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.chunk.LevelChunk;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 会话与会话订阅的中枢：服务器生命周期内启停，每 tick 取样一次并广播给所有会话。
 * 无人观看时不做任何采样（对 tick 的增量成本为 0）。
 */
public final class SessionHub {
    private static final Logger LOGGER = LoggerFactory.getLogger("what_guys_doing");
    private static volatile SessionHub instance;

    private final ModConfig config = ModConfig.INSTANCE;
    private final Metrics metrics = new Metrics();
    private final List<Session> sessions = new CopyOnWriteArrayList<>();
    /** 诊断用：前几次 section 查询失败时打印 key / 会话数 / 命中情况，定位"为什么 delta 被丢弃"。 */
    private static int probeLeft = 8;
    private final Map<Long, SectionSnapshot> sectionCache = new ConcurrentHashMap<>();

    private DimTable dimensions;
    private WebServer web;
    private AssetCache assets;
    @lombok.Getter
    private volatile boolean running;
    private int tickCounter;

    public static SessionHub instance() {
        return instance;
    }

    public Metrics metrics() {
        return metrics;
    }

    public DimTable dimensions() {
        return dimensions;
    }

    /** 原版资产缓存（未启用时为 null）。 */
    public AssetCache assets() {
        return assets;
    }

    public String assetStatusJson() {
        AssetCache cache = assets;
        if (cache != null) {
            return cache.statusJson();
        }
        return Json.object()
                .put("state", "DISABLED")
                .put("message", "assets disabled (source: " + config.assetsEnabledSource + ")")
                .put("assetsEnabledSource", config.assetsEnabledSource)
                .end();
    }

    /**
     * 实体类型描述符，每行 `id \t 键名 \t 宽 \t 高 \t flags`（与 blockStateLines 同形状，前端可复用解析）。
     * flags 位：1 = 有模型（等 entitystates 资源就位后再置位）、2 = 玩家、4 = 有变体（暂 0）。
     */
    public String entityTypeLines(String idList) {
        if (idList == null || idList.isEmpty()) {
            return "";
        }
        StringBuilder out = new StringBuilder(64 * 16);
        for (String token : idList.split(",")) {
            String trimmed = token.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            int id;
            try {
                id = Integer.parseInt(trimmed);
            } catch (NumberFormatException e) {
                continue;
            }
            net.minecraft.world.entity.EntityType<?> type = BuiltInRegistries.ENTITY_TYPE.byId(id);
            // ENTITY_TYPE 是 DefaultedRegistry：越界 id 不返回 null，而是返回默认值 minecraft:pig ✗
            // 所以必须往返校验 getId(type) == id，否则未知 id 会被静默当成猪。
            if (BuiltInRegistries.ENTITY_TYPE.getId(type) != id) {
                out.append(id).append('\t').append('?').append("\t0\t0\t0\n");
                continue;
            }
            net.minecraft.resources.ResourceLocation key = BuiltInRegistries.ENTITY_TYPE.getKey(type);
            // 1.21 的 EntityDimensions 是 record：字段私有，用记录访问器
            float width = type.getDimensions().width();
            float height = type.getDimensions().height();
            boolean isPlayer = "minecraft:player".equals(key.toString());
            out.append(id).append('\t')
                    .append(key).append('\t')
                    .append(width).append('\t')
                    .append(height).append('\t')
                    .append(isPlayer ? 2 : 0).append('\n');
        }
        return out.toString();
    }

    /**
     * 把数字 stateId 翻译成「方块名 + 属性串」，供浏览器查 blockstates/模型。
     * 每行 {@code id \t 方块名 \t 属性串 \t 遮挡(0/1)}；属性串顺序与 vanilla blockstate key 一致。
     * 第四列来自 {@link BlockState#canOcclude()}，服务端权威 —— 客户端不要再用贴图透明度去猜。
     */
    public String blockStateLines(String idList) {
        StringBuilder out = new StringBuilder(64 * 16);
        if (idList == null || idList.isEmpty()) {
            return "";
        }
        for (String token : idList.split(",")) {
            String trimmed = token.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            int id;
            try {
                id = Integer.parseInt(trimmed);
            } catch (NumberFormatException e) {
                continue;
            }
            BlockState state = Block.BLOCK_STATE_REGISTRY.byId(id);
            if (state == null) {
                out.append(id).append('\t').append('?').append("\t\t0\n");
                continue;
            }
            out.append(id).append('\t')
                    .append(BuiltInRegistries.BLOCK.getKey(state.getBlock())).append('\t')
                    .append(propertyString(state)).append('\t')
                    // 遮挡判定以服务端的 canOcclude() 为准：客户端靠"所有贴图不透明"猜不准 ——
                    // 草方块有一层 cutout 覆盖贴图，会被误判成不遮挡，于是相邻草方块之间的面不剔除。
                    .append(state.canOcclude() ? '1' : '0').append('\n');
        }
        return out.toString();
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static String propertyString(BlockState state) {
        StringBuilder sb = new StringBuilder(48);
        for (Property<?> property : state.getProperties()) {
            if (!sb.isEmpty()) {
                sb.append(',');
            }
            sb.append(property.getName()).append('=')
                    .append(((Property) property).getName(state.getValue(property)));
        }
        return sb.toString();
    }

    public Integer dimensionId(ResourceKey<Level> key) {
        DimTable table = dimensions;
        return table == null ? null : table.idOf(key);
    }

    public int stateId(BlockState state) {
        return Block.BLOCK_STATE_REGISTRY.getId(state);
    }

    /** 供前端高亮玩家用：玩家实体类型的注册 id。 */
    public int playerTypeId() {
        return BuiltInRegistries.ENTITY_TYPE.getId(EntityType.PLAYER);
    }

    public void start(MinecraftServer server) {
        if (running || !config.enabled) {
            return;
        }
        this.dimensions = new DimTable(server);
        instance = this;
        BlockDeltaCollector.activate();
        try {
            this.web = new WebServer(config.port, this);
            this.web.start();
            if (config.assetsEnabled) {
                AssetCache cache = new AssetCache(config.resolveConfigDir(), config.keepClientJar);
                this.assets = cache;
                cache.start();
            }
            running = true;
            LOGGER.info("viewer data service started: local http://127.0.0.1:{}/  lan {}",
                    web.port(), WebServer.describeLanAddress(web.port()));
        } catch (IOException e) {
            LOGGER.error("failed to bind port {}: {}", config.port, e.getMessage());
            this.web = null;
            instance = null;
            BlockDeltaCollector.deactivate();
        }
    }

    public void stop() {
        if (!running) {
            return;
        }
        running = false;
        BlockDeltaCollector.deactivate();
        for (Session session : sessions) {
            session.close();
        }
        sessions.clear();
        sectionCache.clear();
        assets = null;
        if (web != null) {
            web.stop();
            web = null;
        }
        instance = null;
        LOGGER.info("viewer data service stopped");
    }

    public void tick(MinecraftServer server) {
        if (!running || sessions.isEmpty()) {
            return;
        }
        long start = System.nanoTime();
        int tick = ++tickCounter;

        List<WorldSampler.DimArea> areas = new ArrayList<>(4);
        for (Session session : sessions) {
            planSections(server, session, areas);
        }
        EntitySnapshot[] entities = WorldSampler.sampleEntities(server, dimensions, areas, config.maxEntities);
        BlockDeltaSet deltas = BlockDeltaCollector.drain();
        if (!deltas.isEmpty()) {
            invalidateChanged(deltas);
        }

        TickFrame frame = new TickFrame(tick, server.overworld().getGameTime(), entities, deltas);
        for (Session session : sessions) {
            session.offer(frame);
        }

        metrics.setEntities(entities.length);
        metrics.addBlockDeltas(deltas.count());
        metrics.setActiveSections(activeSectionCount());
        metrics.recordSample(System.nanoTime() - start);
    }

    private long activeSectionCount() {
        long total = 0;
        for (Session session : sessions) {
            total += session.subs.drainSentKeys().length;
        }
        return total;
    }

    private void planSections(MinecraftServer server, Session session, List<WorldSampler.DimArea> areas) {
        Subscriptions sub = session.subs;
        int dimId = sub.dimId();
        if (dimId < 0) {
            return;
        }
        ResourceKey<Level> key = dimensions.keyOrNull(dimId);
        if (key == null) {
            return;
        }
        ServerLevel level = server.getLevel(key);
        if (level == null) {
            return;
        }
        int radius = sub.radius();
        areas.add(new WorldSampler.DimArea(dimId,
                sub.centerCx() - radius, sub.centerCz() - radius,
                sub.centerCx() + radius, sub.centerCz() + radius));

        ServerChunkCache chunks = level.getChunkSource();
        int minSectionY = dimensions.minSectionY(dimId);
        int built = 0;
        Long packed;
        while (built < config.maxSectionsPerTick && (packed = sub.pollPending()) != null) {
            int cx = Keys.unpackCx(packed);
            int cy = Keys.unpackCy(packed);
            int cz = Keys.unpackCz(packed);
            long sectionKey = Keys.section(dimId, cx, cy, cz);
            LevelChunk chunk = chunks.getChunkNow(cx, cz);
            if (chunk == null) {
                sub.invalidate(sectionKey);
                continue;
            }
            SectionSnapshot snapshot = sectionCache.get(sectionKey);
            if (snapshot == null) {
                long buildStart = System.nanoTime();
                snapshot = WorldSampler.buildSection(level, dimId, chunk, cy - minSectionY);
                metrics.addSectionBuildNanos(System.nanoTime() - buildStart);
                if (snapshot == null) {
                    sub.markPlanned(sectionKey, true);
                    continue;
                }
                if (sectionCache.size() < config.sectionCacheLimit) {
                    sectionCache.put(sectionKey, snapshot);
                }
            }
            session.offer(Protocol.section(snapshot));
            sub.markSent(sectionKey);
            built++;
        }
        metrics.addSectionsBuilt(built);

        if (sub.pendingCount() < config.maxSectionsPerTick * 16L) {
            discover(chunks, sub, dimId, minSectionY, 32);
        }
    }

    private void discover(ServerChunkCache chunks, Subscriptions sub, int dimId, int minSectionY, int budget) {
        int radius = sub.radius();
        int size = radius * 2 + 1;
        int total = size * size;
        int start = sub.discoveryCursor();
        int steps = Math.min(budget, total - start);
        for (int i = 0; i < steps; i++) {
            int idx = start + i;
            int cx = sub.centerCx() - radius + (idx % size);
            int cz = sub.centerCz() - radius + (idx / size);
            LevelChunk chunk = chunks.getChunkNow(cx, cz);
            if (chunk == null) {
                continue;
            }
            int sectionCount = chunk.getSections().length;
            for (int si = 0; si < sectionCount; si++) {
                int cy = minSectionY + si;
                long sectionKey = Keys.section(dimId, cx, cy, cz);
                if (sub.isPlanned(sectionKey) || sub.isSent(sectionKey)) {
                    continue;
                }
                sub.addPending(Keys.packSection(cx, cy, cz));
                sub.markPlanned(sectionKey, false);
            }
        }
        sub.advanceCursor(steps);
        if (sub.discoveryCursor() >= total) {
            sub.resetCursor();
        }
    }

    private void invalidateChanged(BlockDeltaSet deltas) {
        Map<Long, Integer> counts = new HashMap<>();
        for (int i = 0; i < deltas.count(); i++) {
            long key = Keys.section(deltas.dims()[i], deltas.xs()[i] >> 4, deltas.ys()[i] >> 4, deltas.zs()[i] >> 4);
            counts.merge(key, 1, Integer::sum);
        }
        for (Map.Entry<Long, Integer> entry : counts.entrySet()) {
            sectionCache.remove(entry.getKey());
            for (Session session : sessions) {
                // 从未发送过的段（典型：全空气段里被放下一个方块）必须整段补发 ——
                // 否则客户端不知道这个段存在，后续的增量会被它按"段不存在"丢弃。
                if (entry.getValue() >= config.sectionResendThreshold || !session.subs.isSent(entry.getKey())) {
                    session.subs.invalidate(entry.getKey());
                }
            }
        }
    }

    /** 供 mixin 快速判断：该方块所在 section 是否已被某个会话持有。 */
    public boolean isSectionActive(int dimId, int x, int y, int z) {
        if (sessions.isEmpty()) {
            if (probeLeft > 0) {
                probeLeft--;
                LOGGER.info("section probe: no sessions (dim={} @ {},{},{})", dimId, x, y, z);
            }
            return false;
        }
        long key = Keys.section(dimId, x >> 4, y >> 4, z >> 4);
        for (Session session : sessions) {
            // 必须接受 knownEmpty：玩家往空气里放方块时，那个段从未发送过（全空气），
            // 只认 sent 会把"放置"这一类最常见的交互全部丢掉。
            if (session.subs.isKnown(key)) {
                return true;
            }
        }
        if (probeLeft > 0) {
            probeLeft--;
            StringBuilder sb = new StringBuilder();
            for (Session session : sessions) {
                sb.append(" [sent=").append(session.subs.sentCount()).append(" hasKey=").append(session.subs.isSent(key)).append(']');
            }
            LOGGER.info("section probe: dim={} key={} sessions={}{}",
                    dimId, key, sessions.size(), sb);
        }
        return false;
    }

    public Session addSession(WebSocketConnection ws) {
        Session session = new Session(ws, this);
        sessions.add(session);
        LOGGER.info("viewer session connected (now {} total)", sessions.size());
        return session;
    }

    public void removeSession(Session session) {
        if (sessions.remove(session)) {
            session.close();
            LOGGER.info("viewer session closed ({} left)", sessions.size());
        }
    }

    public String statusJson() {
        return Json.object()
                .put("protocolVersion", Msg.PROTOCOL_VERSION)
                .put("sessions", sessions.size())
                .put("dimensions", dimensions == null ? 0 : dimensions.dimensionCount())
                .put("tick", tickCounter)
                .put("entities", metrics.tickEntities())
                .put("sectionsBuilt", metrics.tickSectionsBuilt())
                .put("nsPerSection", metrics.tickSectionsBuilt() == 0 ? 0
                        : metrics.sectionBuildNanos() / metrics.tickSectionsBuilt())
                .put("blockDeltas", metrics.tickBlockDeltas())
                .put("activeSections", metrics.activeSections())
                .put("bytesSent", metrics.bytesSent())
                .put("messagesSent", metrics.messagesSent())
                .put("droppedMessages", metrics.droppedMessages())
                .put("peakQueueDepth", metrics.peakQueueDepth())
                .put("sampleCount", metrics.sampleCount())
                .put("sampleLastMicros", metrics.lastSampleNanos() / 1000.0)
                .put("sampleMeanMicros", metrics.sampleMeanNanos() / 1000.0)
                .put("sampleP99Micros", metrics.sampleP99Nanos() / 1000.0)
                .put("sampleMaxMicros", metrics.sampleMaxNanos() / 1000.0)
                .end();
    }

    public String helloJson() {
        return Json.object()
                .put("name", "WhatGuysDoing")
                .put("protocolVersion", Msg.PROTOCOL_VERSION)
                .put("websocket", "/ws")
                .put("dimensions", dimensions == null ? 0 : dimensions.dimensionCount())
                .end();
    }
}
