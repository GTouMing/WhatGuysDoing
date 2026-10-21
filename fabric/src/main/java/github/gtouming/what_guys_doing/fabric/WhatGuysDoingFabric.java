package github.gtouming.what_guys_doing.fabric;

import github.gtouming.what_guys_doing.WhatGuysDoing;
import net.fabricmc.api.ModInitializer;

public final class WhatGuysDoingFabric implements ModInitializer {
    @Override
    public void onInitialize() {
        // This code runs as soon as Minecraft is in a mod-load-ready state.
        // However, some things (like resources) may still be uninitialized.
        // Proceed with mild caution.

        // Run our common setup.
        WhatGuysDoing.init(net.fabricmc.loader.api.FabricLoader.getInstance().getConfigDir());
    }
}
