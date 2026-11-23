# 双加载器最终成功：静态证据与未关闭入口

## 1．当前结论

**尚未找到并证明一组覆盖 Fabric／NeoForge 全部适用原版实体与四类结果的最终成功采集入口。** 已定位更具体的健康值写入、玩家死亡覆写、实际方块移除及外层放置路径；事件名称、Post注释、回调存在或方法返回成功都不能单独关闭本门。

语义见[验收矩阵](<observation-acceptance.md#L15-L19>)、[ADR-0001](<adr/0001-server-evidenced-interactions.md>)及[术语表](<../GLOSSARY.md>)：只记录正的实际扣血、确认死亡、玩家真实破坏、普通单格放置在外层后处理后的实际在位结果；同次致命结算分别证实的扣血与死亡都记录。来源未知不丢已证结果，事发锚点及当时页范围决定纳入，不按输出时位置、模型能力或1024细实体截断缩小事实分母。

公开策略[ADR-0011](<adr/0011-public-read-only-observation.md>)撤出观察认证，**没有**撤出游戏实体身份、连续活动、真实游戏认证或实验操作许可。R20-Q163–Q165 已确认 enabled 且必要条件就绪的正常服务器启动／重启自动公开（替代 Q154 每次人工开通）、内置端口允许显式对外绑定且不强制回环、无观察认证；远程 WebGPU 仍须同源 HTTPS/WSS 并禁止第三方嵌入。活动页等份轮转，另设一个有限普通公开 HTTP 桶，共用总预算，同页多连接不加份额，全站最多 8 个活动页、满拒新且不踢合格旧页；不作账号／IP／指纹自然人识别，同一人可多页、不扩预算。R21-Q166–Q169 已确认：真故障只停观察、游戏继续；故障消除、相关旧输出／写入已收束且重新就绪后才有限自动重建当前，未知或耗尽保持关闭并提示管理员，不无限重试／补历史，整站次数／时限／资源待工程核定、不套页重连／压力值。单纯超过 5 秒墙钟回拨只告警，新鲜度／等待／重试／保留／峰值沿单调时钟不延寿，真实一致性故障另处理。运营者反向代理负责 HTTPS/WSS 和证书，模组不内置证书管理，代理产品／配置未选；同源／禁止第三方嵌入／无观察认证及 Q164 显式外绑不变。服务开停／故障／概览代次管理仅走控制台和受控配置，无网页／游戏内管理或授权者名单。本稿仍仅文档与只读归档／字节码证据，没有新增构建／运行／测试、游戏启动、监听、联网、故障实验或环境修复；V1A/V1B 保持停止，V2 卡及生产开通未批准，K、完整容量及双加载器事实仍未验证。

## 2．固定输入与证据等级

声明为 Minecraft1.21.1／Java21、Architectury13.0.11、Fabric Loader0.20.0／Fabric API0.116.17+1.21.1、NeoForge21.1.262，来源见[版本目录](<../gradle/libs.versions.toml>)与[构建声明](<../build.gradle#L27-L44>)。坐标不是可信来源、兼容或实际部署证明。

以下归档是本机已实际读取的字节；没有写盘提取，没有推断“缓存即可信”。SHA-256只是内容指纹；NeoForge三份与本机module元数据所声明的SHA-256相等，不能由同地文件互相认证来源。

| 代号与实际输入 | SHA-256 | 能支持／不能支持 |
| --- | --- | --- |
| M：[本机映射合并Minecraft归档](<../.gradle/loom-cache/minecraftMaven/net/minecraft/minecraft-merged-e7795f1124/1.21.1-loom.mappings.1_21_1.layered+hash.40545-v2/minecraft-merged-e7795f1124-1.21.1-loom.mappings.1_21_1.layered+hash.40545-v2.jar>) | `2febd86a59d79ec74b0919daf7471da4765b57a01959249235d6cdaa40d3db3d` | 可定位所读方法字节码；不是任一加载器最终转换／部署类 |
| FE：[Fabric entity-events sources](<../.gradle/loom-cache/remapped_mods/loom_mappings_1_21_1_layered_hash_40545_v2/net/fabricmc/fabric-api/fabric-entity-events-v1/1.8.0+2b27e0a419/fabric-entity-events-v1-1.8.0+2b27e0a419-sources.jar>) | `459947130009df0161ee28ecff95f4e7618110b68c150464d3ec1582ea79d8c1` | 所读适配mixin位置；不证明它实际应用或无后续覆写 |
| FI：[Fabric interaction sources](<../.gradle/loom-cache/remapped_mods/loom_mappings_1_21_1_layered_hash_40545_v2/net/fabricmc/fabric-api/fabric-events-interaction-v0/0.7.14+ba9dae0619/fabric-events-interaction-v0-0.7.14+ba9dae0619-sources.jar>) | `c88102d50019b2388e03152972c88c3cc7908572b1c2593e29373ad46e5b26b6` | 可定位破坏事件注入；不是实际移除结果证明 |
| S：[NeoForge21.1.262 sources](<E:/.gradle/caches/modules-2/files-2.1/net.neoforged/neoforge/21.1.262/f02091f20d68e3df65f9eb78d83a9935eac2c572/neoforge-21.1.262-sources.jar>) | `164f0545e27dd6fd3d5db08140cb918d5cd31741af80fd13c09ee86198264099` | 可读事件／容器／CommonHooks及扩展默认实现 |
| U：[NeoForge21.1.262 userdev](<E:/.gradle/caches/modules-2/files-2.1/net.neoforged/neoforge/21.1.262/b95ecb65e792a2e27a5c81b9220e11bf35a856b/neoforge-21.1.262-userdev.jar>) | `d30f0b5acd70334d2d628f589e0db6977226c9ec2f353cc1165b4efdee62bf3d` | 可读准确补丁和config输入；补丁不等于最终类 |
| N：[NeoForge21.1.262 universal](<E:/.gradle/caches/modules-2/files-2.1/net.neoforged/neoforge/21.1.262/903868be9acc9434edcfcbee7735135275852068/neoforge-21.1.262-universal.jar>) | `4070305f97a08409d9b4e714f619f0ec2d97d29c9939ef43a89d927259942f98` | 文件指纹核对；不能单独证明Minecraft转换及实际事件顺序 |

U内 `config.json:1–23` 指向 NeoForm `1.21.1-20240808.144430`、同版本source／universal；这是转换输入声明，不是完整闭包。FE／FI／M没有独立可信上游摘要认证。Architectury两加载器适配的所读部分为可取消输入入口，不能把统一API名称升格为结果后置合同。早先精确NeoForge网页404／抓取失败保留为失败记录；现在找到本机对应归档，不把过去失败重写成已联网成功。

## 3．扣血：实际写入，不等于管线数值

### 3.1 基类与玩家覆写

M内完整读取的 `LivingEntity.actuallyHurt(DamageSource,float)` 有无敌早退、吸收和零余量分支；偏移125／130分别读健康值、调用setHealth。`Player.actuallyHurt` 自己完成处理，偏移111／116读／写健康值，**没有调用父类actuallyHurt**。因此只接基类方法不足以覆盖玩家。

M内 `LivingEntity.setHealth(float)` 偏移13把值clamp到0..getMaxHealth，19写SynchedEntityData；实际损失须以此结算的已证真实健康前后值为依据，不能照抄hurt输入或最终伤害参数。任意RETURN包括无敌、零余量等无扣血分支；仅采样两个tick健康值无法保证一次结算、来源或夹杂治疗的对应。

### 3.2 Fabric现成AFTER_DAMAGE不足

FE内 `net/fabricmc/fabric/mixin/entity/event/LivingEntityMixin.java:55–100` 的AFTER_DAMAGE在damage TAIL且受 `!isDead()` 守卫；ALLOW_DAMAGE／ALLOW_DEATH是可取消门。这个适配不能直接满足Q75／Q126的“同次致命扣血和死亡都记”，也尚未覆盖所有原版覆写／最终实际写入。方法名称和参数不补足该缺口。

### 3.3 NeoForge Post并非clamp后的实际损失

U内 `Player.java.patch:170–196` 和 `LivingEntity.java.patch:416–438` 在处理后的健康写附近加入Pre／Post；所读Post位置在内层非零实际写分支之外，存在零净结果Post路径，不能因触发Post就记扣血。

S内 `LivingDamageEvent.java:97–134`：Post构造函数110复制 `container.getNewDamage()`，getter130–131仅返回这份值；129注释称“health lost”但实现没有读取健康前后值。S内 `DamageContainer.java:80–95,156–168` 把它作为管线当前值，setReduction会减它。

纸面反例：健康2，管线newDamage5，setHealth clamp到0，实际损失2而非5。此例是所读分支的逻辑检验，不是运行复现；更不能以Post参数证明实际最终扣血。工程应证明准确健康写及结算上下文，含玩家覆写、零结果、额外监听改写和嵌套调用。

## 4．死亡：保护、取消和覆写分开

M内 `LivingEntity.hurt` 偏移656进入isDeadOrDying判断，664核checkTotemDeathProtection，未保护才685调用die；保护路径另setHealth(1)。外层最终健康差值与实际扣血写不同：不能把保命后的健康恢复吞掉已经确证的扣血，也不能因为临时为0就造死亡。

FE内基类AFTER_DEATH在sendEntityStatus附近，而 `net/fabricmc/fabric/mixin/entity/event/ServerPlayerEntityMixin.java:52–76` **另有玩家覆写适配**：73–75在 `onDeath` TAIL调用AFTER_DEATH；不能误称Fabric完全没有玩家死亡后置事件。但准确取消分支、成功前提及所有原版覆写仍未在转换后类／专用服闭合。

U内 `LivingEntity.java.patch:284–288`、`Player.java.patch:86–90` 有CommonHooks.onLivingDeath取消早退；`ServerPlayer.java.patch:28–31` 更在 `gameEvent(ENTITY_DIE)` **之后**才执行取消早退。因此ENTITY_DIE事件本身不是确认死亡证据，TAIL／RETURN也须区分取消与成功路径。

M内 `LivingEntity.die` 的已读分支先拒removed／alreadydead，成功路径100设dead、177设DYING。M内 `ServerPlayer.die` 已完整读0–350，自己发死亡消息／战利品／统计／事件和lastDeathLocation，350返回，未调用父类die；不能仅靠基类成功字段假设覆盖该玩家覆写。最终入口还要把同次实际扣血、保命、取消和死亡分别关联，重复调用不得造重复事实。

## 5．玩家破坏：回调或返回true不足

M内完整 `ServerPlayerGameMode.destroyBlock(BlockPos)`：130调用removeBlock，133保存结果；135–148的destroy与203–205的掉落受实际移除结果守卫，但158–159创意／231–232普通分支仍可能直接true。整个方法返回true不足以证明移除。

FI内 `ServerPlayerInteractionManagerMixin.java:105–119` 的BEFORE为可取消输入，AFTER注入在Block.onBroken前，所读local boolean未作为事件成功条件。不能用AFTER回调名称补移除证据。

U内 `ServerPlayerGameMode.java.patch:47–90`：创意分支53–54忽略removeBlock辅助结果后返回true；普通分支61得结果、63以其控制drop、72仍返回true。86–90的辅助方法调用state.onDestroyedByPlayer，报告真才调用destroy。

S内 `IBlockStateExtension.java:147–148` 转发到实际block实现，`IBlockExtension.java:240–247` 默认专用服调用level.removeBlock；默认契约不排除覆写，不是最终目标位置读回。候选入口必须证明真实玩家、目标位置、移除结果与后处理实际状态；取消、回滚、未改变和mod扩展声明不可混记。

## 6．普通单格放置：必须越过外层处理

M内 `BlockItem.place` 的已读分段包含placeBlock返回检查、偏移101getBlockState／115比类型、171setPlacedBy／194criterion；类型不符路径仍可能到269sidedSuccess／272返回。内层成功、触发criterion或一个早期读回都不是普通放置最终在位状态证明。

U内 `ItemStack.java.patch:35–39` 引入可取消UseItemOnBlockEvent及服务端CommonHooks外层。S内 `CommonHooks.java:594–670`：611–612保存非BucketItem快照，615调用inner useOn；637–640单／多格可取消事件；643–650取消后FAIL并恢复；656–663接受分支再读state后onPlace／markAndNotifyBlock，670返回。其后回调仍可能影响位置，所读代码没有形成完整最终状态再读合同。

因此仅在BlockItem返回插桩会跑在外层取消／恢复／通知之前。候选必须包住实际外层，证明普通单格、取消与后处理后的目标类型／状态；多格、连锁及自定义useOn不能由这个候选扩大承诺。

## 7．连续活动、来源与范围

[当前EntitySnapshot](<../common/src/main/java/github/gtouming/what_guys_doing/world/EntitySnapshot.java#L4-L20>)的netId／health／位置不是连续活动合同。[LevelChunkMixin](<../common/src/main/java/github/gtouming/what_guys_doing/mixin/LevelChunkMixin.java#L19-L24>)在setBlockState HEAD收输入变化，不是玩家破坏／放置最终成功入口；当前状态管线不能冒充事实管线。

[既有本机字节码记录](<observation-design.md#L214-L220>)已示：PlayerList.respawn新建ServerPlayer且复制旧getId；同编号不证明连续活动，重生及重启必须分段。RemovalReason中KILLED／DISCARDED的destroy／save位相同，删除或removed ID不证明死亡。玩家迁移有同对象移除／解除移除／换维度／加入的局部证据，但普通实体迁移及完整加载器条件仍待核定。

事实必须保存结果时的维度／锚点和最小当时可证来源／owner；未知来源独立标识，不能用当前在线索引补旧身份或暴露外侧持续状态。共享采集后由服务端按各页当时范围纳入，不广播并集再隐藏；细实体截断、模型未支持或输出队列满不改变四类事实应覆盖的分母。

## 8．候选矩阵和关闭标准

| 结果 | 现成API不足点 | 待核定采集候选，不是选定实现 | 必须关闭的证据 |
| --- | --- | --- | --- |
| 扣血 | Fabric存活守卫／覆写；NeoForgePost管线值、零结果 | 精确健康写与本次结算上下文，各原版覆写分别追踪 | 正实际损失、取消／全吸收／致命／保命／嵌套；同次死亡不吞扣血 |
| 死亡 | 保护／可取消早退；玩家覆写不调用父类；先发ENTITY_DIE | 成功死亡分支及玩家独立适配、与扣血关联 | 真死亡／取消／保命／重复调用／全部适用类；不以0或移除推死亡 |
| 玩家破坏 | BEFORE／AFTER输入、方法true／辅助reported真不足 | 实际移除和后处理结果／目标／玩家关联 | 创意／生存、未改变／取消／回滚、扩展覆写及去重 |
| 普通单格放置 | 内层成功早于外层可取消快照与通知 | 实际外层结束后合格目标状态及单格范围 | 取消恢复、类型不符、回调改写、无变化、多格不混记 |
| 连续活动 | UUID／netId／removed不代表活动或死亡 | 重生／重启分段，已证迁移和生命周期接入 | 实际对象／活动映射、不可观测出口、编号复用与晚到事实 |

关闭本门需要：可信固定转换链／不可变产物／实际专用服类与入口；两加载器分别覆盖调用、覆写、取消、保护、嵌套和后处理；原版适用实体矩阵；实际动作而非输出消息注入；result-time范围及未知来源测试；采集／字段／工作／队列进入[完整有限容量合同](<observation-production-capacity.md>)；另行批准的V2游戏卡及报告。

不采用“RETURN都算成功”“Post参数就是实际损失”“API名字包含AFTER即最终”“事件出现即死亡”“当前配置声明即准确部署”等快捷结论。缺证据保留待核定，不把未实现或未执行说成通过；不存在观察秘密交付或凭证首次标记前提。

## 9．原版覆写窄项补证：独立伤害写入与终结分支

本节只读第2节的固定 [M](<../.gradle/loom-cache/minecraftMaven/net/minecraft/minecraft-merged-e7795f1124/1.21.1-loom.mappings.1_21_1.layered+hash.40545-v2/minecraft-merged-e7795f1124-1.21.1-loom.mappings.1_21_1.layered+hash.40545-v2.jar>)；本次重算 SHA-256 仍为 `2febd86a59d79ec74b0919daf7471da4765b57a01959249235d6cdaa40d3db3d`。用现有 `E:/Java/21/bin/javap.exe -p -c -s -classpath` 共4批只读命令，未提取／转换类，未复读 FE／FI／S／U／N。第3.1／4节的 `Player.actuallyHurt` 独立写入及 `ServerPlayer.die` 不调父类结论沿用，不重看完整方法。

descriptor 精确缩记：`H=(Lnet/minecraft/world/damagesource/DamageSource;F)Z`；`C=(Lnet/minecraft/server/level/ServerLevel;Lnet/minecraft/world/damagesource/DamageSource;F)V`；`B=(Lnet/minecraft/server/level/ServerLevel;Lnet/minecraft/world/damagesource/DamageSource;)V`；`P=(Lnet/minecraft/world/entity/boss/EnderDragonPart;Lnet/minecraft/world/damagesource/DamageSource;F)Z`；`R=(Lnet/minecraft/world/entity/Entity$RemovalReason;)V`。表内成员路径均以 `net/minecraft/world/entity/` 为前缀、位于 M 内；offset 范围是本次实际显示并读过的完整方法，不是运行覆盖率。

| 归档成员 | 实际已读方法及 offset | 新增分支证据与限制 |
| --- | --- | --- |
| `decoration/ArmorStand.class` | `hurt H` 0–318；`causeDamage C` 0–51；`brokenByPlayer B` 0–41；`brokenByAnything B` 0–146；`kill ()V` 0–14 | 已读 removed／非 ServerLevel／无敌／invisible／marker／伤害标签／玩家 mayBuild／创意／敲击间隔／燃烧分支。`hurt` 45、91、246、287调用独立 `kill`；119／161调用 `causeDamage`。后者18比较后，余量大于0.5才37调用 `setHealth:(F)V`；另一支24掉落处理、28 `kill`，没有该次健康写。首次敲击支297广播、308事件、314写 `lastHit:J` 后318仍返回true，不是扣血。`brokenByPlayer` 38委托 `brokenByAnything`，后者7掉落处理并遍历清空装备，不等于死亡。`kill` 4直接 `remove R`、11事件；这些独立路径没有显式父类 `hurt/actuallyHurt/die` 调用，直接终结支也不调基类 `kill`。 |
| `boss/enderdragon/EnderDragon.class` | `hurt H` 0–22；`hurt P` 0–196；`reallyHurt H` 0–6；`kill ()V` 0–37；`tickDeath ()V` 0–356；另读出向 `hurt (Ljava/util/List;)V` 0–85 | 普通 `hurt` 服务端17委托身体部件重载；重载已读 DYING 拒绝、phase调伤、头／非头缩放、低伤害拒绝、玩家／标签、坐姿分支。93调用 `reallyHurt` 并丢弃结果；不合玩家／标签条件也可195–196返回true。非坐姿死条件分支121 `setHealth(1)`、131设 DYING，暂时0不等于死亡。`reallyHurt` 3直接 `invokespecial Mob.hurt H`，未查 Mob，不冒称完整基类扣血链已证。`kill` 4移除、11事件，fight非空时34通知 `setDragonKilled`。`tickDeath` 22写 `dragonDeathTime:I`；已读计数／粒子／掉落／可空fight分支，200计数且 ServerLevel 支才到339可选fight通知、346移除、353事件。此二方法无显式 `die` 调用；通知、计时及方法名不证明死亡提交。出向辅助49调用目标 `Entity.hurt H` 并丢弃结果，也不证明目标成功事实。 |
| `LivingEntity.class` | 仅 `kill ()V` 0–15、`remove R` 0–31 | 基类 `kill` 11以 genericKill／最大float动态调用 `hurt H`，与上述直接移除的两个覆写不同。`remove` 对 KILLED 和 DISCARDED 都在16调用 `triggerOnDeathMobEffects R`，21委托 `Entity.remove R`，28清记忆；未取得底层移除字段写，reason／effects名称不补确认死亡。 |
| `monster/Slime.class` | 仅 `remove R` 0–241 | 客户端／size不大于1／不满足 `isDeadOrDying` 均跳236；分裂支122创建、132处理null、226请求加入子体并丢弃boolean，238再 `invokespecial Mob.remove R`。分裂守卫未检查 removal reason；分裂、创建请求及返回不是父体死亡提交，也未证明完整父移除链。 |
| `boss/EnderDragonPart.class` | 仅 `hurt H` 0–20及类声明 | 实际路径是 `boss/EnderDragonPart.class`，不是 `boss/enderdragon/EnderDragonPart.class`。声明直接继承 `Entity`；2／5无敌判断，未拒绝时11读 `parentMob`、17把部件／来源／伤害转交 `EnderDragon.hurt P`。所读方法无部件自身健康／死亡写，不能按部件复制父龙事实，更不能因此声称所有非 LivingEntity 对象已覆盖。 |

- **扣血候选**：`ArmorStand.causeDamage C` 的37健康写调用，可关联本次来源及真实写前／写后值，正差才记；其119／161外层委托支最终返回false，不能用 `hurt` 返回值过滤。终结支无这次健康写，不能凭 `kill` 虚构健康清零。基类／玩家仍按第3.1节；龙93父委托与121恢复须分开关联，尚未证明统一入口。
- **死亡候选与缺口**：ArmorStand／龙独立 `kill`、龙 `tickDeath` 的终结分支，需要补因果终结对应的底层状态提交、此前未终结、取消／保护／后续改写与去重。本次仅得准确调用位置，不以 `remove(KILLED)`、health0、DYING、掉落、事件或 RETURN 确认死亡；Slime分裂只增加生命周期关联注意项。
- **不适用类别**：本窄项不提供玩家方块破坏／普通单格放置入口；玩家打碎 ArmorStand 是实体路径，不是破坏方块。Part受击是父龙结算入口，不是已证独立部件扣血／死亡。未读对象的四事实适用性仍待矩阵确认，不以 LivingEntity 类型边界缩小既定分母。

本次共读5类上述方法，不扩读 Mob、Entity、phase／fight实现或其余原版类。两加载器补丁／mixin／最终转换、龙完整延后死亡链、移除真实提交和全原版适用矩阵仍缺证据。这里只补独立覆写及一个可定位健康写候选，**第8节原门仍未关闭**；不改变 R21-Q166–Q169、游戏／验证许可或生产门。

## 10．Mob／Entity 生命周期补证与候选接入表

本节只补固定 [M](<../.gradle/loom-cache/minecraftMaven/net/minecraft/minecraft-merged-e7795f1124/1.21.1-loom.mappings.1_21_1.layered+hash.40545-v2/minecraft-merged-e7795f1124-1.21.1-loom.mappings.1_21_1.layered+hash.40545-v2.jar>) 的两类必要成员；3批 `E:/Java/21/bin/javap.exe -p -c -s -classpath M` 在实际 Bash 中按成员筛选标准输出，未提取写盘。本次重算 M 的 SHA-256 与第2节相同；没有重读已证伤害／死亡体、§9五类或方块路径。
- **Mob**：类声明直接继承 `LivingEntity`；仅此类成员未声明 `hurt H`／`remove R`。因此 M 内§9的相关符号引用须沿已知父类查找，可接§3／4／9既有父成员证据；不假定转换后仍未声明或无改写。
- **Entity 首次提交**：`remove R` 的2调用 `setRemoved R`；后者4检查字段，非null跳12，仅null时9写 `removalReason:Lnet/minecraft/world/entity/Entity$RemovalReason;`。`isRemoved()Z` 仅判断该字段非null；`getRemovalReason()Lnet/minecraft/world/entity/Entity$RemovalReason;` 直接返回字段。
- **重复／取消边界**：`setRemoved R` 的16按保留字段执行 `shouldDestroy()Z`，23可调用 `stopRiding()V`，35遍历乘客；45调用 `EntityInLevelCallback.onRemove R` 却传本次参数。重复调用保留旧reason仍通知，参数可与字段不同；本体无显式取消门，但字段提交早于回调，不证明外层完成或后续不撤销。
- **解除／名称核对**：`unsetRemoved()V` 的2清空该字段；`Entity` 未声明 `onRemoval`，实际另有 `onClientRemoval()V` 且仅0返回，不是成功提交。出向 `levelCallback.onRemove R` 的实现未扩读。清null、KILLED字段、回调次数均不能单独证明活动重开或语义死亡。

descriptor：`H/C/R` 沿§9；`A=(Lnet/minecraft/world/damagesource/DamageSource;F)V`；`D=(Lnet/minecraft/world/damagesource/DamageSource;)V`；`G=(Lnet/minecraft/core/BlockPos;)Z`。`setHealth` 为 `(F)V`，`kill/tickDeath/unsetRemoved` 为 `()V`。
表内实体类路径沿§9及既有成员：`LivingEntity/Entity/Mob` 在 `net.minecraft.world.entity`，`Player` 在其 `player` 包；`ServerPlayer/ServerPlayerGameMode` 在 `net.minecraft.server.level`。以下最小取值、关联与适配均是候选结构，不是已实现合同。

| 事实／活动 | 已静态定位的成员／descriptor | 提交前后最小值与外层关联（建议） | 两加载器须适配的层（未证最终转换） |
| --- | --- | --- | --- |
| 正实际扣血 | `LivingEntity/Player.actuallyHurt A`→`LivingEntity.setHealth(F)V`；`ArmorStand.causeDamage C` 的37（§3／9） | 同次结算键、来源、锚点；每次伤害写前→写后的真实健康，正差才暂存。不得用hurt布尔或Post值过滤；保命恢复不吞已证扣血，嵌套分开关联。 | Fabric精确写入及覆写mixin层；NeoForge补丁后实际写入层并关联外层取消；不能仅接基类或现成AFTER／Post。 |
| 确认死亡 | `LivingEntity.die D` 的100写dead；`ServerPlayer.die D` 独立体；§9 `ArmorStand.kill()V`、`EnderDragon.kill()/tickDeath()V`→`Entity.setRemoved R` | 活动／结算键、基类dead前后或独立成功分支标记；特殊终结请求关联首次移除提交及外层取消／保护／后改写，每活动去重。后两类不能由reason反推死亡。 | Fabric分别接基类、玩家和独立终结体；NeoForge分别越过对应取消门再确认。玩家成功标记是待实现控制流标记，不是已证通用字段。 |
| 玩家真实破坏 | `ServerPlayerGameMode.destroyBlock G` 的实际移除分支及§5后处理 | 玩家、维度／pos、原状态、真实移除结果及外层后处理状态；绑定同次动作，排除未改变／取消／回滚，不按方法true计数。 | Fabric须越过输入事件核真实移除；NeoForge适配§5辅助移除／扩展覆写及外层后处理，reported真不代替读回。 |
| 普通单格放置 | §6 `BlockItem.place` 与服务端 `ItemStack`／`CommonHooks` 外层；外层精确descriptor未由本轮复核 | 玩家、维度／pos、原状态、目标单格及终态；关联取消恢复、通知／后处理完成后的实际在位结果，拒绝内层成功或多格代替。 | Fabric需包住真实使用外层；NeoForge需越过§6快照／取消恢复／通知外层；不得统一在BlockItem RETURN提交。 |
| 连续活动 | `Entity.setRemoved R` 的9、`unsetRemoved()V` 的2，以及上述reason读取 | 实例关联键／活动代次、维度、旧→新reason；首次提交暂记出口，须关联实际退出。清null须与实际加入关联；重生／重启分段，迁移不凭同netId猜接续。 | 两加载器分别接实际退出／加入、迁移／重生外层；去重看字段边沿及活动键，不按回调次数；同对象解除移除不自动新开活动。 |

建议共享层仅接适配器已证结果：用实例绑定的活动键和结算键有限暂存，外层确认依真实分支而非笼统RETURN；扣血／死亡分别证实、分别提交并关联同次结算。结果时维度／锚点、最小来源／owner及未知来源沿§7，不用当前索引补旧身份；容量仍受§8既有合同约束。
本节区分已静态定位的字段提交、建议实现结构、尚未证明的最终转换；首次移除只是生命周期证据，不把它升级为统一死亡入口。每加载器真实动作验收及全原版适用矩阵仍未完成，第8节原门未关闭；Q162–Q169不变，未新增构建／测试／游戏／监听／联网或环境修复。
