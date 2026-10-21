package github.gtouming.what_guys_doing.world;

import github.gtouming.what_guys_doing.core.DimTable;
import net.minecraft.core.Holder;
import net.minecraft.core.SectionPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.LightLayer;
import net.minecraft.world.level.biome.Biome;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.DataLayer;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.chunk.LevelChunkSection;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;

/** 服务器线程上的取样：把 MC 对象转成可跨线程传递的纯数据快照。 */
public final class WorldSampler {

    /** 某维度需要采样的区块范围（会话订阅的并集）。 */
    public record DimArea(int dimId, int minCx, int minCz, int maxCx, int maxCz) {
    }

    private WorldSampler() {
    }

    /**
     * 构建单个 section 的快照。返回 null 表示该 section 全空气，无需发送。
     * 必须在服务器线程调用（读取区块数据）。
     */
    public static SectionSnapshot buildSection(ServerLevel level, int dimId, LevelChunk chunk, int sectionIndex) {
        LevelChunkSection[] sections = chunk.getSections();
        if (sectionIndex < 0 || sectionIndex >= sections.length) {
            return null;
        }
        LevelChunkSection section = sections[sectionIndex];
        if (section == null || section.hasOnlyAir()) {
            return null;
        }

        int[] palette = new int[256];
        int paletteSize = 0;
        int[] local = new int[SectionSnapshot.BLOCKS];
        // 以 BlockState 实例为键去重：注册表 id 只在遇到新状态时查一次，避免 4096 次查询与装箱
        HashMap<BlockState, Integer> seen = new HashMap<>(64);
        for (int i = 0; i < SectionSnapshot.BLOCKS; i++) {
            int x = i & 15;
            int z = (i >> 4) & 15;
            int y = (i >> 8) & 15;
            BlockState state = section.getBlockState(x, y, z);
            Integer slot = seen.get(state);
            if (slot == null) {
                slot = paletteSize;
                seen.put(state, slot);
                if (paletteSize == palette.length) {
                    palette = Arrays.copyOf(palette, paletteSize * 2);
                }
                palette[paletteSize++] = Block.BLOCK_STATE_REGISTRY.getId(state);
            }
            local[i] = slot;
        }
        if (paletteSize == 0) {
            return null;
        }

        int bits = paletteSize <= 1 ? 0 : Math.max(1, 32 - Integer.numberOfLeadingZeros(paletteSize - 1));
        byte[] indices = new byte[bits == 0 ? 0 : (SectionSnapshot.BLOCKS * bits + 7) / 8];
        if (bits > 0) {
            for (int i = 0; i < SectionSnapshot.BLOCKS; i++) {
                int value = local[i];
                int base = i * bits;
                for (int b = 0; b < bits; b++) {
                    if (((value >>> b) & 1) != 0) {
                        int p = base + b;
                        indices[p >> 3] |= (byte) (1 << (p & 7));
                    }
                }
            }
        }

        byte[] blockLight = new byte[SectionSnapshot.LIGHT_BYTES];
        byte[] skyLight = new byte[SectionSnapshot.LIGHT_BYTES];
        // 整段读取光照：一次拿到整个 section 的 DataLayer，避免逐方块走光照引擎查询
        int sectionY = (level.getMinBuildHeight() >> 4) + sectionIndex;
        SectionPos sectionPos = SectionPos.of(chunk.getPos().x, sectionY, chunk.getPos().z);
        DataLayer blockData = level.getLightEngine().getLayerListener(LightLayer.BLOCK).getDataLayerData(sectionPos);
        DataLayer skyData = level.getLightEngine().getLayerListener(LightLayer.SKY).getDataLayerData(sectionPos);
        // 注意：**不能**因为两个层都为 null 就跳过循环 —— 露天 section 恰恰是「天空全 15 + 方块光全 0」，
        // 两个层都为 null；跳过会让整段光照保持全 0（表现为画面纯黑）。层为 null 时用该层的均匀值。
        for (int i = 0; i < SectionSnapshot.BLOCKS; i++) {
                int x = i & 15;
                int z = (i >> 4) & 15;
                int y = (i >> 8) & 15;
                // vanilla 对「整层均匀」的 section 会让 getDataLayerData 返回 null —— 露天 section 的
                // 天空光层恰恰全是 15，之前把 null 当成 0，导致露天处天空光全 0、画面纯黑。
                // 约定：天空层 null → 15，方块光层 null → 0。
                // 注意（已知局限）：纯黑的地下 section 若同样返回 null，会被高估成 15；
                // 后续可改为「null 时用光照引擎取一次该 section 的代表值」来兼顾。
                int bl = blockData == null ? 0 : blockData.get(x, y, z);
                int sl = skyData == null ? 15 : skyData.get(x, y, z);
                if (bl > 0) {
                    blockLight[i >> 1] |= (byte) ((i & 1) == 0 ? bl : (bl << 4));
                }
                if (sl > 0) {
                    skyLight[i >> 1] |= (byte) ((i & 1) == 0 ? sl : (sl << 4));
                }
            }

        Holder<Biome> biome = section.getNoiseBiome(0, 0, 0);
        int biomeId = level.registryAccess().registryOrThrow(Registries.BIOME).getId(biome.value());
        int[] biomes = new int[SectionSnapshot.BIOME_COLUMNS];
        Arrays.fill(biomes, biomeId);

        return new SectionSnapshot(dimId,
                chunk.getPos().x, (level.getMinBuildHeight() >> 4) + sectionIndex, chunk.getPos().z,
                Arrays.copyOf(palette, paletteSize), bits, indices, blockLight, skyLight, biomes);
    }

    /** 采样给定范围内所有实体（服务器线程）。 */
    public static EntitySnapshot[] sampleEntities(MinecraftServer server, DimTable dims, List<DimArea> areas, int maxEntities) {
        if (areas.isEmpty() || maxEntities <= 0) {
            return new EntitySnapshot[0];
        }
        List<EntitySnapshot> out = new ArrayList<>(Math.min(256, maxEntities));
        for (DimArea area : areas) {
            ResourceKey<Level> key = dims.keyOrNull(area.dimId());
            if (key == null) {
                continue;
            }
            ServerLevel level = server.getLevel(key);
            if (level == null) {
                continue;
            }
            AABB box = new AABB(
                    area.minCx() << 4, level.getMinBuildHeight(), area.minCz() << 4,
                    (area.maxCx() << 4) + 16, level.getMaxBuildHeight(), (area.maxCz() << 4) + 16);
            for (Entity entity : level.getEntitiesOfClass(Entity.class, box)) {
                out.add(snapshot(area.dimId(), entity));
                if (out.size() >= maxEntities) {
                    return out.toArray(new EntitySnapshot[0]);
                }
            }
        }
        return out.toArray(new EntitySnapshot[0]);
    }

    private static EntitySnapshot snapshot(int dimId, Entity entity) {
        Vec3 pos = entity.position();
        Vec3 motion = entity.getDeltaMovement();
        int flags = 0;
        if (entity.isCrouching()) {
            flags |= EntitySnapshot.FLAG_CROUCHING;
        }
        if (entity.isSprinting()) {
            flags |= EntitySnapshot.FLAG_SPRINTING;
        }
        if (entity.isSwimming()) {
            flags |= EntitySnapshot.FLAG_SWIMMING;
        }
        if (entity.isPassenger()) {
            flags |= EntitySnapshot.FLAG_PASSENGER;
        }
        if (entity.isOnFire()) {
            flags |= EntitySnapshot.FLAG_ON_FIRE;
        }
        if (entity instanceof LivingEntity flyer && flyer.isFallFlying()) {
            flags |= EntitySnapshot.FLAG_FALL_FLYING;
        }
        if (entity instanceof LivingEntity living) {
            if (living.isUsingItem()) {
                flags |= EntitySnapshot.FLAG_USING_ITEM;
            }
        }
        if (entity instanceof Player player && player.swinging) {
            flags |= EntitySnapshot.FLAG_SWINGING;
        }

        Entity vehicle = entity.getVehicle();
        float health = entity instanceof LivingEntity livingEntity ? livingEntity.getHealth() : 0.0f;
        int itemId = entity instanceof LivingEntity holder
                ? BuiltInRegistries.ITEM.getId(holder.getMainHandItem().getItem()) : 0;
        int selectedSlot = 0;
        int gameMode = 0;
        if (entity instanceof ServerPlayer serverPlayer) {
            selectedSlot = serverPlayer.getInventory().selected;
            gameMode = serverPlayer.gameMode.getGameModeForPlayer().ordinal();
        }

        // ---- 协议 v2 ----
        // variantBits 暂置 0：各家族（羊色/马型/史莱姆大小…）的位布局要集中定义后再填，见 m2-m4 §3.2。
        // 肢体摆动用"水平速度"做代理值（渲染侧只拿它推相位，足够）；挥手进度取原版攻击动画。
        int limbSwing = 0;
        int swingProgress = 0;
        if (entity instanceof LivingEntity living) {
            limbSwing = Math.clamp(
                    Math.round(entity.getDeltaMovement().horizontalDistance() * 64.0), 0, 255);
            swingProgress = Math.clamp(Math.round(living.getAttackAnim(1.0f) * 255.0), 0, 255);
        }
        boolean nameVisible = entity.hasCustomName() && entity.isCustomNameVisible();
        String name = entity.hasCustomName() ? entity.getCustomName().getString() : null;
        java.util.UUID uuid = entity instanceof Player player ? player.getUUID() : null;

        return new EntitySnapshot(dimId, entity.getId(), BuiltInRegistries.ENTITY_TYPE.getId(entity.getType()),
                pos.x, pos.y, pos.z, motion.x, motion.y, motion.z,
                entity.getYRot(), entity.getXRot(), entity.getYHeadRot(),
                flags, entity.getPose().ordinal(), vehicle == null ? -1 : vehicle.getId(),
                health, itemId, selectedSlot, gameMode,
                0, limbSwing, swingProgress, nameVisible, name, uuid);
    }
}
