package github.gtouming.what_guys_doing;

import dev.architectury.event.events.common.LifecycleEvent;
import dev.architectury.event.events.common.TickEvent;
import github.gtouming.what_guys_doing.core.ModConfig;
import github.gtouming.what_guys_doing.core.SessionHub;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Path;

/**
 * 公共入口：把会话中枢挂到服务器生命周期与 tick 上。
 * 平台差异为零，fabric / neoforge 模块只调用 {@link #init()}。
 */
public final class WhatGuysDoing {
    public static final String MOD_ID = "what_guys_doing";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    private static boolean initialized;

    private WhatGuysDoing() {
    }

    /** 各加载器入口调用：注入该加载器的配置目录。 */
    public static void init(Path configDir) {
        ModConfig.INSTANCE.configDir = configDir;
        init();
    }

    public static void init() {
        if (initialized) {
            return;
        }
        initialized = true;

        if (!ModConfig.INSTANCE.enabled) {
            LOGGER.info("WhatGuysDoing: disabled by config; the viewer data channel will not start");
            return;
        }

        LifecycleEvent.SERVER_STARTED.register(server -> new SessionHub().start(server));
        LifecycleEvent.SERVER_STOPPING.register(server -> {
            SessionHub hub = SessionHub.instance();
            if (hub != null) {
                hub.stop();
            }
        });
        TickEvent.SERVER_POST.register(server -> {
            SessionHub hub = SessionHub.instance();
            if (hub != null) {
                hub.tick(server);
            }
        });

        LOGGER.info("WhatGuysDoing init done (port={}, configDir={}, assets={} [{}])",
                ModConfig.INSTANCE.port, ModConfig.INSTANCE.resolveConfigDir(),
                ModConfig.INSTANCE.assetsEnabled ? "on" : "off",
                ModConfig.INSTANCE.assetsEnabledSource);
    }
}
