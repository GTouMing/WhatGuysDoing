# 公开观察：有限生产与容量证据

## 1．结论和范围

现行政策见[公开访问合同](<observation-public-access.md>)与[ADR-0011](<adr/0011-public-read-only-observation.md>)：不建立观察者认证、登录、秘密交付或授权存储。R20-Q163–Q165 已确认：enabled 且必要条件就绪时正常服务器启动自动开放、正常重启再次公开，替代 Q154 每次人工开通；内置端口允许显式对外绑定、不强制回环、无观察认证，远程 WebGPU 仍须同源 HTTPS/WSS 且禁止第三方嵌入；活动页等份轮转，另设一个有限普通公开 HTTP 桶，共用总预算，同页多连接不加份额。R21-Q168 由运营者反向代理负责 HTTPS/WSS 和证书，模组不内置证书管理，具体代理产品／配置未选；同源／禁止第三方嵌入／无观察认证及 Q164 显式外绑不变。Q169 服务开停／故障／概览代次管理仅走控制台和受控配置，无网页／游戏内管理或授权者名单。公开不等于无限容量或任意文件读取。

**尚无已经核定的完整数值生产配置，也未选择 K。** 本稿把已定产品包络、已回读源码、条件算式和待证项分列；默认值、编码长度、缓存条数及线程数不证明生产／内存／工作／退出上界。Q159 继续要求有限配置在分配或生产之前预留全部实际成本；R20-Q163–Q165／R21-Q166–Q169 的政策确认不等于容量／平台／调度已验证。真实故障或旧作用未退出不能绕过；条件就绪的有限故障自动恢复和单纯墙钟回拨仅告警已定，整站恢复次数／时限／资源、代理产品／配置及实际工程证据仍待核定。

仅有文档与只读取证：没有产品／验证源码改动、构建／运行／测试、游戏启动、监听、网络或故障实验、环境修复。V1A/V1B 保持停止，V2 卡、产品实施及生产开通仍未批准；完整合同关闭仍需后续工程方案及另行允许的验证。

## 2．完整合同应覆盖的账

每类对象必须同时填写：入口和值域、最大数量 N、实际容量 B、最大共存份数 C、工作量 W、所有者、预留点、发布条件、饱和出口、退出证据及关联生产配置。容量按 `N × B × C`，再加容器、键／节点、数组头／对齐、句柄和线程 `n × h`；不能只填逻辑长度。

C 包括当前、旧代、候选、构建中、待发、写中、回调及已取消但未退出的对象。全站物理 backing 去重一次，每个实际依赖页足额归属，不按人数平均；独立复制不去重。共享账、页账、主线程工作和全站传输同时受限。

预留顺序是先核定输入／依赖、取得原预算内的数量／字节／工作／共存额度，再分配与生产；失败则拒绝、降级或暂停实际受影响页，不先生成再看是否超限。不能隔离的共同必要依赖未合格时保持观察未就绪；不扩大预算、不改变自然世界高度、不诱导加载、不用截断细实体减少事实分母。

## 3．已定包络，不是测量结果

完整指标以[验收矩阵](<observation-acceptance.md>)和[开工包限额索引](<observation-kickoff.md#L204-L224>)为准，以下不是对未重抄条款的豁免。

| 类别 | 继续成立的约束 | 尚未闭合的实施证据 |
| --- | --- | --- |
| 被动范围 | 水平半径默认4、最大8；完整自然可观察高度，不加载／保活区块 | 维度高度、名称、登记数；页切换和旧代共存 |
| 页面与实体 | 全站活动页≤8，满拒新、不踢合格旧页；四页完整验收，5–8页尽力；细实体≤1024／页、并集≤4096。R20-Q165 不作账号／IP／指纹自然人识别，同一人可多页，同页多连接不加份额，不扩预算 | 查询候选量、所有适用事实实体覆盖、在线索引、实际匿名准入、活动页等份轮转及有限普通公开 HTTP 桶的共同预算计账 |
| 排队与确认 | 待发加额外必要未确认≤4 MiB／页、32 MiB／站，仍计总预算；待发最老0.5／2秒、必要确认1／5秒 | 字节与元数据预留、共享依赖、实际写中后缀及确认释放 |
| 事实与缺口 | 事实≤5分钟／500条／2 MiB；缺口≤5分钟／200条／128 KiB；先到淘汰，未知明确 | 最坏字段、事件工作、每页过滤／编码及覆盖断言 |
| 输入与普通HTTP | 请求目标2 KiB、头8 KiB、body或入站WS4 KiB、完整读取10秒；普通HTTP≤16并发、100次／秒、burst100，合为一个有限普通公开 HTTP 桶，活动页等份轮转，两者共用原总预算 | accepted、握手、活动、idle、closing、callback等类别不重叠漏算；旧登录桶退出，不另造匿名池或按连接加份额 |
| 模组内存 | 新增堆≤512 MiB，连同非堆／堆外≤768 MiB | 线程栈、native、文件／连接句柄、容器和未退出代次 |
| 浏览端 | 归属CPU≤256 MiB／页、GPU≤512 MiB；热世界32 MiB、冷世界含必要共享64 MiB | 位图／canvas、解析／模型、构建／迁移、GPU池／上传／驱动及浏览器进程另报 |
| 峰值与回落 | 最多2倍；截止 `min(完成+30秒, 原峰值起点+90秒)` | 实际回落与退出；取消／切换／重试不重置起点 |
| 故障、时钟和恢复 | R21-Q166 真故障只停观察、游戏继续；故障消除、相关旧输出／写入已收束且重新就绪后才有限自动重建当前，未知或耗尽保持关闭并提示管理员，不无限重试／补历史。Q167 单纯超过 5 秒墙钟回拨只告警，新鲜度／等待／重试／保留／峰值沿单调时钟不延寿，真实一致性故障另处理；R/B 与实际退出分列 | 整站恢复次数／时限／资源待工程核定，不套页重连／压力数值；页级有限探测、单飞和原截止继续，不能代替整站旧作用收束及重新就绪证据 |

四事实各类型／页5条／秒、1秒突发25条；单页合计20／100、四页80／400。实际动作的取消、零结果、保护和单类型主导负载另测，不能直接注入输出报文冒充采集验证。正常稳态全站均值16 Mbit/s／突发32，四页过渡1秒80；这些目标不证明网络所有者或生产调度足够快。

## 4．当前生产域与缺口

| 域 | 已回读行为 | 必须补的界／出口 |
| --- | --- | --- |
| 配置／维度／订阅 | [配置](<../common/src/main/java/github/gtouming/what_guys_doing/core/ModConfig.java#L33-L41>)默认queue256、entities4096、section缓存8192；[订阅](<../common/src/main/java/github/gtouming/what_guys_doing/core/Subscriptions.java#L16-L90>)含三集合和pending，当前半径允许到32 | 默认不等合格最大值；维度／完整高度／集合／代次／坐标和值域；不暗改为最大8实现已完成 |
| 节采样／编码／缓存 | [采样](<../common/src/main/java/github/gtouming/what_guys_doing/world/WorldSampler.java#L65-L150>)有local4096、增长palette、Map、索引／光照／biomes与裁剪副本；[编码](<../common/src/main/java/github/gtouming/what_guys_doing/net/Protocol.java#L34-L53>)再建buffer并复制 | 缓存、工作、每页编码、排队／写中、未缓存快照与旧代统一预留；节数组尺寸不包所有成本 |
| 实体／在线索引／差分 | [实体查询](<../common/src/main/java/github/gtouming/what_guys_doing/world/WorldSampler.java#L154-L210>)先得完整候选List再限制输出；[差分](<../common/src/main/java/github/gtouming/what_guys_doing/net/EntityDeltaCodec.java#L1-L44>)保留last、prev、set和writer | 查询Q、文本UTF-8、装备／来源、baseline、移除、字段与扫描W；output cap不约束List或适用事实采集 |
| 方块变化／成功事实 | [收集器](<../common/src/main/java/github/gtouming/what_guys_doing/world/BlockDeltaCollector.java>)持Map并形成五个int数组；[增量编码](<../common/src/main/java/github/gtouming/what_guys_doing/net/Protocol.java#L56-L81>)两次gate遍历 | D0旧Map+D1新Map+20D0 B数组、每页编码及实际事实成本；输入变化不是最终成功；u16须显式检数 |
| HTTP／控制／线程 | [HTTP](<../common/src/main/java/github/gtouming/what_guys_doing/web/HttpConnection.java#L194-L314>)多处直写；[服务器](<../common/src/main/java/github/gtouming/what_guys_doing/web/WebServer.java#L25-L70>)阻塞accept和cached workers；[WS](<../common/src/main/java/github/gtouming/what_guys_doing/web/WebSocketConnection.java#L135-L175>)控制直写 | 全入口唯一实际输出所有者、连接／FD／栈／buffer／头体／idle／closing／迟到派发；MAX_LINE不界整请求，锁不界退出 |
| 资产／模型／玩家外观 | [下载与ZIP](<../common/src/main/java/github/gtouming/what_guys_doing/web/AssetCache.java#L232-L359>)先读／写再统计；[模型包](<../common/src/main/java/github/gtouming/what_guys_doing/web/AssetCache.java#L371-L438>)先枚举及readString；[皮肤](<../common/src/main/java/github/gtouming/what_guys_doing/web/SkinCache.java>)含profile／Base64／图像读取 | 网络body、ZIP项／展开总量／路径、JSON深度／节点／模型父链／变体／quad、名称、像素、并发解析与代次；超时和规范化不是容量界 |
| 低分辨率／存档／图像 | [LowresStore](<../common/src/main/java/github/gtouming/what_guys_doing/world/LowresStore.java#L127-L262>)排任务／编码PNG／保存；[MCA解码](<../common/src/main/java/github/gtouming/what_guys_doing/world/LowresStore.java#L605-L626>)用unlimitedHeap；[图像解析](<../common/src/main/java/github/gtouming/what_guys_doing/world/LowresTile.java#L29-L39>)先ImageIO后尺寸核验 | 压缩／解压字节、NBT树／数组、palette、像素、PNG工作／结果、maps／locks／队列／status；压缩64 MiB不界解压 |
| 浏览端CPU／GPU | [实体图集](<../common/src/main/resources/assets/what_guys_doing/web/entityatlas.js#L39-L86>)目标宽可扩大；[构建](<../common/src/main/resources/assets/what_guys_doing/web/entityatlas.js#L191-L251>)有canvas／ImageData／GPU；[交错顶点](<../common/src/main/resources/assets/what_guys_doing/web/vertexformat.js#L16-L41>)另分配24V | 所有输入扫描、解析／模型／quad、缓冲容量而非used、位图／上传／depth／DPR／mips／旧代与驱动；allocator／destroy调用不证实物理回收 |

## 5．可复核算式及其前提

### 5.1 正常节输出与共存

[SectionSnapshot](<../common/src/main/java/github/gtouming/what_guys_doing/world/SectionSnapshot.java#L10-L24>)本身没有长度校验或深拷贝。仅对[采样器正常返回](<../common/src/main/java/github/gtouming/what_guys_doing/world/WorldSampler.java#L75-L150>)：`1≤P≤4096`，P=1时b=0，否则 `b=ceil(log₂P)≤12`。

- 五个最终数组的元素载荷 `A=5120+4P+512b≤27648 B`，不含对象头、工作数组和Map。
- [编码](<../common/src/main/java/github/gtouming/what_guys_doing/net/Protocol.java#L34-L53>)一般长度 `L=17+4P+|indices|+|blockLight|+|skyLight|+2|biomes|`；正常数组才化为 `L=4625+4P+512b≤27153 B`。
- 正常SECTION_FULL的[无掩码FIN帧](<../common/src/main/java/github/gtouming/what_guys_doing/web/WebSocketConnection.java#L55-L75>)头4 B，`F=L+4≤27157 B`；不含TCP/TLS及流／队列buffer，也不是全部WS消息硬界。
- 当前初始编码容量 `C0=L−1`，末次u16写触发[倍增](<../common/src/main/java/github/gtouming/what_guys_doing/net/BinaryWriter.java#L19-L25>)至 `2(L−1)`；[toBytes](<../common/src/main/java/github/gtouming/what_guys_doing/net/BinaryWriter.java#L98-L99>)另复制L。当前buffer和返回数组可共存 `3L−2≤81457 B`；扩容旧buffer可能尚未回收。不能以L作为编码驻留或峰值总堆。

对单一稳定页范围，实际区块节数组长度及cy符合维度完整高度H_d时，半径8独立坐标槽位 `S≤17²H_d=289H_d`。缺块／空气减少实存，不证明完整取得；此式不界跨订阅旧代。默认8192个最大节的最终数组仅 `8192×27648=216 MiB`，不是缓存总堆或合格配置。

### 5.2 其他线载荷不界生产

令V为当前varUInt的1–5 B编码长度，B为UTF-8字节：HELLO `13+Σ(9+V(B_i)+B_i)`，维度／名称尚无合格界；BLOCK_DELTA `7+17N`，当前初始 `12+16N`不足一般实际长度，字段u16没有显式溢出检数。ENTITY `9+ΣV(removedId)+Σrecord`，全字段record `V(id)+85+V(vehicle)+V(item)+V(B)+B`，名称／候选与baseline未封顶。

整数计算须先检查溢出和值域，不能把[writer的unchecked倍增](<../common/src/main/java/github/gtouming/what_guys_doing/net/BinaryWriter.java#L19-L25>)或低位截取当限额。应用消息可跨多个K切片；逻辑长度、byte[]容量、旧基线、ACK账和实际退出各自证明。

### 5.3 资产、低分辨率和图集

模型StringBuilder初始 `4<<20` 是字符容量而非4 MiB字节界；完整路径集合、原文件字符串、builder和最终String可共存。HTTP文件size预检再readAllBytes不提供稳定版本／读取后长度和响应生命期预留。假设稳定单文件≤32 MiB时16份即512 MiB，已与新增堆全预算同量级；这是条件冲突提示，不是允许16份或该文件上限已合格。

ZIP规范化／containment不界项数、展开量或覆盖前后共存。PNG压缩结果不由像素载荷直接推出；ImageIO之前必须有可支持的解码／工作界。501² RGBA一平面是1,004,004 B，只是元素载荷，不包PNG、第二图层、图像实现或队列。

对[实体图集布局](<../common/src/main/resources/assets/what_guys_doing/web/entityatlas.js#L25-L86>)的有效真值字符串路径，E为输入行、U为按实际Set键相等去重后的首项数，不做路径规范化。设p有限非负整数、q_w／q_h／requested／w_i／h_i为positiveInt结果且所有Number运算保持有限安全整数精度：

`widest=max(16+2p, max_i(w_i+2p))`

`W=q_w·ceil(max(requested,widest)/q_w)`

`H=max(q_h,q_h·ceil((y+rowHeight)/q_h))`

y／rowHeight来自含padding和占位的逐行shelf布局，不能以输入总面积替代矩形WH。maxWidth是目标不是上限；padding未排除NaN／Infinity，positiveInt没有安全整数上界。扫描E并布局U，不是只扫描U；无H／WH硬界。

[canvas与ImageData](<../common/src/main/resources/assets/what_guys_doing/web/entityatlas.js#L191-L214>)、所有预取bitmap、布局和GPU纹理须按生命期分阶段计：绘制每个bitmap后即调用close，随后才getImageData；不宣称已close位图的全部像素必然和稍后ImageData同时驻留，也不把close当native／驱动释放完成证据。ImageData元素4WH B。[rgba](<../common/src/main/resources/assets/what_guys_doing/web/entityatlas.js#L238-L251>)与pixels共享同一buffer，物理不重复计；[返回闭包](<../common/src/main/resources/assets/what_guys_doing/web/entityatlas.js#L267-L285>)仍持canvas。CPU／GPU上传内部份数、并发重建与驱动成本未核定，不能据此宣布图集内存通过。

## 6．K 与固定平台

K定义与证据分层以[输出工程稿](<observation-send-barrier-engineering.md#L114-L197>)及[ADR-0010](<adr/0010-single-owner-send-barrier.md>)为准：一次 `SocketChannel.write`／gathering-write 所见全部remaining（含HTTP／WS头）≤K；不保证单一native syscall、调用时长、整消息尺寸、分配尺寸或TCP／TLS送达。

R直接内存可见后立即阻断受影响新准入／生产；全站至多一个R前已获准调用可返回，异常前缀未知不重放。实际所有者处理匹配R并在下一写前建B、撤资格和受影响后缀；partial直接raw-close，不补flush／正文／帧终止。B不证明引用、连接或生产者已经退出。

| 条件算术 | K=4 KiB | K=16 KiB | K=64 KiB |
| --- | --- | --- | --- |
| 32 Mbit/s足额正写至少／秒 | 977 | 245 | 62 |
| 80 Mbit/s足额正写至少／秒 | 2442 | 611 | 153 |
| 最大正常节帧至少调用数 | 7 | 2 | 1 |

仅纯字节除法向上取整；partial／zero、协议／调度开销增加调用，不证明CPU、分位时延或吞吐。参考OpenJDK `jdk-21+35` 的源码与Java API契约不是部署发行版、provider、native、驱动和调度闭包；非阻塞close亦可能延后物理关闭，不能推硬退出时限。当前K未选、Ubuntu参考设备与实际测量未核定，工程负责提出有证据推荐，不让用户猜数。

## 7．真实故障恢复及关闭条件

旧首次无痕凭证恢复和秘密交付**被撤出，不是被证明解决**。真实服务／页／缓存仍需：来源／代次、实际旧写者及回调、发布／废弃、残留成本、匹配R/B、引用／连接／生产者退出、重建和故障覆盖证据。未知作用不因timeout、Future.cancel、shutdownNow、空队列或代号更新消失。

[LowresStore保存](<../common/src/main/java/github/gtouming/what_guys_doing/world/LowresStore.java#L208-L262>)当前可能调用 `level.save(null,true,false)`；5秒门、60秒等待和shutdownNow不证实回调退出或缓存持久性。观察诱发真实世界保存需单独核对被动合同及副作用，不能改名为授权存储，也不默认批准删除或改变存档。

关闭本门需要一份明确有限数值配置，八域全部预留／共存／工作／出口表不留无界依赖；真实全站与页账可对齐；固定K／平台和双加载器结果入口有对应证据；再依各卡取得验证许可。R20-Q163–Q165／R21-Q166–Q169 已确认的政策应落实但不代替证据；整站恢复次数／时限／资源、单调时钟与旧作用收束合同、代理产品／配置及部署证据仍待工程核定，本文不代选数值，也不授权生产开通。以下给出用于进一步核定的工程草案，不将建议值记为已选生产参数。

## 8．有限生产配置草案 P0：先形成可拒收的账，不宣称已合格

P0 是本轮工程建议，不是用户接受记录、现有实现或通过测量的默认值。目的在于把“有限”变成可核查的输入、共存和预算；后续依据固定平台与参考世界证据调整，不让用户猜数。各上限同时成立，不能拿某行余量扩大另一行。已取消但仍持有的对象占原槽；最多两代是准入条件，不是声称旧代必然退出。声明有限阈值仍不证明现有 Java／JS／ImageIO／JDK 分配路径能先预留后分配。

### 8.1 服务器堆和堆外分账

下表为候选稳态预留，单位 MiB。每行包括实际持有的当前／构建／待发／旧代／取消对象以及自身容器成本；同一 backing 在全站只记一次，跨域转交预算必须先完成所有权转移，不能短暂从两边消失。

| 域 | 堆预留 | 具体候选边界与证据缺口 |
| --- | ---: | --- |
| 节缓存、采样及订阅 | 128 | 最多3072个缓存快照，最终数组最坏81 MiB；另含至多1个采样／编码工作、未退出引用、订阅和容器。引用未结束不能按缓存淘汰释放 |
| 实体、在线索引及基线 | 48 | 查询候选、4096并集、8页各1024细节及新旧基线均计；不能把输出数当查询数 |
| 方块变化、事实及缺口 | 32 | 两个有界变化批次、每页原事实／缺口环及队列字段；既有2 MiB／128 KiB页限额继续 |
| 输出及必要确认 | 40 | 原32 MiB页待发总额包含在内；页相关backing与元数据均须纳入其原限额。不归入页账的普通HTTP分块／控制工作及其元数据共同使用剩余8 MiB，不另设无限直写缓存 |
| 入站、连接及协议解析 | 16 | 32个候选总连接槽的全部状态及有限输入；不按账号／IP计人，不增加公平份额 |
| 资产、模型及玩家外观 | 64 | 串行解码／解析、索引和必要当前／候选；不同时把整ZIP、展开文件、完整JSON及全部图像留在堆中 |
| 低分辨率、NBT及PNG | 56 | 至多1个活动解码任务，队列／结果／旧写者也计；未知解码器工作内存仍阻断核定 |
| 调度、配置、状态和恢复控制 | 16 | 队列描述符、计账、故障监督及§9的8 MiB尝试额度包含在内 |
| 尚待核定的公共／运行时成本预留 | 112 | 不得挪作功能额度；对象布局、分配器及归属差额必须有证据确实落在此处，预留不是对未知成本的上界证明 |
| 合计 | 512 | 前八域400＋公共预留112；未证明当前实现符合 |

新增堆外／非堆候选256 MiB另分为：直接／I/O缓冲32、观察相关线程栈及native句柄32、其余可归属JVM／库成本192；连同堆恰为768 MiB。每个类别仍须取得实际发行版的计账依据，不能用 `close`、GC请求或线程数代替释放；未核定开销不是0。P0不提前使用2倍峰值，确需过渡额外占用须同时遵守原峰值总额和不重置的截止。

### 8.2 数量、字节、工作和生产出口

| 入口／域 | 工程候选（每项均须先核定再分配） | 工作、共存与超界出口 |
| --- | --- | --- |
| 维度、名称及完整范围 | 维度≤64、维度ID映射0–63、名称UTF-8≤256 B；每维完整节高≤64；每页稳定范围坐标槽≤289×64=18496 | 完整自然高度不裁切；配置不支持该高度／登记表则相应范围不合格。8页两代最多295936个坐标槽，实际集合与元数据须放入128 MiB域；不能只计算位数冒充当前集合堆 |
| 节与采样 | 正常数组遵守§5.1；单个完整节帧及未来封装合计≤32 KiB；缓存≤3072；活动采样／编码1个，其工作预留≤1 MiB | 每tick至多2节、主扫描8192个单元只是计数建议，不包含邻域／光照／生物群系、调色板查找、复制和编码的额外工作；这些仍须分别有界，不能据主扫描计数证明2／5 ms目标。工作和缓存同属128 MiB；slot、bytes或时间包络不足则停止该生产，不先分配；旧引用存在不能挤掉继续依赖的数据 |
| 实体查询与在线索引 | 一次范围查询访问候选≤16384；在线索引≤1024；每名称UTF-8≤256 B；详细输出仍≤1024／页、并集≤4096；基线至多当前＋候选 | 必须有可提前停止的查询，不先形成无界List。达到查询边界不能把前16384个标为完整；暂停受影响页并明示覆盖缺口，不改变适用事实的分母。48 MiB包括查询、字符串、集合和基线 |
| 实体线消息 | 当前编码最坏全字段record≤358 B，单页1024个全字段及1024个removed：`9+1024×(358+5)=371721 B`；候选完整应用消息≤512 KiB | 358来自5＋85＋5＋5＋2＋256；不等于对象堆。未来生命周期封装也必须装进512 KiB；现有writer倍增、副本和旧基线仍分别预留，不因消息过K而放大K |
| 方块变化及事实 | D0／D1各≤8192个唯一变化；每次编码N≤8192；事实线记录≤2 KiB、缺口记录≤512 B，数量／页字节／时间仍按原限额 | 五数组元素最坏163840 B；当前delta线载荷139271 B。两个Map、两遍gate、编码增长及每页筛选另计。只截断渲染变化须使基线失效并重建；不能截断真实成功事实后仍报完整 |
| 输出 | 每页≤256个排队／确认描述符，且所有实际backing继续≤4 MiB；全站≤32 MiB。普通HTTP每响应至多两个16 KiB工作块，所有HTTP／控制工作与元数据≤8 MiB | 完整协议消息保持身份，不跨HTTP响应／WS帧交错；读文件须稳定版本、有限分块和有界读后检查。16 KiB是生产工作块建议，不是K，也不是HTTP桶权重 |
| 连接、任务及文件句柄 | TCP所有accepted／握手／活动／idle／closing合计候选≤32，含旧连接；普通HTTP仍≤16并发；监听1、selector1、观察直接文件句柄≤16；工作描述符总数≤64 | 不新造认证池或额外关闭池；真正关闭才还连接槽。观察自建线程候选≤4，JDK／库隐式线程和额外native句柄须另计并核定，否则该路径不能以4线程通过；同页额外连接不增加份额 |
| ZIP／模型／外观 | 压缩输入≤64 MiB，项≤32768、展开合计≤256 MiB、单项≤8 MiB、规范化路径UTF-8≤256 B；模型包≤16 MiB；单JSON≤1 MiB、深≤32、累计节点≤262144、单字符串≤4096 B；模型≤8192、父链≤32、展开后单状态quad≤64 | ZIP项／展开字节、JSON节点和父链必须在复制／解析前预留且无环；累计访问量和新旧代也受总额限制。仅有时间超时不足以限制解压和回调。皮肤／cape压缩体各≤1 MiB、profile／Base64解码体≤64 KiB，图像仍需下一行约束 |
| 图像及磁盘资产 | 候选只接可核定的PNG路径；单图边≤1024、像素≤1048576；同包纹理输入≤4096张、累计解码像素≤8388608；同域同时解码1张 | 逐项／累计像素仅界元素和工作，不界ImageIO插件／native workspace；未知则不标就绪。资产磁盘当前＋旧＋临时≤1 GiB、文件≤65536；所有文件在已定义资产根内，不改游戏存档、不删除已有文件来达标 |
| MCA／NBT／低分辨率 | 单chunk压缩≤2 MiB、展开≤8 MiB、NBT深≤32、节点≤65536、单数组元素≤1048576；输出图边≤512、PNG≤2 MiB；结果缓存≤256项且合计≤16 MiB；待工作≤32项且归属全站64描述符 | 1个活动chunk任务，最多遍历1024个chunk描述符／region；数组类型宽度、树及解码workspace放入56 MiB。当前unlimitedHeap不符合；PNG像素不保证压缩体≤2 MiB，须有上限的输出接收器。低分辨率磁盘当前＋旧＋临时≤1 GiB；只读自然已保存数据，不以P0授权观察强制 `level.save` |

这些数量不保证全高最大范围一定装得下：H=24且6936个节均达到最大正常帧时，仅节帧就为 `6936×27157=188360952 B`，已超过64 MiB冷下载包络；对应最终数组元素 `6936×27648=191766528 B`。原32 MiB热额度最多容1235个、64 MiB最多容2471个最大节帧，且尚未算实体或共享资源。不能据此缩短世界高度、缩半径承诺、伪造“完整”，也不能把参考世界悄悄排除；P0必须用既定参考负载证明可用，对超出配置的真实场景明确拒收／暂停受影响页，合格常规页的事实分母不变。

### 8.3 浏览端候选分账及可证元素小计

CPU每页256 MiB候选：世界／旧范围数据80，模型／实体／事实及元数据40，图像／canvas／ImageData48，网格构建及staging32，入站／协议／解码24，尚待核定JS／native公共成本32。总和256；这是归属预算，不是浏览器进程上限。32／64 MiB热冷指标是下载量，不能拿来充当这张内存表。

- 网格候选每个生产片段quad≤16384、V≤65536、I总≤98304，同时生产1个。现有[五组Float32及两组索引](<../common/src/main/resources/assets/what_guys_doing/web/mesher.js#L112-L119>)和[转typed数组](<../common/src/main/resources/assets/what_guys_doing/web/mesher.js#L220-L232>)形成 `40V+4I=3014656 B`；[交错](<../common/src/main/resources/assets/what_guys_doing/web/vertexformat.js#L39-L47>)另有24V，索引迁移另有4I，元素总计 `64V+8I=4980736 B=4.75 MiB`。仍须计当前动态JS数字数组、容量余量和原网格；不能把“每个Number为8 B”当上界。现有整节构建不是该分片实现，分片不得提前宣布整节已可用。
- 图集候选每边≤2048、所有同驻留图集矩形面积和≤4194304像素（含padding、旧代和候选，非原图面积和）；RGBA平面总≤16 MiB，同时存在canvas和ImageData则≤32 MiB元素。单张位图≤4 MiB，布局和未释放native成本仍须纳入48 MiB。已close位图不与稍后ImageData机械双算，但native未证退出部分不能消失；rgba别名不再加一份。
- GPU每页512 MiB候选：全部几何／实体实例160，纹理含mip／layer／旧代64，depth及目标附件48，上传／迁移／延后退出96，尚待核定驱动和公共成本144。若需要额外旧代，先有对应额度；`destroy`不是物理额度已返还的证明。
- 地形池候选 `Vcap≤4194304`、两索引arena容量和≤6291456：`24Vcap+4Icap=125829120 B=120 MiB`，在160 MiB几何域内还须放入实体／其他实际几何；不把[现有按8节／列估算](<../common/src/main/resources/assets/what_guys_doing/web/vertexpool.js#L42-L48>)当完整自然高度上界。每个buffer还须满足实际device limits。候选1024细实体的全部实例、部件、材质、绘制表必须另给有限计数，不能只用实体数关闭此项。

这里已给有限数值和可复核元素小计，**没有给未知JS／driver开销一个伪造的测量值**。[§10模型／实体补充](<observation-production-capacity.md#L178-L213>)现已列展开、部件、实例、绘制、最小分配和共存候选及反例；真实参考构成、对象／解析工作成本、GPU内部上传共存和实际回落仍待证，P0尚不是完整合格生产配置。

## 9．整站有限故障恢复草案：独立于页重连／压力探测

以下把Q166落为候选尝试包络，仍未选择或实现；页级3次／60秒探测、5次／60秒重连等数值不参与本表。正常enabled启动遵循Q163；配置关闭或控制台停用不创建故障重开票据。首次无痕凭证标记和秘密通道仍已撤出。

| 阶段／限额 | 候选合同 |
| --- | --- |
| 故障成立 | 发布匹配R，阻断受影响准入／生产；只有观察停止，tick不等待网络／磁盘。以单调故障起点起算90秒整站自动处理窗口，后续同一未收束故障不重置 |
| 旧作用收束 | 先取得匹配B，并逐项核对相关旧输出／写者／回调及共享缓存所有权；没有证据即留关闭。等待不是重建尝试，不启动替代写者，不清零残留成本；90秒到仅停止自动尝试，并不把任务变为已退出 |
| 次数与退避 | 每故障最多2次自动重建，每Minecraft进程累计最多4次；开始即耗一次，失败／超时不退还。首次不早于故障后5秒，下一次不早于前次实际结束后30秒；控制台显式复核可另行重置自动次数，普通网页／重连／时钟变化不能重置 |
| 一次尝试 | 单次结果采纳窗口≤20秒，不宣称阻塞调用会在20秒内返回或任务已退出；全站同时1次；开始前必须故障消除、相关旧作用收束、资源及必要依赖已核定可用；只重建当前观察，不补历史、不代修环境、不重新下载未核定资产。若必要条件不能先证明，不以“尝试”绕过就绪门 |
| 工作与成本 | 控制检查每tick至多64个有限描述符且目标≤0.1 ms，计入原2／5 ms预算；非抢占单项若不能证实有界不能据此称硬时间通过。单次增量工作内存≤8 MiB，含在§8的16 MiB控制域；当前／候选／取消共用该额度，不建立新进程或额外连接／线程池 |
| 截止与取消 | 有效截止取故障窗口、尝试20秒及仍适用的原峰值／资源截止之最早者；取消不归还票据、所有权或成本。前尝试任务未实际退出时不准第二次；晚到结果只能清理，不能发布、延寿或重新开通 |
| 成功／失败 | 只有当前配置仍enabled、无人工停用、无新故障、所有必要条件及资源确实就绪，才发布新运行的当前观察；旧消息／基线／页代不恢复。无法确认、超过次数／期限或预算不足则保持关闭，有界提示管理员，不停止游戏 |

选择“两次×20秒，首次5秒，实际结束后至少30秒”使两次满额尝试最早也需75秒，90秒窗口只留有限收束余量，不承诺75秒能恢复；进程总额4次避免短暂恢复反复故障形成无限自动循环。数值由工程提出供后续核定，不声称比其他值实测更优。若旧作用永久未知，关闭的是观察可用性，不虚报资源回收；实际安全退出能力仍是独立证据门。

Q167的单纯墙钟回拨>5秒只产生告警，不创建上表故障、不重置票据／截止；其他实际一致性故障可独立触发。Q169仅控制台／受控配置可停用或复核；公开访问不带管理动作。该草案不授权故障实验、构建、运行、监听或生产开通。

## 10．P0 模型与实体展开补充：先计容量，不能只计当前实体

本节仍是工程候选，不新增用户接受记录或执行许可。它补§8.3的部件、变体、实例、绘制与上传计数，不把原1024细节实体变成任意构成均已合格；以下元素算式不含未知对象／JS运行时／驱动成本。

### 10.1 方块模型的有限展开入口

[父链与纹理解析](<../common/src/main/resources/assets/what_guys_doing/web/baker.js#L185-L226>)有 `depth>16` 返回null，但无模型缓存总额；纹理引用用seen防环却没有独立跳数上限。[变体选择](<../common/src/main/resources/assets/what_guys_doing/web/baker.js#L229-L257>)可先生成全部keys再filter／sort，multipart逐项累计；[when条件](<../common/src/main/resources/assets/what_guys_doing/web/baker.js#L37-L46>)递归并重建属性Map。[烘焙](<../common/src/main/resources/assets/what_guys_doing/web/baker.js#L274-L335>)遍历模型元素及六个方向，把全部quad和null结果留在状态缓存；clearCaches不清textures／blockstateFiles。这里不把深度守卫当数量／字节／全部工作上界，也不把返回null视作已明确告知用户的容量拒收。

| 项目 | 补充候选和必须同时成立的边界 | 可复核含义与超界出口 |
| --- | --- | --- |
| 输入与展开 | 沿§8.2的字节／JSON节点总界；每blockstate变体键≤4096、multipart项≤128；单when深≤16、节点≤256、叶值列表≤16；每次选中引用≤16；每解析模型elements≤64、每element最多六方向；纹理引用链≤16且无环 | 单状态最多4096次variant键检查、128×256个条件节点访问、16×64×6次候选面检查；字符串比较、Map构造、排序、父链／纹理查找与复制另外计入工作，不能据这三个计数宣称帧时合格。现有depth>16不等于P0父链≤32已实现 |
| 当前／旧／候选保留总量 | 页面合计已解析模型≤2048、状态缓存键≤4096、已访问blockstate文件键≤4096、纹理键≤4096；null／失败键也计；全部保留状态quad≤32768，单状态仍≤64 | 输入允许8192模型不代表必须全留；缓存淘汰不释放仍被网格／旧代引用的backing。超界须在下一项分配前停止并明确受影响范围未就绪，不静默漏掉一个variant／面后宣布完整 |
| 存储与共存 | [每面四个五数值顶点](<../common/src/main/resources/assets/what_guys_doing/web/baker.js#L159-L181>)，Q=32768时仅顶点已有655360个Number值、163840个verts／顶点数组，另有32768个quad对象及外层容器 | 这是元素／对象数量，不是“每Number 8字节”的堆上界；源JSON、rawTextures、旋转前后副本和排序临时数组另计，全部仍在40 MiB模型／实体域及相应工作域内，没有额外模型池 |

### 10.2 实体模板、实例与实际 GPU 请求容量

[generated展开](<../common/src/main/resources/assets/what_guys_doing/web/entitymodel.js#L61-L105>)验证每个quad有四个positions和uvs，却不限制每cube有六面；base、layers及[所有stateParts](<../common/src/main/resources/assets/what_guys_doing/web/entitymodel.js#L202-L225>)会叠加。[实体纹理引用](<../common/src/main/resources/assets/what_guys_doing/web/entitymodel.js#L13-L20>)递归没有seen／深度守卫；[父链合并](<../common/src/main/resources/assets/what_guys_doing/web/entitymodel.js#L34-L50>)遇环返回model而不是证明资源合格。[皮肤／披风和variantTextures](<../common/src/main/resources/assets/what_guys_doing/web/entityrender.js#L339-L375>)逐变体重新生成几何，不能按modelKey只收一次费用。候选先限制纹理／父引用≤16／32且拒环，全部layers／stateParts／皮肤展开后再按下表总额检查；每模板输入stateParts≤16、layers≤16、访问parts≤64、cubes≤64、quad描述符≤384，丢弃或不可见项也占访问数，不能先过滤后才计成本。

记T为展开后的变体模板数，D为其保留部件总数，Q为四顶点面数，I为实体×合格部件的实例记录数，`N_b`为历史保留实例桶键数，`C_i`为这些桶的实际容量之和（记录单位）。以下每个资源集合的候选与同页最多两个共存集合必须同时成立；扩容旧backing、构建半成品和取消未退出对象也占对应槽，不能借“第三次重建”另开一套。

| 项目 | 已读实现与元素算式 | 有限候选，不代表当前守卫 |
| --- | --- | --- |
| 模板／部件 | [模板typed生成](<../common/src/main/resources/assets/what_guys_doing/web/entityrender.js#L298-L332>)是5个F32／顶点、6个U32／面；四顶点时104Q B。构建另有26Q个Number值与源模型／烘焙parts共存 | T≤256，每模板最终parts≤16、Q≤384、V≤1536，D≤4096、总Q≤98304；几何typed≤10223616 B=9.75 MiB／集合。boxes、quad、part上限分别检查，不凭“64盒×6面”推现状 |
| packed实例桶 | [实例生成](<../common/src/main/resources/assets/what_guys_doing/web/entityrender.js#L387-L437>)每记录matrix16＋tint4个F32=80 B；新桶64记录起，倍增时旧／新共存；reuse只清count，返回subarray共享backing | 实体仍≤1024，I≤16384；`N_b≤512、C_i≤65536`，容量总和包含扩容中旧／新backing，桶typed≤5 MiB／集合。历史闲桶也计，不按80I替代 `80C_i`；约200优先动画不把实际逐实体逐部件循环的分母变成200 |
| 打包及CPU共存 | [pack](<../common/src/main/resources/assets/what_guys_doing/web/entityrender.js#L452-L464>)再复制到独立staging，draws仍持有实例引用；复用数组可比used大 | staging实际capacity≤327680个F32=1.25 MiB／集合；两集合typed小计 `2×(9.75+5+1.25)=32 MiB`，其中29.5归模型／实体、2.5归32 MiB工作域。40 MiB模型域仅余10.5 MiB，还须容纳方块模板、源包、事实／缺口、对象等；没有合格证明 |
| GPU模板与实例 | [管线](<../common/src/main/resources/assets/what_guys_doing/web/app.js#L1245-L1269>)实际stride为20／80 B；[每part建两buffer](<../common/src/main/resources/assets/what_guys_doing/web/app.js#L1576-L1591>)各至少256 B，不能只相加typed长度 | 单集合模板请求容量为 `Σ[max(80qᵢ,256)+max(24qᵢ,256)]≤104Q+512D≤11.75 MiB`；[实例buffer](<../common/src/main/resources/assets/what_guys_doing/web/app.js#L1634-L1647>)按历史需要保留，候选实际capacity≤1.25 MiB。两个集合请求容量≤26 MiB；加120 MiB地形为146 MiB，160 MiB域还剩14 MiB，不能只取未计此最小分配补量的142 MiB |
| 对象、绘制与上传 | 全模板每part两个GPUBuffer，即使无活实例也建立；[绘制循环](<../common/src/main/resources/assets/what_guys_doing/web/app.js#L1662-L1677>)逐活桶drawIndexed | 两集合模板＋实例GPUBuffer对象≤16386；仅当前合格集合绘制，实体draw≤512／帧，实例记录≤16384，按每实体384面最多393216个实例化面／帧。模板重建串行，候选一次上传片段≤32次writeBuffer且≤1 MiB，实例一次≤1.25 MiB；最多2个未结算提交批，额度不足停止新生产，不隐式积压。调用数／请求字节不界驱动工作，批结算／安全复用仍待API与实现证据 |

现有[destroy／clear](<../common/src/main/resources/assets/what_guys_doing/web/app.js#L1515-L1527>)只发释放请求、清JS引用；[实例上传](<../common/src/main/resources/assets/what_guys_doing/web/app.js#L1647-L1657>)也不提供native物理退出证明。两集合、实际桶容量、GPU对象及提交批上限是建议先预留的准入条件，不是测得旧对象会及时退场。整个CPU／GPU分账不扩张，未核定公共成本不能视为可借余量。

### 10.3 不能用受限候选遮住的两组反例

1. **不同变体很多**：1024实体各有不同变体且各16部件时，当前每桶至少64记录导致 `C_i≥1048576`，仅桶typed为83886080 B=80 MiB，已超过40 MiB域；`T=1024、N_b=16384`也超过上述候选。即使仅把T放宽到1024，满384面时单集合几何39 MiB＋实例1.25 MiB已超过地形120之外的40 MiB，尚无padding／旧代。必须先证明真实参考构成可被接纳或重做共享／桶分配方案；不能少画后仍称1024任意构成已合格，更不能缩减事实实体分母。
2. **旧合并网格不是低成本兜底**：[旧路径](<../common/src/main/resources/assets/what_guys_doing/web/entitymesh.js#L45-L81>)每面typed为184 B、另有46个Number值；1024×384面即72351744 B=69 MiB／集合。调用方[还会interleave](<../common/src/main/resources/assets/what_guys_doing/web/app.js#L1720-L1731>)另加24V=36 MiB，已读元素小计达105 MiB，远超32 MiB工作域，尚无原Number数组及旧GPU资源。必须独立有限分片并核定，或在不满足此路径前提时明确拒收；不能把实例的1.25 MiB套给它。[非packed复用](<../common/src/main/resources/assets/what_guys_doing/web/entityrender.js#L389-L445>)还只清count却继续push旧matrices／colors，不能套用packed缓存候选；[当前主调用](<../common/src/main/resources/assets/what_guys_doing/web/app.js#L1610-L1633>)明确使用packed，未声称实际主路径已触发该非packed组合。

本轮只把此前未列出的展开／实例／最小分配与兜底缺口落为有限候选和反例；未核定参考构成、解析／临时矩阵／JS对象开销、GPU内部共存和实际回落，P0仍未合格。容量超界不伪造完整模型、不改变成功事实分母；若必要共享依赖无法隔离，则服务保持未就绪。K、最终转换与运行许可均未因此选定；普通 HTTP 总桶权重 0.5、活动页权重 1 已由 Q170 确认，具体算法和计量仍待核定。

## 11．首次部分启动失败与相关旧作用：源码证据及恢复门

本节补§9的收束前提，不另选恢复次数、截止或资源数值。首次公开观察启动失败即使尚未有 `running`、可用静态实例、成功日志或完整清理记录，也不能据此断言没有旧作用。这里处理资源／任务责任，不恢复已撤出的首凭证可靠标记、身份文件或秘密交付。

### 11.1 当前启动及停止入口

以下是已回读源码的允许路径和缺少的证明，不是故障复现、原生句柄泄漏数量或实际卡服结论。

| 入口／责任 | 已读事实及其限定 | 恢复证据缺口 |
| --- | --- | --- |
| 公开与就绪 | [SessionHub.start:205–230](<../common/src/main/java/github/gtouming/what_guys_doing/core/SessionHub.java#L205-L230>)先设静态实例／激活收集器，再启动 WebServer、资产线程和低分辨率存储，最后置 `running=true`。[HTTP:36–89](<../common/src/main/java/github/gtouming/what_guys_doing/web/HttpConnection.java#L36-L89>)处理路由／升级，没有运行就绪检查；[/health:125–128](<../common/src/main/java/github/gtouming/what_guys_doing/web/HttpConnection.java#L125-L128>)无条件返回 200。反面限定：[delta 收集入口:69–75](<../common/src/main/java/github/gtouming/what_guys_doing/world/BlockDeltaCollector.java#L69-L75>)另检查 `hub.isRunning()` | accept 线程已启动而 running 尚未置位时，源码允许公开成功输出；实例非空、Thread.start 返回和 200 不证明必要条件就绪。不能因 collector 提前激活就断言已收集 delta |
| 构造／移交前失败 | [WebServer:27–47](<../common/src/main/java/github/gtouming/what_guys_doing/web/WebServer.java#L27-L47>)取得 Java socket 后设置选项、绑定、创建 executor，再另行启动线程，没有构造失败清理。选项／绑定的 IOException 在构造返回前发生时，Hub 尚未取得该对象；Hub catch 仅清引用／停 collector。[Lowres watch:258–272](<../common/src/main/java/github/gtouming/what_guys_doing/world/LowresStore.java#L258-L272>)也先取得局部 WatchService、注册后才保存字段，异常分支没有局部 close | 字段为空不证明局部资源已关闭。已绑定后的 executor／线程启动或后续同步未检查失败不受 Hub 的 IOException catch 覆盖；[assets 构造／start:82–111](<../common/src/main/java/github/gtouming/what_guys_doing/web/AssetCache.java#L82-L111>)和[lowres 构造:104–125](<../common/src/main/java/github/gtouming/what_guys_doing/world/LowresStore.java#L104-L125>)不声明该 checked 异常，不能虚构为“assets 启动后 IOException 被 Hub catch 丢引用”。实际原生资源遗留另待固定平台证据 |
| accepted 连接及低层故障 | [acceptLoop／stop:49–71](<../common/src/main/java/github/gtouming/what_guys_doing/web/WebServer.java#L49-L71>)取得 client 后设置 TCP 选项、提交 worker；选项失败仅记录并返回，提交未检查失败无局部清理。尚未进入 HTTP 的 try(socket) 时没有该作用域的关闭保障；accept 退出没有向 Hub 提交故障／活性回执 | listener.close／shutdownNow 不证明这些连接和 worker 实际退出；accept 已结束也不必阻止启动调用继续置 running=true。普通对端断线不自动等同整站必要依赖故障 |
| 部分启动及重复停止 | [公共生命周期:42–54](<../common/src/main/java/github/gtouming/what_guys_doing/WhatGuysDoing.java#L42-L54>)启动临时新 Hub，停止仅取静态实例；[Fabric:14](<../fabric/src/main/java/github/gtouming/what_guys_doing/fabric/WhatGuysDoingFabric.java#L14>)／[NeoForge:10](<../neoforge/src/main/java/github/gtouming/what_guys_doing/neoforge/WhatGuysDoingNeoForge.java#L10>)共用入口。[Hub.stop:233–255](<../common/src/main/java/github/gtouming/what_guys_doing/core/SessionHub.java#L233-L255>)在 !running 时早退，先清 running 后逐项清理，没有确保其余责任继续处理的 finally；[Session.close:161–168](<../common/src/main/java/github/gtouming/what_guys_doing/core/Session.java#L161-L168>)同步调用[WS close:79–95](<../common/src/main/java/github/gtouming/what_guys_doing/web/WebSocketConnection.java#L79-L95>)，后者等待发送锁并 write／flush | 首次部分启动、停止中途失败和重复 stop 不能靠 flag 证明清理完整。源码仍有生命周期回调等待锁／I/O 的路径，不是实际卡服测量；共用源码不代替转换后双加载器执行证据 |

### 11.2 输出隔离后仍须收束的相关作用

匹配 B 只确认既有输出合同，不给共享文件写入、删除、替换、缓存发布或派生回调签发退出回执。它们按对应运行／来源代次及实际所有者另核，不能把 B 当缓存格式版本或通用文件名。

| 相关任务／共享目标 | 已读作用与停止证据限制 | 重建前必须覆盖 |
| --- | --- | --- |
| AssetCache | [固定路径:82–89](<../common/src/main/java/github/gtouming/what_guys_doing/web/AssetCache.java#L82-L89>)由配置目录生成；[start:107–111](<../common/src/main/java/github/gtouming/what_guys_doing/web/AssetCache.java#L107-L111>)只保存局部 daemon Thread，Hub.stop 仅令 assets=null。[下载:249–266](<../common/src/main/java/github/gtouming/what_guys_doing/web/AssetCache.java#L249-L266>)写同名 .part 并替换 jar，[抽取:305–328](<../common/src/main/java/github/gtouming/what_guys_doing/web/AssetCache.java#L305-L328>)覆盖 content；[161–178](<../common/src/main/java/github/gtouming/what_guys_doing/web/AssetCache.java#L161-L178>)可删 jar、写格式 marker，再更新旧实例 READY／FAILED。[缓存命中:116–125](<../common/src/main/java/github/gtouming/what_guys_doing/web/AssetCache.java#L116-L125>)读格式 marker，不是旧线程终结检查 | 下载、解压复制、删除／替换、marker 和状态提交的相关终结。旧对象状态不直接修改新对象，但共享文件仍可影响它；合法缓存可按来源／完整性另核复用，格式合法或 READY 不证明旧写者退出 |
| Lowres watcher／worker | [close 与 watch:247–303](<../common/src/main/java/github/gtouming/what_guys_doing/world/LowresStore.java#L247-L303>)只有 close、interrupt、shutdownNow，没有终结回执；当次事件可继续[删瓦片:342–356](<../common/src/main/java/github/gtouming/what_guys_doing/world/LowresStore.java#L342-L356>)，生成可[存储／删空:429–449](<../common/src/main/java/github/gtouming/what_guys_doing/world/LowresStore.java#L429-L449>)及[保存并级联:453–476](<../common/src/main/java/github/gtouming/what_guys_doing/world/LowresStore.java#L453-L476>)。最终[路径:666–668](<../common/src/main/java/github/gtouming/what_guys_doing/world/LowresStore.java#L666-L668>)不含服务运行代；每实例锁或[临时文件／原子替换:92–105](<../common/src/main/java/github/gtouming/what_guys_doing/world/LowresTile.java#L92-L105>)不能防旧实例最后覆盖新实例。[status:359–383](<../common/src/main/java/github/gtouming/what_guys_doing/world/LowresStore.java#L359-L383>)硬编码 READY | 排队和执行中的生成、父层级联、watch 当次处理及相关写／删提交。清 active／pending 或一次方法入口代检查不覆盖最后提交；READY／epoch 不证明生命周期或实际退出 |
| Lowres 派生的游戏线程 save | [enqueue:180–205](<../common/src/main/java/github/gtouming/what_guys_doing/world/LowresStore.java#L180-L205>)在等待保存后继续生成；[ensureRegionSaved:208–234](<../common/src/main/java/github/gtouming/what_guys_doing/world/LowresStore.java#L208-L234>)投递 server.execute 回调并用局部 Future 等待，超时／中断被 catch 后没有撤销回调或恢复中断，调用方仍继续。saved.complete 仅跟随 level.save 返回；异步落盘目前只有该处源码注释，未核实际存档实现 | 已派生回调及其相关实际作用，不能只等自己的 executor／worker 终结。遗留 save 的收束核对不是新流程诱导保存／加载／flush 的许可；现行目标仍只读自然保存的世界 |
| SkinCache 所在旧 HTTP worker | [HTTP:194–211](<../common/src/main/java/github/gtouming/what_guys_doing/web/HttpConnection.java#L194-L211>)先捕获固定 skins 路径再同步调用；[static 缓存:22–64](<../common/src/main/java/github/gtouming/what_guys_doing/web/SkinCache.java#L22-L64>)只按数据 UUID 索引；[cape 异常及提交:97–117](<../common/src/main/java/github/gtouming/what_guys_doing/web/SkinCache.java#L97-L117>)的内层 catch 可吞中断后继续写 PNG／model／cape 及 static maps | 已捕获路径的旧 HTTP 任务、文件及 static 缓存提交；assets=null 和 shutdownNow 不撤销它们。UUID 是被观察数据标识，不是观察者认证或服务退出凭据 |

### 11.3 最小恢复合同候选

以下补充 Q159／Q163／Q166 和 R/B，不是选定字段、存储格式、调度实现、完整生产配置或新政策问答。

1. **首次作用也有责任。** 沿第2节逐对象账，在分配／启动前预留实际数量、容量、工作及失败处理责任；constructor 内部资源在确认移交前由该作用域负责，accepted client 在提交前已有唯一责任归属，任务派生回调也入账。没有顶层实例、成功日志或 running 不能豁免；未知责任保留，不被下一次 startup 覆盖或重置。
2. **就绪与公开采纳分开。** 未公开候选先建立必要依赖；只有当前 enabled、没有人工停用／新故障、必要资源确实合格且相关旧作用已收束，才采纳当前运行的成功观察输出。实例非空、线程启动、缓存格式命中、HTTP 200 和 Lowres READY 均不替代这些事实。若保留独立存活探针或未就绪提示，语义与观察就绪分开；输出仍受已有 HTTP 总桶、K、输入／响应槽和资源限额，没有免费拒收通道。
3. **限制发布不等待退出。** 故障或停用先发布单调且内存可见的 R，阻断受影响准入／生产；唯一输出所有者在下一写前建立匹配 B，按既有合同丢后缀／raw-close，不用正常 Close／flush 当停止清理。游戏回调不等待未知发送锁、网络／磁盘或任务退出；剩余责任由预留的有界控制处理，不因一次清理失败或 !running 遗忘。不承诺资源耗尽等任意未检查失败都可自动修复。
4. **按实际作用闭合。** 取消请求、句柄实际关闭／注销、任务及派生回调实际退出、最后相关文件／缓存提交、最后持有引用结束分别核对。输出 B、Future 返回／超时、队列清空、状态终态或格式 marker 不可合并替代；换代与最后提交之间也须隔离旧作用，不能仅在入队时检查一次。旧对象及失败清理继续占原域；不把当前无关作用的物理回收一律设为重开前提，但相关旧作用未知时不重叠复用，也不提前归还资源。
5. **有限重建使用原包络。** 保持§9的整站候选：故障消除、匹配 B、相关旧输出／写者／回调收束、必要资源可用才开始当前-only 重建；前尝试未实际退出不开始第二次。等待／超时不是成功或退出，不重置同一故障起点、原截止或次数。无法确认、预算不足、期限／次数耗尽继续关闭观察并有界提示管理员，游戏继续；配置关闭／人工停用优先，纯墙钟回拨只按 Q167 告警。
6. **故障影响不扩大或隐去。** 可隔离的普通连接失效只处理真实影响，不把所有断线自动当整站故障；必要共享监听／生产／缓存职责失效或无法隔离时，不凭旧 running／READY／健康响应宣称就绪。必要依赖清单、故障识别／上报及退出回执仍须在具体实现和固定平台证据中核定。

### 11.4 后续核验场景及证据边界

| 场景 | 未来应分开核对的事实 |
| --- | --- |
| 构造选项／bind 失败、绑定后 executor 或线程启动失败、watch 注册失败且字段未赋值 | 取得作用即有责任，移交无空档；!running／instance=null 不跳过未收束责任。不把尚未复现的条件写成故障实测 |
| accept 后选项失败／提交被拒；停止中途失败及重复 stop | 未进入 worker 的连接也有关闭／计账责任，其余清理仍保留；单连接与必要监听故障分开，不拿日志作全体退出 |
| accept 已起、必要依赖未完成／失效，但 200／Lowres READY 可读 | 成功观察采纳门不被这些信号绕过；未就绪提示仍受原限额，不补免费响应或第二个输出所有者 |
| 旧资产替换／删除／marker、watch 删瓦片、父层级联或皮肤提交晚到 | B 后独立核相关任务、最后共享目标提交和成本；无回执时不与新实例重叠复用 |
| save 等待超时／中断、worker 清 active 或退出，派生游戏回调未定 | 后续生成不因“取消”取得新资格；派生回调及实际作用不被 worker 账归零掩盖，不诱导新的保存 |
| 首次失败缺少完整记录，退出未知跨越退避／截止，期间停用或回拨 | 未知责任保持，截止只停止自动尝试而不释放它；不重置票据／旧资源期限，停用优先，不恢复历史或凭证 |

以上只收束文档与源码责任关系；未执行故障注入、线程／原生句柄观测、JDK 或游戏存档实现核验、转换后双加载器生命周期运行。未证明旧 daemon 当前存活／已退出、共享路径实际冲突、硬墙钟退出或恢复可用；§9／本节仍是未确认且未实现的候选。后续仅在原 V2 职责内提出字段完整、范围最小且另获许可的具体子卡，不增加一批实验或恢复 V1。
