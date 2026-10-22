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
    /** 与 tools/build-entity-bundle.mjs 的 CAT_VARIANTS 保持同序。 */
    private static final java.util.List<String> CAT_VARIANTS = java.util.List.of(
            "tabby", "black", "red", "siamese", "british_shorthair",
            "calico", "persian", "ragdoll", "white", "jellie", "all_black");
    /** 与 tools/build-entity-bundle.mjs 的 WOLF_VARIANTS 同序；每变体 wild/tame/angry 三态。 */
    private static final java.util.List<String> WOLF_VARIANTS = java.util.List.of(
            "pale", "ashen", "black", "chestnut", "rusty",
            "snowy", "spotted", "striped", "woods");
    /** 与 tools/build-entity-bundle.mjs 的 HORSE_VARIANTS 同序（Horse.Variant ordinal）。 */
    private static final java.util.List<String> HORSE_VARIANTS = java.util.List.of(
            "white", "creamy", "chestnut", "brown", "black", "gray", "darkbrown");
    /** 与 tools/build-entity-bundle.mjs 的 PARROT_VARIANTS 同序（Parrot.Variant ordinal）。 */
    private static final java.util.List<String> PARROT_VARIANTS = java.util.List.of(
            "red_blue", "blue", "green", "yellow_blue", "gray");
    private static final java.util.List<String> VILLAGER_TYPES = java.util.List.of(
            "desert", "jungle", "plains", "savanna", "snow", "swamp", "taiga");
    private static final java.util.List<String> VILLAGER_PROFESSIONS = java.util.List.of(
            "armorer", "butcher", "cartographer", "cleric", "farmer", "fisherman", "fletcher",
            "leatherworker", "librarian", "mason", "nitwit", "shepherd", "toolsmith", "weaponsmith");


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
        if (entity instanceof net.minecraft.world.entity.TamableAnimal tame && tame.isTame()) {
            flags |= EntitySnapshot.FLAG_TAME;
        }
        if (entity instanceof net.minecraft.world.entity.animal.Sheep sheep && sheep.isSheared()) {
            flags |= EntitySnapshot.FLAG_SHEARED;
        }
        if (entity instanceof net.minecraft.world.entity.animal.Wolf wolf && wolf.isAngry()) {
            flags |= EntitySnapshot.FLAG_ANGRY;
        }
        if (entity instanceof net.minecraft.world.entity.animal.horse.AbstractHorse horse && horse.isSaddled()) {
            flags |= EntitySnapshot.FLAG_SADDLED;
        }
        if (entity.getPose() == net.minecraft.world.entity.Pose.SLEEPING) {
            flags |= EntitySnapshot.FLAG_SLEEPING;
        }
        if (entity instanceof LivingEntity living && living.isBaby()) {
            flags |= EntitySnapshot.FLAG_BABY;
        }
        if (entity instanceof net.minecraft.world.entity.TamableAnimal tame && tame.isInSittingPose()) {
            flags |= EntitySnapshot.FLAG_SITTING;
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
        // variantBits：低 4 位先给羊色（DyeColor id）；其他家族后续再分配。
        // 肢体摆动用原版 walkAnimation.speed()（0..1）；渲染侧按 0..255 推相位和幅度。
        // 旧值用水平速度 * 64，数值偏小，腿几乎不动。
        int limbSwing = 0;
        int swingProgress = 0;
        int variantBits = 0;
        if (entity instanceof LivingEntity living) {
            limbSwing = Math.clamp(
                    Math.round(living.walkAnimation.speed() * 255.0f), 0, 255);
            swingProgress = Math.clamp(Math.round(living.getAttackAnim(1.0f) * 255.0), 0, 255);
        }
        // 家族变体位：低 4 位先给羊色（DyeColor id）；其他家族后续再分配。
        if (entity instanceof net.minecraft.world.entity.animal.Sheep sheep) {
            variantBits = sheep.getColor().getId() & 15;
        } else if (entity instanceof net.minecraft.world.entity.animal.Wolf wolf) {
            int collar = wolf.getCollarColor().getId() & 15;
            String variant = wolf.getVariant().unwrapKey()
                    .map(key -> key.location().getPath()).orElse("");
            int vi = WOLF_VARIANTS.indexOf(variant);
            if (vi < 0) vi = 0;
            variantBits = (collar << 4) | ((vi & 15) << 16);
        } else if (entity instanceof net.minecraft.world.entity.animal.Cat cat) {
            int collar = cat.getCollarColor().getId() & 15;
            String variant = cat.getVariant().unwrapKey()
                    .map(key -> key.location().getPath()).orElse("");
            int vi = CAT_VARIANTS.indexOf(variant);
            if (vi < 0) vi = 0;
            variantBits = (collar << 8) | ((vi & 15) << 12);
        } else if (entity instanceof net.minecraft.world.entity.animal.horse.Horse horse) {
            int markings = horse.getMarkings().ordinal() & 15;
            variantBits = ((horse.getVariant().ordinal() & 15) << 20) | (markings << 28);
            if (horse.isSaddled()) variantBits |= 1 << 24;
            var bodyArmor = horse.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.BODY);
            int material = 0;
            if (bodyArmor.is(net.minecraft.world.item.Items.LEATHER_HORSE_ARMOR)) material = 1;
            else if (bodyArmor.is(net.minecraft.world.item.Items.IRON_HORSE_ARMOR)) material = 3;
            else if (bodyArmor.is(net.minecraft.world.item.Items.GOLDEN_HORSE_ARMOR)) material = 4;
            else if (bodyArmor.is(net.minecraft.world.item.Items.DIAMOND_HORSE_ARMOR)) material = 5;
            variantBits |= (material & 7) << 25;
        } else if (entity instanceof net.minecraft.world.entity.animal.Parrot parrot) {
            variantBits = (parrot.getVariant().ordinal() & 15) << 24;
        } else if (entity instanceof net.minecraft.world.entity.npc.Villager villager) {
            var data = villager.getVillagerData();
            String profession = net.minecraft.core.registries.BuiltInRegistries.VILLAGER_PROFESSION
                    .getKey(data.getProfession()).getPath();
            String type = net.minecraft.core.registries.BuiltInRegistries.VILLAGER_TYPE
                    .getKey(data.getType()).getPath();
            int pi = VILLAGER_PROFESSIONS.indexOf(profession) + 1;
            int ti = VILLAGER_TYPES.indexOf(type) + 1;
            int level = Math.max(1, Math.min(5, data.getLevel()));
            variantBits = (pi & 31) | ((ti & 7) << 5) | ((level & 7) << 8);
        } else if (entity instanceof net.minecraft.world.entity.monster.ZombieVillager villager) {
            var data = villager.getVillagerData();
            String profession = net.minecraft.core.registries.BuiltInRegistries.VILLAGER_PROFESSION
                    .getKey(data.getProfession()).getPath();
            String type = net.minecraft.core.registries.BuiltInRegistries.VILLAGER_TYPE
                    .getKey(data.getType()).getPath();
            int pi = VILLAGER_PROFESSIONS.indexOf(profession) + 1;
            int ti = VILLAGER_TYPES.indexOf(type) + 1;
            int level = Math.max(1, Math.min(5, data.getLevel()));
            variantBits = (pi & 31) | ((ti & 7) << 5) | ((level & 7) << 8);
        } else if (entity instanceof net.minecraft.world.entity.animal.Fox fox) {
            variantBits = fox.getVariant().ordinal() & 15;
        } else if (entity instanceof net.minecraft.world.entity.animal.MushroomCow cow) {
            variantBits = cow.getVariant().ordinal() & 15;
        } else if (entity instanceof net.minecraft.world.entity.animal.Rabbit rabbit) {
            if (rabbit.hasCustomName() && "Toast".equals(rabbit.getCustomName().getString())) {
                variantBits = 7;
            } else {
                variantBits = rabbit.getVariant().ordinal() & 15;
            }
        } else if (entity instanceof net.minecraft.world.entity.animal.horse.Llama llama) {
            int body = llama.getVariant().ordinal() & 15;
            int swag;
            if (entity instanceof net.minecraft.world.entity.animal.horse.TraderLlama) {
                swag = 17;
            } else {
                var color = llama.getSwag();
                swag = color == null ? 0 : color.getId() + 1;
            }
            variantBits = (body & 15) | ((swag & 31) << 4);
        } else if (entity instanceof net.minecraft.world.entity.animal.axolotl.Axolotl axolotl) {
            variantBits = axolotl.getVariant().ordinal() & 15;
        } else if (entity instanceof net.minecraft.world.entity.animal.Panda panda) {
            variantBits = panda.getVariant().ordinal() & 15;
        } else if (entity instanceof net.minecraft.world.entity.monster.Shulker shulker) {
            variantBits = shulker.getColor().getId() & 15;
        } else if (entity instanceof net.minecraft.world.entity.animal.frog.Frog frog) {
            String variant = frog.getVariant().unwrapKey()
                    .map(key -> key.location().getPath()).orElse("temperate");
            variantBits = switch (variant) {
                case "warm" -> 1;
                case "cold" -> 2;
                default -> 0;
            };
        } else if (entity instanceof net.minecraft.world.entity.animal.TropicalFish fish) {
            var pattern = fish.getVariant();
            int shape = "b".equals(pattern.base()) ? 1 : 0;
            int patternIndex = pattern.ordinal() % 6;
            int base = fish.getBaseColor().getId() & 15;
            int patternColor = fish.getPatternColor().getId() & 15;
            variantBits = (shape << 12) | (patternColor << 8) | (base << 4) | patternIndex;
        }
        boolean nameVisible = entity.hasCustomName() && entity.isCustomNameVisible();
        String name = entity.hasCustomName() ? entity.getCustomName().getString() : null;
        java.util.UUID uuid = entity instanceof Player player ? player.getUUID() : null;
        float bodyYaw = entity instanceof LivingEntity living ? living.yBodyRot : entity.getYRot();

        int equipment = 0;
        int leatherHead = 0;
        int leatherChest = 0;
        int leatherLegs = 0;
        int leatherFeet = 0;
        if (entity instanceof LivingEntity wearer) {
            equipment = (armorMaterial(wearer.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.HEAD)) & 15)
                    | ((armorMaterial(wearer.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.CHEST)) & 15) << 4)
                    | ((armorMaterial(wearer.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.LEGS)) & 15) << 8)
                    | ((armorMaterial(wearer.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.FEET)) & 15) << 12);
            leatherHead = leatherColor(wearer.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.HEAD));
            leatherChest = leatherColor(wearer.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.CHEST));
            leatherLegs = leatherColor(wearer.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.LEGS));
            leatherFeet = leatherColor(wearer.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.FEET));
        }

        return new EntitySnapshot(dimId, entity.getId(), BuiltInRegistries.ENTITY_TYPE.getId(entity.getType()),
                pos.x, pos.y, pos.z, motion.x, motion.y, motion.z,
                bodyYaw, entity.getXRot(), entity.getYHeadRot(),
                flags, entity.getPose().ordinal(), vehicle == null ? -1 : vehicle.getId(),
                health, itemId, selectedSlot, gameMode,
                variantBits, equipment, leatherHead, leatherChest, leatherLegs, leatherFeet,
                limbSwing, swingProgress, nameVisible, name, uuid);
    }

    private static int leatherColor(net.minecraft.world.item.ItemStack stack) {
        if (!isLeatherArmor(stack)) return 0;
        var dye = stack.get(net.minecraft.core.component.DataComponents.DYED_COLOR);
        int rgb = dye == null ? 0xA06540 : dye.rgb() & 0xFFFFFF;
        return rgb | 0x1000000; // sentinel：黑色 (0x000000) 也有效
    }

    private static boolean isLeatherArmor(net.minecraft.world.item.ItemStack stack) {
        return stack.is(net.minecraft.world.item.Items.LEATHER_HELMET)
                || stack.is(net.minecraft.world.item.Items.LEATHER_CHESTPLATE)
                || stack.is(net.minecraft.world.item.Items.LEATHER_LEGGINGS)
                || stack.is(net.minecraft.world.item.Items.LEATHER_BOOTS);
    }

    /** 与 bundle 的 ARMOR_MATERIALS 同序；turtle_scute 只有头盔。 */
    private static int armorMaterial(net.minecraft.world.item.ItemStack stack) {
        if (stack.isEmpty()) return 0;
        var item = stack.getItem();
        if (item == net.minecraft.world.item.Items.LEATHER_HELMET
                || item == net.minecraft.world.item.Items.LEATHER_CHESTPLATE
                || item == net.minecraft.world.item.Items.LEATHER_LEGGINGS
                || item == net.minecraft.world.item.Items.LEATHER_BOOTS) return 1;
        if (item == net.minecraft.world.item.Items.CHAINMAIL_HELMET
                || item == net.minecraft.world.item.Items.CHAINMAIL_CHESTPLATE
                || item == net.minecraft.world.item.Items.CHAINMAIL_LEGGINGS
                || item == net.minecraft.world.item.Items.CHAINMAIL_BOOTS) return 2;
        if (item == net.minecraft.world.item.Items.IRON_HELMET
                || item == net.minecraft.world.item.Items.IRON_CHESTPLATE
                || item == net.minecraft.world.item.Items.IRON_LEGGINGS
                || item == net.minecraft.world.item.Items.IRON_BOOTS) return 3;
        if (item == net.minecraft.world.item.Items.GOLDEN_HELMET
                || item == net.minecraft.world.item.Items.GOLDEN_CHESTPLATE
                || item == net.minecraft.world.item.Items.GOLDEN_LEGGINGS
                || item == net.minecraft.world.item.Items.GOLDEN_BOOTS) return 4;
        if (item == net.minecraft.world.item.Items.DIAMOND_HELMET
                || item == net.minecraft.world.item.Items.DIAMOND_CHESTPLATE
                || item == net.minecraft.world.item.Items.DIAMOND_LEGGINGS
                || item == net.minecraft.world.item.Items.DIAMOND_BOOTS) return 5;
        if (item == net.minecraft.world.item.Items.NETHERITE_HELMET
                || item == net.minecraft.world.item.Items.NETHERITE_CHESTPLATE
                || item == net.minecraft.world.item.Items.NETHERITE_LEGGINGS
                || item == net.minecraft.world.item.Items.NETHERITE_BOOTS) return 6;
        if (item == net.minecraft.world.item.Items.TURTLE_HELMET) return 7;
        if (item == net.minecraft.world.item.Items.ELYTRA) return 8;
        return 0;
    }
}
