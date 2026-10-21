package github.gtouming.what_guys_doing.neoforge;

import github.gtouming.what_guys_doing.WhatGuysDoing;
import net.neoforged.fml.common.Mod;

@Mod(WhatGuysDoing.MOD_ID)
public final class WhatGuysDoingNeoForge {
    public WhatGuysDoingNeoForge() {
        // Run our common setup.
        WhatGuysDoing.init(net.neoforged.fml.loading.FMLPaths.CONFIGDIR.get());
    }
}
