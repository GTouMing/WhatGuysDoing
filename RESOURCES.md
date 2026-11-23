# K 与固定平台证据 Resources

## Knowledge

- [Java SE 21：WritableByteChannel.write](<https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/channels/WritableByteChannel.html#write(java.nio.ByteBuffer)>)。
  本课主读资料。定义输入 remaining、正常返回的 n、缓冲区位置推进和可能为零的写；也说明同一通道的多线程写会等待。这是接口契约，不是本项目全站唯一写者或硬墙钟上界的证明。优先阅读 Method Details 中的 write，不必通读整页。
- [Java SE 21：GatheringByteChannel](<https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/channels/GatheringByteChannel.html>)。
  一次调用从多个缓冲区取字节，输入上界按被传入缓冲区的 remaining 总和计算。用于理解为什么协议头也计入 K，不能对每个缓冲区各给一个 K。
- [Java SE 21：SocketChannel](<https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/channels/SocketChannel.html>)。
  核对真实网络通道的非阻塞、部分写、零写及关闭/中断异常契约。文档没有为本项目给出“任意调用必定在某个毫秒数内完成”的硬保证，也不能证明浏览器已经应用数据。
- [Java SE 21：SelectorProvider](<https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/channels/spi/SelectorProvider.html>)。
  可选择通道和选择器的具体实现提供者。用于区分 API 名称与实际运行实现；官方描述默认提供者，也允许程序使用其他提供者。不从开发机操作系统猜测目标提供者。
- [项目 ADR-0010](<docs/adr/0010-single-owner-send-barrier.md#L7-L11>)。
  已选 R/B 顺序、全站唯一一次此前获准调用、异常不重放及保存顺序；明确没有选择 K、确认具体平台或授权实现。本项目政策以这份决定为依据，不归因于 Java API。
- [发送屏障工程推导](<docs/observation-send-barrier-engineering.md#L114-L147>)。
  列出全站至多一次、输入至多 K 的条件及不能推出的结论；结合[静态代价算例](<docs/observation-send-barrier-engineering.md#L191-L197>)理解安全残余与调用开销的取舍。算术不是性能实测。
- [V2 固定环境元组](<docs/observation-verification-v2.md#L50-L59>)与[V2-3 申请草案](<docs/observation-verification-v2.md#L107-L113>)。
  给出未来报告需要列明的环境、契约、夹具、度量和适用边界。草案全部待批准；阅读或教学练习不授权执行。

以上官方网页于 2026-11-12 只读查阅；没有查询本机 JDK、启动监听器或运行验证。官方网页支持契约解释，不代替与目标 build 对应的实现核对和构件来源证明。

## Wisdom (Communities)

- [OpenJDK nio-dev 讨论及档案](<https://mail.openjdk.org/mail/lists/nio-dev.openjdk.org/>)。
  阅读维护者对具体 NIO 实现问题的讨论，形成有明确 build 和复现条件的问题。该页面明确不是普通用户支持论坛；日常支持应找实际 JDK 发行者。档案中的经验不能自动作为当前平台保证。用户尚未表达加入社区的偏好，本课不要求注册或发帖。

## Gaps

- 尚无经核定的目标 JDK 发行者、完整 build、构件指纹、实际 NIO provider 与 OS/内核/部署元组。
- 尚无把具体实现与所依赖契约连接起来的完整证据，尤其后台提交、关闭与真实退出边界。
- 尚无真实产品全入口迁移、单一输出所有权和限制状态可见性的证明。
- 尚无经单独批准的 CPU、吞吐、零写/部分写、延迟和实际退出测量；K 仍待证据支持后取舍。
