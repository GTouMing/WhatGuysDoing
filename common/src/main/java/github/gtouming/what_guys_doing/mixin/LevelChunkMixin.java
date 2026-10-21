package github.gtouming.what_guys_doing.mixin;

import github.gtouming.what_guys_doing.world.BlockDeltaCollector;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.LevelChunk;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * 捕获逐方块变更。仅在服务器线程、且该 section 已被某个观看会话持有时记录，
 * 因此世界生成与区块加载的批量写入不会进入增量流。
 */
@Mixin(LevelChunk.class)
public abstract class LevelChunkMixin {

    @Inject(
            method = "setBlockState(Lnet/minecraft/core/BlockPos;Lnet/minecraft/world/level/block/state/BlockState;Z)Lnet/minecraft/world/level/block/state/BlockState;",
            at = @At("HEAD"))
    private void wgd$recordBlockChange(BlockPos pos, BlockState state, boolean isMoving,
                                       CallbackInfoReturnable<BlockState> cir) {
        BlockDeltaCollector.record(((LevelChunk) (Object) this).getLevel(), pos, state);
    }
}
