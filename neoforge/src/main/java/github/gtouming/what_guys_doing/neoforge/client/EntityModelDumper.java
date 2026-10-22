package github.gtouming.what_guys_doing.neoforge.client;

import com.mojang.blaze3d.platform.NativeImage;
import github.gtouming.what_guys_doing.WhatGuysDoing;
import net.minecraft.client.Minecraft;
import net.minecraft.client.model.EntityModel;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.LivingEntityRenderer;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.resources.Resource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import org.joml.Matrix4f;
import org.joml.Quaternionf;
import org.joml.Vector3f;

import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

/**
 * 实体模型生成器：把客户端运行时的 {@link ModelPart} 树原样导出成显式四边形。
 *
 * <p>格式（{@code generated-wgd-2}）：
 * <pre>
 * {
 *   "format_version": "generated-wgd-2",
 *   "texture_size": [64, 32],
 *   "textures": { "0": "entity/pig/pig" },
 *   "parts": [
 *     { "name": "head", "parent": null, "pivot": [0, 12, -6],
 *       "visible": true, "skipDraw": false,
 *       "cubes": [ { "index": 0, "quads": [
 *         { "face": "up", "texture": "#0",
 *           "positions": [[x,y,z] x4], "uvs": [[u,v] x4] } ] } ] }
 *   ]
 * }
 * </pre>
 *
 * <p>为什么不再输出 from/to + 面矩形：原版 ModelPart 有 part 旋转（例如 QuadrupedModel 的
 * body 是 xRot=π/2）、缩放、mirror，以及每面 4 个顶点的具体 UV 角序。用 axis-aligned 盒体
 * 近似一定会错。这里把完整 part 变换烘进顶点，UV 也按顶点原样导出，消费端不再做任何推断。
 *
 * <p>坐标：模型单位（1/16 方块），y 已转成向上（脚底 y=0）。消费端只负责 /16 和实体 yaw/位置。
 *
 * <p>触发方式：{@code -Dwgd.dumpEntityModels=true}，或在 run 目录放 {@code dump-entities.flag}。
 */
@EventBusSubscriber(modid = WhatGuysDoing.MOD_ID, value = Dist.CLIENT)
public final class EntityModelDumper {
    /** 原版 ModelPart 空间里脚底在 y=24；转 y-up 时 y' = 24 - y。 */
    private static final float GROUND_Y = 24.0f;
    private static final float EPS = 1e-4f;
    /**
     * 只导出**默认状态下一定可见**的 RenderLayer。
     * 其他层（鞘翅、鞍、项圈、盔甲、职业…）有模型和静态贴图，但只在实体带对应装备/状态时才渲染；
     * 盲目导出会让所有僵尸长出鞘翅。条件层的可见性需要实体快照里的装备/变体信息，后续再做。
     */
    private static final Set<String> SAFE_LAYER_NAMES = Set.of(
            "SheepFurLayer",
            "MooshroomMushroomLayer",
            "SnowGolemPumpkinLayer",
            "WolfCollarLayer",
            "CatCollarLayer"
    );

    private static boolean done;
    private static boolean probeLogged;

    @SubscribeEvent
    public static void onClientTick(ClientTickEvent.Post event) {
        if (done) {
            return;
        }
        Path path = Path.of("dump-entities.flag");
        if (!probeLogged) {
            probeLogged = true;
            boolean flag = Files.exists(path);
            WhatGuysDoing.LOGGER.info("dumper probe: cwd={} flag={} level={}",
                    Path.of(".").toAbsolutePath().normalize(), flag, Minecraft.getInstance().level != null);
        }
        boolean wanted = Boolean.getBoolean("wgd.dumpEntityModels")
                || Files.exists(path);
        if (!wanted) {
            return;
        }
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null) {
            return;
        }
        done = true;
        try {
            dumpAll(mc);
        } catch (Exception e) {
            WhatGuysDoing.LOGGER.error("entity model dump failed", e);
        }
    }

    private static void dumpAll(Minecraft mc) throws Exception {
        Path dir = Path.of("wgd-entity-dump");
        Files.createDirectories(dir);
        Path geoDir = dir.resolve("blockbench");
        Files.createDirectories(geoDir);
        int dumped = 0;
        int skipped = 0;
        int totalQuads = 0;
        for (EntityType<?> type : net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE) {
            ResourceLocation id = net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE.getKey(type);
            if (!"minecraft".equals(id.getNamespace())) {
                continue;
            }
            Entity entity;
            try {
                entity = type.create(Objects.requireNonNull(mc.level));
            } catch (Exception e) {
                skipped++;
                continue;
            }
            if (entity == null) {
                skipped++;
                continue;
            }
            EntityRenderer<?> renderer;
            try {
                renderer = mc.getEntityRenderDispatcher().getRenderer(entity);
            } catch (Exception e) {
                skipped++;
                continue;
            }
            if (!(renderer instanceof LivingEntityRenderer<?, ?> living)) {
                skipped++;
                continue;
            }
            try {
                int quads = dumpOne(mc, living, entity, id, dir, geoDir);
                if (quads > 0) {
                    dumped++;
                    totalQuads += quads;
                } else {
                    skipped++;
                }
            } catch (Exception e) {
                WhatGuysDoing.LOGGER.warn("dump: {} failed: {}", id, e.toString());
                skipped++;
            }
        }
        WhatGuysDoing.LOGGER.info("dump: done, {} models written, {} skipped, {} quads -> {}",
                dumped, skipped, totalQuads, dir.toAbsolutePath());
    }

    private static int dumpOne(Minecraft mc, LivingEntityRenderer<?, ?> renderer,
                               Entity entity, ResourceLocation id, Path dir, Path geoDir) throws Exception {
        EntityModel<?> model = renderer.getModel();
        // ModelPart 的 xRot 等字段会被 setupAnim 就地改写；先恢复中性姿态，避免 dump 到上一帧动画。
        neutralizePose(model, entity);
        ResourceLocation texture = textureLocationOf(renderer, entity);
        NativeImage image = textureImage(mc, texture);
        int[] size = image != null ? new int[]{image.getWidth(), image.getHeight()} : new int[]{64, 64};
        String textureRef = texture == null ? "" : texture.getPath()
                .replaceFirst("^textures/", "").replaceFirst("\\.png$", "");

        List<String> parts = new ArrayList<>();
        Set<ModelPart> visited = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>());
        int[] quadCount = {0};

        ModelPart root = actualRoot(model);
        if (root != null) {
            dumpPart(root, "root", new Matrix4f(), null, false, visited, parts, quadCount, "#0", image);
        }
        // 很多模型不保存 root 字段（构造器里 root.getChild(...) 后就丢掉了）。
        // 这时每个 ModelPart 字段就是一根顶层子树，不能拿“第一个字段”冒充 root。
        for (Class<?> k = model.getClass(); k != null; k = k.getSuperclass()) {
            for (Field f : k.getDeclaredFields()) {
                if (!ModelPart.class.isAssignableFrom(f.getType())) {
                    continue;
                }
                f.setAccessible(true);
                ModelPart part = (ModelPart) f.get(model);
                if (part != null && !visited.contains(part)) {
                    dumpPart(part, f.getName(), new Matrix4f(), null, false, visited, parts, quadCount, "#0", image);
                }
            }
        }
        if (parts.isEmpty() || quadCount[0] == 0) {
            return 0;
        }

        // 附加 RenderLayer（羊的羊毛外壳、马的纹路/鞍、盔甲等）。
        // 这些层不属于 renderer.getModel()，但会覆盖基础模型的接缝；不导出就会“漏出草方块”。
        List<String> layerJsons = new ArrayList<>();
        List<String> layerMetas = new ArrayList<>();
        Object layerList = get(renderer, "layers");
        if (layerList instanceof List<?> layers) {
            WhatGuysDoing.LOGGER.info("dump: {} layers {}", id, layers.size());
            for (Object layer : layers) {
                String layerName = layer.getClass().getSimpleName();
                if (!SAFE_LAYER_NAMES.contains(layerName)) {
                    continue;
                }
                String layerJson = dumpLayer(mc, layer, entity, id, geoDir, layerMetas, model);
                if (layerJson != null) {
                    layerJsons.add(layerJson);
                }
            }
        } else {
            WhatGuysDoing.LOGGER.info("dump: {} no layer list ({})", id,
                    layerList == null ? "null" : layerList.getClass().getSimpleName());
        }

        StringBuilder out = new StringBuilder();
        out.append("{\n");
        out.append("  \"format_version\": \"generated-wgd-2\",\n");
        out.append("  \"texture_size\": [").append(size[0]).append(", ").append(size[1]).append("],\n");
        out.append("  \"textures\": { \"0\": \"").append(jsonEscape(textureRef)).append("\" },\n");
        out.append("  \"parts\": [\n");
        out.append(String.join(",\n", parts));
        out.append("\n  ]");
        if (!layerJsons.isEmpty()) {
            out.append(",\n  \"layers\": [\n");
            out.append(String.join(",\n", layerJsons));
            out.append("\n  ]");
        }
        out.append("\n}\n");

        Files.writeString(dir.resolve(id.getPath() + ".json"), out.toString());
        try {
            BedrockMeta baseMeta = exportBedrock(model, entity, textureRef, size, id, geoDir, null, image);
            String meta = "{\"id\":\"" + jsonEscape(id.toString()) + "\",\"base\":"
                    + bedrockMetaJson(baseMeta, null)
                    + ",\"layers\":[" + String.join(",", layerMetas) + "]}\n";
            Files.writeString(geoDir.resolve(sanitize(id.getPath()) + ".meta.json"), meta);
        } catch (Exception e) {
            WhatGuysDoing.LOGGER.warn("dump: bedrock {} failed: {}", id, e.toString());
        }
        if (image != null) {
            image.close();
        }
        WhatGuysDoing.LOGGER.info("dump: {} -> {}x{}, {} parts, {} quads, texture {}",
                id, size[0], size[1], parts.size(), quadCount[0], textureRef);
        return quadCount[0];
    }

    /** Bedrock 导出结果，用于写 sidecar metadata。 */
    private record BedrockMeta(String geometry, String texture, int[] size) {
    }

    /**
     * Bedrock Entity 1.12.0（.geo.json）sidecar。
     *
     * <p>坐标与 vanilla Bedrock 的 pig.geo.json 对齐：y-up、1/16 方块。
     * bone.pivot = 全局平移（不叠加父旋转）的 y-up；bone.rotation = part 局部 rotation 角度；
     * cube.origin/size = cube 局部 from/to + 全局平移，再转 y-up。
     *
     * <p>UV 用 per-face uv/uv_size（贴图像素）。Bedrock 1.12 的 per-face uv 没有面内旋转，
     * 所以旋转/镜像的面会按矩形输出；这是已知损失。多贴图通过每个 RenderLayer 单独一个 geo 文件保留。
     */
    private static BedrockMeta exportBedrock(EntityModel<?> model, Entity entity, String textureRef,
                                             int[] size, ResourceLocation id, Path geoDir,
                                             String suffix, NativeImage image) throws Exception {
        List<String> bones = new ArrayList<>();
        Set<String> usedNames = new HashSet<>();
        Set<ModelPart> visited = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>());
        ModelPart root = actualRoot(model);
        if (root != null) {
            exportBone(root, "root", null, 0f, 0f, 0f, visited, usedNames, bones, size, image);
        }
        for (Class<?> k = model.getClass(); k != null; k = k.getSuperclass()) {
            for (Field f : k.getDeclaredFields()) {
                if (!ModelPart.class.isAssignableFrom(f.getType())) {
                    continue;
                }
                f.setAccessible(true);
                ModelPart part = (ModelPart) f.get(model);
                if (part != null && !visited.contains(part)) {
                    exportBone(part, f.getName(), null, 0f, 0f, 0f, visited, usedNames, bones, size, image);
                }
            }
        }
        String path = sanitize(id.getPath());
        String name = suffix == null ? path : path + "_" + sanitize(suffix);
        String identifier = "geometry.what_guys_doing." + name;
        String json = "{\n"
                + "  \"format_version\": \"1.12.0\",\n"
                + "  \"minecraft:geometry\": [{\n"
                + "    \"description\": {\"identifier\": \"" + jsonEscape(identifier)
                + "\", \"texture_width\": " + size[0] + ", \"texture_height\": " + size[1]
                + ", \"visible_bounds_width\": 4, \"visible_bounds_height\": 4, \"visible_bounds_offset\": [0, 2, 0]},\n"
                + "    \"bones\": [\n" + String.join(",\n", bones) + "\n    ]\n"
                + "  }]\n"
                + "}\n";
        Files.writeString(geoDir.resolve(name + ".geo.json"), json);
        WhatGuysDoing.LOGGER.info("dump: bedrock {} -> {} bones, texture {}", name, bones.size(), textureRef);
        return new BedrockMeta(identifier, textureRef, size);
    }

    private static void exportBone(ModelPart part, String name, String parentBone,
                                   float ptx, float pty, float ptz,
                                   Set<ModelPart> visited, Set<String> usedNames,
                                   List<String> out, int[] texSize, NativeImage image) throws Exception {
        if (!visited.add(part)) {
            return;
        }
        if (name != null && name.toLowerCase(Locale.ROOT).contains("baby")) {
            return;
        }
        String base = name == null || name.isEmpty() ? "root" : name;
        String boneName = base;
        int n = 2;
        while (!usedNames.add(boneName)) {
            boneName = base + "_" + n++;
        }
        float tx = ptx + num(part, "x");
        float ty = pty + num(part, "y");
        float tz = ptz + num(part, "z");
        boolean visible = bool(part, "visible", true);
        boolean skipDraw = bool(part, "skipDraw", false);

        List<String> cubes = new ArrayList<>();
        if (visible && !skipDraw) {
            Object cubesObj = get(part, "cubes");
            if (cubesObj instanceof List<?> list) {
                for (Object cube : list) {
                    String cubeJson = bedrockCube(cube, tx, ty, tz, texSize, image);
                    if (cubeJson != null) {
                        cubes.add(cubeJson);
                    }
                }
            }
        }

        StringBuilder sb = new StringBuilder();
        sb.append("      {\"name\":\"").append(jsonEscape(boneName)).append('"');
        if (parentBone != null) {
            sb.append(",\"parent\":\"").append(jsonEscape(parentBone)).append('"');
        }
        sb.append(",\"pivot\":[").append(fmt(tx)).append(',').append(fmt(GROUND_Y - ty))
                .append(',').append(fmt(tz)).append(']');
        float rx = num(part, "xRot");
        float ry = num(part, "yRot");
        float rz = num(part, "zRot");
        if (rx != 0f || ry != 0f || rz != 0f) {
            sb.append(",\"rotation\":[")
                    .append(fmt((float) Math.toDegrees(rx))).append(',')
                    .append(fmt((float) Math.toDegrees(ry))).append(',')
                    .append(fmt((float) Math.toDegrees(rz))).append(']');
        }
        if (!visible) {
            sb.append(",\"neverRender\":true");
        }
        if (!cubes.isEmpty()) {
            sb.append(",\"cubes\":[").append(String.join(",", cubes)).append(']');
        }
        sb.append('}');
        out.add(sb.toString());

        Object children = get(part, "children");
        if (children instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> child : map.entrySet()) {
                exportBone((ModelPart) child.getValue(), String.valueOf(child.getKey()), boneName,
                        tx, ty, tz, visited, usedNames, out, texSize, image);
            }
        }
    }

    private static String bedrockCube(Object cube, float tx, float ty, float tz, int[] texSize,
                                      NativeImage image) throws Exception {
        Object polygons = get(cube, "polygons");
        if (!(polygons instanceof Object[] polys) || polys.length == 0) {
            return null;
        }
        float[] box = cubeBounds(polys);
        if (box == null) {
            return null;
        }
        float minX = box[0], minY = box[1], minZ = box[2];
        float maxX = box[3], maxY = box[4], maxZ = box[5];
        // Blockbench/Bedrock 使用 y-up；原版 ModelPart 是 y-down（脚底 y=24）。
        float originX = tx + minX;
        float originY = GROUND_Y - (ty + maxY);
        float originZ = tz + minZ;
        float sizeX = Math.max(0.001f, maxX - minX);
        float sizeY = Math.max(0.001f, maxY - minY);
        float sizeZ = Math.max(0.001f, maxZ - minZ);

        List<String> faces = new ArrayList<>();
        for (Object poly : polys) {
            Object vertsObj = get(poly, "vertices");
            if (!(vertsObj instanceof Object[] verts) || verts.length != 4) {
                continue;
            }
            String face = faceOfLocal(poly, verts, minX, minY, minZ, maxX, maxY, maxZ);
            if (face == null) {
                continue;
            }
            String bedrockFace = switch (face) {
                case "up" -> "down";
                case "down" -> "up";
                default -> face;
            };
            float[][] uvs = new float[4][2];
            for (int i = 0; i < 4; i++) {
                uvs[i][0] = num(verts[i], "u");
                uvs[i][1] = num(verts[i], "v");
            }
            float minU = Float.MAX_VALUE, maxU = -Float.MAX_VALUE;
            float minV = Float.MAX_VALUE, maxV = -Float.MAX_VALUE;
            for (float[] uv : uvs) {
                minU = Math.min(minU, uv[0]);
                maxU = Math.max(maxU, uv[0]);
                minV = Math.min(minV, uv[1]);
                maxV = Math.max(maxV, uv[1]);
            }
            float u0 = minU * texSize[0];
            float v0 = minV * texSize[1];
            float w = (maxU - minU) * texSize[0];
            float h = (maxV - minV) * texSize[1];
            if (w < 0.001f || h < 0.001f) {
                continue;
            }
            faces.add("\"" + bedrockFace + "\":{\"uv\":[" + fmt(u0) + "," + fmt(v0)
                    + "],\"uv_size\":[" + fmt(w) + "," + fmt(h) + "]}");
        }
        if (faces.isEmpty()) {
            return null;
        }
        return "{\"origin\":[" + fmt(originX) + "," + fmt(originY) + "," + fmt(originZ)
                + "],\"size\":[" + fmt(sizeX) + "," + fmt(sizeY) + "," + fmt(sizeZ)
                + "],\"uv\":{" + String.join(",", faces) + "}}";
    }

    private static String bedrockMetaJson(BedrockMeta meta, String name) {
        StringBuilder sb = new StringBuilder("{\"geometry\":\"").append(jsonEscape(meta.geometry))
                .append("\",\"texture\":\"").append(jsonEscape(meta.texture))
                .append("\",\"texture_size\":[").append(meta.size[0]).append(',').append(meta.size[1]).append(']');
        if (name != null) {
            sb.append(",\"name\":\"").append(jsonEscape(name)).append('"');
        }
        return sb.append('}').toString();
    }

    private static String sanitize(String value) {
        return value.replaceAll("[^A-Za-z0-9_]+", "_");
    }

    /** 递归导出一棵 ModelPart 子树；world 已包含父链变换。 */
    private static void dumpPart(ModelPart part, String name, Matrix4f parentWorld, String parentName,
                                 boolean parentHidden, Set<ModelPart> visited, List<String> out,
                                 int[] quadCount, String textureRef, NativeImage image) throws Exception {
        if (!visited.add(part)) {
            return;
        }
        // EntityType.create() 默认是成年个体；AgeableListModel 会把 baby 部件也挂在模型字段上，
        // 但 renderToBuffer 只在 young=true 时绘制。dump 成年模型时跳过这些部件，避免多出四条腿。
        if (name != null && name.toLowerCase(Locale.ROOT).contains("baby")) {
            return;
        }
        boolean visible = bool(part, "visible", true);
        boolean skipDraw = bool(part, "skipDraw", false);
        Matrix4f world = new Matrix4f(parentWorld).mul(localMatrix(part));
        boolean hidden = parentHidden || !visible;

        Vector3f pivot = world.transformPosition(new Vector3f(0f, 0f, 0f));
        float det = world.determinant3x3();
        // 基础角序的叉积指向“内”（与方块路径一致）；y 翻转 det=-1，会把叉积翻成“外”。
        // 因此总 det<0 时反转顶点顺序，保持和 frontFace:'cw' 一致的绕序。
        boolean reverse = -det < 0f;

        List<String> cubes = new ArrayList<>();
        if (!hidden && !skipDraw) {
            Object cubesObj = get(part, "cubes");
            if (cubesObj instanceof List<?> list) {
                int index = 0;
                for (Object cube : list) {
                    String cubeJson = cubeToJson(cube, index++, world, reverse, quadCount, textureRef, image);
                    if (cubeJson != null) {
                        cubes.add(cubeJson);
                    }
                }
            }
        } else {
            // 即使不画，也要遍历 children；这里只跳过本 part 的 cubes。
            if (!hidden) {
                visited.add(part);
            }
        }

        String sb = "    {\"name\":\"" + jsonEscape(name == null || name.isEmpty() ? "root" : name) +
                "\",\"parent\":" + (parentName == null ? "null" : "\"" + jsonEscape(parentName) + "\"") +
                ",\"pivot\":[" + fmt(pivot.x) + ',' + fmt(GROUND_Y - pivot.y) +
                ',' + fmt(pivot.z) + ']' +
                ",\"visible\":" + visible +
                ",\"skipDraw\":" + skipDraw +
                ",\"cubes\":[" + String.join(",", cubes) + "]}";
        out.add(sb);

        Object children = get(part, "children");
        if (children instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> child : map.entrySet()) {
                dumpPart((ModelPart) child.getValue(), String.valueOf(child.getKey()), world,
                        name, hidden, visited, out, quadCount, textureRef, image);
            }
        }
    }

    /**
     * 附加 RenderLayer：大多数层模型不在 renderer.getModel() 里（羊毛、马纹、鞍、盔甲…）。
     * 只导出能反射到「EntityModel 字段 + ResourceLocation 贴图字段」的层；动态贴图/颜色层的后续再补。
     */
    private static String dumpLayer(Minecraft mc, Object layer, Entity entity, ResourceLocation id,
                                    Path geoDir, List<String> layerMetas, EntityModel<?> fallbackModel) {
        String layerName = layer.getClass().getSimpleName();
        EntityModel<?> model = layerModel(layer);
        // WolfCollarLayer 没有自己的 model 字段，它复用 wolf 的 base model + collar texture。
        if (model == null && "WolfCollarLayer".equals(layerName)) {
            model = fallbackModel;
        }
        ResourceLocation texture = layerTexture(layer);
        if (model == null || texture == null) {
            WhatGuysDoing.LOGGER.info("dump: layer {} skipped (model={}, texture={})",
                    layerName, model != null, texture);
            return null;
        }
        neutralizePose(model, entity);
        NativeImage image = textureImage(mc, texture);
        int[] size = image != null ? new int[]{image.getWidth(), image.getHeight()} : new int[]{64, 64};
        String textureRef = "minecraft:" + texture.getPath();
        List<String> parts = new ArrayList<>();
        Set<ModelPart> visited = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>());
        int[] quadCount = {0};
        try {
            ModelPart root = actualRoot(model);
            if (root != null) {
                dumpPart(root, "root", new Matrix4f(), null, false, visited, parts, quadCount, textureRef, image);
            }
            for (Class<?> k = model.getClass(); k != null; k = k.getSuperclass()) {
                for (Field f : k.getDeclaredFields()) {
                    if (!ModelPart.class.isAssignableFrom(f.getType())) {
                        continue;
                    }
                    f.setAccessible(true);
                    ModelPart part = (ModelPart) f.get(model);
                    if (part != null && !visited.contains(part)) {
                        dumpPart(part, f.getName(), new Matrix4f(), null, false, visited, parts, quadCount, textureRef, image);
                    }
                }
            }
        } catch (Exception e) {
            if (image != null) {
                image.close();
            }
            WhatGuysDoing.LOGGER.warn("dump: layer {} failed: {}", layer.getClass().getSimpleName(), e.toString());
            return null;
        }
        String name = layer.getClass().getSimpleName();
        if (parts.isEmpty() || quadCount[0] == 0) {
            if (image != null) {
                image.close();
            }
            WhatGuysDoing.LOGGER.info("dump: layer {} empty (parts={}, quads={})",
                    name, parts.size(), quadCount[0]);
            return null;
        }
        try {
            BedrockMeta meta = exportBedrock(model, entity, textureRef, size, id, geoDir, name, image);
            layerMetas.add(bedrockMetaJson(meta, name));
        } catch (Exception e) {
            WhatGuysDoing.LOGGER.warn("dump: bedrock layer {} failed: {}", name, e.toString());
        }
        if (image != null) {
            image.close();
        }
        return "    {\"name\":\"" + jsonEscape(name)
                + "\",\"texture\":\"" + jsonEscape(textureRef)
                + "\",\"texture_size\":[" + size[0] + "," + size[1] + "],\"parts\":["
                + String.join(",", parts) + "]}";
    }

    /** RenderLayer 子类里的 EntityModel 字段（SheepFurLayer.model 等）。 */
    private static EntityModel<?> layerModel(Object layer) {
        for (Class<?> k = layer.getClass(); k != null; k = k.getSuperclass()) {
            for (Field f : k.getDeclaredFields()) {
                if (!EntityModel.class.isAssignableFrom(f.getType())) {
                    continue;
                }
                try {
                    f.setAccessible(true);
                    Object value = f.get(layer);
                    if (value instanceof EntityModel<?> model) {
                        return model;
                    }
                } catch (Exception ignored) {
                    // 继续找
                }
            }
        }
        return null;
    }

    /** RenderLayer 子类里的贴图 ResourceLocation（静态或实例字段）。 */
    private static ResourceLocation layerTexture(Object layer) {
        for (Class<?> k = layer.getClass(); k != null; k = k.getSuperclass()) {
            for (Field f : k.getDeclaredFields()) {
                if (!ResourceLocation.class.isAssignableFrom(f.getType())) {
                    continue;
                }
                try {
                    f.setAccessible(true);
                    Object value = java.lang.reflect.Modifier.isStatic(f.getModifiers())
                            ? f.get(null) : f.get(layer);
                    if (value instanceof ResourceLocation rl && rl.getPath().startsWith("textures/")) {
                        return rl;
                    }
                } catch (Exception ignored) {
                    // 继续找
                }
            }
        }
        return null;
    }

    /** 单个 cube：每个 polygon 输出一条显式四边形。 */
    private static String cubeToJson(Object cube, int index, Matrix4f world, boolean reverse,
                                     int[] quadCount, String textureRef, NativeImage image) throws Exception {
        Object polygons = get(cube, "polygons");
        if (!(polygons instanceof Object[] polys) || polys.length == 0) {
            return null;
        }
        // Cube 的 minX..maxZ 字段是**未加 grow** 的盒体，而 polygon 顶点用的是 grow 后的坐标。
        // 用字段判面会让所有带 CubeDeformation 的 cube 把一对相对面判成同一方向 —— 必须从顶点自己算。
        float[] box = cubeBounds(polys);
        if (box == null) {
            return null;
        }
        float minX = box[0];
        float minY = box[1];
        float minZ = box[2];
        float maxX = box[3];
        float maxY = box[4];
        float maxZ = box[5];

        List<String> quads = new ArrayList<>();
        for (Object poly : polys) {
            Object vertsObj = get(poly, "vertices");
            if (!(vertsObj instanceof Object[] verts) || verts.length != 4) {
                continue;
            }
            String face = faceOfLocal(poly, verts, minX, minY, minZ, maxX, maxY, maxZ);
            if (face == null) {
                continue;
            }
            int[] order = faceRoleOrder(face, minX, minY, minZ, maxX, maxY, maxZ, verts);
            if (order == null) {
                order = new int[]{0, 1, 2, 3};
            }

            float[][] positions = new float[4][3];
            float[][] uvs = new float[4][2];
            for (int i = 0; i < 4; i++) {
                Object vertex = verts[order[i]];
                Object pos = get(vertex, "pos");
                Vector3f p = new Vector3f(num(pos, "x"), num(pos, "y"), num(pos, "z"));
                world.transformPosition(p);
                positions[i] = new float[]{p.x, GROUND_Y - p.y, p.z};
                uvs[i] = new float[]{num(vertex, "u"), num(vertex, "v")};
            }
            if (area(positions) < 1e-6f) {
                continue;   // 零厚度 cube 的退化面 / 被 grow 压扁的面
            }
            if (reverse) {
                float[] p1 = positions[1], p3 = positions[3];
                positions[1] = p3;
                positions[3] = p1;
                float[] u1 = uvs[1], u3 = uvs[3];
                uvs[1] = u3;
                uvs[3] = u1;
            }
            // y 翻转后 up/down 语义互换；只影响诊断标签。
            String flippedFace = switch (face) {
                case "up" -> "down";
                case "down" -> "up";
                default -> face;
            };
            StringBuilder q = new StringBuilder();
            q.append("{\"face\":\"").append(flippedFace)
                    .append("\",\"texture\":\"").append(jsonEscape(textureRef)).append("\",\"positions\":[");
            for (int i = 0; i < 4; i++) {
                if (i > 0) q.append(',');
                q.append(vec(positions[i]));
            }
            q.append("],\"uvs\":[");
            for (int i = 0; i < 4; i++) {
                if (i > 0) q.append(',');
                q.append(uv(uvs[i]));
            }
            q.append("]}");
            quads.add(q.toString());
            quadCount[0]++;
        }
        if (quads.isEmpty()) {
            return null;
        }
        return "{\"index\":" + index + ",\"quads\":[" + String.join(",", quads) + "]}";
    }

    /**
     * 与 baker.js 的 FACE_BASIS 完全一致：从外面看的左上 → 右上 → 右下 → 左下。
     * 这样显式顶点与地形路径的绕序约定相同。
     */
    private static int[] faceRoleOrder(String face, float minX, float minY, float minZ,
                                       float maxX, float maxY, float maxZ, Object[] verts) throws Exception {
        float[][] p = localPositions(verts);
        int uAxis, vAxis, planeAxis;
        int uSign, vSign;
        boolean atMax;
        switch (face) {
            case "up" -> { uAxis = 0; uSign = 1; vAxis = 2; vSign = 1; planeAxis = 1; atMax = true; }
            case "down" -> { uAxis = 0; uSign = 1; vAxis = 2; vSign = -1; planeAxis = 1; atMax = false; }
            case "north" -> { uAxis = 0; uSign = -1; vAxis = 1; vSign = -1; planeAxis = 2; atMax = false; }
            case "south" -> { uAxis = 0; uSign = 1; vAxis = 1; vSign = -1; planeAxis = 2; atMax = true; }
            case "west" -> { uAxis = 2; uSign = 1; vAxis = 1; vSign = -1; planeAxis = 0; atMax = false; }
            case "east" -> { uAxis = 2; uSign = -1; vAxis = 1; vSign = -1; planeAxis = 0; atMax = true; }
            default -> {
                return null;
            }
        }
        float[] lo = {minX, minY, minZ};
        float[] hi = {maxX, maxY, maxZ};
        float u1 = uSign > 0 ? lo[uAxis] : hi[uAxis];
        float u2 = uSign > 0 ? hi[uAxis] : lo[uAxis];
        float v1 = vSign > 0 ? lo[vAxis] : hi[vAxis];
        float v2 = vSign > 0 ? hi[vAxis] : lo[vAxis];
        float plane = atMax ? hi[planeAxis] : lo[planeAxis];
        float[][] roles = {{u1, v1}, {u2, v1}, {u2, v2}, {u1, v2}};

        int[] order = new int[4];
        boolean[] used = new boolean[4];
        for (int r = 0; r < 4; r++) {
            boolean found = false;
            for (int i = 0; i < 4; i++) {
                if (used[i]) {
                    continue;
                }
                if (near(p[i][uAxis], roles[r][0]) && near(p[i][vAxis], roles[r][1])
                        && near(p[i][planeAxis], plane)) {
                    order[r] = i;
                    used[i] = true;
                    found = true;
                    break;
                }
            }
            if (!found) {
                return null;
            }
        }
        return order;
    }

    /**
     * 用 cube 的**局部**包围盒判面（不能加父级平移，否则所有面都会判错）。
     * 零厚度扁片（min==max）的两个大面位置相同，必须用 polygon.normal 的符号区分正反面。
     */
    private static String faceOfLocal(Object poly, Object[] verts, float minX, float minY, float minZ,
                                      float maxX, float maxY, float maxZ) throws Exception {
        float[][] p = localPositions(verts);
        boolean xConst = same(p, 0);
        boolean yConst = same(p, 1);
        boolean zConst = same(p, 2);
        Object normal = get(poly, "normal");
        float nx = num(normal, "x");
        float ny = num(normal, "y");
        float nz = num(normal, "z");
        if (xConst && !yConst && !zConst) {
            if (maxX - minX > EPS) {
                return near(p[0][0], minX) ? "west" : "east";
            }
            return nx >= 0f ? "east" : "west";
        }
        if (yConst && !xConst && !zConst) {
            if (maxY - minY > EPS) {
                return near(p[0][1], minY) ? "down" : "up";
            }
            return ny >= 0f ? "up" : "down";
        }
        if (zConst && !xConst && !yConst) {
            if (maxZ - minZ > EPS) {
                return near(p[0][2], minZ) ? "north" : "south";
            }
            return nz >= 0f ? "south" : "north";
        }
        return null;
    }

    private static float[][] localPositions(Object[] verts) throws Exception {
        float[][] p = new float[4][3];
        for (int i = 0; i < 4; i++) {
            Object pos = get(verts[i], "pos");
            p[i] = new float[]{num(pos, "x"), num(pos, "y"), num(pos, "z")};
        }
        return p;
    }

    /** 打开贴图用于 alpha 采样；调用方负责 close。 */
    private static NativeImage textureImage(Minecraft mc, ResourceLocation texture) {
        if (texture == null) {
            return null;
        }
        try {
            java.util.Optional<Resource> resource = mc.getResourceManager().getResource(texture);
            if (resource.isPresent()) {
                try (InputStream in = resource.get().open()) {
                    return NativeImage.read(in);
                }
            }
        } catch (Exception e) {
            WhatGuysDoing.LOGGER.warn("dump: texture image failed for {}: {}", texture, e.toString());
        }
        return null;
    }

    /** 从 polygon 顶点算 cube 的实际局部包围盒（包含 grow）。 */
    private static float[] cubeBounds(Object[] polys) throws Exception {
        float minX = Float.MAX_VALUE, minY = Float.MAX_VALUE, minZ = Float.MAX_VALUE;
        float maxX = -Float.MAX_VALUE, maxY = -Float.MAX_VALUE, maxZ = -Float.MAX_VALUE;
        boolean any = false;
        for (Object poly : polys) {
            Object vertsObj = get(poly, "vertices");
            if (!(vertsObj instanceof Object[] verts)) {
                continue;
            }
            for (Object vertex : verts) {
                Object pos = get(vertex, "pos");
                float x = num(pos, "x");
                float y = num(pos, "y");
                float z = num(pos, "z");
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                minZ = Math.min(minZ, z);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
                maxZ = Math.max(maxZ, z);
                any = true;
            }
        }
        return any ? new float[]{minX, minY, minZ, maxX, maxY, maxZ} : null;
    }

    private static boolean same(float[][] p, int axis) {
        return Math.abs(p[0][axis] - p[1][axis]) < EPS
                && Math.abs(p[1][axis] - p[2][axis]) < EPS
                && Math.abs(p[2][axis] - p[3][axis]) < EPS;
    }

    private static boolean near(float a, float b) {
        return Math.abs(a - b) < 1e-3f;
    }

    /** 三角形面积（叉积模长）用于剔除零厚度面。 */
    private static float area(float[][] p) {
        float ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = p[1][2] - p[0][2];
        float bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = p[2][2] - p[0][2];
        float cx = ay * bz - az * by;
        float cy = az * bx - ax * bz;
        float cz = ax * by - ay * bx;
        return (float) Math.sqrt(cx * cx + cy * cy + cz * cz);
    }

    private static Matrix4f localMatrix(ModelPart part) throws Exception {
        float x = num(part, "x");
        float y = num(part, "y");
        float z = num(part, "z");
        float xRot = num(part, "xRot");
        float yRot = num(part, "yRot");
        float zRot = num(part, "zRot");
        Matrix4f m = new Matrix4f().translation(x, y, z);
        if (xRot != 0f || yRot != 0f || zRot != 0f) {
            m.rotate(new Quaternionf().rotationZYX(zRot, yRot, xRot));
        }
        m.scale(num(part, "xScale"), num(part, "yScale"), num(part, "zScale"));
        return m;
    }

    /** 用中性参数调用 setupAnim，恢复模型的定义姿态（ModelPart 字段是被就地修改的）。 */
    private static void neutralizePose(EntityModel<?> model, Entity entity) {
        for (Class<?> k = model.getClass(); k != null; k = k.getSuperclass()) {
            for (Method m : k.getDeclaredMethods()) {
                if (!m.getName().equals("setupAnim") || m.getParameterCount() != 6) {
                    continue;
                }
                try {
                    m.setAccessible(true);
                    m.invoke(model, entity, 0f, 0f, 0f, 0f, 0f);
                    return;
                } catch (Exception ignored) {
                    // 试下一个桥接/重载方法
                }
            }
        }
    }

    /** 只认真正的 root（字段或方法）；找不到就返回 null，绝不拿第一个 ModelPart 字段冒充。 */
    private static ModelPart actualRoot(Object model) {
        try {
            Object value = get(model, "root");
            return value instanceof ModelPart part ? part : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static ResourceLocation textureLocationOf(LivingEntityRenderer<?, ?> renderer, Entity entity) {
        for (Class<?> k = renderer.getClass(); k != null; k = k.getSuperclass()) {
            for (Method m : k.getDeclaredMethods()) {
                if (!m.getName().equals("getTextureLocation") || m.getParameterCount() != 1) {
                    continue;
                }
                try {
                    m.setAccessible(true);
                    Object value = m.invoke(renderer, entity);
                    if (value instanceof ResourceLocation rl) {
                        return rl;
                    }
                } catch (Exception ignored) {
                    // 继续找桥接方法
                }
            }
        }
        return null;
    }

    private static boolean bool(Object target, String name, boolean fallback) {
        try {
            Object value = get(target, name);
            return value instanceof Boolean b ? b : fallback;
        } catch (Exception e) {
            return fallback;
        }
    }

    private static String vec(float[] v) {
        return "[" + fmt(v[0]) + "," + fmt(v[1]) + "," + fmt(v[2]) + "]";
    }

    private static String uv(float[] v) {
        return "[" + fmt(v[0]) + "," + fmt(v[1]) + "]";
    }

    private static String fmt(float f) {
        if (Math.abs(f) < 1e-6f) {
            return "0";
        }
        String s = String.format(Locale.ROOT, "%.5f", f);
        s = s.replaceAll("0+$", "").replaceAll("\\.$", "");
        return s.isEmpty() || "-0".equals(s) ? "0" : s;
    }

    private static String jsonEscape(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    /** 反射取值：先试同方法名，再试字段。 */
    private static Object get(Object target, String name) throws Exception {
        Class<?> c = target.getClass();
        try {
            Method m = c.getMethod(name);
            return m.invoke(target);
        } catch (NoSuchMethodException ignored) {
            // fall through
        }
        Field f = findField(c, name);
        if (f == null) {
            throw new NoSuchMethodException(name + " on " + c.getName());
        }
        f.setAccessible(true);
        return f.get(target);
    }

    private static float num(Object target, String name) throws Exception {
        Object value = get(target, name);
        return ((Number) value).floatValue();
    }

    private static Field findField(Class<?> c, String name) {
        for (Class<?> k = c; k != null; k = k.getSuperclass()) {
            try {
                return k.getDeclaredField(name);
            } catch (NoSuchFieldException ignored) {
                // 继续向上
            }
        }
        return null;
    }
}
