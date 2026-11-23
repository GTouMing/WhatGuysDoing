# V1B 子进程启动门结果

## 结论

**启动门未通过，整批按停止条件收束。** 用户已明确批准 [V1B 清单](<../../../docs/observation-verification-v1b.md>)；新目录、源码及独立编译完成，但唯一一次同匿名管道的子进程启动在 `ProcessBuilder.start()` 再次报 `CreatePipe error=5`，主探针退出 1。没有取得 worker PID、ready 标记或正常退出证据；后续正常替换和单点中断没有编写或执行。

这不是被终止 worker 的退出码，也不是中断后断言失败。错误仍不能定位到具体 ACL、沙箱规则或 Windows 整体能力。没有在拒绝后重试、换管道/重定向/shell、修权限、提权或申请更宽模式；[V1A 证据](<../v1a-20261111-090437/RESULTS.md>) 未改动。

## 实际执行与可追溯输出

| 步骤 | 实际结果 | 证据与限制 |
| --- | --- | --- |
| 路径与 JDK 核对 | 指定新根及六个子目录排他创建；祖先目录无原生重解析点；Java/Javac 指纹与 V1A 相同；三个 Java 注入变量均不存在 | [清单](<MANIFEST.md>)；未读取环境变量值、未改全局环境/ACL |
| 脚本语法与编译 | `bash -n` 成功；独立 Javac 退出 0，**两条 `[try]` 警告** | [执行入口](<run-v1b.sh#L6-L10>)、[原始编译输出](<logs/compile-startup.txt>)；警告对应仅用于关闭的 stdin/stderr 资源，不是零警告或 lint 通过 |
| 启动门 | 主探针退出 1；CreatePipe error=5 | [原始启动输出](<logs/startup-gate.txt>)、[启动位置](<src/V1bStartupProbe.java#L43-L52>)；没有执行到 PID/正常退出记录、字节断言或终止清理分支 |
| 正常替换对照 | 未编写、未执行 | 前置启动门失败，不进入下一步 |
| 单点中断 | 未编写、未执行 | 不具备正常对照和 worker 启动证据，不称中断测试通过 |

执行 cwd 为 `E:/Projects/WhatGuysDoing`；两条验证命令均为受管理前台命令、上限 120 秒，未启动新后台任务。编译命令为 `bash -n` 后执行 `compile-startup` 模式；唯一运行命令为 `startup-gate` 模式。原始退出码由命令回执和脚本打印确认；原始文件只保存命令自身 stdout/stderr，不额外伪造退出记录。

父探针最大堆参数为 256 MiB，候选 worker 为 128 MiB；未取得后者成功启动证据，不把参数当实际峰值测量。没有运行 Gradle、模组/游戏、网络/监听、真实账号/凭证/存档、部署或性能测试，也没有修改产品源码。

## 指纹与留存状态

- [验证源码](<src/V1bStartupProbe.java>) SHA-256：`613426ccae22111398ef2500cb4acd637c3565afffb3e21e2d335e5731c38992`。
- [编译字节码](<classes/V1bStartupProbe.class>) SHA-256：`b7e381f742a75410cd24bbad9e842ceeb26d95db9c8cb25a54f2d1e51b5c76f0`。
- [执行脚本](<run-v1b.sh>) SHA-256：`1ec04de878fa0e6abbd8437e3c7961b3b44f3753db33f5def43a69a746730cb5`。
- [编译输出](<logs/compile-startup.txt>) SHA-256：`51f1a159b7cb8bcacad1afbb372011a3de96fb98a90a3d9094aa3b07e2c6a88b`；559 字节。
- [启动输出](<logs/startup-gate.txt>) SHA-256：`4b3bb970a8db070b4d45c583521a2197b035fdc3de9b3945ed88a84ee0de4322`；815 字节。

指纹只用于本机内容追溯，不是供应者认证。启动失败后完整原生 glob 得到 7 个文件、无跳过，合计 20397 字节；其中日志 1374 字节。[worker 错误输出文件](<fixtures/startup-gate/worker-stderr.bin>) 为空，是调用 start 前预创建的文件，不能证明 worker 已运行。报告初稿写入后的只读统计为 8 文件、25034 字节、日志 1374 字节；这是统计点数值，后续报告文字微调不算运行产物测量。没有新合成 JSON、删除或旧证据覆盖，总量远低于本批 16 MiB／日志 2 MiB 限制。

编译及异常输出含本机非 UTF-8 原始字节，保留原件。已用 hex 核对异常 ASCII 的 `CreatePipe error=5`；没有用有损解码替换源文件。Java、shell、Markdown 的 lint 工具均报告扩展不支持；实际编译/语法结果与 lint 不混用。

## 保持未关闭的事实门与下一步

两次限定批次都在同一子进程管道边界遭拒绝；**不再发起第三次同环境重试**。新目录和清理顺序修订没有消除拒绝，清理有界性本身也未获得运行证明。单点中断、硬件掉电/目录持久性、可信授权恢复、固定双加载器成功事实及连续活动、实际身份/秘密交付、部署和性能仍未通过。

后续先推进无需运行的工程设计及证据矩阵；运行路径须待能核定的执行环境或具体授权变化后再单独讨论，不自动改用另一种通道、解除沙箱或下载工具链。不因本轮停止放宽 Q1–Q152、开通生产观察或开始产品实施。
