package github.gtouming.what_guys_doing.core;

import java.nio.file.Path;

/** 极简配置。M0 阶段用系统属性/环境变量覆盖，M4 再落地配置文件。 */
public final class ModConfig {
    public static final ModConfig INSTANCE = new ModConfig();

    /** 由 {@code WhatGuysDoing.init(Path)} 在启动时写入（各加载器的配置目录）。 */
    public volatile Path configDir;

    public final int port;
    public final boolean enabled;
    /** 每 tick 最多为单个会话构建并发送多少个 section（首次加载限流）。 */
    public final int maxSectionsPerTick;
    /** 每连接发送队列上限（条），超出丢最旧消息。 */
    public final int maxQueueSize;
    /** 单个 section 在同一 tick 内变更超过该值时，改为整段重发。 */
    public final int sectionResendThreshold;
    /** 每 tick 采样实体上限。 */
    public final int maxEntities;
    /** 实体快照发送频率（tick 间隔）。 */
    public final int entityIntervalTicks;
    /** section 快照缓存条数上限。 */
    public final int sectionCacheLimit;
    /** 是否启用原版资产抓取与分发（关闭则浏览器退回方块颜色渲染）。 */
    public final boolean assetsEnabled;
    /** 诊断用：assetsEnabled 的取值来源，形如 {@code WGD_ASSETS_ENABLED=false}。 */
    public final String assetsEnabledSource;
    /** 抽取完成后是否保留 client jar（默认删除，省 ~25 MB）。 */
    public final boolean keepClientJar;

    private ModConfig() {
        this.port = intProp("whatguysdoing.port", "WGD_PORT", 27183);
        this.enabled = !"false".equalsIgnoreCase(prop("whatguysdoing.enabled", "WGD_ENABLED", "true"));
        this.maxSectionsPerTick = intProp("whatguysdoing.maxSectionsPerTick", "WGD_MAX_SECTIONS_PER_TICK", 2);
        this.maxQueueSize = intProp("whatguysdoing.maxQueueSize", "WGD_MAX_QUEUE_SIZE", 256);
        this.sectionResendThreshold = intProp("whatguysdoing.sectionResendThreshold", "WGD_SECTION_RESEND_THRESHOLD", 24);
        this.maxEntities = intProp("whatguysdoing.maxEntities", "WGD_MAX_ENTITIES", 4096);
        this.entityIntervalTicks = intProp("whatguysdoing.entityIntervalTicks", "WGD_ENTITY_INTERVAL_TICKS", 1);
        this.sectionCacheLimit = intProp("whatguysdoing.sectionCacheLimit", "WGD_SECTION_CACHE_LIMIT", 8192);
        String assetsRaw = System.getProperty("whatguysdoing.assets");
        String assetsSource = "-Dwhatguysdoing.assets";
        if (assetsRaw == null || assetsRaw.isBlank()) {
            assetsRaw = System.getenv("WGD_ASSETS_ENABLED");
            assetsSource = "WGD_ASSETS_ENABLED";
        }
        if (assetsRaw == null || assetsRaw.isBlank()) {
            this.assetsEnabled = true;
            assetsSource = "default";
        } else {
            this.assetsEnabled = !isFalseish(assetsRaw);
        }
        this.assetsEnabledSource = assetsSource + (assetsSource.equals("default") ? " (unset)" : "=" + assetsRaw);
        this.keepClientJar = "true".equalsIgnoreCase(prop("whatguysdoing.keepClientJar", "WGD_KEEP_CLIENT_JAR", "false"));
    }

    private static boolean isFalseish(String value) {
        String v = value.trim().toLowerCase();
        return v.equals("false") || v.equals("0") || v.equals("no") || v.equals("off");
    }

    /** 各加载器的配置目录；未注入时退回相对路径（工作目录即游戏目录）。 */
    public Path resolveConfigDir() {
        Path dir = configDir;
        return dir != null ? dir : Path.of("config");
    }

    private static String prop(String sysKey, String envKey, String def) {
        String v = System.getProperty(sysKey);
        if (v == null || v.isBlank()) {
            v = System.getenv(envKey);
        }
        return (v == null || v.isBlank()) ? def : v;
    }

    private static int intProp(String sysKey, String envKey, int def) {
        try {
            return Integer.parseInt(prop(sysKey, envKey, Integer.toString(def)).trim());
        } catch (NumberFormatException e) {
            return def;
        }
    }
}
