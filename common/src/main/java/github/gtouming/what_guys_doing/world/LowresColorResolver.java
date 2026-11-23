package github.gtouming.what_guys_doing.world;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.tags.BlockTags;
import net.minecraft.world.level.biome.Biome;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.core.BlockPos;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * BlueMap 风格 lowres 颜色：按 blockstate → model → texture 取顶层贴图平均色。
 * 资源来自 AssetCache 已抽取的 client jar；任何一步缺失都回退到 MapColor。
 */
final class LowresColorResolver {
    private static final Logger LOGGER = LoggerFactory.getLogger("what_guys_doing/lowres");
    /** 必须有序：草方块如果先取到 particle/side 会得到泥土/侧面颜色。 */
    private static final List<String> TEXTURE_KEYS = List.of("top", "up", "all", "side", "particle");
    private final Path content;
    private final Map<BlockState, Integer> cache = new ConcurrentHashMap<>();
    private final Map<BlockState, Integer> textureCache = new ConcurrentHashMap<>();
    private final AtomicLong resolved = new AtomicLong();
    private final AtomicLong fallback = new AtomicLong();

    LowresColorResolver(Path content) {
        this.content = content;
    }

    int color(BlockState state, int mapColor, ServerLevel level, int x, int y, int z) {
        if (needsTint(state)) {
            try {
                int texture = textureAverage(state);
                if (texture == 0) {
                    fallback.incrementAndGet();
                    return 0xFF000000 | mapColor;
                }
                resolved.incrementAndGet();
                return tint(texture, biomeTint(state, level, x, y, z));
            } catch (Exception e) {
                fallback.incrementAndGet();
                LOGGER.debug("lowres biome tint fallback {}: {}", state, e.toString());
                return 0xFF000000 | mapColor;
            }
        }
        Integer cached = cache.get(state);
        if (cached != null) return cached;
        int texture = textureAverage(state);
        if (texture == 0) {
            // 资源包可能还在解压；不要缓存 fallback，否则后续永远无法恢复纹理颜色。
            fallback.incrementAndGet();
            return 0xFF000000 | mapColor;
        }
        resolved.incrementAndGet();
        cache.put(state, texture);
        return texture;
    }

    private int biomeTint(BlockState state, ServerLevel level, int x, int y, int z) {
        Biome biome = level.getBiome(new BlockPos(x, y, z)).value();
        Block block = state.getBlock();
        if (block == Blocks.WATER) return biome.getWaterColor();
        if (block == Blocks.VINE || state.is(BlockTags.LEAVES)) return biome.getFoliageColor();
        return biome.getGrassColor(x, z);
    }

    long resolved() {
        return resolved.get();
    }

    long fallback() {
        return fallback.get();
    }

    private int textureAverage(BlockState state) {
        Integer cached = textureCache.get(state);
        if (cached != null) return cached;
        int texture = loadTextureAverage(state);
        // 0 表示资源暂缺，不缓存，让 assets 就绪后的下一次生成可以恢复纹理色。
        if (texture != 0) textureCache.put(state, texture);
        return texture;
    }

    private int loadTextureAverage(BlockState state) {
        Block block = state.getBlock();
        ResourceLocation id = BuiltInRegistries.BLOCK.getKey(block);
        if (id == null) return 0;
        JsonObject blockstate = readJson(content.resolve(id.getNamespace())
                .resolve("blockstates").resolve(id.getPath() + ".json"));
        if (blockstate == null) return 0;
        String model = findModel(blockstate);
        if (model == null) return 0;
        String texture = findTexture(model, 0);
        if (texture == null) return 0;
        ResourceLocation tex = ResourceLocation.parse(texture);
        Path png = content.resolve(tex.getNamespace())
                .resolve("textures").resolve(tex.getPath() + ".png");
        if (!Files.isRegularFile(png)) return 0;
        BufferedImage img;
        try {
            img = ImageIO.read(png.toFile());
        } catch (java.io.IOException e) {
            return 0;
        }
        if (img == null) return 0;
        long r = 0, g = 0, b = 0, a = 0;
        int count = 0;
        for (int y = 0; y < img.getHeight(); y++) {
            for (int x = 0; x < img.getWidth(); x++) {
                int argb = img.getRGB(x, y);
                int alpha = (argb >>> 24) & 0xFF;
                if (alpha < 16) continue;
                r += ((argb >> 16) & 0xFF) * (long) alpha;
                g += ((argb >> 8) & 0xFF) * (long) alpha;
                b += (argb & 0xFF) * (long) alpha;
                a += alpha;
                count++;
            }
        }
        if (a == 0 || count == 0) return 0;
        int alpha = (int) (a / count);
        return (alpha << 24)
                | (((int) (r / a) & 0xFF) << 16)
                | (((int) (g / a) & 0xFF) << 8)
                | ((int) (b / a) & 0xFF);
    }

    /** BlueMap 只对需要 biome tint 的方块染色；其他方块保留 texture average。 */
    private static boolean needsTint(BlockState state) {
        Block block = state.getBlock();
        return state.is(BlockTags.LEAVES)
                || block == Blocks.GRASS_BLOCK
                || block == Blocks.SHORT_GRASS
                || block == Blocks.TALL_GRASS
                || block == Blocks.FERN
                || block == Blocks.LARGE_FERN
                || block == Blocks.WATER
                || block == Blocks.LILY_PAD
                || block == Blocks.VINE;
    }

    /** MapColor 作为染色方向；按最大分量归一，避免整张图被压暗。 */
    private static int tint(int texture, int mapColor) {
        int tr = (texture >> 16) & 0xFF, tg = (texture >> 8) & 0xFF, tb = texture & 0xFF;
        int mr = (mapColor >> 16) & 0xFF, mg = (mapColor >> 8) & 0xFF, mb = mapColor & 0xFF;
        int max = Math.max(mr, Math.max(mg, mb));
        if (max <= 0) return texture;
        tr = tr * mr / max;
        tg = tg * mg / max;
        tb = tb * mb / max;
        return (texture & 0xFF000000) | (tr << 16) | (tg << 8) | tb;
    }

    private String findModel(JsonObject blockstate) {
        JsonObject variants = object(blockstate, "variants");
        if (variants != null) {
            for (Map.Entry<String, JsonElement> e : variants.entrySet()) {
                String model = modelOf(e.getValue());
                if (model != null) return model;
            }
        }
        JsonArray parts = array(blockstate, "multipart");
        if (parts != null) {
            for (JsonElement part : parts) {
                if (!part.isJsonObject()) continue;
                String model = modelOf(part.getAsJsonObject().get("apply"));
                if (model != null) return model;
            }
        }
        return null;
    }

    private String modelOf(JsonElement element) {
        if (element == null) return null;
        if (element.isJsonArray()) {
            for (JsonElement e : element.getAsJsonArray()) {
                String m = modelOf(e);
                if (m != null) return m;
            }
            return null;
        }
        if (!element.isJsonObject()) return null;
        JsonObject o = element.getAsJsonObject();
        return o.has("model") && o.get("model").isJsonPrimitive()
                ? o.get("model").getAsString() : null;
    }

    private String findTexture(String modelPath, int depth) {
        if (depth > 8) return null;
        ResourceLocation id = ResourceLocation.parse(modelPath);
        JsonObject model = readJson(content.resolve(id.getNamespace())
                .resolve("models").resolve(id.getPath() + ".json"));
        if (model == null) return null;
        JsonObject textures = object(model, "textures");
        if (textures != null) {
            for (String key : TEXTURE_KEYS) {
                JsonElement e = textures.get(key);
                if (e == null || !e.isJsonPrimitive()) continue;
                String tex = resolveRef(e.getAsString(), textures, depth);
                if (tex != null && !tex.startsWith("#")) return tex;
            }
        }
        if (model.has("parent") && model.get("parent").isJsonPrimitive()) {
            return findTexture(model.get("parent").getAsString(), depth + 1);
        }
        return null;
    }

    private String resolveRef(String value, JsonObject textures, int depth) {
        if (depth > 8) return null;
        String v = value;
        int guard = 0;
        while (v.startsWith("#")) {
            JsonElement e = textures.get(v.substring(1));
            if (e == null || !e.isJsonPrimitive()) return null;
            v = e.getAsString();
            if (++guard > 8) return null;
        }
        return v;
    }

    private JsonObject readJson(Path path) {
        try {
            if (!Files.isRegularFile(path)) return null;
            JsonElement e = JsonParser.parseString(Files.readString(path));
            return e.isJsonObject() ? e.getAsJsonObject() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static JsonObject object(JsonObject o, String key) {
        JsonElement e = o.get(key);
        return e != null && e.isJsonObject() ? e.getAsJsonObject() : null;
    }

    private static JsonArray array(JsonObject o, String key) {
        JsonElement e = o.get(key);
        return e != null && e.isJsonArray() ? e.getAsJsonArray() : null;
    }
}
