# V1A 本机离线验证结果

## 结论

**部分取得本机证据，验证已停止；不是完整通过。** 用户明确批准的 [V1A 范围](<../../../docs/observation-verification.md>) 内，Java 21 已实际运行，独立源码已编译，直接 NIO 原子替换/读取/写错误获得合成证据。自建 writer 中断实验在创建进程管道时被拒绝，未到达中断点；离线 Gradle 和游戏类链接没有执行。

本次没有产品源码修改、游戏服务器/客户端、网络或监听、真实账号/授权/存档、EULA、ACL/系统配置修改或提权。没有在拒绝后尝试其他执行方式。所有受管理任务已经结束，未运行清理或递归删除；本次源码、输出及合成夹具保留供核对。

## 实际结果与证据级别

| 项目 | 实际结果 | 证据与限制 |
| --- | --- | --- |
| Java / Javac | 退出 0；Zulu Java 21.0.10+7-LTS、Javac 21.0.10 | [版本输出](<logs/java-version.txt#L1-L3>)；只证明本次 JDK 命令可运行 |
| 独立源码编译 | 各次切片编译均退出 0；最终源码也已编译 | [编译参数](<run-v1a.sh#L10-L13>) 显式 `--release 21`、`-proc:none`、`-Xlint:all`、仅本次 class/source path；没有项目构建或注解处理器 |
| 不替换负对照 | 原始退出 1；预期 AssertionError | [失败控制](<logs/replacement-red.txt#L1-L3>)，旧/新 JSON 都是 57 字节，检查比较内容而非长度；这是故意失败，不计为通过用例 |
| 完整文件替换 | 退出 0；`force(true)` 后 `ATOMIC_MOVE + REPLACE_EXISTING`，读到固定新 JSON 全字节 | [替换日志](<logs/replacement-green.txt#L1>)、[公开 NIO 操作](<src/V1aStorageProbe.java#L63-L78>)；不证明断电、目录项持久性或生产授权保存 |
| 文件读取边界 | 退出 0；缺失为 NoSuchFileException；坏 UTF-8 为 MalformedInputException；目录读取为 AccessDeniedException | [读取日志](<logs/read-boundaries.txt#L1-L4>)；**截断 JSON 被 raw NIO 正常读出**，没有 JSON/schema 校验器，不是坏文件安全拒绝已通过 |
| 写失败边界 | 退出 0；只读通道写入为 NonWritableChannelException；替换非空目录为 AccessDeniedException；当前旧字节和待写新字节分别保留 | [写异常日志](<logs/write-boundaries.txt#L1-L2>)、[测试边界](<src/V1aStorageProbe.java#L33-L57>)；未模拟磁盘耗尽/硬件错误，不是完整事务故障保证 |
| 自建子进程中断 | 原始退出 1；ProcessBuilder.start 在 CreatePipe error=5 时失败 | [失败位置](<src/V1aStorageProbe.java#L102-L113>)、[原始异常文件](<logs/interrupt-partial.txt>)；没有 writer ready、杀进程或中断后断言。原因未定位到具体 ACL/沙箱规则，不假称整个 Windows 不支持 |
| Gradle / 游戏类链接 | 未执行 | 只在精确 `C:/Users/GTouMing/.gradle/wrapper/dists/gradle-9.8.0-bin` 根未找到目录，不代表全机缺 Gradle。可变插件、缺可信构件/完整依赖闭包、零监听要求仍阻塞；不下载、不换版本、不启动 Gradle 或游戏初始化 |

两个 Architectury 缓存 POM 已回读，分别声明 [Fabric 映射坐标](<../../../.gradle/loom-cache/remapped_mods/loom_mappings_1_21_1_layered_hash_40545_v2/dev/architectury/architectury-fabric/13.0.11/architectury-fabric-13.0.11.pom#L5-L7>) 和 [NeoForge 映射坐标](<../../../.gradle/loom-cache/remapped_mods/loom_mappings_1_21_1_layered_hash_40545_v2_neoforge_21_1_262_forge/dev/architectury/architectury-neoforge/13.0.11/architectury-neoforge-13.0.11.pom#L5-L7>)。这是 Loom 转换缓存声明，不是供应方签名、原构件比对或完整依赖闭包。没有在 classpath 加入它们或执行其链接/初始化。

静态子代理曾将 PowerShell 查询误交给 Bash，退出 127；该调用未取得目录/文件指纹，不能作为不存在证据。父代理随后仅对指定 Gradle 根作独立只读检查（退出 0），对 JDK 可执行文件用原生 stat 取得本机指纹，并回读上述 POM；没有重复启动构建。

## 命令与任务记录

命令执行 cwd 为 `E:/Projects/WhatGuysDoing`。执行器实际为 MSYS Bash；原生 Windows 属性查询明确调用 `powershell.exe`，没有把 PowerShell 语法交给 Bash。每个验证任务的运行上限为 120 秒，顺序执行。JVM 主任务最大堆 256 MiB；计划 writer 为 128 MiB，但未成功创建。

| 受管理任务 | 命令/模式 | 实际状态 |
| --- | --- | --- |
| bash-c57f52fdc299428e | runner 默认 toolchain | completed / 0 |
| bash-551206fd98fa43e1 | compile | completed / 0 |
| bash-baa461ec9ec74049 | replacement-red | completed / 1，预期负对照 |
| bash-82286a3363024be4 | compile → replacement-green | completed / 0 |
| bash-bd52fa5f5bd14c16 | compile → read-boundaries | completed / 0 |
| bash-3751ceb229f24122 | compile → write-boundaries | completed / 0 |
| bash-9e755f6937ac4153 | compile → interrupt-partial | completed / 1，CreatePipe error=5，按停止条件收束 |

命令由 [执行脚本](<run-v1a.sh>) 记录，夹具固定为 `synthetic-only`，没有生成真实凭证。各切片编译日志写入同一路径，最终 [编译输出](<logs/compile.txt>) 为空，历史退出码以上表及受管理任务回执为准。早期负对照日志的源码行号对应当时的小版本，**不对应最终源码行号**；没有将历史成功外推为最终整套重新运行。

## 可追溯指纹与资源

- [最终验证源码](<src/V1aStorageProbe.java>) SHA-256：`5194f2e356598f7a9d2231ef28c4fd7e97fcfb7ce470f3872b9ee3d287d4e0ba`。
- 最终字节码 SHA-256：`72972cc02bcd9594eabb6a44375149c2737d112ee9120c0612c4781f5855b32d`；只编译和执行本次自写 JDK 类型程序。
- [执行脚本](<run-v1a.sh>) SHA-256：`ea5cf5842ddf459f552bc58e76396aa699632419e8cb35638c0a6141ce781825`。
- [清单](<MANIFEST.md>) 记录已读 JDK 可执行指纹、路径和 Java 选项存在性；这些 hash 是本机内容指纹，不是发布者认证证明。
- 收束时对本次目录的完整原生 glob：21 个文件、无跳过。报告初稿及调查补记写入后的只读统计为 22 文件、36542 字节，其中日志 1748 字节；这是统计点数值，终稿文字微调不用于性能结论。最大运行产物为 11227 字节字节码，没有复制依赖缓存或创建 Gradle 缓存；总体远低于 1 GiB、日志远低于 20 MiB。
- 源码/脚本/Markdown 的 lint 工具均报告该扩展不支持；不是 lint pass。实际 Javac `-Xlint:all` 编译及脚本语法检查已有成功；文档链接和编号另行手工/静态核对，不运行项目全套验证。

异常日志包含 Windows 本地编码的中文原始字节，原生 UTF-8 阅读返回 ERR_INVALID_ENCODING，已按工具要求用 hex 查看 ASCII 的 `CreatePipe error=5`，保留原文件，不做有损转码或编造解码内容。

## 必须保持未关闭的事实门

- **进程中断、掉电、目录项/设备持久性**：没有中断点执行证据，不证明坏临时文件不会被生产恢复路径使用。中断前仅建了合成旧文件，不足以结论化恢复语义。
- **授权文件的完整验证及事务**：没有实现 schema、时钟/epoch、权限、安全更新预留、整批重核、恢复/reissue 或真实秘密交付。读取能成功不等于可信读取。
- **固定双加载器专用服与四类成功事实/活动生命周期**：未构建或启动独立模组，未执行成功/取消/覆写/回滚和玩家行为；缓存静态信息仍不是运行证据。
- **实际 OS 身份、Ubuntu 部署、性能和页面交付计账**：均未执行。本机 Java/NIO 的结果不能跨设备或跨部署环境外推。

## 后续边界

本轮仅报告已取得部分证据及具体阻塞，不要求用户以产品偏好回答工程事实。下一步应先选出可核定的工具链供应/固定输入以及能安全执行中断实验的环境，明确新增权限与资源，再单独请求后续验证许可；不因“继续 V1A”自行放开监听、下载、权限修改或游戏运行。完整工程方案确认及产品实施继续单独保留。
