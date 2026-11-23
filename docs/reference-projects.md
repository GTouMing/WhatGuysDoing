# 参考项目

本项目登记以下参考项目，用于后续设计、代码阅读和实现对照；不代表引入运行依赖、复制实现或承诺文件格式兼容。

核对日期：2026-11-03。

## Xaero's World Map

- 官方名称：Xaero's World Map（Xaero 的世界地图）。
- 官方发布页：[Modrinth](https://modrinth.com/mod/xaeros-world-map)。
- 可核对的项目说明和元数据：[Modrinth 项目 API](https://api.modrinth.com/v2/project/NcUtCpym)。
- 定位：以客户端为主的全屏世界地图，记录已探索区域；可选服务端安装提供世界识别等附加功能。

### 可参考的方向

- 已探索区域的地图展示，以及单人、多人和不同世界／维度之间的地图组织。
- 鼠标拖动、滚轮缩放、位置查看等地图交互。
- 资源包变化引起的地图重生成，以及地下／洞穴维度的展示需求。

以上是公开项目说明中的功能参考，不是对其内部缓存、线程或渲染实现的判断。

### 使用边界

官方项目元数据的 `source_url` 为 `null`，未提供源码仓库。将其作为产品功能与交互参考；未获得明确许可前，不复制其代码或资源，不把第三方反编译版本视为获授权源码。

## BlueMap

- 本地检出路径：`E:/Projects/BlueMap`。
- 上游仓库：[BlueMap-Minecraft/BlueMap](https://github.com/BlueMap-Minecraft/BlueMap)。
- 本次核对的本地提交：`12823c378b7428a2b90302e8154930d82e6d7912`。
- 项目定位：读取 Minecraft 世界文件，生成可在浏览器中查看的地图和三维地表模型；见本地 [README.md](<E:/Projects/BlueMap/README.md#L19-L31>)。
- 许可证：MIT；见本地 [LICENSE](<E:/Projects/BlueMap/LICENSE#L1-L22>)。复用源码或实质性片段时，须保留相应版权和许可声明；第三方依赖与资源的授权需分别确认。

### 本地源码入口

| 参考方向 | 入口 | 阅读重点 |
| --- | --- | --- |
| 世界文件与区块缓存 | [MCAWorld.java](<E:/Projects/BlueMap/core/src/main/java/de/bluecolored/bluemap/core/world/mca/MCAWorld.java#L60-L137>) | 区块预加载、世界区域枚举和缓存失效。 |
| 存档变动监听 | [MCAWorldRegionWatchService.java](<E:/Projects/BlueMap/core/src/main/java/de/bluecolored/bluemap/core/world/mca/MCAWorldRegionWatchService.java>) | 区域文件监听及变更通知。 |
| 低分辨率地图 | [LowresLayer.java](<E:/Projects/BlueMap/core/src/main/java/de/bluecolored/bluemap/core/map/lowres/LowresLayer.java>)、[LowresTile.java](<E:/Projects/BlueMap/core/src/main/java/de/bluecolored/bluemap/core/map/lowres/LowresTile.java>)、[LowresTileManager.java](<E:/Projects/BlueMap/core/src/main/java/de/bluecolored/bluemap/core/map/lowres/LowresTileManager.java>) | 多级细节层次（LOD）、瓦片缓存、更新传播及持久化。 |
| 方块模型与资源包 | [方块 ResourceModelRenderer.java](<E:/Projects/BlueMap/core/src/main/java/de/bluecolored/bluemap/core/map/hires/block/ResourceModelRenderer.java#L58-L98>) | 方块状态模型、纹理映射、颜色和几何生成。 |
| 实体模型 | [实体 ResourceModelRenderer.java](<E:/Projects/BlueMap/core/src/main/java/de/bluecolored/bluemap/core/map/hires/entity/ResourceModelRenderer.java>) | 实体模型和纹理到几何的转换；与方块路径分别核对。 |

### 与本项目对照

- 世界区域读取、变更监听和低分辨率瓦片，可对照 [LowresStore.java](<../common/src/main/java/github/gtouming/what_guys_doing/world/LowresStore.java>) 及其相关类。
- 方块模型和纹理映射，可对照 [baker.js](<../common/src/main/resources/assets/what_guys_doing/web/baker.js>)；实体模型可对照 [entitymodel.js](<../common/src/main/resources/assets/what_guys_doing/web/entitymodel.js>)。
- 坐标、旋转和 UV 约定不得直接照搬；现有差异和回归要求见 [pitfalls.md](<pitfalls.md>)。

## 公开只读访问对照（2026-11-13 补充）

用户已明确本站按地址和开放数据端口公开观察，不设观察凭证或登录，见[现行公开访问合同](<observation-public-access.md>)与[ADR-0011](<adr/0011-public-read-only-observation.md>)。本机 BlueMap 的已读证据：

- [WebserverConfig.java:41–60](<E:/Projects/BlueMap/common/src/main/java/de/bluecolored/bluemap/common/config/WebserverConfig.java#L41-L60>)默认启用，绑定 `0.0.0.0:8100`；[配置模板](<E:/Projects/BlueMap/common/src/main/resources/de/bluecolored/bluemap/config/webserver.conf#L1-L40>)支持关闭内置服务。
- [Plugin.java:217–249](<E:/Projects/BlueMap/common/src/main/java/de/bluecolored/bluemap/common/plugin/Plugin.java#L217-L249>)注册静态／地图路由，[263–278](<E:/Projects/BlueMap/common/src/main/java/de/bluecolored/bluemap/common/plugin/Plugin.java#L263-L278>)按配置启动服务；[路由处理](<E:/Projects/BlueMap/common/src/main/java/de/bluecolored/bluemap/common/web/RoutingRequestHandler.java#L65-L88>)把请求直接交给数据处理器，[实时地图处理](<E:/Projects/BlueMap/common/src/main/java/de/bluecolored/bluemap/common/web/MapRequestHandler.java#L69-L105>)提供玩家／标记 JSON 和 SSE 读取。
- 已存在的[版本资源](<E:/Projects/BlueMap/core/build/resources/main/de/bluecolored/bluemap/version.json#L1-L4>)记录 `5.29-9`／`12823c378b7428a2b90302e8154930d82e6d7912`，与前述参考提交一致；不证明干净工作树或当前运行版本。

借鉴标准公开浏览不经过观察者登录，不照搬其资源暴露、缓存或线程预算，也不声称每个 BlueMap 部署都无代理／防火墙限制。默认通配监听不证明公网可达；本站启动、对外绑定及远程 WebGPU 的 HTTPS 入口是待确认部署取舍。此次仅只读，未复制、构建、运行或修改 BlueMap。

## 后续使用约定

- Xaero's World Map 优先用于功能和交互对照；BlueMap 优先用于可阅读、可核验的实现对照。
- 本地 BlueMap 仅作为参考检出，不自动构建、不更新其子模块，也不修改其工作区。
- 引用 BlueMap 的具体算法时，记录文件、提交和相关授权，先核对本项目的数据结构、坐标及线程边界。
- 保持本项目现有 Java 21、Fabric／NeoForge 双平台、WebGPU 浏览器渲染及实时数据推送架构；参考项目不自动成为依赖。
